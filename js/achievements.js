// achievements.js — badges & récompenses (pure functions sur les séances).
// La recherche est claire : une victoire dès le 1er jour booste énormément la
// rétention. Chaque badge a un test + une progression (courant/cible).
import { t } from './i18n.js';
import { workoutStats, goalStreak, sessionsByWeek } from './analytics.js';
import { state, ps } from './store.js';
import { MUSCLE_GROUP } from './data.js';

// Chaque badge : id, emoji, titre, description, et une fonction qui renvoie
// { done, cur, target } à partir d'un contexte pré-calculé.
export const ACHIEVEMENTS = [
  { id: 'first',     icon: 'target', title: t('Première séance','First workout'),   desc: t('Tu t’es lancé. Le plus dur est fait.','You started. The hardest part is done.'),
    f: c => ({ cur: c.n, target: 1 }) },
  { id: 'w5',        icon: 'flame', title: t('Régulier','Regular'),                desc: t('5 séances au compteur.','5 workouts logged.'),
    f: c => ({ cur: c.n, target: 5 }) },
  { id: 'w25',       icon: 'history', title: t('Assidu','Dedicated'),               desc: t('25 séances — ça devient une habitude.','25 workouts — it’s a habit now.'),
    f: c => ({ cur: c.n, target: 25 }) },
  { id: 'w100',      icon: 'trophy', title: t('Centurion','Centurion'),            desc: t('100 séances. Respect.','100 workouts. Respect.'),
    f: c => ({ cur: c.n, target: 100 }) },
  { id: 'pr1',       icon: 'medal', title: t('Premier record','First PR'),        desc: t('Ton premier record personnel.','Your first personal record.'),
    f: c => ({ cur: c.prs, target: 1 }) },
  { id: 'pr10',      icon: 'chart', title: t('Machine à records','PR machine'),   desc: t('10 records battus.','10 PRs smashed.'),
    f: c => ({ cur: c.prs, target: 10 }) },
  { id: 'streak3',   icon: 'bolt', title: t('En feu','On fire'),                 desc: t('3 semaines d’affilée à ton objectif.','3 weeks in a row hitting your goal.'),
    f: c => ({ cur: c.streak, target: 3 }) },
  { id: 'streak8',   icon: 'star', title: t('Inarrêtable','Unstoppable'),        desc: t('8 semaines d’affilée. Machine.','8 weeks in a row. Machine.'),
    f: c => ({ cur: c.streak, target: 8 }) },
  { id: 'vol10',     icon: 'scale', title: t('10 tonnes','10 tonnes'),           desc: t('10 000 kg soulevés en tout.','10,000 kg lifted in total.'),
    f: c => ({ cur: c.volume, target: 10000 }) },
  { id: 'vol100',    icon: 'crown', title: t('100 tonnes','100 tonnes'),          desc: t('100 000 kg. Une vie de fonte.','100,000 kg. A lifetime of iron.'),
    f: c => ({ cur: c.volume, target: 100000 }) },
  { id: 'variety20', icon: 'sparkles', title: t('Polyvalent','Versatile'),           desc: t('20 exercices différents essayés.','20 different exercises tried.'),
    f: c => ({ cur: c.exos, target: 20 }) },
  { id: 'allgroups', icon: 'user', title: t('Corps complet','Full body'),        desc: t('Tous les groupes musculaires travaillés.','Every muscle group trained.'),
    f: c => ({ cur: c.groups, target: 6 }) },
  { id: 'bigweek',   icon: 'calendar', title: t('Grosse semaine','Big week'),        desc: t('5 séances en une seule semaine.','5 workouts in a single week.'),
    f: c => ({ cur: c.bestWeek, target: 5 }) },
  { id: 'earlybird', icon: 'sunrise', title: t('Lève-tôt','Early bird'),            desc: t('Une séance avant 8 h du matin.','A workout before 8 AM.'),
    f: c => ({ cur: c.earlyBird ? 1 : 0, target: 1 }) },
];

const MUSCLE_GROUPS_TOTAL = 6; // Pectoraux, Dos, Épaules, Bras, Jambes, Abdos

// Contexte pré-calculé une seule fois à partir des séances terminées.
function buildContext(workouts) {
  const done = workouts.filter(w => w.status === 'completed');
  let volume = 0, prs = 0, earlyBird = false;
  const exos = new Set(), groups = new Set();
  for (const w of done) {
    volume += workoutStats(w).volume;
    prs += (w.prs || []).length;
    const h = new Date(w.startedAt).getHours();
    if (h < 8) earlyBird = true;
    for (const ex of (w.exercises || [])) {
      if ((ex.sets || []).some(s => s.done)) {
        exos.add(ex.exerciseId);
        const lib = state.libraryById?.get(ex.exerciseId);
        const m = lib?.primaryMuscles?.[0];
        const g = m && MUSCLE_GROUP[m];
        if (g) groups.add(g);
      }
    }
  }
  const byWeek = sessionsByWeek(done);
  const bestWeek = byWeek.size ? Math.max(...byWeek.values()) : 0;
  const goal = ps('weeklyGoal') || 3;
  return {
    n: done.length, volume: Math.round(volume), prs,
    exos: exos.size, groups: groups.size, bestWeek, earlyBird,
    streak: goalStreak(done, goal),
  };
}

/** Renvoie la liste des badges avec leur état {done, cur, target} + le contexte. */
export function computeAchievements(workouts) {
  const c = buildContext(workouts);
  const list = ACHIEVEMENTS.map(a => {
    const { cur, target } = a.f(c);
    return { ...a, cur: Math.min(cur, target), target, done: cur >= target,
      pct: Math.max(0, Math.min(100, Math.round(cur / target * 100))) };
  });
  return { list, unlocked: list.filter(a => a.done).map(a => a.id), context: c };
}

/** Compare à un état antérieur (set d'ids) et renvoie les badges NOUVELLEMENT débloqués. */
export function newlyUnlocked(prevIds, list) {
  const prev = new Set(prevIds || []);
  return list.filter(a => a.done && !prev.has(a.id));
}
