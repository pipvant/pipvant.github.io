/* PIPVANT service worker — conservative app-shell cache.
   Same-origin GET only. NEVER caches Supabase, CDN or font hosts. */
var CACHE = 'pipvant-shell-v1';
var SHELL = [
  '/', '/index.html',
  '/assets/css/style.css',
  '/assets/js/site.js', '/assets/js/config.js', '/assets/js/sb-config.js',
  '/assets/js/supabase.js', '/assets/js/firms.js',
  '/assets/img/logo.png', '/assets/img/icon-192.png',
  '/manifest.json'
];
var NEVER = ['supabase.co', 'jsdelivr.net', 'googleapis.com', 'gstatic.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some(function (h) { return url.hostname.indexOf(h) >= 0; })) return;
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
