// screens/coach-gen.js — wizard « le coach génère ton programme »
// (inspiré des générateurs du marché : une question par écran, grandes cartes)
import { esc } from '../util.js';
import { state, nav } from '../store.js';
import { icon, toast } from '../ui.js';
import { getExercise } from '../data.js';
import { generatePlans, GOALS, LEVELS, EQUIPMENTS, DURATIONS } from '../generator.js';
import { addTemplate } from '../templates.js';
import { exImage } from './common.js';

const S = { step: 0, goal: null, level: null, days: null, equipment: null, durationMin: null, seed: 1, plans: null };
const STEPS = 5; // objectif, niveau, jours, matériel, durée → puis aperçu

export function render() {
  // nouveau passage : on repart au début (mais on garde les réponses précédentes préremplies)
  S.step = 0; S.plans = null;
  return `<div class="cg" id="cg"></div>`;
}

export function mount(root) {
  draw(root.querySelector('#cg'));
}

function draw(host) {
  const el = typeof host === 'string' ? document.querySelector('#cg') : host;
  if (!el) return;
  el.innerHTML = S.plans ? previewHtml() : stepHtml();
  el.classList.remove('cg-anim'); void el.offsetWidth; el.classList.add('cg-anim');
  wire(el);
}

const head = (title) => `
  <div class="cg-top">
    <button class="icon-btn" id="cg-back" aria-label="Retour">${icon('back')}</button>
    ${S.plans ? '' : `<div class="cg-progress"><div class="cg-bar"><i style="width:${((S.step + 1) / STEPS) * 100}%"></i></div><span>${S.step + 1}/${STEPS}</span></div>`}
  </div>
  <h1 class="cg-q">${title}</h1>`;

function stepHtml() {
  const card = (key, emoji, label, hint, sel) => `
    <button class="cg-card ${sel ? 'sel' : ''}" data-v="${key}">
      <span class="cg-emoji">${emoji}</span><b>${label}</b>${hint ? `<span class="cg-hint">${hint}</span>` : ''}
    </button>`;

  if (S.step === 0) return head('Quel est ton objectif ?') + `<div class="cg-opts">
    ${Object.entries(GOALS).map(([k, g]) => card(k, g.emoji, g.label, '', S.goal === k)).join('')}</div>`;

  if (S.step === 1) return head('Ton niveau en musculation ?') + `<div class="cg-opts col">
    ${Object.entries(LEVELS).map(([k, l]) => card(k, k === 'beginner' ? '🌱' : k === 'intermediate' ? '⚡' : '🔥', l.label, l.hint, S.level === k)).join('')}</div>`;

  if (S.step === 2) return head('Combien de jours par semaine ?') + `<div class="cg-opts days">
    ${[1, 2, 3, 4, 5, 6].map(d => card(d, '', `${d} jour${d > 1 ? 's' : ''}`, '', S.days === d)).join('')}</div>`;

  if (S.step === 3) return head('Ton matériel ?') + `<div class="cg-opts col">
    ${Object.entries(EQUIPMENTS).map(([k, e]) => card(k, e.emoji, e.label, k === 'gym' ? 'Machines, barres, haltères, poulies' : k === 'dumbbells' ? 'Un banc et des haltères suffisent' : 'Poids du corps et élastiques', S.equipment === k)).join('')}</div>`;

  return head('Durée d’une séance ?') + `<div class="cg-opts days">
    ${DURATIONS.map(d => card(d, '', `${d} min`, '', S.durationMin === d)).join('')}</div>`;
}

function previewHtml() {
  const g = GOALS[S.goal];
  const days = S.plans.map(p => `
    <section class="card cg-day">
      <h3 class="card-t">${icon('dumbbell')} ${esc(p.name)}</h3>
      ${p.items.map(it => {
        const ex = getExercise(it.ex);
        return `<div class="cg-ex">${exImage(ex, 'sm')}
          <div class="cg-ex-t"><b>${esc(ex ? ex.name : it.ex)}</b>
          <span>${it.sets} × ${it.reps[0]}–${it.reps[1]} reps · repos ${it.rest}s</span></div></div>`;
      }).join('')}
    </section>`).join('');
  return head('Ta semaine est prête 💪') + `
    <p class="cg-sub">${g.emoji} ${g.label} · ${LEVELS[S.level].label} · ${S.days}×/semaine · ~${S.durationMin} min. ${esc(g.tagline)}</p>
    <div class="cg-days-list">${days}</div>
    <div class="cg-foot">
      <button class="btn ghost" id="cg-regen">↻ Régénérer</button>
      <button class="btn primary" id="cg-save">Ajouter mes ${S.plans.length} programme${S.plans.length > 1 ? 's' : ''}</button>
    </div>`;
}

function wire(el) {
  el.querySelector('#cg-back').onclick = () => {
    if (S.plans) { S.plans = null; draw(el); return; }
    if (S.step === 0) { nav.go('#/routines'); return; }
    S.step--; draw(el);
  };

  el.querySelectorAll('.cg-card').forEach(b => b.onclick = () => {
    const v = b.dataset.v;
    if (S.step === 0) S.goal = v;
    else if (S.step === 1) S.level = v;
    else if (S.step === 2) S.days = parseInt(v, 10);
    else if (S.step === 3) S.equipment = v;
    else S.durationMin = parseInt(v, 10);
    b.classList.add('sel');
    setTimeout(() => {
      if (S.step < STEPS - 1) { S.step++; draw(el); }
      else generate(el);
    }, 180); // le temps de voir la sélection
  });

  el.querySelector('#cg-regen')?.addEventListener('click', () => { S.seed++; generate(el); });
  el.querySelector('#cg-save')?.addEventListener('click', async () => {
    const btn = el.querySelector('#cg-save');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    for (const p of S.plans) await addTemplate(p);
    toast(`${S.plans.length} programme${S.plans.length > 1 ? 's' : ''} ajouté${S.plans.length > 1 ? 's' : ''} — bonne semaine ! 💪`, { duration: 4500 });
    nav.go('#/routines');
  });
}

function generate(el) {
  S.plans = generatePlans(
    { goal: S.goal, level: S.level, days: S.days, equipment: S.equipment, durationMin: S.durationMin },
    state.library, S.seed
  );
  draw(el);
}
