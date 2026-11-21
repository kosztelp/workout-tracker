// Verziószám: ha módosítod az appot, ezt léptesd (v4, v5...), hogy a régi cache törlődjön.
const CACHE_NAME = 'workout-tracker-v3';

const LOCAL_ASSETS = [
  './', './index.html', './app.js', './styles.css', './manifest.json', './icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];
const CDN_ASSETS = ['https://unpkg.com/vue@3.5.46/dist/vue.global.prod.js'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(LOCAL_ASSETS);
    // A CDN fájl hibája ne akassza meg a telepítést
    await Promise.all(CDN_ASSETS.map(url =>
      fetch(url, { mode: 'cors' }).then(res => res.ok && cache.put(url, res)).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Saját fájlok: hálózat először (friss verzió), offline esetén cache
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE_NAME)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) ||
               (req.mode === 'navigate' ? caches.match('./index.html') : Response.error());
      }
    })());
    return;
  }

  // CDN (rögzített verzió, nem változik): cache először
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE_NAME)).put(req, res.clone());
    return res;
  })());
});
