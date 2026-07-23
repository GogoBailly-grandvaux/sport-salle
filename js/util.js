// util.js — helpers (no dependencies)

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.floor(Math.random()*1e9).toString(36));

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sum = arr => arr.reduce((a, b) => a + b, 0);
export const round = (v, d = 0) => { const p = 10 ** d; return Math.round(v * p) / p; };

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---- dates ----
export const nowTs = () => Date.now();
export function todayISO(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
const MONTHS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const DAYS = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
export function fmtDate(ts, opts = {}) {
  const d = new Date(ts);
  if (opts.withDay) return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${opts.year ? ' ' + d.getFullYear() : ''}`;
}
export function fmtTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
export function relDate(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  const dToday = new Date(); dToday.setHours(0,0,0,0);
  const d = new Date(ts); d.setHours(0,0,0,0);
  const diff = Math.round((dToday - d) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  if (diff < 7) return `Il y a ${diff} j`;
  return fmtDate(ts, { year: diff > 330 });
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  if (h) return `${h}h${String(m).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec/60), s = sec%60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// ---- units (canonical storage = kg) ----
export const LB_PER_KG = 2.2046226218;
export const toDisplayWeight = (kg, unit) => unit === 'lb' ? round(kg * LB_PER_KG, 1) : round(kg, 1);
export const fromDisplayWeight = (val, unit) => unit === 'lb' ? val / LB_PER_KG : val;
export function fmtWeight(kg, unit = 'kg') {
  if (kg == null) return '—';
  const v = toDisplayWeight(kg, unit);
  return `${trimNum(v)} ${unit}`;
}
export const trimNum = v => (Math.round(v * 100) / 100).toString();

export function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

export function pluralS(n, one, many) { return n === 1 ? one : (many || one + 's'); }

// 'YYYY-MM-DD' → timestamp à minuit LOCAL (new Date(iso) parserait en UTC → décalage d'un jour possible)
export const isoToTs = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
