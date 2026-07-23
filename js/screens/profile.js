// screens/profile.js — profiles, settings, data, install
import { esc } from '../util.js';
import {
  state, ACCENTS, ps, activeProfile, accentHex, nav,
  createProfile, updateProfile, setActiveProfile, deleteProfile,
  savePSettings, saveGlobal, applyTheme,
} from '../store.js';
import * as db from '../db.js';
import { icon, sheet, confirmDialog, toast } from '../ui.js';
import { backBtn } from './common.js';
import * as sync from '../sync.js';
import { accountCardHtml, mountAccountCard } from './account.js';
import { appLockCardHtml, mountAppLockCard } from '../applock.js';
import { APP_VERSION } from '../version.js';
import { t } from '../i18n.js';



export async function render() {
  const p = activeProfile();
  const profs = state.profiles.map(pr => `
    <button class="prof-row ${pr.id===state.activeProfileId?'active':''}" data-switch="${pr.id}">
      <span class="avatar" style="--a:${accentHex(pr)}">${pr.emoji || esc(pr.name.slice(0,1).toUpperCase())}</span>
      <span class="prof-name">${esc(pr.name)}</span>
      ${pr.id===state.activeProfileId?`<span class="prof-active">${icon('check')} ${t('actif','active')}</span>`:''}
      <button class="icon-btn sm" data-edit="${pr.id}" aria-label="${t('Modifier','Edit')}">${icon('edit')}</button>
    </button>`).join('');

  const theme = state.global?.theme || 'system';
  const seg = (name, val, opts) => `<div class="segmented sm" data-seg="${name}">${opts.map(([v,l])=>`<button class="seg ${v===val?'on':''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const sw = (id, on) => `<button class="switch ${on?'on':''}" data-toggle="${id}" role="switch" aria-checked="${on}"><span></span></button>`;

  const canInstall = !!window.__deferredInstall;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;

  return `
    <header class="topbar"><div class="topbar-l">${backBtn('#/home')}</div><div class="topbar-c"><h1>${t('Profil & réglages','Profile & settings')}</h1></div><div class="topbar-r"></div></header>
    <div class="screen-pad">
      <section class="card">
        <h3 class="card-t">${t('Profils','Profiles')}</h3>
        <div class="prof-list">${profs}</div>
        <button class="btn ghost full" id="add-prof">${icon('plus')} ${t('Ajouter un profil','Add a profile')}</button>
      </section>

      ${canInstall || isIOS ? `<section class="card install-card">
        <h3 class="card-t">${icon('download')} ${t('Installer l’application','Install the app')}</h3>
        ${canInstall ? `<p class="mut sm">${t('Ajoute l’app à ton écran d’accueil pour un accès instantané, hors-ligne.','Add the app to your home screen for instant, offline access.')}</p><button class="btn primary full" id="install-btn">${t('Installer','Install')}</button>`
          : `<p class="mut sm">${t('Sur iPhone : appuie sur','On iPhone: tap')} <b>${t('Partager','Share')}</b> ${icon('upload')} ${t('puis','then')} <b>${t('« Sur l’écran d’accueil »','“Add to Home Screen”')}</b>.</p>`}
      </section>` : ''}

      ${sync.isConfigured() ? accountCardHtml() : ''}
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
        <h3 class="card-t">📣 ${t('Fais tourner','Spread the word')}</h3>
        <p class="mut sm">${t('Sport Salle est gratuit et sans pub — le meilleur moyen de soutenir l’app, c’est d’en parler.','Sport Salle is free with no ads — the best way to support it is to tell people.')}</p>
        <button class="btn ghost full" id="share-app">${icon('upload')} ${t('Partager l’appli','Share the app')}</button>
      </section>

      <section class="card maker-card">
        <h3 class="card-t">👋 ${t('Le mot du créateur','A word from the maker')}</h3>
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

export function mount(root) {
  root.querySelector('#share-app')?.addEventListener('click', async () => {
    const url = 'https://sportsalle.hbaillyg.fr/';
    const text = t('Je suis mes séances sur Sport Salle — coach, programmes, amis. Gratuit, sans pub :','I track my workouts on Sport Salle — coach, programs, friends. Free, no ads:');
    try { if (navigator.share) { await navigator.share({ title: 'Sport Salle', text, url }); return; } }
    catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast(t('Lien copié ✓','Link copied ✓')); }
    catch { toast(url, { duration: 6000 }); }
  });
  // profiles
  root.querySelectorAll('[data-switch]').forEach(b => b.addEventListener('click', async (e) => {
    if (e.target.closest('[data-edit]')) return;
    const id = b.dataset.switch;
    if (id === state.activeProfileId) return;
    await setActiveProfile(id);
    if (sync.isConfigured() && !ps('account')) { location.hash = ''; location.reload(); return; } // ce profil n'a pas de compte → écran de connexion
    toast(`${t('Profil','Profile')} : ${activeProfile().name}`); nav.go('#/home');
  }));
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); editProfile(b.dataset.edit); }));
  root.querySelector('#add-prof').onclick = addProfile;

  // install
  root.querySelector('#install-btn')?.addEventListener('click', async () => {
    const dp = window.__deferredInstall; if (!dp) return;
    window.__deferredInstall = null; // événement à usage unique — on le consomme quoi qu'il arrive
    dp.prompt();
    const { outcome } = await dp.userChoice;
    if (outcome === 'accepted') toast('Installation lancée 🎉');
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

const AVATAR_EMOJIS = ['💪','🏋️','🔥','⚡','🚀','🦁','🐺','😤','🌸','👑','🎯','🥇'];
const emojiRow = (idPrefix, current) =>
  `<div class="emoji-pick" id="${idPrefix}-emoji">${AVATAR_EMOJIS.map(e=>`<button class="emoji-dot ${e===current?'sel':''}" data-e="${e}">${e}</button>`).join('')}</div>`;
function wireEmoji(rootEl, initial) {
  let emoji = initial ?? null;
  rootEl.querySelectorAll('[data-e]').forEach(b => b.onclick = () => {
    const was = b.classList.contains('sel');
    rootEl.querySelectorAll('[data-e]').forEach(x=>x.classList.remove('sel'));
    emoji = was ? null : b.dataset.e;
    if (!was) b.classList.add('sel');
  });
  return () => emoji;
}

async function addProfile() {
  const used = new Set(state.profiles.map(p => p.accent));
  const free = Object.keys(ACCENTS).find(a => !used.has(a)) || 'volt';
  const s = sheet(`
    <label class="field-label">${t('Prénom','First name')}</label>
    <input class="input" id="np-name" placeholder="${t('Prénom','First name')}">
    <label class="field-label">${t('Couleur','Color')}</label>
    <div class="accent-pick" id="np-accent">${Object.entries(ACCENTS).map(([k,v])=>`<button class="accent-dot ${k===free?'sel':''}" data-a="${k}" style="--a:${v.hex}" aria-label="${v.name}"></button>`).join('')}</div>
    <label class="field-label">${t('Avatar (optionnel)','Avatar (optional)')}</label>
    ${emojiRow('np', null)}
    <button class="btn primary full" id="np-save">${t('Créer le profil','Create profile')}</button>`, { title: t('Nouveau profil','New profile') });
  let accent = free;
  const getEmoji = wireEmoji(s.root, null);
  s.root.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { accent = b.dataset.a; s.root.querySelectorAll('[data-a]').forEach(x=>x.classList.toggle('sel', x===b)); });
  s.root.querySelector('#np-save').onclick = async () => {
    const name = s.root.querySelector('#np-name').value.trim() || t('Athlète','Athlete');
    const p = await createProfile({ name, accent, emoji: getEmoji() });
    s.close(); await setActiveProfile(p.id);
    if (sync.isConfigured()) { location.hash = ''; location.reload(); return; } // nouveau profil → son compte (connexion/inscription)
    toast(`${t('Bienvenue','Welcome')} ${name}!`); nav.go('#/home');
  };
}

function editProfile(id) {
  const p = state.profiles.find(x => x.id === id);
  const s = sheet(`
    <label class="field-label">${t('Prénom','First name')}</label>
    <input class="input" id="ep-name" value="${esc(p.name)}">
    <label class="field-label">${t('Couleur','Color')}</label>
    <div class="accent-pick" id="ep-accent">${Object.entries(ACCENTS).map(([k,v])=>`<button class="accent-dot ${k===p.accent?'sel':''}" data-a="${k}" style="--a:${v.hex}"></button>`).join('')}</div>
    <label class="field-label">Avatar</label>
    ${emojiRow('ep', p.emoji)}
    <button class="btn primary full" id="ep-save">${t('Enregistrer','Save')}</button>
    ${state.profiles.length>1?`<button class="btn danger-ghost full" id="ep-del">${icon('trash')} ${t('Supprimer ce profil','Delete this profile')}</button>`:''}`,
    { title: t('Modifier le profil','Edit profile') });
  let accent = p.accent;
  const getEmoji = wireEmoji(s.root, p.emoji);
  s.root.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { accent = b.dataset.a; s.root.querySelectorAll('[data-a]').forEach(x=>x.classList.toggle('sel', x===b)); });
  s.root.querySelector('#ep-save').onclick = async () => {
    await updateProfile(id, { name: s.root.querySelector('#ep-name').value.trim() || 'Athlète', accent, emoji: getEmoji() });
    if (id === state.activeProfileId) applyTheme();
    s.close(); nav.refresh();
  };
  s.root.querySelector('#ep-del')?.addEventListener('click', async () => {
    s.close();
    if (await confirmDialog({ title:t('Supprimer le profil','Delete profile'), message:`${t('Supprimer','Delete')} « ${p.name} » ${t('et toutes ses données ? Irréversible.','and all its data? Irreversible.')}`, confirmText:t('Supprimer','Delete'), danger:true })) {
      await deleteProfile(id);
      if (state.activeProfileId === id) {
        await setActiveProfile(state.profiles[0].id);
        if (sync.isConfigured() && !ps('account')) { location.hash = ''; location.reload(); return; }
      }
      toast(t('Profil supprimé','Profile deleted')); nav.go('#/profile');
    }
  });
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
