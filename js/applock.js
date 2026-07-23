// applock.js — verrouillage de l'app par empreinte / biométrie (WebAuthn local).
// Sert de verrou d'accès sur CET appareil (le capteur du téléphone valide),
// indépendant du compte : les données restent chiffrées par l'OS.
import { icon, toast, sheet } from './ui.js';
import { state, saveGlobal } from './store.js';

const supported = () =>
  !!(window.PublicKeyCredential && navigator.credentials?.create) && isSecureContext;

export const isLockEnabled = () => !!state.global?.appLock?.credId;

function b64ToBuf(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function enableLock() {
  if (!supported()) { toast('Biométrie non disponible sur cet appareil/navigateur', { type: 'error' }); return false; }
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Sport Salle', id: location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'sport-salle', displayName: 'Sport Salle' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
      },
    });
    await saveGlobal({ appLock: { credId: bufToB64(cred.rawId) } });
    toast('Verrouillage par empreinte activé 🔒');
    return true;
  } catch (e) {
    if (e?.name !== 'NotAllowedError') toast('Activation impossible : ' + (e?.message || e), { type: 'error' });
    return false;
  }
}

export async function disableLock() {
  await saveGlobal({ appLock: null });
  toast('Verrouillage désactivé');
}

/** À l'ouverture : demande l'empreinte. Résout true si déverrouillé (ou verrou inactif). */
export async function gate() {
  if (!isLockEnabled() || !supported()) return true;
  const overlay = document.createElement('div');
  overlay.className = 'lock-overlay';
  overlay.innerHTML = `<div class="lock-box">${icon('finger')}<h2>Sport Salle</h2><p>Déverrouille avec ton empreinte</p><button class="btn primary" id="lock-try">Déverrouiller</button></div>`;
  document.body.appendChild(overlay);
  const attempt = async () => {
    try {
      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: 'public-key', id: b64ToBuf(state.global.appLock.credId), transports: ['internal'] }],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      overlay.remove();
      return true;
    } catch { return false; }
  };
  if (await attempt()) return true;
  return new Promise(resolve => {
    overlay.querySelector('#lock-try').onclick = async () => { if (await attempt()) resolve(true); };
  });
}

export function appLockCardHtml() {
  if (!supported()) return '';
  return `<section class="card">
    <div class="setting"><span>${icon('finger')} Verrouillage par empreinte</span>
      <button class="switch ${isLockEnabled() ? 'on' : ''}" id="lock-toggle" role="switch" aria-checked="${isLockEnabled()}"><span></span></button>
    </div>
    <p class="mut sm" style="margin:4px 0 0">Demande ton empreinte (ou le déverrouillage du téléphone) à chaque ouverture de l’app.</p>
  </section>`;
}

export function mountAppLockCard(root) {
  const t = root.querySelector('#lock-toggle');
  if (!t) return;
  t.onclick = async () => {
    if (isLockEnabled()) { await disableLock(); } else { await enableLock(); }
    t.classList.toggle('on', isLockEnabled());
    t.setAttribute('aria-checked', String(isLockEnabled()));
  };
}
