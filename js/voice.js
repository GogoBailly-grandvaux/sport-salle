// voice.js — la voix de Sport Salle. Des phrases écrites main, qui tournent
// chaque jour (stables dans la journée : l'app ne « clignote » pas à chaque
// rendu). Zéro jargon corporate — on se parle comme à la salle.

// graine du jour : même phrase toute la journée, nouvelle demain
function daySeed(extra = 0) {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() + extra;
}
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

// ---- salutation de l'accueil (selon l'heure + jour) ----
export function hello() {
  const h = new Date().getHours();
  const day = new Date().getDay(); // 0 = dimanche, 1 = lundi
  const morning = ['Salut, lève-tôt', 'Le café, puis la fonte', 'Debout champion·ne', 'Bien dormi ?'];
  const noon = ['Salut', 'La pause qui compte', 'Yo', 'Re-bonjour'];
  const evening = ['Bonsoir', 'Fin de journée, début de séance ?', 'Salut toi', 'La salle t’attend'];
  const night = ['Encore debout ?', 'Bonne nuit… ou pas', 'Insomnie productive ?'];
  const monday = ['Nouveau lundi, nouvelle semaine', 'Lundi : tout le monde fait les pecs 😄', 'C’est reparti'];
  const friday = ['Vendredi, on finit fort', 'Dernière ligne droite'];
  if (day === 1 && h >= 6 && h < 12) return pick(monday, daySeed(1));
  if (day === 5 && h >= 14) return pick(friday, daySeed(2));
  if (h < 6) return pick(night, daySeed(3));
  if (h < 12) return pick(morning, daySeed(4));
  if (h < 18) return pick(noon, daySeed(5));
  return pick(evening, daySeed(6));
}

// ---- sous-titre du gros bouton « Démarrer » ----
export function heroLine() {
  return pick([
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
  ], daySeed(10));
}

// ---- nom par défaut d'une séance libre ----
export function workoutName() {
  const h = new Date().getHours();
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const d = days[new Date().getDay()];
  if (h < 6) return 'Séance de nuit';
  if (h < 12) return `Séance du ${d} matin`;
  if (h < 18) return `Séance du ${d}`;
  return `Séance du ${d} soir`;
}

// ---- félicitations du résumé, selon la séance ----
export function praise({ prs = 0, volume = 0, sets = 0, durationSec = 0 } = {}) {
  const s = daySeed(20) + sets + Math.round(volume);
  if (prs > 1) return pick([
    `${prs} records dans la même séance. Sérieusement ?! 🔥`,
    `${prs} records. La machine, c’est toi.`,
    `${prs} records d’un coup — encadre cette séance.`,
  ], s);
  if (prs === 1) return pick([
    'Un record de plus. Ça, c’est de la progression.',
    'Nouveau record — la version d’hier vient de se faire battre.',
    'Record battu. Discrètement, mais sûrement. 😤',
  ], s);
  if (volume >= 5000) return pick([
    `${Math.round(volume).toLocaleString('fr-FR')} kg déplacés. Les machines s’en souviennent.`,
    'Grosse séance. Hydrate-toi, t’as bossé.',
    'Le volume parle de lui-même. Chapeau.',
  ], s);
  if (durationSec > 0 && durationSec < 20 * 60) return pick([
    'Court mais fait. C’est ça qui compte.',
    'Séance éclair — mieux que pas de séance.',
    'Efficace. Pas besoin d’y passer la soirée.',
  ], s);
  return pick([
    'T’es venu, t’as soulevé. Respect.',
    'Encore une pierre à l’édifice.',
    'Le rendez-vous est honoré. À la prochaine.',
    'Ton historique s’allonge, ta progression aussi.',
    'Bien joué. Le plus dur est derrière toi.',
    'Une de plus au compteur — et ça compte.',
  ], s);
}

// ---- états vides, avec un peu de chaleur ----
export function emptyHistory() {
  return pick([
    'Ta première séance écrira cette page.',
    'Rien ici… pour l’instant. La suite t’appartient.',
    'C’est vide, et c’est normal : tout commence quelque part.',
  ], daySeed(30));
}
