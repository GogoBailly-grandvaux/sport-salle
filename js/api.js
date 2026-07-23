// api.js — client HTTP des endpoints v2 (auth par jeton du profil actif)
import { state, ps, emit } from './store.js';

const BASE = new URL('api/', document.baseURI).toString();

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function call(endpoint, action, payload = {}, { auth = true, keepalive = false, token = null } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) {
    const tok = token || ps('account')?.token;
    if (!tok) throw new ApiError(401, 'non connecté');
    headers.authorization = 'Bearer ' + tok;
  }
  let r;
  try {
    r = await fetch(BASE + endpoint + '.php', {
      method: 'POST', headers, body: JSON.stringify({ action, ...payload }), keepalive,
    });
  } catch {
    throw new ApiError(0, 'hors-ligne ou serveur injoignable');
  }
  const t = await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch {}
  if (!r.ok) {
    if (r.status === 401 && auth) emit('auth-expired', { token: token || ps('account')?.token });
    throw new ApiError(r.status, d?.error || ('erreur HTTP ' + r.status));
  }
  return d;
}

export const isLoggedIn = () => !!ps('account')?.token;
export const account = () => ps('account') || null;
