// screens/profile.js — profiles, settings, data, install
import { esc } from '../util.js';
import {
  state, ps, nav,
  savePSettings, saveGlobal, applyTheme,
  activeProfile, accentHex, updateProfile, ACCENTS, AVATAR_EMOJIS,
} from '../store.js';
import * as db from '../db.js';
import { icon, sheet, confirmDialog, toast } from '../ui.js';
import { backBtn } from './common.js';
import * as sync from '../sync.js';
import { isLoggedIn, account, call } from '../api.js';
import { pushSupported, iosNeedsInstall, pushState, enablePush, disablePush } from '../push.js';
import { accountCardHtml, mountAccountCard } from './account.js';
import { appLockCardHtml, mountAppLockCard } from '../applock.js';
import { APP_VERSION } from '../version.js';
import { t } from '../i18n.js';



export async function render() {
  const theme = state.global?.theme || 'system';
  const seg = (name, val, opts) => `<div class="segmented sm" data-seg="${name}">${opts.map(([v,l])=>`<button class="seg ${v===val?'on':''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const sw = (id, on) => `<button class="switch ${on?'on':''}" data-toggle="${id}" role="switch" aria-checked="${on}"><span></span></button>`;

  const canInstall = !!window.__deferredInstall;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;

  return `
    <header class="topbar"><div class="topbar-l">${backBtn('#/home')}</div><div class="topbar-c"><h1>${t('Profil & réglages','Profile & settings')}</h1></div><div class="topbar-r"></div></header>
    <div class="screen-pad">
      ${canInstall || isIOS ? `<section class="card install-card">
        <h3 class="card-t">${icon('download')} ${t('Installer l’application','Install the app')}</h3>
        ${canInstall ? `<p class="mut sm">${t('Ajoute l’app à ton écran d’accueil pour un accès instantané, hors-ligne.','Add the app to your home screen for instant, offline access.')}</p><button class="btn primary full" id="install-btn">${t('Installer','Install')}</button>`
          : `<p class="mut sm">${t('Sur iPhone : appuie sur','On iPhone: tap')} <b>${t('Partager','Share')}</b> ${icon('upload')} ${t('puis','then')} <b>${t('« Sur l’écran d’accueil »','“Add to Home Screen”')}</b>.</p>`}
      </section>` : ''}

      ${sync.isConfigured() ? accountCardHtml() : ''}

      ${avatarColorCardHtml()}
      ${sync.isConfigured() && isLoggedIn() ? `<section class="card">
        <h3 class="card-t">${icon('idcard')} ${t('Mon profil public','My public profile')}</h3>
        <p class="mut sm">${t('Nom, bio et confidentialité — compte privé par défaut : seuls tes amis voient tes posts et stats.','Name, bio and privacy — private by default: only friends see your posts and stats.')}</p>
        <button class="btn ghost full" id="edit-pub-profile">${t('Voir / modifier mon profil','View / edit my profile')}</button>
      </section>` : ''}

      ${sync.isConfigured() && isLoggedIn() ? `<section class="card" id="push-card">
        <h3 class="card-t">${icon('bell')} ${t('Notifications push','Push notifications')}</h3>
        <p class="mut sm" id="push-desc">${t('Sois prévenu des demandes d’ami, réactions, réponses et mentions — même l’app fermée.','Get notified of friend requests, reactions, replies and mentions — even when the app is closed.')}</p>
        <div id="push-action"></div>
      </section>` : ''}
      ${sync.isConfigured() ? appLockCardHtml() : ''}

      <section class="card">
        <h3 class="card-t">${t('Réglages','Settings')}</h3>
        <div class="setting"><span>${t('Unité de poids','Weight unit')}</span>${seg('unit', ps('weightUnit'), [['kg','kg'],['lb','lb']])}</div>
        <div class="setting"><span>${t('Thème','Theme')}</span>${seg('theme', theme, [['system','Auto'],['dark',t('Sombre','Dark')],['light',t('Clair','Light')]])}</div>
        <div class="setting"><span>${t('Langue','Language')}</span>${seg('locale', state.global?.locale || 'auto', [['auto','Auto'],['fr','FR'],['en','EN']])}</div>
        <div class="setting"><span>${t('Objectif / semaine','Weekly goal')}</span><div class="stepper"><button data-goal="-1" aria-label="Diminuer l’objectif">${icon('minus')}</button><b id="goal-v">${ps('weeklyGoal')}</b><button data-goal="1" aria-label="Augmenter l’objectif">${icon('plus')}</button></div></div>
        <div class="setting"><span>${t('Repos par défaut','Default rest')}</span><div class="stepper"><button data-rest="-15" aria-label="Réduire le repos">${icon('minus')}</button><b id="rest-v">${ps('defaultRestSec')}s</b><button data-rest="15" aria-label="Augmenter le repos">${icon('plus')}</button></div></div>
        <div class="setting"><span>${t('Formule 1RM','1RM formula')}</span>${seg('formula', ps('e1rmFormula'), [['epley','Epley'],['brzycki','Brzycki']])}</div>
        <div class="setting"><span>${t('Son (fin de repos)','Sound (rest over)')}</span>${sw('sound', ps('sound'))}</div>
        <div class="setting"><span>${t('Vibrations','Vibration')}</span>${sw('vibration', ps('vibration'))}</div>
      </section>

      <section class="card">
        <h3 class="card-t">${t('Données','Data')}</h3>
        <p class="mut sm">${t('Tes données restent sur ton téléphone. Sauvegarde-les ou transfère-les.','Your data lives on your phone. Back it up or transfer it.')}</p>
        <button class="btn ghost full" id="export-btn">${icon('download')} ${t('Exporter (sauvegarde .json)','Export (.json backup)')}</button>
        <button class="btn ghost full" id="import-btn">${icon('upload')} ${t('Importer une sauvegarde','Import a backup')}</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </section>

      <section class="card">
        <h3 class="card-t">${icon('megaphone')} ${t('Fais tourner','Spread the word')}</h3>
        <p class="mut sm">${t('Sport Salle est gratuit et sans pub — le meilleur moyen de soutenir l’app, c’est d’en parler.','Sport Salle is free with no ads — the best way to support it is to tell people.')}</p>
        <button class="btn ghost full" id="share-app">${icon('upload')} ${t('Partager l’appli','Share the app')}</button>
      </section>

      <section class="card maker-card">
        <h3 class="card-t">${icon('hand')} ${t('Le mot du créateur','A word from the maker')}</h3>
        <p class="mut sm">${t('Salut, moi c’est Hugo. J’ai créé Sport Salle en reprenant la salle après une longue pause — je voulais un carnet simple, gratuit, sans pub, qui me pousse vraiment. Je m’en sers à chaque séance à Val d’Europe. Si tu l’utilises aussi : bienvenue dans l’équipe. 💛','Hi, I’m Hugo. I built Sport Salle while getting back into the gym after a long break — I wanted a simple, free, ad-free logbook that actually pushes me. I use it at every workout. If you use it too: welcome to the team. 💛')}</p>
      </section>

      <section class="card">
        <h3 class="card-t">${t('À propos','About')}</h3>
        <p class="mut sm">Sport Salle — v${APP_VERSION}. ${t('Ton coach de musculation : programmes, séances, records et amis. Tes données vivent sur ton téléphone et te suivent avec ton compte.','Your gym coach: programs, workouts, records and friends. Your data lives on your phone and follows you with your account.')}</p>
        <p class="mut sm">${t('Données d’exercices open source : free-exercise-db (domaine public) · wger.de (CC-BY-SA 4.0, noms français). Ceci n’est pas un avis médical.','Open-source exercise data: free-exercise-db (public domain) · wger.de (CC-BY-SA 4.0, French names). This is not medical advice.')}</p>
        <p class="mut sm"><a href="legal.html" target="_blank" rel="noopener">${t('Mentions légales · Politique de confidentialité · CGU','Legal notice · Privacy policy · Terms')}</a></p>
      </section>
    </div>`;
}

// ---- Avatar (emoji ou photo) & couleur d'accent ----
const avaInner = (p) => p?.photo
  ? `<img class="avatar-photo" src="${p.photo}" alt="">`
  : (p?.emoji ? esc(p.emoji) : esc((p?.name || '?').slice(0, 1).toUpperCase()));

function avatarColorCardHtml() {
  const p = activeProfile();
  return `<section class="card" id="ava-card">
    <h3 class="card-t">${icon('user')} ${t('Avatar & couleur','Avatar & color')}</h3>
    <div class="ava-row">
      <span class="avatar xl" id="ava-prev" style="--a:${accentHex(p)}">${avaInner(p)}</span>
      <div class="ava-btns">
        <button class="btn ghost sm" id="ava-photo-btn">${icon('camera')} ${t('Choisir une photo','Pick a photo')}</button>
        <button class="btn ghost sm" id="ava-clear-btn" ${p?.photo ? '' : 'hidden'}>${icon('x')} ${t('Retirer la photo','Remove photo')}</button>
      </div>
    </div>
    <div class="emoji-pick" id="ava-emoji">${AVATAR_EMOJIS.map(e => `<button class="emoji-dot ${!p?.photo && p?.emoji === e ? 'sel' : ''}" data-e="${e}" aria-label="Avatar ${e}">${e}</button>`).join('')}</div>
    <p class="mut sm" style="margin:12px 0 6px">${t('Couleur de l’app','App color')}</p>
    <div class="accent-pick" id="ava-accent">${Object.entries(ACCENTS).map(([k, v]) => `<button class="accent-dot ${(p?.accent || 'ember') === k ? 'sel' : ''}" data-ac="${k}" style="--a:${v.hex}" aria-label="${v.name}"></button>`).join('')}</div>
    <input type="file" id="ava-file" accept="image/*" hidden>
  </section>`;
}

// Photo → carré 128px compressé (data-URI ~4 Ko) : léger pour la synchro et les listes
function compressAvatar(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const S = 128, c = document.createElement('canvas');
      c.width = S; c.height = S;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
      c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, S, S);
      resolve(c.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('Image illisible','Unreadable image'))); };
    img.src = url;
  });
}

// Pousse le changement au serveur (mise à jour PARTIELLE) + met à jour le compte en cache
async function pushProfilePatch(patch, userPatch) {
  if (!isLoggedIn()) return;
  try {
    await call('auth', 'profile_update', patch);
    const acc = account();
    if (acc?.user) await savePSettings({ account: { ...acc, user: { ...acc.user, ...userPatch } } });
  } catch (e) { toast(e.message, { type: 'error' }); }
}

function mountAvatarCard(root) {
  const card = root.querySelector('#ava-card');
  if (!card) return;
  const prev = card.querySelector('#ava-prev');
  const clearBtn = card.querySelector('#ava-clear-btn');
  const fileIn = card.querySelector('#ava-file');
  const refresh = () => {
    const p = activeProfile();
    prev.style.setProperty('--a', accentHex(p));
    prev.innerHTML = avaInner(p);
    clearBtn.hidden = !p?.photo;
    card.querySelectorAll('[data-e]').forEach(b => b.classList.toggle('sel', !p?.photo && p?.emoji === b.dataset.e));
    card.querySelectorAll('[data-ac]').forEach(b => b.classList.toggle('sel', (p?.accent || 'ember') === b.dataset.ac));
  };
  // emoji : sélection (ou dé-sélection) — remplace la photo
  card.querySelectorAll('[data-e]').forEach(b => b.onclick = async () => {
    const p = activeProfile();
    const emoji = (!p?.photo && p?.emoji === b.dataset.e) ? null : b.dataset.e;
    await updateProfile(p.id, { emoji, photo: null });
    refresh();
    pushProfilePatch({ emoji: emoji || '', avatar: '' }, { emoji, avatar: null });
  });
  // couleur d'accent : appliquée en direct
  card.querySelectorAll('[data-ac]').forEach(b => b.onclick = async () => {
    const p = activeProfile();
    await updateProfile(p.id, { accent: b.dataset.ac });
    applyTheme();
    refresh();
    pushProfilePatch({ accent: b.dataset.ac }, { accent: b.dataset.ac });
  });
  // photo
  card.querySelector('#ava-photo-btn').onclick = () => fileIn.click();
  fileIn.onchange = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const dataUrl = await compressAvatar(f);
      const p = activeProfile();
      await updateProfile(p.id, { photo: dataUrl });
      refresh();
      pushProfilePatch({ avatar: dataUrl }, { avatar: dataUrl });
      toast(t('Photo d’avatar mise à jour ✓','Avatar photo updated ✓'));
    } catch (err) { toast(err.message, { type: 'error' }); }
  };
  clearBtn.onclick = async () => {
    const p = activeProfile();
    await updateProfile(p.id, { photo: null });
    refresh();
    pushProfilePatch({ avatar: '' }, { avatar: null });
  };
}

export function mount(root) {
  mountAvatarCard(root);
  root.querySelector('#edit-pub-profile')?.addEventListener('click', () => {
    const acc = account();
    if (acc?.user?.username) nav.go('#/u/' + acc.user.username);
  });
  mountPushCard(root);
  root.querySelector('#share-app')?.addEventListener('click', async () => {
    const url = 'https://sportsalle.hbaillyg.fr/';
    const text = t('Je suis mes séances sur Sport Salle — coach, programmes, amis. Gratuit, sans pub :','I track my workouts on Sport Salle — coach, programs, friends. Free, no ads:');
    try { if (navigator.share) { await navigator.share({ title: 'Sport Salle', text, url }); return; } }
    catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast(t('Lien copié ✓','Link copied ✓')); }
    catch { toast(url, { duration: 6000 }); }
  });
  // install
  root.querySelector('#install-btn')?.addEventListener('click', async () => {
    const dp = window.__deferredInstall; if (!dp) return;
    window.__deferredInstall = null; // événement à usage unique — on le consomme quoi qu'il arrive
    dp.prompt();
    const { outcome } = await dp.userChoice;
    if (outcome === 'accepted') toast('Installation lancée ✓');
    nav.refresh(); // la carte d'installation disparaît (prompt consommé)
  });

  // settings segmented
  root.querySelectorAll('[data-seg]').forEach(seg => seg.querySelectorAll('[data-v]').forEach(btn => btn.onclick = async () => {
    const name = seg.dataset.seg, v = btn.dataset.v;
    if (name === 'unit') await savePSettings({ weightUnit: v });
    else if (name === 'formula') await savePSettings({ e1rmFormula: v });
    else if (name === 'theme') { await saveGlobal({ theme: v }); applyTheme(); }
    else if (name === 'locale') { await saveGlobal({ locale: v === 'auto' ? null : v }); location.reload(); return; } // toute l'app change de langue
    nav.refresh();
  }));
  // steppers
  root.querySelectorAll('[data-goal]').forEach(b => b.onclick = async () => {
    const v = Math.max(1, Math.min(14, ps('weeklyGoal') + (+b.dataset.goal)));
    await savePSettings({ weeklyGoal: v }); root.querySelector('#goal-v').textContent = v;
  });
  root.querySelectorAll('[data-rest]').forEach(b => b.onclick = async () => {
    const v = Math.max(15, Math.min(600, ps('defaultRestSec') + (+b.dataset.rest)));
    await savePSettings({ defaultRestSec: v }); root.querySelector('#rest-v').textContent = v + 's';
  });
  // switches
  root.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
    const key = b.dataset.toggle; const on = !ps(key);
    await savePSettings({ [key]: on }); b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
  });

  // compte + verrouillage + sync
  mountAccountCard(root);
  mountAppLockCard(root);

  // data
  root.querySelector('#export-btn').onclick = exportData;
  const fileInput = root.querySelector('#import-file');
  root.querySelector('#import-btn').onclick = () => fileInput.click();
  fileInput.onchange = () => importData(fileInput.files[0]);
}

// ---------------- data io ----------------
async function exportData() {
  const stores = ['profiles','settings','routines','workouts','bodyMetrics','favorites','customExercises','deletions'];
  const dump = { app:'sport-salle', version: APP_VERSION, exportedAt: new Date().toISOString(), data:{} };
  for (const st of stores) dump.data[st] = await db.getAll(st);
  const blob = new Blob([JSON.stringify(dump)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `sport-salle-sauvegarde-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(t('Sauvegarde exportée ✓','Backup exported ✓'));
}

async function importData(file) {
  if (!file) return;
  const ok = await confirmDialog({ title:t('Importer','Import'), message:t('Les données de la sauvegarde seront ajoutées/fusionnées. Continuer ?','Backup data will be added/merged. Continue?'), confirmText:t('Importer','Import') });
  if (!ok) return;
  try {
    const txt = await file.text();
    const dump = JSON.parse(txt);
    if (!dump.data) throw new Error('format');
    for (const [st, rows] of Object.entries(dump.data)) {
      if (!Array.isArray(rows)) continue;
      for (const r of rows) { try { await db.put(st, r); } catch {} }
    }
    toast(t('Import réussi — rechargement…','Import successful — reloading…'));
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    toast(t('Fichier invalide','Invalid file'), { type:'error' });
  }
}

// ---- carte notifications push ----
async function mountPushCard(root) {
  const host = root.querySelector('#push-action');
  if (!host) return;
  const render = async () => {
    if (!pushSupported()) {
      if (iosNeedsInstall()) {
        host.innerHTML = `<p class="mut sm">${t('Sur iPhone : ajoute d’abord l’app à ton écran d’accueil (bouton Partager → « Sur l’écran d’accueil »), puis rouvre-la pour activer les notifications.','On iPhone: first add the app to your Home Screen (Share → “Add to Home Screen”), then reopen it to enable notifications.')}</p>`;
      } else {
        host.innerHTML = `<p class="mut sm">${t('Non disponible sur ce navigateur.','Not available on this browser.')}</p>`;
      }
      return;
    }
    const st = await pushState();
    if (st.permission === 'denied') {
      host.innerHTML = `<p class="mut sm">${t('Notifications bloquées dans les réglages du navigateur — réautorise-les pour Sport Salle.','Notifications are blocked in your browser settings — re-allow them for Sport Salle.')}</p>`;
      return;
    }
    host.innerHTML = st.subscribed
      ? `<div class="setting"><span>${t('Activées sur cet appareil ✓','Enabled on this device ✓')}</span><button class="btn ghost sm" id="push-off">${t('Désactiver','Disable')}</button></div>`
      : `<button class="btn primary full" id="push-on">${icon('bell')} ${t('Activer les notifications','Enable notifications')}</button>`;
    host.querySelector('#push-on')?.addEventListener('click', async () => {
      const btn = host.querySelector('#push-on'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      const r = await enablePush();
      if (r.error) { toast(r.error, { type: 'error' }); } else { toast(t('Notifications activées ✓','Notifications enabled ✓')); }
      render();
    });
    host.querySelector('#push-off')?.addEventListener('click', async () => {
      await disablePush(); toast(t('Notifications désactivées','Notifications disabled')); render();
    });
  };
  render();
}
