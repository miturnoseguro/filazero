/* Qooentum — Service Worker v5 — KILL SWITCH */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.matchAll({includeUncontrolled: true}))
      .then(clients => clients.forEach(c => c.navigate(c.url)))
      .then(() => self.registration.unregister())
  );
});
