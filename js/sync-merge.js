// sync-merge.js — fusion de deux instantanés de profil (fonctions pures, sans dépendance).
// Règle : « le plus récent gagne » par enregistrement (updatedAt/createdAt),
// et les suppressions (tombstones) l'emportent si elles sont plus récentes.

export const SYNC_STORES = ['routines', 'workouts', 'bodyMetrics', 'favorites', 'customExercises'];

export const stamp = r => (r && (r.updatedAt || r.createdAt)) || 0;
const newer = (x, y) => (!x ? y : !y ? x : (stamp(y) > stamp(x) ? y : x));
export const favKey = r => r.profileId + '|' + r.exerciseId;
const keyOf = (store, r) => store === 'favorites' ? favKey(r) : r.id;

// Union des tombstones par (store, recordId), en gardant le deletedAt le plus récent.
function unionTombstones(a = [], b = []) {
  const m = new Map();
  for (const t of [...a, ...b]) {
    if (!t || !t.store || !t.recordId) continue;
    const k = t.store + '|' + t.recordId;
    const cur = m.get(k);
    if (!cur || (t.deletedAt || 0) > (cur.deletedAt || 0)) m.set(k, t);
  }
  return [...m.values()];
}

// a, b : instantanés { v, profile, settings, tombstones[], stores{} } ou null.
// Retourne l'instantané fusionné (jamais null si l'un des deux existe).
export function mergeSnapshots(a, b) {
  if (!a) return b;
  if (!b) return a;
  const tombstones = unionTombstones(a.tombstones, b.tombstones);

  // Profil supprimé ? Un tombstone store='profiles' plus récent que le doc profil l'emporte.
  const profile = newer(a.profile, b.profile);
  const profTomb = tombstones.find(t => t.store === 'profiles');
  const deletedWins = profTomb
    ? (profTomb.deletedAt || 0) >= stamp(profile)
    : ((a.deleted || b.deleted) && !profile); // marqueur hérité sans tombstone : supprimé si personne n'a le doc
  if (deletedWins) {
    return { v: 1, deleted: true, profile: null, settings: null, tombstones, stores: {} };
  }

  const out = {
    v: 1,
    profile,
    settings: newer(a.settings, b.settings),
    tombstones,
    stores: {},
  };
  for (const s of SYNC_STORES) {
    const m = new Map();
    for (const r of [...(a.stores?.[s] || []), ...(b.stores?.[s] || [])]) {
      if (!r) continue;
      const k = keyOf(s, r);
      const cur = m.get(k);
      if (!cur || stamp(r) > stamp(cur)) m.set(k, r);
    }
    for (const t of tombstones) {
      if (t.store !== s) continue;
      const cur = m.get(t.recordId);
      if (cur && (t.deletedAt || 0) >= stamp(cur)) m.delete(t.recordId);
    }
    out.stores[s] = [...m.values()];
  }
  return out;
}
