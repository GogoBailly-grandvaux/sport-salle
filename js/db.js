// db.js — IndexedDB wrapper. Local-first, multi-profile.
const DB_NAME = 'gym-salle';
const DB_VERSION = 1;
let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
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
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return _db.transaction(store, mode).objectStore(store);
}
const wrap = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

export const get      = (store, key)        => wrap(tx(store).get(key));
export const getAll   = (store)             => wrap(tx(store).getAll());
export const put      = (store, obj)        => wrap(tx(store, 'readwrite').put(obj));
export const del      = (store, key)        => wrap(tx(store, 'readwrite').delete(key));
export const clear    = (store)             => wrap(tx(store, 'readwrite').clear());

export function getAllByIndex(store, index, query) {
  return wrap(tx(store).index(index).getAll(query));
}
// Range over a compound index prefix: [value, low..high]
export function getByProfile(store, index, profileId) {
  const range = IDBKeyRange.bound([profileId], [profileId, []]);
  return wrap(tx(store).index(index).getAll(range));
}

export async function bulkPut(store, objs) {
  const t = _db.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  for (const o of objs) os.put(o);
  return new Promise((res, rej) => { t.oncomplete = () => res(true); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}

export async function deleteWhere(store, index, profileId) {
  const rows = await getAllByIndex(store, index, profileId);
  const t = _db.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  for (const r of rows) os.delete(os.keyPath && Array.isArray(os.keyPath) ? os.keyPath.map(k => r[k]) : r.id);
  return new Promise((res) => { t.oncomplete = () => res(rows.length); });
}

export function rawDB() { return _db; }
