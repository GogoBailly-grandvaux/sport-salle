// screens/progress.js — progress hub, per-exercise charts, body metrics
import { t } from '../i18n.js';
import { esc, fmtDate, relDate, todayISO, fmtWeight, round , isoToTs } from '../util.js';
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
import { computeAchievements } from '../achievements.js';

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
    const label = pr.type === 'estimated1rm' ? t('1RM est.','Est. 1RM') : pr.type === 'maxWeight' ? t('Charge max','Max weight') : t('Volume/série','Set volume');
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
  const topList = top.map(([id,n]) => { const ex = getExercise(id); return `<button class="ex-mini" data-nav="#/progress/exercise/${encodeURIComponent(id)}">${exImage(ex)}<div><b>${esc(ex?ex.name:'')}</b><span>${n} ${t('séances','sessions')}</span></div>${icon('right')}</button>`; }).join('');

  if (!workouts.length) {
    return `${hubHeader()}<div class="screen-pad">${emptyState('chart',t('Pas encore de données','No data yet'),t('Enregistre quelques séances et tes courbes de progression apparaîtront ici.','Log a few workouts and your progress charts will appear here.'),`<button class="btn primary" data-nav="#/home">${t('Démarrer une séance','Start a workout')}</button>`)}</div>`;
  }

  const { coachWeekly } = await import('../coach.js');
  const weekly = coachWeekly(workouts, state.libraryById, ps('weeklyGoal'));

  // trophées : aperçu (débloqués récents + compteur)
  const ach = computeAchievements(workouts);
  const unlocked = ach.list.filter(a => a.done);
  const nextUp = ach.list.filter(a => !a.done).sort((a, b) => b.pct - a.pct)[0];
  const achCard = `<button class="card trophy-card" data-nav="#/achievements">
      <div class="recap-h"><span class="mut">${icon('medal')} ${t('Trophées','Achievements')} · ${unlocked.length}/${ach.list.length}</span>${icon('right')}</div>
      <div class="trophy-row">${(unlocked.length ? unlocked : ach.list).slice(0, 8).map(a => `<span class="trophy-mini ${a.done ? '' : 'locked'}" title="${esc(a.title)}">${icon(a.icon)}</span>`).join('')}</div>
      ${nextUp ? `<p class="mut sm">${t('Prochain','Next')} : ${icon(nextUp.icon)} ${esc(nextUp.title)} — ${nextUp.cur}/${nextUp.target}</p>` : `<p class="mut sm">${t('Tout débloqué, machine !','All unlocked, machine!')}</p>`}
    </button>`;

  return `${hubHeader()}
    <div class="screen-pad">
      ${weekly ? `<section class="card coach-card"><div class="coach-head"><span class="coach-emoji">${icon(weekly.icon)}</span><b>${esc(weekly.title)}</b></div><p>${esc(weekly.text)}</p></section>` : ''}
      ${achCard}
      <button class="btn primary full" id="pg-pick">${icon('search')} ${t('Progression d’un exercice','Exercise progression')}</button>

      <section class="card">
        <h3 class="card-t">${t('Volume par semaine','Weekly volume')}</h3>
        ${hasVol ? barChart(wv, { valueKey:'value', height:140 }) : `<p class="mut sm">Pas assez de données.</p>`}
      </section>

      <section class="card">
        <h3 class="card-t">Séries par muscle · cette semaine</h3>
        ${muscleBars}
      </section>

      ${prFeed ? `<section class="card"><h3 class="card-t">${icon('trophy')} ${t('Records récents','Recent records')}</h3>${prFeed}</section>` : ''}

      ${topList ? `<section class="card"><h3 class="card-t">Exercices suivis</h3>${topList}</section>` : ''}

      <section class="card bw" data-nav="#/progress/body">
        <div class="recap-h"><span class="mut">${t('Mesures corporelles','Body measurements')}</span>${icon('right')}</div>
        ${bw.length ? `<div class="bw-row"><b>${fmtWeight(bw[bw.length-1].value, unit)}</b>${sparkline(bw.map(m=>m.value))}</div>` : `<p class="mut sm">${t('Ajoute ton poids pour suivre ta transformation.','Add your weight to track your transformation.')}</p>`}
      </section>
      <button class="card recap-h" data-nav="#/progress/photos" style="width:100%">
        <span class="mut">${icon('camera')} ${t('Photos de progression','Progress photos')}</span>${icon('right')}</button>
    </div>`;
}
function hubHeader() {
  return `<header class="topbar"><div class="topbar-l">${backBtn('#/home')}</div><div class="topbar-c"><h1>${t('Progrès','Progress')}</h1></div><div class="topbar-r"></div></header>`;
}
export function mountHub(root) {
  root.querySelector('#pg-pick')?.addEventListener('click', () => openExercisePicker({ multi:false, onPick: ids => nav.go(`#/progress/exercise/${encodeURIComponent(ids[0])}`) }));
}

// ---------------- trophées (écran complet) ----------------
export async function renderAchievements() {
  const workouts = await listWorkouts();
  const ach = computeAchievements(workouts);
  const n = ach.list.filter(a => a.done).length;
  const cards = ach.list.map(a => `
    <div class="ach-card ${a.done ? 'done' : ''}">
      <div class="ach-emoji">${icon(a.icon)}</div>
      <div class="ach-body">
        <b>${esc(a.title)}</b>
        <span class="mut sm">${esc(a.desc)}</span>
        ${a.done ? `<span class="ach-tag">${t('Débloqué','Unlocked')} ✓</span>`
          : `<div class="ach-prog"><div class="ach-prog-bar"><i style="width:${a.pct}%"></i></div><span>${a.cur}/${a.target}</span></div>`}
      </div>
    </div>`).join('');
  return `
    <header class="topbar"><div class="topbar-l">${backBtn('#/progress')}</div>
      <div class="topbar-c"><h1>${t('Trophées','Achievements')}</h1><span class="topbar-sub">${n}/${ach.list.length} ${t('débloqués','unlocked')}</span></div>
      <div class="topbar-r"></div></header>
    <div class="screen-pad"><div class="ach-grid">${cards}</div></div>`;
}
export function mountAchievements() {}

// ---------------- photos de progression (local uniquement) ----------------
function compressImage(file, maxDim = 1080, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (Math.max(w, h) > maxDim) { const r = maxDim / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      c.toBlob(b => b ? resolve(b) : reject(new Error('compress')), 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
let _photoUrls = [];
export async function renderPhotos() {
  return `
    <header class="topbar"><div class="topbar-l">${backBtn('#/progress/body')}</div>
      <div class="topbar-c"><h1>${t('Photos de progression','Progress photos')}</h1></div>
      <div class="topbar-r"></div></header>
    <div class="screen-pad">
      <p class="mut sm">${t('Tes photos restent sur ton téléphone — jamais envoyées, jamais partagées. Prends-les dans les mêmes conditions pour bien voir l’évolution.','Your photos stay on your phone — never uploaded, never shared. Take them in the same conditions to really see your progress.')}</p>
      <button class="btn primary full" id="ph-add">${icon('camera')} ${t('Ajouter une photo','Add a photo')}</button>
      <input type="file" id="ph-file" accept="image/*" capture="environment" hidden>
      <div id="ph-gallery"></div>
    </div>`;
}
export async function mountPhotos(root) {
  const { listPhotos, addPhoto, deletePhoto } = await import('../model.js');
  _photoUrls.forEach(u => URL.revokeObjectURL(u)); _photoUrls = [];
  const gallery = root.querySelector('#ph-gallery');
  const draw = async () => {
    const photos = await listPhotos();
    _photoUrls.forEach(u => URL.revokeObjectURL(u)); _photoUrls = [];
    if (!photos.length) { gallery.innerHTML = `<div class="ph-empty">${t('Aucune photo pour l’instant. La première, c’est ton point de départ.','No photos yet. The first one is your baseline.')}</div>`; return; }
    const url = p => { const u = URL.createObjectURL(p.blob); _photoUrls.push(u); return u; };
    const cmp = photos.length >= 2 ? `<div class="ph-compare">
      <figure><img src="${url(photos[0])}" alt=""><figcaption>${t('Avant','Before')} · ${esc(photos[0].date || '')}</figcaption></figure>
      <figure><img src="${url(photos[photos.length-1])}" alt=""><figcaption>${t('Maintenant','Now')} · ${esc(photos[photos.length-1].date || '')}</figcaption></figure>
    </div>` : '';
    gallery.innerHTML = cmp + `<div class="ph-grid">${photos.slice().reverse().map(p => `<button class="ph-thumb" data-id="${p.id}"><img src="${url(p)}" alt=""><span>${esc(p.date || '')}</span></button>`).join('')}</div>`;
    gallery.querySelectorAll('.ph-thumb').forEach(b => b.onclick = () => {
      const p = photos.find(x => x.id === b.dataset.id); if (!p) return;
      const u = url(p);
      const s = sheet(`<img class="ph-full" src="${u}" alt="">
        <p class="center"><b>${esc(p.date || '')}</b>${p.note ? ` · ${esc(p.note)}` : ''}</p>
        <button class="btn danger-ghost full" id="ph-del">${icon('trash')} ${t('Supprimer','Delete')}</button>`, { title: t('Photo','Photo') });
      s.root.querySelector('#ph-del').onclick = async () => {
        s.close();
        if (await confirmDialog({ title: t('Supprimer','Delete'), message: t('Supprimer cette photo ?','Delete this photo?'), confirmText: t('Supprimer','Delete'), danger: true })) {
          await deletePhoto(p.id); toast(t('Photo supprimée','Photo deleted')); draw();
        }
      };
    });
  };
  root.querySelector('#ph-add').onclick = () => root.querySelector('#ph-file').click();
  root.querySelector('#ph-file').onchange = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const btn = root.querySelector('#ph-add'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const blob = await compressImage(file);
      await addPhoto({ blob, date: todayISO(), note: '' });
      toast(t('Photo ajoutée ✓','Photo added ✓'));
    } catch { toast(t('Image illisible','Unreadable image'), { type: 'error' }); }
    e.target.value = ''; btn.disabled = false; btn.innerHTML = `${icon('camera')} ${t('Ajouter une photo','Add a photo')}`;
    draw();
  };
  draw();
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
      <div><b>${best.sessions}</b><span>${t('séances','sessions')}</span></div>
    </div>
    <section class="card"><h3 class="card-t">${t('1RM estimé','Estimated 1RM')}</h3>${hist.length>1?lineChart(hist,{valueKey:'bestE1rm',fmt:v=>Math.round(v),height:150}):`<p class="mut sm">${t('Encore','Just')} ${2-hist.length} ${t('séance pour tracer la courbe.','more session to draw the curve.')}</p>`}</section>
    <section class="card"><h3 class="card-t">${t('Volume par séance','Volume per session')}</h3>${barChart(hist,{valueKey:'volume',height:130})}</section>
    ${rmRows?`<section class="card"><h3 class="card-t">${t('Records par répétitions','Rep records')}</h3><div class="rm-grid">${rmRows}</div></section>`:''}
    ` : emptyState('chart',t('Aucune donnée','No data'),t('Tu n’as pas encore fait cet exercice en séance.','You haven’t done this exercise in a workout yet.'),'');

  return `
    <header class="topbar"><div class="topbar-l">${backBtn('#/progress')}</div><div class="topbar-c"><h1 class="ell">${esc(ex?ex.name:'Exercice')}</h1></div><div class="topbar-r"><button class="icon-btn" data-nav="#/library/${encodeURIComponent(id)}" aria-label="${t('Fiche de l’exercice','Exercise page')}">${icon('info')}</button></div></header>
    <div class="screen-pad">${body}</div>`;
}
export function mountExercise() {}

// ---------------- body metrics ----------------
const METRICS = () => ({ weight: { label:t('Poids','Weight'), unit:'kg' }, bodyfat: { label:t('Masse grasse','Body fat'), unit:'%' }, waist: { label:t('Tour de taille','Waist'), unit:'cm' } });
let bodyType = 'weight';

export async function renderBody() {
  const rows = await listMetrics(bodyType);
  const meta = METRICS()[bodyType];
  const pts = rows.map(m => ({ ts: isoToTs(m.date), value: m.value }));
  const trend = emaTrend(pts, 0.15);
  const seg = Object.entries(METRICS()).map(([k,v]) => `<button class="seg ${k===bodyType?'on':''}" data-type="${k}">${v.label}</button>`).join('');
  const list = rows.slice().reverse().slice(0,30).map(m => `<div class="metric-row"><span>${fmtDate(isoToTs(m.date),{year:true})}</span><b>${m.value} ${meta.unit}</b><button class="icon-btn sm danger" data-del="${m.id}" aria-label="Supprimer la mesure">${icon('trash')}</button></div>`).join('');

  return `
    <header class="topbar"><div class="topbar-l">${backBtn('#/progress')}</div><div class="topbar-c"><h1>${t('Mesures','Measurements')}</h1></div><div class="topbar-r"><button class="icon-btn" id="bm-add" aria-label="${t('Ajouter','Add')}">${icon('plus')}</button></div></header>
    <div class="screen-pad">
      <div class="segmented">${seg}</div>
      <section class="card">
        <h3 class="card-t">${meta.label} (${meta.unit})</h3>
        ${pts.length>1 ? lineChart(trend,{valueKey:'value',trendKey:'trend',fmt:v=>round(v,1),height:150}) : (pts.length?`<div class="single-val">${pts[0].value} ${meta.unit}</div>`:`<p class="mut sm">${t('Aucune mesure. Appuie sur + pour commencer.','No measurements. Tap + to start.')}</p>`)}
      </section>
      ${rows.length?`<section class="card"><h3 class="card-t">${t('Historique','History')}</h3><div class="metric-list">${list}</div></section>`:''}
    </div>`;
}
export function mountBody(root) {
  root.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { bodyType = b.dataset.type; nav.refresh(); });
  root.querySelector('#bm-add').onclick = async () => {
    const meta = METRICS()[bodyType];
    const v = await promptDialog({ title: `${t('Ajouter','Add')} — ${meta.label}`, label: `${t('Valeur','Value')} (${meta.unit})`, type:'number', placeholder: meta.unit });
    if (v == null || v === '' || isNaN(+v)) return;
    await addMetric({ type: bodyType, value: round(+v,2), date: todayISO() });
    toast(t('Mesure enregistrée ✓','Measurement saved ✓')); nav.refresh();
  };
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await deleteMetric(b.dataset.del); nav.refresh(); });
}
