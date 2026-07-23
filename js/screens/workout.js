// screens/workout.js — live workout logging + summary
import { esc, uid, debounce, vibrate, fmtDuration, fmtClock } from '../util.js';
import { state, ps, nav } from '../store.js';
import { icon, sheet, toast, confirmDialog, confetti } from '../ui.js';
import { getExercise, muscleFR } from '../data.js';
import { exImage, emptyState } from './common.js';
import { openExercisePicker } from './picker.js';
import { getWorkout, saveWorkout, deleteWorkout, finishWorkout, mkSet, mkExercise, lastPerformance } from '../model.js';

let W = null;
let prevMap = new Map();       // exerciseId -> [prev sets]
let elapsedTimer = null;
let rest = { timer: null, remaining: 0, total: 0, hideTimeout: null };
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
    <button class="set-n" data-act="type" title="Type de série">${numLabel}</button>
    <button class="set-prev" data-act="prev" ${pv ? '' : 'disabled'}>${pv || '—'}</button>
    <input class="set-in w" data-f="w" type="number" inputmode="decimal" value="${s.weightKg ?? ''}" placeholder="${prev && prev[idx] ? prev[idx].weightKg ?? 'kg' : 'kg'}">
    <input class="set-in r" data-f="r" type="number" inputmode="numeric" value="${s.reps ?? ''}" placeholder="${prev && prev[idx] ? prev[idx].reps ?? 'reps' : 'reps'}">
    <button class="set-do" data-act="done" aria-label="Valider la série">${icon('check')}</button>
  </div>`;
}

function exBlockHtml(ex) {
  const meta = getExercise(ex.exerciseId);
  const nmap = setNumberMap(ex);
  const rows = ex.sets.map(s => setRowHtml(ex, s, nmap[s.id])).join('');
  const target = ex._targetReps ? `<span class="ex-target">cible ${ex._targetReps} reps</span>` : '';
  return `<section class="wk-ex" data-ex="${ex.id}">
    <div class="wk-ex-head">
      ${exImage(meta)}
      <div class="wk-ex-t"><b data-nav="#/library/${encodeURIComponent(ex.exerciseId)}">${esc(meta ? meta.name : 'Exercice')}</b><span>${esc((meta?.primaryMuscles||[]).map(muscleFR).slice(0,2).join(', '))} ${target}</span></div>
      <button class="icon-btn" data-act="exmenu" aria-label="Options">${icon('more')}</button>
    </div>
    <div class="set-head"><span>Série</span><span>Préc.</span><span>kg</span><span>reps</span><span></span></div>
    <div class="set-list">${rows}</div>
    <button class="btn ghost sm add-set" data-act="addset">${icon('plus')} Série</button>
  </section>`;
}

export async function render(params) {
  W = await getWorkout(params.id);
  if (!W) return `<div class="screen-pad">${emptyState('info','Séance introuvable','Elle a peut-être été terminée.',`<button class="btn ghost" data-nav="#/home">Accueil</button>`)}</div>`;
  if (W.status === 'completed') { nav.go(`#/workout/${W.id}/summary`); return '<div></div>'; }
  prevMap = new Map();
  for (const ex of W.exercises) {
    if (!prevMap.has(ex.exerciseId)) {
      const lp = await lastPerformance(ex.exerciseId);
      if (lp) prevMap.set(ex.exerciseId, lp.sets);
    }
  }
  const blocks = W.exercises.length ? W.exercises.map(exBlockHtml).join('')
    : `<div class="wk-empty">${emptyState('dumbbell','Séance vide','Ajoute ton premier exercice pour commencer.','')}</div>`;

  return `
    <header class="topbar wk-top">
      <div class="topbar-l"><button class="icon-btn" data-act="min" aria-label="Réduire">${icon('down')}</button></div>
      <div class="topbar-c"><h1 class="ell" id="wk-name">${esc(W.name)}</h1><span class="wk-elapsed" id="wk-elapsed">0:00</span></div>
      <div class="topbar-r"><button class="btn primary sm" data-act="finish">Terminer</button></div>
    </header>
    <div class="screen-pad wk-body">
      <div id="wk-exs">${blocks}</div>
      <button class="btn ghost full" data-act="addex">${icon('plus')} Ajouter un exercice</button>
      <button class="btn danger-ghost full mt sm" data-act="discard">Abandonner la séance</button>
    </div>`;
}

export function mount(root, params) {
  document.body.classList.add('workout-mode');
  const exs = root.querySelector('#wk-exs');

  // elapsed timer
  const tickElapsed = () => {
    const el = root.querySelector('#wk-elapsed');
    if (el) el.textContent = fmtClock(Math.round((Date.now() - W.startedAt) / 1000));
  };
  tickElapsed(); elapsedTimer = setInterval(tickElapsed, 1000);

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
  });

  // header actions
  root.querySelector('[data-act="min"]').onclick = () => nav.go('#/home');
  root.querySelector('[data-act="finish"]').onclick = finish;
  root.querySelector('[data-act="addex"]').onclick = addExercise;
  root.querySelector('[data-act="discard"]').onclick = discard;
  root.querySelector('#wk-name').onclick = renameSession;
}

export function unmount() {
  clearInterval(elapsedTimer); elapsedTimer = null;
  clearRest();
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
    startRest(ex._restSec || ps('defaultRestSec'));
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
  const opts = [['normal','Série normale'],['warmup','Échauffement'],['failure','Jusqu’à l’échec'],['dropset','Dropset']];
  const s2 = sheet(opts.map(([v,l]) => `<button class="menu-row ${s.type===v?'sel':''}" data-t="${v}">${l}</button>`).join(''), { title: 'Type de série' });
  s2.root.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    s.type = b.dataset.t; s2.close(); persist();
    // re-render this exercise block's rows numbering
    rebuildExercise(ex);
  });
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

function exMenu(exEl, ex) {
  const s = sheet(`
    <button class="menu-row" data-a="note">${icon('edit')} Note d’exercice</button>
    <button class="menu-row danger" data-a="remove">${icon('trash')} Retirer l’exercice</button>`, { title: 'Exercice' });
  s.root.querySelector('[data-a="remove"]').onclick = async () => {
    s.close();
    W.exercises = W.exercises.filter(e => e.id !== ex.id);
    exEl.remove(); persist();
  };
  s.root.querySelector('[data-a="note"]').onclick = async () => {
    s.close();
    const { promptDialog } = await import('../ui.js');
    const n = await promptDialog({ title: 'Note', value: ex.notes || '', placeholder: 'Ressenti, réglage machine…' });
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
  const n = await promptDialog({ title: 'Nom de la séance', value: W.name, confirmText: 'OK' });
  if (n != null && n.trim()) { W.name = n.trim(); document.querySelector('#wk-name').textContent = W.name; persist(); }
}

async function discard() {
  if (await confirmDialog({ title: 'Abandonner ?', message: 'La séance en cours sera supprimée. Sûr ?', confirmText: 'Abandonner', danger: true })) {
    await deleteWorkout(W.id); const id = W.id; W = null;
    nav.go('#/home');
  }
}

async function finish() {
  // Rien de validé ? On demande SANS toucher au modèle vivant.
  const anyDone = W.exercises.some(ex => ex.sets.some(s => s.done));
  if (!anyDone) {
    if (await confirmDialog({ title: 'Aucune série validée', message: 'Rien n’a été validé. Abandonner la séance ?', confirmText: 'Abandonner', danger: true })) {
      await deleteWorkout(W.id); nav.go('#/home');
    }
    return; // annulation : la séance continue, intacte
  }
  // On ne retire les séries non validées qu'au moment où la fin est actée.
  for (const ex of W.exercises) ex.sets = ex.sets.filter(s => s.done);
  W.exercises = W.exercises.filter(ex => ex.sets.length);
  clearRest();
  const id = W.id;
  await finishWorkout(W);
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
      <button class="rest-skip" id="rest-skip">Passer</button>`;
    document.body.appendChild(bar);
    bar.querySelectorAll('[data-r]').forEach(b => b.onclick = () => adjustRest(parseInt(b.dataset.r, 10)));
    bar.querySelector('#rest-skip').onclick = () => clearRest();
  }
  return bar;
}
function startRest(sec) {
  if (!sec || sec <= 0) return;
  clearRest(true);
  rest.total = sec; rest.remaining = sec;
  const bar = ensureRestBar(); bar.classList.remove('done'); bar.classList.add('show');
  updateRest();
  rest.timer = setInterval(() => {
    rest.remaining -= 1; updateRest();
    if (rest.remaining <= 0) { restDone(); }
  }, 1000);
}
function updateRest() {
  const bar = document.getElementById('rest-bar'); if (!bar) return;
  bar.querySelector('#rest-time').textContent = fmtClock(Math.max(0, rest.remaining));
  const pct = rest.total ? Math.max(0, rest.remaining) / rest.total * 100 : 0;
  bar.querySelector('#rest-fill').style.width = pct + '%';
  bar.classList.toggle('ending', rest.remaining <= 10 && rest.remaining > 0);
}
function adjustRest(delta) {
  if (!rest.timer) return;
  rest.remaining = Math.max(1, rest.remaining + delta);
  rest.total = Math.max(rest.total, rest.remaining);
  updateRest();
}
function restDone() {
  clearInterval(rest.timer); rest.timer = null;
  vibrate([120, 60, 120]); beep();
  const bar = document.getElementById('rest-bar');
  if (bar) {
    bar.classList.add('done');
    rest.hideTimeout = setTimeout(() => { bar.classList.remove('show','done','ending'); rest.hideTimeout = null; }, 900);
  }
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Repos terminé 💪', { body: 'Série suivante !', silent: false }); } catch {}
  }
}
function clearRest(keepBar) {
  if (rest.hideTimeout) { clearTimeout(rest.hideTimeout); rest.hideTimeout = null; } // évite qu'un ancien timeout masque le repos suivant
  if (rest.timer) { clearInterval(rest.timer); rest.timer = null; }
  rest.remaining = 0;
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
    const label = pr.type === 'estimated1rm' ? '1RM estimé' : pr.type === 'maxWeight' ? 'Charge max' : 'Volume/série';
    return `<div class="pr-row">${icon('trophy')}<div><b>${esc(ex ? ex.name : '')}</b><span>${label} · ${Math.round(pr.value)} ${unit}</span></div></div>`;
  }).join('');

  return `
    <div class="summary">
      <div class="summary-hero">
        <div class="summary-badge">${icon('check')}</div>
        <h1>Séance terminée !</h1>
        <p>${esc(w.name)}</p>
      </div>
      <div class="summary-stats">
        <div><b>${fmtDuration(w.durationSec)}</b><span>durée</span></div>
        <div><b>${st.sets}</b><span>séries</span></div>
        <div><b>${st.reps}</b><span>reps</span></div>
        <div><b>${Math.round(st.volume).toLocaleString('fr-FR')}</b><span>volume ${unit}</span></div>
      </div>
      ${prs ? `<section class="card pr-card"><h3 class="card-t">${icon('trophy')} ${(w.prs||[]).length} nouveau${(w.prs||[]).length>1?'x':''} record${(w.prs||[]).length>1?'s':''} !</h3>${prs}</section>` : ''}
      <div class="summary-actions">
        <button class="btn ghost full" data-nav="#/history/${w.id}">Voir le détail</button>
        <button class="btn primary full" data-nav="#/home" id="sum-done">Terminé</button>
      </div>
    </div>`;
}
export function mountSummary(root, params) {
  if ((root.querySelector('.pr-card'))) {
    setTimeout(() => confetti(root.querySelector('.summary-badge')), 250);
    vibrate([80, 40, 80, 40, 120]);
  }
}
