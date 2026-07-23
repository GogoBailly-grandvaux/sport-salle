// screens/library.js — exercise library browse + detail
import { esc, debounce } from '../util.js';
import { state, nav } from '../store.js';
import { icon, sheet, toast } from '../ui.js';
import {
  searchExercises, getExercise, imageUrls, muscleFR, musclesFR,
  MUSCLE_FR, EQUIP_FR, CATEGORY_FR, LEVEL_FR, FORCE_FR,
  loadFavorites, toggleFavorite, musclesMap,
} from '../data.js';
import { exImage, muscleChips, emptyState, backBtn, groupColor } from './common.js';
import { listWorkouts, listRoutines, saveRoutine, getRoutine, mkRoutineItem } from '../model.js';
import { allTimeBests } from '../analytics.js';

const F = { q: '', muscle: '', equipment: '', category: '', favOnly: false };
let favSet = new Set();

export async function renderList() {
  favSet = await loadFavorites(state.activeProfileId);
  const res = searchExercises({ ...F, favSet: F.favOnly ? favSet : null });
  const shown = res.slice(0, 80);
  const activeFilters = [F.muscle && muscleFR(F.muscle), F.equipment && EQUIP_FR[F.equipment], F.category && CATEGORY_FR[F.category]].filter(Boolean);

  const rows = shown.length ? shown.map(ex => `
    <button class="lib-row" data-nav="#/library/${encodeURIComponent(ex.id)}">
      ${exImage(ex)}
      <div class="lib-info"><b>${esc(ex.name)}</b><span>${esc(musclesFR(ex.primaryMuscles).join(', ') || '—')}</span></div>
      <button class="fav-btn ${favSet.has(ex.id)?'on':''}" data-fav="${esc(ex.id)}" aria-label="Favori">${icon(favSet.has(ex.id)?'starfill':'star')}</button>
    </button>`).join('')
    : emptyState('search', 'Aucun résultat', 'Essaie un autre mot ou enlève les filtres.',
        `<button class="btn ghost" id="lib-clear">Réinitialiser</button>`);

  return `
    <header class="topbar">
      <div class="topbar-l">${backBtn('#/home')}</div>
      <div class="topbar-c"><h1>Exercices</h1></div>
      <div class="topbar-r"><button class="icon-btn ${F.favOnly?'active':''}" id="lib-fav" aria-label="Favoris">${icon(F.favOnly?'starfill':'star')}</button></div>
    </header>
    <div class="screen-pad">
      <div class="lib-search">
        <div class="input-ico">${icon('search')}<input class="input" id="lib-q" placeholder="Rechercher parmi ${state.library.length} exercices" value="${esc(F.q)}" autocomplete="off"></div>
        <button class="icon-btn ${activeFilters.length?'active':''}" id="lib-filter" aria-label="Filtres">${icon('filter')}</button>
      </div>
      ${activeFilters.length ? `<div class="filter-tags">${activeFilters.map(f=>`<span class="tag">${esc(f)}</span>`).join('')}<button class="tag clear" id="lib-clear2">Effacer ${icon('x')}</button></div>` : ''}
      <p class="mut sm count">${res.length} exercice(s)${res.length>80?' · 80 affichés':''}</p>
      <div class="lib-list">${rows}</div>
    </div>`;
}

export function mountList(root) {
  const q = root.querySelector('#lib-q');
  q.addEventListener('input', debounce(e => { F.q = e.target.value; softRefresh(root); }, 160));
  root.querySelector('#lib-fav').onclick = () => { F.favOnly = !F.favOnly; nav.refresh(); };
  root.querySelector('#lib-filter').onclick = openFilters;
  root.querySelector('#lib-clear')?.addEventListener('click', clearF);
  root.querySelector('#lib-clear2')?.addEventListener('click', clearF);
  root.querySelectorAll('[data-fav]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation(); e.preventDefault();
    const id = b.dataset.fav; const on = !favSet.has(id);
    if (on) favSet.add(id); else favSet.delete(id);
    b.classList.toggle('on', on); b.innerHTML = icon(on ? 'starfill' : 'star');
    await toggleFavorite(state.activeProfileId, id, on);
  }));
}

function clearF() { F.q=''; F.muscle=''; F.equipment=''; F.category=''; F.favOnly=false; nav.refresh(); }

// lightweight in-place list refresh on search typing (avoid full re-render/focus loss)
function softRefresh(root) {
  const res = searchExercises({ ...F, favSet: F.favOnly ? favSet : null });
  const list = root.querySelector('.lib-list');
  const shown = res.slice(0, 80);
  root.querySelector('.count').textContent = `${res.length} exercice(s)${res.length>80?' · 80 affichés':''}`;
  list.innerHTML = shown.length ? shown.map(ex => `
    <button class="lib-row" data-nav="#/library/${encodeURIComponent(ex.id)}">
      ${exImage(ex)}
      <div class="lib-info"><b>${esc(ex.name)}</b><span>${esc(musclesFR(ex.primaryMuscles).join(', ') || '—')}</span></div>
      <button class="fav-btn ${favSet.has(ex.id)?'on':''}" data-fav="${esc(ex.id)}">${icon(favSet.has(ex.id)?'starfill':'star')}</button>
    </button>`).join('')
    : emptyState('search', 'Aucun résultat', 'Essaie un autre mot.', '');
  // re-wire nav + fav for new nodes
  list.querySelectorAll('[data-fav]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation(); e.preventDefault();
    const id = b.dataset.fav; const on = !favSet.has(id);
    if (on) favSet.add(id); else favSet.delete(id);
    b.classList.toggle('on', on); b.innerHTML = icon(on ? 'starfill' : 'star');
    await toggleFavorite(state.activeProfileId, id, on);
  }));
}

function openFilters() {
  // .filter(k => k !== 'null') : EQUIP_FR contient une clé null (coercée en "null") pour l'affichage — pas un filtre valide
  const opt = (obj, cur) => ['', ...Object.keys(obj).filter(k => k !== 'null')].map(k => `<option value="${k}" ${k===cur?'selected':''}>${k? (obj[k]) : 'Tous'}</option>`).join('');
  const s = sheet(`
    <label class="field-label">Muscle</label>
    <select class="input select" id="f-muscle">${opt(MUSCLE_FR, F.muscle)}</select>
    <label class="field-label">Matériel</label>
    <select class="input select" id="f-equip">${opt(EQUIP_FR, F.equipment)}</select>
    <label class="field-label">Catégorie</label>
    <select class="input select" id="f-cat">${opt(CATEGORY_FR, F.category)}</select>
    <div class="dialog-actions"><button class="btn ghost" id="f-reset">Réinitialiser</button><button class="btn primary" id="f-apply">Appliquer</button></div>`,
    { title: 'Filtres' });
  s.root.querySelector('#f-apply').onclick = () => {
    F.muscle = s.root.querySelector('#f-muscle').value;
    F.equipment = s.root.querySelector('#f-equip').value;
    F.category = s.root.querySelector('#f-cat').value;
    s.close(); nav.refresh();
  };
  s.root.querySelector('#f-reset').onclick = () => { F.muscle=F.equipment=F.category=''; s.close(); nav.refresh(); };
}

// ---------------- detail ----------------
export async function renderDetail(params) {
  const id = decodeURIComponent(params.id);
  const ex = getExercise(id);
  if (!ex) return `<div class="screen-pad">${emptyState('info','Introuvable','Cet exercice n’existe plus.', `<button class="btn ghost" data-nav="#/library">Retour</button>`)}</div>`;
  favSet = await loadFavorites(state.activeProfileId);
  const workouts = await listWorkouts();
  const best = allTimeBests(workouts, id);
  const urls = imageUrls(ex);
  const isFav = favSet.has(id);

  const imgs = urls.length ? `<div class="detail-shots">
      <figure><img loading="lazy" src="${esc(urls[0])}" alt="départ" onerror="this.closest('figure').style.display='none'"><figcaption>Départ</figcaption></figure>
      ${urls[1] ? `<figure><img loading="lazy" src="${esc(urls[1])}" alt="effort" onerror="this.closest('figure').style.display='none'"><figcaption>Effort</figcaption></figure>` : ''}
    </div>` : `<div class="detail-noimg" style="--g:${groupColor(ex)}">${esc(ex.name.slice(0,1).toUpperCase())}</div>`;

  const badges = [
    ex.equipment && EQUIP_FR[ex.equipment], ex.level && LEVEL_FR[ex.level],
    ex.category && CATEGORY_FR[ex.category], ex.force && FORCE_FR[ex.force],
  ].filter(Boolean).map(b => `<span class="badge">${esc(b)}</span>`).join('');

  const video = ex.videoUrl ? `
    <video class="ex-video" controls playsinline preload="none" src="${esc(ex.videoUrl)}"></video>
    <p class="mut sm center">🎬 Vidéo du mouvement (wger, CC-BY-SA) — <a href="${esc(ex.videoUrl)}" target="_blank" rel="noopener">ouvrir</a> si la lecture échoue</p>` : '';

  // carte musculaire (silhouettes wger + muscles ciblés)
  let bodymap = '';
  const mm = await musclesMap();
  if (mm && mm.byOurName && mm.bodyImages) {
    const ids = new Set();
    for (const m of (ex.primaryMuscles || [])) for (const id of (mm.byOurName[m] || [])) ids.add(id);
    const secIds = new Set();
    for (const m of (ex.secondaryMuscles || [])) for (const id of (mm.byOurName[m] || [])) if (!ids.has(id)) secIds.add(id);
    if (ids.size || secIds.size) {
      const side = (front) => {
        const base = front ? mm.bodyImages.front : mm.bodyImages.back;
        let ov = '';
        for (const id of ids) { const mu = mm.byWgerId[id]; if (mu && mu.isFront === front && mu.main) ov += `<img class="bm-overlay" src="${esc(mu.main)}" alt="" loading="lazy">`; }
        for (const id of secIds) { const mu = mm.byWgerId[id]; if (mu && mu.isFront === front && mu.secondary) ov += `<img class="bm-overlay" src="${esc(mu.secondary)}" alt="" loading="lazy">`; }
        return ov ? `<div><div class="bm-side"><img src="${esc(base)}" alt="" loading="lazy">${ov}</div><div class="bm-cap">${front ? 'Face' : 'Dos'}</div></div>` : '';
      };
      const both = side(true) + side(false);
      if (both) bodymap = `<section class="card"><h3 class="card-t">Muscles ciblés</h3><div class="bodymap">${both}</div></section>`;
    }
  }

  const instr = (ex.instructions||[]).length ? `<section class="card"><h3 class="card-t">Exécution</h3><ol class="steps">${ex.instructions.map(i=>`<li>${esc(i)}</li>`).join('')}</ol></section>` : '';

  const hist = best.sessions ? `
    <section class="card"><h3 class="card-t">Ton historique</h3>
      <div class="mini-stats">
        <div><b>${best.maxWeight ? best.maxWeight + ' kg' : '—'}</b><span>Charge max</span></div>
        <div><b>${best.bestE1rm ? Math.round(best.bestE1rm) + ' kg' : '—'}</b><span>1RM estimé</span></div>
        <div><b>${best.sessions}</b><span>séances</span></div>
      </div>
      <button class="btn ghost full" data-nav="#/progress/exercise/${encodeURIComponent(id)}">Voir la progression ${icon('right')}</button>
    </section>` : '';

  return `
    <header class="topbar">
      <div class="topbar-l">${backBtn('#/library')}</div>
      <div class="topbar-c"><h1 class="ell">${esc(ex.name)}</h1>${ex.nameEn && ex.nameEn !== ex.name ? `<span class="topbar-sub">${esc(ex.nameEn)}</span>` : ''}</div>
      <div class="topbar-r"><button class="fav-btn big ${isFav?'on':''}" id="d-fav">${icon(isFav?'starfill':'star')}</button></div>
    </header>
    <div class="screen-pad">
      ${imgs}
      ${video}
      <div class="detail-badges">${badges}</div>
      <div class="detail-muscles">
        ${(ex.primaryMuscles||[]).length ? `<div><span class="mut sm">Principaux</span>${muscleChips(ex, 6)}</div>` : ''}
        ${(ex.secondaryMuscles||[]).length ? `<div><span class="mut sm">Secondaires</span><div class="chips">${musclesFR(ex.secondaryMuscles).map(m=>`<span class="mchip alt">${esc(m)}</span>`).join('')}</div></div>` : ''}
      </div>
      ${bodymap}
      ${hist}
      ${instr}
      <div class="detail-actions">
        <button class="btn primary full" id="d-add">${icon('plus')} Ajouter à un programme</button>
      </div>
    </div>`;
}

export function mountDetail(root, params) {
  const id = decodeURIComponent(params.id);
  root.querySelector('#d-fav').onclick = async (e) => {
    const b = e.currentTarget; const on = !b.classList.contains('on');
    b.classList.toggle('on', on); b.innerHTML = icon(on ? 'starfill' : 'star');
    await toggleFavorite(state.activeProfileId, id, on);
  };
  root.querySelector('#d-add').onclick = () => addToRoutine(id);
}

async function addToRoutine(exerciseId) {
  const routines = await listRoutines();
  if (!routines.length) { toast('Crée d’abord un programme'); nav.go('#/routines'); return; }
  const s = sheet(routines.map(r => `<button class="pick-row simple" data-r="${r.id}"><div class="pick-info"><b>${esc(r.name)}</b><span>${(r.items||[]).length} exercice(s)</span></div>${icon('plus')}</button>`).join(''),
    { title: 'Ajouter à…' });
  s.root.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => {
    const r = await getRoutine(b.dataset.r);
    r.items = r.items || [];
    r.items.push(mkRoutineItem(exerciseId, r.items.length));
    await saveRoutine(r);
    s.close(); toast('Ajouté au programme ✓');
  });
}
