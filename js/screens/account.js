// screens/account.js — inscription / connexion (compte lié au profil actif)
import { esc } from '../util.js';
import { activeProfile, savePSettings, ps, emit, on, nav, createProfile, setActiveProfile, updateProfile, state } from '../store.js';
import { sheet, toast, icon, confirmDialog } from '../ui.js';
import { call, isLoggedIn, account } from '../api.js';
import * as sync from '../sync.js';

const LAST_USER_KEY = 'sportsalle-last-username';
const lastUsername = () => { try { return localStorage.getItem(LAST_USER_KEY) || ''; } catch { return ''; } };

let wired = false;
export function wireAuthEvents() {
  if (wired) return; wired = true;
  on('auth-expired', async () => {
    if (ps('account')) {
      await savePSettings({ account: null });
      emit('account-changed');
      toast('Ta session a expiré', {
        type: 'error', duration: 8000, actionText: 'Se reconnecter',
        onAction: () => openAuthSheet('login', () => nav.refresh()),
      });
      // on ne rafraîchit jamais en pleine séance (ne pas casser la saisie)
      if (nav.current !== 'workout' && nav.current !== 'summary') nav.refresh();
    }
  });
}

async function applySession(res) {
  // premier lancement sans profil local : on le crée depuis le compte
  if (!activeProfile()) {
    const p = await createProfile({
      name: res.user.displayName || res.user.username,
      accent: res.user.accent || 'ember',
      emoji: res.user.emoji || null,
    });
    await setActiveProfile(p.id);
  }
  await savePSettings({ account: { token: res.token, user: res.user } });
  try { localStorage.setItem(LAST_USER_KEY, res.user.username); } catch {}
  emit('account-changed');
  sync.syncNow(); // première synchro du compte (fusionne local + serveur)
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
export async function mountGoogleButton(container, onDone, closeSheet, { sep = 'before' } = {}) {
  const cid = await googleClientId();
  if (!cid || !container) return;
  try {
    await loadGsi();
    const sepHtml = '<div class="gsi-sep"><span>ou</span></div>';
    container.innerHTML = sep === 'after' ? `<div id="gsi-btn"></div>${sepHtml}` : `${sepHtml}<div id="gsi-btn"></div>`;
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

// ---- erreurs inline sous les champs ----
const USER_RX = /^[a-z0-9_.]{3,20}$/;
function anchorOf(input) { return input.closest('.input-ico, .pw-wrap') || input; }
function clearFieldError(input) {
  input.classList.remove('invalid');
  const a = anchorOf(input);
  if (a.nextElementSibling?.classList?.contains('field-err')) a.nextElementSibling.remove();
}
function fieldError(input, msg) {
  clearFieldError(input);
  input.classList.add('invalid');
  const err = document.createElement('p');
  err.className = 'field-err';
  err.textContent = msg;
  anchorOf(input).insertAdjacentElement('afterend', err);
  input.addEventListener('input', () => clearFieldError(input), { once: true });
  input.focus();
}

export function openAuthSheet(mode = 'register', onDone = null) {
  const p = activeProfile();
  let m = mode;
  const s = sheet(`<div id="auth-wrap"></div><div id="gsi-host"></div>`,
    { title: m === 'register' ? 'Créer un compte' : 'Connexion' });
  const wrap = s.root.querySelector('#auth-wrap');
  const setTitle = (t) => { const h = s.root.querySelector('.sheet-head h3'); if (h) h.textContent = t; };

  const formHtml = (isReg) => `
    <div class="segmented sm auth-swap">
      <button class="seg ${isReg ? 'on' : ''}" type="button" data-m="register">Créer un compte</button>
      <button class="seg ${!isReg ? 'on' : ''}" type="button" data-m="login">Se connecter</button>
    </div>
    <form id="auth-form" autocomplete="on" novalidate>
      <label class="field-label" for="au-user">Pseudo${isReg ? ' (unique, sans espace)' : ''}</label>
      <div class="input-ico"><span class="at">@</span><input class="input at-input" id="au-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="hugo_b" maxlength="20" required></div>
      ${isReg ? `<label class="field-label" for="au-name">Prénom affiché</label>
      <input class="input" id="au-name" value="${esc(p?.name || '')}" maxlength="40">` : ''}
      <label class="field-label" for="au-pass">Mot de passe${isReg ? ' (8 caractères minimum)' : ''}</label>
      <div class="pw-wrap">
        <input class="input" id="au-pass" name="password" type="password" autocomplete="${isReg ? 'new-password' : 'current-password'}" required>
        <button type="button" class="pw-eye" aria-label="Afficher le mot de passe" aria-pressed="false">${icon('eye')}</button>
      </div>
      <button class="btn primary full big" id="au-go" type="submit">${isReg ? 'Créer mon compte' : 'Se connecter'}</button>
      <p class="mut sm center auth-hint">${isReg
        ? 'Ton compte permet de retrouver tes données sur n’importe quel téléphone, d’ajouter des amis et de partager tes programmes.'
        : 'Tes données locales seront fusionnées avec celles de ton compte.'}</p>
    </form>`;

  const renderForm = (focusNow) => {
    const isReg = m === 'register';
    setTitle(isReg ? 'Créer un compte' : 'Connexion');
    wrap.innerHTML = formHtml(isReg);

    const userInp = wrap.querySelector('#au-user');
    const passInp = wrap.querySelector('#au-pass');

    // bascule inscription ↔ connexion sans fermer le sheet
    wrap.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
      if (b.dataset.m === m) return;
      m = b.dataset.m; renderForm(true);
    });

    // œil : afficher / masquer le mot de passe
    const eye = wrap.querySelector('.pw-eye');
    eye.onclick = () => {
      const show = passInp.type === 'password';
      passInp.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(show));
      eye.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      eye.innerHTML = icon(show ? 'eyeoff' : 'eye');
      passInp.focus();
    };

    // connexion : pré-remplit le dernier pseudo utilisé
    if (!isReg) {
      const last = lastUsername();
      if (last) userInp.value = last;
    }
    const target = (!isReg && userInp.value) ? passInp : userInp;
    setTimeout(() => target.focus(), focusNow ? 0 : 300); // après l'animation d'ouverture

    wrap.querySelector('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const username = userInp.value.trim().toLowerCase();
      const password = passInp.value;

      // validation locale, en français et sous le bon champ
      if (!USER_RX.test(username)) {
        fieldError(userInp, username.length < 3
          ? 'Au moins 3 caractères.'
          : 'Lettres minuscules, chiffres, « _ » et « . » uniquement (3 à 20).');
        return;
      }
      if (!password) { fieldError(passInp, 'Ton mot de passe.'); return; }
      if (isReg && password.length < 8) { fieldError(passInp, '8 caractères minimum.'); return; }

      const btn = wrap.querySelector('#au-go');
      const label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" aria-label="Chargement"></span>';
      try {
        let res;
        if (isReg) {
          const displayName = (wrap.querySelector('#au-name')?.value || '').trim() || username;
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
        btn.disabled = false; btn.innerHTML = label;
        const form = wrap.querySelector('#auth-form');
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
        if (err.status === 409) fieldError(userInp, 'Ce pseudo est déjà pris.');
        else if (err.status === 401) { fieldError(passInp, 'Pseudo ou mot de passe incorrect.'); passInp.select?.(); }
        else toast(err.status === 0 ? 'Hors-ligne ou serveur injoignable' : err.message, { type: 'error', duration: 4500 });
      }
    };
  };

  renderForm(false);
  mountGoogleButton(s.root.querySelector('#gsi-host'), onDone, () => s.close());
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
  // compte obligatoire : retour à l'écran de connexion
  setTimeout(() => { location.hash = ''; location.reload(); }, 600);
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
    <button class="btn danger-ghost full sm" id="acc-delete">Supprimer définitivement mon compte</button>
  </section>`;
}

async function deleteAccount() {
  const { promptDialog } = await import('../ui.js');
  if (!await confirmDialog({
    title: 'Supprimer le compte',
    message: 'Toutes tes données en ligne (séances, amis, groupes, partages) seront définitivement effacées. Les données locales de ce téléphone sont conservées.',
    confirmText: 'Continuer', danger: true,
  })) return;
  const password = await promptDialog({ title: 'Confirme avec ton mot de passe', label: 'Mot de passe', type: 'password', confirmText: 'Supprimer' });
  if (password == null) return;
  try {
    await call('auth', 'delete', { password });
    await savePSettings({ account: null });
    emit('account-changed');
    toast('Compte supprimé. Tes données locales restent sur ce téléphone.');
    setTimeout(() => { location.hash = ''; location.reload(); }, 1500);
  } catch (e) { toast(e.message, { type: 'error' }); }
}

export function mountAccountCard(root) {
  root.querySelector('#acc-register')?.addEventListener('click', () => openAuthSheet('register', () => nav.refresh()));
  root.querySelector('#acc-login')?.addEventListener('click', () => openAuthSheet('login', () => nav.refresh()));
  root.querySelector('#acc-logout')?.addEventListener('click', logout);
  root.querySelector('#acc-delete')?.addEventListener('click', deleteAccount);
}
