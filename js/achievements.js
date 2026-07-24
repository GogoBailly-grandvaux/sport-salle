// achievements.js — badges & récompenses (pure functions sur les séances).
// La recherche est claire : une victoire dès le 1er jour booste énormément la
// rétention. Chaque badge a un test + une progression (courant/cible).
import { t } from './i18n.js';
import { workoutStats, goalStreak, sessionsByWeek } from './analytics.js';
import { state, ps } from './store.js';
import { MUSCLE_GROUP } from './data.js';

// Chaque badge : id, emoji, titre, description, et une fonction qui renvoie
// { done, cur, target } à partir d'un contexte pré-calculé.
// Familles À PALIERS (I → II → III) + badges uniques.
// Chaque item rendu garde {id, icon, title, desc, cur, target, pct, done}
// et gagne {tier, tierMax, key} — key = `famille@palier` pour la persistance.
export const ACHIEVEMENT_FAMILIES = [
  { id: 'workouts', icon: 'flame', metric: c => c.n, tiers: [5, 25, 100],
    titles: [t('Régulier','Regular'), t('Assidu','Dedicated'), t('Centurion','Centurion')],
    desc: v => t(`${v} séances au total.`, `${v} workouts overall.`) },
  { id: 'prs', icon: 'medal', metric: c => c.prs, tiers: [1, 10, 30],
    titles: [t('Premier record','First PR'), t('Machine à records','PR machine'), t('Collectionneur','Collector')],
    desc: v => t(`${v} records personnels battus.`, `${v} personal records smashed.`) },
  { id: 'streak', icon: 'bolt', metric: c => c.streak, tiers: [3, 8, 16],
    titles: [t('En feu','On fire'), t('Inarrêtable','Unstoppable'), t('Métronome','Metronome')],
    desc: v => t(`${v} semaines d’affilée à ton objectif.`, `${v} weeks in a row on target.`) },
  { id: 'volume', icon: 'scale', metric: c => c.volume, tiers: [10000, 100000, 500000],
    titles: [t('10 tonnes','10 tonnes'), t('100 tonnes','100 tonnes'), t('Demi-million','Half a million')],
    desc: v => t(`${Math.round(v).toLocaleString('fr-FR')} kg soulevés en tout.`, `${Math.round(v).toLocaleString('en-US')} kg lifted overall.`) },
];
export const ACHIEVEMENT_SINGLES = [
  { id: 'first',     icon: 'target',   title: t('Première séance','First workout'), desc: t('Tu t’es lancé. Le plus dur est fait.','You started. The hardest part is done.'), f: c => ({ cur: c.n, target: 1 }) },
  { id: 'variety20', icon: 'sparkles', title: t('Polyvalent','Versatile'),          desc: t('20 exercices différents essayés.','20 different exercises tried.'), f: c => ({ cur: c.exos, target: 20 }) },
  { id: 'allgroups', icon: 'user',     title: t('Corps complet','Full body'),       desc: t('Tous les groupes musculaires travaillés.','Every muscle group trained.'), f: c => ({ cur: c.groups, target: 6 }) },
  { id: 'bigweek',   icon: 'calendar', title: t('Grosse semaine','Big week'),       desc: t('5 séances en une seule semaine.','5 workouts in a single week.'), f: c => ({ cur: c.bestWeek, target: 5 }) },
  { id: 'earlybird', icon: 'sunrise',  title: t('Lève-tôt','Early bird'),           desc: t('Une séance avant 8 h du matin.','A workout before 8 AM.'), f: c => ({ cur: c.earlyBird ? 1 : 0, target: 1 }) },
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

/** Liste des badges (familles à paliers + uniques) avec état + contexte. */
export function computeAchievements(workouts) {
  const c = buildContext(workouts);
  const list = [];
  for (const f of ACHIEVEMENT_FAMILIES) {
    const cur = f.metric(c);
    let tier = 0;
    for (const th of f.tiers) { if (cur >= th) tier++; }
    const tierMax = f.tiers.length;
    const nextTarget = f.tiers[Math.min(tier, tierMax - 1)];
    const title = f.titles[Math.max(0, Math.min(tier === 0 ? 0 : tier - 1, tierMax - 1))];
    list.push({
      id: f.id, icon: f.icon, title, desc: f.desc(cur),
      cur: Math.min(cur, nextTarget), target: nextTarget,
      pct: tier >= tierMax ? 100 : Math.max(0, Math.min(100, Math.round(cur / nextTarget * 100))),
      done: tier >= 1, tier, tierMax, key: `${f.id}@${tier}`,
    });
  }
  for (const a of ACHIEVEMENT_SINGLES) {
    const { cur, target } = a.f(c);
    const done = cur >= target;
    list.push({ ...a, cur: Math.min(cur, target), target, done,
      pct: Math.max(0, Math.min(100, Math.round(cur / target * 100))),
      tier: done ? 1 : 0, tierMax: 1, key: `${a.id}@${done ? 1 : 0}` });
  }
  return { list, unlocked: list.filter(a => a.done).map(a => a.key), context: c };
}

/** Nouveaux badges OU nouveaux paliers depuis l'état sauvegardé (clés famille@palier). */
export function newlyUnlocked(prevKeys, list) {
  const prev = new Set(prevKeys || []);
  return list.filter(a => a.done && !prev.has(a.key));
}
