// Telos Service Worker — network-first for local iteration
const CACHE = 'telos-v2-dev';
const STATIC = [
  '/',
  '/index.html',
  '/viz.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://d3js.org/d3.v7.min.js',
];
const DATA_URLS = ['/telos-data.json', '/api/tree'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network-first for everything to ensure aggressive updating during iteration
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && e.request.url.startsWith('http')) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
