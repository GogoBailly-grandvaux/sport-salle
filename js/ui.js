// ui.js — icons, toast, bottom sheet, dialogs, confetti
import { t } from './i18n.js';
import { esc } from './util.js';

const P = {
  home:'<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  dumbbell:'<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>',
  bolt:'<path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="currentColor" stroke="none"/>',
  chart:'<path d="M4 4v16h16"/><path d="M7 15l3-4 3 3 5-7"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',
  check:'<path d="M4 12l5 5 11-12"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  back:'<path d="M15 5l-7 7 7 7"/>',
  right:'<path d="M9 5l7 7-7 7"/>',
  down:'<path d="M6 9l6 6 6-6"/>',
  timer:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M10 2h4"/>',
  trophy:'<path d="M7 4h10v4a5 5 0 01-10 0z"/><path d="M7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M9 15h6M12 13v2M8 20h8M10 20v-3h4v3"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 5l4 4"/>',
  trash:'<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>',
  more:'<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  download:'<path d="M12 4v10M8 11l4 4 4-4M5 19h14"/>',
  upload:'<path d="M12 20V10M8 13l4-4 4 4M5 5h14"/>',
  flame:'<path d="M12 3c3 4 5 6 5 9.5A5 5 0 017 12.5c0-1.5.7-2.5 1.6-3.5.2 1.8 2.4 2 3.4-6z" fill="currentColor" stroke="none"/>',
  calendar:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/>',
  star:'<path d="M12 3l2.7 6 6.3.5-4.8 4 1.5 6.2L12 16l-5.7 4.2 1.5-6.2L3 9.5 9.3 9z"/>',
  starfill:'<path d="M12 3l2.7 6 6.3.5-4.8 4 1.5 6.2L12 16l-5.7 4.2 1.5-6.2L3 9.5 9.3 9z" fill="currentColor" stroke="none"/>',
  filter:'<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  play:'<path d="M7 5v14l12-7z" fill="currentColor" stroke="none"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  grip:'<path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"/>',
  duplicate:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  history:'<path d="M4 12a8 8 0 108-8 8 8 0 00-7 4M4 4v4h4M12 8v4l3 2"/>',
  scale:'<path d="M12 4a2 2 0 100 4 2 2 0 000-4zM12 8v3M6 21h12M8 21l1-8h6l1 8"/>',
  arrowup:'<path d="M12 19V5M6 11l6-6 6 6"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.8.3 5 2 5 4.9"/>',
  google:'<path d="M21.35 12.23c0-.68-.06-1.33-.17-1.96H12v3.7h5.24a4.48 4.48 0 01-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.13z" fill="#4285F4" stroke="none"/><path d="M12 21.5c2.62 0 4.82-.87 6.43-2.35l-3.14-2.45c-.87.58-1.98.93-3.29.93-2.53 0-4.68-1.71-5.44-4.01H3.31v2.52A9.7 9.7 0 0012 21.5z" fill="#34A853" stroke="none"/><path d="M6.56 13.62a5.84 5.84 0 010-3.73V7.37H3.31a9.72 9.72 0 000 8.77l3.25-2.52z" fill="#FBBC05" stroke="none"/><path d="M12 6.38c1.43 0 2.71.49 3.72 1.45l2.78-2.78A9.66 9.66 0 0012 2.5a9.7 9.7 0 00-8.69 5.37l3.25 2.52C7.32 8.09 9.47 6.38 12 6.38z" fill="#EA4335" stroke="none"/>',
  finger:'<path d="M12 11a2 2 0 012 2v3a7 7 0 01-1 3.5M12 11a2 2 0 00-2 2v1M12 7.5a5.5 5.5 0 015.5 5.5v2M12 7.5A5.5 5.5 0 006.5 13v3a9 9 0 00.8 3.5M12 4a9 9 0 019 9v1.5M12 4a9 9 0 00-8.2 5.3"/>',
  calc:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
  eye:'<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M3 3l18 18M10.6 5.2A10.6 10.6 0 0112 5.1c6.5 0 10 6.9 10 6.9a17.6 17.6 0 01-3.3 4.1M6.5 6.6C3.7 8.5 2 12 2 12s3.5 6.9 10 6.9c1.5 0 2.9-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 104.2 4.2"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---- toast ----
let toastHost;
export function toast(msg, opts = {}) {
  if (!toastHost) { toastHost = document.createElement('div'); toastHost.className = 'toast-host'; document.body.appendChild(toastHost); }
  const t = document.createElement('div');
  t.className = 'toast' + (opts.type ? ' ' + opts.type : '');
  t.innerHTML = `<span>${esc(msg)}</span>` + (opts.actionText ? `<button class="toast-act">${esc(opts.actionText)}</button>` : '');
  toastHost.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const kill = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 220); };
  if (opts.actionText) t.querySelector('.toast-act').onclick = () => { opts.onAction && opts.onAction(); kill(); };
  if (opts.duration !== 0) setTimeout(kill, opts.duration || 3200);
  return kill;
}

// ---- bottom sheet ----
export function sheet(contentHtml, opts = {}) {
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.innerHTML = `<div class="sheet ${opts.cls||''}" role="dialog" aria-modal="true">
    <div class="sheet-grip"></div>
    ${opts.title ? `<div class="sheet-head"><h3>${esc(opts.title)}</h3><button class="icon-btn sheet-x" aria-label="${t('Fermer','Close')}">${icon('x')}</button></div>` : ''}
    <div class="sheet-body">${contentHtml}</div>
  </div>`;
  document.body.appendChild(back);
  document.body.classList.add('no-scroll');
  const sheetEl = back.querySelector('.sheet');
  requestAnimationFrame(() => back.classList.add('in'));
  const close = (val) => {
    sheetEl.style.transition = ''; sheetEl.style.transform = '';
    back.classList.remove('in');
    document.body.classList.remove('no-scroll');
    setTimeout(() => back.remove(), 240);
    if (opts.onClose) opts.onClose(val);
  };
  back.addEventListener('click', e => { if (e.target === back) close(); });
  back.querySelector('.sheet-x')?.addEventListener('click', () => close());
  // glisser vers le bas (poignée ou en-tête) pour fermer, comme une app native
  let dragY = null;
  const dragMove = e => {
    if (dragY == null) return;
    sheetEl.style.transform = `translateY(${Math.max(0, e.clientY - dragY)}px)`;
    e.preventDefault();
  };
  const dragEnd = e => {
    if (dragY == null) return;
    const d = (e.clientY ?? 0) - dragY; dragY = null;
    sheetEl.style.transition = '';
    if (e.type !== 'pointercancel' && d > 90) close(); else sheetEl.style.transform = '';
    window.removeEventListener('pointermove', dragMove);
    window.removeEventListener('pointerup', dragEnd);
    window.removeEventListener('pointercancel', dragEnd);
  };
  const dragStart = e => {
    if (e.target.closest('.sheet-x')) return;
    dragY = e.clientY; sheetEl.style.transition = 'none';
    window.addEventListener('pointermove', dragMove, { passive: false });
    window.addEventListener('pointerup', dragEnd);
    window.addEventListener('pointercancel', dragEnd);
  };
  back.querySelector('.sheet-grip')?.addEventListener('pointerdown', dragStart);
  back.querySelector('.sheet-head')?.addEventListener('pointerdown', dragStart);
  const esckey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esckey); } };
  document.addEventListener('keydown', esckey);
  if (opts.onMount) opts.onMount(sheetEl, close);
  return { root: sheetEl, close };
}

// Résout true (confirm), false (bouton annuler explicite) ou null (fermeture X/backdrop/Échap).
// Tous les appels « if (await confirmDialog(...)) » traitent null comme falsy — sans danger.
export function confirmDialog({ title = t('Confirmer','Confirm'), message = '', confirmText = t('Confirmer','Confirm'), cancelText = t('Annuler','Cancel'), danger = false } = {}) {
  return new Promise(resolve => {
    const s = sheet(
      `<p class="dialog-msg">${esc(message)}</p>
       <div class="dialog-actions">
         <button class="btn ghost" data-a="cancel">${esc(cancelText)}</button>
         <button class="btn ${danger ? 'danger' : 'primary'}" data-a="ok">${esc(confirmText)}</button>
       </div>`,
      { title, onClose: () => resolve(null) }
    );
    s.root.querySelector('[data-a="ok"]').onclick = () => { resolve(true); s.close(); };
    s.root.querySelector('[data-a="cancel"]').onclick = () => { resolve(false); s.close(); };
  });
}

export function promptDialog({ title = '', label = '', value = '', placeholder = '', confirmText = 'OK', type = 'text' } = {}) {
  return new Promise(resolve => {
    const s = sheet(
      `${label ? `<label class="field-label">${esc(label)}</label>` : ''}
       <input class="input" id="prompt-input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${type==='number'?'inputmode="decimal"':''}>
       <div class="dialog-actions">
         <button class="btn ghost" data-a="cancel">${t('Annuler','Cancel')}</button>
         <button class="btn primary" data-a="ok">${esc(confirmText)}</button>
       </div>`,
      { title, onClose: () => resolve(null) }
    );
    const input = s.root.querySelector('#prompt-input');
    setTimeout(() => input.focus(), 60);
    const done = () => { resolve(input.value); s.close(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
    s.root.querySelector('[data-a="ok"]').onclick = done;
    s.root.querySelector('[data-a="cancel"]').onclick = () => { resolve(null); s.close(); };
  });
}

// ---- confetti (respects reduced motion) ----
export function confetti(originEl, colors = ['#f2a63c', '#c7f24e', '#54c5f2', '#f2679b', '#fff']) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = originEl ? originEl.getBoundingClientRect() : { left: innerWidth/2, top: innerHeight/3, width: 0, height: 0 };
  const ox = rect.left + rect.width/2, oy = rect.top + rect.height/2;
  const host = document.createElement('div'); host.className = 'confetti-host'; document.body.appendChild(host);
  const N = 40, parts = [];
  for (let i = 0; i < N; i++) {
    const d = document.createElement('i');
    const c = colors[i % colors.length];
    d.style.cssText = `left:${ox}px;top:${oy}px;background:${c}`;
    host.appendChild(d);
    const ang = Math.PI * (0.15 + Math.random() * 0.7) * -1 - Math.random()*0.3;
    const sp = 5 + Math.random() * 8;
    parts.push({ el: d, x: 0, y: 0, vx: Math.cos(ang) * sp * (Math.random()<.5?-1:1), vy: -Math.abs(Math.sin(ang) * sp) - 4, rot: Math.random()*360, vr: (Math.random()-.5)*40 });
  }
  let t = 0;
  const tick = () => {
    t += 1; let alive = false;
    for (const p of parts) {
      p.vy += 0.5; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      p.el.style.transform = `translate(${p.x}px,${p.y}px) rotate(${p.rot}deg)`;
      p.el.style.opacity = String(Math.max(0, 1 - t / 60));
      if (t < 60) alive = true;
    }
    if (alive) requestAnimationFrame(tick); else host.remove();
  };
  requestAnimationFrame(tick);
}
