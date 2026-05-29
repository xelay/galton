// Service Worker for Triangle Quincunx PWA
// Caches all static assets for offline use

const CACHE_NAME = 'quincunx-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Install: cache all assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache what we can, ignore failures for missing icons
      return Promise.allSettled(ASSETS.map(url => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first strategy
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
