/**
 * Service Worker
 * 让应用包可以离线使用，并支持“添加到主屏幕”后像 App 一样打开。
 * 缓存策略：网络优先——在线时始终获取最新版本，断网时回退本地缓存。
 */
const CACHE = 'pdx-diary-v6';
const ASSETS = [
  'index.html',
  'css/style.css?v=20261018d',
  'js/db.js?v=20261018d',
  'js/app.js?v=20261018d',
  'js/chart.umd.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      // 清理旧版本缓存，避免旧文件残留
      .then(() => caches.keys())
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// 网络优先：在线时始终拿最新版，断网时回退本地缓存
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
