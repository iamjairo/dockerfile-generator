/**
 * CodePal Preview Service Worker
 *
 * Caches the app shell (HTML + Vite client assets) after first successful load.
 * Subsequent loads serve from cache instantly while revalidating in the background.
 * This makes tab-switch returns and HMR reconnects effectively instant.
 *
 * Strategy: stale-while-revalidate for HTML and JS, network-first for everything else.
 */

const CACHE_NAME = 'codepal-preview-v1';

// Only cache the app shell — not API calls, images, or other assets
const CACHEABLE_TYPES = ['document', 'script', 'style'];

self.addEventListener('install', () => {
    // Activate immediately without waiting for existing clients to close
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Claim all clients immediately so the SW is active on first load
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            // Clean up old cache versions
            caches.keys().then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key.startsWith('codepal-preview-') && key !== CACHE_NAME)
                        .map((key) => caches.delete(key))
                )
            ),
        ])
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Only handle GET requests
    if (request.method !== 'GET') return;

    // Skip non-cacheable requests (WebSocket upgrades, HMR, etc.)
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__') || url.pathname.includes('/@')) return;

    // Stale-while-revalidate for cacheable resource types
    const destination = request.destination;
    if (!CACHEABLE_TYPES.includes(destination) && destination !== '') return;

    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cachedResponse = await cache.match(request);

            // Always fetch in the background to update the cache
            const fetchPromise = fetch(request)
                .then((networkResponse) => {
                    // Only cache successful responses
                    if (networkResponse.ok) {
                        cache.put(request, networkResponse.clone());
                    }
                    return networkResponse;
                })
                .catch(() => cachedResponse); // Fall back to cache on network failure

            // Return cached response immediately if available, otherwise wait for network
            return cachedResponse || fetchPromise;
        })
    );
});
