// screens/routines.js — routine list + builder
import { esc, relDate } from '../util.js';
import { nav } from '../store.js';
import { icon, sheet, toast, confirmDialog, promptDialog } from '../ui.js';
import { getExercise, muscleFR } from '../data.js';
import { exImage, emptyState, backBtn } from './common.js';
import { openExercisePicker } from './picker.js';
import {
  listRoutines, getRoutine, saveRoutine, newRoutine, deleteRoutine, mkRoutineItem,
  getActiveWorkout, startWorkout, deleteWorkout,
} from '../model.js';

// ---- shared: begin a routine as a live workout ----
export async function beginRoutine(routine) {
  const active = await getActiveWorkout();
  if (active) {
    const resume = await confirmDialog({
      title: 'Séance déjà en cours',
      message: `« ${active.name} » est en cours. La reprendre, ou la remplacer par ce programme ?`,
      confirmText: 'Reprendre', cancelText: 'Remplacer',
    });
    if (resume) { nav.go(`#/workout/${active.id}`); return; }
    await deleteWorkout(active.id);
  }
  const w = await startWorkout({ routine });
  nav.go(`#/workout/${w.id}`);
}

// ---------------- list ----------------
export async function renderList() {
  const routines = await listRoutines();
  const cards = routines.map(r => {
    const preview = (r.items || []).slice(0, 4).map(it => {
      const ex = getExercise(it.exerciseId);
      return `<span class="rt-ex">${esc(ex ? ex.name : 'Exercice supprimé')}</span>`;
    }).join('');
    const more = (r.items || []).length > 4 ? `<span class="rt-ex more">+${r.items.length - 4}</span>` : '';
    return `
      <div class="rt-card">
        <button class="rt-main" data-nav="#/routines/${r.id}/edit">
          <div class="rt-head"><h3>${esc(r.name)}</h3><span class="mut sm">${(r.items||[]).length} exercice(s)${r.lastPerformedAt ? ' · ' + relDate(r.lastPerformedAt).toLowerCase() : ''}</span></div>
          <div class="rt-exs">${preview || '<span class="mut sm">Vide — ajoute des exercices</span>'}${more}</div>
        </button>
        <button class="btn primary rt-start" data-start="${r.id}">${icon('play')} Démarrer</button>
      </div>`;
  }).join('');

  return `
    <header class="topbar">
      <div class="topbar-l">${backBtn('#/home')}</div>
      <div class="topbar-c"><h1>Programmes</h1></div>
      <div class="topbar-r"><button class="icon-btn" id="rt-new" aria-label="Nouveau">${icon('plus')}</button></div>
    </header>
    <div class="screen-pad">
      ${routines.length ? `<div class="rt-list">${cards}</div>` :
        emptyState('dumbbell', 'Aucun programme', 'Crée ton premier circuit : ajoute les exercices et tes objectifs de séries/reps.',
          `<button class="btn primary" id="rt-new2">${icon('plus')} Créer un programme</button>`)}
      <button class="btn ghost full mt" id="rt-new3">${icon('plus')} Nouveau programme</button>
    </div>`;
}

export function mountList(root) {
  const create = async () => {
    const name = await promptDialog({ title: 'Nouveau programme', label: 'Nom', placeholder: 'Ex. Haut du corps A', confirmText: 'Créer' });
    if (name == null) return;
    const r = await newRoutine(name.trim() || 'Nouveau programme');
    nav.go(`#/routines/${r.id}/edit`);
  };
  root.querySelector('#rt-new').onclick = create;
  root.querySelector('#rt-new2')?.addEventListener('click', create);
  root.querySelector('#rt-new3')?.addEventListener('click', create);
  root.querySelectorAll('[data-start]').forEach(b => b.onclick = async () => {
    const r = await getRoutine(b.dataset.start);
    if (!(r.items || []).length) { toast('Ajoute des exercices d’abord'); nav.go(`#/routines/${r.id}/edit`); return; }
    beginRoutine(r);
  });
}

// ---------------- editor ----------------
export async function renderEdit(params) {
  const r = await getRoutine(params.id);
  if (!r) return `<div class="screen-pad">${emptyState('info','Introuvable','Ce programme n’existe plus.',`<button class="btn ghost" data-nav="#/routines">Retour</button>`)}</div>`;
  const items = (r.items || []).map((it, i) => {
    const ex = getExercise(it.exerciseId);
    const reps = it.targetRepsMin ? `${it.targetRepsMin}${it.targetRepsMax && it.targetRepsMax !== it.targetRepsMin ? '–' + it.targetRepsMax : ''}` : '—';
    return `
      <div class="edit-item" data-i="${i}">
        ${exImage(ex)}
        <div class="edit-info" data-edit="${i}">
          <b>${esc(ex ? ex.name : 'Exercice supprimé')}</b>
          <span>${it.targetSets} × ${reps} reps · repos ${it.restSec||0}s</span>
        </div>
        <div class="edit-ord">
          <button class="icon-btn sm" data-up="${i}" ${i===0?'disabled':''} aria-label="Monter">${icon('arrowup')}</button>
          <button class="icon-btn sm rot" data-down="${i}" ${i===r.items.length-1?'disabled':''} aria-label="Descendre">${icon('arrowup')}</button>
          <button class="icon-btn sm danger" data-del="${i}" aria-label="Retirer">${icon('trash')}</button>
        </div>
      </div>`;
  }).join('');

  return `
    <header class="topbar">
      <div class="topbar-l">${backBtn('#/routines')}</div>
      <div class="topbar-c"><h1 class="ell">Programme</h1></div>
      <div class="topbar-r"><button class="icon-btn" id="e-menu" aria-label="Options">${icon('more')}</button></div>
    </header>
    <div class="screen-pad">
      <input class="input title-input" id="e-name" value="${esc(r.name)}" placeholder="Nom du programme">
      <div class="edit-list">${items || `<p class="mut center pad">Aucun exercice pour l’instant.</p>`}</div>
      <button class="btn ghost full" id="e-add">${icon('plus')} Ajouter un exercice</button>
      <button class="btn primary full mt" id="e-start" ${(r.items||[]).length?'':'disabled'}>${icon('play')} Démarrer cette séance</button>
    </div>`;
}

export function mountEdit(root, params) {
  const id = params.id;
  const nameEl = root.querySelector('#e-name');
  const persistName = async () => { const r = await getRoutine(id); if (r && r.name !== nameEl.value) { r.name = nameEl.value.trim() || 'Programme'; await saveRoutine(r); } };
  nameEl.addEventListener('change', persistName);

  root.querySelector('#e-add').onclick = () => openExercisePicker({
    multi: true, onPick: async (ids) => {
      const r = await getRoutine(id); r.items = r.items || [];
      for (const exId of ids) r.items.push(mkRoutineItem(exId, r.items.length));
      await saveRoutine(r); nav.refresh();
    },
  });

  root.querySelectorAll('[data-edit]').forEach(el => el.onclick = () => editItem(id, +el.dataset.edit));
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const r = await getRoutine(id); r.items.splice(+b.dataset.del, 1);
    r.items.forEach((it, i) => it.order = i); await saveRoutine(r); nav.refresh();
  });
  root.querySelectorAll('[data-up]').forEach(b => b.onclick = () => move(id, +b.dataset.up, -1));
  root.querySelectorAll('[data-down]').forEach(b => b.onclick = () => move(id, +b.dataset.down, 1));

  root.querySelector('#e-start').onclick = async () => { await persistName(); const r = await getRoutine(id); beginRoutine(r); };
  root.querySelector('#e-menu').onclick = () => {
    const s = sheet(`
      <button class="menu-row" id="m-rename">${icon('edit')} Renommer</button>
      <button class="menu-row danger" id="m-del">${icon('trash')} Supprimer le programme</button>`, { title: 'Options' });
    s.root.querySelector('#m-rename').onclick = async () => {
      s.close();
      const name = await promptDialog({ title: 'Renommer', value: nameEl.value, confirmText: 'OK' });
      if (name != null) { nameEl.value = name; await persistName(); nav.refresh(); }
    };
    s.root.querySelector('#m-del').onclick = async () => {
      s.close();
      if (await confirmDialog({ title: 'Supprimer', message: 'Supprimer ce programme ? (ton historique de séances est conservé)', confirmText: 'Supprimer', danger: true })) {
        await deleteRoutine(id); nav.go('#/routines');
      }
    };
  };
}

async function move(id, i, dir) {
  const r = await getRoutine(id); const j = i + dir;
  if (j < 0 || j >= r.items.length) return;
  [r.items[i], r.items[j]] = [r.items[j], r.items[i]];
  r.items.forEach((it, k) => it.order = k); await saveRoutine(r); nav.refresh();
}

function editItem(id, i) {
  getRoutine(id).then(r => {
    const it = r.items[i]; const ex = getExercise(it.exerciseId);
    const s = sheet(`
      <div class="item-edit">
        <div class="field3">
          <label>Séries<input class="input" id="it-sets" type="number" inputmode="numeric" value="${it.targetSets}" min="1" max="20"></label>
          <label>Reps min<input class="input" id="it-rmin" type="number" inputmode="numeric" value="${it.targetRepsMin ?? ''}"></label>
          <label>Reps max<input class="input" id="it-rmax" type="number" inputmode="numeric" value="${it.targetRepsMax ?? ''}"></label>
        </div>
        <div class="field2">
          <label>Charge cible (kg)<input class="input" id="it-w" type="number" inputmode="decimal" value="${it.targetWeightKg ?? ''}" placeholder="—"></label>
          <label>Repos (s)<input class="input" id="it-rest" type="number" inputmode="numeric" value="${it.restSec ?? 120}"></label>
        </div>
        <label class="field-label">Note</label>
        <input class="input" id="it-note" value="${esc(it.notes||'')}" placeholder="Ex. tempo lent, prise serrée…">
        <button class="btn primary full" id="it-save">Enregistrer</button>
      </div>`, { title: ex ? ex.name : 'Exercice' });
    s.root.querySelector('#it-save').onclick = async () => {
      const v = sel => s.root.querySelector(sel).value;
      it.targetSets = Math.max(1, +v('#it-sets') || 3);
      it.targetRepsMin = v('#it-rmin') ? +v('#it-rmin') : null;
      it.targetRepsMax = v('#it-rmax') ? +v('#it-rmax') : null;
      it.targetWeightKg = v('#it-w') ? +v('#it-w') : null;
      it.restSec = v('#it-rest') ? +v('#it-rest') : 120;
      it.notes = v('#it-note');
      await saveRoutine(r); s.close(); nav.refresh();
    };
  });
}
