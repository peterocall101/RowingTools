/* RowingTools service worker.
 * Network-first so results and benchmark data stay fresh; falls back to the
 * last-seen cached copy when offline. Bump CACHE on breaking asset changes. */
const CACHE = 'rowingtools-v2';
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

  // The tracker reads a signed-in athlete's training log from Supabase over
  // GET, and those responses must never land in a cache that outlives the
  // session or is shared with whoever next uses the device. Data fetches have
  // an empty request destination, so cache same-origin plus cross-origin
  // subresources (the Supabase client script, fonts) and nothing else - the
  // tracker cannot start without that script, so skipping it would mean the
  // app never opens offline.
  const sameOrigin = new URL(request.url).origin === self.location.origin;
  if (!sameOrigin && !request.destination) return;

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
