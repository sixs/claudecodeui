// Service Worker for CloudCLI PWA
// 导航(HTML) 用 stale-while-revalidate：优先秒开缓存，后台再拉最新 HTML 更新，
// 避免 WebView 后台恢复时整页重新加载造成白屏/刷新感。
// /assets/ 哈希资源仍 cache-first；rebuild 后由后台更新 + 下次加载拿到新版本。
const CACHE_NAME = 'claude-ui-v3';
const APP_SHELL_KEY = '__app_shell_html__';
const urlsToCache = [
  '/manifest.json'
];

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// Fetch event — network-first for everything except hashed assets
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Never intercept API requests or WebSocket upgrades
  if (url.includes('/api/') || url.includes('/ws')) {
    return;
  }

  // Navigation requests (HTML) — stale-while-revalidate
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(APP_SHELL_KEY);
      // 后台更新：从网络拉最新 HTML 并写回缓存（不阻塞当前请求）
      const networkUpdate = fetch(event.request)
        .then(response => {
          if (response && response.ok && response.type === 'basic') {
            cache.put(APP_SHELL_KEY, response.clone());
          }
          return response;
        })
        .catch(() => null);
      // 有缓存：立即秒开，后台静默更新
      if (cached) {
        return cached;
      }
      // 无缓存（首次/清缓存后）：等网络
      const netResp = await networkUpdate;
      if (netResp) {
        return netResp;
      }
      // 离线兜底
      return new Response('<h1>Offline</h1><p>Please check your connection.</p>', {
        headers: { 'Content-Type': 'text/html' }
      });
    })());
    return;
  }

  // Hashed assets (JS/CSS in /assets/) — cache-first since filenames change per build
  if (url.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Everything else — network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Activate event — purge old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Push notification event
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'CloudCLI', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: '/logo-256.png',
    badge: '/logo-128.png',
    data: payload.data || {},
    tag: payload.data?.tag || `${payload.data?.sessionId || 'global'}:${payload.data?.code || 'default'}`,
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'CloudCLI', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const sessionId = event.notification.data?.sessionId;
  const provider = event.notification.data?.provider || null;
  const urlPath = sessionId ? `/session/${sessionId}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          client.postMessage({
            type: 'notification:navigate',
            sessionId: sessionId || null,
            provider,
            urlPath
          });
          return;
        }
      }
      return self.clients.openWindow(urlPath);
    })
  );
});
