import { mergeSnapshots, SYNC_STORES } from '../js/sync-merge.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`✗ ${name}\n   got  ${g}\n   want ${w}`); }
};
const snap = (over = {}) => ({ v:1, profile:null, settings:null, tombstones:[], stores:{}, ...over });

// 1. null handling
eq('null+null', mergeSnapshots(null, null), null);
const a1 = snap({ profile:{id:'p1',name:'Hugo',updatedAt:10} });
eq('a+null', mergeSnapshots(a1, null), a1);
eq('null+b', mergeSnapshots(null, a1), a1);

// 2. LWW on profile + settings
const m2 = mergeSnapshots(
  snap({ profile:{id:'p1',name:'Hugo',updatedAt:10}, settings:{id:'p:p1',data:{u:'kg'},updatedAt:5} }),
  snap({ profile:{id:'p1',name:'Hugo B',updatedAt:20}, settings:{id:'p:p1',data:{u:'lb'},updatedAt:3} }),
);
eq('profile LWW', m2.profile.name, 'Hugo B');
eq('settings LWW', m2.settings.data.u, 'kg');

// 3. store union + LWW by id
const m3 = mergeSnapshots(
  snap({ stores:{ workouts:[{id:'w1',updatedAt:10,vol:100},{id:'w2',updatedAt:10}] } }),
  snap({ stores:{ workouts:[{id:'w1',updatedAt:30,vol:200},{id:'w3',updatedAt:5}] } }),
);
eq('union count', m3.stores.workouts.length, 3);
eq('w1 newest wins', m3.stores.workouts.find(w=>w.id==='w1').vol, 200);

// 4. tombstone deletes older record, keeps newer record
const m4 = mergeSnapshots(
  snap({ stores:{ workouts:[{id:'w1',updatedAt:10},{id:'w2',updatedAt:50}] } }),
  snap({ tombstones:[{store:'workouts',recordId:'w1',deletedAt:20},{store:'workouts',recordId:'w2',deletedAt:40}] }),
);
eq('tombstone removes w1', m4.stores.workouts.map(w=>w.id), ['w2']);

// 5. favorites keyed by composite, tombstone with composite key
const m5 = mergeSnapshots(
  snap({ stores:{ favorites:[{profileId:'p1',exerciseId:'Bench',createdAt:5},{profileId:'p1',exerciseId:'Squat',createdAt:5}] } }),
  snap({ tombstones:[{store:'favorites',recordId:'p1|Bench',deletedAt:9}] }),
);
eq('favorite tombstoned', m5.stores.favorites.map(f=>f.exerciseId), ['Squat']);

// 6. profile deletion wins over older doc
const m6 = mergeSnapshots(
  snap({ profile:{id:'p1',updatedAt:10}, stores:{workouts:[{id:'w1',updatedAt:5}]} }),
  snap({ tombstones:[{store:'profiles',recordId:'p1',deletedAt:99}] }),
);
eq('profile deleted', m6.deleted, true);
eq('deleted keeps tombstones', m6.tombstones.length, 1);

// 7. recreated profile (doc newer than tombstone) survives
const m7 = mergeSnapshots(
  snap({ profile:{id:'p1',updatedAt:200} }),
  snap({ tombstones:[{store:'profiles',recordId:'p1',deletedAt:99}] }),
);
eq('recreated survives', !!m7.deleted, false);
eq('recreated profile kept', m7.profile.updatedAt, 200);

// 8. deleted marker merged with plain snapshot (marker carries its tombstone)
const delMarker = snap({ deleted:true, tombstones:[{store:'profiles',recordId:'p1',deletedAt:99}] });
const m8 = mergeSnapshots(delMarker, snap({ profile:{id:'p1',updatedAt:10}, stores:{workouts:[{id:'w1',updatedAt:5}]} }));
eq('marker propagates deletion', m8.deleted, true);

// 9. idempotence: merge(m, m) === m
const m9 = mergeSnapshots(m3, m3);
eq('idempotent', JSON.stringify(m9.stores.workouts.map(w=>w.id).sort()), JSON.stringify(m3.stores.workouts.map(w=>w.id).sort()));

// 10. commutativity on record level
const A = snap({ stores:{ routines:[{id:'r1',updatedAt:10,n:'a'}] } });
const B = snap({ stores:{ routines:[{id:'r1',updatedAt:20,n:'b'}] } });
eq('commutative winner AB', mergeSnapshots(A,B).stores.routines[0].n, 'b');
eq('commutative winner BA', mergeSnapshots(B,A).stores.routines[0].n, 'b');

// 11. tombstone union keeps newest deletedAt
const m11 = mergeSnapshots(
  snap({ tombstones:[{store:'workouts',recordId:'w1',deletedAt:10}] }),
  snap({ tombstones:[{store:'workouts',recordId:'w1',deletedAt:30}] }),
);
eq('tombstone union newest', m11.tombstones[0].deletedAt, 30);

// 12. equal timestamps: tombstone >= stamp wins (deletion préférée à égalité)
const m12 = mergeSnapshots(
  snap({ stores:{ bodyMetrics:[{id:'m1',createdAt:50}] } }),
  snap({ tombstones:[{store:'bodyMetrics',recordId:'m1',deletedAt:50}] }),
);
eq('tie goes to tombstone', m12.stores.bodyMetrics.length, 0);

console.log(`\n${pass} OK, ${fail} KO`);
process.exit(fail ? 1 : 0);
