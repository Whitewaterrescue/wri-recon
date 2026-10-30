/* WRI Field Forms (offline: Recon, 214, HASP, Vessel, 213-RR) — service worker.
 *
 * - Shell: precached, network-first with an 8 s race, cache fallback, so the
 *   app opens with no signal and updates when there is.
 * - Leaflet (cdnjs): cache-first. Map tiles and the API are never cached.
 * - Cache Storage is shared by every app on whitewaterrescue.github.io, so
 *   activate deletes ONLY this app's old caches (prefix wri-recon-).
 * - Background Sync (Android) drains the outbox with the app closed. iOS has
 *   none: the page drains whenever it's opened.
 *
 * APP_VERSION must equal the ?v= stamps in index.html; bump both together.
 */
var APP_VERSION = '2026-10-30-1';
var CACHE = 'wri-recon-' + APP_VERSION;
var LIB_CACHE = 'wri-recon-lib-leaflet-1.9.4';

importScripts('js/config.js?v=' + APP_VERSION, 'js/store.js?v=' + APP_VERSION, 'js/api.js?v=' + APP_VERSION,
  'js/forms.js?v=' + APP_VERSION, 'js/outbox.js?v=' + APP_VERSION);

var SHELL = [
  './', './index.html', './manifest.json', './assets/wri-logo.png',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png',
  './css/app.css?v=' + APP_VERSION,
  './js/config.js?v=' + APP_VERSION, './js/store.js?v=' + APP_VERSION, './js/api.js?v=' + APP_VERSION,
  './js/outbox.js?v=' + APP_VERSION, './js/forms.js?v=' + APP_VERSION, './js/app.js?v=' + APP_VERSION,
  './js/forms-ui.js?v=' + APP_VERSION, './js/dronemeta.js?v=' + APP_VERSION, './js/drone-ui.js?v=' + APP_VERSION, './js/drill-ui.js?v=' + APP_VERSION
].concat(['aid_station', 'boat_ramp', 'current_boom_site', 'decon', 'drone_flight', 'fish_kill', 'hospital', 'icp',
  'injured_wildlife', 'injury', 'landing_zone', 'near_miss', 'oil_spotted', 'other_action', 'other_observation',
  'other_safety', 'planned_boom_site', 'planned_staging_area', 'recovery_complete', 'response_action', 'river_hazard',
  'road_closure', 'safety_briefing', 'scat_point', 'staging_area', 'tactical_team'].map(function (c) { return './assets/obs/' + c + '.png'; }));
var LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
];

self.addEventListener('install', function (e) {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }),
    caches.open(LIB_CACHE).then(function (c) { return c.addAll(LIBS).catch(function () {}); })
  ]));
  self.skipWaiting();   // the shell is versioned per file; a new worker can take over at once
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (n) {
      return n.indexOf('wri-recon-') === 0 && n !== CACHE && n !== LIB_CACHE;
    }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(caches.open(LIB_CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (r) { if (r.ok) c.put(req, r.clone()); return r; });
      });
    }));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.indexOf('/wri-recon/') !== 0) return;
  e.respondWith(new Promise(function (resolve) {
    var settled = false;
    var fromCache = function () {
      return caches.match(req).then(function (hit) {
        return hit || (req.mode === 'navigate' ? caches.match('./index.html') : null);
      });
    };
    var timer = setTimeout(function () {
      fromCache().then(function (hit) { if (hit && !settled) { settled = true; resolve(hit); } });
    }, 8000);
    fetch(req).then(function (r) {
      clearTimeout(timer);
      if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      if (!settled) { settled = true; resolve(r); }
    }, function () {
      clearTimeout(timer);
      fromCache().then(function (hit) { if (!settled) { settled = true; resolve(hit || Response.error()); } });
    });
  }));
});

self.addEventListener('sync', function (e) {
  if (e.tag === 'wri-recon-outbox') e.waitUntil(Outbox.drain());
});
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'drain') e.waitUntil(Outbox.drain());
});
