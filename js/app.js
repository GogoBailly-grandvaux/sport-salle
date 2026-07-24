// app.js — boot, router, tab bar, service worker, onboarding
import { t } from './i18n.js';
import { $, esc } from './util.js';
import {
  state, nav, emit, on, applyTheme, ACCENTS, ps,
  loadGlobal, saveGlobal, loadProfiles, loadPSettings, createProfile, setActiveProfile, activeProfile, accentHex,
} from './store.js';
import * as db from './db.js';
import { loadLibrary } from './data.js';
import { icon, toast } from './ui.js';
import { getActiveWorkout, startWorkout, listRoutines, getRoutine } from './model.js';
import { sheet } from './ui.js';
import * as sync from './sync.js';
import * as live from './live.js';

import * as home from './screens/home.js';
import * as routines from './screens/routines.js';
import * as workout from './screens/workout.js';
import * as history from './screens/history.js';
import * as progress from './screens/progress.js';
import * as library from './screens/library.js';
import * as profile from './screens/profile.js';
import * as social from './screens/social.js';
import * as coachGen from './screens/coach-gen.js';
import { wireAuthEvents, openAuthSheet, mountGoogleButton } from './screens/account.js';
import { gate as appLockGate } from './applock.js';

// ---------- routes ----------
const R = [
  { p:'#/home', name:'home', tab:'home', render:home.render, mount:home.mount },
  { p:'#/routines', name:'routines', tab:'routines', render:routines.renderList, mount:routines.mountList },
  { p:'#/coach', name:'coach-gen', immersive:true, render:coachGen.render, mount:coachGen.mount },
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
  { p:'#/add/:username', name:'add-friend', render:social.renderAddFriend, mount:social.mountAddFriend },
  { p:'#/u/:username', name:'user-profile', render:social.renderUserProfile, mount:social.mountUserProfile },
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
  let html;
  try {
    html = await r.render(params);
  } catch (e) {
    console.error(e);
    html = `<div class="screen-pad"><div class="empty"><h3>${t('Oups','Oops')}</h3><p>${esc(e.message||'Erreur')}</p><button class="btn ghost" onclick="location.hash='#/home'">${t('Accueil','Home')}</button></div></div>`;
  }
  current = r;
  const apply = () => {
    view.innerHTML = html;
    try { r.mount && r.mount(view, params); } catch (e) { console.error(e); }
    document.body.classList.toggle('immersive', !!r.immersive);
    updateTabs(r.tab);
    if (!isRefresh) window.scrollTo(0, 0);
  };
  // Transition de vue : API View Transitions si dispo, sinon animation CSS d'entrée.
  // Les refresh (nav.refresh, synchro) restent instantanés pour ne pas faire clignoter l'écran.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!isRefresh && !reduced && document.startViewTransition) {
    document.startViewTransition(apply);
  } else {
    apply();
    if (!isRefresh && !reduced) { view.classList.remove('view-in'); void view.offsetWidth; view.classList.add('view-in'); }
  }
}

nav.go = (hash) => { if (location.hash === hash) router(); else location.hash = hash; };
nav.refresh = () => router(true);

// ---------- tab bar ----------
function tabBar() {
  const tabs = [
    { id:'home', label:t('Accueil','Home'), icon:'home', hash:'#/home' },
    { id:'routines', label:t('Programmes','Programs'), icon:'dumbbell', hash:'#/routines' },
    { id:'fab' },
    { id:'social', label:'Social', icon:'users', hash:'#/social' },
    { id:'progress', label:t('Progrès','Progress'), icon:'chart', hash:'#/progress' },
  ];
  const fabLabel = t('Démarrer une séance','Start a workout');
  return `<nav class="tabbar" id="tabbar">${tabs.map(tb => tb.id === 'fab'
    ? `<button class="fab" id="fab" aria-label="${fabLabel}">${icon('bolt')}</button>`
    : `<button class="tab" data-tab="${tb.id}" data-nav="${tb.hash}"><span class="tab-ico">${icon(tb.icon)}${tb.id === 'social' ? '<span class="tab-dot" id="soc-dot" hidden></span>' : ''}</span><span>${tb.label}</span></button>`
  ).join('')}</nav>`;
}
function updateTabs(active) {
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.tab === active;
    t.classList.toggle('on', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
}

async function fabAction() {
  const active = await getActiveWorkout();
  if (active) { nav.go(`#/workout/${active.id}`); return; }
  const rs = await listRoutines();
  const body = `<button class="menu-row big" id="fab-empty">${icon('play')} ${t('Séance libre','Free workout')}</button>
    ${rs.length ? `<div class="fab-sep">${t('ou un programme','or a program')}</div>` + rs.map(r => `<button class="menu-row" data-r="${r.id}">${icon('dumbbell')} ${esc(r.name)} <span class="mut sm">${(r.items||[]).length} ${t('exercice','exercise')}${(r.items||[]).length>1?'s':''}</span></button>`).join('') : `<p class="mut sm center">${t('Aucun programme.','No programs yet.')} <a data-nav="#/routines">${t('En créer un','Create one')}</a> · <a data-nav="#/coach">${t('le coach s’en charge 🧙','let the coach do it 🧙')}</a></p>`}`;
  const s = sheet(body, { title: t('Démarrer','Start') });
  s.root.querySelector('#fab-empty').onclick = async () => { s.close(); const w = await startWorkout({}); nav.go(`#/workout/${w.id}`); };
  s.root.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => {
    s.close(); const r = await getRoutine(b.dataset.r);
    if (!(r.items||[]).length) { toast(t('Programme vide','Empty program')); nav.go(`#/routines/${r.id}/edit`); return; }
    routines.beginRoutine(r);
  });
}

// ---------- écran de bienvenue (premier lancement) ----------
function welcome() {
  return new Promise(resolve => {
    document.body.classList.add('welcome-mode'); // pas de tabbar tant qu'on n'est pas entré
    const view = $('#view');
    const online = sync.isConfigured();
    view.innerHTML = `<div class="welcome">
      <div class="wel-halo"></div>
      <div class="wel-body">
        <div class="wel-logo"><svg class="fist" viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id="gwel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7bb55"/><stop offset="1" stop-color="#e8902e"/></linearGradient></defs><g transform="rotate(-5 48 48)"><g stroke="#f2a63c" stroke-width="4" stroke-linecap="round" opacity=".85"><line x1="7" y1="30" x2="15" y2="33"/><line x1="4" y1="46" x2="14" y2="47"/><line x1="8" y1="62" x2="15" y2="59"/></g><g fill="url(#gwel)"><rect x="24" y="17" width="14" height="30" rx="7"/><rect x="39" y="13" width="14" height="34" rx="7"/><rect x="54" y="16" width="14" height="31" rx="7"/><rect x="69" y="21" width="13" height="26" rx="6.5"/><rect x="24" y="36" width="58" height="34" rx="15"/><rect x="18" y="40" width="16" height="26" rx="8" transform="rotate(9 26 53)"/></g><g stroke="#0c0d10" stroke-width="3" stroke-linecap="round"><line x1="38.5" y1="22" x2="38.5" y2="42"/><line x1="53.5" y1="20" x2="53.5" y2="42"/><line x1="68.5" y1="25" x2="68.5" y2="42"/></g><rect x="30" y="66" width="48" height="9" rx="4.5" fill="#c9741f"/><rect x="46" y="66" width="7" height="9" fill="#0c0d10" opacity=".35"/></g></svg></div>
        <h1 class="wel-title">SPORT<span>SALLE</span></h1>
        <p class="wel-tag">${t('Ton coach de poche.','Your pocket coach.')}</p>
        <div class="wel-feats">
          <span>${icon('dumbbell')} ${t('Coach & programmes','Coach & programs')}</span>
          <span>${icon('trophy')} ${t('Records & progrès','Records & progress')}</span>
          <span>${icon('users')} ${t('Amis & groupes','Friends & groups')}</span>
        </div>
        <div class="wel-actions">
          ${online && !navigator.onLine ? `
          <p class="wel-offline">📡 ${t('Tu es hors-ligne — impossible de se connecter pour l’instant.','You’re offline — signing in isn’t possible right now.')}</p>
          ${state.profiles.length ? `<button class="btn primary full big" id="wel-offgo">${t('Continuer hors-ligne','Continue offline')}</button>` : ''}
          <button class="btn ghost full" id="wel-retry">${t('Réessayer','Retry')}</button>`
          : online ? `
          <div id="wel-gsi"></div>
          <button class="btn primary full big" id="wel-register">${t('Créer un compte gratuit','Create a free account')}</button>
          <button class="btn ghost full" id="wel-login">${t('J’ai déjà un compte','I already have an account')}</button>
          <button class="wel-guest" id="wel-diag">${t('Un souci de connexion ? Diagnostic','Connection issue? Run diagnostics')}</button>`
          : `<button class="btn primary full big" id="wel-guest">${t('Commencer','Get started')}</button>
          <button class="wel-guest" id="wel-diag">${t('Pas de connexion au serveur ? Diagnostic','Can’t reach the server? Diagnostics')}</button>`}
        </div>
        <div class="wel-lang">${['fr','en'].map(l => `<button class="wel-lang-b ${(state.global?.locale||'')===l?'on':''}" data-lang="${l}">${l.toUpperCase()}</button>`).join('')}</div>
        <p class="wel-legal"><a href="legal.html" target="_blank" rel="noopener">${t('Confidentialité · Mentions légales','Privacy · Legal')}</a></p>
      </div>
    </div>`;
    const done = () => { document.body.classList.remove('welcome-mode'); resolve(); };
    view.querySelector('#wel-register')?.addEventListener('click', () => openAuthSheet('register', done));
    view.querySelector('#wel-login')?.addEventListener('click', () => openAuthSheet('login', done));
    view.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', async () => {
      await saveGlobal({ locale: b.dataset.lang }); location.reload();
    }));
    view.querySelector('#wel-guest')?.addEventListener('click', async () => { await onboarding(); done(); });
    view.querySelector('#wel-offgo')?.addEventListener('click', done);
    view.querySelector('#wel-retry')?.addEventListener('click', () => location.reload());
    view.querySelector('#wel-diag')?.addEventListener('click', async () => {
      const d = await sync.diagnose();
      const line = (label, r) => `<div class="setting"><span>${label}</span><b class="mut sm">${esc(r?.erreur ? '✗ ' + r.erreur : '✓ HTTP ' + r.statut)}</b></div>`;
      const sh = sheet(`
        <p class="mut sm">${t('Résultat des tests vers le serveur','Server test results')} (${esc(d.url)}) :</p>
        ${line(t('Réseau','Network'), { statut: d.enLigne ? t('en ligne','online') : t('HORS-LIGNE','OFFLINE') })}
        ${line('GET', d.get)}${line('POST', d.post)}
        <p class="mut sm">${d.get?.statut && d.post?.erreur ? t('Le serveur répond en GET mais pas en POST : un bloqueur de contenu Safari, un VPN/DNS filtrant ou le réseau mobile bloque les envois. Essaie en WiFi, ou désactive les bloqueurs pour ce site.','The server answers GET but not POST: a Safari content blocker, filtering VPN/DNS or your carrier is blocking uploads. Try WiFi, or disable blockers for this site.') : d.get?.erreur && d.post?.erreur ? t('Le serveur est injoignable depuis cet appareil : vérifie ta connexion, ou essaie WiFi ↔ 4G.','The server can’t be reached from this device: check your connection, or switch WiFi ↔ cellular.') : t('Le serveur répond — appuie sur Réessayer.','The server responds — tap Retry.')}</p>
        <button class="btn primary full" id="diag-retry">${t('Réessayer','Retry')}</button>
        <button class="btn ghost full" id="diag-copy">${t('Copier le rapport','Copy report')}</button>`, { title: t('🔎 Diagnostic serveur','🔎 Server diagnostics') });
      sh.root.querySelector('#diag-retry').onclick = () => { try { localStorage.removeItem('sync-api-ok'); } catch {} location.reload(); };
      sh.root.querySelector('#diag-copy').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(d)); toast(t('Rapport copié ✓','Report copied ✓')); } catch { toast(t('Copie impossible','Copy failed'), { type: 'error' }); } };
    });
    if (online && navigator.onLine) mountGoogleButton(view.querySelector('#wel-gsi'), done, () => {}, { sep: 'after' });
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
      <p>${t('Ton coach de poche pour la salle : programmes, séances, records et progression. Crée ton profil — chaque personne qui utilise ce téléphone peut avoir le sien.','Your pocket gym coach: programs, workouts, records and progress. Create your profile — everyone using this phone can have their own.')}</p>
      <label class="field-label">${t('Ton prénom','Your first name')}</label>
      <input class="input" id="ob-name" placeholder="${t('Prénom','First name')}" autocomplete="given-name">
      <label class="field-label">${t('Ta couleur','Your color')}</label>
      <div class="accent-pick" id="ob-accent">${Object.entries(ACCENTS).map(([k,v],i)=>`<button class="accent-dot ${i===0?'sel':''}" data-a="${k}" style="--a:${v.hex}"></button>`).join('')}</div>
      <label class="field-label">${t('Ton avatar (optionnel)','Your avatar (optional)')}</label>
      <div class="emoji-pick" id="ob-emoji">${AVATAR_EMOJIS.map(e=>`<button class="emoji-dot" data-e="${e}">${e}</button>`).join('')}</div>
      <button class="btn primary full big" id="ob-go">${t('Commencer','Get started')} ${icon('right')}</button>
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
      const name = view.querySelector('#ob-name').value.trim() || t('Athlète','Athlete');
      const p = await createProfile({ name, accent, emoji });
      await setActiveProfile(p.id);
      resolve();
    };
  });
}

// splash retiré en douceur (fondu) plutôt que d'un coup
function hideSplash() {
  const s = $('#splash');
  if (!s) return;
  s.classList.add('out');
  setTimeout(() => s.remove(), 340);
}

// ---------- service worker ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller; // false = toute 1re visite (le claim() n'est pas une mise à jour)
  let userRequestedUpdate = false;
  const applyUpdate = (sw) => { userRequestedUpdate = true; sw.postMessage('skipWaiting'); };
  // Mise à jour AUTOMATIQUE (« hard refresh ») dès qu'une nouvelle version est
  // téléchargée — jamais en pleine séance : là, elle s'installe dès la fin.
  const applyWhenSafe = (sw) => {
    if (!document.body.classList.contains('workout-mode')) { applyUpdate(sw); return; }
    toast(t('Mise à jour prête — elle s’installera après ta séance','Update ready — it will install after your workout'), { duration: 5000 });
    const timer = setInterval(() => {
      if (!document.body.classList.contains('workout-mode')) { clearInterval(timer); applyUpdate(sw); }
    }, 20000);
  };
  navigator.serviceWorker.register('sw.js').then(reg => {
    // une mise à jour attendait depuis une visite précédente → on l'applique
    if (reg.waiting && navigator.serviceWorker.controller) applyWhenSafe(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) applyWhenSafe(nw);
      });
    });
    // détection rapide d'un déploiement pendant que l'app est ouverte :
    // re-vérifie au retour au premier plan + toutes les 15 minutes
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    setInterval(() => reg.update().catch(() => {}), 15 * 60 * 1000);
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
    const libReady = loadLibrary(); // en parallèle : l'accueil s'affiche sans attendre le 1,1 Mo

    document.body.insertAdjacentHTML('beforeend', tabBar());
    document.getElementById('fab').onclick = fabAction;
    hideSplash();

    await sync.init(); // avant le premier rendu : l'écran Profil sait si la synchro existe

    if (!state.profiles.length) { await welcome(); }
    else {
      const active = state.global.activeProfileId && state.profiles.find(p => p.id === state.global.activeProfileId);
      await setActiveProfile(active ? active.id : state.profiles[0].id);
      // compte OBLIGATOIRE dès que le serveur existe : sans session, on ne rentre pas.
      // (une fois connecté, le jeton local de 90 jours suffit → l'app marche hors-ligne)
      // hors-ligne, on ne bloque personne hors de SES données locales — le mur reviendra en ligne
      if (sync.isConfigured() && !ps('account') && navigator.onLine) { applyTheme(); await welcome(); }
    }
    applyTheme();

    await libReady;
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

    // ---- temps réel ----
    // pouls : poll léger au premier plan ; les événements font vivre l'UI en place
    if (sync.isConfigured()) live.startLive();
    on('live-info', e => {
      const n = (e?.detail?.reqs || 0) + (e?.detail?.notifs || 0);
      const dot = document.getElementById('soc-dot');
      if (dot) { dot.hidden = n === 0; dot.textContent = n > 9 ? '9+' : String(n || ''); }
      const bell = document.getElementById('bell-dot');
      if (bell) bell.hidden = (e?.detail?.notifs || 0) === 0;
    });
    on('live-changed', () => {
      // rafraîchir en place les écrans sociaux — sans casser une saisie en cours
      const soc = nav.current === 'social' || nav.current === 'social-group';
      if (!soc) return;
      if (document.querySelector('.sheet-backdrop')) return;        // une sheet est ouverte
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return; // l'utilisateur tape
      nav.refresh();
    });

    registerSW();
    hideSplash();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="screen-pad"><div class="empty"><h3>${t('Erreur au démarrage','Startup error')}</h3><p>${esc(e.message||e)}</p></div></div>`;
    hideSplash();
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
