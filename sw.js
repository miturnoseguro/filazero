/* Qooentum — Service Worker v6 (precache tolerante + Foursquare bypass) */
const CACHE_NAME = 'qooentum-v6';
const PRECACHE_URLS = [
  './',
  './index.html',
];

/* ─── Dominios que NUNCA interceptamos ──────────────────────
   Para estos dominios NO llamamos event.respondWith() en absoluto.
   El browser los maneja directamente con CORS nativo completo,
   lo que permite que los headers Authorization de Foursquare
   y los tokens OAuth de Google pasen sin interferencia.
   ─────────────────────────────────────────────────────────── */
const NEVER_INTERCEPT_DOMAINS = [
  'api.foursquare.com',
  'location.foursquare.com',
  'googleapis.com',
  'accounts.google.com',
  'script.google.com',
];

function shouldNeverIntercept(url) {
  return NEVER_INTERCEPT_DOMAINS.some((d) => url.hostname.includes(d));
}

/* ─── INSTALL — precacheo tolerante a errores ──────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cachear cada URL individualmente para que un fallo no rompa todo
      await Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`SW: no se pudo pre-cachear ${url}:`, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ─── ACTIVATE — limpiar cachés viejas ─────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => {
              console.log(`SW: eliminando caché vieja: ${k}`);
              return caches.delete(k);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ─── FETCH ────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo interceptamos GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* 1. Dominios críticos → NO interceptar en absoluto.
        Hacemos return sin llamar event.respondWith().
        El browser maneja el request nativamente con CORS completo. */
  if (shouldNeverIntercept(url)) return;

  /* 2. Navegación / HTML de mismo origen → network-first */
  if (
    req.mode === 'navigate' ||
    (url.origin === self.location.origin &&
      req.headers.get('accept')?.includes('text/html'))
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
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
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return res;
        }).catch(() => new Response('Offline', { status: 503 }));
      })
    );
    return;
  }

  /* 4. Cross-origin (fonts, Leaflet tiles, CDN) → stale-while-revalidate */
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
        .catch(() => cached || new Response('Offline', { status: 503 }));
      return cached || fetchPromise;
    })
  );
});

/* ─── SKIP WAITING (actualización inmediata desde la app) ─── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('✅ SW v6 activo — Foursquare bypass + precache tolerante');
