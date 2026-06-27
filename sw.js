/* Qooentum — Service Worker v5 (fix Foursquare CORS) */
const CACHE_NAME = 'qooentum-v5';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ─── Dominios que NUNCA se cachean ─────────────────────────
   - Foursquare: respuestas dinámicas, no cachear
   - googleapis: tokens OAuth, perfiles de usuario
   - accounts.google: autenticación
   - script.google: backend Apps Script
   ─────────────────────────────────────────────────────────── */
const NEVER_CACHE_DOMAINS = [
  'api.foursquare.com',
  'location.foursquare.com',
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
            .map((k) => {
              console.log(`🗑️  Eliminando caché vieja: ${k}`);
              return caches.delete(k);
            })
        )
      )
      /* Limpiar entradas de Foursquare/APIs que no deben cachearse */
      .then(() => caches.open(CACHE_NAME))
      .then(async (cache) => {
        const reqs = await cache.keys();
        const toDelete = reqs.filter((r) => shouldNeverCache(new URL(r.url)));
        await Promise.all(toDelete.map((r) => cache.delete(r)));
        if (toDelete.length > 0) {
          console.log(`🧹 Limpiadas ${toDelete.length} entradas de APIs externas`);
        }
      })
      .then(() => self.clients.claim())
  );
});

/* ─── FETCH ────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo interceptamos GET (OPTIONS/POST/etc van directo a la red sin interferencia)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* 1. Dominios críticos → NO interceptar en absoluto.
        Si llamamos event.respondWith() con fetch(req) para requests cross-origin
        que tienen headers Authorization, Chrome los bloquea con "provisional headers".
        La solución correcta es no interceptar — el browser lo maneja directamente. */
  if (shouldNeverCache(url)) {
    // No llamamos event.respondWith() → el browser maneja el request nativamente
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

  /* 4. Cross-origin (fonts, Leaflet tiles, CDN)
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
        .catch(() => cached || new Response('Offline', { status: 503 }));
      return cached || fetchPromise;
    })
  );
});

/* ─── SKIP WAITING (permite actualización inmediata) ─── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('✅ Service Worker v5 — Foursquare requests pasan directo al browser');
