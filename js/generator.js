// generator.js — moteur du coach : génère des programmes complets
// à partir de (objectif, niveau, jours/semaine, matériel, durée).
// Pur (aucune dépendance DOM/app) → testable en node. Les plans produits ont
// exactement la forme des TEMPLATES (items {ex, sets, reps:[min,max], rest})
// et se créent donc via templates.addTemplate().

export const GOALS = {
  fatloss:  { label: 'Perte de poids',  labelEn: 'Fat loss',     emoji: '🔥', sets: 3, reps: [12, 15], rest: 45,  tagline: 'Densité et dépense : repos courts, reps hautes.', taglineEn: 'Density and burn: short rests, high reps.' },
  muscle:   { label: 'Prise de muscle', labelEn: 'Muscle gain',  emoji: '💪', sets: 4, reps: [8, 12],  rest: 90,  tagline: 'Hypertrophie : volume maîtrisé, 8–12 reps.', taglineEn: 'Hypertrophy: controlled volume, 8–12 reps.' },
  strength: { label: 'Force',           labelEn: 'Strength',     emoji: '🏆', sets: 4, reps: [4, 6],   rest: 150, tagline: 'Charges lourdes, reps basses, repos longs.', taglineEn: 'Heavy loads, low reps, long rests.' },
  fitness:  { label: 'Être en forme',   labelEn: 'General fitness', emoji: '❤️', sets: 3, reps: [10, 12], rest: 60,  tagline: 'Équilibre général : tout le corps, sans excès.', taglineEn: 'Balanced full-body training, nothing extreme.' },
};

export const LEVELS = {
  beginner:     { label: 'Débutant',      labelEn: 'Beginner',     hint: 'Moins de 6 mois de pratique', hintEn: 'Less than 6 months of training' },
  intermediate: { label: 'Intermédiaire', labelEn: 'Intermediate', hint: 'Entre 6 mois et 4 ans',       hintEn: 'Between 6 months and 4 years' },
  advanced:     { label: 'Avancé',        labelEn: 'Advanced',     hint: 'Plus de 4 ans de pratique',   hintEn: 'More than 4 years of training' },
};

export const EQUIPMENTS = {
  gym:       { label: 'Salle complète',    labelEn: 'Full gym',        emoji: '🏟️', allow: null }, // null = tout
  dumbbells: { label: 'Haltères + banc',   labelEn: 'Dumbbells + bench', emoji: '🏋️', allow: ['dumbbell', 'body only', 'bands'] },
  home:      { label: 'Maison sans matos', labelEn: 'Home, no gear',   emoji: '🏠', allow: ['body only', 'bands'] },
};

export const DURATIONS = [30, 45, 60, 75];

// muscles par type de journée, par ordre de priorité (coupé selon la durée)
const DAY_MUSCLES = {
  full:  ['quadriceps', 'chest', 'lats', 'shoulders', 'hamstrings', 'abdominals', 'biceps', 'triceps'],
  push:  ['chest', 'shoulders', 'chest', 'triceps', 'shoulders', 'triceps', 'abdominals'],
  pull:  ['lats', 'middle back', 'lats', 'biceps', 'traps', 'biceps', 'abdominals'],
  legs:  ['quadriceps', 'hamstrings', 'quadriceps', 'glutes', 'calves', 'abdominals', 'hamstrings'],
  upper: ['chest', 'lats', 'shoulders', 'middle back', 'triceps', 'biceps', 'abdominals'],
  lower: ['quadriceps', 'hamstrings', 'glutes', 'quadriceps', 'calves', 'abdominals', 'adductors'],
};

const DAY_LABELS = { full: 'Full body', push: 'Push · pousser', pull: 'Pull · tirer', legs: 'Jambes', upper: 'Haut du corps', lower: 'Bas du corps' };
const DAY_LABELS_EN = { full: 'Full body', push: 'Push', pull: 'Pull', legs: 'Legs', upper: 'Upper body', lower: 'Lower body' };

// répartition de la semaine selon les jours dispo (et le niveau)
export function weekSplit(days, level) {
  const d = Math.max(1, Math.min(6, days | 0));
  if (d === 1) return ['full'];
  if (d === 2) return ['full', 'full'];
  if (d === 3) return level === 'beginner' ? ['full', 'full', 'full'] : ['push', 'pull', 'legs'];
  if (d === 4) return ['upper', 'lower', 'upper', 'lower'];
  if (d === 5) return ['push', 'pull', 'legs', 'upper', 'lower'];
  return ['push', 'pull', 'legs', 'push', 'pull', 'legs'];
}

// générateur pseudo-aléatoire avec graine (variété reproductible / testable)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function exCountFor(durationMin, level) {
  const base = durationMin <= 30 ? 4 : durationMin <= 45 ? 5 : durationMin <= 60 ? 6 : 7;
  return level === 'beginner' ? Math.min(base, 5) : base;
}

const STRENGTH_CATS = new Set(['strength', 'powerlifting', 'olympic weightlifting']);

function levelAllowed(level) {
  if (level === 'beginner') return new Set(['beginner', 'intermediate']);
  if (level === 'intermediate') return new Set(['beginner', 'intermediate']);
  return new Set(['beginner', 'intermediate', 'expert']);
}

// équipement « idéal » selon le profil (bonus de score, pas un filtre)
function preferredEquip(goal, level) {
  if (level === 'beginner') return new Set(['machine', 'cable']);
  if (goal === 'strength') return new Set(['barbell', 'dumbbell']);
  if (goal === 'fatloss') return new Set(['machine', 'cable', 'dumbbell']);
  return new Set(['barbell', 'dumbbell', 'cable', 'machine']);
}

/**
 * Génère les programmes de la semaine.
 * @param {{goal:string, level:string, days:number, equipment:string, durationMin:number}} input
 * @param {Array} library  bibliothèque d'exercices ({id,name,nameEn,primaryMuscles,equipment,level,mechanic,category,images})
 * @param {number} seed    graine (changer = régénérer une variante)
 * @returns {Array<{name, level, goal, tagline, items:[{ex,sets,reps,rest}]}>}
 */
export function generatePlans(input, library, seed = 1, lang = 'fr') {
  const en = lang === 'en';
  const goal = GOALS[input.goal] || GOALS.fitness;
  const level = LEVELS[input.level] ? input.level : 'beginner';
  const equip = EQUIPMENTS[input.equipment] || EQUIPMENTS.gym;
  const rng = mulberry32(seed);
  const lvlOk = levelAllowed(level);
  const prefEq = preferredEquip(input.goal, level);
  const nEx = exCountFor(input.durationMin || 45, level);

  // pool filtré une fois : catégorie force, niveau, matériel
  const isStretch = e => /étirement|etirement|stretch/i.test((e.name || '') + ' ' + (e.nameEn || ''));
  const pool = library.filter(e =>
    !isStretch(e) && // certains étirements sont mal catégorisés « strength » dans les données
    STRENGTH_CATS.has(e.category) &&
    lvlOk.has(e.level || 'intermediate') &&
    (!equip.allow || equip.allow.includes(e.equipment))
  );
  const byMuscle = new Map();
  for (const e of pool) {
    for (const m of (e.primaryMuscles || [])) {
      if (!byMuscle.has(m)) byMuscle.set(m, []);
      byMuscle.get(m).push(e);
    }
  }

  const usedWeek = new Set(); // limite les répétitions d'un jour à l'autre
  const split = weekSplit(input.days, level);
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

  const plans = split.map((kind, di) => {
    const muscles = DAY_MUSCLES[kind].slice(0, nEx);
    const usedDay = new Set();
    const items = [];
    muscles.forEach((m, slot) => {
      const cands = (byMuscle.get(m) || []).filter(e => !usedDay.has(e.id));
      if (!cands.length) return; // muscle non couvrable avec ce matériel : on saute
      const scored = cands.map(e => {
        let s = 0;
        if (e.mechanic === 'compound') s += slot < 3 ? 3 : 1;   // les gros mouvements d'abord
        if (prefEq.has(e.equipment)) s += 2;                      // matériel adapté au profil
        if (level === 'beginner' && (e.level || '') === 'beginner') s += 2; // vrais mouvements de débutant d'abord
        if (e.name && e.nameEn && e.name !== e.nameEn) s += 2;    // nom français dispo
        if (e.images && e.images.length) s += 1;                  // illustré
        if (usedWeek.has(e.id)) s -= 2.5;                         // varie d'un jour à l'autre
        s += rng() * 1.6;                                         // variété contrôlée par la graine
        return [s, e];
      }).sort((a, b) => b[0] - a[0]);
      const chosen = scored[0][1];
      usedDay.add(chosen.id); usedWeek.add(chosen.id);
      const isAbs = m === 'abdominals';
      items.push({
        ex: chosen.id,
        sets: level === 'beginner' ? Math.min(goal.sets, 3) : goal.sets,
        reps: isAbs ? [12, 20] : goal.reps.slice(),
        rest: isAbs ? Math.min(goal.rest, 60) : goal.rest,
      });
    });
    const label = (en ? DAY_LABELS_EN : DAY_LABELS)[kind];
    return {
      name: `Coach ${letters[di]} · ${label}`,
      level: en ? LEVELS[level].labelEn : LEVELS[level].label,
      goal: en ? goal.labelEn : goal.label,
      tagline: `${goal.emoji} ${en ? goal.labelEn : goal.label} · ${en ? LEVELS[level].labelEn : LEVELS[level].label} · ~${input.durationMin || 45} min. ${en ? goal.taglineEn : goal.tagline}`,
      items,
    };
  });
  return plans;
}
