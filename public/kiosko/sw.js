// Kiosko SW — scope "/" (requires Service-Worker-Allowed: / header from server)
// Scope amplio para poder interceptar /api/menu desde el kiosko.
// Solo actúa en rutas /kiosko/* y /api/menu; todo lo demás pasa al network.

const CACHE = 'kiosk-v1';
const MENU_CACHE = 'kiosk-menu-v1';

const SHELL = [
  '/kiosko/',
  '/kiosko/index.html',
  '/kiosko/style.css',
  '/kiosko/app.js',
  '/kiosko/manifest.json',
  '/kiosko/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE && k !== MENU_CACHE).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Menu API: network first, cache fallback para soporte offline del kiosko
  if (url.pathname === '/api/menu') {
    e.respondWith(
      caches.open(MENU_CACHE).then(cache =>
        fetch(e.request)
          .then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => cache.match(e.request))
      )
    );
    return;
  }

  // Solo gestionar rutas del kiosko; el resto va directo a network
  if (!url.pathname.startsWith('/kiosko/')) return;

  // Shell del kiosko: cache first, actualiza en background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
      return cached || network;
    })
  );
});
