// model.js — domain operations for routines, workouts, body metrics
import * as db from './db.js';
import { state, ps } from './store.js';
import { uid, nowTs } from './util.js';
import { workoutStats, detectPRs } from './analytics.js';
import { workoutName } from './voice.js';

// ---------- constructors ----------
export const mkSet = (prev = null) => ({
  id: uid(), weightKg: prev?.weightKg ?? null, reps: prev?.reps ?? null,
  type: 'normal', done: false, rpe: null, completedAt: null,
});
export const mkExercise = (exerciseId, order) => ({
  id: uid(), exerciseId, order, supersetGroup: null, notes: '', sets: [],
});

// ---------- routines ----------
export async function listRoutines(profileId = state.activeProfileId) {
  const rows = await db.getAllByIndex('routines', 'profileId', profileId);
  return rows.filter(r => !r.isArchived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || b.updatedAt - a.updatedAt);
}
export const getRoutine = id => db.get('routines', id);
export async function saveRoutine(routine) {
  routine.updatedAt = nowTs();
  if (!routine.createdAt) routine.createdAt = routine.updatedAt;
  await db.put('routines', routine);
  return routine;
}
export async function newRoutine(name = 'Nouveau programme') {
  const r = { id: uid(), profileId: state.activeProfileId, name, description: '', color: null,
    items: [], order: Date.now(), isArchived: false, createdAt: nowTs(), updatedAt: nowTs() };
  await db.put('routines', r);
  return r;
}
export async function deleteRoutine(id) {
  const r = await db.get('routines', id);
  if (r) await db.writeTombstone(r.profileId, 'routines', id);
  return db.del('routines', id);
}

// routine item: {id, exerciseId, order, supersetGroup, targetSets, targetRepsMin, targetRepsMax, targetWeightKg, restSec, notes}
export const mkRoutineItem = (exerciseId, order) => ({
  id: uid(), exerciseId, order, supersetGroup: null,
  targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetWeightKg: null,
  restSec: ps('defaultRestSec'), notes: '',
});

// ---------- workouts ----------
export async function getActiveWorkout(profileId = state.activeProfileId) {
  const rows = await db.getAllByIndex('workouts', 'profileId', profileId);
  return rows.find(w => w.status === 'in_progress') || null;
}
export const getWorkout = id => db.get('workouts', id);
export async function listWorkouts(profileId = state.activeProfileId, { completedOnly = true } = {}) {
  let rows = await db.getAllByIndex('workouts', 'profileId', profileId);
  if (completedOnly) rows = rows.filter(w => w.status === 'completed');
  return rows.sort((a, b) => (b.completedAt || b.startedAt) - (a.completedAt || a.startedAt));
}
export const saveWorkout = w => { w.updatedAt = nowTs(); return db.put('workouts', w); };
export async function deleteWorkout(id) {
  const w = await db.get('workouts', id);
  if (w) await db.writeTombstone(w.profileId, 'workouts', id);
  return db.del('workouts', id);
}

// last performance of an exercise (most recent completed workout containing it)
export async function lastPerformance(exerciseId, profileId = state.activeProfileId) {
  const rows = (await listWorkouts(profileId));
  for (const w of rows) {
    const ex = (w.exercises || []).find(e => e.exerciseId === exerciseId);
    if (ex && (ex.sets || []).some(s => s.done)) return { ts: w.completedAt, sets: ex.sets.filter(s => s.done) };
  }
  return null;
}

export async function startWorkout({ routine = null, name = null } = {}) {
  const profileId = state.activeProfileId;
  const w = {
    id: uid(), profileId, routineId: routine?.id || null,
    name: name || routine?.name || workoutName(),
    status: 'in_progress', startedAt: nowTs(), completedAt: null, durationSec: 0,
    bodyweightKg: null, notes: '', exercises: [], totalVolumeKg: 0, prs: [],
  };
  if (routine) {
    let order = 0;
    for (const item of (routine.items || [])) {
      const ex = mkExercise(item.exerciseId, order++);
      ex.supersetGroup = item.supersetGroup || null;
      const last = await lastPerformance(item.exerciseId, profileId);
      const nSets = item.targetSets || 3;
      for (let i = 0; i < nSets; i++) {
        const prevSet = last?.sets?.[i] || null;
        const s = mkSet(prevSet);
        if (s.weightKg == null && item.targetWeightKg != null) s.weightKg = item.targetWeightKg;
        if (s.reps == null && item.targetRepsMin != null) s.reps = item.targetRepsMin;
        ex.sets.push(s);
      }
      ex._targetReps = item.targetRepsMin ? `${item.targetRepsMin}${item.targetRepsMax && item.targetRepsMax !== item.targetRepsMin ? '-' + item.targetRepsMax : ''}` : null;
      ex._targetRepsMax = item.targetRepsMax ?? item.targetRepsMin ?? null;
      ex._restSec = item.restSec ?? ps('defaultRestSec');
      w.exercises.push(ex);
    }
    if (routine.id) { routine.lastPerformedAt = nowTs(); await db.put('routines', routine); }
  }
  await db.put('workouts', w);
  return w;
}

export async function finishWorkout(w) {
  const profileId = w.profileId;
  const prior = (await listWorkouts(profileId)).filter(x => x.id !== w.id);
  const prs = detectPRs(w, prior, ps('e1rmFormula'));
  w.status = 'completed';
  w.completedAt = nowTs();
  // durée = temps ACTIF (chrono séance) ; repli sur le temps écoulé pour les anciennes séances
  w.durationSec = w.activeSec != null ? Math.round(w.activeSec) : Math.round((w.completedAt - w.startedAt) / 1000);
  w.totalVolumeKg = workoutStats(w, ps('e1rmFormula')).volume;
  w.prs = prs;
  // drop fully-empty exercises
  w.exercises = (w.exercises || []).filter(ex => (ex.sets || []).some(s => s.done));
  await db.put('workouts', w);
  return { prs };
}

// ---------- body metrics ----------
export async function listMetrics(type, profileId = state.activeProfileId) {
  const rows = await db.getAllByIndex('bodyMetrics', 'profileId', profileId);
  return rows.filter(m => m.type === type).sort((a, b) => a.date.localeCompare(b.date));
}
export async function addMetric({ type, value, date, notes = '' }) {
  const m = { id: uid(), profileId: state.activeProfileId, type, value, date, notes, createdAt: nowTs() };
  await db.put('bodyMetrics', m);
  return m;
}
export async function deleteMetric(id) {
  const m = await db.get('bodyMetrics', id);
  if (m) await db.writeTombstone(m.profileId, 'bodyMetrics', id);
  return db.del('bodyMetrics', id);
}

export async function latestMetric(type, profileId = state.activeProfileId) {
  const rows = await listMetrics(type, profileId);
  return rows.length ? rows[rows.length - 1] : null;
}
