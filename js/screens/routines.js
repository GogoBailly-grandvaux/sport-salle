// screens/routines.js — routine list + builder + templates + sharing
import { t } from '../i18n.js';
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
import { TEMPLATES, addTemplate, routinePayload, importRoutinePayload } from '../templates.js';
import { call, isLoggedIn } from '../api.js';

// ---- shared: begin a routine as a live workout ----
export async function beginRoutine(routine) {
  const active = await getActiveWorkout();
  if (active) {
    const resume = await confirmDialog({
      title: t('Séance déjà en cours','Workout already in progress'),
      message: `« ${active.name} » ${t('est en cours. La reprendre, ou la remplacer par ce programme ?','is in progress. Resume it, or replace it with this program?')}`,
      confirmText: t('Reprendre','Resume'), cancelText: t('Remplacer','Replace'),
    });
    if (resume === null) return;                 // fermé (X/backdrop/Échap) → on ne touche à rien
    if (resume) { nav.go(`#/workout/${active.id}`); return; }
    await deleteWorkout(active.id);              // « Remplacer » explicite uniquement
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
      return `<span class="rt-ex">${esc(ex ? ex.name : t('Exercice supprimé','Deleted exercise'))}</span>`;
    }).join('');
    const more = (r.items || []).length > 4 ? `<span class="rt-ex more">+${r.items.length - 4}</span>` : '';
    return `
      <div class="rt-card">
        <button class="rt-main" data-nav="#/routines/${r.id}/edit">
          <div class="rt-head"><h3>${esc(r.name)}</h3><span class="mut sm">${(r.items||[]).length} exercice${(r.items||[]).length>1?'s':''}${r.lastPerformedAt ? ' · ' + relDate(r.lastPerformedAt).toLowerCase() : ''}</span></div>
          <div class="rt-exs">${preview || `<span class="mut sm">${t('Vide — ajoute des exercices','Empty — add exercises')}</span>`}${more}</div>
        </button>
        <button class="btn primary rt-start" data-start="${r.id}">${icon('play')} ${t('Démarrer','Start')}</button>
      </div>`;
  }).join('');

  return `
    <header class="topbar">
      <div class="topbar-l">${backBtn('#/home')}</div>
      <div class="topbar-c"><h1>${t('Programmes','Programs')}</h1></div>
      <div class="topbar-r">
        <button class="icon-btn" id="rt-import" aria-label="${t('Importer','Import')}">${icon('upload')}</button>
        <button class="icon-btn" id="rt-new" aria-label="${t('Nouveau','New')}">${icon('plus')}</button>
      </div>
    </header>
    <div class="screen-pad">
      <button class="tpl-banner coach" id="rt-coach">
        <div class="tpl-banner-t"><b>${t('Le coach génère TON programme','The coach builds YOUR program')}</b><span>${t('Objectif, niveau, jours, matériel → ta semaine prête en 30 s','Goal, level, days, equipment → your week ready in 30 s')}</span></div>
        ${icon('right')}
      </button>
      <button class="tpl-banner" id="rt-templates">
        <div class="tpl-banner-t"><b>✨ ${t('Modèles prêts à l’emploi','Ready-made templates')}</b><span>${t('Full body, Push/Pull/Legs, maison… à personnaliser','Full body, Push/Pull/Legs, home… all customizable')}</span></div>
        ${icon('right')}
      </button>
      ${routines.length ? `<div class="rt-list">${cards}</div>
      <button class="btn ghost full mt" id="rt-new3">${icon('plus')} ${t('Nouveau programme','New program')}</button>` :
        emptyState('dumbbell', t('Aucun programme','No programs'), t('Pars d’un modèle prêt à l’emploi, ou crée ton circuit de zéro.','Start from a template, or build your own from scratch.'),
          `<button class="btn primary" id="rt-new2">${icon('plus')} ${t('Créer un programme','Create a program')}</button>`)}
      <input type="file" id="rt-file" accept="application/json,.json" hidden>
    </div>`;
}

export function mountList(root) {
  const create = async () => {
    const name = await promptDialog({ title: t('Nouveau programme','New program'), label: t('Nom','Name'), placeholder: t('Ex. Haut du corps A','E.g. Upper body A'), confirmText: t('Créer','Create') });
    if (name == null) return;
    const r = await newRoutine(name.trim() || t('Nouveau programme','New program'));
    nav.go(`#/routines/${r.id}/edit`);
  };
  root.querySelector('#rt-new').onclick = create;
  root.querySelector('#rt-new2')?.addEventListener('click', create);
  root.querySelector('#rt-new3')?.addEventListener('click', create);
  root.querySelector('#rt-coach').onclick = () => nav.go('#/coach');
  root.querySelector('#rt-templates').onclick = openTemplates;
  const fileInput = root.querySelector('#rt-file');
  root.querySelector('#rt-import').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.kind === 'routine') {
        const r = await importRoutinePayload(d);
        toast(`« ${r.name} » ${t('importé','imported')} ✓`); nav.refresh();
      } else if (d.app === 'sport-salle' && d.data) {
        toast(t('Ceci est une sauvegarde complète — importe-la depuis Profil → Données','This is a full backup — import it from Profile → Data'), { duration: 5000 });
      } else throw new Error('format');
    } catch { toast(t('Fichier de programme invalide','Invalid program file'), { type: 'error' }); }
    fileInput.value = '';
  };
  root.querySelectorAll('[data-start]').forEach(b => b.onclick = async () => {
    const r = await getRoutine(b.dataset.start);
    if (!(r.items || []).length) { toast(t('Ajoute des exercices d’abord','Add exercises first')); nav.go(`#/routines/${r.id}/edit`); return; }
    beginRoutine(r);
  });
}

// ---------------- template gallery ----------------
function openTemplates() {
  const card = (t_) => `
    <div class="tpl-card">
      <div class="tpl-head">
        <div><b>${esc(t_.name)}</b><div class="tpl-meta"><span class="tpl-pill">${esc(t_.level)}</span><span class="tpl-pill alt">${esc(t_.goal)}</span><span class="mut sm">${t_.items.length} ${t('exercices','exercises')}</span></div></div>
        <button class="btn primary sm" data-add="${t.id}">${icon('plus')} Ajouter</button>
      </div>
      <p class="tpl-tag">${esc(t_.tagline)}</p>
      <div class="rt-exs">${t_.items.slice(0, 4).map(it => { const ex = getExercise(it.ex); return `<span class="rt-ex">${esc(ex ? ex.name : it.ex)}</span>`; }).join('')}${t_.items.length > 4 ? `<span class="rt-ex more">+${t_.items.length - 4}</span>` : ''}</div>
    </div>`;
  const s = sheet(`<div class="tpl-list">${TEMPLATES.map(card).join('')}</div>
    <p class="mut sm center" style="margin-top:10px">${t('Chaque modèle devient TON programme : modifie exercices, séries et repos librement.','Every template becomes YOUR program: change exercises, sets and rests freely.')}</p>`,
    { title: t('Modèles de programmes','Program templates'), cls: 'tall' });
  s.root.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const tpl = TEMPLATES.find(t => t.id === b.dataset.add);
    const r = await addTemplate(tpl);
    s.close(); toast(`« ${r.name} » ${t('ajouté à tes programmes','added to your programs')} ✓`);
    nav.refresh();
  });
}

// ---------------- publication (amis / groupes) ----------------
async function publishRoutine(r) {
  let groups = [];
  try { groups = (await call('groups', 'mine')).groups; } catch {}
  const s = sheet(`
    <p class="mut sm">Où publier « ${esc(r.name)} » ?</p>
    <button class="menu-row" data-dest="friends">${icon('users')} Visible par mes amis</button>
    ${groups.map(g => `<button class="menu-row" data-dest="g-${g.id}">${icon('users')} Groupe « ${esc(g.name)} »</button>`).join('')}
    ${!groups.length ? '<p class="mut sm center">Crée un groupe dans l’onglet Social pour publier dedans.</p>' : ''}`,
    { title: t('Publier le programme','Publish program') });
  s.root.querySelectorAll('[data-dest]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const dest = b.dataset.dest;
    try {
      const pub = await call('programs', 'publish', {
        name: r.name,
        payload: routinePayload(r),
        groupId: dest.startsWith('g-') ? +dest.slice(2) : null,
      });
      // publication aux amis -> le programme apparaît aussi dans le fil
      if (dest === 'friends' && pub?.id) {
        try { await call('posts', 'publish', { kind: 'program', content: { sharedId: pub.id, name: r.name, exos: (r.items || []).length } }); } catch {}
      }
      s.close();
      toast(dest === 'friends' ? t('Publié — visible par tes amis et dans le fil ✓','Published — visible to your friends and in the feed ✓') : t('Publié dans le groupe ✓','Published to the group ✓'), { duration: 4000 });
    } catch (e) { toast(e.message, { type: 'error' }); b.disabled = false; }
  });
}

// ---------------- share ----------------
async function shareRoutine(r) {
  const payload = routinePayload(r);
  const json = JSON.stringify(payload);
  const slug = (r.name || 'programme').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'programme';
  const fname = `${slug}.sportsalle.json`;
  try {
    const file = new File([json], fname, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: r.name, text: `Mon programme « ${r.name} » sur Sport Salle` });
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  // fallback : téléchargement
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Fichier du programme téléchargé — envoie-le à ton proche ✓', { duration: 4500 });
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
          <b>${esc(ex ? ex.name : t('Exercice supprimé','Deleted exercise'))}</b>
          <span>${it.targetSets} × ${reps} reps · ${t('repos','rest')} ${it.restSec||0}s</span>
        </div>
        <div class="edit-ord">
          <button class="icon-btn sm" data-up="${i}" ${i===0?'disabled':''} aria-label="${t('Monter','Move up')}">${icon('arrowup')}</button>
          <button class="icon-btn sm rot" data-down="${i}" ${i===r.items.length-1?'disabled':''} aria-label="${t('Descendre','Move down')}">${icon('arrowup')}</button>
          <button class="icon-btn sm danger" data-del="${i}" aria-label="${t('Retirer','Remove')}">${icon('trash')}</button>
        </div>
      </div>`;
  }).join('');

  return `
    <header class="topbar">
      <div class="topbar-l">${backBtn('#/routines')}</div>
      <div class="topbar-c"><h1 class="ell">${t('Programme','Program')}</h1></div>
      <div class="topbar-r"><button class="icon-btn" id="e-menu" aria-label="Options">${icon('more')}</button></div>
    </header>
    <div class="screen-pad">
      <input class="input title-input" id="e-name" value="${esc(r.name)}" placeholder="${t('Nom du programme','Program name')}">
      <div class="edit-list">${items || `<p class="mut center pad">${t('Aucun exercice pour l’instant.','No exercises yet.')}</p>`}</div>
      <button class="btn ghost full" id="e-add">${icon('plus')} Ajouter un exercice</button>
      <button class="btn primary full mt" id="e-start" ${(r.items||[]).length?'':'disabled'}>${icon('play')} ${t('Démarrer cette séance','Start this workout')}</button>
    </div>`;
}

export function mountEdit(root, params) {
  const id = params.id;
  const nameEl = root.querySelector('#e-name');
  const persistName = async () => { const r = await getRoutine(id); if (r && r.name !== nameEl.value) { r.name = nameEl.value.trim() || t('Programme','Program'); await saveRoutine(r); } };
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
    const r = await getRoutine(id);
    const idx = +b.dataset.del;
    const [removed] = r.items.splice(idx, 1);
    r.items.forEach((it, i) => it.order = i); await saveRoutine(r); nav.refresh();
    const ex = getExercise(removed.exerciseId);
    toast(`« ${ex ? ex.name : t('Exercice','Exercise')} » ${t('retiré','removed')}`, {
      actionText: t('Annuler','Undo'), duration: 5000,
      onAction: async () => {
        const r2 = await getRoutine(id); if (!r2) return;
        r2.items.splice(Math.min(idx, r2.items.length), 0, removed);
        r2.items.forEach((it, i) => it.order = i);
        await saveRoutine(r2); nav.refresh();
      },
    });
  });
  root.querySelectorAll('[data-up]').forEach(b => b.onclick = () => move(id, +b.dataset.up, -1));
  root.querySelectorAll('[data-down]').forEach(b => b.onclick = () => move(id, +b.dataset.down, 1));

  root.querySelector('#e-start').onclick = async () => { await persistName(); const r = await getRoutine(id); beginRoutine(r); };
  root.querySelector('#e-menu').onclick = () => {
    const s = sheet(`
      ${isLoggedIn() ? `<button class="menu-row" id="m-publish">${icon('users')} ${t('Publier (amis / groupe)','Publish (friends / group)')}</button>` : ''}
      <button class="menu-row" id="m-share">${icon('upload')} ${t('Partager en fichier','Share as file')}</button>
      <button class="menu-row" id="m-rename">${icon('edit')} ${t('Renommer','Rename')}</button>
      <button class="menu-row danger" id="m-del">${icon('trash')} ${t('Supprimer le programme','Delete program')}</button>`, { title: 'Options' });
    s.root.querySelector('#m-publish')?.addEventListener('click', async () => {
      s.close(); await persistName();
      const r = await getRoutine(id);
      if (!(r.items || []).length) { toast(t('Ajoute des exercices avant de publier','Add exercises before publishing')); return; }
      publishRoutine(r);
    });
    s.root.querySelector('#m-share').onclick = async () => {
      s.close(); await persistName();
      const r = await getRoutine(id);
      if (!(r.items || []).length) { toast(t('Ajoute des exercices avant de partager','Add exercises before sharing')); return; }
      shareRoutine(r);
    };
    s.root.querySelector('#m-rename').onclick = async () => {
      s.close();
      const name = await promptDialog({ title: t('Renommer','Rename'), value: nameEl.value, confirmText: 'OK' });
      if (name != null) { nameEl.value = name; await persistName(); nav.refresh(); }
    };
    s.root.querySelector('#m-del').onclick = async () => {
      s.close();
      if (await confirmDialog({ title: t('Supprimer','Delete'), message: t('Supprimer ce programme ? (ton historique de séances est conservé)','Delete this program? (your workout history is kept)'), confirmText: t('Supprimer','Delete'), danger: true })) {
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
          <label>${t('Séries','Sets')}<input class="input" id="it-sets" type="number" inputmode="numeric" value="${it.targetSets}" min="1" max="20"></label>
          <label>Reps min<input class="input" id="it-rmin" type="number" inputmode="numeric" value="${it.targetRepsMin ?? ''}"></label>
          <label>Reps max<input class="input" id="it-rmax" type="number" inputmode="numeric" value="${it.targetRepsMax ?? ''}"></label>
        </div>
        <div class="field2">
          <label>${t('Charge cible (kg)','Target weight (kg)')}<input class="input" id="it-w" type="number" inputmode="decimal" value="${it.targetWeightKg ?? ''}" placeholder="—"></label>
          <label>Repos (s)<input class="input" id="it-rest" type="number" inputmode="numeric" value="${it.restSec ?? 120}"></label>
        </div>
        <label class="field-label">Note</label>
        <input class="input" id="it-note" value="${esc(it.notes||'')}" placeholder="Ex. tempo lent, prise serrée…">
        <button class="btn primary full" id="it-save">Enregistrer</button>
      </div>`, { title: ex ? ex.name : t('Exercice','Exercise') });
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
