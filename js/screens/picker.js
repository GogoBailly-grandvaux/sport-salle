// screens/picker.js — exercise picker bottom sheet (single or multi-select)
import { t } from '../i18n.js';
import { esc, debounce } from '../util.js';
import { sheet, icon, toast } from '../ui.js';
import { searchExercises, muscleFR, MUSCLE_FR, EQUIP_FR, addCustomExercise } from '../data.js';
import { exImage } from './common.js';

export function openExercisePicker({ multi = true, onPick } = {}) {
  const selected = new Set();
  let q = '', muscle = '';
  const CHUNK = 100;      // rendu par tranches (les 1214 exercices restent accessibles en défilant)
  let limit = CHUNK;

  const rowHtml = (ex) => `
      <button class="pick-row ${selected.has(ex.id) ? 'sel' : ''}" data-id="${esc(ex.id)}">
        ${exImage(ex, 'sm')}
        <div class="pick-info"><b>${esc(ex.name)}</b><span>${esc((ex.primaryMuscles||[]).map(muscleFR).join(', '))}</span></div>
        <span class="pick-check">${icon(selected.has(ex.id) ? 'check' : 'plus')}</span>
      </button>`;

  const listHtml = () => {
    const res = searchExercises({ q, muscle });
    if (!res.length) return `<div class="pick-empty">${t('Aucun exercice.','No exercises.')}<br><button class="btn ghost sm" id="pk-new">+ ${t('Créer un exercice','Create an exercise')}</button></div>`;
    return res.slice(0, limit).map(rowHtml).join('') + (res.length > limit ? '<div class="list-more" id="pk-more"></div>' : '');
  };

  const observeMore = () => {
    const scroller = s.root.querySelector('#pk-list') || s.root; // la liste défile (sinon la sheet)
    const check = () => {
      const m = scroller.querySelector('#pk-more');
      if (!m) { scroller.removeEventListener('scroll', check); return; }
      if (m.getBoundingClientRect().top > innerHeight + 200) return;
      const res = searchExercises({ q, muscle });
      const next = res.slice(limit, limit + CHUNK);
      limit += CHUNK;
      m.insertAdjacentHTML('beforebegin', next.map(rowHtml).join(''));
      if (limit >= res.length) m.remove();
    };
    if (scroller._pkScroll) scroller.removeEventListener('scroll', scroller._pkScroll);
    scroller._pkScroll = check;
    scroller.addEventListener('scroll', check, { passive: true });
    check();
  };

  const muscleOpts = ['', ...Object.keys(MUSCLE_FR)].map(m =>
    `<option value="${m}">${m ? muscleFR(m) : t('Tous les muscles','All muscles')}</option>`).join('');

  const body = `
    <div class="pick-search">
      <div class="input-ico">${icon('search')}<input class="input" id="pk-q" placeholder="${t('Rechercher un exercice','Search exercises')}" aria-label="${t('Rechercher un exercice','Search exercises')}" autocomplete="off"></div>
      <select class="input select" id="pk-muscle" aria-label="${t('Filtrer par muscle','Filter by muscle')}">${muscleOpts}</select>
    </div>
    <div class="pick-list" id="pk-list">${listHtml()}</div>
    ${multi ? `<div class="pick-foot"><button class="btn primary" id="pk-add" disabled>${t('Ajouter','Add')}</button></div>` : ''}`;

  const s = sheet(body, { title: t('Ajouter un exercice','Add an exercise'), cls: 'tall' });
  const listEl = s.root.querySelector('#pk-list');
  const addBtn = s.root.querySelector('#pk-add');
  const refresh = () => { limit = CHUNK; listEl.innerHTML = listHtml(); wireNew(); observeMore(); };
  const wireNew = () => { const n = s.root.querySelector('#pk-new'); if (n) n.onclick = createCustom; };

  const updateFoot = () => { if (addBtn) { addBtn.disabled = selected.size === 0; addBtn.textContent = selected.size ? `${t('Ajouter','Add')} (${selected.size})` : t('Ajouter','Add'); } };

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
  observeMore();

  async function createCustom() {
    const name = s.root.querySelector('#pk-q').value.trim();
    if (!name) { toast(t('Tape un nom dans la recherche d’abord','Type a name in the search first')); return; }
    const ex = await addCustomExercise({ name, primaryMuscles: muscle ? [muscle] : [] });
    toast(`« ${ex.name} » ${t('créé','created')}`);
    if (!multi) { s.close(); onPick && onPick([ex.id]); }
    else { selected.add(ex.id); refresh(); updateFoot(); }
  }
}
