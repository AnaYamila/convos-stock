const CACHE_NAME = 'convos-stock-v4';
const ARCHIVOS_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './modules/sync.js',
  './modules/clientes.js',
  './modules/stock.js',
  './modules/ventas.js',
  './modules/cobranzas.js',
  './modules/entregas.js',
  './modules/importar.js',
  './modules/extras.js',
  './manifest.json'
];

// Instalación: precaché de archivos estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // allSettled: si algún archivo falla, no rompe toda la instalación
      Promise.allSettled(ARCHIVOS_CACHE.map((a) => cache.add(a)))
    )
  );
  self.skipWaiting();
});

// Activación: limpia cachés viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch:
//  - Google Sheets: siempre por red
//  - Archivos propios (mismo origen): NETWORK-FIRST → siempre traés la versión
//    más nueva cuando hay internet; si no hay, caés a la caché (offline OK).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Peticiones a Google Sheets / Apps Script siempre van por red
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('google.com')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('Sin conexión', { status: 503 }))
    );
    return;
  }

  // Solo manejamos recursos del mismo origen
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((respuesta) => {
        // Guardamos copia fresca en caché
        const copia = respuesta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return respuesta;
      })
      .catch(() => caches.match(event.request)) // sin red → caché
  );
});
