/* Offline cache for the school website (same-origin files only).
   Code and pages are network-first so an update is never one visit behind;
   only static assets (images, fonts, icons) are served cache-first. */
const CACHE = 'nspnsa-v2';
const CORE = ['./', 'index.html', 'support.js', 'image-slot.js', 'globe-engine.js', 'hl-gallery.js', 'supabase-sync.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).catch(() => null)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const store = (req, res) => {
  if (res && res.status === 200) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase / embeds

  // pages, styles and scripts: fresh first, cache only as an offline fallback
  const live = req.mode === 'navigate' || /\.(html|js|css|json)$/i.test(url.pathname) || url.pathname.endsWith('/');
  if (live) {
    e.respondWith(fetch(req).then(res => store(req, res)).catch(() => caches.match(req)));
    return;
  }

  // everything else (images, fonts): cache first, refresh in the background
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => store(req, res)).catch(() => hit);
      return hit || net;
    })
  );
});
