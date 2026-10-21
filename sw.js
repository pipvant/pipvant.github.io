/* PIPVANT service worker — safe app-shell caching only.
   Rules:
   - Non-GET requests and cross-origin API calls (Supabase, FX rates, …)
     are NEVER intercepted: they go straight to the network.
   - Navigations / HTML: network-first, fall back to the cached shell.
   - Same-origin static assets: stale-while-revalidate.
   No push handlers (future work). */
var PV_CACHE = 'pipvant-shell-v1';
var PV_PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(PV_CACHE).then(function (cache) {
      return cache.addAll(PV_PRECACHE);
    }).then(function () {
      return self.skipWaiting();
    }).catch(function () {
      /* Precache failure must never block installation of the worker. */
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf('pipvant-') === 0 && key !== PV_CACHE) {
          return caches.delete(key);
        }
        return Promise.resolve(false);
      }));
    }).then(function () {
      return self.clients.claim();
    }).catch(function () {})
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (!req || req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* Cross-origin: network only — never intercept APIs (Supabase etc.).
     Google Fonts stylesheets are the one exception: they are static CSS,
     safe to stale-while-revalidate so the shell still renders offline.
     If the network is unreachable and nothing is cached yet, resolve with
     an empty stylesheet instead of rejecting respondWith (the page then
     simply falls back to system fonts; no console error). */
  if (url.origin !== self.location.origin) {
    if (url.hostname === 'fonts.googleapis.com') {
      event.respondWith(pvStaleWhileRevalidate(req, function () {
        return new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } });
      }));
    }
    return;
  }

  /* Navigations / HTML documents: network-first, cached shell fallback. */
  var isNav = req.mode === 'navigate' ||
    (req.headers && req.headers.get('accept') &&
     req.headers.get('accept').indexOf('text/html') !== -1);
  if (isNav) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(PV_CACHE).then(function (cache) {
            cache.put('./index.html', copy);
          }).catch(function () {});
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        }).then(function (hit) {
          return hit || new Response('', { status: 504 });
        });
      })
    );
    return;
  }

  /* Same-origin static (assets, tool pages, manifest, icons):
     stale-while-revalidate. */
  event.respondWith(pvStaleWhileRevalidate(req));
});

function pvStaleWhileRevalidate(req, makeFallback) {
  return caches.open(PV_CACHE).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          cache.put(req, res.clone()).catch(function () {});
        }
        return res;
      }).catch(function () {
        if (hit) return hit;
        /* Never reject respondWith: serve the caller's fallback, or a
           plain 504 response the page treats as a normal failed asset. */
        return makeFallback ? makeFallback() : new Response('', { status: 504 });
      });
      return hit || network;
    });
  }).catch(function () {
    return makeFallback ? makeFallback() : new Response('', { status: 504 });
  });
}
