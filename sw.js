// sw.js — service worker para PWA
// Estratégia: network-first (sempre busca versão nova, cache é fallback offline)

const CACHE_NAME = 'sonia-reis-crm-v37';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/config.js',
  '/db.js',
  '/app.js',
  '/auth.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('supabase.co')) return;

  // Network-first: tenta rede, se falhar usa cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
