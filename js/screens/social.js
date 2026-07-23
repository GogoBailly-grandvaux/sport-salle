// screens/social.js — amis, fil d'activité, groupes, programmes partagés
import { t } from '../i18n.js';
import { esc, relDate, debounce } from '../util.js';
import { nav, ACCENTS } from '../store.js';
import { icon, sheet, toast, confirmDialog, promptDialog } from '../ui.js';
import { call, isLoggedIn, account } from '../api.js';
import { importRoutinePayload } from '../templates.js';
import { emptyState, backBtn } from './common.js';
import { openAuthSheet } from './account.js';
import * as sync from '../sync.js';
import { qrSvg } from '../qr.js';

let seg = 'feed'; // feed | amis | groupes

const avatarHtml = (u, size = '') =>
  `<span class="avatar ${size}" style="--a:${ACCENTS[u.accent]?.hex || ACCENTS.ember.hex}">${u.emoji ? esc(u.emoji) : esc((u.displayName || u.username || '?').slice(0, 1).toUpperCase())}</span>`;

const statsLine = (s) => {
  if (!s || !s.totalWorkouts) return `<span class="mut sm">Pas encore de séance</span>`;
  const bits = [];
  if (s.lastWorkoutAt) bits.push(`${esc(s.lastWorkout || t('Séance','Workout'))} · ${relDate(s.lastWorkoutAt).toLowerCase()}`);
  return `<span class="mut sm">${bits.join('')}</span>`;
};

const statChips = (s) => {
  if (!s) return '';
  return `<div class="fr-chips">
    ${s.streak ? `<span class="fr-chip hot">🔥 ${s.streak} sem</span>` : ''}
    <span class="fr-chip">${s.weekCount || 0} ${t('séance','workout')}${(s.weekCount || 0) > 1 ? 's' : ''} / ${t('sem','wk')}</span>
    ${s.weekVolume ? `<span class="fr-chip">${Number(s.weekVolume).toLocaleString('fr-FR')} kg</span>` : ''}
  </div>`;
};

// ---------------- écran principal ----------------
export async function render() {
  if (!sync.isConfigured()) {
    return `${header()}<div class="screen-pad">${emptyState('users', t('Serveur injoignable','Server unreachable'), t('Impossible de joindre le serveur pour l’instant — vérifie ta connexion et réessaie.','Can’t reach the server right now — check your connection and retry.'),
      `<button class="btn primary" id="soc-retry">${t('Réessayer','Retry')}</button>`)}</div>`;
  }
  if (!isLoggedIn()) {
    return `${header()}
    <div class="screen-pad">
      <div class="social-hero">
        <div class="social-hero-ico">${icon('users')}</div>
        <h2>${t('Entraîne-toi avec tes potes','Train with your crew')}</h2>
        <p>${t('Crée ton compte gratuit pour ajouter tes amis, voir leurs séances, partager tes programmes et créer des groupes avec classement hebdo.','Create your free account to add friends, see their workouts, share programs and build groups with a weekly leaderboard.')}</p>
        <button class="btn primary full big" id="soc-register">${t('Créer mon compte','Create my account')}</button>
        <button class="btn ghost full" id="soc-login">${t('J’ai déjà un compte','I already have an account')}</button>
      </div>
    </div>`;
  }

  const segs = `<div class="segmented social-seg">
    <button class="seg ${seg === 'feed' ? 'on' : ''}" data-seg="feed">${t('Fil','Feed')}</button>
    <button class="seg ${seg === 'amis' ? 'on' : ''}" data-seg="amis">${t('Amis','Friends')}</button>
    <button class="seg ${seg === 'groupes' ? 'on' : ''}" data-seg="groupes">${t('Groupes','Groups')}</button>
  </div>`;

  let body = '';
  try {
    if (seg === 'feed') body = await renderFeed();
    else if (seg === 'amis') body = await renderAmis();
    else body = await renderGroupes();
  } catch (e) {
    body = emptyState('info', t('Oups','Oops'), e.message || t('Erreur réseau','Network error'), `<button class="btn ghost" onclick="location.reload()">${t('Réessayer','Retry')}</button>`);
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
const EMOJIS = ['👊', '🔥', '💪', '👏'];

function ago(ts) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return t('à l’instant','just now');
  const m = Math.round(s / 60);
  if (m < 60) return t(`il y a ${m} min`,`${m} min ago`);
  const h = Math.round(m / 60);
  if (h < 24) return t(`il y a ${h} h`,`${h} h ago`);
  const d = Math.round(h / 24);
  return d === 1 ? t('hier','yesterday') : t(`il y a ${d} j`,`${d} d ago`);
}

const fmtDur = (sec) => {
  const m = Math.round((sec || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};

function postBody(p) {
  const c = p.content || {};
  if (p.kind === 'workout') {
    const chips = [
      c.sets ? `<span class="fr-chip">${c.sets} ${t('séries','sets')}</span>` : '',
      c.volume ? `<span class="fr-chip">${Number(c.volume).toLocaleString(t('fr-FR','en-US'))} kg</span>` : '',
      c.durationSec ? `<span class="fr-chip">${fmtDur(c.durationSec)}</span>` : '',
      c.prs ? `<span class="fr-chip hot">🏆 ${c.prs} PR${c.prs > 1 ? 's' : ''}</span>` : '',
    ].filter(Boolean).join('');
    return `<div class="post-wk"><b>💪 ${esc(c.name || t('Séance','Workout'))}</b>
      <div class="fr-chips">${chips}</div>
      ${c.note ? `<p class="post-note">${esc(c.note)}</p>` : ''}</div>`;
  }
  if (p.kind === 'program') {
    return `<div class="post-prog">
      <div class="post-prog-l"><b>📋 ${esc(c.name || t('Programme','Program'))}</b>
      ${c.exos ? `<span class="mut sm">${c.exos} ${t('exercice','exercise')}${c.exos > 1 ? 's' : ''}</span>` : ''}</div>
      ${p.isMine ? '' : `<button class="btn primary sm" data-import="${+c.sharedId}">${icon('download')} ${t('Importer','Import')}</button>`}
    </div>`;
  }
  return `<p class="post-text">${esc(c.text || '')}</p>`;
}

function postCard(p) {
  const a = p.author || {};
  const reacts = EMOJIS.map(e => {
    const n = (p.reactions && p.reactions[e]) || 0;
    const on = p.myReaction === e;
    return `<button class="react-chip ${on ? 'on' : ''}" data-react="${e}" data-post="${p.id}" aria-label="${t('Réagir','React')} ${e}">${e}${n ? ` <b>${n}</b>` : ''}</button>`;
  }).join('');
  return `<article class="post-card" data-pid="${p.id}">
    <div class="post-head">
      ${avatarHtml(a)}
      <div class="post-who"><b>${esc(a.displayName || '')}</b><span class="mut sm">@${esc(a.username || '')} · ${ago(p.ts)}</span></div>
      ${p.isMine ? `<button class="icon-btn sm post-del" data-del="${p.id}" aria-label="${t('Supprimer le post','Delete post')}">${icon('trash')}</button>` : ''}
    </div>
    ${postBody(p)}
    <div class="react-bar">${reacts}</div>
  </article>`;
}

async function renderFeed() {
  const [d, soc] = await Promise.all([call('posts', 'feed'), call('social', 'list')]);
  const { incoming, friends } = soc;
  const pending = incoming.length ? `<button class="pending-banner" data-seg-go="amis">👋 ${incoming.length} ${t('demande','friend request')}${incoming.length > 1 ? 's' : ''} ${t('d’ami en attente','pending')} ${icon('right')}</button>` : '';
  const acc = account();
  const composer = `<button class="feed-composer" id="feed-compose">
    ${avatarHtml({ emoji: acc?.user?.emoji, displayName: acc?.user?.displayName, username: acc?.user?.username, accent: acc?.user?.accent })}
    <span>${t('Quoi de neuf à la salle ?','What’s new at the gym?')}</span>
  </button>`;
  let list;
  if (d.posts.length) {
    list = `<div class="feed-list" id="feed-list">${d.posts.map(postCard).join('')}</div>
      ${d.hasMore ? `<button class="btn ghost full" id="feed-more" data-before="${d.posts[d.posts.length - 1].id}">${t('Voir plus','See more')}</button>` : ''}`;
  } else if (!friends.length) {
    list = emptyState('users', t('Ton fil est vide','Your feed is empty'), t('Ajoute tes premiers amis pour voir leurs séances, leurs posts et leurs programmes.','Add your first friends to see their workouts, posts and programs.'),
      `<button class="btn primary" data-seg-go="amis">${icon('plus')} ${t('Ajouter des amis','Add friends')}</button>`);
  } else {
    list = emptyState('users', t('Rien pour l’instant','Nothing yet'), t('Termine une séance et partage-la, ou écris le premier post !','Finish a workout and share it, or write the first post!'), '');
  }
  return pending + composer + list;
}

function wireFeed(root) {
  root.querySelector('#feed-compose')?.addEventListener('click', () => {
    const s = sheet(`
      <textarea class="input post-input" id="pc-text" rows="4" maxlength="500" placeholder="${t('Raconte ta séance, motive la team…','Tell about your workout, motivate the team…')}"></textarea>
      <button class="btn primary full" id="pc-send">${t('Publier','Post')}</button>`,
      { title: t('Nouveau post','New post') });
    const ta = s.root.querySelector('#pc-text');
    setTimeout(() => ta.focus(), 250);
    s.root.querySelector('#pc-send').onclick = async () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      const btn = s.root.querySelector('#pc-send');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try { await call('posts', 'publish', { kind: 'text', content: { text } }); s.close(); toast(t('Publié ✓','Posted ✓')); nav.refresh(); }
      catch (e) { toast(e.message, { type: 'error' }); btn.disabled = false; btn.textContent = t('Publier','Post'); }
    };
  });
  root.querySelectorAll('[data-react]').forEach(b => b.onclick = async () => {
    const postId = +b.dataset.post;
    const emoji = b.dataset.react;
    const wasOn = b.classList.contains('on');
    // optimiste : bascule immédiate, correction au refresh
    const card = b.closest('.post-card');
    card.querySelectorAll('.react-chip').forEach(x => { if (x !== b) x.classList.remove('on'); });
    b.classList.toggle('on', !wasOn);
    try { await call('posts', 'react', { postId, emoji: wasOn ? '' : emoji }); nav.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); nav.refresh(); }
  });
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!(await confirmDialog({ title: t('Supprimer','Delete'), message: t('Supprimer ce post ?','Delete this post?'), confirmText: t('Supprimer','Delete'), danger: true }))) return;
    try { await call('posts', 'delete', { postId: +b.dataset.del }); toast(t('Post supprimé','Post deleted')); nav.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); }
  });
  root.querySelector('#feed-more')?.addEventListener('click', async () => {
    const btn = root.querySelector('#feed-more');
    btn.disabled = true;
    try {
      const d = await call('posts', 'feed', { before: +btn.dataset.before });
      root.querySelector('#feed-list').insertAdjacentHTML('beforeend', d.posts.map(postCard).join(''));
      if (d.hasMore && d.posts.length) { btn.dataset.before = d.posts[d.posts.length - 1].id; btn.disabled = false; }
      else btn.remove();
      wireFeed(root); // recâble les nouvelles cartes
    } catch (e) { toast(e.message, { type: 'error' }); btn.disabled = false; }
  });
  root.querySelectorAll('[data-import]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    await importShared(+b.dataset.import);
    b.disabled = false;
  });
}

function openFriendSheet(f) {
  const s = sheet(`
    <div class="fr-head">${avatarHtml({ ...f }, 'big')}<div><b>${esc(f.displayName)}</b><span class="mut sm">@${esc(f.username)}</span></div></div>
    <div id="fr-programs"><p class="mut sm center">Chargement des programmes…</p></div>
    <button class="btn danger-ghost full sm" id="fr-remove">Retirer de mes amis</button>`,
    { title: t('Profil','Profile') });
  (async () => {
    try {
      const d = await call('programs', 'of', { userId: f.id });
      const host = s.root.querySelector('#fr-programs');
      if (!d.programs.length) { host.innerHTML = `<p class="mut sm center">Aucun programme partagé pour l’instant.</p>`; return; }
      host.innerHTML = `<h4 class="share-h">${icon('dumbbell')} ${t('Programmes partagés','Shared programs')}</h4>` + d.programs.map(p => `
        <div class="share-row"><div><b>${esc(p.name)}</b><span class="mut sm">${p.downloads} import${p.downloads > 1 ? 's' : ''}</span></div>
        <button class="btn primary sm" data-import="${p.id}">${icon('download')} ${t('Importer','Import')}</button></div>`).join('');
      host.querySelectorAll('[data-import]').forEach(b => b.onclick = () => importShared(+b.dataset.import, s));
    } catch (e) { s.root.querySelector('#fr-programs').innerHTML = `<p class="mut sm center">${esc(e.message)}</p>`; }
  })();
  s.root.querySelector('#fr-remove').onclick = async () => {
    s.close();
    if (await confirmDialog({ title: t('Retirer','Remove'), message: `${t('Retirer','Remove')} ${f.displayName} ${t('de tes amis ?','from your friends?')}`, confirmText: t('Retirer','Remove'), danger: true })) {
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
    <div class="input-ico search-friend">${icon('search')}<input class="input" id="soc-search" placeholder="${t('Chercher un @pseudo à ajouter','Search a @username to add')}" aria-label="Chercher un ami par pseudo" autocomplete="off"></div>
    <div id="soc-results"></div>
    <button class="btn ghost full" id="soc-qr">▦ ${t('Mon code QR — ajout en un scan','My QR code — add me in one scan')}</button>
    ${incoming.length ? `<h4 class="share-h">${t('Demandes reçues','Requests received')}</h4>` + incoming.map(u => row(u,
      `<button class="btn primary sm" data-accept="${u.id}">${t('Accepter','Accept')}</button><button class="icon-btn sm" data-decline="${u.id}" aria-label="Refuser la demande">${icon('x')}</button>`)).join('') : ''}
    ${friends.length ? `<h4 class="share-h">${t('Mes amis','My friends')} (${friends.length})</h4>` + friends.map(u => row(u,
      `<button class="icon-btn sm" aria-label="Voir l’ami" data-open='${esc(JSON.stringify({ id: u.id, username: u.username, displayName: u.displayName, emoji: u.emoji, accent: u.accent }))}'>${icon('right')}</button>`)).join('') : ''}
    ${outgoing.length ? `<h4 class="share-h">${t('Envoyées (en attente)','Sent (pending)')}</h4>` + outgoing.map(u => row(u, `<span class="mut sm">⏳</span>`)).join('') : ''}
    ${!friends.length && !incoming.length ? `<p class="hint">${t('Cherche tes potes par leur @pseudo — ils reçoivent ta demande dans cet onglet.','Find your friends by @username — they’ll get your request in this tab.')}</p>` : ''}`;
}

function openQrSheet() {
  const acc = account();
  if (!acc?.user?.username) return;
  const link = 'https://sportsalle.hbaillyg.fr/#/add/' + encodeURIComponent(acc.user.username);
  const s = sheet(`
    <div class="qr-wrap">${qrSvg(link, { dark: '#0c0d10', light: '#ffffff' })}</div>
    <p class="center" style="margin:10px 0 2px"><b>@${esc(acc.user.username)}</b></p>
    <p class="mut sm center" style="margin:0 0 12px">${t('Ton pote scanne ce code avec son appareil photo → il t’ajoute direct.','Your friend scans this with their camera → adds you instantly.')}</p>
    <button class="btn primary full" id="qr-share">${icon('upload')} ${t('Partager mon profil','Share my profile')}</button>`,
    { title: t('Mon code QR','My QR code') });
  s.root.querySelector('#qr-share').onclick = async () => {
    const text = t(`Ajoute-moi sur Sport Salle : @${acc.user.username}`,`Add me on Sport Salle: @${acc.user.username}`);
    try {
      if (navigator.share) { await navigator.share({ title: 'Sport Salle', text, url: link }); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(link); toast(t('Lien copié ✓','Link copied ✓')); }
    catch { toast(link, { duration: 6000 }); }
  };
}

function wireAmis(root) {
  root.querySelector('#soc-qr')?.addEventListener('click', openQrSheet);
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
            : u.relation === 'received' ? `<button class="btn primary sm" data-accept="${u.id}">${t('Accepter','Accept')}</button>`
            : `<button class="btn primary sm" data-request="${esc(u.username)}">${icon('plus')} ${t('Ajouter','Add')}</button>`}</div>
        </div>`).join('') : `<p class="mut sm center">Aucun résultat pour « ${esc(q)} »</p>`;
      wireActions(results);
    } catch (e) { results.innerHTML = `<p class="mut sm center">${esc(e.message)}</p>`; }
  }, 300));
  wireActions(root);
}

function wireActions(root) {
  root.querySelectorAll('[data-request]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { const r = await call('social', 'request', { username: b.dataset.request }); toast(r.accepted ? t('C’est fait, vous êtes amis ! 👊 🤝','Done — you’re friends! 👊 🤝') : t('Demande envoyée ✓','Request sent ✓')); nav.refresh(); }
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
      emptyState('users', t('Aucun groupe','No groups'), t('Crée un groupe pour ta salle, ta team ou tes potes : classement hebdo et programmes partagés.','Create a group for your gym, your team or your crew: weekly leaderboard and shared programs.'), '')}
    <button class="btn primary full" id="grp-create">${icon('plus')} ${t('Créer un groupe','Create a group')}</button>
    <button class="btn ghost full" id="grp-join">Rejoindre avec un code</button>`;
}

function wireGroupes(root) {
  root.querySelector('#grp-create')?.addEventListener('click', async () => {
    const name = await promptDialog({ title: t('Créer un groupe','Create a group'), label: t('Nom du groupe','Group name'), placeholder: t('Ex. Team Gold’s Serris','E.g. Team Gold’s'), confirmText: t('Créer','Create') });
    if (!name?.trim()) return;
    try {
      const r = await call('groups', 'create', { name: name.trim() });
      toast(`Groupe créé ! Code : ${r.group.code}`, { duration: 6000 });
      nav.go(`#/social/group/${r.group.id}`);
    } catch (e) { toast(e.message, { type: 'error' }); }
  });
  root.querySelector('#grp-join')?.addEventListener('click', async () => {
    const code = await promptDialog({ title: t('Rejoindre un groupe','Join a group'), label: t('Code du groupe','Group code'), placeholder: 'G-XXXXXXXX', confirmText: t('Rejoindre','Join') });
    if (!code?.trim()) return;
    try {
      const r = await call('groups', 'join', { code: code.trim() });
      toast(`Bienvenue dans « ${r.group.name} » !`);
      nav.go(`#/social/group/${r.group.id}`);
    } catch (e) { toast(e.message, { type: 'error' }); }
  });
}

// ---------------- deep link : #/add/<pseudo> (depuis un QR scanné) ----------------
export function renderAddFriend(params) {
  const u = decodeURIComponent(params.username || '').toLowerCase();
  return `<div class="screen-pad"><div class="add-land">
    <div class="add-land-ico">👊</div>
    <h2>${t('Ajouter','Add')} <b>@${esc(u)}</b> ?</h2>
    <p class="mut">${t('Vous verrez vos séances, vos posts et vos programmes dans le fil.','You’ll see each other’s workouts, posts and programs in the feed.')}</p>
    <button class="btn primary full big" id="add-go">${t('Envoyer la demande','Send request')}</button>
    <button class="btn ghost full" data-nav="#/social">${t('Plus tard','Later')}</button>
  </div></div>`;
}
export function mountAddFriend(root, params) {
  const u = decodeURIComponent(params.username || '').toLowerCase();
  root.querySelector('#add-go')?.addEventListener('click', async () => {
    const btn = root.querySelector('#add-go');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await call('social', 'request', { username: u });
      toast(r.accepted ? t('C’est fait, vous êtes amis ! 👊','Done — you’re friends! 👊') : t('Demande envoyée à','Request sent to') + ' @' + u + ' ✓', { duration: 4000 });
      seg = 'amis'; nav.go('#/social');
    } catch (e) {
      toast(e.message, { type: 'error' });
      btn.disabled = false; btn.textContent = t('Envoyer la demande','Send request');
    }
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
  if (seg === 'feed') wireFeed(root);
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
      : `<p class="mut sm">${t('Aucun programme partagé. Depuis un programme → menu ⋯ → « Partager ».','No shared programs. From a program → ⋯ menu → “Share”.')}</p>`;
    return `
      <header class="topbar">
        <div class="topbar-l">${backBtn('#/social')}</div>
        <div class="topbar-c"><h1 class="ell">${esc(d.group.name)}</h1><span class="topbar-sub">${d.members.length} ${t('membre','member')}${d.members.length > 1 ? 's' : ''}</span></div>
        <div class="topbar-r"><button class="icon-btn" id="grp-menu" aria-label="Options du groupe">${icon('more')}</button></div>
      </header>
      <div class="screen-pad">
        <section class="card"><h3 class="card-t">🏆 ${t('Classement de la semaine','This week’s leaderboard')}</h3><div class="lb-list">${rows}</div></section>
        <section class="card"><h3 class="card-t">${icon('dumbbell')} ${t('Programmes du groupe','Group programs')}</h3>${progRows}</section>
        <button class="btn ghost full" id="grp-share-code">${icon('upload')} ${t('Inviter','Invite')} (code : ${esc(d.group.code)})</button>
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
    catch { try { await navigator.clipboard.writeText(code); toast(t('Code copié ✓','Code copied ✓')); } catch {} }
  });
  root.querySelector('#grp-menu')?.addEventListener('click', () => {
    const s = sheet(`<button class="menu-row danger" id="g-leave">${icon('x')} ${t('Quitter le groupe','Leave group')}</button>`, { title: 'Options' });
    s.root.querySelector('#g-leave').onclick = async () => {
      s.close();
      if (await confirmDialog({ title: t('Quitter','Leave'), message: t('Quitter ce groupe ?','Leave this group?'), confirmText: t('Quitter','Leave'), danger: true })) {
        await call('groups', 'leave', { groupId: +params.id }); nav.go('#/social');
      }
    };
  });
}
