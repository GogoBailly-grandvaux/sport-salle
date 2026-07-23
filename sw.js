// sw.js — offline-first service worker (GitHub Pages subpath safe: all relative)
const VERSION = 'v2.9.0';
const SHELL = 'shell-' + VERSION;
const IMG = 'exercise-images';

const ASSETS = [
  './', './index.html', './offline.html', './legal.html', './app.webmanifest',
  './css/app.css',
  './js/app.js', './js/util.js', './js/version.js', './js/i18n.js', './js/db.js', './js/store.js', './js/data.js',
  './js/model.js', './js/analytics.js', './js/charts.js', './js/ui.js', './js/templates.js',
  './js/sync.js', './js/live.js', './js/sync-merge.js', './js/sync-config.js',
  './js/api.js', './js/coach.js', './js/applock.js', './js/generator.js', './js/voice.js',
  './js/screens/social.js', './js/screens/account.js', './js/screens/coach-gen.js',
  './js/screens/common.js', './js/screens/picker.js', './js/screens/home.js',
  './js/screens/library.js', './js/screens/routines.js', './js/screens/workout.js',
  './js/screens/history.js', './js/screens/progress.js', './js/screens/profile.js',
  './data/exercises.json?v=3', './data/muscles-map.json?v=3',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png',
  './icons/apple-touch-icon.png', './icons/maskable-192.png', './icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // cache:'no-cache' → contourne le cache HTTP (GitHub Pages max-age=600) à l'installation
    await Promise.allSettled(ASSETS.map(u => c.add(new Request(u, { cache: 'no-cache' }))));
    // pas de skipWaiting() ici : une mise à jour n'est appliquée que quand
    // l'utilisateur touche « Recharger » (message 'skipWaiting' ci-dessous)
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== IMG).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// borne le cache d'images (sinon il grossit sans limite → risque de quota)
let _trimming = false;
async function trimImages(cache) {
  if (_trimming) return; _trimming = true;
  try {
    const keys = await cache.keys();
    const excess = keys.length - 600;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]); // FIFO approximatif
  } catch {} finally { _trimming = false; }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigations -> network first, fallback to cached shell / offline
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { return await fetch(req); }
      catch {
        const c = await caches.open(SHELL);
        return (await c.match('./index.html')) || (await c.match('./')) || (await c.match('./offline.html')) || Response.error();
      }
    })());
    return;
  }

  // Images d'exercices (CDN) + médias wger (silhouettes/overlays SVG, images) -> stale-while-revalidate
  const isWgerMedia = url.hostname.endsWith('wger.de') && (req.destination === 'image' || url.pathname.endsWith('.svg'));
  if (url.hostname.includes('jsdelivr.net') || url.hostname.includes('githubusercontent.com') || isWgerMedia) {
    e.respondWith((async () => {
      const c = await caches.open(IMG);
      const cached = await c.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) { c.put(req, r.clone()); trimImages(c); } return r; }).catch(() => null);
      return cached || (await net) || Response.error();
    })());
    return;
  }

  // Same-origin -> cache first
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const r = await fetch(req);
        if (r && r.ok) { const c = await caches.open(SHELL); c.put(req, r.clone()); }
        return r;
      } catch { return Response.error(); }
    })());
  }
});
