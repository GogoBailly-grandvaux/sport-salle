// screens/profile.js — profiles, settings, data, install
import { esc } from '../util.js';
import {
  state, ACCENTS, ps, activeProfile, accentHex, nav,
  createProfile, updateProfile, setActiveProfile, deleteProfile,
  savePSettings, saveGlobal, applyTheme,
} from '../store.js';
import * as db from '../db.js';
import { icon, sheet, promptDialog, confirmDialog, toast } from '../ui.js';
import { backBtn } from './common.js';

const APP_VERSION = '1.1';

export async function render() {
  const p = activeProfile();
  const profs = state.profiles.map(pr => `
    <button class="prof-row ${pr.id===state.activeProfileId?'active':''}" data-switch="${pr.id}">
      <span class="avatar" style="--a:${accentHex(pr)}">${pr.emoji || esc(pr.name.slice(0,1).toUpperCase())}</span>
      <span class="prof-name">${esc(pr.name)}</span>
      ${pr.id===state.activeProfileId?`<span class="prof-active">${icon('check')} actif</span>`:''}
      <button class="icon-btn sm" data-edit="${pr.id}" aria-label="Modifier">${icon('edit')}</button>
    </button>`).join('');

  const theme = state.global?.theme || 'system';
  const seg = (name, val, opts) => `<div class="segmented sm" data-seg="${name}">${opts.map(([v,l])=>`<button class="seg ${v===val?'on':''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const sw = (id, on) => `<button class="switch ${on?'on':''}" data-toggle="${id}" role="switch" aria-checked="${on}"><span></span></button>`;

  const canInstall = !!window.__deferredInstall;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;

  return `
    <header class="topbar"><div class="topbar-l">${backBtn('#/home')}</div><div class="topbar-c"><h1>Profil & réglages</h1></div><div class="topbar-r"></div></header>
    <div class="screen-pad">
      <section class="card">
        <h3 class="card-t">Profils</h3>
        <div class="prof-list">${profs}</div>
        <button class="btn ghost full" id="add-prof">${icon('plus')} Ajouter un profil</button>
      </section>

      ${canInstall || isIOS ? `<section class="card install-card">
        <h3 class="card-t">${icon('download')} Installer l’application</h3>
        ${canInstall ? `<p class="mut sm">Ajoute l’app à ton écran d’accueil pour un accès instantané, hors-ligne.</p><button class="btn primary full" id="install-btn">Installer</button>`
          : `<p class="mut sm">Sur iPhone : appuie sur <b>Partager</b> ${icon('upload')} puis <b>« Sur l’écran d’accueil »</b>.</p>`}
      </section>` : ''}

      <section class="card">
        <h3 class="card-t">Réglages</h3>
        <div class="setting"><span>Unité de poids</span>${seg('unit', ps('weightUnit'), [['kg','kg'],['lb','lb']])}</div>
        <div class="setting"><span>Thème</span>${seg('theme', theme, [['system','Auto'],['dark','Sombre'],['light','Clair']])}</div>
        <div class="setting"><span>Objectif / semaine</span><div class="stepper"><button data-goal="-1">${icon('minus')}</button><b id="goal-v">${ps('weeklyGoal')}</b><button data-goal="1">${icon('plus')}</button></div></div>
        <div class="setting"><span>Repos par défaut</span><div class="stepper"><button data-rest="-15">${icon('minus')}</button><b id="rest-v">${ps('defaultRestSec')}s</b><button data-rest="15">${icon('plus')}</button></div></div>
        <div class="setting"><span>Formule 1RM</span>${seg('formula', ps('e1rmFormula'), [['epley','Epley'],['brzycki','Brzycki']])}</div>
        <div class="setting"><span>Son (fin de repos)</span>${sw('sound', ps('sound'))}</div>
        <div class="setting"><span>Vibrations</span>${sw('vibration', ps('vibration'))}</div>
      </section>

      <section class="card">
        <h3 class="card-t">Données</h3>
        <p class="mut sm">Tes données restent sur ton téléphone. Sauvegarde-les ou transfère-les.</p>
        <button class="btn ghost full" id="export-btn">${icon('download')} Exporter (sauvegarde .json)</button>
        <button class="btn ghost full" id="import-btn">${icon('upload')} Importer une sauvegarde</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </section>

      <section class="card">
        <h3 class="card-t">À propos</h3>
        <p class="mut sm">Sport Salle — v${APP_VERSION}. Application de suivi de musculation, gratuite et sans compte : tes données restent sur ton téléphone.</p>
        <p class="mut sm">Données d’exercices open source : free-exercise-db (domaine public) · wger.de (CC-BY-SA 4.0, noms français). Ceci n’est pas un avis médical.</p>
      </section>
    </div>`;
}

export function mount(root) {
  // profiles
  root.querySelectorAll('[data-switch]').forEach(b => b.addEventListener('click', async (e) => {
    if (e.target.closest('[data-edit]')) return;
    const id = b.dataset.switch;
    if (id === state.activeProfileId) return;
    await setActiveProfile(id); toast(`Profil : ${activeProfile().name}`); nav.go('#/home');
  }));
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); editProfile(b.dataset.edit); }));
  root.querySelector('#add-prof').onclick = addProfile;

  // install
  root.querySelector('#install-btn')?.addEventListener('click', async () => {
    const dp = window.__deferredInstall; if (!dp) return;
    dp.prompt(); const { outcome } = await dp.userChoice;
    if (outcome === 'accepted') { window.__deferredInstall = null; toast('Installation lancée 🎉'); }
  });

  // settings segmented
  root.querySelectorAll('[data-seg]').forEach(seg => seg.querySelectorAll('[data-v]').forEach(btn => btn.onclick = async () => {
    const name = seg.dataset.seg, v = btn.dataset.v;
    if (name === 'unit') await savePSettings({ weightUnit: v });
    else if (name === 'formula') await savePSettings({ e1rmFormula: v });
    else if (name === 'theme') { await saveGlobal({ theme: v }); applyTheme(); }
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
    <label class="field-label">Prénom</label>
    <input class="input" id="np-name" placeholder="Prénom">
    <label class="field-label">Couleur</label>
    <div class="accent-pick" id="np-accent">${Object.entries(ACCENTS).map(([k,v])=>`<button class="accent-dot ${k===free?'sel':''}" data-a="${k}" style="--a:${v.hex}" aria-label="${v.name}"></button>`).join('')}</div>
    <label class="field-label">Avatar (optionnel)</label>
    ${emojiRow('np', null)}
    <button class="btn primary full" id="np-save">Créer le profil</button>`, { title: 'Nouveau profil' });
  let accent = free;
  const getEmoji = wireEmoji(s.root, null);
  s.root.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { accent = b.dataset.a; s.root.querySelectorAll('[data-a]').forEach(x=>x.classList.toggle('sel', x===b)); });
  s.root.querySelector('#np-save').onclick = async () => {
    const name = s.root.querySelector('#np-name').value.trim() || 'Athlète';
    const p = await createProfile({ name, accent, emoji: getEmoji() });
    s.close(); await setActiveProfile(p.id); toast(`Bienvenue ${name} !`); nav.go('#/home');
  };
}

function editProfile(id) {
  const p = state.profiles.find(x => x.id === id);
  const s = sheet(`
    <label class="field-label">Prénom</label>
    <input class="input" id="ep-name" value="${esc(p.name)}">
    <label class="field-label">Couleur</label>
    <div class="accent-pick" id="ep-accent">${Object.entries(ACCENTS).map(([k,v])=>`<button class="accent-dot ${k===p.accent?'sel':''}" data-a="${k}" style="--a:${v.hex}"></button>`).join('')}</div>
    <label class="field-label">Avatar</label>
    ${emojiRow('ep', p.emoji)}
    <button class="btn primary full" id="ep-save">Enregistrer</button>
    ${state.profiles.length>1?`<button class="btn danger-ghost full" id="ep-del">${icon('trash')} Supprimer ce profil</button>`:''}`,
    { title: 'Modifier le profil' });
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
    if (await confirmDialog({ title:'Supprimer le profil', message:`Supprimer « ${p.name} » et toutes ses données ? Irréversible.`, confirmText:'Supprimer', danger:true })) {
      await deleteProfile(id);
      if (state.activeProfileId === id) await setActiveProfile(state.profiles[0].id);
      toast('Profil supprimé'); nav.go('#/profile');
    }
  });
}

// ---------------- data io ----------------
async function exportData() {
  const stores = ['profiles','settings','routines','workouts','bodyMetrics','favorites','customExercises'];
  const dump = { app:'sport-salle', version: APP_VERSION, exportedAt: new Date().toISOString(), data:{} };
  for (const st of stores) dump.data[st] = await db.getAll(st);
  const blob = new Blob([JSON.stringify(dump)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `sport-salle-sauvegarde-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Sauvegarde exportée ✓');
}

async function importData(file) {
  if (!file) return;
  const ok = await confirmDialog({ title:'Importer', message:'Les données de la sauvegarde seront ajoutées/fusionnées. Continuer ?', confirmText:'Importer' });
  if (!ok) return;
  try {
    const txt = await file.text();
    const dump = JSON.parse(txt);
    if (!dump.data) throw new Error('format');
    for (const [st, rows] of Object.entries(dump.data)) {
      if (!Array.isArray(rows)) continue;
      for (const r of rows) { try { await db.put(st, r); } catch {} }
    }
    toast('Import réussi — rechargement…');
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    toast('Fichier invalide', { type:'error' });
  }
}
