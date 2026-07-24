// screens/common.js — shared render helpers
import { esc } from '../util.js';
import { icon } from '../ui.js';
import { t } from '../i18n.js';
import { imageUrls, muscleFR, MUSCLE_GROUP } from '../data.js';

// Démo animée du mouvement : les images free-exercise-db sont 2 frames
// (départ / fin) ; on les fait boucler en fondu = une vraie « vidéo » du geste,
// 100% hors-ligne (aucune vidéo externe, compatible CSP). Repli si 1 seule image.
export function exDemo(ex, cls = '') {
  const urls = imageUrls(ex);
  const col = groupColor(ex);
  const initials = (ex?.name || '?').trim().slice(0, 1).toUpperCase();
  if (urls.length >= 2) {
    return `<div class="ex-demo ${cls}" style="--g:${col}">
      <img class="exd exd-0" loading="lazy" src="${esc(urls[0])}" alt="" onerror="this.closest('.ex-demo').classList.add('noimg')">
      <img class="exd exd-1" loading="lazy" src="${esc(urls[1])}" alt="" onerror="this.closest('.ex-demo').classList.add('noanim')">
      <span class="exd-badge">▶ ${t('démo','demo')}</span>
      <span class="ex-thumb-fallback big">${esc(initials)}</span>
    </div>`;
  }
  if (urls.length === 1) {
    return `<div class="ex-demo one ${cls}" style="--g:${col}">
      <img class="exd" loading="lazy" src="${esc(urls[0])}" alt="" onerror="this.closest('.ex-demo').classList.add('noimg')">
      <span class="ex-thumb-fallback big">${esc(initials)}</span></div>`;
  }
  return `<div class="ex-demo noimg ${cls}" style="--g:${col}"><span class="ex-thumb-fallback big">${esc(initials)}</span></div>`;
}

export const GROUP_COLOR = {
  'Pectoraux':'#ef6a4d', 'Dos':'#4f93d6', 'Épaules':'#b07fe0',
  'Bras':'#e070a8', 'Jambes':'#4bbf7b', 'Abdos':'#33c2bb',
};
export function exGroup(ex) {
  const m = (ex?.primaryMuscles || [])[0];
  return MUSCLE_GROUP[m] || '';
}
export function groupColor(ex) { return GROUP_COLOR[exGroup(ex)] || 'var(--accent)'; }

export function exImage(ex, cls = '') {
  const urls = imageUrls(ex);
  const col = groupColor(ex);
  const initials = (ex?.name || '?').trim().slice(0, 1).toUpperCase();
  if (urls.length) {
    return `<div class="ex-thumb ${cls}" style="--g:${col}">
      <img loading="lazy" src="${esc(urls[0])}" alt="" onerror="this.parentElement.classList.add('noimg')">
      <span class="ex-thumb-fallback">${esc(initials)}</span></div>`;
  }
  return `<div class="ex-thumb noimg ${cls}" style="--g:${col}"><span class="ex-thumb-fallback">${esc(initials)}</span></div>`;
}

export function muscleChips(ex, max = 3) {
  const ms = (ex?.primaryMuscles || []).slice(0, max);
  return `<div class="chips">` + ms.map(m =>
    `<span class="mchip" style="--g:${GROUP_COLOR[MUSCLE_GROUP[m]] || 'var(--muted)'}">${esc(muscleFR(m))}</span>`
  ).join('') + `</div>`;
}

export function emptyState(iconName, title, text, ctaHtml = '') {
  return `<div class="empty">
    <div class="empty-ico">${icon(iconName)}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(text)}</p>
    ${ctaHtml}
  </div>`;
}

export function statTile(value, label, sub = '') {
  return `<div class="stat-tile"><b>${value}</b><span>${esc(label)}</span>${sub ? `<em>${esc(sub)}</em>` : ''}</div>`;
}

export function appHeader(title, { left = '', right = '', sub = '' } = {}) {
  return `<header class="topbar">
    <div class="topbar-l">${left}</div>
    <div class="topbar-c"><h1>${esc(title)}</h1>${sub ? `<span class="topbar-sub">${esc(sub)}</span>` : ''}</div>
    <div class="topbar-r">${right}</div>
  </header>`;
}

export function backBtn(hash) {
  return `<button class="icon-btn" data-nav="${esc(hash)}" aria-label="Retour">${icon('back')}</button>`;
}
