/* Qooentum — Service Worker v4 (Foursquare fix + session persistence) */
const CACHE_NAME = 'qooentum-v4';
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

  /* 1. Dominios críticos → siempre red, sin caché, sin modificar el request
        Se pasa el request tal cual para que los headers Authorization se preserven */
  if (shouldNeverCache(url)) {
    event.respondWith(
      fetch(req.clone())
        .catch(() => {
          return new Response(
            JSON.stringify({ error: 'Sin conexión a internet' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
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

console.log('✅ Service Worker v4 registrado (Foursquare + sesión persistente)');
