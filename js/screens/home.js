// screens/home.js — dashboard
import { t } from '../i18n.js';
import { hello as voiceHello, heroLine } from '../voice.js';
import { esc, fmtDate, relDate, fmtWeight, fmtDuration, sum } from '../util.js';
import { state, ps, activeProfile, accentHex, nav } from '../store.js';
import { icon } from '../ui.js';
import { listWorkouts, getActiveWorkout, listRoutines, startWorkout, listMetrics, getRoutine } from '../model.js';
import { workoutStats, goalStreak, thisWeekCount, weekStart } from '../analytics.js';
import { sparkline } from '../charts.js';
import { statTile, exGroup } from './common.js';
import { coachAdvice } from '../coach.js';
import { beginRoutine } from './routines.js';

export async function render() {
  const p = activeProfile();
  const [active, workouts, routines, bw] = await Promise.all([
    getActiveWorkout(), listWorkouts(), listRoutines(), listMetrics('weight'),
  ]);
  const goal = ps('weeklyGoal');
  const weekN = thisWeekCount(workouts);
  const streak = goalStreak(workouts, goal);
  const wk = weekStart(Date.now());
  const weekVol = sum(workouts.filter(w => weekStart(w.completedAt||w.startedAt) === wk).map(w => workoutStats(w).volume));
  const last = workouts[0];
  const unit = ps('weightUnit');
  const helloRaw = voiceHello(); // la voix de l'app : varie selon l'heure, le jour… et le lundi
  const hello = /[?!…)]$/.test(helloRaw) ? helloRaw : helloRaw + ','; // virgule seulement si la phrase n'a pas déjà sa ponctuation

  const avatar = `<button class="avatar" data-nav="#/profile" style="--a:${accentHex(p)}">${p?.emoji || esc((p?.name||'?').slice(0,1).toUpperCase())}</button>`;

  const heroActive = active ? `
    <div class="hero resume" data-nav="#/workout/${active.id}">
      <div class="hero-tag">${icon('bolt')} ${t('Séance en cours','Workout in progress')}</div>
      <h2>${esc(active.name)}</h2>
      <p>${(active.exercises||[]).length} exercices · démarrée ${relDate(active.startedAt).toLowerCase()}</p>
      <span class="hero-cta">${t('Reprendre','Resume')} ${icon('right')}</span>
    </div>` : `
    <div class="hero">
      <div class="hero-tag">${t('Prêt ?','Ready?')}</div>
      <h2>${t('Démarrer une séance','Start a workout')}</h2>
      <p>${esc(heroLine())}</p>
      <div class="hero-actions">
        <button class="btn primary" id="start-empty">${icon('play')} ${t('Séance libre','Free workout')}</button>
        <button class="btn ghost" data-nav="#/routines">${icon('dumbbell')} ${t('Programmes','Programs')}</button>
      </div>
    </div>`;

  const momentum = `
    <div class="momentum">
      ${statTile(`${streak}`, streak > 1 ? t('semaines de série','week streak') : t('semaine de série','week streak'), streak ? icon('flame') : t('objectif ','goal ') + goal + t('/sem','/wk'))}
      ${statTile(`${weekN}<em class="of">/${goal}</em>`, t('cette semaine','this week'), t('séances','workouts'))}
      ${statTile(fmtWeight(weekVol, unit).replace(' '+unit,''), 'volume ('+unit+')', 'cette semaine')}
    </div>`;

  const lastCard = last ? `
    <section class="card recap" data-nav="#/history/${last.id}">
      <div class="recap-h"><span class="mut">Dernière séance · ${relDate(last.completedAt)}</span>${icon('right')}</div>
      <h3>${esc(last.name)}</h3>
      <div class="recap-stats">
        <span>${icon('dumbbell')} ${workoutStats(last).sets} séries</span>
        <span>${icon('timer')} ${fmtDuration(last.durationSec)}</span>
        <span>${icon('chart')} ${Math.round(workoutStats(last).volume).toLocaleString('fr-FR')} ${unit}</span>
        ${(last.prs||[]).length ? `<span class="pr">${icon('trophy')} ${last.prs.length} record${last.prs.length>1?'s':''}</span>` : ''}
      </div>
    </section>` : '';

  const bwCard = bw.length ? `
    <section class="card bw" data-nav="#/progress/body">
      <div class="recap-h"><span class="mut">Poids de corps</span>${icon('right')}</div>
      <div class="bw-row"><b>${fmtWeight(bw[bw.length-1].value, unit)}</b>${sparkline(bw.map(m=>m.value))}</div>
    </section>` : '';

  const quick = `
    <div class="quick">
      <button class="quick-b" data-nav="#/routines">${icon('dumbbell')}<span>${t('Programmes','Programs')}</span></button>
      <button class="quick-b" data-nav="#/library">${icon('search')}<span>${t('Exercices','Exercises')}</span></button>
      <button class="quick-b" data-nav="#/progress">${icon('chart')}<span>${t('Progrès','Progress')}</span></button>
      <button class="quick-b" data-nav="#/history">${icon('history')}<span>${t('Historique','History')}</span></button>
    </div>`;

  const advice = active ? null : coachAdvice({ workouts, routines, libraryById: state.libraryById, weeklyGoal: goal });
  const coachCard = advice ? `
    <section class="card coach-card">
      <div class="coach-head"><span class="coach-emoji">${icon(advice.icon)}</span><b>${esc(advice.title)}</b></div>
      <p>${esc(advice.text)}</p>
      ${advice.routineId ? `<button class="btn primary full" id="coach-go" data-rid="${advice.routineId}">${icon('play')} Démarrer « ${esc(advice.routineName)} »</button>` : ''}
    </section>` : '';

  return `
    <header class="topbar home-top">
      <div class="topbar-c"><span class="hello">${hello}</span><h1>${esc(p?.name || 'Athlète')}</h1></div>
      <div class="topbar-r">${avatar}</div>
    </header>
    <div class="screen-pad">
      ${heroActive}
      ${coachCard}
      ${momentum}
      ${quick}
      ${lastCard}
      ${bwCard}
      ${!workouts.length && !active ? `<p class="hint">${t('Astuce : pars d’un <b>modèle prêt à l’emploi</b> dans l’onglet Programmes, ou lance une séance libre et ajoute tes exercices au fur et à mesure.','Tip: start from a <b>ready-made template</b> in the Programs tab, or launch a free workout and add exercises as you go.')}</p>` : ''}
    </div>`;
}

export function mount(root) {
  const be = root.querySelector('#start-empty');
  if (be) be.onclick = async () => {
    be.disabled = true;
    const w = await startWorkout({});
    nav.go(`#/workout/${w.id}`);
  };
  const cg = root.querySelector('#coach-go');
  if (cg) cg.onclick = async () => {
    cg.disabled = true;
    const r = await getRoutine(cg.dataset.rid);
    if (r) beginRoutine(r); else nav.go('#/routines');
  };
}
