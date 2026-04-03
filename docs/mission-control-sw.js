// Mission Control Service Worker — handles push notifications for Android Chrome
// Android Chrome does not support new Notification() from the main thread
// reliably. This SW receives postMessage() calls and uses the SW registration
// API to show system-level notifications instead.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'SHOW_NOTIFICATION') return;

  const { title, body, icon, tag, taskId } = e.data;

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag,
      data: { taskId },
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();

  const taskId = e.notification.data?.taskId;
  const url = taskId ? `/mission-control.html#task-${taskId}` : '/mission-control.html';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus an existing Mission Control window if one is open
      for (const client of clients) {
        if (client.url.includes('mission-control') && 'focus' in client) {
          if (taskId) client.postMessage({ type: 'OPEN_CHAT', taskId });
          return client.focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(url);
    })
  );
});
