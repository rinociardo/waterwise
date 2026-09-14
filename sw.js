// sw.js — offline shell for the yard.
//
// NETWORK-FIRST for same-origin files, with the cache as the offline fallback.
// Cache-first is the textbook PWA pattern, but it means a reload serves you
// yesterday's JavaScript, which is maddening while the app is still changing.
// This way you always get the current file when you have a connection, and the
// last good copy when you do not.
//
// Bump CACHE on any release that changes the shell — old caches are deleted on
// activate, so it is also the emergency lever if a client gets stuck.

const CACHE = 'waterwise-v18';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/model.js',
  './js/store.js',
  './js/plants.js',
  './js/weather.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Weather goes straight to the network, never through the shell cache.
  // weather.js keeps its own copy in localStorage as the offline fallback.
  if (url.hostname.endsWith('open-meteo.com')) return;

  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});

// Lets the page force an immediate update: navigator.serviceWorker.controller
//   .postMessage('skipWaiting')
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
