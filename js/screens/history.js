// screens/history.js — session list + detail
import { esc, fmtDate, relDate, fmtTime, fmtDuration } from '../util.js';
import { ps, nav } from '../store.js';
import { icon, confirmDialog, toast } from '../ui.js';
import { getExercise, muscleFR } from '../data.js';
import { exImage, emptyState, backBtn } from './common.js';
import { listWorkouts, getWorkout, deleteWorkout } from '../model.js';
import { workoutStats, exerciseSummary, e1rm } from '../analytics.js';
import { beginRoutine } from './routines.js';

export async function renderList() {
  const ws = await listWorkouts();
  const unit = ps('weightUnit');
  let html = '', lastMonth = '';
  for (const w of ws) {
    const d = new Date(w.completedAt || w.startedAt);
    const mk = d.getFullYear() + '-' + d.getMonth();
    if (mk !== lastMonth) { lastMonth = mk; html += `<h2 class="month-h">${['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'][d.getMonth()]} ${d.getFullYear()}</h2>`; }
    const st = workoutStats(w);
    html += `<button class="hist-row" data-nav="#/history/${w.id}">
      <div class="hist-date"><b>${d.getDate()}</b><span>${['dim','lun','mar','mer','jeu','ven','sam'][d.getDay()]}</span></div>
      <div class="hist-info"><b>${esc(w.name)}</b><span>${st.exercises} exercices · ${st.sets} séries · ${Math.round(st.volume).toLocaleString('fr-FR')} ${unit}</span></div>
      ${(w.prs||[]).length ? `<span class="pr-pill">${icon('trophy')}${w.prs.length}</span>` : `<span class="hist-dur">${fmtDuration(w.durationSec)}</span>`}
    </button>`;
  }
  return `
    <header class="topbar">
      <div class="topbar-l">${backBtn('#/home')}</div>
      <div class="topbar-c"><h1>Historique</h1></div>
      <div class="topbar-r"></div>
    </header>
    <div class="screen-pad">
      ${ws.length ? html : emptyState('history','Aucune séance','Ta première séance apparaîtra ici. Lance-toi !',`<button class="btn primary" data-nav="#/home">Démarrer</button>`)}
    </div>`;
}
export function mountList() {}

export async function renderDetail(params) {
  const w = await getWorkout(params.id);
  if (!w) return `<div class="screen-pad">${emptyState('info','Introuvable','',`<button class="btn ghost" data-nav="#/history">Retour</button>`)}</div>`;
  const unit = ps('weightUnit'); const st = workoutStats(w);
  const prIds = new Set((w.prs||[]).map(p => p.exerciseId));

  const blocks = (w.exercises||[]).map(ex => {
    const meta = getExercise(ex.exerciseId);
    const sum = exerciseSummary(ex, ps('e1rmFormula'));
    let n = 0;
    const rows = ex.sets.map(s => {
      const label = s.type === 'warmup' ? 'É' : String(++n);
      const est = e1rm(s.weightKg, s.reps, ps('e1rmFormula'));
      return `<div class="hd-set ${s.type}"><span class="hd-n">${label}</span><span>${s.weightKg ?? '–'} ${unit} × ${s.reps ?? '–'}</span>${est ? `<span class="hd-e1">1RM ~${Math.round(est)}</span>` : '<span></span>'}</div>`;
    }).join('');
    return `<section class="card hd-ex">
      <div class="hd-head" data-nav="#/library/${encodeURIComponent(ex.exerciseId)}">${exImage(meta)}<div><b>${esc(meta?meta.name:'Exercice')}</b><span>${sum?Math.round(sum.volume).toLocaleString('fr-FR')+' '+unit:''}</span></div>${prIds.has(ex.exerciseId)?`<span class="pr-pill sm">${icon('trophy')}</span>`:''}</div>
      <div class="hd-sets">${rows}</div>
      ${ex.notes ? `<p class="hd-note">“${esc(ex.notes)}”</p>` : ''}
    </section>`;
  }).join('');

  return `
    <header class="topbar">
      <div class="topbar-l">${backBtn('#/history')}</div>
      <div class="topbar-c"><h1 class="ell">${esc(w.name)}</h1><span class="topbar-sub">${fmtDate(w.completedAt, {withDay:true})} · ${fmtTime(w.completedAt)}</span></div>
      <div class="topbar-r"><button class="icon-btn danger" id="hd-del" aria-label="Supprimer">${icon('trash')}</button></div>
    </header>
    <div class="screen-pad">
      <div class="summary-stats compact">
        <div><b>${fmtDuration(w.durationSec)}</b><span>durée</span></div>
        <div><b>${st.sets}</b><span>séries</span></div>
        <div><b>${st.reps}</b><span>reps</span></div>
        <div><b>${Math.round(st.volume).toLocaleString('fr-FR')}</b><span>${unit}</span></div>
      </div>
      ${w.notes ? `<p class="sess-note">${esc(w.notes)}</p>` : ''}
      ${blocks}
      <button class="btn primary full mt" id="hd-redo">${icon('play')} Refaire cette séance</button>
    </div>`;
}
export function mountDetail(root, params) {
  root.querySelector('#hd-del').onclick = async () => {
    if (await confirmDialog({ title: 'Supprimer', message: 'Supprimer cette séance de l’historique ?', confirmText: 'Supprimer', danger: true })) {
      await deleteWorkout(params.id); nav.go('#/history');
    }
  };
  root.querySelector('#hd-redo').onclick = async () => {
    const w = await getWorkout(params.id);
    const routine = { id: null, name: w.name, items: (w.exercises||[]).map((ex, i) => ({
      id: 'x', exerciseId: ex.exerciseId, order: i, supersetGroup: ex.supersetGroup || null,
      targetSets: ex.sets.length || 3, targetRepsMin: null, targetRepsMax: null, targetWeightKg: null, restSec: ex._restSec || ps('defaultRestSec'), notes: '',
    })) };
    beginRoutine(routine);
  };
}
