/* Qooentum — Service Worker v4 */
const CACHE_NAME = 'qooentum-v4';

/* No precacheamos nada — el HTML va siempre a la red (network-first),
   los assets se cachean on-demand al primer acceso. */
const PRECACHE_URLS = [];

const NEVER_CACHE_DOMAINS = [
  'api.geoapify.com',
  'googleapis.com',
  'accounts.google.com',
  'script.google.com',
];

function shouldNeverCache(url) {
  return NEVER_CACHE_DOMAINS.some((d) => url.hostname.includes(d));
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* 1. APIs externas → siempre red, nunca caché */
  if (shouldNeverCache(url)) {
    event.respondWith(fetch(req));
    return;
  }

  /* 2. HTML de mismo origen → siempre red primero */
  if (
    req.mode === 'navigate' ||
    (url.origin === self.location.origin &&
      req.headers.get('accept')?.includes('text/html'))
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  /* 3. Assets estáticos → cache-first */
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          return res;
        });
      })
    );
    return;
  }

  /* 4. Cross-origin → stale-while-revalidate */
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
