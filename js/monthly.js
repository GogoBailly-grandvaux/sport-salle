// monthly.js — défis mensuels officiels (inspirés de Lyfta, calcul 100 % local).
// Trois défis par mois, calculés depuis les séances terminées du mois en cours.
// Badge gagné = persisté dans ps('monthlyBadges') sous la clé YYYY-MM.
import { t } from './i18n.js';

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MONTH_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const MONTH_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export function monthLabel(d = new Date()) {
  return t(MONTH_FR[d.getMonth()], MONTH_EN[d.getMonth()]);
}

/** Les 3 défis du mois + progression, depuis les séances terminées. */
export function monthlyChallenges(workouts, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  const from = new Date(y, m, 1).getTime();
  const to = new Date(y, m + 1, 1).getTime();
  let volume = 0, count = 0, bestSession = 0;
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    const ts = w.completedAt || w.startedAt;
    if (!ts || ts < from || ts >= to) continue;
    count++;
    const v = w.totalVolumeKg || 0;
    volume += v;
    bestSession = Math.max(bestSession, v);
  }
  const mk = (id, icon, title, desc, cur, target, fmt) => ({
    id, icon, title, desc, cur: Math.min(cur, target), target,
    pct: Math.max(0, Math.min(100, Math.round(cur / target * 100))),
    done: cur >= target,
    label: `${fmt(Math.min(cur, target))} / ${fmt(target)}`,
  });
  const kg = (v) => `${Math.round(v).toLocaleString('fr-FR')} kg`;
  return [
    mk('mvol', 'scale', t('Défi volume','Volume challenge'),
       t('Soulève 50 000 kg dans le mois','Lift 50,000 kg this month'), volume, 50000, kg),
    mk('mcount', 'flame', t('Défi assiduité','Consistency challenge'),
       t('12 séances dans le mois','12 workouts this month'), count, 12, (v) => `${Math.round(v)}`),
    mk('msession', 'trophy', t('Défi grosse séance','Big session challenge'),
       t('5 000 kg en une seule séance','5,000 kg in a single workout'), bestSession, 5000, kg),
  ];
}

/** Badges déjà gagnés ce mois-ci (depuis les réglages du profil). */
export function wonThisMonth(psGet) {
  const all = psGet('monthlyBadges') || {};
  return all[monthKey()] || [];
}

/** Nouveaux défis accomplis (pas encore célébrés). */
export function newlyWon(challenges, psGet) {
  const won = new Set(wonThisMonth(psGet));
  return challenges.filter(c => c.done && !won.has(c.id));
}
