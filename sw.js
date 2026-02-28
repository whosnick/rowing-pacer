const CACHE_NAME = 'rowing-pacer-v5';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/PM5Simulator.js',
  '/bluetooth/pm5Service.js',
  '/components/BottomNav.js',
  '/components/EditorView.js',
  '/components/HistoryView.js',
  '/components/HomeView.js',
  '/components/ProgramListView.js',
  '/components/SummaryView.js',
  '/components/WorkoutDetailView.js',
  '/components/WorkoutView.js',
  '/utils/CoachingEngine.js',
  '/utils/c2Service.js',
  '/utils/constants.js',
  '/utils/csafeBuilder.js',
  '/utils/formatters.js',
  '/utils/icons.js',
  '/utils/spmPacer.js',
  '/utils/storage.js',
  '/utils/templateEngine.js',
  '/utils/tts.js',
  '/utils/WorkoutFSM.js',
  '/utils/telemetryBuffer.js',
  '/utils/telemetryBus.js',
  '/utils/zoneTracker.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[SW] Skip waiting');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Cache failed:', error);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Claiming clients');
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request)
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          })
          .catch(() => {
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
          });
      })
  );
});
