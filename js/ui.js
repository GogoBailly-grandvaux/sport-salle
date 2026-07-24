// ui.js — icons, toast, bottom sheet, dialogs, confetti
import { t } from './i18n.js';
import { esc } from './util.js';

// Tracés qualité Lucide (ISC) — 24px, stroke 2, bouts ronds. Même API icon().
const P = {
  home:'<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  dumbbell:'<rect x="5" y="6.5" width="3.4" height="11" rx="1.7"/><rect x="15.6" y="6.5" width="3.4" height="11" rx="1.7"/><path d="M8.4 12h7.2"/><path d="M2 9.5v5"/><path d="M22 9.5v5"/>',
  bolt:'<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" fill="currentColor" stroke="none"/>',
  chart:'<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
  user:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus:'<path d="M5 12h14"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  back:'<path d="m15 18-6-6 6-6"/>',
  right:'<path d="m9 18 6-6-6-6"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  timer:'<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  trophy:'<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  edit:'<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  more:'<circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/>',
  settings:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  flame:'<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  calendar:'<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  star:'<path d="M12 3l2.7 6 6.3.5-4.8 4 1.5 6.2L12 16l-5.7 4.2 1.5-6.2L3 9.5 9.3 9z"/>',
  starfill:'<path d="M12 3l2.7 6 6.3.5-4.8 4 1.5 6.2L12 16l-5.7 4.2 1.5-6.2L3 9.5 9.3 9z" fill="currentColor" stroke="none"/>',
  filter:'<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  play:'<polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none"/>',
  info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  grip:'<circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/>',
  duplicate:'<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  history:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  scale:'<circle cx="12" cy="5" r="3"/><path d="M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.5A2 2 0 0 0 17.48 8Z"/>',
  arrowup:'<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  bell:'<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  medal:'<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/>',
  camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  image:'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  building:'<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  swords:'<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 10"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
  message:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  megaphone:'<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  sparkles:'<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
  smartphone:'<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  idcard:'<path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/>',
  lock:'<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  globe:'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  hand:'<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  heart:'<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  rocket:'<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  crown:'<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.735H5.81a1 1 0 0 1-.957-.735L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
  send:'<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  key:'<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  wifioff:'<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  refresh:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  clipboard:'<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  sunrise:'<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
  party:'<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
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
