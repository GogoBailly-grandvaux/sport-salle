// qr.js — générateur de QR codes maison (ISO 18004), zéro dépendance.
// Mode octets, correction M, versions 1-10 (large pour nos liens de profil).
// Rendu en SVG : net à toutes les tailles, thème-able, aucun réseau (CSP ok).

// ---- tables (niveau M) : [ec/bloc, blocs g1, data/bloc g1, blocs g2, data/bloc g2]
const EC_M = {
  1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// ---- arithmétique GF(256) (polynôme 0x11d) pour Reed-Solomon
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

function rsGenerator(deg) {
  let g = [1];
  for (let i = 0; i < deg; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      ng[j] ^= gmul(g[j], EXP[i]);
      ng[j + 1] ^= g[j];
    }
    g = ng;
  }
  return g.reverse(); // coefficients du plus haut degré vers le plus bas
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(data.length + ecLen);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor === 0) continue;
    for (let j = 1; j < gen.length; j++) res[i + j] ^= gmul(gen[j], factor);
  }
  return res.slice(data.length);
}

// ---- construction du flux de données
function buildCodewords(bytes, version) {
  const [ecPerBlock, g1, d1, g2, d2] = EC_M[version];
  const totalData = g1 * d1 + g2 * d2;
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                                  // mode octets
  push(bytes.length, version >= 10 ? 16 : 8);        // compteur
  for (const b of bytes) push(b, 8);
  // terminateur + alignement sur l'octet
  for (let i = 0; i < 4 && bits.length < totalData * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    cw.push(v);
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; cw.length < totalData; i++) cw.push(PAD[i % 2]);

  // découpe en blocs + EC par bloc
  const blocks = [];
  let off = 0;
  for (let b = 0; b < g1; b++) { blocks.push(cw.slice(off, off + d1)); off += d1; }
  for (let b = 0; b < g2; b++) { blocks.push(cw.slice(off, off + d2)); off += d2; }
  const ecs = blocks.map(bl => rsEncode(Uint8Array.from(bl), ecPerBlock));
  // entrelacement
  const out = [];
  const maxD = Math.max(d1, d2 || 0);
  for (let i = 0; i < maxD; i++) for (const bl of blocks) if (i < bl.length) out.push(bl[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const ec of ecs) out.push(ec[i]);
  return out;
}

// ---- matrice
function buildMatrix(version, codewords, mask) {
  const size = 17 + version * 4;
  const M = Array.from({ length: size }, () => new Array(size).fill(null)); // null = libre

  const set = (r, c, v) => { M[r][c] = v ? 1 : 0; };
  const finder = (r, c) => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
        (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      set(rr, cc, on);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  // motifs d'alignement
  const ap = ALIGN[version];
  for (const r of ap) for (const c of ap) {
    if (M[r][c] !== null) continue; // chevauche un finder
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
  // timing
  for (let i = 8; i < size - 8; i++) {
    if (M[6][i] === null) set(6, i, i % 2 === 0);
    if (M[i][6] === null) set(i, 6, i % 2 === 0);
  }
  set(size - 8, 8, 1); // module sombre

  // réservation zones de format
  const fmtCells = [];
  for (let i = 0; i <= 8; i++) { if (i !== 6) { fmtCells.push([8, i]); fmtCells.push([i, 8]); } }
  fmtCells.push([8, 7]);
  for (let i = 0; i < 8; i++) fmtCells.push([8, size - 1 - i]);
  for (let i = 0; i < 7; i++) fmtCells.push([size - 1 - i, 8]);
  for (const [r, c] of fmtCells) if (M[r][c] === null) M[r][c] = 0;

  // placement zigzag des données
  const maskFn = MASKS[mask];
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  const bitAt = i => (codewords[i >> 3] >> (7 - (i & 7))) & 1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // saute la colonne de timing
    for (let s = 0; s < size; s++) {
      const row = ((size - 1 - col) >> 1) % 2 === 0 ? size - 1 - s : s; // sens alterné
      for (const c of [col, col - 1]) {
        if (M[row][c] !== null) continue;
        let v = bitIdx < totalBits ? bitAt(bitIdx) : 0;
        bitIdx++;
        if (maskFn(row, c)) v ^= 1;
        M[row][c] = v;
      }
    }
  }

  // informations de format (EC M = 00, masque)
  const fmt = formatBits(mask);
  const b = i => (fmt >> i) & 1;
  // copie 1 : autour du finder haut-gauche
  const coords1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  // copie 2 : sous le finder haut-droit + à droite du finder bas-gauche
  const coords2 = [];
  for (let i = 0; i < 7; i++) coords2.push([size - 1 - i, 8]);
  for (let i = 7; i < 15; i++) coords2.push([8, size - 15 + i]);
  for (let i = 0; i < 15; i++) {
    const [r1, c1] = coords1[i]; M[r1][c1] = b(14 - i);
    const [r2, c2] = coords2[i]; M[r2][c2] = b(14 - i);
  }
  return M;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

function formatBits(mask) {
  const data = (0b00 << 3) | mask; // EC M = 00
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  return ((data << 10) | rem) ^ 0x5412;
}

// pénalité (choix du meilleur masque)
function penalty(M) {
  const size = M.length;
  let score = 0;
  // règles 1 : suites de 5+
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c <= size; c++) {
        const cur = c < size ? (pass ? M[c][r] : M[r][c]) : -1;
        const prev = pass ? M[c - 1][r] : M[r][c - 1];
        if (cur === prev) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
    }
  }
  // règle 2 : blocs 2x2
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = M[r][c];
    if (v === M[r][c + 1] && v === M[r + 1][c] && v === M[r + 1][c + 1]) score += 3;
  }
  // règle 3 : motif 1011101 avec 4 blancs autour
  const pat1 = [1,0,1,1,1,0,1,0,0,0,0], pat2 = [0,0,0,0,1,0,1,1,1,0,1];
  for (let r = 0; r < size; r++) for (let c = 0; c + 11 <= size; c++) {
    let m1 = true, m2 = true, m3 = true, m4 = true;
    for (let i = 0; i < 11; i++) {
      if (M[r][c + i] !== pat1[i]) m1 = false;
      if (M[r][c + i] !== pat2[i]) m2 = false;
      if (M[c + i] && M[c + i][r] !== pat1[i]) m3 = false;
      if (M[c + i] && M[c + i][r] !== pat2[i]) m4 = false;
    }
    if (c + 11 > size) { m3 = m4 = false; }
    score += (m1 ? 40 : 0) + (m2 ? 40 : 0) + (m3 ? 40 : 0) + (m4 ? 40 : 0);
  }
  // règle 4 : proportion de sombre
  let dark = 0;
  for (const row of M) for (const v of row) dark += v;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/** Matrice du QR (tableau de lignes de 0/1) pour un texte donné.
 *  Limité aux versions 1-6 : au-delà il faudrait les blocs « version info »
 *  (inutiles ici — la v6 tient 108 octets, nos liens en font ~50). */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 6; v++) {
    const [, g1, d1, g2, d2] = EC_M[v];
    const cap = g1 * d1 + g2 * d2;                     // octets de données
    const headBits = 4 + 8;                            // mode + compteur (8 bits jusqu'à v9)
    if (bytes.length * 8 + headBits <= cap * 8) { version = v; break; }
  }
  if (!version) throw new Error('texte trop long pour un QR v6 (108 octets max)');
  const cw = buildCodewords(bytes, version);
  let best = null, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const M = buildMatrix(version, cw, m);
    const s = penalty(M);
    if (s < bestScore) { bestScore = s; best = M; }
  }
  return best;
}

/** SVG du QR (avec zone de silence), couleurs personnalisables. */
export function qrSvg(text, { dark = '#0c0d10', light = '#ffffff', quiet = 3 } = {}) {
  const M = qrMatrix(text);
  const n = M.length, full = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (M[r][c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg viewBox="0 0 ${full} ${full}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">` +
    `<rect width="${full}" height="${full}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
