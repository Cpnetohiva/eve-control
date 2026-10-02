const CACHE_NAME = 'eve-control-v3-r125';

const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/config.js',
  'js/utils.js',
  'js/vista-captura.js',
  'js/offline.js',
  'js/auth.js',
  'js/permisos.js',
  'js/precios.js',
  'js/cxp.js',
  'js/reportes.js',
  'js/voz.js',
  'js/ordenar-tabla.js',
  'js/destaraje.js',
  'js/ventas.js',
  'js/rendimientos.js',
  'js/pagos.js',
  'js/cxc.js',
  'js/cobros.js',
  'js/recibos-pago.js',
  'js/gastos.js',
  'js/trazabilidad.js',
  'js/control-produccion.js',
  'js/inventario.js',
  'js/control-produccion-reglas.js',
  'js/reportes-ui.js',
  'js/dashboard.js',
  'js/admin-usuarios.js',
  'js/admin-roles.js',
  'js/admin-importar.js',
  'js/admin-backup.js',
  'js/admin-config.js',
  'js/admin-datos.js',
  'js/historial.js',
  'js/admin-auditoria.js',
  'js/admin.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap'
];

// Recursos de mejor esfuerzo: se guardan en install pero NO van en APP_SHELL, porque cache.addAll es atómico y una
// respuesta cross-origin que falle (sin CORS, CDN caído) tumbaría toda la instalación. Si no se pudo guardar aquí, el
// manejador fetch lo guarda en tiempo de ejecución la primera vez que se pide con conexión. Solo el candado de
// dispositivos usa fingerprintjs y es fail-open (js/auth.js), así que sin él la app sigue funcionando.
const APP_SHELL_OPCIONAL = [
  'https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@4.6.2/dist/fp.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL).then(() =>
        Promise.all(APP_SHELL_OPCIONAL.map((url) =>
          cache.add(url).catch((error) => console.warn('[sw] No se pudo guardar', url, error))
        ))
      )
    )
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
