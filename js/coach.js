// coach.js — le coach intégré : conseil du jour, surcharge progressive, bilan hebdo.
// 100 % local, basé sur ton historique réel. Règles simples et honnêtes de coaching :
// rotation des groupes musculaires, récupération 48 h, progression quand la cible est atteinte.
import { MUSCLE_GROUP } from './data.js';
import { workoutStats, weekStart, thisWeekCount, isWorkingSet } from './analytics.js';

const DAY = 86400000;

function groupsOfWorkout(w, libraryById) {
  const g = new Set();
  for (const ex of (w.exercises || [])) {
    if (!(ex.sets || []).some(isWorkingSet)) continue;
    const meta = libraryById.get(ex.exerciseId);
    for (const m of (meta?.primaryMuscles || [])) { const gr = MUSCLE_GROUP[m]; if (gr) g.add(gr); }
  }
  return g;
}

function groupsOfRoutine(r, libraryById) {
  const g = new Set();
  for (const it of (r.items || [])) {
    const meta = libraryById.get(it.exerciseId);
    for (const m of (meta?.primaryMuscles || [])) { const gr = MUSCLE_GROUP[m]; if (gr) g.add(gr); }
  }
  return g;
}

/** Jours depuis le dernier travail de chaque groupe musculaire (Infinity si jamais). */
function daysSinceByGroup(workouts, libraryById) {
  const last = new Map();
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    const ts = w.completedAt || w.startedAt;
    for (const g of groupsOfWorkout(w, libraryById)) {
      if (!last.has(g) || ts > last.get(g)) last.set(g, ts);
    }
  }
  const out = new Map();
  for (const g of ['Pectoraux', 'Dos', 'Épaules', 'Bras', 'Jambes', 'Abdos']) {
    out.set(g, last.has(g) ? Math.floor((Date.now() - last.get(g)) / DAY) : Infinity);
  }
  return out;
}

/**
 * Conseil du jour. Retourne { emoji, title, text, routineId?, routineName? }.
 */
export function coachAdvice({ workouts, routines, libraryById, weeklyGoal = 3 }) {
  const done = workouts.filter(w => w.status === 'completed')
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  if (!done.length) {
    const r = routines[0];
    return {
      icon: 'hand', title: 'On démarre ?',
      text: r ? `Ta première séance t'attend : « ${r.name} ». Commence léger, soigne le geste — la charge viendra vite.`
        : 'Choisis un modèle dans Programmes (Comeback Machines A est parfait pour reprendre) et lance ta première séance.',
      routineId: r?.id, routineName: r?.name,
    };
  }

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const isToday = ts => ts >= today0.getTime();
  const yesterday0 = today0.getTime() - DAY;

  const weekN = thisWeekCount(done);
  const trainedToday = done.some(w => isToday(w.completedAt));
  const trainedYesterday = done.some(w => (w.completedAt >= yesterday0 && w.completedAt < today0.getTime()));
  const trainedDayBefore = done.some(w => (w.completedAt >= yesterday0 - DAY && w.completedAt < yesterday0));

  if (trainedToday) {
    const w = done[0]; const st = workoutStats(w);
    return {
      icon: 'check', title: 'Séance du jour : faite !',
      text: `« ${w.name} » — ${st.sets} séries, ${Math.round(st.volume).toLocaleString('fr-FR')} kg. Hydrate-toi, mange des protéines, et dors bien : c'est là que le muscle se construit.`,
    };
  }

  if (trainedYesterday && trainedDayBefore) {
    return {
      icon: 'heart', title: 'Jour de récupération conseillé',
      text: `2 jours d'affilée, bien joué ! Aujourd'hui : repos actif — 20-30 min de marche ou de vélo tranquille, et des étirements. Tes muscles progressent pendant la récup.`,
    };
  }

  // Recommander le programme dont les groupes sont les plus « reposés »
  const since = daysSinceByGroup(done, libraryById);
  let best = null, bestScore = -1;
  for (const r of routines) {
    const gs = groupsOfRoutine(r, libraryById);
    if (!gs.size) continue;
    let score = 0;
    for (const g of gs) { const d = since.get(g); score += (d === Infinity ? 10 : Math.min(d, 10)); }
    score /= gs.size;
    if (score > bestScore) { bestScore = score; best = r; }
  }

  const remaining = Math.max(0, weeklyGoal - weekN);
  const dow = new Date().getDay(); // 0 dim
  const daysLeft = dow === 0 ? 1 : (8 - dow);
  const urgency = remaining > 0 && remaining >= daysLeft - 1;

  if (best) {
    const gs = [...groupsOfRoutine(best, libraryById)];
    const freshest = gs.map(g => [g, since.get(g)]).sort((a, b) => (b[1] === Infinity ? 99 : b[1]) - (a[1] === Infinity ? 99 : a[1]))[0];
    const dTxt = freshest && freshest[1] !== Infinity && freshest[1] < 99
      ? ` — ${freshest[0].toLowerCase()} pas travaillé${freshest[0] === 'Jambes' || freshest[0] === 'Épaules' ? 's' : ''} depuis ${freshest[1]} j`
      : '';
    return {
      icon: urgency ? 'flame' : 'dumbbell',
      title: urgency ? `Objectif : ${remaining} séance${remaining > 1 ? 's' : ''} avant dimanche !` : 'Conseil du coach',
      text: `Aujourd'hui je te conseille « ${best.name} »${dTxt}. ${weekN}/${weeklyGoal} séances cette semaine.`,
      routineId: best.id, routineName: best.name,
    };
  }
  return {
    icon: 'dumbbell', title: 'Prêt pour une séance ?',
    text: `${weekN}/${weeklyGoal} séances cette semaine. Lance une séance libre ou crée un programme pour des conseils personnalisés.`,
  };
}

/**
 * Surcharge progressive pour un exercice de séance en cours.
 * prevSets : séries de la dernière séance ; targetRepsMax : haut de la fourchette cible.
 * Retourne { suggestKg, reason } ou null.
 */
export function overloadHint(prevSets, targetRepsMax) {
  if (!prevSets?.length || !targetRepsMax) return null;
  const working = prevSets.filter(s => s.done !== false && s.type !== 'warmup' && s.reps != null && s.weightKg != null);
  if (working.length < 2) return null;
  const allAtTop = working.every(s => s.reps >= targetRepsMax);
  if (!allAtTop) return null;
  const w = Math.max(...working.map(s => s.weightKg));
  const inc = w >= 60 ? 2.5 : (w >= 20 ? 2.5 : 1);
  const suggest = Math.round((w + inc) * 2) / 2;
  return { suggestKg: suggest, reason: `Dernière fois : ${working.length}×${targetRepsMax}+ @ ${w} kg réussi` };
}

/** Bilan hebdo du coach (écran Progrès). */
export function coachWeekly(workouts, libraryById, weeklyGoal = 3) {
  const done = workouts.filter(w => w.status === 'completed');
  const wk = weekStart(Date.now());
  const thisW = done.filter(w => weekStart(w.completedAt) === wk);
  const lastW = done.filter(w => weekStart(w.completedAt) === wk - 7 * DAY);
  if (!thisW.length && !lastW.length) return null;
  const vol = ws => ws.reduce((a, w) => a + workoutStats(w).volume, 0);
  const v1 = vol(thisW), v0 = vol(lastW);
  const delta = v0 > 0 ? Math.round((v1 - v0) / v0 * 100) : null;
  // groupe le moins travaillé cette semaine
  const worked = new Set();
  for (const w of thisW) for (const g of groupsOfWorkout(w, libraryById)) worked.add(g);
  const missing = ['Jambes', 'Dos', 'Pectoraux', 'Épaules'].filter(g => !worked.has(g));
  let text = `${thisW.length}/${weeklyGoal} séance${thisW.length > 1 ? 's' : ''} cette semaine`;
  if (delta !== null) text += `, volume ${delta >= 0 ? '+' : ''}${delta} % vs semaine dernière`;
  text += '.';
  if (missing.length && thisW.length) {
    const list = missing.map(m => m.toLowerCase());
    const joined = list.length > 1 ? list.slice(0, -1).join(', ') + ' et ' + list[list.length - 1] : list[0];
    text += ` Pense ${missing.length === 1 && missing[0] === 'Dos' ? 'au' : 'aux'} ${joined}.`;
  }
  return { icon: thisW.length >= weeklyGoal ? 'trophy' : 'chart', title: 'Bilan de la semaine', text };
}
