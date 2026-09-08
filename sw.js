/* ============================================================================
   VRS Widget — sw.js (service worker)

   Two jobs:
     1. PWA app shell. Precaches the same-origin files so the installed
        home-screen app opens on a flaky connection instead of showing the
        browser's offline page. Network-first, so a deploy is picked up as
        soon as the device is online again and the cache never serves stale
        code to someone who has signal.
     2. Web push. Receives payload-less pushes and shows a fixed "incoming
        call" notification, so an interpreter is alerted with the dashboard
        closed.

   Deliberately conservative: cross-origin requests are not touched at all.
   Firebase's long-poll/websocket traffic, the gstatic SDK bundles and the
   Google Fonts CSS all go straight to the network. Caching or replaying any
   of that would break signalling in ways that are extremely hard to debug.
   ============================================================================ */

// Bump this on every deploy that changes a precached file, otherwise old
// clients keep their previous copy until the cache is evicted.
var VRS_CACHE = 'vrs-shell-v2';

var VRS_SHELL = [
  './',
  './app.html',
  './call.html',
  './interpreter.html',
  './shared.js',
  './manifest.json',
  './manifest-call.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  try {
    event.waitUntil(
      caches.open(VRS_CACHE).then(function (cache) {
        // addAll() is atomic: one 404 throws away the whole precache. The
        // shell is best-effort, so add each file on its own and let the
        // misses fall through to the network at runtime.
        return Promise.all(
          VRS_SHELL.map(function (url) {
            return cache.add(url).catch(function (err) {
              console.error('VRS sw: precache failed for ' + url, err);
            });
          })
        );
      })
    );
    self.skipWaiting();
  } catch (err) {
    console.error('VRS sw: install failed', err);
  }
});

self.addEventListener('activate', function (event) {
  try {
    event.waitUntil(
      caches
        .keys()
        .then(function (keys) {
          return Promise.all(
            keys.map(function (key) {
              if (key !== VRS_CACHE) return caches.delete(key);
              return null;
            })
          );
        })
        .then(function () {
          return self.clients.claim();
        })
    );
  } catch (err) {
    console.error('VRS sw: activate failed', err);
  }
});

self.addEventListener('fetch', function (event) {
  try {
    var req = event.request;
    if (req.method !== 'GET') return;

    var url = new URL(req.url);
    // Same-origin only. Everything else (Firebase, gstatic, fonts) is left
    // entirely alone — see the header comment.
    if (url.origin !== self.location.origin) return;

    event.respondWith(
      fetch(req)
        .then(function (res) {
          // Only cache real, complete responses.
          if (res && res.status === 200 && res.type === 'basic') {
            var copy = res.clone();
            caches.open(VRS_CACHE).then(function (cache) {
              cache.put(req, copy).catch(function (err) {
                console.error('VRS sw: cache.put failed', err);
              });
            });
          }
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            if (hit) return hit;
            // A navigation to a URL we never cached (e.g. /call/) still needs
            // to render something rather than the browser's offline error.
            if (req.mode === 'navigate') {
              return caches.match('./app.html');
            }
            return Response.error();
          });
        })
    );
  } catch (err) {
    console.error('VRS sw: fetch handler failed', err);
  }
});

self.addEventListener('push', function (event) {
  try {
    event.waitUntil(
      self.registration.showNotification('📞 Incoming SignBridge call', {
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
            return self.clients.openWindow(new URL('./app.html', self.registration.scope));
          }
        })
    );
  } catch (err) {
    console.error('VRS sw: notificationclick handler failed', err);
  }
});
