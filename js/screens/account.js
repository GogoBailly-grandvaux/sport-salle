// screens/account.js — inscription / connexion (compte lié au profil actif)
import { esc } from '../util.js';
import { activeProfile, savePSettings, ps, emit, on, nav } from '../store.js';
import { sheet, toast, icon, confirmDialog } from '../ui.js';
import { call, isLoggedIn, account } from '../api.js';
import * as sync from '../sync.js';

let wired = false;
export function wireAuthEvents() {
  if (wired) return; wired = true;
  on('auth-expired', async () => {
    if (ps('account')) {
      await savePSettings({ account: null });
      toast('Session expirée — reconnecte-toi', { type: 'error', duration: 5000 });
      emit('account-changed');
    }
  });
}

async function applySession(res) {
  await savePSettings({ account: { token: res.token, user: res.user } });
  emit('account-changed');
  sync.syncNow(); // première synchro du compte (envoie les données locales)
}

// ---- Google Sign-In (activé si google_client_id est configuré côté serveur) ----
let _googleClientId = null; // null = pas encore demandé, '' = non configuré
async function googleClientId() {
  if (_googleClientId !== null) return _googleClientId;
  try { _googleClientId = (await call('auth', 'config', {}, { auth: false }))?.googleClientId || ''; }
  catch { _googleClientId = ''; }
  return _googleClientId;
}
function loadGsi() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true; sc.onload = () => resolve(); sc.onerror = () => reject(new Error('script Google indisponible'));
    document.head.appendChild(sc);
  });
}
async function mountGoogleButton(container, onDone, closeSheet) {
  const cid = await googleClientId();
  if (!cid || !container) return;
  try {
    await loadGsi();
    container.innerHTML = '<div class="gsi-sep"><span>ou</span></div><div id="gsi-btn"></div>';
    window.google.accounts.id.initialize({
      client_id: cid,
      callback: async (resp) => {
        try {
          const res = await call('auth', 'google', { idToken: resp.credential }, { auth: false });
          await applySession(res);
          closeSheet();
          toast(`Bienvenue @${res.user.username} ! 🎉`);
          if (onDone) onDone(res);
        } catch (e) { toast(e.message, { type: 'error', duration: 4500 }); }
      },
    });
    window.google.accounts.id.renderButton(container.querySelector('#gsi-btn'), {
      theme: 'outline', size: 'large', width: 280, text: 'continue_with', locale: 'fr',
    });
  } catch { /* bouton Google indisponible : le formulaire classique reste */ }
}

export function openAuthSheet(mode = 'register', onDone = null) {
  const p = activeProfile();
  const isReg = mode === 'register';
  const s = sheet(`
    <div class="segmented sm auth-swap">
      <button class="seg ${isReg ? 'on' : ''}" data-m="register">Créer un compte</button>
      <button class="seg ${!isReg ? 'on' : ''}" data-m="login">Se connecter</button>
    </div>
    <form id="auth-form" autocomplete="on">
      <label class="field-label">Pseudo (unique, sans espace)</label>
      <div class="input-ico"><span class="at">@</span><input class="input at-input" id="au-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="hugo_b" minlength="3" maxlength="20" required></div>
      ${isReg ? `<label class="field-label">Prénom affiché</label>
      <input class="input" id="au-name" value="${esc(p?.name || '')}" maxlength="40" required>` : ''}
      <label class="field-label">Mot de passe ${isReg ? '(8 caractères minimum)' : ''}</label>
      <input class="input" id="au-pass" name="password" type="password" autocomplete="${isReg ? 'new-password' : 'current-password'}" minlength="8" required>
      <button class="btn primary full big" id="au-go" type="submit">${isReg ? 'Créer mon compte' : 'Se connecter'}</button>
      <p class="mut sm center" style="margin-top:10px">${isReg
        ? 'Ton compte permet de retrouver tes données sur n’importe quel téléphone, d’ajouter des amis et de partager tes programmes.'
        : 'Tes données locales seront fusionnées avec celles de ton compte.'}</p>
    </form>
    <div id="gsi-host"></div>`,
    { title: isReg ? 'Créer un compte' : 'Connexion' });

  mountGoogleButton(s.root.querySelector('#gsi-host'), onDone, () => s.close());

  s.root.querySelectorAll('[data-m]').forEach(b => b.onclick = (e) => {
    e.preventDefault(); s.close(); openAuthSheet(b.dataset.m, onDone);
  });

  s.root.querySelector('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = s.root.querySelector('#au-go');
    btn.disabled = true; btn.textContent = '…';
    const username = s.root.querySelector('#au-user').value.trim().toLowerCase();
    const password = s.root.querySelector('#au-pass').value;
    try {
      let res;
      if (isReg) {
        const displayName = s.root.querySelector('#au-name').value.trim() || username;
        res = await call('auth', 'register', {
          username, password, displayName,
          emoji: p?.emoji || null, accent: p?.accent || 'ember',
        }, { auth: false });
      } else {
        res = await call('auth', 'login', { username, password }, { auth: false });
      }
      await applySession(res);
      s.close();
      toast(isReg ? `Bienvenue @${res.user.username} ! 🎉` : `Content de te revoir @${res.user.username} 💪`);
      if (onDone) onDone(res);
    } catch (err) {
      toast(err.message, { type: 'error', duration: 4500 });
      btn.disabled = false; btn.textContent = isReg ? 'Créer mon compte' : 'Se connecter';
    }
  };
}

export async function logout() {
  const acc = account();
  if (!acc) return;
  if (!await confirmDialog({
    title: 'Se déconnecter',
    message: 'Tes données restent sur ce téléphone et sur ton compte. Tu pourras te reconnecter quand tu veux.',
    confirmText: 'Se déconnecter',
  })) return;
  try { await call('auth', 'logout', {}); } catch {}
  await savePSettings({ account: null });
  emit('account-changed');
  toast('Déconnecté');
  nav.refresh();
}

export function accountCardHtml() {
  const acc = account();
  if (!acc) {
    return `<section class="card account-card">
      <h3 class="card-t">${icon('user')} Compte</h3>
      <p class="mut sm">Crée ton compte gratuit : données sauvegardées en ligne, amis, groupes et partage de programmes.</p>
      <button class="btn primary full" id="acc-register">Créer un compte</button>
      <button class="btn ghost full" id="acc-login">J’ai déjà un compte</button>
    </section>`;
  }
  return `<section class="card account-card">
    <h3 class="card-t">${icon('user')} Compte</h3>
    <div class="acc-row"><b>@${esc(acc.user.username)}</b><span class="mut sm">${esc(acc.user.displayName)}</span></div>
    <p class="mut sm">Données synchronisées sur ce compte · amis et groupes dans l’onglet Social.</p>
    <button class="btn ghost full" id="acc-logout">Se déconnecter</button>
  </section>`;
}

export function mountAccountCard(root) {
  root.querySelector('#acc-register')?.addEventListener('click', () => openAuthSheet('register', () => nav.refresh()));
  root.querySelector('#acc-login')?.addEventListener('click', () => openAuthSheet('login', () => nav.refresh()));
  root.querySelector('#acc-logout')?.addEventListener('click', logout);
}
