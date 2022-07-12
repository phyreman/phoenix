const APP_PREFIX = "phoenix",
      APP_VERSION = "v0.0.0.17",
      CACHE_NAME = `${APP_PREFIX}_${APP_VERSION}`;

let APP_URLS = [
  location.pathname,
  "index.html",
  "credits.html",
  "app.js",
  "css/app.css",
  "images/favicon.ico",
  "images/favicon-16x16.png",
  "images/favicon-32x32.png",
  "images/android-chrome-192x192.png",
  "images/android-chrome-512x512.png",
  "images/favicon.svg"
];

let _platform = navigator.platform;
if (_platform.startsWith("Win")) {
  APP_URLS.push("browserconfig.xml");
  APP_URLS.push("images/mstile-150x150.png");
}

if (_platform === "iPhone" || _platform === "iPad") {
  APP_URLS.push("images/apple-touch-icon-precomposed.png");
  APP_URLS.push("images/apple-touch-icon.png");
}
_platform = null;

// Cache APP_URLS when an install is requested
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_URLS);
  })());
});

// Provide from the cache before requesting from the network
self.addEventListener("fetch", event => {
  event.respondWith((async () => {
    const req = event.request,
          r = await caches.match(req);
    if (r) return r;
    const res = await fetch(req),
          cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  })());
});

// Delete old versions from the cache
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => {
    return Promise.all(keys.map(key => {
      if (key === CACHE_NAME) return;
      return caches.delete(key);
    }));
  }));
});

self.addEventListener("message", event => {
  if (event.data.action === "skipWaiting") self.skipWaiting();
});