// voice.js — la voix de Sport Salle, en français ET en anglais.
// Des phrases écrites main, qui tournent chaque jour (stables dans la journée).
// Zéro jargon corporate — on se parle comme à la salle.
import { locale } from './i18n.js';

// graine du jour : même phrase toute la journée, nouvelle demain
function daySeed(extra = 0) {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() + extra;
}
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
const P = (fr, en) => (locale() === 'en' ? en : fr); // choisit le POOL selon la langue

// ---- salutation de l'accueil (selon l'heure + jour) ----
export function hello() {
  const h = new Date().getHours();
  const day = new Date().getDay(); // 0 = dimanche, 1 = lundi
  const morning = P(['Salut, lève-tôt', 'Le café, puis la fonte', 'Debout champion·ne', 'Bien dormi ?'],
                    ['Hey, early bird', 'Coffee first, then iron', 'Rise and grind', 'Sleep well?']);
  const noon = P(['Salut', 'La pause qui compte', 'Yo', 'Re-bonjour'],
                 ['Hey', 'The break that counts', 'Yo', 'Hello again']);
  const evening = P(['Bonsoir', 'Fin de journée, début de séance ?', 'Salut toi', 'La salle t’attend'],
                    ['Evening', 'Day’s done — workout time?', 'Hey you', 'The gym is waiting']);
  const night = P(['Encore debout ?', 'Bonne nuit… ou pas', 'Insomnie productive ?'],
                  ['Still up?', 'Good night… or not', 'Productive insomnia?']);
  const monday = P(['Nouveau lundi, nouvelle semaine', 'Lundi : tout le monde fait les pecs', 'C’est reparti'],
                   ['New Monday, new week', 'Monday: everyone benches', 'Here we go again']);
  const friday = P(['Vendredi, on finit fort', 'Dernière ligne droite'],
                   ['Friday — finish strong', 'Home stretch']);
  if (day === 1 && h >= 6 && h < 12) return pick(monday, daySeed(1));
  if (day === 5 && h >= 14) return pick(friday, daySeed(2));
  if (h < 6) return pick(night, daySeed(3));
  if (h < 12) return pick(morning, daySeed(4));
  if (h < 18) return pick(noon, daySeed(5));
  return pick(evening, daySeed(6));
}

// ---- sous-titre du gros bouton « Démarrer » ----
export function heroLine() {
  return pick(P([
    'Séance libre, ou lance un de tes programmes.',
    'La meilleure séance, c’est celle que tu fais.',
    'Pas besoin d’être motivé. Juste d’être là.',
    'Ton futur toi te dit merci.',
    'Une série après l’autre — c’est tout.',
    'Le plus dur, c’est de pousser la porte.',
    'Viens comme t’es, repars plus fort.',
    'On ne saute pas le leg day. Jamais.',
    'Petit volume aujourd’hui vaut mieux que zéro.',
    'La régularité bat le talent.',
  ], [
    'Free workout, or launch one of your programs.',
    'The best workout is the one you do.',
    'No motivation needed. Just show up.',
    'Future you says thanks.',
    'One set at a time — that’s it.',
    'The hardest part is walking in.',
    'Come as you are, leave stronger.',
    'Never skip leg day. Never.',
    'A small session beats no session.',
    'Consistency beats talent.',
  ]), daySeed(10));
}

// ---- nom par défaut d'une séance libre ----
export function workoutName() {
  const h = new Date().getHours();
  const en = locale() === 'en';
  const days = en
    ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    : ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const d = days[new Date().getDay()];
  if (en) {
    if (h < 6) return 'Night workout';
    if (h < 12) return `${d} morning workout`;
    if (h < 18) return `${d} workout`;
    return `${d} evening workout`;
  }
  if (h < 6) return 'Séance de nuit';
  if (h < 12) return `Séance du ${d} matin`;
  if (h < 18) return `Séance du ${d}`;
  return `Séance du ${d} soir`;
}

// ---- félicitations du résumé, selon la séance ----
export function praise({ prs = 0, volume = 0, sets = 0, durationSec = 0 } = {}) {
  const s = daySeed(20) + sets + Math.round(volume);
  const n = (x) => Math.round(x).toLocaleString(locale() === 'en' ? 'en-US' : 'fr-FR');
  if (prs > 1) return pick(P([
    `${prs} records dans la même séance. Sérieusement ?!`,
    `${prs} records. La machine, c’est toi.`,
    `${prs} records d’un coup — encadre cette séance.`,
  ], [
    `${prs} records in one session. Seriously?!`,
    `${prs} records. You’re the machine.`,
    `${prs} records at once — frame this workout.`,
  ]), s);
  if (prs === 1) return pick(P([
    'Un record de plus. Ça, c’est de la progression.',
    'Nouveau record — la version d’hier vient de se faire battre.',
    'Record battu. Discrètement, mais sûrement.',
  ], [
    'One more record. That’s progress.',
    'New record — yesterday’s you just got beaten.',
    'Record broken. Quietly, but surely.',
  ]), s);
  if (volume >= 5000) return pick(P([
    `${n(volume)} kg déplacés. Les machines s’en souviennent.`,
    'Grosse séance. Hydrate-toi, t’as bossé.',
    'Le volume parle de lui-même. Chapeau.',
  ], [
    `${n(volume)} kg moved. The machines will remember.`,
    'Big session. Hydrate — you earned it.',
    'The volume speaks for itself. Respect.',
  ]), s);
  if (durationSec > 0 && durationSec < 20 * 60) return pick(P([
    'Court mais fait. C’est ça qui compte.',
    'Séance éclair — mieux que pas de séance.',
    'Efficace. Pas besoin d’y passer la soirée.',
  ], [
    'Short but done. That’s what counts.',
    'Lightning session — beats no session.',
    'Efficient. No need to spend the whole evening.',
  ]), s);
  return pick(P([
    'T’es venu, t’as soulevé. Respect.',
    'Encore une pierre à l’édifice.',
    'Le rendez-vous est honoré. À la prochaine.',
    'Ton historique s’allonge, ta progression aussi.',
    'Bien joué. Le plus dur est derrière toi.',
    'Une de plus au compteur — et ça compte.',
  ], [
    'You showed up, you lifted. Respect.',
    'Another brick in the wall.',
    'Appointment honored. See you next time.',
    'Your history grows — so does your progress.',
    'Well done. The hard part is behind you.',
    'One more on the counter — and it counts.',
  ]), s);
}

// ---- états vides, avec un peu de chaleur ----
export function emptyHistory() {
  return pick(P([
    'Ta première séance écrira cette page.',
    'Rien ici… pour l’instant. La suite t’appartient.',
    'C’est vide, et c’est normal : tout commence quelque part.',
  ], [
    'Your first workout will write this page.',
    'Nothing here… yet. The rest is up to you.',
    'Empty — and that’s fine: everything starts somewhere.',
  ]), daySeed(30));
}
