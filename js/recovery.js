// recovery.js — récupération musculaire, calculée depuis les séances terminées.
// Modèle simple et assumé : chaque muscle a un temps de récupération type
// (les gros muscles récupèrent plus lentement) ; le % = temps écoulé depuis
// la dernière sollicitation significative / temps de récupération.
// Primaire = 1 point par série faite, secondaire = 0,5 point.
import { state } from './store.js';
import { MUSCLE_FR, muscleFR } from './data.js';

// Heures de récupération par muscle
export const REC_HOURS = {
  quadriceps: 72, hamstrings: 72, glutes: 72, 'lower back': 72,
  lats: 60, 'middle back': 60, chest: 60,
  shoulders: 48, traps: 48, triceps: 48, biceps: 48, adductors: 48, abductors: 48,
  forearms: 36, calves: 36, abdominals: 36, neck: 36,
};

/** Sollicitations par muscle sur les séances TERMINÉES des 14 derniers jours.
 *  Retourne { muscle: [{at, pts}] } — pts = séries faites (×0,5 si secondaire). */
export function muscleLoads(workouts, { sinceMs = Date.now() - 14 * 864e5 } = {}) {
  const loads = {};
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    const at = w.completedAt || w.startedAt;
    if (!at || at < sinceMs) continue;
    for (const ex of (w.exercises || [])) {
      const lib = state.libraryById.get(ex.exerciseId);
      if (!lib) continue;
      const done = (ex.sets || []).filter(s => s.done).length;
      if (!done) continue;
      for (const m of (lib.primaryMuscles || [])) (loads[m] ??= []).push({ at, pts: done });
      for (const m of (lib.secondaryMuscles || [])) (loads[m] ??= []).push({ at, pts: done * 0.5 });
    }
  }
  return loads;
}

/** % de récupération d'un muscle (100 = prêt) + dernière sollicitation.
 *  Un stimulus < 2 points (une petite série secondaire) ne « fatigue » pas le muscle. */
export function recoveryFor(loads, muscle, now = Date.now()) {
  const byDay = {};
  for (const e of (loads[muscle] || [])) {
    const day = Math.floor(e.at / 864e5);
    byDay[day] = (byDay[day] || 0) + e.pts;
  }
  const meaningful = Object.entries(byDay).filter(([, pts]) => pts >= 2);
  if (!meaningful.length) return { pct: 100, lastAt: null };
  const lastDay = Math.max(...meaningful.map(([d]) => +d));
  const lastAt = Math.max(...(loads[muscle] || []).filter(e => Math.floor(e.at / 864e5) === lastDay).map(e => e.at));
  const rec = (REC_HOURS[muscle] || 48) * 3600e3;
  const pct = Math.max(0, Math.min(100, Math.round(((now - lastAt) / rec) * 100)));
  return { pct, lastAt };
}

/** Vue d'ensemble : tous les muscles, % global, points de la semaine en cours. */
export function recoveryOverview(workouts, now = Date.now()) {
  const loads = muscleLoads(workouts);
  const weekAgo = now - 7 * 864e5;
  const rows = Object.keys(MUSCLE_FR).map(muscle => {
    const { pct, lastAt } = recoveryFor(loads, muscle, now);
    const weekPts = (loads[muscle] || []).filter(e => e.at >= weekAgo).reduce((s, e) => s + e.pts, 0);
    return { muscle, label: muscleFR(muscle), pct, lastAt, weekPts };
  });
  // le % global ne considère que les muscles réellement sollicités (14 j)
  const worked = rows.filter(r => r.lastAt !== null);
  const global = worked.length ? Math.round(worked.reduce((s, r) => s + r.pct, 0) / worked.length) : 100;
  return { rows, worked, global };
}

/** Heures restantes avant récupération complète (0 si prêt). */
export function hoursLeft(row, now = Date.now()) {
  if (row.pct >= 100 || !row.lastAt) return 0;
  const rec = (REC_HOURS[row.muscle] || 48) * 3600e3;
  return Math.max(0, Math.ceil((row.lastAt + rec - now) / 3600e3));
}
