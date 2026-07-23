// app.js — boot, router, tab bar, service worker, onboarding
import { $, esc } from './util.js';
import {
  state, nav, emit, on, applyTheme, ACCENTS,
  loadGlobal, saveGlobal, loadProfiles, loadPSettings, createProfile, setActiveProfile, activeProfile, accentHex,
} from './store.js';
import * as db from './db.js';
import { loadLibrary } from './data.js';
import { icon, toast } from './ui.js';
import { getActiveWorkout, startWorkout, listRoutines, getRoutine } from './model.js';
import { sheet } from './ui.js';
import * as sync from './sync.js';

import * as home from './screens/home.js';
import * as routines from './screens/routines.js';
import * as workout from './screens/workout.js';
import * as history from './screens/history.js';
import * as progress from './screens/progress.js';
import * as library from './screens/library.js';
import * as profile from './screens/profile.js';
import * as social from './screens/social.js';
import { wireAuthEvents, openAuthSheet } from './screens/account.js';
import { gate as appLockGate } from './applock.js';

// ---------- routes ----------
const R = [
  { p:'#/home', name:'home', tab:'home', render:home.render, mount:home.mount },
  { p:'#/routines', name:'routines', tab:'routines', render:routines.renderList, mount:routines.mountList },
  { p:'#/routines/:id/edit', name:'routine-edit', render:routines.renderEdit, mount:routines.mountEdit },
  { p:'#/library', name:'library', render:library.renderList, mount:library.mountList },
  { p:'#/library/:id', name:'library-detail', render:library.renderDetail, mount:library.mountDetail },
  { p:'#/workout/:id/summary', name:'summary', immersive:true, render:workout.renderSummary, mount:workout.mountSummary },
  { p:'#/workout/:id', name:'workout', immersive:true, render:workout.render, mount:workout.mount, unmount:workout.unmount },
  { p:'#/history', name:'history', render:history.renderList, mount:history.mountList },
  { p:'#/history/:id', name:'history-detail', render:history.renderDetail, mount:history.mountDetail },
  { p:'#/progress', name:'progress', tab:'progress', render:progress.renderHub, mount:progress.mountHub },
  { p:'#/progress/exercise/:id', name:'progress-ex', render:progress.renderExercise, mount:progress.mountExercise },
  { p:'#/progress/body', name:'progress-body', render:progress.renderBody, mount:progress.mountBody },
  { p:'#/social', name:'social', tab:'social', render:social.render, mount:social.mount },
  { p:'#/social/group/:id', name:'social-group', render:social.renderGroup, mount:social.mountGroup },
  { p:'#/profile', name:'profile', render:profile.render, mount:profile.mount },
].map(r => {
  const keys = []; const rx = new RegExp('^' + r.p.replace(/:[^/]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  return { ...r, rx, keys };
});

function match(hash) {
  for (const r of R) {
    const m = r.rx.exec(hash);
    if (m) { const params = {}; r.keys.forEach((k, i) => params[k] = m[i + 1]); return { r, params }; }
  }
  return null;
}

let current = null;
async function router(isRefresh = false) {
  let hash = location.hash || '#/home';
  const found = match(hash) || match('#/home');
  const { r, params } = found;
  nav.current = r.name;
  if (current && current.unmount) { try { current.unmount(); } catch {} }
  const view = $('#view');
  view.classList.add('fade');
  try {
    const html = await r.render(params);
    view.innerHTML = html;
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="screen-pad"><div class="empty"><h3>Oups</h3><p>${esc(e.message||'Erreur')}</p><button class="btn ghost" onclick="location.hash='#/home'">Accueil</button></div></div>`;
  }
  requestAnimationFrame(() => view.classList.remove('fade'));
  current = r;
  try { r.mount && r.mount(view, params); } catch (e) { console.error(e); }
  document.body.classList.toggle('immersive', !!r.immersive);
  updateTabs(r.tab);
  if (!isRefresh) window.scrollTo(0, 0);
}

nav.go = (hash) => { if (location.hash === hash) router(); else location.hash = hash; };
nav.refresh = () => router(true);

// ---------- tab bar ----------
function tabBar() {
  const tabs = [
    { id:'home', label:'Accueil', icon:'home', hash:'#/home' },
    { id:'routines', label:'Programmes', icon:'dumbbell', hash:'#/routines' },
    { id:'fab' },
    { id:'social', label:'Social', icon:'users', hash:'#/social' },
    { id:'progress', label:'Progrès', icon:'chart', hash:'#/progress' },
  ];
  return `<nav class="tabbar" id="tabbar">${tabs.map(t => t.id === 'fab'
    ? `<button class="fab" id="fab" aria-label="Démarrer une séance">${icon('bolt')}</button>`
    : `<button class="tab" data-tab="${t.id}" data-nav="${t.hash}"><span class="tab-ico">${icon(t.icon)}</span><span>${t.label}</span></button>`
  ).join('')}</nav>`;
}
function updateTabs(active) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === active));
}

async function fabAction() {
  const active = await getActiveWorkout();
  if (active) { nav.go(`#/workout/${active.id}`); return; }
  const rs = await listRoutines();
  const body = `<button class="menu-row big" id="fab-empty">${icon('play')} Séance libre</button>
    ${rs.length ? `<div class="fab-sep">ou un programme</div>` + rs.map(r => `<button class="menu-row" data-r="${r.id}">${icon('dumbbell')} ${esc(r.name)} <span class="mut sm">${(r.items||[]).length} exos</span></button>`).join('') : `<p class="mut sm center">Aucun programme. <a data-nav="#/routines">En créer un</a></p>`}`;
  const s = sheet(body, { title: 'Démarrer' });
  s.root.querySelector('#fab-empty').onclick = async () => { s.close(); const w = await startWorkout({}); nav.go(`#/workout/${w.id}`); };
  s.root.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => {
    s.close(); const r = await getRoutine(b.dataset.r);
    if (!(r.items||[]).length) { toast('Programme vide'); nav.go(`#/routines/${r.id}/edit`); return; }
    routines.beginRoutine(r);
  });
}

// ---------- écran de bienvenue (premier lancement) ----------
function welcome() {
  return new Promise(resolve => {
    const view = $('#view');
    const online = sync.isConfigured();
    view.innerHTML = `<div class="welcome">
      <div class="wel-halo"></div>
      <div class="wel-body">
        <div class="wel-logo">${icon('bolt')}</div>
        <h1 class="wel-title">SPORT<span>SALLE</span></h1>
        <p class="wel-tag">Ton coach de poche.<br>Programmes, séances, records, amis.</p>
        <div class="wel-actions">
          ${online ? `
          <button class="btn primary full big" id="wel-register">Créer un compte gratuit</button>
          <button class="btn ghost full" id="wel-login">J'ai déjà un compte</button>
          <button class="wel-guest" id="wel-guest">Continuer sans compte →</button>`
          : `<button class="btn primary full big" id="wel-guest">Commencer</button>`}
        </div>
        <p class="wel-foot">Gratuit · sans pub · tes données t'appartiennent</p>
      </div>
    </div>`;
    const done = () => resolve();
    view.querySelector('#wel-register')?.addEventListener('click', () => openAuthSheet('register', done));
    view.querySelector('#wel-login')?.addEventListener('click', () => openAuthSheet('login', done));
    view.querySelector('#wel-guest')?.addEventListener('click', async () => { await onboarding(); done(); });
  });
}

// ---------- onboarding local (sans compte) ----------
export const AVATAR_EMOJIS = ['💪','🏋️','🔥','⚡','🚀','🦁','🐺','😤','🌸','👑','🎯','🥇'];

function onboarding() {
  return new Promise(resolve => {
    const view = $('#view');
    view.innerHTML = `<div class="onboard">
      <div class="onboard-icon">${icon('bolt')}</div>
      <h1>Sport Salle</h1>
      <p>Ton coach de poche pour la salle : programmes, séances, records et progression. Crée ton profil — chaque personne qui utilise ce téléphone peut avoir le sien.</p>
      <label class="field-label">Ton prénom</label>
      <input class="input" id="ob-name" placeholder="Prénom" autocomplete="given-name">
      <label class="field-label">Ta couleur</label>
      <div class="accent-pick" id="ob-accent">${Object.entries(ACCENTS).map(([k,v],i)=>`<button class="accent-dot ${i===0?'sel':''}" data-a="${k}" style="--a:${v.hex}"></button>`).join('')}</div>
      <label class="field-label">Ton avatar (optionnel)</label>
      <div class="emoji-pick" id="ob-emoji">${AVATAR_EMOJIS.map(e=>`<button class="emoji-dot" data-e="${e}">${e}</button>`).join('')}</div>
      <button class="btn primary full big" id="ob-go">Commencer ${icon('right')}</button>
    </div>`;
    let accent = Object.keys(ACCENTS)[0];
    let emoji = null;
    view.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { accent = b.dataset.a; view.querySelectorAll('[data-a]').forEach(x=>x.classList.toggle('sel',x===b)); });
    view.querySelectorAll('[data-e]').forEach(b => b.onclick = () => {
      const was = b.classList.contains('sel');
      view.querySelectorAll('[data-e]').forEach(x=>x.classList.remove('sel'));
      emoji = was ? null : b.dataset.e;
      if (!was) b.classList.add('sel');
    });
    view.querySelector('#ob-go').onclick = async () => {
      const name = view.querySelector('#ob-name').value.trim() || 'Athlète';
      const p = await createProfile({ name, accent, emoji });
      await setActiveProfile(p.id);
      resolve();
    };
  });
}

// ---------- service worker ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller; // false = toute 1re visite (le claim() n'est pas une mise à jour)
  let userRequestedUpdate = false;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Mise à jour disponible', { actionText: 'Recharger', duration: 8000, onAction: () => { userRequestedUpdate = true; nw.postMessage('skipWaiting'); } });
        }
      });
    });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController && !userRequestedUpdate) return; // 1re prise de contrôle : pas de reload surprise
    if (!reloading) { reloading = true; location.reload(); }
  });
}

// ---------- boot ----------
async function boot() {
  try {
    if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch {} }
    await db.openDB();
    await loadGlobal();
    await appLockGate(); // verrou biométrique éventuel (avant d'afficher quoi que ce soit)
    wireAuthEvents();
    await loadProfiles();
    await loadLibrary();

    document.body.insertAdjacentHTML('beforeend', tabBar());
    document.getElementById('fab').onclick = fabAction;
    $('#splash')?.remove();

    await sync.init(); // avant le premier rendu : l'écran Profil sait si la synchro existe

    if (!state.profiles.length) { await welcome(); }
    else {
      const active = state.global.activeProfileId && state.profiles.find(p => p.id === state.global.activeProfileId);
      await setActiveProfile(active ? active.id : state.profiles[0].id);
    }
    applyTheme();

    window.addEventListener('hashchange', () => router());
    await router();

    // resume banner if a session is in progress but we're on home
    const act = await getActiveWorkout();
    if (act && (location.hash === '#/home' || location.hash === '' )) {/* home already shows resume */}

    // à la réception de données synchronisées, on rafraîchit l'écran courant
    // (jamais en pleine séance : on ne casse pas la saisie en cours)
    on('sync-applied', () => {
      if (nav.current !== 'workout' && nav.current !== 'summary') nav.refresh();
    });

    registerSW();
    $('#splash')?.remove();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="screen-pad"><div class="empty"><h3>Erreur au démarrage</h3><p>${esc(e.message||e)}</p></div></div>`;
    $('#splash')?.remove();
  }
}

// global navigation via [data-nav]
document.addEventListener('click', e => {
  const t = e.target.closest('[data-nav]');
  if (!t) return;
  const inp = e.target.closest('input,textarea,select');
  if (inp) return;
  e.preventDefault();
  nav.go(t.dataset.nav);
});

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__deferredInstall = e; });
window.addEventListener('appinstalled', () => { window.__deferredInstall = null; });
on('profile-changed', () => { /* refresh handled by callers */ });

boot();
