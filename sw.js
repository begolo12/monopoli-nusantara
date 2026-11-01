/* Service worker: simpan seluruh aplikasi supaya game tetap jalan tanpa internet.
   Strategi network-first: saat online pemain selalu mendapat versi terbaru,
   saat offline (pesawat, sinyal hilang) halaman jatuh ke cache. */
(function () {
  'use strict';
  var CACHE = 'monopoli-v1';
  var ASSETS = [
    './', './index.html', './styles.css', './tokens.css', './base.css',
    './data.js', './game.js', './bot.js', './net.js', './ui.js',
    './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'
  ];

  self.addEventListener('install', function (e) {
    e.waitUntil(
      caches.open(CACHE).then(function (c) {
        /* Satu aset gagal (mis. ikon baru) tidak boleh menggagalkan pemasangan. */
        return Promise.all(ASSETS.map(function (u) { return c.add(u).catch(function () {}); }));
      }).then(function () { return self.skipWaiting(); })
    );
  });

  self.addEventListener('activate', function (e) {
    e.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      }).then(function () { return self.clients.claim(); })
    );
  });

  self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;
    var url = new URL(req.url);
    /* Font & PeerJS dari CDN: biarkan lewat jaringan; game lokal tidak membutuhkannya. */
    if (url.origin !== self.location.origin) return;
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          /* Navigasi offline: sajikan kulit aplikasi dari cache. */
          return caches.match('./index.html');
        });
      })
    );
  });
})();
