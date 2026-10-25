/* PIPVANT service worker — safe app-shell caching only.
   Rules:
   - Non-GET requests and cross-origin API calls (Supabase, FX rates, …)
     are NEVER intercepted: they go straight to the network.
   - Navigations / HTML: network-first. Only the app document (scope
     root / index.html) is stored under the './index.html' shell key and
     used as the offline fallback; other HTML pages cache under their
     own URL and can never overwrite the shell.
   - Same-origin static assets: stale-while-revalidate.
   No push handlers (future work). */
/* Bump PV_CACHE whenever the shell format changes — the activate handler
   evicts every other pipvant-* cache, so a bump force-refreshes the
   installed app shell for existing users. */
var PV_CACHE = 'pipvant-shell-v3';
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

  /* Navigations / HTML documents: network-first. Only the app shell
     document itself (the scope root or index.html) may be stored under
     the './index.html' key and served as the offline fallback — other
     HTML pages (p.html, data-ledger.html, orovanta-ops.html,
     cheapest-*.html, …) are cached under their OWN URL and fall back
     only to their own copy, so visiting one can never poison the shell
     the installed app boots from. */
  var isNav = req.mode === 'navigate' ||
    (req.headers && req.headers.get('accept') &&
     req.headers.get('accept').indexOf('text/html') !== -1);
  if (isNav) {
    if (pvIsAppDocument(url)) {
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
    } else {
      event.respondWith(
        fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(PV_CACHE).then(function (cache) {
              cache.put(req, copy);
            }).catch(function () {});
          }
          return res;
        }).catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || new Response('', { status: 504 });
          });
        })
      );
    }
    return;
  }

  /* Same-origin static (assets, tool pages, manifest, icons):
     stale-while-revalidate. */
  event.respondWith(pvStaleWhileRevalidate(req));
});

/* True only for the app shell document: the scope root ('/', './') or
   'index.html' inside the scope. Query strings are ignored (pathname),
   so '/?v=…' and '/index.html?…' count, while '/p.html?u=…' and every
   other page do not. */
function pvIsAppDocument(url) {
  var scopePath;
  try {
    scopePath = new URL(self.registration.scope).pathname;
  } catch (e) {
    scopePath = '/';
  }
  if (url.pathname === scopePath) return true;
  if (url.pathname.indexOf(scopePath) === 0) {
    var rel = url.pathname.slice(scopePath.length);
    return rel === '' || rel === 'index.html';
  }
  return false;
}

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
