// i18n.js — bilinguisme FR/EN, volontairement minimal.
// t('texte français', 'english text') : le français est la langue source
// (lisible directement dans le code), l'anglais vit à côté. La langue vient
// du réglage utilisateur, sinon de celle du navigateur.
import { state } from './store.js';

let _cached = null;

export function locale() {
  if (_cached) return _cached;
  const pref = state.global?.locale; // 'fr' | 'en' | undefined = auto
  if (pref === 'fr' || pref === 'en') return (_cached = pref);
  const nav = (navigator.language || 'fr').toLowerCase();
  return (_cached = nav.startsWith('fr') ? 'fr' : 'en');
}

// à appeler après un changement de réglage (l'app se recharge ensuite)
export const resetLocale = () => { _cached = null; };

export const t = (fr, en) => (locale() === 'en' ? en : fr);
