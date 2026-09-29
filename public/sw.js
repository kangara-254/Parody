// sw.js — minimal service worker. Its main job is making the app
// installable (Chrome's "Add to Home Screen" / install prompt on Android
// requires an active service worker with a fetch handler). As a bonus it
// runtime-caches the app shell so a repeat visit or a flaky connection
// still loads the UI; it deliberately does NOT cache API calls
// (/api/generate-pdf, Supabase requests) since those must always be fresh.

const CACHE_NAME = 'kss-exam-portal-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

function isApiOrCrossOrigin(url) {
  const u = new URL(url);
  if (u.origin !== self.location.origin) return true; // Supabase, fonts, etc.
  if (u.pathname.startsWith('/api/')) return true; // PDF generation, always fresh
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (isApiOrCrossOrigin(req.url)) return; // let these hit the network untouched

  if (req.mode === 'navigate') {
    // Navigations: try the network first (so users always get the latest
    // build when online), fall back to the cached shell when offline.
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Static assets (hashed JS/CSS/icons): cache-first, populate on miss.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
