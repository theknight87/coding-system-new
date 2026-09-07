// Service worker for Web Push notifications only — no offline caching,
// no asset interception. Registered guarded by 'serviceWorker' in
// navigator in src/main.jsx.

self.addEventListener('push', (event) => {
  let payload = { title: 'CarGas Stock Alert', body: 'Tap to review stock alerts.' };
  try { if (event.data) payload = { ...payload, ...event.data.json() }; } catch (e) { /* fall back to defaults */ }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/logo.png',
      badge: '/logo.png',
      tag: 'cargas-stock-alert', // collapses multiple pushes into one notification
      data: { url: payload.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
