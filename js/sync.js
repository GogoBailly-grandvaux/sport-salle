// sync.js — synchro cloud opt-in entre téléphones.
// Local-first : l'app fonctionne sans ; avec un « groupe » (code secret partagé),
// chaque appareil pousse/fusionne les instantanés de ses profils via l'API
// auto-hébergée (api/sync.php sur le même domaine, ou une URL absolue).
import { SYNC_URL } from './sync-config.js';
import { mergeSnapshots, SYNC_STORES } from './sync-merge.js';
import * as db from './db.js';
import { state, emit, loadProfiles, saveGlobal } from './store.js';
import { refreshCustoms } from './data.js';
import { uid, nowTs } from './util.js';

let dirty = new Set();      // profileIds à pousser
let applying = false;       // écritures internes (pas de re-marquage dirty)
let syncing = false;
let pushTimer = null;
let pollTimer = null;
let _configured = false;    // résolu par init() (sonde en mode 'auto')

const PROBE_FLAG = 'sync-api-ok';

function apiUrl() {
  if (!SYNC_URL) return null;
  if (SYNC_URL === 'auto') return new URL('api/sync.php', document.baseURI).toString();
  return SYNC_URL;
}

export const isConfigured = () => _configured;
export const syncCfg = () => state.global?.sync || null;
export const isEnabled = () => _configured && !!(syncCfg()?.code);

// ---------- transport ----------
async function api(action, payload = {}, { keepalive = false, timeoutMs = 0 } = {}) {
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      keepalive,
      signal: ctrl?.signal,
    });
    const t = await r.text();
    const data = t ? JSON.parse(t) : null;
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------- snapshots ----------
async function collectSnapshot(pid) {
  const profile = (await db.get('profiles', pid)) || null;
  const settings = (await db.get('settings', 'p:' + pid)) || null;
  const tombstones = await db.getAllByIndex('deletions', 'profileId', pid);
  const snap = { v: 1, profile, settings, tombstones, stores: {} };
  for (const s of SYNC_STORES) snap.stores[s] = await db.getAllByIndex(s, 'profileId', pid);
  return snap;
}

async function applySnapshot(pid, snap) {
  applying = true;
  try {
    if (snap.deleted) {
      for (const s of SYNC_STORES) await db.deleteWhere(s, 'profileId', pid);
      await db.del('settings', 'p:' + pid);
      await db.del('profiles', pid);
      for (const t of (snap.tombstones || [])) await db.put('deletions', t);
      return;
    }
    if (snap.profile) await db.put('profiles', snap.profile);
    if (snap.settings) await db.put('settings', snap.settings);
    for (const s of SYNC_STORES) {
      const want = snap.stores?.[s] || [];
      const key = r => s === 'favorites' ? r.profileId + '|' + r.exerciseId : r.id;
      const wantKeys = new Set(want.map(key));
      const have = await db.getAllByIndex(s, 'profileId', pid);
      for (const h of have) {
        if (!wantKeys.has(key(h))) await db.del(s, s === 'favorites' ? [h.profileId, h.exerciseId] : h.id);
      }
      if (want.length) await db.bulkPut(s, want);
    }
    for (const t of (snap.tombstones || [])) await db.put('deletions', t);
  } finally {
    applying = false;
  }
}

// ---------- cycle de synchro ----------
export async function syncNow({ keepalive = false } = {}) {
  if (!isEnabled() || syncing) return { ok: false, reason: syncing ? 'busy' : 'off' };
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  syncing = true;
  try {
    const cfg = syncCfg();
    const rows = (await api('pull', { code: cfg.code }, { keepalive })) || [];
    const remote = new Map(rows.map(r => [r.profile_id, r.data]));

    const localProfiles = (await db.getAll('profiles')).map(p => p.id);
    const tombedProfiles = (await db.getAll('deletions')).filter(t => t.store === 'profiles').map(t => t.recordId);
    const ids = new Set([...localProfiles, ...remote.keys(), ...tombedProfiles]);

    let changedLocal = false;
    for (const pid of ids) {
      const hasLocal = localProfiles.includes(pid) || tombedProfiles.includes(pid);
      const localSnap = hasLocal ? await collectSnapshot(pid) : null;
      const remoteSnap = remote.get(pid) || null;
      const merged = mergeSnapshots(localSnap, remoteSnap);
      if (!merged) continue;
      const mj = JSON.stringify(merged);
      if (JSON.stringify(localSnap) !== mj) { await applySnapshot(pid, merged); changedLocal = true; }
      if (JSON.stringify(remoteSnap) !== mj || dirty.has(pid)) {
        await api('push', { code: cfg.code, profile: pid, device: cfg.deviceId, data: merged }, { keepalive });
      }
    }
    dirty.clear();
    cfg.lastSyncAt = nowTs();
    await saveGlobal({ sync: cfg });

    if (changedLocal) {
      await loadProfiles();
      await refreshCustoms();
      emit('profiles');
      emit('sync-applied');
    }
    return { ok: true, changed: changedLocal, profiles: ids.size };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    syncing = false;
  }
}

// ---------- groupe ----------
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I/L
function randomBlock(n) {
  const buf = new Uint32Array(n); crypto.getRandomValues(buf);
  return [...buf].map(x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}
export function normalizeCode(c) { return (c || '').trim().toUpperCase().replace(/\s+/g, ''); }

async function enable(code) {
  const cfg = { code, deviceId: uid(), auto: true, lastSyncAt: null, joinedAt: nowTs() };
  await saveGlobal({ sync: cfg });
  startAuto();
}
export async function createGroup() {
  const code = `SALLE-${randomBlock(5)}-${randomBlock(5)}-${randomBlock(5)}`;
  await enable(code);
  const r = await syncNow();
  return { code, ...r };
}
export async function joinGroup(rawCode) {
  const code = normalizeCode(rawCode);
  if (code.length < 16) return { ok: false, reason: 'code trop court' };
  let found = 0;
  try { found = ((await api('pull', { code })) || []).length; }
  catch (e) { return { ok: false, reason: e.message }; }
  await enable(code);
  const r = await syncNow();
  return { ...r, found };
}
export async function leaveGroup() {
  stopAuto();
  await saveGlobal({ sync: null });
}

// ---------- automatisation ----------
function scheduleDirtyPush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { syncNow(); }, 4000);
}

function onDbWrite(storeName, obj) {
  if (applying || !isEnabled()) return;
  if (storeName === 'deletions') { scheduleDirtyPush(); return; }
  let pid = null;
  if (obj && typeof obj === 'object' && obj.profileId) pid = obj.profileId;
  else if (storeName === 'profiles' && obj && obj.id) pid = obj.id;
  else if (storeName === 'settings' && obj && typeof obj.id === 'string' && obj.id.startsWith('p:')) pid = obj.id.slice(2);
  dirty.add(pid || state.activeProfileId);
  scheduleDirtyPush();
}

function startAuto() {
  stopAuto();
  pollTimer = setInterval(() => { if (!document.hidden) syncNow(); }, 90_000);
}
function stopAuto() {
  clearInterval(pollTimer); pollTimer = null;
  clearTimeout(pushTimer); pushTimer = null;
}

export async function init() {
  if (!SYNC_URL) return;

  // Résolution de la configuration :
  // - URL absolue → on fait confiance ;
  // - déjà dans un groupe → configuré (l'API a forcément existé) ;
  // - mode 'auto' → sonde api/sync.php (résultat mémorisé pour les boots suivants).
  if (SYNC_URL !== 'auto') _configured = true;
  else if (syncCfg()?.code) _configured = true;
  else {
    let cached = null;
    try { cached = localStorage.getItem(PROBE_FLAG); } catch {}
    if (cached === '1') _configured = true;
    else if (navigator.onLine) {
      const probe = async () => {
        let ok = false;
        try { ok = (await api('ping', {}, { timeoutMs: 3000 }))?.ok === true; } catch {}
        try { localStorage.setItem(PROBE_FLAG, ok ? '1' : '0'); } catch {}
        return ok;
      };
      if (cached === null) _configured = await probe(); // 1er lancement : on attend la réponse
      else probe();                                     // déjà '0' : re-sonde en arrière-plan (pris en compte au prochain lancement)
    }
  }
  if (!_configured) return;

  db.setOnWrite(onDbWrite);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  window.addEventListener('pagehide', () => { if (dirty.size) syncNow({ keepalive: true }); });
  if (isEnabled()) { startAuto(); syncNow(); }
}
