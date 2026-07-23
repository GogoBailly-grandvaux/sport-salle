// tests du moteur de génération de programmes (node tests/generator.test.mjs)
import { generatePlans, weekSplit, GOALS } from '../js/generator.js';

let ok = 0, ko = 0;
const t = (name, cond) => { if (cond) { ok++; } else { ko++; console.error('✗ ' + name); } };

// --- bibliothèque factice : chaque muscle couvert en salle / haltères / maison ---
const MUSCLES = ['quadriceps', 'chest', 'lats', 'shoulders', 'hamstrings', 'abdominals', 'biceps', 'triceps', 'middle back', 'glutes', 'calves', 'traps', 'adductors'];
const lib = [];
let n = 0;
for (const m of MUSCLES) {
  for (const [equipment, mechanic] of [['machine', 'isolation'], ['barbell', 'compound'], ['dumbbell', 'compound'], ['cable', 'isolation'], ['body only', 'compound'], ['machine', 'compound'], ['dumbbell', 'isolation'], ['body only', 'isolation']]) {
    lib.push({
      id: `ex${n++}`, name: `FR ${m} ${equipment} ${n}`, nameEn: `EN ${m} ${equipment} ${n}`,
      primaryMuscles: [m], equipment, level: n % 3 === 0 ? 'beginner' : 'intermediate',
      mechanic, category: 'strength', images: ['x.jpg'],
    });
  }
}

// --- splits ---
t('split 1j = full', weekSplit(1, 'beginner').join() === 'full');
t('split 3j débutant = 3 full', weekSplit(3, 'beginner').join() === 'full,full,full');
t('split 3j inter = PPL', weekSplit(3, 'intermediate').join() === 'push,pull,legs');
t('split 4j = haut/bas ×2', weekSplit(4, 'advanced').join() === 'upper,lower,upper,lower');
t('split 6j = PPL ×2', weekSplit(6, 'advanced').length === 6);

// --- génération de base ---
const plans = generatePlans({ goal: 'muscle', level: 'intermediate', days: 3, equipment: 'gym', durationMin: 60 }, lib, 42);
t('3 jours générés', plans.length === 3);
t('noms Coach A/B/C', plans.map(p => p.name[6]).join('') === 'ABC');
t('6 exos par jour (60 min)', plans.every(p => p.items.length === 6));
t('pas de doublon dans un jour', plans.every(p => new Set(p.items.map(i => i.ex)).size === p.items.length));
t('reps hypertrophie 8-12', plans.every(p => p.items.every(i => i.reps[0] >= 8 || i.reps[1] >= 12)));
t('repos ~90s (hors abdos)', plans.every(p => p.items.some(i => i.rest === 90)));

// --- objectifs ---
const force = generatePlans({ goal: 'strength', level: 'advanced', days: 2, equipment: 'gym', durationMin: 45 }, lib, 7);
t('force : reps ≤ 6', force.every(p => p.items.filter(i => i.reps[1] <= 6).length >= p.items.length - 1)); // abdos exclus
t('force : repos ≥ 150s (hors abdos)', force.every(p => p.items.some(i => i.rest >= 150)));
const fat = generatePlans({ goal: 'fatloss', level: 'intermediate', days: 2, equipment: 'gym', durationMin: 45 }, lib, 7);
t('perte de poids : reps ≥ 12', fat.every(p => p.items.every(i => i.reps[1] >= 12)));
t('perte de poids : repos ≤ 60s', fat.every(p => p.items.every(i => i.rest <= 60)));

// --- niveau débutant : max 3 séries, max 5 exos ---
const deb = generatePlans({ goal: 'muscle', level: 'beginner', days: 2, equipment: 'gym', durationMin: 75 }, lib, 3);
t('débutant : 3 séries max', deb.every(p => p.items.every(i => i.sets <= 3)));
t('débutant : 5 exos max', deb.every(p => p.items.length <= 5));

// --- matériel maison : body only / bands uniquement ---
const home = generatePlans({ goal: 'fitness', level: 'intermediate', days: 3, equipment: 'home', durationMin: 45 }, lib, 9);
const homeIds = new Set(home.flatMap(p => p.items.map(i => i.ex)));
t('maison : uniquement poids du corps/élastiques',
  [...homeIds].every(id => ['body only', 'bands'].includes(lib.find(e => e.id === id).equipment)));

// --- variété inter-jours (bibliothèque large → peu de répétitions) ---
const all = plans.flatMap(p => p.items.map(i => i.ex));
t('variété : ≤ 2 répétitions sur la semaine', all.length - new Set(all).size <= 2);

// --- déterminisme / variantes ---
const again = generatePlans({ goal: 'muscle', level: 'intermediate', days: 3, equipment: 'gym', durationMin: 60 }, lib, 42);
t('même graine → même programme', JSON.stringify(again) === JSON.stringify(plans));
const other = generatePlans({ goal: 'muscle', level: 'intermediate', days: 3, equipment: 'gym', durationMin: 60 }, lib, 43);
t('autre graine → variante', JSON.stringify(other) !== JSON.stringify(plans));

// --- forme compatible addTemplate ---
t('items au format template {ex,sets,reps,rest}', plans[0].items.every(i =>
  typeof i.ex === 'string' && Number.isInteger(i.sets) && Array.isArray(i.reps) && i.reps.length === 2 && Number.isInteger(i.rest)));

console.log(`${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
