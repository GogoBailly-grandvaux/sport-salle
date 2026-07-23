// screens/social.js — amis, fil d'activité, groupes, programmes partagés
import { esc, relDate, debounce } from '../util.js';
import { nav, ACCENTS } from '../store.js';
import { icon, sheet, toast, confirmDialog, promptDialog } from '../ui.js';
import { call, isLoggedIn, account } from '../api.js';
import { importRoutinePayload } from '../templates.js';
import { emptyState, backBtn } from './common.js';
import { openAuthSheet } from './account.js';
import * as sync from '../sync.js';

let seg = 'feed'; // feed | amis | groupes

const avatarHtml = (u, size = '') =>
  `<span class="avatar ${size}" style="--a:${ACCENTS[u.accent]?.hex || ACCENTS.ember.hex}">${u.emoji ? esc(u.emoji) : esc((u.displayName || u.username || '?').slice(0, 1).toUpperCase())}</span>`;

const statsLine = (s) => {
  if (!s || !s.totalWorkouts) return `<span class="mut sm">Pas encore de séance</span>`;
  const bits = [];
  if (s.lastWorkoutAt) bits.push(`${esc(s.lastWorkout || 'Séance')} · ${relDate(s.lastWorkoutAt).toLowerCase()}`);
  return `<span class="mut sm">${bits.join('')}</span>`;
};

const statChips = (s) => {
  if (!s) return '';
  return `<div class="fr-chips">
    ${s.streak ? `<span class="fr-chip hot">🔥 ${s.streak} sem</span>` : ''}
    <span class="fr-chip">${s.weekCount || 0} séance${(s.weekCount || 0) > 1 ? 's' : ''} / sem</span>
    ${s.weekVolume ? `<span class="fr-chip">${Number(s.weekVolume).toLocaleString('fr-FR')} kg</span>` : ''}
  </div>`;
};

// ---------------- écran principal ----------------
export async function render() {
  if (!sync.isConfigured()) {
    return `${header()}<div class="screen-pad">${emptyState('users', 'Serveur injoignable', 'Impossible de joindre le serveur pour l’instant — vérifie ta connexion et réessaie.',
      `<button class="btn primary" id="soc-retry">Réessayer</button>`)}</div>`;
  }
  if (!isLoggedIn()) {
    return `${header()}
    <div class="screen-pad">
      <div class="social-hero">
        <div class="social-hero-ico">${icon('users')}</div>
        <h2>Entraîne-toi avec tes potes</h2>
        <p>Crée ton compte gratuit pour ajouter tes amis, voir leurs séances, partager tes programmes et créer des groupes avec classement hebdo.</p>
        <button class="btn primary full big" id="soc-register">Créer mon compte</button>
        <button class="btn ghost full" id="soc-login">J’ai déjà un compte</button>
      </div>
    </div>`;
  }

  const segs = `<div class="segmented social-seg">
    <button class="seg ${seg === 'feed' ? 'on' : ''}" data-seg="feed">Fil</button>
    <button class="seg ${seg === 'amis' ? 'on' : ''}" data-seg="amis">Amis</button>
    <button class="seg ${seg === 'groupes' ? 'on' : ''}" data-seg="groupes">Groupes</button>
  </div>`;

  let body = '';
  try {
    if (seg === 'feed') body = await renderFeed();
    else if (seg === 'amis') body = await renderAmis();
    else body = await renderGroupes();
  } catch (e) {
    body = emptyState('info', 'Oups', e.message || 'Erreur réseau', `<button class="btn ghost" onclick="location.reload()">Réessayer</button>`);
  }
  return `${header()}<div class="screen-pad">${segs}${body}</div>`;
}

function header() {
  const acc = account();
  return `<header class="topbar">
    <div class="topbar-l">${backBtn('#/home')}</div>
    <div class="topbar-c"><h1>Social</h1>${acc ? `<span class="topbar-sub">@${esc(acc.user.username)}</span>` : ''}</div>
    <div class="topbar-r"></div>
  </header>`;
}

// ---------------- FIL ----------------
async function renderFeed() {
  const d = await call('social', 'list');
  const { friends, incoming } = d;
  if (!friends.length && !incoming.length) {
    return emptyState('users', 'Ton fil est vide', 'Ajoute tes premiers amis pour voir leurs séances et partager tes programmes.',
      `<button class="btn primary" data-seg-go="amis">${icon('plus')} Ajouter des amis</button>`);
  }
  const pending = incoming.length ? `<button class="pending-banner" data-seg-go="amis">👋 ${incoming.length} demande${incoming.length > 1 ? 's' : ''} d’ami en attente ${icon('right')}</button>` : '';
  const cards = friends.map(f => `
    <button class="friend-card" data-friend='${esc(JSON.stringify({ id: f.id, username: f.username, displayName: f.displayName }))}'>
      ${avatarHtml(f)}
      <div class="fr-info">
        <b>${esc(f.displayName)} <span class="mut">@${esc(f.username)}</span></b>
        ${statsLine(f.stats)}
        ${statChips(f.stats)}
      </div>
      ${icon('right')}
    </button>`).join('');
  return pending + `<div class="friend-list">${cards}</div>`;
}

function openFriendSheet(f) {
  const s = sheet(`
    <div class="fr-head">${avatarHtml({ ...f }, 'big')}<div><b>${esc(f.displayName)}</b><span class="mut sm">@${esc(f.username)}</span></div></div>
    <div id="fr-programs"><p class="mut sm center">Chargement des programmes…</p></div>
    <button class="btn danger-ghost full sm" id="fr-remove">Retirer de mes amis</button>`,
    { title: 'Profil' });
  (async () => {
    try {
      const d = await call('programs', 'of', { userId: f.id });
      const host = s.root.querySelector('#fr-programs');
      if (!d.programs.length) { host.innerHTML = `<p class="mut sm center">Aucun programme partagé pour l’instant.</p>`; return; }
      host.innerHTML = `<h4 class="share-h">${icon('dumbbell')} Programmes partagés</h4>` + d.programs.map(p => `
        <div class="share-row"><div><b>${esc(p.name)}</b><span class="mut sm">${p.downloads} import${p.downloads > 1 ? 's' : ''}</span></div>
        <button class="btn primary sm" data-import="${p.id}">${icon('download')} Importer</button></div>`).join('');
      host.querySelectorAll('[data-import]').forEach(b => b.onclick = () => importShared(+b.dataset.import, s));
    } catch (e) { s.root.querySelector('#fr-programs').innerHTML = `<p class="mut sm center">${esc(e.message)}</p>`; }
  })();
  s.root.querySelector('#fr-remove').onclick = async () => {
    s.close();
    if (await confirmDialog({ title: 'Retirer', message: `Retirer ${f.displayName} de tes amis ?`, confirmText: 'Retirer', danger: true })) {
      await call('social', 'remove', { userId: f.id }); toast('Retiré'); nav.refresh();
    }
  };
}

export async function importShared(id, sheetToClose = null) {
  try {
    const d = await call('programs', 'import', { id });
    const r = await importRoutinePayload(d.payload);
    if (sheetToClose) sheetToClose.close();
    toast(`« ${r.name} » ajouté à tes programmes ✓`, { duration: 4000 });
  } catch (e) { toast(e.message, { type: 'error' }); }
}

// ---------------- AMIS ----------------
async function renderAmis() {
  const d = await call('social', 'list');
  const { friends, incoming, outgoing } = d;
  const row = (u, actions) => `
    <div class="friend-row">${avatarHtml(u)}
      <div class="fr-info"><b>${esc(u.displayName)}</b><span class="mut sm">@${esc(u.username)}</span></div>
      <div class="fr-actions">${actions}</div>
    </div>`;
  return `
    <div class="input-ico search-friend">${icon('search')}<input class="input" id="soc-search" placeholder="Chercher un @pseudo à ajouter" aria-label="Chercher un ami par pseudo" autocomplete="off"></div>
    <div id="soc-results"></div>
    ${incoming.length ? `<h4 class="share-h">Demandes reçues</h4>` + incoming.map(u => row(u,
      `<button class="btn primary sm" data-accept="${u.id}">Accepter</button><button class="icon-btn sm" data-decline="${u.id}" aria-label="Refuser la demande">${icon('x')}</button>`)).join('') : ''}
    ${friends.length ? `<h4 class="share-h">Mes amis (${friends.length})</h4>` + friends.map(u => row(u,
      `<button class="icon-btn sm" aria-label="Voir l’ami" data-open='${esc(JSON.stringify({ id: u.id, username: u.username, displayName: u.displayName, emoji: u.emoji, accent: u.accent }))}'>${icon('right')}</button>`)).join('') : ''}
    ${outgoing.length ? `<h4 class="share-h">Envoyées (en attente)</h4>` + outgoing.map(u => row(u, `<span class="mut sm">⏳</span>`)).join('') : ''}
    ${!friends.length && !incoming.length ? `<p class="hint">Cherche tes potes par leur @pseudo — ils reçoivent ta demande dans cet onglet.</p>` : ''}`;
}

function wireAmis(root) {
  const input = root.querySelector('#soc-search');
  const results = root.querySelector('#soc-results');
  if (input) input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    try {
      const d = await call('social', 'search', { q });
      results.innerHTML = d.results.length ? d.results.map(u => `
        <div class="friend-row">${avatarHtml(u)}
          <div class="fr-info"><b>${esc(u.displayName)}</b><span class="mut sm">@${esc(u.username)}</span></div>
          <div class="fr-actions">${u.relation === 'friends' ? '<span class="mut sm">✓ ami</span>'
            : u.relation === 'sent' ? '<span class="mut sm">⏳</span>'
            : u.relation === 'received' ? `<button class="btn primary sm" data-accept="${u.id}">Accepter</button>`
            : `<button class="btn primary sm" data-request="${esc(u.username)}">${icon('plus')} Ajouter</button>`}</div>
        </div>`).join('') : `<p class="mut sm center">Aucun résultat pour « ${esc(q)} »</p>`;
      wireActions(results);
    } catch (e) { results.innerHTML = `<p class="mut sm center">${esc(e.message)}</p>`; }
  }, 300));
  wireActions(root);
}

function wireActions(root) {
  root.querySelectorAll('[data-request]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { const r = await call('social', 'request', { username: b.dataset.request }); toast(r.accepted ? 'C’est fait, vous êtes amis ! 👊 🤝' : 'Demande envoyée ✓'); nav.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); b.disabled = false; }
  });
  root.querySelectorAll('[data-accept]').forEach(b => b.onclick = async () => {
    try { await call('social', 'respond', { userId: +b.dataset.accept, accept: true }); toast('Ami ajouté 🤝'); nav.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); }
  });
  root.querySelectorAll('[data-decline]').forEach(b => b.onclick = async () => {
    try { await call('social', 'respond', { userId: +b.dataset.decline, accept: false }); nav.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); }
  });
  root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openFriendSheet(JSON.parse(b.dataset.open)));
  root.querySelectorAll('[data-friend]').forEach(b => b.onclick = () => openFriendSheet(JSON.parse(b.dataset.friend)));
  root.querySelectorAll('[data-seg-go]').forEach(b => b.onclick = () => { seg = b.dataset.segGo; nav.refresh(); });
}

// ---------------- GROUPES ----------------
async function renderGroupes() {
  const d = await call('groups', 'mine');
  const cards = d.groups.map(g => `
    <button class="group-card" data-nav="#/social/group/${g.id}">
      <div class="group-ico">${icon('users')}</div>
      <div class="fr-info"><b>${esc(g.name)}</b><span class="mut sm">${g.memberCount} membre${g.memberCount > 1 ? 's' : ''}${g.isOwner ? ' · créé par toi' : ''}</span></div>
      ${icon('right')}
    </button>`).join('');
  return `
    ${d.groups.length ? `<div class="friend-list">${cards}</div>` :
      emptyState('users', 'Aucun groupe', 'Crée un groupe pour ta salle, ta team ou tes potes : classement hebdo et programmes partagés.', '')}
    <button class="btn primary full" id="grp-create">${icon('plus')} Créer un groupe</button>
    <button class="btn ghost full" id="grp-join">Rejoindre avec un code</button>`;
}

function wireGroupes(root) {
  root.querySelector('#grp-create')?.addEventListener('click', async () => {
    const name = await promptDialog({ title: 'Créer un groupe', label: 'Nom du groupe', placeholder: 'Ex. Team Gold’s Serris', confirmText: 'Créer' });
    if (!name?.trim()) return;
    try {
      const r = await call('groups', 'create', { name: name.trim() });
      toast(`Groupe créé ! Code : ${r.group.code}`, { duration: 6000 });
      nav.go(`#/social/group/${r.group.id}`);
    } catch (e) { toast(e.message, { type: 'error' }); }
  });
  root.querySelector('#grp-join')?.addEventListener('click', async () => {
    const code = await promptDialog({ title: 'Rejoindre un groupe', label: 'Code du groupe', placeholder: 'G-XXXXXXXX', confirmText: 'Rejoindre' });
    if (!code?.trim()) return;
    try {
      const r = await call('groups', 'join', { code: code.trim() });
      toast(`Bienvenue dans « ${r.group.name} » !`);
      nav.go(`#/social/group/${r.group.id}`);
    } catch (e) { toast(e.message, { type: 'error' }); }
  });
}

export function mount(root) {
  root.querySelector('#soc-retry')?.addEventListener('click', () => {
    try { localStorage.removeItem('sync-api-ok'); } catch {}
    location.reload(); // re-sonde au boot (8 s + re-tentatives)
  });
  root.querySelector('#soc-register')?.addEventListener('click', () => openAuthSheet('register', () => nav.refresh()));
  root.querySelector('#soc-login')?.addEventListener('click', () => openAuthSheet('login', () => nav.refresh()));
  root.querySelectorAll('[data-seg]').forEach(b => b.onclick = () => { seg = b.dataset.seg; nav.refresh(); });
  wireActions(root);
  if (seg === 'amis') wireAmis(root);
  if (seg === 'groupes') wireGroupes(root);
}

// ---------------- détail d'un groupe ----------------
export async function renderGroup(params) {
  try {
    const d = await call('groups', 'detail', { groupId: +params.id });
    const progs = await call('programs', 'ofGroup', { groupId: +params.id });
    const medals = ['🥇', '🥈', '🥉'];
    const rows = d.members.map((m, i) => `
      <div class="lb-row ${i < 3 && (m.stats?.weekCount || 0) > 0 ? 'top' : ''}">
        <span class="lb-rank">${(m.stats?.weekCount || 0) > 0 && i < 3 ? medals[i] : (i + 1)}</span>
        ${avatarHtml(m)}
        <div class="fr-info"><b>${esc(m.displayName)}</b>${statsLine(m.stats)}</div>
        <div class="lb-score"><b>${m.stats?.weekCount || 0}</b><span>séances</span></div>
      </div>`).join('');
    const progRows = progs.programs.length ? progs.programs.map(p => `
      <div class="share-row"><div><b>${esc(p.name)}</b><span class="mut sm">par ${esc(p.by?.displayName || '?')} · ${p.downloads} import${p.downloads > 1 ? 's' : ''}</span></div>
      <button class="btn primary sm" data-import="${p.id}">${icon('download')} Importer</button></div>`).join('')
      : `<p class="mut sm">Aucun programme partagé. Depuis un programme → menu ⋯ → « Partager ».</p>`;
    return `
      <header class="topbar">
        <div class="topbar-l">${backBtn('#/social')}</div>
        <div class="topbar-c"><h1 class="ell">${esc(d.group.name)}</h1><span class="topbar-sub">${d.members.length} membre${d.members.length > 1 ? 's' : ''}</span></div>
        <div class="topbar-r"><button class="icon-btn" id="grp-menu" aria-label="Options du groupe">${icon('more')}</button></div>
      </header>
      <div class="screen-pad">
        <section class="card"><h3 class="card-t">🏆 Classement de la semaine</h3><div class="lb-list">${rows}</div></section>
        <section class="card"><h3 class="card-t">${icon('dumbbell')} Programmes du groupe</h3>${progRows}</section>
        <button class="btn ghost full" id="grp-share-code">${icon('upload')} Inviter (code : ${esc(d.group.code)})</button>
      </div>`;
  } catch (e) {
    return `<div class="screen-pad">${emptyState('info', 'Oups', e.message, `<button class="btn ghost" data-nav="#/social">Retour</button>`)}</div>`;
  }
}

export function mountGroup(root, params) {
  root.querySelectorAll('[data-import]').forEach(b => b.onclick = () => importShared(+b.dataset.import));
  root.querySelector('#grp-share-code')?.addEventListener('click', async () => {
    const code = root.querySelector('#grp-share-code').textContent.match(/G-[A-Z0-9]+/)?.[0] || '';
    try { await navigator.share({ title: 'Sport Salle', text: `Rejoins mon groupe sur Sport Salle 💪\nCode : ${code}\n${location.origin}` }); }
    catch { try { await navigator.clipboard.writeText(code); toast('Code copié ✓'); } catch {} }
  });
  root.querySelector('#grp-menu')?.addEventListener('click', () => {
    const s = sheet(`<button class="menu-row danger" id="g-leave">${icon('x')} Quitter le groupe</button>`, { title: 'Options' });
    s.root.querySelector('#g-leave').onclick = async () => {
      s.close();
      if (await confirmDialog({ title: 'Quitter', message: 'Quitter ce groupe ?', confirmText: 'Quitter', danger: true })) {
        await call('groups', 'leave', { groupId: +params.id }); nav.go('#/social');
      }
    };
  });
}
