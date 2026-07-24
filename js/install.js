// install.js — installation (écran d'accueil) + notifications, proposées AUTOMATIQUEMENT.
// iPhone : Apple n'offre aucun prompt natif → guide pas-à-pas maison ; et le push iOS
// n'existe QUE dans l'app installée (iOS 16.4+) → l'ordre est : installer, puis notifier.
// Android : vrai prompt natif via beforeinstallprompt (déjà capturé dans app.js).
import { sheet, toast } from './ui.js';
import { t } from './i18n.js';
import { isLoggedIn } from './api.js';
import { pushSupported, iosNeedsInstall, pushState, enablePush } from './push.js';

const IOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;

const snoozed = (k) => (+localStorage.getItem(k) || 0) > Date.now();
const snooze  = (k, days) => localStorage.setItem(k, String(Date.now() + days * 864e5));

let shownThisLaunch = false; // max un prompt par lancement — jamais de harcèlement

// Icônes du guide iOS : « Partager » (carré + flèche) et « Sur l'écran d'accueil » (carré +)
const shareIco = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 6.5L12 3l4 3.5"/><path d="M6 10H5a1 1 0 00-1 1v9a1 1 0 001 1h14a1 1 0 001-1v-9a1 1 0 00-1-1h-1"/></svg>`;
const plusSq  = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>`;

// Guide d'installation iPhone (pas-à-pas, faute de prompt natif)
export function openIosInstallSheet() {
  let acted = false;
  const s = sheet(`
    <div class="a2hs">
      <p class="mut sm">${t('Installe Sport Salle comme une vraie app : plein écran, hors-ligne — et c’est obligatoire pour recevoir les notifications sur iPhone.','Install Sport Salle like a real app: full screen, offline — and it’s required to get notifications on iPhone.')}</p>
      <ol class="a2hs-steps">
        <li><span class="a2hs-ico">${shareIco}</span><span>${t('Appuie sur','Tap')} <b>${t('Partager','Share')}</b> ${t('dans la barre de Safari','in the Safari bar')}</span></li>
        <li><span class="a2hs-ico">${plusSq}</span><span>${t('Choisis','Choose')} <b>« ${t('Sur l’écran d’accueil','Add to Home Screen')} »</b></span></li>
        <li><span class="a2hs-ico a2hs-fist">👊</span><span>${t('Ouvre l’app depuis ton écran d’accueil','Open the app from your home screen')}</span></li>
      </ol>
      <button class="btn primary full" data-a="go">${t('C’est parti 👊','Let’s go 👊')}</button>
      <button class="btn ghost full" data-a="never">${t('Ne plus me le proposer','Don’t ask again')}</button>
    </div>
  `, { title: t('📲 Installe l’application','📲 Install the app'), onClose: () => { if (!acted) snooze('ss-a2hs-snooze', 3); } });
  s.root.querySelector('[data-a="go"]').onclick = () => { acted = true; snooze('ss-a2hs-snooze', 3); s.close(); };
  s.root.querySelector('[data-a="never"]').onclick = () => { acted = true; localStorage.setItem('ss-a2hs-never', '1'); s.close(); };
}

// Android : le vrai prompt natif, mis en avant au lieu d'attendre au fond du Profil
export function openAndroidInstallSheet() {
  let acted = false;
  const s = sheet(`
    <div class="a2hs">
      <p class="mut sm">${t('Ajoute Sport Salle à ton écran d’accueil : plein écran, hors-ligne, accès en un geste.','Add Sport Salle to your home screen: full screen, offline, one-tap access.')}</p>
      <button class="btn primary full" data-a="install">${t('Installer','Install')}</button>
      <button class="btn ghost full" data-a="later">${t('Plus tard','Later')}</button>
    </div>
  `, { title: t('📲 Installe l’application','📲 Install the app'), onClose: () => { if (!acted) snooze('ss-a2hs-snooze', 3); } });
  s.root.querySelector('[data-a="install"]').onclick = async () => {
    acted = true;
    const dp = window.__deferredInstall; window.__deferredInstall = null; // usage unique
    s.close();
    if (!dp) return;
    dp.prompt();
    try {
      const { outcome } = await dp.userChoice;
      if (outcome === 'accepted') toast(t('Installation lancée 🎉','Installing 🎉'));
      else snooze('ss-a2hs-snooze', 7);
    } catch {}
  };
  s.root.querySelector('[data-a="later"]').onclick = () => { acted = true; snooze('ss-a2hs-snooze', 3); s.close(); };
}

// Proposition d'activer les notifications (là où le push est possible)
export function openPushSheet() {
  let acted = false;
  const s = sheet(`
    <div class="a2hs">
      <p class="mut sm">${t('Demandes d’amis, défis, réactions, réponses — sois prévenu même quand l’app est fermée.','Friend requests, challenges, reactions, replies — get notified even when the app is closed.')}</p>
      <button class="btn primary full" data-a="on">${t('Activer les notifications','Enable notifications')}</button>
      <button class="btn ghost full" data-a="later">${t('Plus tard','Later')}</button>
    </div>
  `, { title: t('🔔 Ne rate rien','🔔 Never miss a thing'), onClose: () => { if (!acted) snooze('ss-push-snooze', 7); } });
  s.root.querySelector('[data-a="on"]').onclick = async (e) => {
    acted = true;
    const b = e.currentTarget; b.disabled = true; b.textContent = t('Activation…','Enabling…');
    const r = await enablePush(); // geste utilisateur → permission OK
    s.close();
    if (r.ok) toast(t('Notifications activées 🔔','Notifications enabled 🔔'));
    else {
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') localStorage.setItem('ss-push-never', '1');
      toast(r.error || t('Impossible d’activer','Couldn’t enable'), { type: 'error' });
    }
  };
  s.root.querySelector('[data-a="later"]').onclick = () => { acted = true; snooze('ss-push-snooze', 7); s.close(); };
}

// Cerveau : appelé au boot et à l'arrivée sur l'accueil. Un seul prompt par lancement,
// jamais pendant une séance, jamais par-dessus une sheet, snooze respecté.
export async function maybeOnboard() {
  if (shownThisLaunch) return;
  if (!isLoggedIn()) return;
  const h = location.hash || '#/home';
  if (h !== '#/home' && h !== '#/' && h !== '') return;
  const bc = document.body.classList;
  if (bc.contains('workout-mode') || bc.contains('welcome-mode') || bc.contains('immersive')) return;
  if (document.querySelector('.sheet-back')) return;

  // 1) Installation d'abord (sur iPhone, le push en dépend)
  if (!standalone() && !localStorage.getItem('ss-a2hs-never') && !snoozed('ss-a2hs-snooze')) {
    if (IOS) { shownThisLaunch = true; openIosInstallSheet(); return; }
    if (window.__deferredInstall) { shownThisLaunch = true; openAndroidInstallSheet(); return; }
  }

  // 2) Notifications ensuite (navigateur Android OK ; iOS seulement une fois installée)
  if (!pushSupported() || iosNeedsInstall()) return;
  if (localStorage.getItem('ss-push-never') || snoozed('ss-push-snooze')) return;
  if (Notification.permission !== 'default') return; // déjà accordée ou refusée
  const st = await pushState();
  if (st.subscribed) return;
  shownThisLaunch = true;
  openPushSheet();
}
