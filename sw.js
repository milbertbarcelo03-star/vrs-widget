/* ============================================================================
   VRS Widget — sw.js (service worker)
   Receives payload-less Web Push notifications and shows a fixed
   "incoming call" notification, so an interpreter who has enabled
   background alerts is notified even with the dashboard tab closed.

   Deliberately minimal: no offline caching, no fetch handler. The only jobs
   here are "push" (show notification) and "notificationclick" (focus or open
   the dashboard). See interpreter.html PUSH-SETUP.md for the full picture.
   ============================================================================ */

self.addEventListener('install', function (event) {
  try {
    self.skipWaiting();
  } catch (err) {
    console.error('VRS sw: skipWaiting failed', err);
  }
});

self.addEventListener('activate', function (event) {
  try {
    event.waitUntil(self.clients.claim());
  } catch (err) {
    console.error('VRS sw: clients.claim failed', err);
  }
});

self.addEventListener('push', function (event) {
  try {
    event.waitUntil(
      self.registration.showNotification('📞 Incoming VRS call', {
        body: 'A deaf caller needs an interpreter. Tap to open the dashboard.',
        tag: 'vrs-incoming',
        requireInteraction: true,
        renotify: true,
        icon: 'icon-192.png',
        badge: 'icon-192.png'
      })
    );
  } catch (err) {
    console.error('VRS sw: push handler failed', err);
  }
});

self.addEventListener('notificationclick', function (event) {
  try {
    event.notification.close();
    event.waitUntil(
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then(function (windowClients) {
          for (var i = 0; i < windowClients.length; i++) {
            var client = windowClients[i];
            if (client.url && client.url.indexOf('interpreter') !== -1 && 'focus' in client) {
              return client.focus();
            }
          }
          if (self.clients.openWindow) {
            return self.clients.openWindow(new URL('./interpreter.html', self.registration.scope));
          }
        })
    );
  } catch (err) {
    console.error('VRS sw: notificationclick handler failed', err);
  }
});
