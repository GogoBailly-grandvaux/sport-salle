// analytics.js — 1RM, volume, PRs, streaks, trends. Pure functions over embedded workouts.
import { sum } from './util.js';

export function e1rm(weightKg, reps, formula = 'epley') {
  if (!weightKg || !reps || reps < 1) return 0;
  if (reps === 1) return weightKg;
  if (reps > 12) return 0; // low confidence -> not estimated
  if (formula === 'brzycki') return reps >= 37 ? 0 : weightKg * 36 / (37 - reps);
  return weightKg * (1 + reps / 30); // Epley
}

export const isWorkingSet = s => s && s.done && s.type !== 'warmup' && (s.reps > 0);
export const setVolume = s => (s.weightKg || 0) * (s.reps || 0);

export function workoutStats(w, formula = 'epley') {
  let volume = 0, sets = 0, reps = 0;
  for (const ex of (w.exercises || [])) {
    for (const s of (ex.sets || [])) {
      if (!isWorkingSet(s)) continue;
      volume += setVolume(s); sets += 1; reps += s.reps;
    }
  }
  return { volume, sets, reps, exercises: (w.exercises || []).filter(e => (e.sets||[]).some(isWorkingSet)).length };
}

export function exerciseSummary(ex, formula = 'epley') {
  const working = (ex.sets || []).filter(isWorkingSet);
  if (!working.length) return null;
  let topWeight = 0, volume = 0, bestE1rm = 0, bestSetVol = 0, reps = 0;
  for (const s of working) {
    topWeight = Math.max(topWeight, s.weightKg || 0);
    volume += setVolume(s);
    bestSetVol = Math.max(bestSetVol, setVolume(s));
    bestE1rm = Math.max(bestE1rm, e1rm(s.weightKg, s.reps, formula));
    reps += s.reps;
  }
  return { topWeight, volume, bestE1rm, bestSetVol, sets: working.length, reps };
}

// Un même exercice peut apparaître dans plusieurs blocs d'une séance : on agrège TOUTES ses séries.
const setsForExercise = (w, exerciseId) =>
  (w.exercises || []).filter(e => e.exerciseId === exerciseId).flatMap(e => e.sets || []);

// history points for an exercise across completed workouts (ascending by time)
export function exerciseHistory(workouts, exerciseId, formula = 'epley') {
  const pts = [];
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    const sets = setsForExercise(w, exerciseId);
    if (!sets.length) continue;
    const s = exerciseSummary({ sets }, formula);
    if (!s) continue;
    pts.push({ ts: w.completedAt || w.startedAt, ...s });
  }
  return pts.sort((a, b) => a.ts - b.ts);
}

export function allTimeBests(workouts, exerciseId, formula = 'epley') {
  let maxWeight = 0, maxReps = 0, bestE1rm = 0, bestSetVol = 0, sessions = 0;
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    let counted = false;
    for (const s of setsForExercise(w, exerciseId)) {
      if (!isWorkingSet(s)) continue;
      counted = true;
      maxWeight = Math.max(maxWeight, s.weightKg || 0);
      maxReps = Math.max(maxReps, s.reps || 0);
      bestE1rm = Math.max(bestE1rm, e1rm(s.weightKg, s.reps, formula));
      bestSetVol = Math.max(bestSetVol, setVolume(s));
    }
    if (counted) sessions++;
  }
  return { maxWeight, maxReps, bestE1rm, bestSetVol, sessions };
}

// Compare a (just-finished) workout to prior history -> new PRs
export function detectPRs(current, priorWorkouts, formula = 'epley') {
  const prs = [];
  const byId = new Map();
  for (const ex of (current.exercises || [])) {
    const g = byId.get(ex.exerciseId) || [];
    g.push(...(ex.sets || []));
    byId.set(ex.exerciseId, g);
  }
  for (const [exerciseId, sets] of byId) {
    const prev = allTimeBests(priorWorkouts, exerciseId, formula);
    if (prev.sessions === 0) {
      // toute première perf de cet exercice : on la fête (un seul « record », pas de spam)
      const cur0 = exerciseSummary({ sets }, formula);
      if (cur0) prs.push({ exerciseId, type: 'first', value: cur0.topWeight || 0 });
      continue;
    }
    const cur = exerciseSummary({ sets }, formula);
    if (!cur) continue;
    if (cur.topWeight > prev.maxWeight + 1e-6)
      prs.push({ exerciseId, type: 'maxWeight', value: cur.topWeight });
    if (cur.bestE1rm > prev.bestE1rm + 1e-6)
      prs.push({ exerciseId, type: 'estimated1rm', value: cur.bestE1rm });
    if (cur.bestSetVol > prev.bestSetVol + 1e-6)
      prs.push({ exerciseId, type: 'bestSetVolume', value: cur.bestSetVol });
  }
  // keep most impressive per exercise (e1rm > weight > volume)
  const rank = { estimated1rm: 3, maxWeight: 2, bestSetVolume: 1, first: 0 };
  const byEx = new Map();
  for (const p of prs) {
    const cur = byEx.get(p.exerciseId);
    if (!cur || rank[p.type] > rank[cur.type]) byEx.set(p.exerciseId, p);
  }
  return [...byEx.values()];
}

// ---- weeks / streaks ----
export function weekStart(ts) {
  const d = new Date(ts); d.setHours(0,0,0,0);
  const day = (d.getDay() + 6) % 7; // Monday=0
  d.setDate(d.getDate() - day);
  return d.getTime();
}
export function weekKey(ts) { return weekStart(ts); }

export function sessionsByWeek(workouts) {
  const m = new Map();
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    const k = weekStart(w.completedAt || w.startedAt);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

export function goalStreak(workouts, weeklyGoal = 3) {
  const byWeek = sessionsByWeek(workouts);
  let streak = 0;
  let cursor = weekStart(Date.now());
  // weekStart(cursor - 1) : recale sur le vrai lundi local (une semaine fait 167-169 h avec l'heure d'été)
  if ((byWeek.get(cursor) || 0) < weeklyGoal) cursor = weekStart(cursor - 1);
  while ((byWeek.get(cursor) || 0) >= weeklyGoal) { streak++; cursor = weekStart(cursor - 1); }
  return streak;
}

export function thisWeekCount(workouts) {
  const wk = weekStart(Date.now());
  let n = 0;
  for (const w of workouts) if (w.status === 'completed' && weekStart(w.completedAt || w.startedAt) === wk) n++;
  return n;
}

// weekly total volume series (last N weeks)
export function weeklyVolumeSeries(workouts, weeks = 8, formula = 'epley') {
  const start = weekStart(Date.now()) - (weeks - 1) * 7 * 86400000;
  const buckets = new Array(weeks).fill(0);
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    const wk = weekStart(w.completedAt || w.startedAt);
    const idx = Math.round((wk - start) / (7 * 86400000));
    if (idx >= 0 && idx < weeks) buckets[idx] += workoutStats(w, formula).volume;
  }
  return buckets.map((v, i) => ({ ts: start + i * 7 * 86400000, value: v }));
}

// sets per muscle group this week (primary=1, secondary=0.5)
export function muscleVolumeThisWeek(workouts, libraryById) {
  const wk = weekStart(Date.now());
  const map = new Map();
  for (const w of workouts) {
    if (w.status !== 'completed' || weekStart(w.completedAt || w.startedAt) !== wk) continue;
    for (const ex of (w.exercises || [])) {
      const meta = libraryById.get(ex.exerciseId);
      if (!meta) continue;
      const working = (ex.sets || []).filter(isWorkingSet).length;
      if (!working) continue;
      for (const m of (meta.primaryMuscles || [])) map.set(m, (map.get(m) || 0) + working);
      for (const m of (meta.secondaryMuscles || [])) map.set(m, (map.get(m) || 0) + working * 0.5);
    }
  }
  return map;
}

// EMA trend for body metrics
export function emaTrend(points, alpha = 0.1) {
  if (!points.length) return [];
  let t = points[0].value;
  return points.map(p => { t = t + alpha * (p.value - t); return { ts: p.ts, value: p.value, trend: t }; });
}

export function usNavyBodyFat({ sex, waistCm, neckCm, heightCm, hipCm }) {
  if (!waistCm || !neckCm || !heightCm) return null;
  const log10 = Math.log10;
  if (sex === 'female') {
    if (!hipCm) return null;
    return 495 / (1.29579 - 0.35004 * log10(waistCm + hipCm - neckCm) + 0.22100 * log10(heightCm)) - 450;
  }
  return 495 / (1.0324 - 0.19077 * log10(waistCm - neckCm) + 0.15456 * log10(heightCm)) - 450;
}
