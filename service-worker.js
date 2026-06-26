const CACHE_NAME = 'eve-control-v3-r3';

const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/config.js',
  'js/utils.js',
  'js/offline.js',
  'js/auth.js',
  'js/reportes.js',
  'js/voz.js',
  'js/destaraje.js',
  'js/produccion.js',
  'js/pagos.js',
  'js/trazabilidad.js',
  'js/control-produccion.js',
  'js/reportes-ui.js',
  'js/admin-usuarios.js',
  'js/admin-importar.js',
  'js/admin-backup.js',
  'js/admin-config.js',
  'js/admin-datos.js',
  'js/admin.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((nombre) => nombre !== CACHE_NAME)
          .map((nombre) => caches.delete(nombre))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clon = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clon));
        return response;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('index.html');
        }
      });
    })
  );
});
