// screens/progress.js — progress hub, per-exercise charts, body metrics
import { esc, fmtDate, relDate, todayISO, fmtWeight, round } from '../util.js';
import { ps, state, nav } from '../store.js';
import { icon, sheet, promptDialog, confirmDialog, toast } from '../ui.js';
import { getExercise, muscleFR, MUSCLE_GROUP } from '../data.js';
import { emptyState, backBtn, exImage, GROUP_COLOR } from './common.js';
import { openExercisePicker } from './picker.js';
import { listWorkouts, listMetrics, addMetric, deleteMetric, latestMetric } from '../model.js';
import {
  exerciseHistory, allTimeBests, weeklyVolumeSeries, muscleVolumeThisWeek, emaTrend,
  e1rm, isWorkingSet, thisWeekCount, goalStreak,
} from '../analytics.js';
import { lineChart, barChart, sparkline } from '../charts.js';

// ---------------- hub ----------------
export async function renderHub() {
  const workouts = await listWorkouts();
  const unit = ps('weightUnit');
  const bw = await listMetrics('weight');

  // PR feed
  const prs = [];
  for (const w of workouts) for (const pr of (w.prs || [])) prs.push({ ...pr, ts: w.completedAt });
  prs.sort((a, b) => b.ts - a.ts);
  const prFeed = prs.slice(0, 12).map(pr => {
    const ex = getExercise(pr.exerciseId);
    const label = pr.type === 'estimated1rm' ? '1RM est.' : pr.type === 'maxWeight' ? 'Charge max' : 'Volume/série';
    return `<div class="pr-row" data-nav="#/progress/exercise/${encodeURIComponent(pr.exerciseId)}">${icon('trophy')}<div><b>${esc(ex?ex.name:'')}</b><span>${label} · ${Math.round(pr.value)} ${unit} · ${relDate(pr.ts).toLowerCase()}</span></div></div>`;
  }).join('');

  // weekly volume
  const wv = weeklyVolumeSeries(workouts, 8);
  const hasVol = wv.some(x => x.value > 0);

  // muscle volume this week
  const mv = muscleVolumeThisWeek(workouts, state.libraryById);
  const groups = new Map();
  for (const [m, n] of mv) { const g = MUSCLE_GROUP[m] || m; groups.set(g, (groups.get(g) || 0) + n); }
  const gArr = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  const maxG = Math.max(1, ...gArr.map(x => x[1]));
  const muscleBars = gArr.length ? gArr.map(([g, n]) => `
    <div class="mv-row"><span class="mv-name">${esc(g)}</span>
      <div class="mv-bar"><div style="width:${n/maxG*100}%;background:${GROUP_COLOR[g]||'var(--accent)'}"></div></div>
      <span class="mv-n">${round(n,1)}</span></div>`).join('')
    : `<p class="mut sm">Pas encore de séries cette semaine.</p>`;

  // top exercises by frequency
  const freq = new Map();
  for (const w of workouts) for (const ex of (w.exercises||[])) if ((ex.sets||[]).some(isWorkingSet)) freq.set(ex.exerciseId, (freq.get(ex.exerciseId)||0)+1);
  const top = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
  const topList = top.map(([id,n]) => { const ex = getExercise(id); return `<button class="ex-mini" data-nav="#/progress/exercise/${encodeURIComponent(id)}">${exImage(ex)}<div><b>${esc(ex?ex.name:'')}</b><span>${n} séance(s)</span></div>${icon('right')}</button>`; }).join('');

  if (!workouts.length) {
    return `${hubHeader()}<div class="screen-pad">${emptyState('chart','Pas encore de données','Enregistre quelques séances et tes courbes de progression apparaîtront ici.',`<button class="btn primary" data-nav="#/home">Démarrer une séance</button>`)}</div>`;
  }

  const { coachWeekly } = await import('../coach.js');
  const weekly = coachWeekly(workouts, state.libraryById, ps('weeklyGoal'));

  return `${hubHeader()}
    <div class="screen-pad">
      ${weekly ? `<section class="card coach-card"><div class="coach-head"><span class="coach-emoji">${weekly.emoji}</span><b>${esc(weekly.title)}</b></div><p>${esc(weekly.text)}</p></section>` : ''}
      <button class="btn primary full" id="pg-pick">${icon('search')} Progression d’un exercice</button>

      <section class="card">
        <h3 class="card-t">Volume par semaine</h3>
        ${hasVol ? barChart(wv, { valueKey:'value', height:140 }) : `<p class="mut sm">Pas assez de données.</p>`}
      </section>

      <section class="card">
        <h3 class="card-t">Séries par muscle · cette semaine</h3>
        ${muscleBars}
      </section>

      ${prFeed ? `<section class="card"><h3 class="card-t">${icon('trophy')} Records récents</h3>${prFeed}</section>` : ''}

      ${topList ? `<section class="card"><h3 class="card-t">Exercices suivis</h3>${topList}</section>` : ''}

      <section class="card bw" data-nav="#/progress/body">
        <div class="recap-h"><span class="mut">Mesures corporelles</span>${icon('right')}</div>
        ${bw.length ? `<div class="bw-row"><b>${fmtWeight(bw[bw.length-1].value, unit)}</b>${sparkline(bw.map(m=>m.value))}</div>` : `<p class="mut sm">Ajoute ton poids pour suivre ta transformation.</p>`}
      </section>
    </div>`;
}
function hubHeader() {
  return `<header class="topbar"><div class="topbar-l">${backBtn('#/home')}</div><div class="topbar-c"><h1>Progrès</h1></div><div class="topbar-r"></div></header>`;
}
export function mountHub(root) {
  root.querySelector('#pg-pick')?.addEventListener('click', () => openExercisePicker({ multi:false, onPick: ids => nav.go(`#/progress/exercise/${encodeURIComponent(ids[0])}`) }));
}

// ---------------- per-exercise ----------------
export async function renderExercise(params) {
  const id = decodeURIComponent(params.id);
  const ex = getExercise(id);
  const workouts = await listWorkouts();
  const hist = exerciseHistory(workouts, id, ps('e1rmFormula'));
  const best = allTimeBests(workouts, id, ps('e1rmFormula'));
  const unit = ps('weightUnit');

  // rep-max table
  const repMax = {};
  for (const w of workouts) for (const e of (w.exercises||[])) if (e.exerciseId === id)
    for (const s of e.sets) if (isWorkingSet(s) && s.reps>=1 && s.reps<=10)
      repMax[s.reps] = Math.max(repMax[s.reps]||0, s.weightKg||0);
  const rmRows = Object.keys(repMax).map(Number).sort((a,b)=>a-b).map(r => `<div class="rm-cell"><b>${repMax[r]} ${unit}</b><span>${r} rep${r>1?'s':''}</span></div>`).join('');

  const body = hist.length ? `
    <div class="ex-kpis">
      <div><b>${best.maxWeight||'—'}${best.maxWeight?' '+unit:''}</b><span>Charge max</span></div>
      <div><b>${best.bestE1rm?Math.round(best.bestE1rm):'—'}${best.bestE1rm?' '+unit:''}</b><span>1RM estimé</span></div>
      <div><b>${best.sessions}</b><span>séances</span></div>
    </div>
    <section class="card"><h3 class="card-t">1RM estimé</h3>${hist.length>1?lineChart(hist,{valueKey:'bestE1rm',fmt:v=>Math.round(v),height:150}):`<p class="mut sm">Encore ${2-hist.length} séance pour tracer la courbe.</p>`}</section>
    <section class="card"><h3 class="card-t">Volume par séance</h3>${barChart(hist,{valueKey:'volume',height:130})}</section>
    ${rmRows?`<section class="card"><h3 class="card-t">Records par répétitions</h3><div class="rm-grid">${rmRows}</div></section>`:''}
    ` : emptyState('chart','Aucune donnée','Tu n’as pas encore fait cet exercice en séance.','');

  return `
    <header class="topbar"><div class="topbar-l">${backBtn('#/progress')}</div><div class="topbar-c"><h1 class="ell">${esc(ex?ex.name:'Exercice')}</h1></div><div class="topbar-r"><button class="icon-btn" data-nav="#/library/${encodeURIComponent(id)}">${icon('info')}</button></div></header>
    <div class="screen-pad">${body}</div>`;
}
export function mountExercise() {}

// ---------------- body metrics ----------------
const METRICS = { weight: { label:'Poids', unit:'kg' }, bodyfat: { label:'Masse grasse', unit:'%' }, waist: { label:'Tour de taille', unit:'cm' } };
let bodyType = 'weight';

export async function renderBody() {
  const rows = await listMetrics(bodyType);
  const meta = METRICS[bodyType];
  const pts = rows.map(m => ({ ts: new Date(m.date).getTime(), value: m.value }));
  const trend = emaTrend(pts, 0.15);
  const seg = Object.entries(METRICS).map(([k,v]) => `<button class="seg ${k===bodyType?'on':''}" data-type="${k}">${v.label}</button>`).join('');
  const list = rows.slice().reverse().slice(0,30).map(m => `<div class="metric-row"><span>${fmtDate(new Date(m.date).getTime(),{year:true})}</span><b>${m.value} ${meta.unit}</b><button class="icon-btn sm danger" data-del="${m.id}">${icon('trash')}</button></div>`).join('');

  return `
    <header class="topbar"><div class="topbar-l">${backBtn('#/progress')}</div><div class="topbar-c"><h1>Mesures</h1></div><div class="topbar-r"><button class="icon-btn" id="bm-add" aria-label="Ajouter">${icon('plus')}</button></div></header>
    <div class="screen-pad">
      <div class="segmented">${seg}</div>
      <section class="card">
        <h3 class="card-t">${meta.label} (${meta.unit})</h3>
        ${pts.length>1 ? lineChart(trend,{valueKey:'value',trendKey:'trend',fmt:v=>round(v,1),height:150}) : (pts.length?`<div class="single-val">${pts[0].value} ${meta.unit}</div>`:`<p class="mut sm">Aucune mesure. Appuie sur + pour commencer.</p>`)}
      </section>
      ${rows.length?`<section class="card"><h3 class="card-t">Historique</h3><div class="metric-list">${list}</div></section>`:''}
    </div>`;
}
export function mountBody(root) {
  root.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { bodyType = b.dataset.type; nav.refresh(); });
  root.querySelector('#bm-add').onclick = async () => {
    const meta = METRICS[bodyType];
    const v = await promptDialog({ title: `Ajouter — ${meta.label}`, label: `Valeur (${meta.unit})`, type:'number', placeholder: meta.unit });
    if (v == null || v === '' || isNaN(+v)) return;
    await addMetric({ type: bodyType, value: round(+v,2), date: todayISO() });
    toast('Mesure enregistrée ✓'); nav.refresh();
  };
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await deleteMetric(b.dataset.del); nav.refresh(); });
}
