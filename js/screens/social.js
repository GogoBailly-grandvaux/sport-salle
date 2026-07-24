// screens/social.js — amis, fil d'activité, groupes, programmes partagés
import { t } from '../i18n.js';
import { esc, relDate, debounce } from '../util.js';
import { nav, ACCENTS } from '../store.js';
import { icon, sheet, toast, confirmDialog, promptDialog } from '../ui.js';
import { call, isLoggedIn, account } from '../api.js';
import { importRoutinePayload, routinePayload } from '../templates.js';
import { beginRoutine } from './routines.js';
import { listRoutines } from '../model.js';
import { emptyState, backBtn } from './common.js';
import { openAuthSheet } from './account.js';
import * as sync from '../sync.js';
import { qrSvg } from '../qr.js';
import { musclesMap } from '../data.js';

let _mm = null; // silhouettes wger (mini-heatmaps du fil)

let seg = 'feed'; // feed | amis | groupes | activite (via la cloche)
let _lastLive = []; // amis en séance (stories du fil)

const avatarHtml = (u, size = '') =>
  `<span class="avatar ${size}" style="--a:${ACCENTS[u.accent]?.hex || ACCENTS.ember.hex}">${u.avatar ? `<img class="avatar-photo" src="${esc(u.avatar)}" alt="">` : u.emoji ? esc(u.emoji) : esc((u.displayName || u.username || '?').slice(0, 1).toUpperCase())}</span>`;

const statsLine = (s) => {
  if (!s || !s.totalWorkouts) return `<span class="mut sm">Pas encore de séance</span>`;
  const bits = [];
  if (s.lastWorkoutAt) bits.push(`${esc(s.lastWorkout || t('Séance','Workout'))} · ${relDate(s.lastWorkoutAt).toLowerCase()}`);
  return `<span class="mut sm">${bits.join('')}</span>`;
};

const statChips = (s) => {
  if (!s) return '';
  return `<div class="fr-chips">
    ${s.streak ? `<span class="fr-chip hot">${icon('flame')} ${s.streak} sem</span>` : ''}
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
    if (seg === 'activite') body = await renderActivite();
    else if (seg === 'feed') body = await renderFeed();
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
    <div class="topbar-r">${isLoggedIn() ? `<button class="icon-btn bell ${seg === 'activite' ? 'on' : ''}" id="soc-bell" aria-label="${t('Activité','Activity')}">${icon('bell')}<span class="bell-dot" id="bell-dot" hidden></span></button>` : ''}</div>
  </header>`;
}

// ---------------- ACTIVITÉ (🔔) ----------------
function notifLine(n) {
  const a = n.actor;
  const who = `<b>${esc(a.displayName)}</b>`;
  const x = {
    friend_req: t(`${who} t’a envoyé une demande d’ami`, `${who} sent you a friend request`),
    friend_acc: t(`${who} a accepté ta demande`, `${who} accepted your request`),
    react: t(`${who} a réagi ${esc(n.meta || '👊')} à ton post`, `${who} reacted ${esc(n.meta || '👊')} to your post`),
    comment: t(`${who} a répondu : « ${esc(n.meta || '')} »`, `${who} replied: “${esc(n.meta || '')}”`),
    mention: t(`${who} t’a mentionné : « ${esc(n.meta || '')} »`, `${who} mentioned you: “${esc(n.meta || '')}”`),
    livesession: t(`${who} s'entraîne maintenant — rejoins la séance !`, `${who} is working out now — join in!`),
    cheer: t(`${who} t'encourage — continue !`, `${who} is cheering you on — keep going!`),
    challenge: n.meta === 'a rejoint' ? t(`${who} a rejoint ton défi`, `${who} joined your challenge`) : t(`${who} te défie cette semaine`, `${who} challenges you this week`),
  };
  return x[n.kind] || who;
}

async function renderActivite() {
  const d = await call('social', 'notifs', { markSeen: true });
  if (!d.notifs.length) {
    return emptyState('users', t('Rien pour l’instant','Nothing yet'), t('Les demandes d’ami, réactions, réponses et mentions arriveront ici.','Friend requests, reactions, replies and mentions will show up here.'), '');
  }
  return `<div class="notif-list">${d.notifs.map(n => `
    <button class="notif-row ${n.seen ? '' : 'unseen'}" data-nkind="${n.kind}" data-nref="${n.refId ?? ''}" data-nuser="${esc(n.actor.username)}">
      ${avatarHtml(n.actor)}
      <div class="notif-body"><p>${notifLine(n)}</p><span class="mut sm">${ago(n.ts)}</span></div>
      ${n.seen ? '' : '<span class="notif-dot"></span>'}
    </button>`).join('')}</div>`;
}

function wireActivite(root) {
  root.querySelectorAll('.notif-row').forEach(b => b.onclick = () => {
    const { nkind, nref, nuser } = b.dataset;
    if ((nkind === 'react' || nkind === 'comment' || nkind === 'mention') && nref) { openCommentsSheet(+nref); return; }
    if (nkind === 'livesession') { if (nref) joinLiveSession(+nref); return; }
    if (nkind === 'challenge') { nav.go('#/challenges'); return; }
    nav.go('#/u/' + nuser);
  });
  // badge éteint localement (le serveur vient de marquer lu)
  const dot = document.getElementById('bell-dot'); if (dot) dot.hidden = true;
  const tabDot = document.getElementById('soc-dot');
  if (tabDot) tabDot.hidden = true;
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

// linkifie les @mentions dans du texte DÉJÀ échappé (motif pseudo strict)
const linkify = (escaped) => escaped.replace(/(^|[\s>])@([a-z0-9_.]{3,20})/gi,
  (m, pre, u) => `${pre}<a class="mention" data-nav="#/u/${u.toLowerCase()}">@${u}</a>`);

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
      c.prs ? `<span class="fr-chip hot">${icon('trophy')} ${c.prs} PR${c.prs > 1 ? 's' : ''}</span>` : '',
    ].filter(Boolean).join('');
    let heat = '';
    if (_mm && _mm.byOurName && _mm.bodyImages && (c.muscles || []).length) {
      const side = (front) => {
        let ov = '';
        for (const m of c.muscles) for (const id of (_mm.byOurName[m] || [])) {
          const mu = _mm.byWgerId[id];
          if (mu && mu.isFront === front && mu.main) ov += `<img class="bm-overlay" src="${esc(mu.main)}" alt="" loading="lazy">`;
        }
        return `<span class="post-heat-side"><img src="${esc(front ? _mm.bodyImages.front : _mm.bodyImages.back)}" alt="" loading="lazy">${ov}</span>`;
      };
      heat = `<span class="post-heat">${side(true)}${side(false)}</span>`;
    }
    return `<div class="post-wk ${heat ? 'has-heat' : ''}">${heat}<div class="post-wk-txt"><b>${icon('dumbbell')} ${esc(c.name || t('Séance','Workout'))}</b>
      <div class="fr-chips">${chips}</div>
      ${c.note ? `<p class="post-note">${esc(c.note)}</p>` : ''}</div></div>`;
  }
  if (p.kind === 'program') {
    return `<div class="post-prog">
      <div class="post-prog-l"><b>${icon('clipboard')} ${esc(c.name || t('Programme','Program'))}</b>
      ${c.exos ? `<span class="mut sm">${c.exos} ${t('exercice','exercise')}${c.exos > 1 ? 's' : ''}</span>` : ''}</div>
      ${p.isMine ? '' : `<button class="btn primary sm" data-import="${+c.sharedId}">${icon('download')} ${t('Importer','Import')}</button>`}
    </div>`;
  }
  return `<p class="post-text">${linkify(esc(c.text || ''))}</p>`;
}

function postCard(p) {
  const a = p.author || {};
  const reacts = EMOJIS.map(e => {
    const n = (p.reactions && p.reactions[e]) || 0;
    const on = p.myReaction === e;
    return `<button class="react-chip ${on ? 'on' : ''}" data-react="${e}" data-post="${p.id}" aria-label="${t('Réagir','React')} ${e}">${e}${n ? ` <b>${n}</b>` : ''}</button>`;
  }).join('');
  const cChip = `<button class="react-chip cmt ${p.comments ? 'has' : ''}" data-comments="${p.id}" aria-label="${t('Voir les réponses','View replies')}">${icon('message')}${p.comments ? ` <b>${p.comments}</b>` : ''}</button>`;
  return `<article class="post-card" data-pid="${p.id}">
    <div class="post-head">
      <div class="post-a" data-nav="#/u/${esc(a.username || '')}" role="link" tabindex="0">
        ${avatarHtml(a)}
        <div class="post-who"><b>${esc(a.displayName || '')}${a.verified ? ` <span class="verif">${icon('check')}</span>` : ''}</b><span class="mut sm">@${esc(a.username || '')} · ${ago(p.ts)}</span></div>
      </div>
      ${p.isMine ? `<button class="icon-btn sm post-del" data-del="${p.id}" aria-label="${t('Supprimer le post','Delete post')}">${icon('trash')}</button>` : ''}
    </div>
    ${postBody(p)}
    <div class="react-bar">${reacts}${cChip}</div>
  </article>`;
}

async function renderFeed() {
  if (_mm === null) { _mm = await musclesMap().catch(() => false) || false; }
  const [d, soc, lw] = await Promise.all([call('posts', 'feed'), call('social', 'list'), call('liveworkout', 'friends').catch(() => ({ live: [] }))]);
  const { incoming, friends } = soc;
  const pending = incoming.length ? `<button class="pending-banner" data-seg-go="amis">${incoming.length} ${t('demande','friend request')}${incoming.length > 1 ? 's' : ''} ${t('d’ami en attente','pending')} ${icon('right')}</button>` : '';
  // amis en séance MAINTENANT — rangée de stories façon Instagram (anneau live)
  _lastLive = lw.live || [];
  const liveCard = _lastLive.length ? `<div class="stories-row">
    ${_lastLive.map((l, i) => {
      const mins = Math.max(1, Math.round((Date.now() - l.startedAt) / 60000));
      return `<button class="story" data-story="${i}" aria-label="${esc(l.user.displayName)} ${t('en séance','working out')}">
        <span class="story-ring">${avatarHtml(l.user, 'story')}</span>
        <span class="story-name">${esc((l.user.displayName || '').split(' ')[0])}</span>
        <span class="story-live">${mins} min</span>
      </button>`;
    }).join('')}
  </div>` : '';

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
  return pending + liveCard + composer + list;
}

function wireFeed(root) {
  // stories live : tap → fiche de la séance en cours (encourager / profil)
  root.querySelectorAll('.story').forEach(b => b.onclick = () => {
    const l = _lastLive[+b.dataset.story];
    if (!l) return;
    const mins = Math.max(1, Math.round((Date.now() - l.startedAt) / 60000));
    const s = sheet(`
      <div class="live-sheet-head">${avatarHtml(l.user)}<div><b>${esc(l.user.displayName)}</b><span class="mut sm">${esc(l.name || t('Séance','Workout'))} · ${t('depuis','for')} ${mins} min</span></div><span class="live-dot"></span></div>
      <div class="mini-stats"><div><b>${l.setsDone}</b><span>${t('séries','sets')}</span></div><div><b>${(l.volumeKg || 0).toLocaleString('fr-FR')}</b><span>kg</span></div><div><b>${mins}</b><span>min</span></div></div>
      ${l.currentEx ? `<p class="mut sm center" style="margin:10px 0 4px">${t('En ce moment','Right now')} : <b>${esc(l.currentEx)}</b></p>` : ''}
      <button class="btn primary full" data-a="cheer">${t('Encourager','Cheer')}</button>
      <button class="btn ghost full" data-a="prof">${t('Voir le profil','View profile')}</button>
    `, { title: t('En séance','Live') });
    s.root.querySelector('[data-a="cheer"]').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { await call('liveworkout', 'cheer', { userId: l.user.id }); toast(t('Encouragement envoyé !','Cheer sent!')); s.close(); }
      catch (err) { toast(err.message, { type: 'error' }); }
    };
    s.root.querySelector('[data-a="prof"]').onclick = () => { s.close(); nav.go('#/u/' + l.user.username); };
  });
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
  // double-tap = 👊 (geste Instagram) avec pop visuel
  root.querySelectorAll('.post').forEach(card => {
    let lastTap = 0;
    card.addEventListener('pointerup', (e) => {
      if (e.target.closest('button, a, [data-nav], input, textarea')) return;
      const now = Date.now();
      if (now - lastTap < 320) {
        const fist = [...card.querySelectorAll('.react-chip')].find(b => b.textContent.includes('👊'));
        if (fist && !fist.classList.contains('on')) fist.click();
        const pop = document.createElement('span');
        pop.className = 'ig-pop';
        pop.textContent = '👊';
        card.appendChild(pop);
        setTimeout(() => pop.remove(), 750);
      }
      lastTap = now;
    });
  });
  wirePosts(root);
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
}

// câblage commun des cartes de post (fil + page profil)
function wirePosts(root) {
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
  root.querySelectorAll('[data-import]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    await importShared(+b.dataset.import);
    b.disabled = false;
  });
  root.querySelectorAll('[data-comments]').forEach(b => b.onclick = () => openCommentsSheet(+b.dataset.comments));
}

// ---------------- réponses sous un post ----------------
function commentRow(c) {
  return `<div class="cmt-row" data-cid="${c.id}">
    <span data-nav="#/u/${esc(c.author.username)}">${avatarHtml(c.author, 'sm')}</span>
    <div class="cmt-body">
      <div class="cmt-head"><b data-nav="#/u/${esc(c.author.username)}">${esc(c.author.displayName)}</b>
        <span class="mut sm">· ${ago(c.ts)}</span>
        ${c.isMine ? `<button class="icon-btn sm cmt-del" data-cdel="${c.id}" aria-label="${t('Supprimer','Delete')}">${icon('trash')}</button>` : ''}
      </div>
      <p class="cmt-text">${linkify(esc(c.text))}</p>
    </div>
  </div>`;
}

function openCommentsSheet(postId) {
  const s = sheet(`
    <div class="cmt-list" id="cmt-list"><p class="mut sm center">${t('Chargement…','Loading…')}</p></div>
    <div class="cmt-composer">
      <input class="input" id="cmt-in" maxlength="300" placeholder="${t('Réponds…','Reply…')}" autocomplete="off">
      <button class="btn primary sm" id="cmt-send">${t('Envoyer','Send')}</button>
    </div>`,
    { title: t('Réponses','Replies') });
  const list = s.root.querySelector('#cmt-list');
  const input = s.root.querySelector('#cmt-in');
  const load = async () => {
    try {
      const d = await call('posts', 'comments', { postId });
      list.innerHTML = d.comments.length
        ? d.comments.map(commentRow).join('')
        : `<p class="mut sm center" style="padding:18px 0">${t('Sois le premier à répondre','Be the first to reply')}</p>`;
      list.scrollTop = list.scrollHeight;
      list.querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
        if (!(await confirmDialog({ title: t('Supprimer','Delete'), message: t('Supprimer cette réponse ?','Delete this reply?'), confirmText: t('Supprimer','Delete'), danger: true }))) return;
        try { await call('posts', 'uncomment', { commentId: +b.dataset.cdel }); load(); }
        catch (e) { toast(e.message, { type: 'error' }); }
      });
    } catch (e) { list.innerHTML = `<p class="mut sm center">${esc(e.message)}</p>`; }
  };
  const send = async () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const btn = s.root.querySelector('#cmt-send');
    btn.disabled = true;
    try { await call('posts', 'comment', { postId, text }); input.value = ''; await load(); }
    catch (e) { toast(e.message, { type: 'error' }); }
    btn.disabled = false; input.focus();
  };
  s.root.querySelector('#cmt-send').onclick = send;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  load();
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
    try { const r = await call('social', 'request', { username: b.dataset.request }); toast(r.accepted ? t('C’est fait, vous êtes amis !','Done — you’re friends!') : t('Demande envoyée ✓','Request sent ✓')); nav.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); b.disabled = false; }
  });
  root.querySelectorAll('[data-accept]').forEach(b => b.onclick = async () => {
    try { await call('social', 'respond', { userId: +b.dataset.accept, accept: true }); toast('Ami ajouté ✓'); nav.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); }
  });
  root.querySelectorAll('[data-decline]').forEach(b => b.onclick = async () => {
    try { await call('social', 'respond', { userId: +b.dataset.decline, accept: false }); nav.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); }
  });
  root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const u = JSON.parse(b.dataset.open); nav.go('#/u/' + u.username); });
  root.querySelectorAll('[data-friend]').forEach(b => b.onclick = () => { const u = JSON.parse(b.dataset.friend); nav.go('#/u/' + u.username); });
  root.querySelectorAll('[data-seg-go]').forEach(b => b.onclick = () => { seg = b.dataset.segGo; nav.refresh(); });
}

// ---------------- GROUPES ----------------
async function renderGroupes() {
  let gymCard = '';
  try {
    const g = await call('social', 'gym');
    gymCard = g.gym
      ? `<button class="card gym-card" data-nav="#/gym"><div class="recap-h"><span class="mut">${icon('building')} ${t('Ma salle','My gym')}</span>${icon('right')}</div>
          <b class="gym-name">${esc(g.gym)}</b><span class="mut sm">${g.count} ${t('membre','member')}${g.count > 1 ? 's' : ''} ${t('ici','here')}</span></button>`
      : `<button class="card gym-card empty" id="gym-set"><div class="recap-h"><span class="mut">${icon('building')} ${t('Ma salle','My gym')}</span>${icon('right')}</div>
          <b class="gym-name">${t('Indique ta salle','Set your gym')}</b><span class="mut sm">${t('et retrouve qui s’y entraîne, avec un classement','and see who trains there, with a leaderboard')}</span></button>`;
  } catch {}
  let challCard = '';
  try {
    const cl = await call('challenges', 'list');
    const pending = cl.challenges.filter(c => c.myStatus === 'pending').length;
    const active = cl.challenges.filter(c => c.active && c.myStatus === 'accepted').length;
    challCard = `<button class="card gym-card" data-nav="#/challenges"><div class="recap-h"><span class="mut">${icon('swords')} ${t('Défis entre potes','Friend challenges')}</span>${icon('right')}</div>
      <b class="gym-name">${pending ? `${pending} ${t('invitation','invite')}${pending > 1 ? 's' : ''} ⏳` : active ? `${active} ${t('défi en cours','active challenge')}${active > 1 ? 's' : ''}` : t('Lance un défi à tes amis','Challenge your friends')}</b>
      <span class="mut sm">${t('Qui fait le plus de séances / volume cette semaine ?','Who does the most workouts / volume this week?')}</span></button>`;
  } catch {}
  const d = await call('groups', 'mine');
  const cards = d.groups.map(g => `
    <button class="group-card" data-nav="#/social/group/${g.id}">
      <div class="group-ico">${icon('users')}</div>
      <div class="fr-info"><b>${esc(g.name)}</b><span class="mut sm">${g.memberCount} membre${g.memberCount > 1 ? 's' : ''}${g.isOwner ? ' · créé par toi' : ''}</span></div>
      ${icon('right')}
    </button>`).join('');
  return `
    ${gymCard}
    ${challCard}
    ${d.groups.length ? `<div class="friend-list">${cards}</div>` :
      emptyState('users', t('Aucun groupe','No groups'), t('Crée un groupe pour ta salle, ta team ou tes potes : classement hebdo et programmes partagés.','Create a group for your gym, your team or your crew: weekly leaderboard and shared programs.'), '')}
    <button class="btn primary full" id="grp-create">${icon('plus')} ${t('Créer un groupe','Create a group')}</button>
    <button class="btn ghost full" id="grp-join">Rejoindre avec un code</button>`;
}

function wireGroupes(root) {
  root.querySelector('#gym-set')?.addEventListener('click', () => openEditProfileSheet());
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

// ---------------- page profil (#/u/<pseudo>) — façon X ----------------
export async function renderUserProfile(params) {
  const username = decodeURIComponent(params.username || '').toLowerCase();
  let pr;
  try {
    pr = (await call('social', 'profile', { username })).profile;
  } catch (e) {
    return `<div class="screen-pad">${emptyState('users', t('Introuvable','Not found'), e.message || '', `<button class="btn ghost" data-nav="#/social">Social</button>`)}</div>`;
  }
  const st = pr.stats || null;
  // triptyque façon Instagram : Séances | Amis | Série
  const statBlock = `
    <div class="trip">
      <div><b>${pr.canView ? (st?.totalWorkouts ?? 0) : '—'}</b><span>${t('Séances','Workouts')}</span></div>
      <div><b>${pr.friendsCount ?? 0}</b><span>${t('Amis','Friends')}</span></div>
      <div><b>${pr.canView && st?.streak ? st.streak : '—'}</b><span>${t('Série (sem)','Streak (wk)')}</span></div>
    </div>
    ${pr.canView && (st?.weekCount || st?.weekVolume) ? `<p class="trip-sub mut sm">${st?.weekCount || 0} ${t('séances cette semaine','workouts this week')}${st?.weekVolume ? ` · ${Number(st.weekVolume).toLocaleString(t('fr-FR','en-US'))} kg` : ''}</p>` : ''}`;
  const relBtn = pr.isMe
    ? `<button class="btn ghost full" id="pr-edit">${t('Modifier mon profil','Edit my profile')}</button>`
    : pr.relation === 'friends'
      ? `<button class="btn ghost full" id="pr-friends">✓ ${t('Amis','Friends')}</button>`
      : pr.relation === 'sent'
        ? `<button class="btn ghost full" disabled>⏳ ${t('Demande envoyée','Request sent')}</button>`
        : pr.relation === 'received'
          ? `<button class="btn primary full" id="pr-accept">${t('Accepter la demande','Accept request')}</button>`
          : `<button class="btn primary full" id="pr-add">${icon('plus')} ${t('Ajouter','Add friend')}</button>`;
  const lock = !pr.canView ? `
    <div class="prof-lock">${icon('lock')} <b>${t('Compte privé','Private account')}</b>
      <p class="mut sm">${t('Ajoute','Add')} @${esc(pr.username)} ${t('pour voir ses séances, ses posts et ses programmes.','to see their workouts, posts and programs.')}</p>
    </div>` : '';
  const progs = (pr.programs || []).length ? `
    <h4 class="share-h">${icon('dumbbell')} ${t('Programmes partagés','Shared programs')}</h4>
    ${pr.programs.map(g => `<div class="share-row"><div><b>${esc(g.name)}</b><span class="mut sm">${g.downloads} import${g.downloads > 1 ? 's' : ''}</span></div>
      ${pr.isMe ? '' : `<button class="btn primary sm" data-import="${g.id}">${icon('download')} ${t('Importer','Import')}</button>`}</div>`).join('')}` : '';
  return `
    <header class="topbar">
      <div class="topbar-l">${backBtn('#/social')}</div>
      <div class="topbar-c"><h1>@${esc(pr.username)}</h1></div>
      <div class="topbar-r"><button class="icon-btn" id="pr-share" aria-label="${t('Partager le profil','Share profile')}">${icon('upload')}</button></div>
    </header>
    <div class="screen-pad">
      <div class="prof-head">
        ${avatarHtml(pr, 'big')}
        <h2 class="prof-name">${esc(pr.displayName || '')}${pr.verified ? ` <span class="verif big">${icon('check')}</span>` : ''}</h2>
        <p class="mut sm">@${esc(pr.username)} · ${pr.isPublic ? t('compte public','public account') : t('compte privé','private account')} · ${t('membre depuis','member since')} ${esc(pr.memberSince || '')}</p>
        ${pr.bio ? `<p class="prof-bio">${linkify(esc(pr.bio))}</p>` : ''}
        ${pr.instagram ? `<a class="insta-link" href="https://instagram.com/${esc(pr.instagram)}" target="_blank" rel="noopener">${icon('camera')} @${esc(pr.instagram)}</a>` : ''}
        ${statBlock}
        ${relBtn}
      </div>
      ${lock}
      ${progs}
      <div id="pr-posts">${pr.canView ? `<p class="mut sm center">${t('Chargement des posts…','Loading posts…')}</p>` : ''}</div>
    </div>`;
}

export function mountUserProfile(root, params) {
  const username = decodeURIComponent(params.username || '').toLowerCase();
  root.querySelector('#pr-add')?.addEventListener('click', async e => {
    e.target.disabled = true;
    try { const r = await call('social', 'request', { username }); toast(r.accepted ? t('Vous êtes amis !','You’re friends!') : t('Demande envoyée ✓','Request sent ✓')); nav.refresh(); }
    catch (err) { toast(err.message, { type: 'error' }); e.target.disabled = false; }
  });
  root.querySelector('#pr-accept')?.addEventListener('click', async () => {
    try {
      const sr = await call('social', 'search', { q: username });
      const u = sr.results.find(x => x.username === username);
      if (u) { await call('social', 'respond', { userId: u.id, accept: true }); toast(t('Ami ajouté ✓','Friend added ✓')); nav.refresh(); }
    } catch (err) { toast(err.message, { type: 'error' }); }
  });
  root.querySelector('#pr-friends')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: t('Retirer','Remove'), message: `${t('Retirer','Remove')} @${username} ${t('de tes amis ?','from your friends?')}`, confirmText: t('Retirer','Remove'), danger: true }))) return;
    try {
      const sr = await call('social', 'search', { q: username });
      const u = sr.results.find(x => x.username === username);
      if (u) { await call('social', 'remove', { userId: u.id }); toast(t('Retiré','Removed')); nav.refresh(); }
    } catch (err) { toast(err.message, { type: 'error' }); }
  });
  root.querySelector('#pr-edit')?.addEventListener('click', () => openEditProfileSheet());
  root.querySelector('#pr-share')?.addEventListener('click', async () => {
    const url = 'https://sportsalle.hbaillyg.fr/#/u/' + encodeURIComponent(username);
    try { if (navigator.share) { await navigator.share({ title: 'Sport Salle', text: '@' + username + ' — Sport Salle', url }); return; } }
    catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast(t('Lien copié ✓','Link copied ✓')); }
    catch { toast(url, { duration: 6000 }); }
  });
  // posts du profil (chargés après le premier rendu)
  (async () => {
    const host = root.querySelector('#pr-posts');
    if (!host || !host.innerHTML.trim()) return;
    try {
      const d = await call('posts', 'of', { username });
      host.innerHTML = d.posts.length
        ? `<h4 class="share-h">Posts</h4><div class="feed-list">${d.posts.map(postCard).join('')}</div>`
        : `<p class="mut sm center" style="margin-top:18px">${t('Aucun post pour l’instant.','No posts yet.')}</p>`;
      wirePosts(host);
    } catch (e) { host.innerHTML = `<p class="mut sm center">${esc(e.message)}</p>`; }
  })();
}

// ---------------- édition du profil public (bio, confidentialité) ----------------
export function openEditProfileSheet(onDone = null) {
  const acc = account();
  if (!acc) return;
  const s = sheet(`
    <label class="field-label" for="ep-name">${t('Nom affiché','Display name')}</label>
    <input class="input" id="ep-name" maxlength="40" value="${esc(acc.user.displayName || '')}">
    <label class="field-label" for="ep-bio">Bio · ${t('160 caractères, visible par tous','160 chars, visible to everyone')}</label>
    <textarea class="input" id="ep-bio" rows="3" maxlength="160" placeholder="${t('Ex. Push/pull/legs · objectif -20 kg','E.g. Push/pull/legs · chasing -20 kg')}"></textarea>
    <label class="field-label" for="ep-gym">${t('Ma salle','My gym')} · ${t('retrouve les gens de ta salle','find people at your gym')}</label>
    <input class="input" id="ep-gym" maxlength="80" placeholder="${t('Ex. Gold’s Gym Serris','E.g. Gold’s Gym')}">
    <label class="field-label" for="ep-insta">Instagram · ${t('affiché sur ton profil','shown on your profile')}</label>
    <input class="input" id="ep-insta" maxlength="30" placeholder="${t('ton pseudo, sans le @','your handle, without @')}">
    <div class="setting" style="margin-top:12px"><span>${t('Compte public','Public account')}<br><span class="mut sm">${t('Activé : tout le monde voit tes posts et stats. Désactivé : tes amis uniquement.','On: anyone sees your posts and stats. Off: friends only.')}</span></span>
      <button class="switch" id="ep-pub" role="switch" aria-checked="false"><span></span></button></div>
    <button class="btn primary full" id="ep-save">${t('Enregistrer','Save')}</button>`,
    { title: t('Mon profil public','My public profile') });
  // précharger bio + confidentialité actuelles
  (async () => {
    try {
      const pr = (await call('social', 'profile', { username: acc.user.username })).profile;
      const bio = s.root.querySelector('#ep-bio'); if (bio && pr.bio) bio.value = pr.bio;
      const gym = s.root.querySelector('#ep-gym'); if (gym && pr.gym) gym.value = pr.gym;
      const ig = s.root.querySelector('#ep-insta'); if (ig && pr.instagram) ig.value = pr.instagram;
      const sw = s.root.querySelector('#ep-pub');
      if (sw && pr.isPublic) { sw.classList.add('on'); sw.setAttribute('aria-checked', 'true'); }
    } catch {}
  })();
  const sw = s.root.querySelector('#ep-pub');
  sw.onclick = () => { const on = sw.classList.toggle('on'); sw.setAttribute('aria-checked', String(on)); };
  s.root.querySelector('#ep-save').onclick = async () => {
    const btn = s.root.querySelector('#ep-save');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      await call('auth', 'profile_update', {
        displayName: s.root.querySelector('#ep-name').value.trim(),
        bio: s.root.querySelector('#ep-bio').value.trim(),
        emoji: acc.user.emoji || '',
        accent: acc.user.accent || 'ember',
        privacy: sw.classList.contains('on') ? 'public' : 'friends',
        gym: s.root.querySelector('#ep-gym').value.trim(),
        instagram: s.root.querySelector('#ep-insta').value.trim(),
      });
      // rafraîchir le cache local du compte (nom affiché)
      const { savePSettings } = await import('../store.js');
      const a = account(); a.user.displayName = s.root.querySelector('#ep-name').value.trim();
      await savePSettings({ account: a });
      s.close(); toast(t('Profil mis à jour ✓','Profile updated ✓'));
      if (onDone) onDone(); else nav.refresh();
    } catch (e) {
      toast(e.message, { type: 'error' });
      btn.disabled = false; btn.textContent = t('Enregistrer','Save');
    }
  };
}

// ---------------- « Ma salle » : classement des gens de ta salle ----------------
// Répertoire des salles (comptes publics)
export async function renderGyms() {
  return `<header class="topbar"><div class="topbar-l">${backBtn('#/social')}</div>
      <div class="topbar-c"><h1>${t('Salles de sport','Gyms')}</h1></div><div class="topbar-r"></div></header>
    <div class="screen-pad">
      <div class="input-ico search-friend">${icon('search')}<input class="input" id="gyms-q" placeholder="${t('Chercher une salle','Search a gym')}" autocomplete="off"></div>
      <p class="mut sm">${t('Les salles avec des membres en compte public. Rends ton compte public pour y apparaître.','Gyms with members on public accounts. Make your account public to appear here.')}</p>
      <div id="gyms-list"></div></div>`;
}
export function mountGyms(root) {
  const list = root.querySelector('#gyms-list');
  const load = async (q = '') => {
    try {
      const d = await call('social', 'gyms', { q });
      list.innerHTML = d.gyms.length ? d.gyms.map(g => `
        <button class="gym-row" data-nav="#/gym/${encodeURIComponent(g.key)}">
          <span class="gym-ico2">${icon('building')}</span>
          <div class="fr-info"><b>${esc(g.gym)}</b><span class="mut sm">${g.count} ${t('membre','member')}${g.count > 1 ? 's' : ''} ${t('en public','public')}</span></div>
          ${icon('right')}</button>`).join('')
        : `<p class="mut sm center" style="margin-top:24px">${q ? t('Aucune salle trouvée.','No gym found.') : t('Aucune salle publique pour l’instant — sois le premier !','No public gyms yet — be the first!')}</p>`;
    } catch (e) { list.innerHTML = `<p class="mut sm center">${esc(e.message)}</p>`; }
  };
  root.querySelector('#gyms-q').addEventListener('input', debounce(e => load(e.target.value.trim()), 250));
  load();
}

export async function renderGym(params = {}) {
  const key = params.key ? decodeURIComponent(params.key) : null;
  let d;
  try { d = await call('social', 'gym', key ? { key } : {}); }
  catch (e) { return `<div class="screen-pad">${emptyState('users', t('Oups','Oops'), e.message || '', `<button class="btn ghost" data-nav="#/social">Social</button>`)}</div>`; }
  const mine = d.isMine;
  const back = mine ? '#/social' : '#/gyms';
  const head = `<header class="topbar"><div class="topbar-l">${backBtn(back)}</div>
    <div class="topbar-c"><h1>${mine ? t('Ma salle','My gym') : esc(d.gym || t('Salle','Gym'))}</h1>${mine && d.gym ? `<span class="topbar-sub">${esc(d.gym)}</span>` : ''}</div>
    <div class="topbar-r">${mine ? `<button class="icon-btn" id="gym-edit" aria-label="${t('Changer de salle','Change gym')}">${icon('edit')}</button>` : ''}</div></header>`;
  if (!d.gym && mine) {
    return `${head}<div class="screen-pad">${emptyState('users', t('Ta salle n’est pas renseignée','No gym set yet'), t('Indique ta salle pour voir qui s’y entraîne et te comparer.','Set your gym to see who trains there and compare.'), `<button class="btn primary" id="gym-set2">${t('Indiquer ma salle','Set my gym')}</button><button class="btn ghost full" data-nav="#/gyms">${icon('building')} ${t('Parcourir les salles','Browse gyms')}</button>`)}</div>`;
  }
  if (!d.members.length) {
    return `${head}<div class="screen-pad">${emptyState('users', esc(d.gym || ''), t('Personne de public ici pour l’instant.','No public members here yet.'), '')}</div>`;
  }
  const rows = d.members.map((m, i) => {
    const s = m.stats;
    const rankCls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
    return `<button class="gym-row ${m.isMe ? 'me' : ''}" ${m.isMe ? '' : `data-nav="#/u/${esc(m.username)}"`}>
      <span class="gym-rank ${rankCls}">${i + 1}</span>
      ${avatarHtml(m)}
      <div class="fr-info"><b>${esc(m.displayName)}${m.isMe ? ` · ${t('toi','you')}` : ''}</b>
        <span class="mut sm">${s?.weekCount || 0} ${t('séance','workout')}${(s?.weekCount || 0) > 1 ? 's' : ''} · ${s?.weekVolume ? Number(s.weekVolume).toLocaleString(t('fr-FR','en-US')) + ' kg' : '—'}</span></div>
      ${s?.streak ? `<span class="fr-chip hot">${icon('flame')} ${s.streak}</span>` : ''}
    </button>`;
  }).join('');
  return `${head}<div class="screen-pad">
    <p class="mut sm center" style="margin:2px 0 12px">${t('Classement de la semaine · séances puis volume','This week’s ranking · workouts then volume')}</p>
    <div class="friend-list">${rows}</div>
    ${mine ? `<button class="btn ghost full" style="margin-top:12px" data-nav="#/gyms">${icon('building')} ${t('Parcourir les salles','Browse gyms')}</button>` : ''}</div>`;
}
export function mountGym(root) {
  root.querySelector('#gym-edit')?.addEventListener('click', () => openEditProfileSheet());
  root.querySelector('#gym-set2')?.addEventListener('click', () => openEditProfileSheet());
}

// ---------------- défis entre potes ----------------
const metricLabel = (m) => m === 'volume' ? t('Le plus de volume','Most volume') : t('Le plus de séances','Most workouts');
const scoreLabel = (m, v) => m === 'volume' ? `${Number(v).toLocaleString(t('fr-FR','en-US'))} kg` : `${v} ${t('séance','workout')}${v > 1 ? 's' : ''}`;

function challengeCard(c) {
  const rows = c.ranking.map((u, i) => {
    const rankCls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
    const me = u.username === account()?.user?.username;
    return `<div class="ch-row ${me ? 'me' : ''}"><span class="gym-rank ${rankCls}">${i + 1}</span>${avatarHtml(u)}
      <div class="fr-info"><b>${esc(u.displayName)}${me ? ` · ${t('toi','you')}` : ''}</b></div>
      <b class="ch-score">${scoreLabel(c.metric, u.score)}</b></div>`;
  }).join('');
  const state = c.active ? `<span class="ch-tag live">● ${t('en cours','live')}</span>` : `<span class="ch-tag">${t('terminé','ended')}</span>`;
  return `<section class="card ch-card">
    <div class="ch-head"><div><b>${metricLabel(c.metric)}</b><span class="mut sm"> · ${t('cette semaine','this week')}</span></div>${state}</div>
    <div class="ch-board">${rows || `<p class="mut sm">${t('En attente des participants…','Waiting for participants…')}</p>`}</div>
    <button class="btn ghost full sm ch-leave" data-leave="${c.id}">${c.isCreator ? t('Annuler le défi','Cancel challenge') : t('Quitter','Leave')}</button>
  </section>`;
}

export async function renderChallenges() {
  let d;
  try { d = await call('challenges', 'list'); }
  catch (e) { return `<div class="screen-pad">${emptyState('users', t('Oups','Oops'), e.message || '', `<button class="btn ghost" data-nav="#/social">Social</button>`)}</div>`; }
  const invites = d.challenges.filter(c => c.myStatus === 'pending');
  const active = d.challenges.filter(c => c.myStatus === 'accepted' && c.active);
  const past = d.challenges.filter(c => c.myStatus === 'accepted' && !c.active);
  const head = `<header class="topbar"><div class="topbar-l">${backBtn('#/social')}</div>
    <div class="topbar-c"><h1>${t('Défis','Challenges')}</h1></div><div class="topbar-r"></div></header>`;
  const inviteBlock = invites.map(c => `<section class="card ch-invite">
    <p><b>${metricLabel(c.metric)}</b> · ${t('on te défie cette semaine !','you’re challenged this week!')}</p>
    <div class="ch-invite-act"><button class="btn primary sm" data-accept="${c.id}">${t('Relever le défi','Accept')}</button>
      <button class="btn ghost sm" data-decline="${c.id}">${t('Non merci','No thanks')}</button></div></section>`).join('');
  const body = (invites.length || active.length || past.length)
    ? `${inviteBlock}${active.map(challengeCard).join('')}${past.length ? `<h4 class="share-h">${t('Terminés','Ended')}</h4>${past.map(challengeCard).join('')}` : ''}`
    : emptyState('users', t('Aucun défi','No challenges'), t('Lance un défi à tes amis et voyez qui bosse le plus cette semaine.','Challenge your friends and see who trains the most this week.'), '');
  return `${head}<div class="screen-pad">
    <button class="btn primary full" id="ch-new">${icon('swords')} ${t('Lancer un défi','Start a challenge')}</button>
    ${body}</div>`;
}

export function mountChallenges(root) {
  root.querySelector('#ch-new')?.addEventListener('click', openCreateChallengeSheet);
  root.querySelectorAll('[data-accept]').forEach(b => b.onclick = async () => {
    try { await call('challenges', 'respond', { challengeId: +b.dataset.accept, accept: true }); toast(t('Défi relevé ✓','Challenge accepted ✓')); nav.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); }
  });
  root.querySelectorAll('[data-decline]').forEach(b => b.onclick = async () => {
    try { await call('challenges', 'respond', { challengeId: +b.dataset.decline, accept: false }); nav.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); }
  });
  root.querySelectorAll('[data-leave]').forEach(b => b.onclick = async () => {
    if (!(await confirmDialog({ title: t('Quitter','Leave'), message: t('Quitter ce défi ?','Leave this challenge?'), confirmText: t('Quitter','Leave'), danger: true }))) return;
    try { await call('challenges', 'leave', { challengeId: +b.dataset.leave }); toast(t('Fait','Done')); nav.refresh(); }
    catch (e) { toast(e.message, { type: 'error' }); }
  });
}

async function openCreateChallengeSheet() {
  let friends = [];
  try { friends = (await call('social', 'list')).friends || []; } catch {}
  if (!friends.length) { toast(t('Ajoute d’abord des amis pour les défier','Add friends first to challenge them')); return; }
  let metric = 'workouts';
  const s = sheet(`
    <label class="field-label">${t('Sur quoi ?','On what?')}</label>
    <div class="segmented" id="ch-metric">
      <button class="seg on" data-m="workouts">${icon('flame')} ${t('Séances','Workouts')}</button>
      <button class="seg" data-m="volume">${icon('scale')} ${t('Volume','Volume')}</button></div>
    <label class="field-label">${t('Qui défies-tu ?','Who do you challenge?')}</label>
    <div class="ch-friends">${friends.map(f => `<label class="ch-friend"><input type="checkbox" value="${f.id}"><span>${avatarHtml(f)} ${esc(f.displayName)}</span></label>`).join('')}</div>
    <button class="btn primary full" id="ch-go">${icon('swords')} ${t('Lancer le défi','Start the challenge')}</button>`,
    { title: t('Nouveau défi','New challenge') });
  s.root.querySelectorAll('#ch-metric .seg').forEach(b => b.onclick = () => {
    metric = b.dataset.m; s.root.querySelectorAll('#ch-metric .seg').forEach(x => x.classList.toggle('on', x === b));
  });
  s.root.querySelector('#ch-go').onclick = async () => {
    const friendIds = [...s.root.querySelectorAll('.ch-friends input:checked')].map(i => +i.value);
    if (!friendIds.length) { toast(t('Choisis au moins un ami','Pick at least one friend')); return; }
    const btn = s.root.querySelector('#ch-go'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try { await call('challenges', 'create', { metric, friendIds }); s.close(); toast(t('Défi lancé !','Challenge started!')); nav.go('#/challenges'); }
    catch (e) { toast(e.message, { type: 'error' }); btn.disabled = false; btn.textContent = t('Lancer le défi','Start'); }
  };
}

// ---------------- deep link : #/add/<pseudo> (depuis un QR scanné) ----------------
export function renderAddFriend(params) {
  const u = decodeURIComponent(params.username || '').toLowerCase();
  return `<div class="screen-pad"><div class="add-land">
    <div class="add-land-ico">${icon('users')}</div>
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
      toast(r.accepted ? t('C’est fait, vous êtes amis !','Done — you’re friends!') : t('Demande envoyée à','Request sent to') + ' @' + u + ' ✓', { duration: 4000 });
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
  root.querySelector('#soc-bell')?.addEventListener('click', () => { seg = seg === 'activite' ? 'feed' : 'activite'; nav.refresh(); });
  wireActions(root);
  if (seg === 'activite') wireActivite(root);
  if (seg === 'feed') wireFeed(root);
  if (seg === 'amis') wireAmis(root);
  if (seg === 'groupes') wireGroupes(root);
}

// ---------------- détail d'un groupe ----------------
export async function renderGroup(params) {
  try {
    const d = await call('groups', 'detail', { groupId: +params.id });
    const progs = await call('programs', 'ofGroup', { groupId: +params.id });
        const rows = d.members.map((m, i) => `
      <div class="lb-row ${i < 3 && (m.stats?.weekCount || 0) > 0 ? 'top' : ''}">
        <span class="lb-rank ${(m.stats?.weekCount || 0) > 0 && i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span>
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
        <section class="card"><h3 class="card-t">${icon('trophy')} ${t('Classement de la semaine','This week’s leaderboard')}</h3><div class="lb-list">${rows}</div></section>
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


// ---- séance de groupe : créer (invite des amis) & rejoindre ----
export async function openGroupSessionSheet() {
  if (!isLoggedIn()) { openAuthSheet(); return; }
  const [soc, routines] = await Promise.all([call('social', 'list'), listRoutines()]);
  if (!soc.friends.length) { toast(t('Ajoute d’abord des amis.','Add friends first.')); return; }
  const s = sheet(`
    <p class="mut sm">${t('Choisis un programme (ou séance libre), invite tes potes — ils te rejoignent en un tap, avec ton programme ou le leur.','Pick a program (or free workout), invite friends — they join in one tap, with your program or their own.')}</p>
    <select class="input select" id="gs-routine"><option value="">${t('Séance libre','Free workout')}</option>${routines.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
    <div class="gs-friends">${soc.friends.map(f => `<label class="gs-friend"><input type="checkbox" value="${f.id}"> ${esc(f.displayName)}</label>`).join('')}</div>
    <button class="btn primary full" id="gs-go">${t('Lancer la séance à plusieurs','Start group workout')}</button>
  `, { title: t('Séance à plusieurs','Group workout') });
  s.root.querySelector('#gs-go').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const rid = s.root.querySelector('#gs-routine').value;
      const friendIds = [...s.root.querySelectorAll('.gs-friends input:checked')].map(i => +i.value);
      const r = rid ? (await listRoutines()).find(x => x.id === rid) : null;
      const res = await call('liveworkout', 'create_session', {
        name: r ? r.name : t('Séance libre','Free workout'),
        routine: r ? routinePayload(r) : undefined,
        friendIds,
      });
      localStorage.setItem('ss-join-session', String(res.sessionId));
      s.close();
      if (r) { await beginRoutine(r); }
      else { const m = await import('../model.js'); const w = await m.startWorkout({}); nav.go('#/workout/' + w.id); }
    } catch (err) { toast(err.message, { type: 'error' }); btn.disabled = false; btn.textContent = t('Lancer la séance à plusieurs','Start group workout'); }
  };
}

export async function joinLiveSession(sessionId) {
  try {
    const d = await call('liveworkout', 'join_session', { sessionId: +sessionId });
    const s = sheet(`
      <p class="mut sm"><b>${esc(d.creator.displayName)}</b> ${t('s’entraîne en ce moment','is working out right now')}${d.name ? ` — « ${esc(d.name)} »` : ''}.</p>
      ${d.routine ? `<button class="btn primary full" id="js-same">${t('Suivre son programme','Follow their program')}</button>` : ''}
      <button class="btn ${d.routine ? 'ghost' : 'primary'} full" id="js-own">${t('Ma propre séance','My own workout')}</button>
    `, { title: t('Rejoindre la séance','Join the workout') });
    const start = async (useRoutine) => {
      localStorage.setItem('ss-join-session', String(d.sessionId));
      s.close();
      if (useRoutine) { const r = await importRoutinePayload(d.routine); await beginRoutine(r); }
      else { const m = await import('../model.js'); const w = await m.startWorkout({}); nav.go('#/workout/' + w.id); }
    };
    s.root.querySelector('#js-same')?.addEventListener('click', () => start(true));
    s.root.querySelector('#js-own').addEventListener('click', () => start(false));
  } catch (e) { toast(e.message, { type: 'error' }); }
}
