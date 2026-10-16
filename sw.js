/**
 * Service Worker
 * 让应用包可以离线使用，并支持“添加到主屏幕”后像 App 一样打开。
 */
const CACHE = 'pdx-diary-v1';
const ASSETS = [
  'index.html',
  'css/style.css',
  'js/db.js',
  'js/app.js',
  'js/chart.umd.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// 优先使用缓存，未命中的请求网络资源并回写缓存
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      });
    })
  );
});