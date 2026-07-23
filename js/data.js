// data.js — exercise library (free-exercise-db) + custom exercises + favorites
import * as db from './db.js';
import { state } from './store.js';
import { uid, nowTs } from './util.js';

const CDN = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/';

export const MUSCLE_FR = {
  abdominals:'Abdos', abductors:'Abducteurs', adductors:'Adducteurs', biceps:'Biceps',
  calves:'Mollets', chest:'Pectoraux', forearms:'Avant-bras', glutes:'Fessiers',
  hamstrings:'Ischios', lats:'Dorsaux', 'lower back':'Lombaires', 'middle back':'Milieu du dos',
  neck:'Cou', quadriceps:'Quadriceps', shoulders:'Épaules', traps:'Trapèzes', triceps:'Triceps',
};
export const EQUIP_FR = {
  barbell:'Barre', dumbbell:'Haltères', kettlebells:'Kettlebell', cable:'Poulie', machine:'Machine',
  'body only':'Poids du corps', bands:'Élastiques', 'medicine ball':'Medicine ball',
  'exercise ball':'Swiss ball', 'foam roll':'Rouleau', 'e-z curl bar':'Barre EZ', other:'Autre', null:'—',
};
export const CATEGORY_FR = {
  strength:'Force', stretching:'Étirement', plyometrics:'Pliométrie', strongman:'Strongman',
  powerlifting:'Powerlifting', cardio:'Cardio', 'olympic weightlifting':'Haltérophilie',
};
export const LEVEL_FR = { beginner:'Débutant', intermediate:'Intermédiaire', expert:'Expert' };
export const FORCE_FR = { pull:'Tirage', push:'Poussée', static:'Statique', null:'—' };

// broad muscle group -> for volume analytics & color
export const MUSCLE_GROUP = {
  chest:'Pectoraux', 'chest ':'Pectoraux',
  lats:'Dos', 'middle back':'Dos', 'lower back':'Dos', traps:'Dos',
  shoulders:'Épaules', neck:'Épaules',
  biceps:'Bras', triceps:'Bras', forearms:'Bras',
  quadriceps:'Jambes', hamstrings:'Jambes', glutes:'Jambes', calves:'Jambes',
  abductors:'Jambes', adductors:'Jambes',
  abdominals:'Abdos',
};
export const muscleFR = m => MUSCLE_FR[m] || m;
export const musclesFR = (arr=[]) => arr.map(muscleFR);

export function imageUrls(ex) {
  if (!ex || !ex.images) return [];
  return ex.images.map(p => CDN + p);
}

let _loaded = false;
export const DATA_VERSION = '2'; // à incrémenter à chaque mise à jour de data/exercises.json (voir aussi sw.js)
export async function loadLibrary() {
  const res = await fetch('./data/exercises.json?v=' + DATA_VERSION);
  const raw = await res.json();
  // Nom FR en priorité s'il existe (enrichissement wger) ; la recherche matche FR + EN.
  const lib = raw.map(e => {
    const en = e.name || '';
    const fr = e.nameFr || null;
    return {
      ...e,
      name: fr || en,
      nameEn: en,
      nameLower: (en + ' ' + (fr || '')).toLowerCase(),
      source: 'library',
    };
  });
  const custom = (await db.getAll('customExercises')).map(e => ({ ...e, nameLower: e.nameLower || (e.name||'').toLowerCase(), source: 'custom' }));
  state.library = lib.concat(custom);
  state.libraryById = new Map(state.library.map(e => [e.id, e]));
  _loaded = true;
  return state.library;
}

export const getExercise = id => state.libraryById.get(id) || null;

export function allValues(field) {
  const s = new Set();
  for (const e of state.library) {
    const v = e[field];
    if (Array.isArray(v)) v.forEach(x => x && s.add(x));
    else if (v) s.add(v);
  }
  return [...s].sort();
}

export function searchExercises({ q = '', muscle = '', equipment = '', category = '', favSet = null } = {}) {
  const qq = q.trim().toLowerCase();
  let out = state.library;
  if (qq) out = out.filter(e => e.nameLower.includes(qq));
  if (muscle) out = out.filter(e => (e.primaryMuscles||[]).includes(muscle) || (e.secondaryMuscles||[]).includes(muscle));
  if (equipment) out = out.filter(e => e.equipment === equipment);
  if (category) out = out.filter(e => e.category === category);
  if (favSet) out = out.filter(e => favSet.has(e.id));
  return out.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function addCustomExercise({ name, primaryMuscles = [], secondaryMuscles = [], equipment = 'machine', category = 'strength' }) {
  const ex = {
    id: 'custom-' + uid(), name: name.trim(), nameLower: name.trim().toLowerCase(),
    primaryMuscles, secondaryMuscles, equipment, category, level: 'intermediate',
    force: null, mechanic: null, instructions: [], images: [], source: 'custom',
    createdAt: nowTs(),
  };
  await db.put('customExercises', ex);
  state.library.push(ex);
  state.libraryById.set(ex.id, ex);
  return ex;
}
export async function deleteCustomExercise(id) {
  await db.del('customExercises', id);
  state.library = state.library.filter(e => e.id !== id);
  state.libraryById.delete(id);
}

// ---- favorites ----
export async function loadFavorites(profileId) {
  const rows = await db.getAllByIndex('favorites', 'profileId', profileId);
  return new Set(rows.map(r => r.exerciseId));
}
export async function toggleFavorite(profileId, exerciseId, on) {
  if (on) await db.put('favorites', { profileId, exerciseId, createdAt: nowTs() });
  else await db.del('favorites', [profileId, exerciseId]);
}
