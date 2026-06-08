const CACHE_NAME = 'convos-stock-v26';
const ARCHIVOS_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './modules/sync.js',
  './modules/datos.js',
  './modules/ui.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

// Instalación: precaché de archivos estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(ARCHIVOS_CACHE.map((a) => cache.add(a)))
    )
  );
  self.skipWaiting();
});

// Activación: limpia cachés viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch:
//  - Google Sheets / Apps Script: siempre por red
//  - Archivos propios: network-first con fallback a caché (offline OK)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.hostname.includes('googleapis.com') || url.hostname.includes('google.com')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('Sin conexión', { status: 503 }))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return respuesta;
      })
      .catch(() => caches.match(event.request))
  );
});
