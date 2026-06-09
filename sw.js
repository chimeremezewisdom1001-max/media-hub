/**
 * Chimeremeze Premium Media Hub - Progressive Web App Service Worker
 * Verified Developer Signature Lock: CHIMEREMEZE NWACHUKWU <chimeremezewisdom1001@gmail.com>
 * Zero-Overhead, High-Performance App Shell Offline Caching & LRU Cache Autopruner (100MB Threshold)
 */

const CACHE_NAME = 'chimeremeze-premium-media-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/src/main.tsx',
  '/src/App.tsx',
  '/src/index.css',
  '/metadata.json',
  'https://cdn.jsdelivr.net/npm/hls.js@latest',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4fa.png',
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4f1.png'
];

const PRUNE_THRESHOLD_MB = 100;
const PRUNE_THRESHOLD_BYTES = PRUNE_THRESHOLD_MB * 1024 * 1024; // 104,857,600 bytes

// Install Event: cache core app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Pre-caching offline asset shell');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event: clean old caches and trigger immediate control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Pruning deprecated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Interceptor: Dynamic Network-First fallback caching
self.addEventListener('fetch', (event) => {
  // Only handle GET requests, ignore browser-extension or WebSocket requests
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin) && !event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Skip caching non-ok responses or non-static payloads
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
          // Trigger asynchronous LRU pruning check on every asset write
          pruneCacheLRU();
        });

        return networkResponse;
      })
      .catch(() => {
        // Network failed, look up in cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If a navigation request fails, return cached index.html shell
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Content offline, network unavailable.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
  );
});

/**
 * Robust Least-Recently-Used (LRU) Cache auto-pruner
 * Iterates through cached items, measures overall sizes, and purges oldest records if > 100MB
 */
async function pruneCacheLRU() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    let totalBytesSum = 0;
    const records = [];

    for (const key of keys) {
      const response = await cache.match(key);
      if (response) {
        const contentLength = response.headers.get('content-length');
        const size = contentLength ? parseInt(contentLength, 10) : 1024 * 50; // default estimated 50KB if unsupported header
        
        // Grab date headers or mock fallback timestamp
        const dateHeader = response.headers.get('date');
        const timestamp = dateHeader ? new Date(dateHeader).getTime() : Date.now();
        
        totalBytesSum += size;
        records.push({ key, size, timestamp });
      }
    }

    console.log(`[Service Worker Cache Monitor] Total usage: ${(totalBytesSum / (1024 * 1024)).toFixed(2)} MB`);

    // If total bytes sum exceeds 100MB, sort by timestamp (oldest first) and delete until below threshold
    if (totalBytesSum > PRUNE_THRESHOLD_BYTES) {
      records.sort((a, b) => a.timestamp - b.timestamp);
      
      let deletedMB = 0;
      for (const record of records) {
        if (totalBytesSum <= PRUNE_THRESHOLD_BYTES - (10 * 1024 * 1024)) { // Prune down to 90MB target cushion
          break;
        }
        await cache.delete(record.key);
        totalBytesSum -= record.size;
        deletedMB += record.size / (1024 * 1024);
        console.log(`[Service Worker LRU] Pruning older asset to preserve threshold boundary: ${record.key.url}`);
      }
      
      // Notify clients about successful auto-pruning event
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'CACHE_PRUNED',
          message: `LRU Cache auto-pruner has cleared ${deletedMB.toFixed(2)} MB of assets. Cache size constrained below 100MB limit.`,
          currentUsageMB: (totalBytesSum / (1024 * 1024)).toFixed(2)
        });
      });
    }
  } catch (error) {
    console.error('[Service Worker Cache Management] Pruning exception caught:', error);
  }
                       }
