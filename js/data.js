// data.js — exercise library (free-exercise-db) + custom exercises + favorites
import * as db from './db.js';
import { state, on } from './store.js';
import { uid, nowTs } from './util.js';
import { locale, t } from './i18n.js';

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
const MUSCLE_EN = {
  abdominals:'Abs', abductors:'Abductors', adductors:'Adductors', biceps:'Biceps',
  calves:'Calves', chest:'Chest', forearms:'Forearms', glutes:'Glutes',
  hamstrings:'Hamstrings', lats:'Lats', 'lower back':'Lower back', 'middle back':'Middle back',
  neck:'Neck', quadriceps:'Quads', shoulders:'Shoulders', traps:'Traps', triceps:'Triceps',
};
export const muscleFR = m => (locale() === 'en' ? (MUSCLE_EN[m] || m) : (MUSCLE_FR[m] || m));
export const musclesFR = (arr=[]) => arr.map(muscleFR);

// instructions localisées : en FR, on charge (paresseusement, une fois) la
// traduction data/instructions-fr.json ; repli sur l'anglais d'origine.
let _instrFr = null;
export async function instructionsFor(ex) {
  const base = ex?.instructions || [];
  if (locale() === 'en' || !ex) return base;
  if (_instrFr === null) {
    try { _instrFr = await (await fetch('./data/instructions-fr.json?v=' + DATA_VERSION)).json(); }
    catch { _instrFr = {}; }
  }
  const fr = _instrFr[ex.id];
  return (fr && fr.length) ? fr : base;
}

export function imageUrls(ex) {
  if (!ex || !ex.images) return [];
  return ex.images.map(p => p.startsWith('http') ? p : CDN + p);
}

// carte musculaire wger (silhouettes + overlays), chargée à la demande
let _musclesMap = null;
export async function musclesMap() {
  if (_musclesMap !== null) return _musclesMap;
  try { _musclesMap = await (await fetch('./data/muscles-map.json?v=' + DATA_VERSION)).json(); }
  catch { _musclesMap = false; }
  return _musclesMap;
}

let _loaded = false;
let _baseLib = []; // bibliothèque intégrée (partagée entre profils)
export const DATA_VERSION = '3'; // à incrémenter à chaque mise à jour de data/exercises.json (voir aussi sw.js)

// Recharge les exercices perso du profil actif (les anciens sans profileId restent visibles par tous).
export async function refreshCustoms() {
  const all = await db.getAll('customExercises');
  const mine = all
    .filter(e => e.profileId == null || e.profileId === state.activeProfileId)
    .map(e => ({ ...e, nameLower: e.nameLower || (e.name || '').toLowerCase(), source: 'custom' }));
  state.library = _baseLib.concat(mine);
  state.libraryById = new Map(state.library.map(e => [e.id, e]));
  return state.library;
}

export async function loadLibrary() {
  const res = await fetch('./data/exercises.json?v=' + DATA_VERSION);
  if (!res.ok) throw new Error('Bibliothèque d’exercices introuvable (' + res.status + ')');
  const raw = await res.json();
  // Nom FR en priorité s'il existe (enrichissement wger) ; la recherche matche FR + EN.
  const en_ = locale() === 'en';
  _baseLib = raw.map(e => {
    const en = e.name || '';
    const fr = e.nameFr || null;
    return {
      ...e,
      name: en_ ? en : (fr || en),   // le nom affiché suit la langue de l'app
      nameFr: fr, nameEn: en,
      nameLower: (en + ' ' + (fr || '')).toLowerCase(), // la recherche matche FR + EN
      source: 'library',
    };
  });
  await refreshCustoms();
  _loaded = true;
  return state.library;
}

// re-filtre les exercices perso à chaque changement de profil
on('profile-changed', () => { if (_loaded) refreshCustoms(); });

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

const fold = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // insensible aux accents

export function searchExercises({ q = '', muscle = '', equipment = '', category = '', favSet = null } = {}) {
  const qq = fold(q.trim().toLowerCase());
  let out = state.library;
  if (qq) out = out.filter(e => fold(e.nameLower).includes(qq));
  if (muscle) out = out.filter(e => (e.primaryMuscles||[]).includes(muscle) || (e.secondaryMuscles||[]).includes(muscle));
  if (equipment) out = out.filter(e => e.equipment === equipment);
  if (category) out = out.filter(e => e.category === category);
  if (favSet) out = out.filter(e => favSet.has(e.id));
  if (!qq) return out.slice().sort((a, b) => a.name.localeCompare(b.name));
  // pertinence sur le nom AFFICHÉ (FR d'abord) : commence par > début de mot > ailleurs (nom EN…) — puis alphabétique
  const score = e => {
    const disp = fold(e.name.toLowerCase());
    if (disp.startsWith(qq)) return 0;
    if (disp.includes(' ' + qq) || disp.includes('-' + qq)) return 1;
    return 2;
  };
  return out.slice().sort((a, b) => (score(a) - score(b)) || a.name.localeCompare(b.name));
}

export async function addCustomExercise({ name, primaryMuscles = [], secondaryMuscles = [], equipment = 'machine', category = 'strength' }) {
  const ex = {
    id: 'custom-' + uid(), profileId: state.activeProfileId,
    name: name.trim(), nameLower: name.trim().toLowerCase(),
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
  const ex = await db.get('customExercises', id);
  await db.writeTombstone(ex?.profileId || state.activeProfileId, 'customExercises', id);
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
  else {
    await db.writeTombstone(profileId, 'favorites', profileId + '|' + exerciseId);
    await db.del('favorites', [profileId, exerciseId]);
  }
}
