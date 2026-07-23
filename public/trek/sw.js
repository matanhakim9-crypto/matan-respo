const CACHE_NAME = 'trek-planner-v2';
const APP_SHELL = [
  '/trek/',
  '/trek/style.css',
  '/trek/app.js',
  '/trek/manifest.json',
  '/trek/icons/icon-192.png',
  '/trek/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API calls: trek suggestions should always be fresh.
  if (url.pathname.startsWith('/api/')) return;

  // Network-first: always serve the latest deployed app when online, so a
  // redeploy shows up immediately instead of waiting for a second reload.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
