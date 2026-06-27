/* Qooentum — Service Worker v2 */
const CACHE_NAME = 'qooentum-v2';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ─── Dominios que NUNCA se cachean ─────────────────────────
   Geoapify: las respuestas pueden ser 400 (bad bbox) y no
   queremos servirlas desde caché. Siempre ir a la red.
   googleapis: tokens OAuth, perfiles de usuario — jamás cachear.
   script.google.com: backend Apps Script — siempre fresco.
   ─────────────────────────────────────────────────────────── */
const NEVER_CACHE_DOMAINS = [
  'api.geoapify.com',
  'googleapis.com',
  'accounts.google.com',
  'script.google.com',
];

function shouldNeverCache(url) {
  return NEVER_CACHE_DOMAINS.some((d) => url.hostname.includes(d));
}

/* ─── INSTALL ──────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

/* ─── ACTIVATE ─────────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      /* Después de borrar cachés viejas, limpiamos cualquier
         entrada de Geoapify que haya quedado de versiones previas */
      .then(() => caches.open(CACHE_NAME))
      .then(async (cache) => {
        const reqs = await cache.keys();
        const toDelete = reqs.filter((r) => shouldNeverCache(new URL(r.url)));
        await Promise.all(toDelete.map((r) => cache.delete(r)));
      })
      .then(() => self.clients.claim())
  );
});

/* ─── FETCH ────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo interceptamos GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* 1. Dominios críticos → siempre red, sin caché */
  if (shouldNeverCache(url)) {
    event.respondWith(fetch(req));
    return;
  }

  /* 2. Navegación / HTML de mismo origen → network-first */
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
        .catch(() =>
          caches.match(req).then((r) => r || caches.match('./index.html'))
        )
    );
    return;
  }

  /* 3. Assets estáticos de mismo origen → cache-first */
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

  /* 4. Cross-origin (fonts, Leaflet tiles, CDN, Unsplash)
        → stale-while-revalidate, SOLO cachear respuestas ok */
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          /* Solo cachear si la respuesta es exitosa */
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
