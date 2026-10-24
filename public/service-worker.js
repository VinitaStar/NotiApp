self.addEventListener('push', (event) => {
  let data = { title: 'Us', body: 'You have a new notification' };
  try {
    data = event.data.json();
  } catch {
    // ignore, use default
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      if (windows.length) return windows[0].focus();
      return clients.openWindow('/');
    })
  );
});
