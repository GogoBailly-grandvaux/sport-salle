// live.js — le pouls temps réel de l'app.
// Poll léger de api/live.php quand l'app est au premier plan : si la « version
// d'état » de l'utilisateur a bougé (demande d'ami, programme partagé, séance
// d'un pote…), on émet `live-changed` et les écrans se rafraîchissent en place.
// Si l'instantané a changé depuis un AUTRE appareil, on déclenche une synchro.
import { call, isLoggedIn } from './api.js';
import { emit, on } from './store.js';
import { syncNow } from './sync.js';

const BASE_MS = 12_000;      // cadence au premier plan
const MAX_MS = 90_000;       // plafond en cas d'erreurs répétées

let timer = null;
let started = false;
let lastV = null;            // dernière version d'état vue
let lastSnap = null;         // dernier horodatage d'instantané vu (le nôtre inclus)
let failStreak = 0;
let inflight = false;

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

async function tick() {
  if (document.hidden) return;                    // repris par visibilitychange
  if (!navigator.onLine || !isLoggedIn()) { schedule(30_000); return; }
  if (inflight) { schedule(BASE_MS); return; }
  inflight = true;
  try {
    const r = await call('live', 'version');
    failStreak = 0;
    const first = lastV === null;
    emit('live-info', r);                         // badge (demandes d'ami) à chaque poll
    if (!first && r.v !== lastV) emit('live-changed', r);
    // mon instantané a bougé sans que cet appareil ait poussé -> pull
    if (!first && r.snap && lastSnap !== null && r.snap > lastSnap) syncNow();
    lastV = r.v;
    if (lastSnap === null || r.snap > lastSnap) lastSnap = r.snap;
  } catch {
    failStreak++;
  } finally {
    inflight = false;
  }
  schedule(Math.min(MAX_MS, BASE_MS * (1 + failStreak)));
}

/** Force un contrôle rapide (après une action locale, un retour au premier plan…). */
export function poke(delayMs = 700) {
  if (!started) return;
  schedule(delayMs);
}

export function startLive() {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer);
    else poke(400);                               // retour au premier plan -> contrôle immédiat
  });
  addEventListener('online', () => poke(500));
  on('account-changed', () => { lastV = null; lastSnap = null; poke(300); });
  // notre propre synchro vient de pousser : on note l'horodatage pour ne pas
  // confondre notre push avec « un autre appareil a changé mes données »
  on('snap-seen', e => {
    const ts = e?.detail?.ts;
    if (ts && (lastSnap === null || ts > lastSnap)) lastSnap = ts;
  });
  tick();
}
