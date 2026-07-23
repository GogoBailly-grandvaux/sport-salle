// store.js — app state, navigation bridge, profiles & settings. Imports only db/util.
import * as db from './db.js';
import { uid, nowTs } from './util.js';

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, fn);

// Router bridge — app.js fills these in.
export const nav = { go(){}, refresh(){}, back(){ history.back(); }, current: '' };

export const ACCENTS = {
  volt:  { name: 'Volt',  hex: '#c7f24e' },
  ember: { name: 'Ember', hex: '#f2a63c' },
  ice:   { name: 'Ice',   hex: '#54c5f2' },
  rose:  { name: 'Rose',  hex: '#f2679b' },
  mint:  { name: 'Mint',  hex: '#3ee0a8' },
  grape: { name: 'Grape', hex: '#b989f2' },
};

export const DEFAULT_PSETTINGS = {
  weightUnit: 'kg',
  defaultRestSec: 120,
  e1rmFormula: 'epley',
  weeklyGoal: 3,
  barWeightKg: 20,
  sound: true,
  vibration: true,
};

export const state = {
  profiles: [],
  activeProfileId: null,
  global: null,     // global settings doc
  psettings: null,  // active profile settings (merged with defaults)
  library: [],      // exercise library (set by data.js)
  libraryById: new Map(),
};

export function activeProfile() {
  return state.profiles.find(p => p.id === state.activeProfileId) || null;
}
export function accentHex(profile = activeProfile()) {
  return (profile && ACCENTS[profile.accent]?.hex) || ACCENTS.ember.hex;
}
export function ps(key) {
  return state.psettings ? state.psettings[key] : DEFAULT_PSETTINGS[key];
}

// ---- settings persistence ----
export async function loadGlobal() {
  let g = await db.get('settings', 'global');
  if (!g) { g = { id: 'global', activeProfileId: null, theme: 'system', seededExercises: false }; await db.put('settings', g); }
  state.global = g;
  return g;
}
export async function saveGlobal(patch) {
  Object.assign(state.global, patch);
  await db.put('settings', state.global);
}
export async function loadPSettings(profileId) {
  const doc = await db.get('settings', 'p:' + profileId);
  state.psettings = { ...DEFAULT_PSETTINGS, ...(doc?.data || {}) };
  return state.psettings;
}
export async function savePSettings(patch) {
  Object.assign(state.psettings, patch);
  await db.put('settings', { id: 'p:' + state.activeProfileId, data: state.psettings, updatedAt: nowTs() });
  emit('settings');
}

// ---- profiles ----
export async function loadProfiles() {
  state.profiles = (await db.getAll('profiles')).sort((a, b) => a.createdAt - b.createdAt);
  return state.profiles;
}
export async function createProfile({ name, accent = 'ember', emoji = null }) {
  const p = { id: uid(), name: name.trim() || 'Athlète', accent, emoji,
    heightCm: null, sex: null, createdAt: nowTs(), updatedAt: nowTs() };
  await db.put('profiles', p);
  await db.put('settings', { id: 'p:' + p.id, data: { ...DEFAULT_PSETTINGS }, updatedAt: nowTs() });
  state.profiles.push(p);
  return p;
}
export async function updateProfile(id, patch) {
  const p = state.profiles.find(x => x.id === id);
  if (!p) return;
  Object.assign(p, patch, { updatedAt: nowTs() });
  await db.put('profiles', p);
  emit('profiles');
}
export async function setActiveProfile(id) {
  state.activeProfileId = id;
  await saveGlobal({ activeProfileId: id });
  await loadPSettings(id);
  applyTheme();
  emit('profile-changed');
}
export async function deleteProfile(id) {
  await Promise.all([
    db.deleteWhere('routines', 'profileId', id),
    db.deleteWhere('workouts', 'profileId', id),
    db.deleteWhere('bodyMetrics', 'profileId', id),
    db.deleteWhere('favorites', 'profileId', id),
  ]);
  await db.del('settings', 'p:' + id);
  await db.del('profiles', id);
  state.profiles = state.profiles.filter(p => p.id !== id);
}

// ---- theme ----
export function applyTheme() {
  const theme = state.global?.theme || 'system';
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  root.style.setProperty('--accent', accentHex());
  const p = activeProfile();
  root.style.setProperty('--accent-2', p ? accentHex(p) : ACCENTS.ember.hex);
  // update <meta theme-color> to match current bg
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const mc = document.querySelector('meta[name="theme-color"]');
  if (mc) mc.setAttribute('content', dark ? '#0c0d10' : '#f4f1ea');
}
