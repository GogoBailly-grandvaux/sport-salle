// templates.js — programmes prêts à l'emploi (starter templates)
// Tous les IDs proviennent de free-exercise-db (vérifiés).
import { state } from './store.js';
import * as db from './db.js';
import { uid, nowTs } from './util.js';
import { mkRoutineItem } from './model.js';

// it: { ex, sets, reps:[min,max], rest }
let _orderSeq = 0;
const nextOrder = () => Date.now() + (_orderSeq++ % 1000) / 1000; // départage même-milliseconde

export const TEMPLATES = [
  {
    id: 'comeback-a', name: 'Comeback Machines · A', level: 'Débutant', goal: 'Full body',
    tagline: 'Reprise en douceur, tout sur machines. Idéal 2-3×/semaine en alternance avec le B.',
    items: [
      { ex: 'Leg_Press', sets: 3, reps: [12, 12], rest: 90 },
      { ex: 'Leverage_Chest_Press', sets: 3, reps: [12, 12], rest: 90 },
      { ex: 'Wide-Grip_Lat_Pulldown', sets: 3, reps: [12, 12], rest: 90 },
      { ex: 'Seated_Cable_Rows', sets: 3, reps: [12, 12], rest: 90 },
      { ex: 'Machine_Shoulder_Military_Press', sets: 3, reps: [12, 12], rest: 90 },
      { ex: 'Seated_Leg_Curl', sets: 3, reps: [12, 12], rest: 75 },
      { ex: 'Plank', sets: 3, reps: [1, 1], rest: 45 },
    ],
  },
  {
    id: 'comeback-b', name: 'Comeback Machines · B', level: 'Débutant', goal: 'Full body',
    tagline: 'Le complément du A : mêmes muscles, angles différents.',
    items: [
      { ex: 'Leg_Press', sets: 3, reps: [15, 15], rest: 90 },
      { ex: 'Butterfly', sets: 3, reps: [12, 12], rest: 75 },
      { ex: 'Seated_Cable_Rows', sets: 3, reps: [12, 12], rest: 90 },
      { ex: 'Close-Grip_Front_Lat_Pulldown', sets: 3, reps: [12, 12], rest: 90 },
      { ex: 'Cable_Seated_Lateral_Raise', sets: 3, reps: [15, 15], rest: 60 },
      { ex: 'Leg_Extensions', sets: 3, reps: [15, 15], rest: 75 },
      { ex: 'Cable_Crunch', sets: 3, reps: [15, 15], rest: 60 },
    ],
  },
  {
    id: 'fullbody-halteres', name: 'Full Body Haltères', level: 'Débutant', goal: 'Full body',
    tagline: 'Tout le corps avec une paire d’haltères. Parfait pour débuter ou pour la maison.',
    items: [
      { ex: 'Goblet_Squat', sets: 3, reps: [10, 12], rest: 90 },
      { ex: 'Dumbbell_Bench_Press', sets: 3, reps: [8, 12], rest: 90 },
      { ex: 'One-Arm_Dumbbell_Row', sets: 3, reps: [10, 12], rest: 90 },
      { ex: 'Dumbbell_Shoulder_Press', sets: 3, reps: [8, 12], rest: 90 },
      { ex: 'Dumbbell_Lunges', sets: 3, reps: [10, 10], rest: 75 },
      { ex: 'Crunches', sets: 3, reps: [15, 20], rest: 45 },
    ],
  },
  {
    id: 'ppl-push', name: 'Push · Pectoraux / Épaules / Triceps', level: 'Intermédiaire', goal: 'Prise de muscle',
    tagline: 'Jour 1 du classique Push/Pull/Legs.',
    items: [
      { ex: 'Barbell_Bench_Press_-_Medium_Grip', sets: 4, reps: [6, 10], rest: 150 },
      { ex: 'Incline_Dumbbell_Press', sets: 3, reps: [8, 12], rest: 120 },
      { ex: 'Machine_Shoulder_Military_Press', sets: 3, reps: [8, 12], rest: 120 },
      { ex: 'Side_Lateral_Raise', sets: 3, reps: [12, 15], rest: 60 },
      { ex: 'Triceps_Pushdown_-_Rope_Attachment', sets: 3, reps: [10, 15], rest: 60 },
      { ex: 'Dips_-_Triceps_Version', sets: 3, reps: [8, 12], rest: 90 },
    ],
  },
  {
    id: 'ppl-pull', name: 'Pull · Dos / Biceps', level: 'Intermédiaire', goal: 'Prise de muscle',
    tagline: 'Jour 2 du Push/Pull/Legs : tirages et biceps.',
    items: [
      { ex: 'Barbell_Deadlift', sets: 3, reps: [5, 8], rest: 180 },
      { ex: 'Wide-Grip_Lat_Pulldown', sets: 3, reps: [8, 12], rest: 120 },
      { ex: 'Bent_Over_Barbell_Row', sets: 3, reps: [8, 12], rest: 120 },
      { ex: 'Face_Pull', sets: 3, reps: [12, 15], rest: 60 },
      { ex: 'Barbell_Curl', sets: 3, reps: [8, 12], rest: 75 },
      { ex: 'Hammer_Curls', sets: 3, reps: [10, 12], rest: 60 },
    ],
  },
  {
    id: 'ppl-legs', name: 'Legs · Jambes complètes', level: 'Intermédiaire', goal: 'Prise de muscle',
    tagline: 'Jour 3 du Push/Pull/Legs : quadris, ischios, mollets.',
    items: [
      { ex: 'Barbell_Squat', sets: 4, reps: [6, 10], rest: 180 },
      { ex: 'Leg_Press', sets: 3, reps: [10, 12], rest: 120 },
      { ex: 'Romanian_Deadlift', sets: 3, reps: [8, 12], rest: 120 },
      { ex: 'Leg_Extensions', sets: 3, reps: [12, 15], rest: 75 },
      { ex: 'Lying_Leg_Curls', sets: 3, reps: [12, 15], rest: 75 },
      { ex: 'Standing_Calf_Raises', sets: 4, reps: [12, 20], rest: 60 },
    ],
  },
  {
    id: 'upper', name: 'Haut du corps', level: 'Intermédiaire', goal: 'Split Haut/Bas',
    tagline: 'La moitié « haut » du split Haut/Bas, 2×/semaine.',
    items: [
      { ex: 'Barbell_Bench_Press_-_Medium_Grip', sets: 3, reps: [6, 10], rest: 150 },
      { ex: 'Bent_Over_Barbell_Row', sets: 3, reps: [8, 12], rest: 120 },
      { ex: 'Machine_Shoulder_Military_Press', sets: 3, reps: [8, 12], rest: 120 },
      { ex: 'Wide-Grip_Lat_Pulldown', sets: 3, reps: [10, 12], rest: 90 },
      { ex: 'Barbell_Curl', sets: 2, reps: [10, 12], rest: 60 },
      { ex: 'Triceps_Pushdown', sets: 2, reps: [10, 15], rest: 60 },
    ],
  },
  {
    id: 'lower-glutes', name: 'Bas du corps & Fessiers', level: 'Tous niveaux', goal: 'Split Haut/Bas',
    tagline: 'Jambes et fessiers — très populaire, redoutablement efficace.',
    items: [
      { ex: 'Barbell_Squat', sets: 3, reps: [8, 10], rest: 150 },
      { ex: 'Barbell_Hip_Thrust', sets: 3, reps: [10, 12], rest: 120 },
      { ex: 'Romanian_Deadlift', sets: 3, reps: [10, 12], rest: 120 },
      { ex: 'Dumbbell_Lunges', sets: 3, reps: [10, 10], rest: 90 },
      { ex: 'Seated_Leg_Curl', sets: 3, reps: [12, 15], rest: 75 },
      { ex: 'Standing_Calf_Raises', sets: 3, reps: [15, 20], rest: 60 },
    ],
  },
  {
    id: 'maison', name: 'Express Maison', level: 'Tous niveaux', goal: 'Sans matériel',
    tagline: '20-25 min au poids du corps, zéro matériel. Pour les jours sans salle.',
    items: [
      { ex: 'Pushups', sets: 3, reps: [8, 15], rest: 60 },
      { ex: 'Bodyweight_Squat', sets: 3, reps: [15, 20], rest: 60 },
      { ex: 'Bodyweight_Walking_Lunge', sets: 3, reps: [10, 12], rest: 60 },
      { ex: 'Mountain_Climbers', sets: 3, reps: [20, 20], rest: 45 },
      { ex: 'Plank', sets: 3, reps: [1, 1], rest: 45 },
      { ex: 'Crunches', sets: 3, reps: [15, 20], rest: 45 },
    ],
  },
];

export async function addTemplate(tpl) {
  const r = {
    id: uid(), profileId: state.activeProfileId, name: tpl.name, description: tpl.tagline || '',
    color: null, items: [], order: nextOrder(), isArchived: false, createdAt: nowTs(), updatedAt: nowTs(),
  };
  tpl.items.forEach((it, i) => {
    const item = mkRoutineItem(it.ex, i);
    item.targetSets = it.sets;
    item.targetRepsMin = it.reps[0];
    item.targetRepsMax = it.reps[1] ?? it.reps[0];
    item.restSec = it.rest ?? 90;
    r.items.push(item);
  });
  await db.put('routines', r);
  return r;
}

// ---- partage de programme (fichier .json) ----
export function routinePayload(r) {
  const custom = [];
  for (const it of (r.items || [])) {
    if (String(it.exerciseId).startsWith('custom-')) {
      const def = state.libraryById.get(it.exerciseId);
      if (def) custom.push({
        id: def.id, name: def.name, primaryMuscles: def.primaryMuscles || [],
        secondaryMuscles: def.secondaryMuscles || [], equipment: def.equipment || 'machine',
        category: def.category || 'strength',
      });
    }
  }
  return {
    app: 'sport-salle', kind: 'routine', v: 1,
    routine: {
      name: r.name, description: r.description || '',
      items: (r.items || []).map(it => ({
        exerciseId: it.exerciseId, targetSets: it.targetSets,
        targetRepsMin: it.targetRepsMin, targetRepsMax: it.targetRepsMax,
        targetWeightKg: it.targetWeightKg ?? null, restSec: it.restSec ?? 90,
        supersetGroup: it.supersetGroup ?? null, notes: it.notes || '',
      })),
    },
    custom,
  };
}

// nettoie une chaîne venant d'un fichier/partage externe (défense en profondeur :
// on ne fait jamais confiance aux données d'autrui, même si l'affichage échappe)
const clean = (v, max) => String(v ?? '').replace(/[<>]/g, '').slice(0, max);
const cleanList = (arr) => Array.isArray(arr) ? arr.map(x => clean(x, 40)).filter(Boolean).slice(0, 8) : [];

export async function importRoutinePayload(d) {
  if (!d || d.kind !== 'routine' || !d.routine) throw new Error('format');
  // Recrée les exercices perso manquants — en RÉGÉNÉRANT un id local (jamais
  // l'id fourni : il pourrait contenir une charge XSS et casser un attribut).
  // On mappe l'ancien id → nouvel id pour recâbler les items du programme.
  const idMap = new Map();
  for (const def of (d.custom || [])) {
    const oldId = def?.id;
    if (oldId == null) continue;
    const existing = state.libraryById.get(oldId);
    if (existing && existing.source === 'custom') { idMap.set(oldId, oldId); continue; } // déjà chez moi
    const newId = 'custom-' + uid();
    const ex = {
      id: newId, profileId: state.activeProfileId,
      name: clean(def.name, 60) || 'Exercice', nameLower: clean(def.name, 60).toLowerCase(),
      primaryMuscles: cleanList(def.primaryMuscles), secondaryMuscles: cleanList(def.secondaryMuscles),
      equipment: clean(def.equipment, 20) || 'machine', category: clean(def.category, 20) || 'strength',
      level: 'intermediate', force: null, mechanic: null, instructions: [], images: [],
      source: 'custom', createdAt: nowTs(),
    };
    await db.put('customExercises', ex);
    state.library.push(ex);
    state.libraryById.set(ex.id, ex);
    idMap.set(oldId, newId);
  }
  const r = {
    id: uid(), profileId: state.activeProfileId,
    name: clean(d.routine.name, 60) || 'Programme importé', description: clean(d.routine.description, 200),
    color: null, items: [], order: nextOrder(), isArchived: false, createdAt: nowTs(), updatedAt: nowTs(),
  };
  (d.routine.items || []).forEach((s, i) => {
    const exerciseId = idMap.get(s.exerciseId) || s.exerciseId; // recâble vers l'id régénéré
    if (!state.libraryById.has(exerciseId)) return; // exercice inconnu -> on saute
    const item = mkRoutineItem(exerciseId, i);
    const num = (v, min, max, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
    item.targetSets = num(s.targetSets, 1, 20, 3);
    item.targetRepsMin = s.targetRepsMin == null ? null : num(s.targetRepsMin, 1, 100, null);
    item.targetRepsMax = s.targetRepsMax == null ? null : num(s.targetRepsMax, 1, 100, null);
    item.targetWeightKg = s.targetWeightKg == null ? null : num(s.targetWeightKg, 0, 1000, null);
    item.restSec = num(s.restSec, 0, 3600, 90);
    item.supersetGroup = s.supersetGroup == null ? null : clean(s.supersetGroup, 20);
    item.notes = clean(s.notes, 300);
    r.items.push(item);
  });
  if (!r.items.length) throw new Error('empty');
  await db.put('routines', r);
  return r;
}
