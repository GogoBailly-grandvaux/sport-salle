// db.js — IndexedDB wrapper. Local-first, multi-profile.
import { uid } from './util.js';

const DB_NAME = 'gym-salle';
const DB_VERSION = 3; // v3 : store 'photos' (photos de progression, LOCAL uniquement, jamais synchronisé)
let _db = null;
let _opening = null; // promesse d'ouverture en cours (évite les ouvertures concurrentes)

// Hook facultatif appelé après chaque écriture réussie (utilisé par la synchro).
let _onWrite = null;
export const setOnWrite = fn => { _onWrite = fn; };
const notify = (store, obj, kind) => { try { _onWrite && _onWrite(store, obj, kind); } catch {} };

// Safari iOS ferme les connexions IndexedDB quand l'app passe en arrière-plan
// (« The database connection is closing »). On invalide le handle dès que la
// connexion meurt, et chaque opération rouvre la base + réessaie une fois.
function dropDB() { try { _db && _db.close(); } catch {} _db = null; }

export function openDB() {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;
  _opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const mk = (name, opts, indexes = []) => {
        const s = db.objectStoreNames.contains(name)
          ? req.transaction.objectStore(name)
          : db.createObjectStore(name, opts);
        for (const [iname, kp, io] of indexes) {
          if (!s.indexNames.contains(iname)) s.createIndex(iname, kp, io || {});
        }
        return s;
      };
      mk('profiles', { keyPath: 'id' }, [['createdAt','createdAt']]);
      mk('settings', { keyPath: 'id' });
      mk('customExercises', { keyPath: 'id' }, [['profileId','profileId']]);
      mk('favorites', { keyPath: ['profileId','exerciseId'] }, [['profileId','profileId']]);
      mk('routines', { keyPath: 'id' }, [
        ['profileId','profileId'],
        ['profile_order',['profileId','order']],
      ]);
      mk('workouts', { keyPath: 'id' }, [
        ['profileId','profileId'],
        ['profile_status',['profileId','status']],
        ['profile_started',['profileId','startedAt']],
      ]);
      mk('bodyMetrics', { keyPath: 'id' }, [
        ['profileId','profileId'],
        ['profile_type_date',['profileId','type','date']],
      ]);
      mk('deletions', { keyPath: 'id' }, [
        ['profileId','profileId'],
      ]);
      // photos de progression : restent sur l'appareil (absent de SYNC_STORES) — vie privée
      mk('photos', { keyPath: 'id' }, [
        ['profileId','profileId'],
        ['profile_date',['profileId','date']],
      ]);
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onclose = () => { _db = null; };  // fermeture forcée par l'OS (Safari en arrière-plan)
      _db.onversionchange = () => dropDB(); // un autre onglet migre la base → on libère
      _opening = null;
      resolve(_db);
    };
    req.onerror = () => { _opening = null; reject(req.error); };
  });
  return _opening;
}

// Retour d'arrière-plan (bfcache iOS) : le handle peut être mort sans événement — on repart propre.
try { addEventListener('pageshow', (e) => { if (e.persisted) dropDB(); }); } catch {}

// Ouvre une transaction en survivant aux fermetures sauvages de Safari :
// connexion morte → on rouvre la base et on réessaie une fois.
async function tx(store, mode = 'readonly') {
  for (let attempt = 0; ; attempt++) {
    const db = await openDB();
    try { return db.transaction(store, mode); }
    catch (e) {
      const dead = e && (e.name === 'InvalidStateError' || e.name === 'UnknownError');
      if (dead && attempt === 0) { if (_db === db) dropDB(); continue; }
      throw e;
    }
  }
}
const os = async (store, mode) => (await tx(store, mode)).objectStore(store);

const wrap = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

export const get      = async (store, key)  => wrap((await os(store)).get(key));
export const getAll   = async (store)       => wrap((await os(store)).getAll());
export const put      = async (store, obj)  => wrap((await os(store, 'readwrite')).put(obj)).then(v => { notify(store, obj, 'put'); return v; });
export const del      = async (store, key)  => wrap((await os(store, 'readwrite')).delete(key)).then(v => { notify(store, key, 'del'); return v; });
export const clear    = async (store)       => wrap((await os(store, 'readwrite')).clear());

// Tombstone : trace de suppression, pour que la synchro la propage aux autres appareils.
export function writeTombstone(profileId, storeName, recordId) {
  return put('deletions', { id: uid(), profileId, store: storeName, recordId, deletedAt: Date.now() });
}

export async function getAllByIndex(store, index, query) {
  return wrap((await os(store)).index(index).getAll(query));
}
// Range over a compound index prefix: [value, low..high]
export async function getByProfile(store, index, profileId) {
  const range = IDBKeyRange.bound([profileId], [profileId, []]);
  return wrap((await os(store)).index(index).getAll(range));
}

export async function bulkPut(store, objs) {
  const t = await tx(store, 'readwrite');
  const s = t.objectStore(store);
  for (const o of objs) s.put(o);
  return new Promise((res, rej) => {
    t.oncomplete = () => { for (const o of objs) notify(store, o, 'put'); res(true); };
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}

export async function deleteWhere(store, index, profileId) {
  const rows = await getAllByIndex(store, index, profileId);
  const t = await tx(store, 'readwrite');
  const s = t.objectStore(store);
  for (const r of rows) s.delete(s.keyPath && Array.isArray(s.keyPath) ? s.keyPath.map(k => r[k]) : r.id);
  return new Promise((res) => { t.oncomplete = () => res(rows.length); });
}

export function rawDB() { return _db; }
