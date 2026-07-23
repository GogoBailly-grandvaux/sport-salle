// screens/picker.js — exercise picker bottom sheet (single or multi-select)
import { esc, debounce } from '../util.js';
import { sheet, icon, toast } from '../ui.js';
import { searchExercises, muscleFR, MUSCLE_FR, EQUIP_FR, addCustomExercise } from '../data.js';
import { exImage } from './common.js';

export function openExercisePicker({ multi = true, onPick } = {}) {
  const selected = new Set();
  let q = '', muscle = '';

  const listHtml = () => {
    const res = searchExercises({ q, muscle }).slice(0, 60);
    if (!res.length) return `<div class="pick-empty">Aucun exercice.<br><button class="btn ghost sm" id="pk-new">+ Créer un exercice</button></div>`;
    return res.map(ex => `
      <button class="pick-row ${selected.has(ex.id) ? 'sel' : ''}" data-id="${ex.id}">
        ${exImage(ex, 'sm')}
        <div class="pick-info"><b>${esc(ex.name)}</b><span>${esc((ex.primaryMuscles||[]).map(muscleFR).join(', '))}</span></div>
        <span class="pick-check">${icon(selected.has(ex.id) ? 'check' : 'plus')}</span>
      </button>`).join('');
  };

  const muscleOpts = ['', ...Object.keys(MUSCLE_FR)].map(m =>
    `<option value="${m}">${m ? muscleFR(m) : 'Tous les muscles'}</option>`).join('');

  const body = `
    <div class="pick-search">
      <div class="input-ico">${icon('search')}<input class="input" id="pk-q" placeholder="Rechercher un exercice" autocomplete="off"></div>
      <select class="input select" id="pk-muscle">${muscleOpts}</select>
    </div>
    <div class="pick-list" id="pk-list">${listHtml()}</div>
    ${multi ? `<div class="pick-foot"><button class="btn primary" id="pk-add" disabled>Ajouter</button></div>` : ''}`;

  const s = sheet(body, { title: 'Ajouter un exercice', cls: 'tall' });
  const listEl = s.root.querySelector('#pk-list');
  const addBtn = s.root.querySelector('#pk-add');
  const refresh = () => { listEl.innerHTML = listHtml(); wireNew(); };
  const wireNew = () => { const n = s.root.querySelector('#pk-new'); if (n) n.onclick = createCustom; };

  const updateFoot = () => { if (addBtn) { addBtn.disabled = selected.size === 0; addBtn.textContent = selected.size ? `Ajouter (${selected.size})` : 'Ajouter'; } };

  listEl.addEventListener('click', e => {
    const row = e.target.closest('.pick-row'); if (!row) return;
    const id = row.dataset.id;
    if (!multi) { s.close(); onPick && onPick([id]); return; }
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    row.classList.toggle('sel'); row.querySelector('.pick-check').innerHTML = icon(selected.has(id) ? 'check' : 'plus');
    updateFoot();
  });
  s.root.querySelector('#pk-q').addEventListener('input', debounce(e => { q = e.target.value; refresh(); }, 160));
  s.root.querySelector('#pk-muscle').addEventListener('change', e => { muscle = e.target.value; refresh(); });
  if (addBtn) addBtn.onclick = () => { if (!selected.size) return; s.close(); onPick && onPick([...selected]); };
  wireNew();

  async function createCustom() {
    const name = s.root.querySelector('#pk-q').value.trim();
    if (!name) { toast('Tape un nom dans la recherche d’abord'); return; }
    const ex = await addCustomExercise({ name, primaryMuscles: muscle ? [muscle] : [] });
    toast(`« ${ex.name} » créé`);
    if (!multi) { s.close(); onPick && onPick([ex.id]); }
    else { selected.add(ex.id); refresh(); updateFoot(); }
  }
}
