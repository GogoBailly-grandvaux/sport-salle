// charts.js — dependency-free SVG charts (theme via CSS classes)
import { fmtDate, trimNum } from './util.js';

const W = 320, H = 150, PAD_L = 8, PAD_R = 8, PAD_T = 14, PAD_B = 20;

function scaleY(vals, h = H) {
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;
  min -= range * 0.08; max += range * 0.12;
  const top = PAD_T, bot = h - PAD_B;
  return v => bot - ((v - min) / (max - min)) * (bot - top);
}

export function lineChart(points, opts = {}) {
  const { valueKey = 'value', trendKey = null, fmt = trimNum, height = H } = opts;
  if (!points || points.length === 0) return emptyChart(height);
  const w = W, plotW = w - PAD_L - PAD_R;
  const n = points.length;
  const xs = points.map((_, i) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW));
  const allVals = points.map(p => p[valueKey]).concat(trendKey ? points.map(p => p[trendKey]) : []);
  const y = scaleY(allVals, height);

  const linePts = points.map((p, i) => `${xs[i].toFixed(1)},${y(p[valueKey]).toFixed(1)}`);
  const areaPath = `M${xs[0].toFixed(1)},${(height - PAD_B).toFixed(1)} L` + linePts.join(' L') +
    ` L${xs[n-1].toFixed(1)},${(height - PAD_B).toFixed(1)} Z`;
  const linePath = 'M' + linePts.join(' L');

  let trend = '';
  if (trendKey) {
    const tp = points.map((p, i) => `${xs[i].toFixed(1)},${y(p[trendKey]).toFixed(1)}`);
    trend = `<path class="chart-trend" d="M${tp.join(' L')}"/>`;
  }
  const last = points[n-1];
  const lx = xs[n-1], ly = y(last[valueKey]);
  const labelLeft = lx > w - 60;
  const endLabel = `<g><circle class="chart-dot" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5"/>` +
    `<text class="chart-end" x="${(labelLeft ? lx - 6 : lx + 6).toFixed(1)}" y="${(ly - 6).toFixed(1)}" text-anchor="${labelLeft?'end':'start'}">${fmt(last[valueKey])}</text></g>`;

  const xlabels = xAxis(points, xs, height);

  return `<svg class="chart" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img">
    <path class="chart-area" d="${areaPath}"/>
    <path class="chart-line" d="${linePath}"/>
    ${trend}${endLabel}${xlabels}
  </svg>`;
}

export function barChart(points, opts = {}) {
  const { valueKey = 'value', fmt = trimNum, height = H, label = null } = opts;
  if (!points || points.length === 0) return emptyChart(height);
  const w = W, plotW = w - PAD_L - PAD_R;
  const n = points.length;
  const max = Math.max(...points.map(p => p[valueKey]), 1);
  const bot = height - PAD_B, top = PAD_T;
  const bw = plotW / n * 0.62, gap = plotW / n;
  let bars = '';
  points.forEach((p, i) => {
    const x = PAD_L + gap * i + (gap - bw) / 2;
    const h = ((p[valueKey]) / max) * (bot - top);
    const yy = bot - h;
    bars += `<rect class="chart-bar ${p.hot ? 'hot' : ''}" x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="3"/>`;
  });
  const xlabels = xAxis(points, points.map((_, i) => PAD_L + gap * i + gap/2), height);
  return `<svg class="chart" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img">${bars}${xlabels}</svg>`;
}

function xAxis(points, xs, height) {
  if (!points[0]?.ts) return '';
  const idxs = points.length <= 1 ? [0] : [0, Math.floor((points.length-1)/2), points.length-1];
  const uniq = [...new Set(idxs)];
  return uniq.map(i =>
    `<text class="chart-x" x="${xs[i].toFixed(1)}" y="${height - 5}" text-anchor="${i===0?'start':(i===points.length-1?'end':'middle')}">${fmtDate(points[i].ts)}</text>`
  ).join('');
}

function emptyChart(height = H) {
  return `<svg class="chart" viewBox="0 0 ${W} ${height}"><text class="chart-empty" x="${W/2}" y="${height/2}" text-anchor="middle">Pas encore de données</text></svg>`;
}

export function sparkline(values, opts = {}) {
  const { height = 34, width = 90 } = opts;
  if (!values || values.length < 2) return `<svg class="spark" viewBox="0 0 ${width} ${height}"></svg>`;
  const y = (() => { let mn = Math.min(...values), mx = Math.max(...values); if (mn===mx){mn--;mx++;} return v => (height-3) - ((v-mn)/(mx-mn))*(height-6); })();
  const pts = values.map((v, i) => `${(i/(values.length-1)*width).toFixed(1)},${y(v).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><path class="spark-line" d="M${pts.join(' L')}"/></svg>`;
}
