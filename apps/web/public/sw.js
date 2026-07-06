// E-Logbook Enterprise Service Worker
// Cache-first strategy for static assets, network-first for everything else

const CACHE_NAME = 'elogbook-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

const OFFLINE_FALLBACK = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>E-Logbook — Offline</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #F2F2F7;
      color: #1C1C1E;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .offline-card {
      background: rgba(255,255,255,0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 20px;
      padding: 40px;
      text-align: center;
      max-width: 360px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.08);
    }
    .offline-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px;
      background: #007AFF;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      color: white;
    }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    p { font-size: 15px; color: #6D6D73; line-height: 1.5; }
    .retry-btn {
      margin-top: 24px;
      display: inline-block;
      padding: 12px 28px;
      background: #007AFF;
      color: white;
      border: none;
      border-radius: 24px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: opacity 0.2s;
    }
    .retry-btn:hover { opacity: 0.8; }
  </style>
</head>
<body>
  <div class="offline-card">
    <div class="offline-icon">📋</div>
    <h1>You're offline</h1>
    <p>E-Logbook needs an internet connection to load. Some previously viewed data may still be available.</p>
    <a class="retry-btn" href="/">Retry</a>
  </div>
</body>
</html>
`;

// Install event: precache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event: cache-first for static, network-first for API/navigation
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Cache-first for static assets (js, css, fonts, images, svg, manifest)
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'image' ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.json')
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Network-first for navigation and API calls
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Return offline fallback for HTML navigation
    if (request.mode === 'navigate') {
      return new Response(OFFLINE_FALLBACK, {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    }

    return new Response('Offline', { status: 503 });
  }
}
