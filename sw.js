// Service worker: приложение открывается быстро, работает как установленное и принимает push-уведомления.
// Стратегия «сначала сеть»: всегда берём свежую версию, кэш — только если нет интернета.
const CACHE = 'ponghub-v29';
const SHELL = ['./', './index.html', './css/style.css', './js/app.js', './js/engine.js', './js/tourney.js', './js/store.js', './js/tv.js', './js/shop-catalog.js', './js/shop3d.js', './js/player3d.js', './js/config.js',
  './icons/hub.svg', './icons/table.svg', './manifest-hub.webmanifest', './manifest-table.webmanifest'];

self.addEventListener('install', e => {
  // ошибка предзагрузки одного файла не должна ломать установку приложения
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'PongHub', {
    body: d.body || '',
    icon: 'icons/hub-192.png',
    badge: 'icons/hub-192.png',
    tag: d.tag,
    data: { url: d.url || '#/home' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '#/home', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
