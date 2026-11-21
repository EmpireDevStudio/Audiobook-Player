/* Cadence service worker — versioned, atomic app-shell updates */
const requestedVersion = new URL(self.location.href).searchParams.get('version') || '';
const APP_VERSION = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i.test(requestedVersion) ? requestedVersion : '3.2.4';
const CACHE_PREFIX = 'cadence-shell-v';
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const scriptUrl = new URL('./script.js', self.registration.scope);
    const scriptResponse = await fetch(new Request(scriptUrl, { cache: 'reload' }));
    if (!scriptResponse.ok) throw new Error(`Could not download app script (HTTP ${scriptResponse.status}).`);

    const source = await scriptResponse.clone().text();
    const match = source.match(/\bversion\s*:\s*['"](\d+\.\d+\.\d+(?:-[\da-z.-]+)?)['"]/i);
    if (!match || match[1] !== APP_VERSION) {
      throw new Error(`GitHub Pages has not published Cadence v${APP_VERSION} yet.`);
    }

    const cache = await caches.open(CACHE_NAME);
    await cache.put(scriptUrl, scriptResponse);
    const requests = SHELL_ASSETS.map((asset) =>
      new Request(new URL(asset, self.registration.scope), { cache: 'reload' })
    ).filter((request) => request.url !== scriptUrl.href);
    await cache.addAll(requests);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const indexUrl = new URL('./index.html', self.registration.scope);
      const cached = await cache.match(indexUrl);
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        if (response.ok) event.waitUntil(cache.put(indexUrl, response.clone()));
        return response.ok || !cached ? response : cached;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;

    const response = await fetch(event.request);
    if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
    return response;
  })());
});
