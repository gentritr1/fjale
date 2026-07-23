const CACHE_NAME = "fjale-shell-v15";
const CACHE_PREFIX = "fjale-";
const INDEX_ROUTES = new Set(["/", "/index.html"]);
const APP_SHELL = [
  "/",
  "/index.html",
  "/privatesia.html",
  "/styles.css",
  "/src/app.js",
  "/src/config.js",
  "/src/game.js",
  "/src/page-theme.js",
  "/src/words.js",
  "/src/accepted-words.js",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/besa-seal-v1.svg",
  "/stamp-digraph-v1.svg",
  "/help-hero-v1.svg"
];

// Icons never change without a filename/URL change, so serve them straight
// from the cache with no network request. Everything else stays network-first
// so HTML/JS/CSS updates propagate immediately (see README PWA section).
const CACHE_FIRST_ASSETS = new Set([
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/besa-seal-v1.svg",
  "/stamp-digraph-v1.svg",
  "/help-hero-v1.svg"
]);

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
});

// An updated worker waits until every tab closes. The page offers a visible
// "Rifresko" prompt instead; accepting it sends this message so the new
// worker activates immediately and the page can reload onto it.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname === "/service-worker.js") {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (CACHE_FIRST_ASSETS.has(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request, url));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const networkResponse = await fetch(request);
  if (networkResponse.ok && networkResponse.type === "basic") {
    await cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const requests = APP_SHELL.map((url) => new Request(url, { cache: "reload" }));
  const responses = await Promise.all(
    requests.map(async (request) => {
      const response = await fetch(request);
      if (!response.ok) {
        throw new Error(`App shell request failed: ${request.url}`);
      }
      return response;
    })
  );

  await Promise.all(
    requests.map((request, index) => cache.put(request, responses[index]))
  );
}

async function networkFirst(request, url) {
  const cache = await caches.open(CACHE_NAME);
  let networkResponse = null;

  try {
    // Revalidate every network-first shell and corpus request instead of using
    // a still-fresh HTTP cache entry. The Cache API remains the offline fallback.
    networkResponse = await fetch(request, { cache: "no-cache" });
    if (networkResponse.status >= 500) {
      throw new Error(`Temporary server error: ${networkResponse.status}`);
    }
    if (networkResponse.ok && networkResponse.type === "basic") {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    // Preserve server semantics: only the real index route can fall back to
    // the cached application shell. Unknown routes do not become index.html.
    if (request.mode === "navigate" && INDEX_ROUTES.has(url.pathname)) {
      const indexResponse = (await cache.match("/")) || (await cache.match("/index.html"));
      if (indexResponse) {
        return indexResponse;
      }
    }

    if (networkResponse) {
      return networkResponse;
    }

    return new Response("Nuk ka lidhje me internetin dhe kjo faqe nuk është në memorie.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
