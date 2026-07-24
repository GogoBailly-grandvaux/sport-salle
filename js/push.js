// push.js — abonnement aux notifications push (Web Push).
// Sur iPhone : nécessite l'app installée sur l'écran d'accueil (iOS 16.4+).
import { call } from './api.js';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// iOS ne permet le push QUE si l'app est installée (mode standalone)
export function iosNeedsInstall() {
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  return iOS && !standalone;
}

export async function pushState() {
  if (!pushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    subscribed = !!(await reg.pushManager.getSubscription());
  } catch {}
  return { supported: true, permission: Notification.permission, subscribed };
}

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
const bufToB64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Demande la permission puis abonne l'appareil. Retourne {ok} ou {error}. */
export async function enablePush() {
  if (!pushSupported()) return { error: 'non supporté sur cet appareil' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { error: perm === 'denied' ? 'permission refusée' : 'permission non accordée' };
  try {
    const { key } = await call('push', 'key');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
    }
    const j = sub.toJSON();
    await call('push', 'subscribe', { endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
    return { ok: true };
  } catch (e) {
    return { error: e.message || 'échec de l’abonnement' };
  }
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await call('push', 'unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    return { ok: true };
  } catch (e) { return { error: e.message }; }
}
