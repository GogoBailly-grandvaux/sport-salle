// sync-config.js — configuration du backend de synchro.
// 'auto'  : l'app cherche son API sur le même domaine (api/sync.php) et
//           n'affiche la synchro que si elle répond. Aucun réglage à faire :
//           sur l'hébergement o2switch la carte apparaît, ailleurs elle reste cachée.
// URL absolue ('https://…/api/sync.php') : force un backend précis.
// ''      : synchro désactivée partout.
export const SYNC_URL = 'auto';
