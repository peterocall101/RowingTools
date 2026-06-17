/* RowingTools service worker.
 * Network-first so results and benchmark data stay fresh; falls back to the
 * last-seen cached copy when offline. Bump CACHE on breaking asset changes. */
const CACHE = 'rowingtools-v1';
const OFFLINE_FALLBACK = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(OFFLINE_FALLBACK))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) => cached || caches.match(OFFLINE_FALLBACK)
        )
      )
  );
});
