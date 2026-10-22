// sw.js: the "service worker" that lets alphamac open with no internet.
//
// it sits between the app and the network. every file the app asks for is
// answered from a cache on the phone straight away, and in the background a
// fresh copy is fetched to replace it. so after an update, the app picks it up
// the next time you open it ("stale-while-revalidate").
//
// bump CACHE's number whenever you publish an update, so old files get cleared out.

const CACHE = "alphamac-v1";

const FILES = [
  "./",
  "index.html",
  "style.css",
  "manifest.json",
  "js/problems.js",
  "js/storage.js",
  "js/app.js",
  "js/stats.js",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

// first install: download everything up front
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

// a new version took over: delete caches from older versions
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });

      // fetch a fresh copy either way (this also caches the google font the first time)
      const fresh = fetch(event.request)
        .then((response) => {
          if (response.ok || response.type === "opaque") cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached); // offline: fall back to the cached copy

      event.waitUntil(fresh.then(() => {}, () => {}));
      return cached || fresh;
    })
  );
});
