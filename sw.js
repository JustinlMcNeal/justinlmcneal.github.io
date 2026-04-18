// ─────────────────────────────────────────────────────────
// KARRY KRAZE — Service Worker (sw.js)
// Caching strategy: Network-first for pages, Cache-first for assets
// ─────────────────────────────────────────────────────────

const CACHE_VERSION = 'kk-v4';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/css/theme/base.css',
  '/css/theme/components.css',
  '/imgs/icons/icon-192x192.png',
  '/imgs/brand/logo-bwp.png',
  '/page_inserts/navbar.html',
  '/page_inserts/footer.html',
  '/page_inserts/home/banner.html',
  '/page_inserts/home/99cent.html',
  '/page_inserts/home/catalog.html',
];

// Max items in dynamic caches
const MAX_DYNAMIC = 50;
const MAX_IMAGES = 100;

// ── Install: pre-cache static shell ──────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ───────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('kk-') && key !== STATIC_CACHE && key !== DYNAMIC_CACHE && key !== IMAGE_CACHE)
          .map((key) => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ──────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests (except Supabase storage for product images)
  if (request.method !== 'GET') return;

  // Skip Supabase API calls (functions, auth, realtime)
  if (url.hostname.includes('supabase.co') && !url.pathname.includes('/storage/')) return;

  // Skip external APIs (Stripe, CDNs for Tailwind, etc.)
  if (url.hostname !== self.location.hostname && !url.hostname.includes('supabase.co')) return;

  // Images: cache-first
  if (isImageRequest(request)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, MAX_IMAGES));
    return;
  }

  // HTML pages: network-first (always try to get latest)
  if (request.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(networkFirst(request));
    return;
  }

  // CSS/JS: stale-while-revalidate
  if (url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE, MAX_DYNAMIC));
    return;
  }

  // Everything else: network-first
  event.respondWith(networkFirst(request));
});

// ── Push notification handler ────────────────────────────
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');

  let data = { title: 'KARRY KRAZE', body: 'You have a new notification!', url: '/' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/imgs/icons/icon-192x192.png',
    badge: '/imgs/icons/icon-96x96.png',
    image: data.image || undefined,
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' },
    actions: data.actions || [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    tag: data.tag || 'kk-notification',
    renotify: !!data.tag,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Notification click handler ───────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // If a window is already open, focus it and navigate
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Otherwise open a new window
        return self.clients.openWindow(targetUrl);
      })
  );
});

// ── Background sync (future: retry failed form submissions) ───
self.addEventListener('sync', (event) => {
  console.log('[SW] Sync event:', event.tag);
  // Reserved for future: retry failed review submissions, etc.
});


// ═══════════════════════════════════════════════════════════
// Caching strategies
// ═══════════════════════════════════════════════════════════

function isImageRequest(request) {
  const url = new URL(request.url);
  return (
    request.destination === 'image' ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?.*)?$/i.test(url.pathname) ||
    (url.hostname.includes('supabase.co') && url.pathname.includes('/storage/'))
  );
}

// Network first, fallback to cache, then offline page
async function networkFirst(request) {
  try {
    let response = await fetch(request);
    // Retry once on 503 (Cloudflare transient error)
    if (response.status === 503) {
      await new Promise(r => setTimeout(r, 1000));
      response = await fetch(request);
    }
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
      return response;
    }
    // Server error — try cache before returning error
    const cached = await caches.match(request);
    if (cached) return cached;
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Fallback to offline page for navigation requests
    if (request.headers.get('accept')?.includes('text/html')) {
      const offline = await caches.match('/offline.html');
      return offline || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } });
    }
    return new Response('Offline', { status: 503 });
  }
}

// Cache first, fallback to network
async function cacheFirst(request, cacheName, maxItems) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      trimCache(cacheName, maxItems);
    }
    return response;
  } catch {
    // Return a 1x1 transparent PNG as fallback for images
    return new Response(
      Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0)),
      { headers: { 'Content-Type': 'image/png' } }
    );
  }
}

// Stale-while-revalidate: serve from cache, update in background
async function staleWhileRevalidate(request, cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
      trimCache(cacheName, maxItems);
    }
    return response;
  }).catch(() => null);

  return cached || await fetchPromise || new Response('Offline', { status: 503 });
}

// Trim cache to max size (LRU-style: delete oldest)
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    trimCache(cacheName, maxItems);
  }
}
