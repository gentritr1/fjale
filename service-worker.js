const CACHE_NAME = "fjale-shell-v34";
const CACHE_PREFIX = "fjale-";
const INDEX_ROUTES = new Set(["/", "/index.html"]);
// Avatars are deliberately NOT precached while REWARDS_ENABLED is off: install
// stays 19 atomic requests instead of 43, and flag-off users never download
// 129 KB of UI they cannot reach. They remain in CACHE_FIRST_ASSETS below, so
// they are cached on first real use; add them here when the rewards flag ships.
const APP_SHELL = [
  "/",
  "/index.html",
  "/privatesia.html",
  "/styles.css",
  "/src/app.js",
  "/src/avatars.js",
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
  "/help-hero-v1.svg",
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
  "/help-hero-v1.svg",
  "/avatars/stick-racer-v1.webp",
  "/avatars/stick-rebel-v1.webp",
  "/avatars/stick-dyed-v1.webp",
  "/avatars/stick-skater-v1.webp",
  "/avatars/stick-tinkerer-v1.webp",
  "/avatars/stick-music-v1.webp",
  "/avatars/stick-cup-v1.webp",
  "/avatars/stick-elder-v1.webp",
  "/avatars/stick-reader-v1.webp",
  "/avatars/stick-runner-v1.webp",
  "/avatars/stick-creator-v1.webp",
  "/avatars/stick-hoodie-v1.webp",
  "/avatars/animal-owl-v1.webp",
  "/avatars/animal-fox-v1.webp",
  "/avatars/animal-hare-v1.webp",
  "/avatars/animal-bear-v1.webp",
  "/avatars/animal-goat-v1.webp",
  "/avatars/animal-cat-v1.webp",
  "/avatars/animal-tortoise-v1.webp",
  "/avatars/animal-songbird-v1.webp",
  "/avatars/animal-hedgehog-v1.webp",
  "/avatars/animal-moth-v1.webp",
  "/avatars/animal-frog-v1.webp",
  "/avatars/animal-badger-v1.webp",
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

  // Private Rrethi responses must always go straight to the network. Keeping
  // this guard in the shell worker before any endpoint exists prevents a later
  // API release from accidentally persisting member or leaderboard data in the
  // Cache API. HTTP `Cache-Control: no-store` remains the server-side backstop.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
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

  event.respondWith(networkFirst(request, url, event));
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
  // "no-cache" (revalidate) instead of "reload" (force full download): the page
  // fetched these same 19 files seconds ago, so revalidation turns ~115 KB of
  // duplicate transfer into 304s. COUPLING: this is only equivalent to "reload"
  // because vercel.json serves every shell file `max-age=0, must-revalidate` —
  // if those headers ever allow real HTTP caching, this must go back to
  // "reload" or the precache could capture a stale copy.
  const requests = APP_SHELL.map((url) => new Request(url, { cache: "no-cache" }));
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

// How long a network-first request may stall before a cached copy is served
// instead. Offline rejects instantly and is unaffected; this bounds the lie-fi
// case (captive portal, one-bar 3G: TCP connects, then nothing) where the
// browser's own socket timeout would otherwise hang a fully-cached app for
// tens of seconds.
const NETWORK_FIRST_TIMEOUT_MS = 3_500;

async function networkFirst(request, url, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  let networkResponse = null;

  try {
    // Revalidate every network-first shell and corpus request instead of using
    // a still-fresh HTTP cache entry. The Cache API remains the offline fallback.
    const networkPromise = fetch(request, { cache: "no-cache" });
    // The timeout only exists when there is a cached copy to fall back on; a
    // first-ever visit on a slow network must keep waiting for the real thing.
    networkResponse = cached
      ? await Promise.race([
          networkPromise,
          new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_FIRST_TIMEOUT_MS)),
        ])
      : await networkPromise;

    if (networkResponse === null) {
      // Serve the cache now; let the late network response finish in the
      // background so the next load gets the fresh copy.
      event.waitUntil(
        networkPromise
          .then(async (lateResponse) => {
            if (lateResponse.ok && lateResponse.type === "basic") {
              await cache.put(request, lateResponse.clone());
            }
          })
          .catch(() => {}),
      );
      return cached;
    }

    if (networkResponse.status >= 500) {
      throw new Error(`Temporary server error: ${networkResponse.status}`);
    }
    if (networkResponse.ok && networkResponse.type === "basic") {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
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
