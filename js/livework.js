// livework.js — publie ma séance en cours à mes amis (battements légers).
// Un battement au démarrage + toutes les 45 s + à chaque série validée ;
// stop à la fin ou à l'abandon. Côté serveur : visible des AMIS seulement,
// périmé après 150 s sans battement (app fermée = disparition auto).
import { call, isLoggedIn } from './api.js';

let timer = null;
let getState = null; // () => ({ W, exName })
let sessionId = null; // séance de groupe en cours
let lastBeat = 0;

function send(force = false) {
  if (!isLoggedIn() || !getState) return;
  const { W, exName } = getState() || {};
  if (!W || W.status !== 'in_progress') return;
  const now = Date.now();
  if (!force && now - lastBeat < 20000) return; // au plus 1 battement / 20 s
  lastBeat = now;
  const done = (W.exercises || []).flatMap(e => (e.sets || []).filter(s => s.done));
  call('liveworkout', 'beat', {
    name: W.name || '',
    currentEx: exName || '',
    setsDone: done.length,
    volumeKg: Math.round(done.reduce((v, s) => v + (s.weightKg || 0) * (s.reps || 0), 0)),
    startedAt: W.startedAt || 0,
    sessionId: sessionId || undefined,
  }).catch(() => {});
}

export function liveStart(stateFn, sid = null) {
  getState = stateFn;
  sessionId = sid;
  clearInterval(timer);
  timer = setInterval(() => send(true), 45000);
  send(true);
}

export function liveBeat() { send(true); }

export function liveStop() {
  clearInterval(timer); timer = null; getState = null; lastBeat = 0; sessionId = null;
  if (isLoggedIn()) call('liveworkout', 'stop', {}).catch(() => {});
}
