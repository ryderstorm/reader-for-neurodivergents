/**
 * Service worker: makes the reader installable and lets the shell load
 * offline.
 *
 * Scope of what this can and cannot do:
 *  - The interface, fonts and sample document are precached, so the app opens
 *    instantly and works with no network.
 *  - Speech cannot be cached. /api/* always goes to the network, because the
 *    audio is generated on demand by the server. Offline means "the app
 *    opens and tells you the server is unreachable", not "it still speaks".
 */

const VERSION = 'v1.1.3';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;

// Everything needed to render the interface with no network at all.
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/document.js',
  '/js/player.js',
  '/js/settings.js',
  '/js/ui.js',
  '/js/platform.js',
  '/vendor/marked.min.js',
  '/vendor/purify.min.js',
  '/fonts/ah-400.woff2',
  '/fonts/ah-700.woff2',
  '/fonts/ah-400i.woff2',
  '/fonts/od-400.woff2',
  '/fonts/od-700.woff2',
  '/fonts/od-400i.woff2',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/samples/welcome.md',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      // addAll is all-or-nothing; add individually so one 404 cannot leave the
      // app with no cache at all.
      .then((cache) => Promise.all(
        PRECACHE.map((url) => cache.add(url).catch(() => {
          console.warn('[sw] could not precache', url);
        })),
      )),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k)),
    );
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

// The page asks for this when the user accepts an update.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Speech and server state are never cached.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: try the network so updates land, fall back to the shell.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        return await fetch(request);
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/'))
          || Response.error();
      }
    })());
    return;
  }

  // Assets: serve from cache immediately, refresh in the background.
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    const network = fetch(request).then(async (res) => {
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(RUNTIME);
        cache.put(request, res.clone());
      }
      return res;
    }).catch(() => null);

    return cached || (await network) || Response.error();
  })());
});
