// screens/workout.js — live workout logging + summary
import { t } from '../i18n.js';
import { esc, uid, debounce, vibrate, fmtDuration, fmtClock, trimNum } from '../util.js';
import { state, ps, nav } from '../store.js';
import { icon, sheet, toast, confirmDialog, confetti } from '../ui.js';
import { getExercise, muscleFR } from '../data.js';
import { exImage, emptyState } from './common.js';
import { openExercisePicker } from './picker.js';
import { getWorkout, saveWorkout, deleteWorkout, finishWorkout, mkSet, mkExercise, lastPerformance } from '../model.js';
import { overloadHint } from '../coach.js';
import { praise } from '../voice.js';
import { call, isLoggedIn } from '../api.js';
import { liveStart, liveBeat, liveStop } from '../livework.js';

let W = null;
let prevMap = new Map();       // exerciseId -> [prev sets]
let elapsedTimer = null;
let onVis = null;              // handler visibilitychange (chrono actif)
let rest = { timer: null, endsAt: 0, total: 0, hideTimeout: null };
let audioCtx = null;

const persist = debounce(() => { if (W) saveWorkout(W); }, 350);
const findEx = id => W.exercises.find(e => e.id === id);
const findSet = (ex, id) => ex.sets.find(s => s.id === id);

function setNumberMap(ex) {
  let n = 0; const map = {};
  for (const s of ex.sets) { if (s.type === 'warmup') map[s.id] = 'W'; else { n++; map[s.id] = String(n); } }
  return map;
}

function setRowHtml(ex, s, numLabel) {
  const prev = prevMap.get(ex.exerciseId);
  const idx = ex.sets.indexOf(s);
  const pv = prev && prev[idx] ? `${prev[idx].weightKg ?? '–'}×${prev[idx].reps ?? '–'}` : '';
  return `<div class="set-row ${s.done ? 'done' : ''} type-${s.type}" data-set="${s.id}">
    <button class="set-n" data-act="type" title="${t('Type de série','Set type')}">${numLabel}</button>
    <button class="set-prev" data-act="prev" ${pv ? '' : 'disabled'}>${pv || '—'}</button>
    <input class="set-in w" data-f="w" type="number" inputmode="decimal" aria-label="Poids (kg)" value="${s.weightKg ?? ''}" placeholder="${prev && prev[idx] ? prev[idx].weightKg ?? 'kg' : 'kg'}">
    <input class="set-in r" data-f="r" type="number" inputmode="numeric" aria-label="Répétitions" value="${s.reps ?? ''}" placeholder="${prev && prev[idx] ? prev[idx].reps ?? 'reps' : 'reps'}">
    <button class="set-do" data-act="done" aria-label="Valider la série">${icon('check')}</button>
  </div>`;
}

// ---- supersets : enchaîner 2+ exercices, repos seulement après le dernier ----
const SS_COLORS = ['#54c5f2', '#f2679b', '#b989f2', '#3ee0a8', '#f2a63c'];
function ssColor(group) {
  const groups = [...new Set(W.exercises.filter(e => e.supersetGroup).sort((a, b) => a.order - b.order).map(e => e.supersetGroup))];
  return SS_COLORS[Math.max(0, groups.indexOf(group)) % SS_COLORS.length];
}
function ssPartners(ex) {
  return W.exercises.filter(e => e.supersetGroup && e.supersetGroup === ex.supersetGroup);
}
function isLastOfSuperset(ex) {
  const p = ssPartners(ex).sort((a, b) => a.order - b.order);
  return !p.length || p[p.length - 1].id === ex.id;
}
function applySsDom(exId) {
  const el = document.querySelector(`.wk-ex[data-ex="${exId}"]`);
  const ex = W.exercises.find(e => e.id === exId);
  if (!el || !ex) return;
  el.classList.toggle('ss', !!ex.supersetGroup);
  if (ex.supersetGroup) el.style.setProperty('--ssc', ssColor(ex.supersetGroup));
  el.querySelector('.ss-chip')?.remove();
  if (ex.supersetGroup) el.insertAdjacentHTML('afterbegin', `<div class="ss-chip">${icon('swords')} Superset</div>`);
}
function supersetSheet(ex) {
  const others = W.exercises.filter(e => e.id !== ex.id);
  if (!others.length) { toast(t('Ajoute d’abord un autre exercice.','Add another exercise first.')); return; }
  const name = (id) => { const m = getExercise(id); return m ? m.name : 'Exercice'; };
  const s = sheet(`
    <p class="mut sm">${t('Choisis l’exercice à enchaîner avec','Pick the exercise to chain with')} <b>${esc(name(ex.exerciseId))}</b> — ${t('le repos ne démarre qu’après le dernier du groupe.','rest only starts after the last one of the group.')}</p>
    ${others.map(o => `<button class="menu-row" data-p="${o.id}">${o.supersetGroup ? `${icon('swords')} ` : ''}${esc(name(o.exerciseId))}</button>`).join('')}
  `, { title: t('Superset','Superset') });
  s.root.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
    const partner = W.exercises.find(e => e.id === b.dataset.p);
    if (!partner) return;
    const group = partner.supersetGroup || uid();
    partner.supersetGroup = group; ex.supersetGroup = group;
    persist(); s.close();
    ssPartners(ex).forEach(e => applySsDom(e.id));
    toast(t('Superset créé — enchaîne-les !','Superset created — chain them!'));
    vibrate(15);
  });
}

function exBlockHtml(ex) {
  const meta = getExercise(ex.exerciseId);
  const nmap = setNumberMap(ex);
  const rows = ex.sets.map(s => setRowHtml(ex, s, nmap[s.id])).join('');
  const target = ex._targetReps ? `<span class="ex-target">${t('cible','target')} ${ex._targetReps} reps</span>` : '';
  const hint = overloadHint(prevMap.get(ex.exerciseId), ex._targetRepsMax);
  const coachChip = hint
    ? `<button class="coach-chip" data-act="applysuggest" data-kg="${hint.suggestKg}" title="${esc(hint.reason)}">${icon('target')} ${t('Coach : tente','Coach: try')} ${trimNum(hint.suggestKg)} kg</button>`
    : '';
  const ssAttr = ex.supersetGroup ? ` style="--ssc:${ssColor(ex.supersetGroup)}"` : '';
  return `<section class="wk-ex ${ex.supersetGroup ? 'ss' : ''}"${ssAttr} data-ex="${ex.id}">
    ${ex.supersetGroup ? `<div class="ss-chip">${icon('swords')} Superset</div>` : ''}
    <div class="wk-ex-head">
      ${exImage(meta)}
      <div class="wk-ex-t"><b data-nav="#/library/${encodeURIComponent(ex.exerciseId)}">${esc(meta ? meta.name : 'Exercice')}</b><span>${esc((meta?.primaryMuscles||[]).map(muscleFR).slice(0,2).join(', '))} ${target}</span></div>
      <button class="icon-btn" data-act="exmenu" aria-label="Options">${icon('more')}</button>
    </div>
    ${coachChip}
    <div class="set-head"><span>${t('Série','Set')}</span><span>${t('Préc.','Prev.')}</span><span>kg</span><span>reps</span><span></span></div>
    <div class="set-list">${rows}</div>
    <button class="btn ghost sm add-set" data-act="addset">${icon('plus')} ${t('Série','Set')}</button>
  </section>`;
}

export async function render(params) {
  W = await getWorkout(params.id);
  if (!W) return `<div class="screen-pad">${emptyState('info',t('Séance introuvable','Workout not found'),t('Elle a peut-être été terminée.','It may have been finished.'),`<button class="btn ghost" data-nav="#/home">${t('Accueil','Home')}</button>`)}</div>`;
  if (W.status === 'completed') { nav.go(`#/workout/${W.id}/summary`); return '<div></div>'; }
  prevMap = new Map();
  for (const ex of W.exercises) {
    if (!prevMap.has(ex.exerciseId)) {
      const lp = await lastPerformance(ex.exerciseId);
      if (lp) prevMap.set(ex.exerciseId, lp.sets);
    }
  }
  const blocks = W.exercises.length ? W.exercises.map(exBlockHtml).join('')
    : `<div class="wk-empty">${emptyState('dumbbell',t('Séance vide','Empty workout'),t('Ajoute ton premier exercice pour commencer.','Add your first exercise to get going.'),'')}</div>`;

  return `
    <header class="topbar wk-top">
      <div class="topbar-l"><button class="icon-btn" data-act="min" aria-label="${t('Réduire','Minimize')}">${icon('down')}</button></div>
      <div class="topbar-c"><h1 class="ell" id="wk-name">${esc(W.name)}</h1><span class="wk-elapsed" id="wk-elapsed">0:00</span></div>
      <div class="topbar-r"><button class="btn primary sm" data-act="finish">${t('Terminer','Finish')}</button></div>
    </header>
    <div class="screen-pad wk-body">
      <div id="wk-exs">${blocks}</div>
      <button class="btn ghost full" data-act="addex">${icon('plus')} ${t('Ajouter un exercice','Add an exercise')}</button>
      <button class="btn danger-ghost full mt sm" data-act="discard">${t('Abandonner la séance','Discard workout')}</button>
    </div>`;
}

// ---- chrono « temps actif » ----
// Le chrono ne tourne QUE quand l'écran séance est ouvert au premier plan.
// Fini le compteur qui explose quand on verrouille le téléphone, prend un appel
// ou laisse une séance ouverte : on fige le temps dès qu'on quitte l'écran.
function elapsedSec() {
  const base = W.activeSec || 0;
  return Math.round(base + (W._resumedAt ? (Date.now() - W._resumedAt) / 1000 : 0));
}
function freezeElapsed() {
  if (W && W._resumedAt) { W.activeSec = elapsedSec(); W._resumedAt = null; }
}

function currentExName() {
  const ex = (W?.exercises || []).find(e => (e.sets || []).some(s => !s.done)) || (W?.exercises || [])[0];
  const meta = ex && getExercise(ex.exerciseId);
  return meta ? meta.name : '';
}

export function mount(root, params) {
  // séance de groupe : un sessionId en attente (créée ou rejointe) s'attache à CETTE séance
  const stash = localStorage.getItem('ss-join-session');
  if (stash && W && !W._sessionId) { W._sessionId = parseInt(stash, 10) || null; localStorage.removeItem('ss-join-session'); persist(); }
  // séance en direct : mes amis me voient m'entraîner (battements légers)
  liveStart(() => ({ W, exName: currentExName() }), W?._sessionId || null);
  mountTogether(root);
  document.body.classList.add('workout-mode');
  const exs = root.querySelector('#wk-exs');

  // reprise du chrono actif ; migration douce des anciennes séances (sans activeSec)
  if (W.activeSec == null) W.activeSec = W.startedAt ? Math.min(Math.round((Date.now() - W.startedAt) / 1000), 4 * 3600) : 0;
  W._resumedAt = Date.now();

  // un seul timer à la fois (défense : jamais deux chronos en parallèle)
  if (elapsedTimer) clearInterval(elapsedTimer);
  const tickElapsed = () => {
    const el = root.querySelector('#wk-elapsed');
    if (el) el.textContent = fmtClock(elapsedSec());
  };
  tickElapsed(); elapsedTimer = setInterval(tickElapsed, 1000);

  // app en arrière-plan → on fige ; retour au premier plan → on reprend
  onVis = () => {
    if (document.hidden) { freezeElapsed(); persist(); }
    else if (W && !W._resumedAt) { W._resumedAt = Date.now(); }
  };
  document.addEventListener('visibilitychange', onVis);

  resumeRestIfRunning(); // si un repos courait quand on a quitté l'écran, on le rattrape

  // delegated input
  exs.addEventListener('input', e => {
    const inp = e.target.closest('.set-in'); if (!inp) return;
    const exId = inp.closest('.wk-ex').dataset.ex, setId = inp.closest('.set-row').dataset.set;
    const ex = findEx(exId), s = findSet(ex, setId); if (!s) return;
    const v = inp.value === '' ? null : parseFloat(inp.value.replace(',', '.'));
    if (inp.dataset.f === 'w') s.weightKg = v; else s.reps = v == null ? null : Math.round(v);
    persist();
  });

  // delegated clicks
  exs.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-nav]'); if (!t) return;
    if (t.dataset.nav) return; // handled globally
    const act = t.dataset.act;
    const exEl = t.closest('.wk-ex'); const ex = exEl ? findEx(exEl.dataset.ex) : null;
    if (act === 'done') return toggleDone(t, ex);
    if (act === 'addset') return addSet(exEl, ex);
    if (act === 'type') return typeMenu(t, ex);
    if (act === 'prev') return fillPrev(t, ex);
    if (act === 'exmenu') return exMenu(exEl, ex);
    if (act === 'applysuggest') return applySuggest(t, exEl, ex);
  });

  // header actions
  root.querySelector('[data-act="min"]').onclick = () => nav.go('#/home');
  root.querySelector('[data-act="finish"]').onclick = finish;
  root.querySelector('[data-act="addex"]').onclick = addExercise;
  root.querySelector('[data-act="discard"]').onclick = discard;
  root.querySelector('#wk-name').onclick = renameSession;

  wireSetSwipe(exs);
}

export function unmount() {
  clearInterval(elapsedTimer); elapsedTimer = null;
  if (onVis) { document.removeEventListener('visibilitychange', onVis); onVis = null; }
  freezeElapsed(); // fige le temps ACTIF (chrono séance) en quittant l'écran
  // NB : on ne coupe PAS le minuteur de repos — il continue en horloge murale
  // (barre flottante) et se reprend au retour sur l'écran.
  document.body.classList.remove('workout-mode');
  if (W && W.status === 'in_progress') saveWorkout(W);
}

// ---- actions ----
function toggleDone(btn, ex) {
  const row = btn.closest('.set-row'); const s = findSet(ex, row.dataset.set);
  s.done = !s.done;
  if (s.done) {
    // pull current input values in
    const w = row.querySelector('.set-in.w').value, r = row.querySelector('.set-in.r').value;
    if (w !== '') s.weightKg = parseFloat(w.replace(',', '.'));
    if (r !== '') s.reps = Math.round(parseFloat(r.replace(',', '.')));
    s.completedAt = Date.now();
    row.classList.add('done');
    vibrate(15);
    liveBeat(); // mes amis voient la série tomber
    if (ex.supersetGroup && !isLastOfSuperset(ex)) {
      toast(t('Superset : enchaîne direct sur le suivant !','Superset: go straight to the next one!'), { duration: 2000 });
    } else {
      startRest(ex._restSec ?? ps('defaultRestSec')); // ?? : un repos réglé à 0 = pas de minuteur
    }
  } else {
    s.completedAt = null; row.classList.remove('done');
  }
  persist();
}

function addSet(exEl, ex) {
  const prev = ex.sets[ex.sets.length - 1] || null;
  const s = mkSet(prev); s.done = false; s.completedAt = null;
  ex.sets.push(s);
  const nmap = setNumberMap(ex);
  const list = exEl.querySelector('.set-list');
  const tmp = document.createElement('template'); tmp.innerHTML = setRowHtml(ex, s, nmap[s.id]).trim();
  list.appendChild(tmp.content.firstElementChild);
  persist();
}

function typeMenu(btn, ex) {
  const s = findSet(ex, btn.closest('.set-row').dataset.set);
  const opts = [['normal',t('Série normale','Normal set')],['warmup',t('Échauffement','Warm-up')],['failure',t('Jusqu’à l’échec','To failure')],['dropset','Dropset']];
  const s2 = sheet(opts.map(([v,l]) => `<button class="menu-row ${s.type===v?'sel':''}" data-t="${v}">${l}</button>`).join('')
    + `<button class="menu-row danger" data-del-set>${icon('trash')} ${t('Supprimer la série','Delete set')}</button>`, { title: t('Type de série','Set type') });
  s2.root.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    s.type = b.dataset.t; s2.close(); persist();
    // re-render this exercise block's rows numbering
    rebuildExercise(ex);
  });
  s2.root.querySelector('[data-del-set]').onclick = () => { s2.close(); removeSet(ex, s.id); };
}

// supprime une série, avec « Annuler » (pas de confirmation bloquante)
function removeSet(ex, setId) {
  const idx = ex.sets.findIndex(x => x.id === setId);
  if (idx < 0) return;
  const [removed] = ex.sets.splice(idx, 1);
  rebuildExercise(ex); vibrate(10); persist();
  toast(t('Série supprimée','Set deleted'), {
    actionText: t('Annuler','Undo'), duration: 5000,
    onAction: () => { ex.sets.splice(Math.min(idx, ex.sets.length), 0, removed); rebuildExercise(ex); persist(); },
  });
}

// glisser une ligne de série vers la gauche pour la supprimer (comme les apps natives)
function wireSetSwipe(exsEl) {
  let sw = null; // { row, x0, y0, dx, engaged }
  exsEl.addEventListener('pointerdown', e => {
    const row = e.target.closest('.set-row');
    if (!row || e.target.closest('input, button')) return;
    sw = { row, x0: e.clientX, y0: e.clientY, dx: 0, engaged: false };
  });
  exsEl.addEventListener('pointermove', e => {
    if (!sw) return;
    const dx = e.clientX - sw.x0, dy = e.clientY - sw.y0;
    if (!sw.engaged) {
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4) return; // laisse le scroll vertical
      sw.engaged = true; sw.row.classList.add('swiping');
    }
    sw.dx = Math.min(0, dx);
    sw.row.style.transform = `translateX(${sw.dx}px)`;
    e.preventDefault();
  });
  const end = () => {
    if (!sw) return;
    const { row, dx, engaged } = sw; sw = null;
    if (!engaged) return;
    row.classList.remove('swiping');
    if (dx < -90) {
      const exEl = row.closest('.wk-ex'); const ex = findEx(exEl.dataset.ex);
      row.style.transform = '';
      removeSet(ex, row.dataset.set);
    } else {
      row.style.transform = '';
    }
  };
  exsEl.addEventListener('pointerup', end);
  exsEl.addEventListener('pointercancel', end);
}

function fillPrev(btn, ex) {
  const row = btn.closest('.set-row'); const s = findSet(ex, row.dataset.set);
  const idx = ex.sets.indexOf(s); const prev = prevMap.get(ex.exerciseId);
  if (!prev || !prev[idx]) return;
  s.weightKg = prev[idx].weightKg; s.reps = prev[idx].reps;
  row.querySelector('.set-in.w').value = s.weightKg ?? '';
  row.querySelector('.set-in.r').value = s.reps ?? '';
  persist();
}

function rebuildExercise(ex) {
  const exEl = document.querySelector(`.wk-ex[data-ex="${ex.id}"]`); if (!exEl) return;
  const tmp = document.createElement('template'); tmp.innerHTML = exBlockHtml(ex).trim();
  exEl.replaceWith(tmp.content.firstElementChild);
}

// applique la suggestion du coach à toutes les séries non validées
function applySuggest(btn, exEl, ex) {
  const kg = parseFloat(btn.dataset.kg);
  for (const s of ex.sets) { if (!s.done) s.weightKg = kg; }
  exEl.querySelectorAll('.set-row').forEach(row => {
    const s = findSet(ex, row.dataset.set);
    if (s && !s.done) row.querySelector('.set-in.w').value = kg;
  });
  btn.classList.add('applied'); btn.textContent = `✓ ${trimNum(kg)} kg — allez !`;
  vibrate(10); persist();
}

// calculateur de disques : charge -> disques par côté (barre olympique)
function plateCalcSheet(targetKg) {
  const bar = ps('barWeightKg') || 20;
  const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
  const compute = (total) => {
    let side = (total - bar) / 2; const out = [];
    if (side < 0) return null;
    for (const p of PLATES) { while (side >= p - 1e-9) { out.push(p); side -= p; } }
    return { plates: out, rest: Math.round(side * 100) / 100 };
  };
  const render = (total) => {
    const r = compute(total);
    if (!r) return `<p class="mut center">${t('Charge inférieure à la barre','Load below the bar')} (${bar} kg)</p>`;
    const chips = r.plates.length ? r.plates.map(p => `<span class="plate p${String(p).replace('.', '_')}">${trimNum(p)}</span>`).join('') : `<span class="mut">${t('barre à vide','empty bar')}</span>`;
    return `<div class="plates-row">${chips}</div>
      <p class="mut sm center">${t('par côté · barre','per side · bar')} ${bar} kg${r.rest ? ` · ${t('reste','remainder')} ${r.rest} kg` : ''}</p>`;
  };
  const s = sheet(`
    <div class="calc-head"><button class="stepbtn" data-d="-2.5">−2,5</button>
      <div class="calc-val"><b id="pc-val">${trimNum(targetKg)}</b><span>${t('kg total','total kg')}</span></div>
      <button class="stepbtn" data-d="2.5">+2,5</button></div>
    <div id="pc-out">${render(targetKg)}</div>`, { title: t('Chargement de la barre','Barbell loading') });
  let cur = targetKg;
  s.root.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
    cur = Math.max(bar, cur + parseFloat(b.dataset.d));
    s.root.querySelector('#pc-val').textContent = trimNum(cur);
    s.root.querySelector('#pc-out').innerHTML = render(cur);
  });
}

// génère des séries d'échauffement à partir de la charge de travail
function addWarmupSets(exEl, ex) {
  const working = ex.sets.find(s => !s.done && s.weightKg);
  const w = working?.weightKg || ex.sets.find(s => s.weightKg)?.weightKg;
  if (!w) { toast(t('Renseigne d’abord la charge de travail','Enter your working weight first')); return; }
  const scheme = [[0.4, 10], [0.6, 6], [0.8, 3]];
  const warmups = scheme.map(([pct, reps]) => {
    const s = mkSet(null);
    s.type = 'warmup';
    s.weightKg = Math.max(0, Math.round(w * pct / 2.5) * 2.5);
    s.reps = reps;
    return s;
  });
  ex.sets = [...warmups, ...ex.sets];
  rebuildExercise(ex);
  toast(t('Échauffement ajouté : 40 % ×10 · 60 % ×6 · 80 % ×3','Warm-up added: 40% ×10 · 60% ×6 · 80% ×3'));
  persist();
}

function restSheet(ex) {
  const cur = ex._restSec ?? ps('defaultRestSec');
  const opts = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240];
  const label = (v) => v === 0 ? t('Aucun','None') : v < 60 ? `${v}s` : `${Math.floor(v/60)}min${v%60 ? ' ' + (v%60) + 's' : ''}`;
  const s2 = sheet(`
    <p class="mut sm">${t('Temps de repos après chaque série de cet exercice.','Rest time after each set of this exercise.')}</p>
    <div class="rest-grid">${opts.map(v => `<button class="rest-opt ${v === cur ? 'on' : ''}" data-r="${v}">${label(v)}</button>`).join('')}</div>`,
    { title: t('Temps de repos','Rest time') });
  s2.root.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    ex._restSec = parseInt(b.dataset.r, 10); persist(); s2.close();
    toast(`${t('Repos','Rest')} : ${label(ex._restSec)}`);
  });
}

function exMenu(exEl, ex) {
  const restLabel = (ex._restSec ?? ps('defaultRestSec'));
  const s = sheet(`
    <button class="menu-row" data-a="rest">${icon('timer')} ${t('Temps de repos','Rest time')} · ${restLabel}s</button>
    <button class="menu-row" data-a="warmup">${icon('flame')} ${t('Générer l’échauffement','Generate warm-up')}</button>
    <button class="menu-row" data-a="plates">${icon('calc')} ${t('Chargement de la barre','Barbell loading')}</button>
    <button class="menu-row" data-a="note">${icon('edit')} ${t('Note d’exercice','Exercise note')}</button>
    <button class="menu-row" data-a="superset">${icon('swords')} ${ex.supersetGroup ? t('Retirer du superset','Remove from superset') : t('Ajouter à un superset','Add to superset')}</button>
    <button class="menu-row danger" data-a="remove">${icon('trash')} ${t('Retirer l’exercice','Remove exercise')}</button>`, { title: t('Exercice','Exercise') });
  s.root.querySelector('[data-a="rest"]').onclick = () => { s.close(); restSheet(ex); };
  s.root.querySelector('[data-a="warmup"]').onclick = () => { s.close(); addWarmupSets(exEl, ex); };
  s.root.querySelector('[data-a="superset"]').onclick = () => {
    s.close();
    if (ex.supersetGroup) {
      const rest = ssPartners(ex).filter(e => e.id !== ex.id);
      ex.supersetGroup = null;
      if (rest.length === 1) rest[0].supersetGroup = null; // un superset à 1 n'existe pas
      persist();
      applySsDom(ex.id); rest.forEach(e => applySsDom(e.id));
      toast(t('Retiré du superset.','Removed from superset.'));
    } else {
      supersetSheet(ex);
    }
  };
  s.root.querySelector('[data-a="plates"]').onclick = () => {
    s.close();
    const w = ex.sets.find(x => !x.done && x.weightKg)?.weightKg || ex.sets.find(x => x.weightKg)?.weightKg || (ps('barWeightKg') || 20);
    plateCalcSheet(w);
  };
  s.root.querySelector('[data-a="remove"]').onclick = async () => {
    s.close();
    const idx = W.exercises.findIndex(e => e.id === ex.id);
    W.exercises = W.exercises.filter(e => e.id !== ex.id);
    exEl.remove(); persist();
    const meta = getExercise(ex.exerciseId);
    toast(`« ${meta ? meta.name : t('Exercice','Exercise')} » ${t('retiré','removed')}`, {
      actionText: t('Annuler','Undo'), duration: 5000,
      onAction: () => {
        W.exercises.splice(Math.min(idx, W.exercises.length), 0, ex);
        const exsEl = document.querySelector('#wk-exs'); if (!exsEl) { persist(); return; }
        const tmp = document.createElement('template'); tmp.innerHTML = exBlockHtml(ex).trim();
        const after = exsEl.children[idx] || null;
        exsEl.insertBefore(tmp.content.firstElementChild, after);
        persist();
      },
    });
  };
  s.root.querySelector('[data-a="note"]').onclick = async () => {
    s.close();
    const { promptDialog } = await import('../ui.js');
    const n = await promptDialog({ title: t('Note','Note'), value: ex.notes || '', placeholder: t('Ressenti, réglage machine…','How it felt, machine setting…') });
    if (n != null) { ex.notes = n; persist(); }
  };
}

function addExercise() {
  openExercisePicker({ multi: true, onPick: async (ids) => {
    const exsEl = document.querySelector('#wk-exs');
    const emptyEl = exsEl.querySelector('.wk-empty'); if (emptyEl) emptyEl.remove();
    for (const exId of ids) {
      const ex = mkExercise(exId, W.exercises.length);
      const lp = await lastPerformance(exId);
      if (lp) prevMap.set(exId, lp.sets);
      const nSets = 3;
      for (let i = 0; i < nSets; i++) ex.sets.push(mkSet(lp?.sets?.[i] || null));
      ex._restSec = ps('defaultRestSec');
      W.exercises.push(ex);
      const tmp = document.createElement('template'); tmp.innerHTML = exBlockHtml(ex).trim();
      exsEl.appendChild(tmp.content.firstElementChild);
    }
    persist();
  }});
}

async function renameSession() {
  const { promptDialog } = await import('../ui.js');
  const n = await promptDialog({ title: t('Nom de la séance','Workout name'), value: W.name, confirmText: 'OK' });
  if (n != null && n.trim()) { W.name = n.trim(); document.querySelector('#wk-name').textContent = W.name; persist(); }
}

async function discard() {
  if (await confirmDialog({ title: t('Abandonner ?','Discard?'), message: t('La séance en cours sera supprimée. Sûr ?','The current workout will be deleted. Sure?'), confirmText: t('Abandonner','Discard'), danger: true })) {
    clearRest();
    liveStop();
    await deleteWorkout(W.id); W = null;
    nav.go('#/home');
  }
}

// recopie dans le modèle les valeurs actuellement tapées dans les champs
function syncInputsFromDom() {
  document.querySelectorAll('#wk-exs .wk-ex').forEach(exEl => {
    const ex = findEx(exEl.dataset.ex); if (!ex) return;
    exEl.querySelectorAll('.set-row').forEach(row => {
      const s = findSet(ex, row.dataset.set); if (!s) return;
      const w = row.querySelector('.set-in.w')?.value ?? '';
      const r = row.querySelector('.set-in.r')?.value ?? '';
      if (w !== '') s.weightKg = parseFloat(w.replace(',', '.'));
      if (r !== '') s.reps = Math.round(parseFloat(r.replace(',', '.')));
    });
  });
}

async function finish() {
  syncInputsFromDom(); // récupère les dernières valeurs tapées (au cas où)
  // Séries remplies (poids OU reps saisi) mais pas cochées → on les valide :
  // avoir saisi ses chiffres, c'est avoir fait la série. Fini le « rien ne se passe ».
  for (const ex of W.exercises) for (const s of ex.sets) {
    if (!s.done && (s.weightKg != null || s.reps != null)) { s.done = true; if (!s.completedAt) s.completedAt = Date.now(); }
  }
  const anyDone = W.exercises.some(ex => ex.sets.some(s => s.done));
  if (!anyDone) {
    // vraiment aucune donnée saisie → la séance est vide, on propose de quitter
    if (await confirmDialog({ title: t('Séance vide','Empty workout'), message: t('Tu n’as saisi aucune série. Quitter la séance ? (rien ne sera enregistré)','You didn’t log any set. Leave the workout? (nothing will be saved)'), confirmText: t('Quitter','Leave'), danger: true })) {
      liveStop();
      clearRest(); await deleteWorkout(W.id); W = null; nav.go('#/home');
    }
    return; // annulation : la séance continue, intacte
  }
  // On ne retire les séries non validées qu'au moment où la fin est actée.
  for (const ex of W.exercises) ex.sets = ex.sets.filter(s => s.done);
  W.exercises = W.exercises.filter(ex => ex.sets.length);
  freezeElapsed(); // durée finale = temps actif réel
  clearRest();
  const id = W.id;
  try {
    liveStop();
    await finishWorkout(W);
  } catch (e) {
    console.error(e);
    toast(t('Impossible d’enregistrer la séance — réessaie', 'Couldn’t save the workout — try again'), { type: 'error' });
    W._resumedAt = Date.now(); // on relance le chrono, la séance n'est pas perdue
    return;
  }
  nav.go(`#/workout/${id}/summary`);
}

// ---- rest timer ----
function ensureRestBar() {
  let bar = document.getElementById('rest-bar');
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'rest-bar'; bar.className = 'rest-bar';
    bar.innerHTML = `
      <div class="rest-fill" id="rest-fill"></div>
      <button class="rest-adj" data-r="-15">−15s</button>
      <div class="rest-time" id="rest-time">0:00</div>
      <button class="rest-adj" data-r="15">+15s</button>
      <button class="rest-skip" id="rest-skip">${t('Passer','Skip')}</button>`;
    document.body.appendChild(bar);
    bar.querySelectorAll('[data-r]').forEach(b => b.onclick = () => adjustRest(parseInt(b.dataset.r, 10)));
    bar.querySelector('#rest-skip').onclick = () => clearRest();
  }
  return bar;
}
// Minuteur de repos = HORLOGE MURALE : on stocke l'instant de fin (endsAt) et on
// recalcule le restant à chaque tick. Le repos continue donc même si on quitte
// l'écran de séance ou si le téléphone se verrouille (on le reprend au retour).
function restRemaining() {
  return rest.endsAt ? Math.max(0, Math.round((rest.endsAt - Date.now()) / 1000)) : 0;
}
function startRest(sec) {
  if (!sec || sec <= 0) return;
  clearRest(true);
  rest.total = sec;
  rest.endsAt = Date.now() + sec * 1000;
  if (W) { W._restEndsAt = rest.endsAt; W._restTotal = sec; persist(); }
  const bar = ensureRestBar(); bar.classList.remove('done'); bar.classList.add('show');
  updateRest();
  rest.timer = setInterval(tickRest, 250); // 250 ms : fluide + robuste au throttling d'arrière-plan
}
function tickRest() {
  updateRest();
  if (restRemaining() <= 0) restDone();
}
function updateRest() {
  const bar = document.getElementById('rest-bar'); if (!bar) return;
  const rem = restRemaining();
  bar.querySelector('#rest-time').textContent = fmtClock(rem);
  const pct = rest.total ? rem / rest.total * 100 : 0;
  bar.querySelector('#rest-fill').style.width = pct + '%';
  bar.classList.toggle('ending', rem <= 10 && rem > 0);
}
function adjustRest(delta) {
  if (!rest.timer) return;
  rest.endsAt = Math.max(Date.now() + 1000, rest.endsAt + delta * 1000);
  rest.total = Math.max(rest.total, restRemaining());
  if (W) { W._restEndsAt = rest.endsAt; persist(); }
  updateRest();
}
function restDone() {
  if (rest.timer) { clearInterval(rest.timer); rest.timer = null; }
  rest.endsAt = 0;
  if (W) { W._restEndsAt = 0; persist(); }
  vibrate([120, 60, 120]); beep();
  const bar = document.getElementById('rest-bar');
  if (bar) {
    bar.classList.add('done');
    rest.hideTimeout = setTimeout(() => { bar.classList.remove('show','done','ending'); rest.hideTimeout = null; }, 900);
  }
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(t('Repos terminé','Rest over'), { body: t('Série suivante !','Next set!'), silent: false }); } catch {}
  }
}
// Reprend l'affichage du repos s'il court encore (retour sur l'écran de séance,
// ou relance de l'app en plein repos : endsAt est persisté sur la séance).
function resumeRestIfRunning() {
  if (!W || !W._restEndsAt) return;
  if (W._restEndsAt <= Date.now()) { W._restEndsAt = 0; return; }
  rest.endsAt = W._restEndsAt;
  rest.total = W._restTotal || Math.max(1, restRemaining());
  const bar = ensureRestBar(); bar.classList.remove('done'); bar.classList.add('show');
  updateRest();
  if (!rest.timer) rest.timer = setInterval(tickRest, 250);
}
function clearRest(keepBar) {
  if (rest.hideTimeout) { clearTimeout(rest.hideTimeout); rest.hideTimeout = null; } // évite qu'un ancien timeout masque le repos suivant
  if (rest.timer) { clearInterval(rest.timer); rest.timer = null; }
  rest.endsAt = 0;
  if (W) W._restEndsAt = 0;
  if (!keepBar) { const bar = document.getElementById('rest-bar'); if (bar) bar.classList.remove('show','ending','done'); }
}
function beep() {
  if (!ps('sound')) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; o.type = 'sine'; o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
    o.start(); o.stop(audioCtx.currentTime + 0.36);
  } catch {}
}

// ================= SUMMARY =================
export async function renderSummary(params) {
  const w = await getWorkout(params.id);
  if (!w) return `<div class="screen-pad">${emptyState('info','Introuvable','',`<button class="btn ghost" data-nav="#/home">Accueil</button>`)}</div>`;
  const { workoutStats } = await import('../analytics.js');
  const st = workoutStats(w);
  const unit = ps('weightUnit');
  const prs = (w.prs || []).map(pr => {
    const ex = getExercise(pr.exerciseId);
    const label = pr.type === 'estimated1rm' ? t('1RM estimé','Est. 1RM') : pr.type === 'maxWeight' ? t('Charge max','Max weight')
      : pr.type === 'first' ? t('Première fois — la base est posée !','First time — baseline set!') : t('Volume/série','Set volume');
    const val = pr.type === 'first' ? (pr.value ? ` · ${Math.round(pr.value)} ${unit}` : '') : ` · ${Math.round(pr.value)} ${unit}`;
    return `<div class="pr-row">${icon('trophy')}<div><b>${esc(ex ? ex.name : '')}</b><span>${label}${val}</span></div></div>`;
  }).join('');

  return `
    <div class="summary">
      <div class="summary-hero">
        <div class="summary-badge">${icon('check')}</div>
        <h1>${t('Séance terminée !','Workout complete!')}</h1>
        <p>${esc(w.name)}</p>
        <p class="summary-praise">${esc(praise({ prs: (w.prs||[]).length, volume: st.volume, sets: st.sets, durationSec: w.durationSec }))}</p>
      </div>
      <div class="summary-stats">
        <div><b>${fmtDuration(w.durationSec)}</b><span>${t('durée','duration')}</span></div>
        <div><b>${st.sets}</b><span>${t('séries','sets')}</span></div>
        <div><b>${st.reps}</b><span>reps</span></div>
        <div><b>${Math.round(st.volume).toLocaleString(t('fr-FR','en-US'))}</b><span>volume ${unit}</span></div>
      </div>
      ${prs ? `<section class="card pr-card"><h3 class="card-t">${icon('trophy')} ${(w.prs||[]).length} ${t('nouveau','new')}${(w.prs||[]).length>1 ? t('x','') :''} record${(w.prs||[]).length>1?'s':''} !</h3>${prs}</section>` : ''}
      <div class="summary-actions">
        ${isLoggedIn() ? `<button class="btn ghost full" id="sum-share">${icon('share')} ${t('Partager à mes amis','Share with my friends')}</button>` : ''}
        <button class="btn ghost full" data-nav="#/history/${w.id}">${t('Voir le détail','View details')}</button>
        <button class="btn primary full" data-nav="#/home" id="sum-done">${t('Terminé','Done')}</button>
      </div>
    </div>`;
}
async function celebrateAchievements(root) {
  try {
    const [{ computeAchievements, newlyUnlocked }, { listWorkouts }] = await Promise.all([import('../achievements.js'), import('../model.js')]);
    const workouts = await listWorkouts();
    const ach = computeAchievements(workouts);
    const prev = ps('achievements') || [];
    const fresh = newlyUnlocked(prev, ach.list);
    if (ach.unlocked.length !== prev.length || fresh.length) {
      const { savePSettings } = await import('../store.js');
      await savePSettings({ achievements: ach.unlocked });
    }
    if (!fresh.length) return;
    // carte de célébration insérée en tête du résumé
    const host = root.querySelector('.summary');
    if (host) {
      const html = `<section class="card ach-unlock">
        <h3 class="card-t">${icon('party')} ${t(fresh.length > 1 ? 'Nouveaux trophées !' : 'Nouveau trophée !', fresh.length > 1 ? 'New achievements!' : 'New achievement!')}</h3>
        ${fresh.map(a => `<div class="ach-unlock-row"><span class="ach-emoji">${icon(a.icon)}</span><div><b>${esc(a.title)}</b><span class="mut sm">${esc(a.desc)}</span></div></div>`).join('')}
        <button class="btn ghost full sm" data-nav="#/achievements">${t('Voir tous mes trophées','See all my achievements')}</button></section>`;
      host.querySelector('.summary-hero')?.insertAdjacentHTML('afterend', html);
      setTimeout(() => confetti(host.querySelector('.ach-unlock .ach-emoji')), 500);
      vibrate([60, 30, 60, 30, 60, 30, 120]);
    }
  } catch (e) { console.error(e); }
}

export function mountSummary(root, params) {
  if ((root.querySelector('.pr-card'))) {
    setTimeout(() => confetti(root.querySelector('.summary-badge')), 250);
    vibrate([80, 40, 80, 40, 120]);
  }
  celebrateAchievements(root); // badges nouvellement débloqués par cette séance
  // partage de la séance dans le fil (opt-in : rien ne part sans ce geste)
  root.querySelector('#sum-share')?.addEventListener('click', async () => {
    const btn = root.querySelector('#sum-share');
    btn.disabled = true;
    try {
      const w = await getWorkout(params.id);
      const { workoutStats } = await import('../analytics.js');
      const st = workoutStats(w);
      await call('posts', 'publish', { kind: 'workout', content: {
        name: w.name, sets: st.sets, volume: Math.round(st.volume),
        durationSec: w.durationSec || 0, prs: (w.prs || []).length,
      } });
      btn.textContent = t('Partagé ✓ tes amis vont le voir','Shared ✓ your friends will see it');
    } catch (e) { toast(e.message, { type: 'error' }); btn.disabled = false; }
  });
}


// ---- panneau « Ensemble » : les participants de la séance de groupe ----
let tgTimer = null;
async function refreshTogether(host) {
  if (!W?._sessionId) return;
  try {
    const d = await call('liveworkout', 'session', { sessionId: W._sessionId });
    const me = (await import('../api.js')).account()?.user?.username;
    host.innerHTML = `<div class="tg-head">${icon('users')} <b>${t('Ensemble','Together')}</b> · ${d.participants.length}</div>` +
      d.participants.map(p => {
        const mins = Math.max(1, Math.round((Date.now() - p.startedAt) / 60000));
        return `<div class="tg-row"><b>${esc(p.user.displayName)}${p.user.username === me ? ` · ${t('toi','you')}` : ''}</b>
          <span class="mut sm">${p.setsDone} ${t('séries','sets')} · ${p.volumeKg.toLocaleString('fr-FR')} kg · ${mins} min${p.currentEx ? ` · ${esc(p.currentEx)}` : ''}</span></div>`;
      }).join('');
  } catch {}
}
function mountTogether(root) {
  clearInterval(tgTimer);
  if (!W?._sessionId || !isLoggedIn()) return;
  const view = root.querySelector('.screen-pad') || root;
  const host = document.createElement('section');
  host.className = 'card together';
  view.prepend(host);
  refreshTogether(host);
  tgTimer = setInterval(() => { if (!document.body.contains(host)) { clearInterval(tgTimer); return; } refreshTogether(host); }, 15000);
}
