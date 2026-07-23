// sync.js — synchro cloud opt-in entre téléphones.
// Local-first : l'app fonctionne sans ; avec un « groupe » (code secret partagé),
// chaque appareil pousse/fusionne les instantanés de ses profils via l'API
// auto-hébergée (api/sync.php sur le même domaine, ou une URL absolue).
import { SYNC_URL } from './sync-config.js';
import { mergeSnapshots, SYNC_STORES } from './sync-merge.js';
import * as db from './db.js';
import { state, emit, on, loadProfiles, saveGlobal } from './store.js';
import { refreshCustoms } from './data.js';
import { uid, nowTs } from './util.js';
import { call, ApiError } from './api.js';
import { workoutStats, thisWeekCount, goalStreak, weekStart } from './analytics.js';

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

// ---------- synchro par COMPTE (multi-appareils, un instantané par utilisateur) ----------
function computeStats(snap) {
  const ws = (snap.stores?.workouts || []).filter(w => w.status === 'completed');
  ws.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const last = ws[0] || null;
  const goal = snap.settings?.data?.weeklyGoal || 3;
  const wkStart = weekStart(Date.now());
  let weekVolume = 0;
  for (const w of ws) {
    if (weekStart(w.completedAt || w.startedAt) === wkStart) weekVolume += Math.round(workoutStats(w).volume);
  }
  return {
    lastWorkoutAt: last ? (last.completedAt || null) : null,
    lastWorkout: last ? `${last.name} · ${workoutStats(last).sets} séries` : null,
    weekStart: wkStart,
    weekCount: thisWeekCount(ws),
    weekVolume,
    streak: goalStreak(ws, goal),
    totalWorkouts: ws.length,
  };
}

async function accountSyncProfile(pid, acc, { keepalive = false } = {}) {
  try {
    const pulled = await call('data', 'pull', {}, { token: acc.token, keepalive });
    const remote = pulled?.data || null;
    if (pulled?.updated_at) emit('snap-seen', { ts: pulled.updated_at }); // pour live.js
    const local = await collectSnapshot(pid);
    // l'instantané distant peut venir d'un autre appareil où le profil a un autre id local :
    // on aligne son profil sur notre id local avant fusion
    if (remote?.profile && remote.profile.id !== pid) {
      remote.profile = { ...remote.profile, id: pid };
      for (const s of SYNC_STORES) for (const r of (remote.stores?.[s] || [])) r.profileId = pid;
      if (remote.settings) remote.settings.id = 'p:' + pid;
      for (const t of (remote.tombstones || [])) t.profileId = pid;
    }
    const merged = mergeSnapshots(local, remote);
    if (!merged) return { ok: true, changed: false };
    // jamais de marqueur "supprimé" pour un compte : le compte survit à la suppression locale
    if (merged.deleted) return { ok: true, changed: false };
    const mj = JSON.stringify(merged);
    let changed = false;
    if (JSON.stringify(local) !== mj) { await applySnapshot(pid, merged); changed = true; }
    if (JSON.stringify(remote) !== mj || dirty.has(pid)) {
      const pushed = await call('data', 'push', { data: merged, stats: computeStats(merged) }, { token: acc.token, keepalive });
      if (pushed?.updated_at) emit('snap-seen', { ts: pushed.updated_at }); // pour live.js
    }
    dirty.delete(pid);
    return { ok: true, changed };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const sdoc = await db.get('settings', 'p:' + pid);
      if (sdoc?.data?.account) { sdoc.data.account = null; await db.put('settings', sdoc); emit('account-changed'); }
    }
    return { ok: false, reason: e.message };
  }
}

async function accountsSync(opts = {}) {
  let changedAny = false, okAll = true, count = 0;
  const profiles = await db.getAll('profiles');
  for (const p of profiles) {
    const sdoc = await db.get('settings', 'p:' + p.id);
    const acc = sdoc?.data?.account;
    if (!acc?.token) continue;
    count++;
    const r = await accountSyncProfile(p.id, acc, opts);
    changedAny = changedAny || !!r.changed;
    okAll = okAll && r.ok;
  }
  if (changedAny) {
    await loadProfiles();
    await refreshCustoms();
    emit('profiles');
    emit('sync-applied');
  }
  return { ok: okAll, changed: changedAny, accounts: count };
}

async function anyAccountLinked() {
  const profiles = await db.getAll('profiles');
  for (const p of profiles) {
    const sdoc = await db.get('settings', 'p:' + p.id);
    if (sdoc?.data?.account?.token) return true;
  }
  return false;
}

// ---------- cycle de synchro global (comptes + groupe hérité) ----------
export async function syncNow(opts = {}) {
  if (!_configured || syncing) return { ok: false, reason: syncing ? 'busy' : 'off' };
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  syncing = true;
  try {
    const acc = await accountsSync(opts);
    let room = { ok: true, changed: false };
    if (syncCfg()?.code) { syncing = false; room = await roomSyncNow(opts); syncing = true; }
    return { ok: acc.ok && room.ok, changed: acc.changed || room.changed, accounts: acc.accounts, reason: (!acc.ok && 'compte') || (!room.ok && room.reason) || undefined };
  } finally {
    syncing = false;
  }
}

// ---------- synchro par CODE DE GROUPE (héritée, profils sans compte) ----------
async function roomSyncNow({ keepalive = false } = {}) {
  if (!isEnabled() || syncing) return { ok: false, reason: syncing ? 'busy' : 'off' };
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  syncing = true;
  try {
    const cfg = syncCfg();
    const rows = (await api('pull', { code: cfg.code }, { keepalive })) || [];
    const remote = new Map(rows.map(r => [r.profile_id, r.data]));

    // les profils liés à un compte sont synchronisés par le compte, pas par le groupe
    const allProfiles = await db.getAll('profiles');
    const localProfiles = [];
    for (const p of allProfiles) {
      const sdoc = await db.get('settings', 'p:' + p.id);
      if (!sdoc?.data?.account?.token) localProfiles.push(p.id);
    }
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
  if (applying || !_configured) return;
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
  // Sur le domaine officiel, le serveur existe PAR DÉFINITION : le mur de
  // connexion ne dépend plus d'une sonde réseau (une panne = vraie erreur
  // affichée, plus jamais le mode invité des premières versions).
  else if (/(^|\.)hbaillyg\.fr$|(^|\.)odns\.fr$/.test(location.hostname)) _configured = true;
  else if (syncCfg()?.code) _configured = true;
  else {
    let cached = null;
    try { cached = localStorage.getItem(PROBE_FLAG); } catch {}
    if (cached === '1') _configured = true;
    else {
      // On ne mémorise JAMAIS un échec : un ping raté (réseau mobile lent au 1er
      // lancement) ne doit pas faire croire « pas de serveur » pour toujours.
      const probe = async () => {
        let ok = false;
        try { ok = (await api('ping', {}, { timeoutMs: 8000 }))?.ok === true; } catch {}
        if (!ok) {
          // repli GET : si le POST est bloqué (opérateur/bloqueur) mais que le GET
          // répond, le serveur existe — on ne bascule pas en mode « sans serveur »
          try {
            const r = await fetch(apiUrl() + '?ping=1', { signal: AbortSignal.timeout?.(8000) });
            ok = (await r.json())?.ok === true;
          } catch {}
        }
        if (ok) { try { localStorage.setItem(PROBE_FLAG, '1'); } catch {} }
        return ok;
      };
      const recoverWhenUp = () => {
        // le serveur répond alors que l'app a démarré « sans serveur » :
        // on recharge pour réappliquer compte/social (jamais en pleine séance)
        if (!document.body.classList.contains('workout-mode')) location.reload();
      };
      if (navigator.onLine) _configured = await probe();
      if (!_configured) {
        (async () => {                                   // re-tentatives en arrière-plan
          for (const delay of [4000, 15000, 60000]) {
            await new Promise(r => setTimeout(r, delay));
            if (navigator.onLine && await probe()) { recoverWhenUp(); return; }
          }
        })();
        addEventListener('online', async () => {         // et au retour du réseau
          if (!_configured && await probe()) recoverWhenUp();
        }, { once: true });
      }
    }
  }
  if (!_configured) return;

  db.setOnWrite(onDbWrite);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  window.addEventListener('pagehide', () => { if (dirty.size) syncNow({ keepalive: true }); });
  on('account-changed', () => { startAuto(); syncNow(); });
  if (isEnabled() || await anyAccountLinked()) { startAuto(); syncNow(); }
}

// ---------- diagnostic réseau (affiché sur l'écran d'accueil sans serveur) ----------
export async function diagnose() {
  const out = { url: apiUrl(), enLigne: navigator.onLine, get: null, post: null };
  try {
    const r = await fetch(apiUrl() + '?ping=1', { signal: AbortSignal.timeout?.(8000) });
    out.get = { statut: r.status, reponse: (await r.text()).slice(0, 100) };
  } catch (e) { out.get = { erreur: String(e?.name || e) }; }
  try {
    const r = await fetch(apiUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'ping' }), signal: AbortSignal.timeout?.(8000) });
    out.post = { statut: r.status, reponse: (await r.text()).slice(0, 100) };
  } catch (e) { out.post = { erreur: String(e?.name || e) }; }
  return out;
}
