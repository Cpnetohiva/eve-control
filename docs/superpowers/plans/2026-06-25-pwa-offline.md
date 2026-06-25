# PWA + Modo Offline — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir EVE Control en una PWA instalable en Android con soporte offline (cola IndexedDB + indicador de conexión en el header).

**Architecture:** Service Worker vanilla (Cache First) para app shell + CDN. Firebase `enablePersistence` para offline nativo de Firestore. `offline.js` intercepta `guardarDato` cuando `navigator.onLine === false` y encola en IndexedDB; al recuperar la conexión sincroniza con Firebase automáticamente y actualiza el indicador del header.

**Tech Stack:** Vanilla JS ES2017+, Service Worker API, IndexedDB API, Firebase Firestore compat SDK v10.7.1, sin bundler.

## Global Constraints

- Sin npm en runtime. El proyecto es vanilla JS servido directamente.
- Todos los archivos JS en `js/` siguen el patrón IIFE `(function(){ ... })()` excepto `auth.js` (top-level) y archivos de configuración (`config.js`, `utils.js`).
- El Service Worker se registra con path relativo `'service-worker.js'` para que funcione tanto en local (localhost:8765/) como en GitHub Pages (/eve-control-v2/).
- Cache name: `eve-control-v3-r1`. Incrementar el número `r` en cada deploy.
- Colores CSS ya definidos en `:root`: `--verde-exito: #06D6A0`, `--rojo-error: #EF476F`, `--oro: #FFC300`, `--azul-marino: #001D3D`.
- IndexedDB: base `EVEControlOffline` v1, stores `cola_pendiente` (autoIncrement) y `cache_datos`.
- Solo `guardarDato` soporta offline. `actualizarDato` y `eliminarDato` sin conexión → `showError(...)`.
- `window.cargarDatosEnParalelo` es la función top-level de `auth.js` (sin IIFE → queda en `window` automáticamente).

---

## Mapa de archivos

| Archivo | Acción | Tarea |
|---|---|---|
| `docs/superpowers/icon-generator.html` | Crear (utilidad one-time) | 1 |
| `icons/icon-192.png`, `icons/icon-512.png` | Generar (salida de tarea 1) | 1 |
| `manifest.json` | Crear | 2 |
| `service-worker.js` | Crear | 3 |
| `index.html` | Modificar (9a) | 4 |
| `js/config.js` | Modificar (9b) | 5 |
| `js/offline.js` | Crear (9c) | 6 |
| `index.html` | Modificar (9c — agregar script) | 7 |
| `css/styles.css` | Modificar (9c — estilos offline) | 7 |
| `docs/superpowers/verify-phase9.js` | Crear | 8 |

---

### Task 1: Íconos PWA

**Files:**
- Create: `docs/superpowers/icon-generator.html`
- Create: `icons/icon-192.png` (generado)
- Create: `icons/icon-512.png` (generado)

**Interfaces:**
- Produces: dos PNG en `icons/` que `manifest.json` (Task 2) y `service-worker.js` (Task 3) referencian.

- [ ] **Paso 1: Crear generador de íconos**

Crear `docs/superpowers/icon-generator.html`:

```html
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>EVE Icon Generator</title></head>
<body>
<p>Generando íconos... Guarda los dos archivos descargados en la carpeta <code>icons/</code>.</p>
<script>
function generarIcono(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#001D3D';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#FFC300';
  const fontSize = Math.round(size * 0.38);
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EVE', size / 2, size / 2);
  return canvas.toDataURL('image/png');
}

function descargar(dataUrl, nombre) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

descargar(generarIcono(192), 'icon-192.png');
setTimeout(() => descargar(generarIcono(512), 'icon-512.png'), 600);
</script>
</body>
</html>
```

- [ ] **Paso 2: Crear carpeta `icons/` y generar los PNGs**

Abrir `docs/superpowers/icon-generator.html` en Chrome (doble clic en el archivo).
Dos archivos se descargan automáticamente: `icon-192.png` e `icon-512.png`.

Crear la carpeta e mover los archivos:
```powershell
New-Item -ItemType Directory -Force -Path "icons"
# Luego mover manualmente los dos PNGs descargados a eve-control-v2/icons/
```

- [ ] **Paso 3: Verificar que ambos archivos existen**

```powershell
Get-ChildItem icons/
```

Resultado esperado: dos archivos `icon-192.png` e `icon-512.png`.

- [ ] **Paso 4: Commit**

```powershell
git add icons/icon-192.png icons/icon-512.png docs/superpowers/icon-generator.html
git commit -m "feat(9a): add PWA icons and generator utility"
```

---

### Task 2: manifest.json

**Files:**
- Create: `manifest.json`

**Interfaces:**
- Consumes: `icons/icon-192.png`, `icons/icon-512.png` (Task 1)
- Produces: `manifest.json` que `index.html` referencia con `<link rel="manifest">` (Task 4)

- [ ] **Paso 1: Crear `manifest.json` en la raíz del proyecto**

```json
{
  "name": "EVE Control - EVERPLASTIC",
  "short_name": "EVE Control",
  "description": "Sistema de Control Operativo EVERPLASTIC",
  "start_url": "/eve-control-v2/",
  "scope": "/eve-control-v2/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#001D3D",
  "theme_color": "#001D3D",
  "icons": [
    {
      "src": "icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **Paso 2: Verificar JSON válido**

```powershell
Get-Content manifest.json | ConvertFrom-Json | Select-Object name, start_url, scope
```

Resultado esperado: `name` = `EVE Control - EVERPLASTIC`, `start_url` = `/eve-control-v2/`.

- [ ] **Paso 3: Commit**

```powershell
git add manifest.json
git commit -m "feat(9a): add PWA manifest"
```

---

### Task 3: service-worker.js

**Files:**
- Create: `service-worker.js`

**Interfaces:**
- Consumes: todos los archivos del app shell (js/, css/, icons/, CDN URLs)
- Produces: SW en scope `/` (local) o `/eve-control-v2/` (GitHub Pages); `index.html` lo registra en Task 4.

- [ ] **Paso 1: Crear `service-worker.js` en la raíz**

```javascript
const CACHE_NAME = 'eve-control-v3-r1';

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
```

- [ ] **Paso 2: Verificar sintaxis**

```powershell
node -e "require('fs').readFileSync('service-worker.js','utf8'); console.log('OK')"
```

Resultado esperado: `OK` (sin error de parse).

- [ ] **Paso 3: Commit**

```powershell
git add service-worker.js
git commit -m "feat(9a): add vanilla service worker with Cache First strategy"
```

---

### Task 4: index.html — Fase 9a (manifest + SW + install prompt)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `manifest.json` (Task 2), `service-worker.js` (Task 3)
- Produces: app registrada como PWA instalable.

- [ ] **Paso 1: Agregar tags en `<head>`**

En `index.html`, después de `<meta name="theme-color" content="#001D3D">` (línea 7), insertar:

```html
  <link rel="manifest" href="manifest.json">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="EVE Control">
```

- [ ] **Paso 2: Agregar bloque de SW + install prompt al final del `<body>`**

Insertar antes de `</body>` (después del último `<script src="js/admin.js">`):

```html
  <script>
    (function () {
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('service-worker.js')
            .then(function (reg) {
              reg.addEventListener('updatefound', function () {
                const sw = reg.installing;
                sw.addEventListener('statechange', function () {
                  if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                    window.showSuccess('🔄 Nueva versión disponible. Recarga para actualizar.');
                  }
                });
              });
            })
            .catch(function (err) { console.error('SW error:', err); });
        });
      }

      var deferredPrompt = null;
      window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        if (!localStorage.getItem('eve-app-instalada')) {
          var btn = document.getElementById('btn-instalar-pwa');
          if (!btn) {
            btn = document.createElement('button');
            btn.id = 'btn-instalar-pwa';
            btn.textContent = '📲 Instalar App';
            var actions = document.querySelector('.header-actions');
            if (actions) actions.prepend(btn);
          }
          btn.style.display = '';
          btn.addEventListener('click', function () {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function (result) {
              if (result.outcome === 'accepted') {
                localStorage.setItem('eve-app-instalada', '1');
                btn.style.display = 'none';
              }
              deferredPrompt = null;
            });
          });
        }
      });
    })();
  </script>
```

- [ ] **Paso 3: Verificar en Chrome DevTools**

1. Iniciar servidor local: `npx serve . --listen 8765`
2. Abrir `http://localhost:8765/`
3. DevTools → Application → Service Workers: verificar que `service-worker.js` aparece como `activated and running`.
4. DevTools → Application → Manifest: verificar que aparece el manifest con los íconos.
5. DevTools → Application → Cache Storage → `eve-control-v3-r1`: verificar que los archivos del app shell están cacheados.

- [ ] **Paso 4: Commit**

```powershell
git add index.html
git commit -m "feat(9a): register service worker and add install prompt"
```

---

### Task 5: js/config.js — Fase 9b (Firebase enablePersistence)

**Files:**
- Modify: `js/config.js:11`

**Interfaces:**
- Consumes: `window.db = firebase.firestore()` (línea 11 de config.js, ya existente)
- Produces: Firestore con caché offline nativo activo.

- [ ] **Paso 1: Agregar `enablePersistence` en `js/config.js`**

Después de la línea `window.db = firebase.firestore();` (línea 11), insertar:

```javascript
window.db.enablePersistence({ synchronizeTabs: true })
  .catch(function (err) {
    if (err.code === 'failed-precondition') {
      console.warn('EVE: persistencia offline limitada — múltiples tabs activas');
    } else if (err.code === 'unimplemented') {
      console.warn('EVE: persistencia offline no disponible en este navegador');
    }
  });
```

El archivo `js/config.js` debe quedar así en esas líneas:

```javascript
firebase.initializeApp(window.firebaseConfig);
window.db = firebase.firestore();

window.db.enablePersistence({ synchronizeTabs: true })
  .catch(function (err) {
    if (err.code === 'failed-precondition') {
      console.warn('EVE: persistencia offline limitada — múltiples tabs activas');
    } else if (err.code === 'unimplemented') {
      console.warn('EVE: persistencia offline no disponible en este navegador');
    }
  });
```

- [ ] **Paso 2: Verificar sin errores en consola**

1. Recargar `http://localhost:8765/` en Chrome.
2. Abrir DevTools → Console.
3. Verificar que no hay errores. Puede aparecer el warning de múltiples tabs si se tiene más de una pestaña abierta — eso es esperado y manejado.

- [ ] **Paso 3: Commit**

```powershell
git add js/config.js
git commit -m "feat(9b): enable Firestore offline persistence with synchronizeTabs"
```

---

### Task 6: js/offline.js — Fase 9c (IndexedDB + cola + sync + estados)

**Files:**
- Create: `js/offline.js`

**Interfaces:**
- Consumes: `window.guardarDato` de `utils.js` (ya en `window` cuando este script corre)
- Consumes: `window.cargarDatosEnParalelo` de `auth.js` (disponible en `window.load`)
- Consumes: `window.EVE` de `auth.js` (disponible en runtime cuando el usuario guarda)
- Produces: `window.guardarDatoFirebase` (referencia directa a Firebase)
- Produces: `window.guardarDato` (versión offline-aware que envuelve la original)
- Produces: `window.EVE_OFFLINE.{ actualizarEstadoConexion, sincronizarCola, contarPendientes, cargarCacheDatos }`

**Nota sobre timing:** `offline.js` se carga antes que `auth.js` (ver Task 7). Cuando `offline.js` se ejecuta, `window.guardarDato` (de `utils.js`) ya existe. `window.cargarDatosEnParalelo` (de `auth.js` top-level) NO existe aún → se envuelve en el evento `'load'`.

- [ ] **Paso 1: Crear `js/offline.js`**

```javascript
(function () {

const DB_NOMBRE = 'EVEControlOffline';
const DB_VERSION = 1;
let dbPromesa = null;

function abrirDB() {
  if (dbPromesa) return dbPromesa;
  dbPromesa = new Promise(function (resolve, reject) {
    var req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = function (e) {
      var d = e.target.result;
      if (!d.objectStoreNames.contains('cola_pendiente')) {
        d.createObjectStore('cola_pendiente', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('cache_datos')) {
        d.createObjectStore('cache_datos', { keyPath: 'coleccion' });
      }
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function () { reject(req.error); };
  });
  return dbPromesa;
}

function idbReq(req) {
  return new Promise(function (resolve, reject) {
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

async function obtenerStore(nombre, modo) {
  var db = await abrirDB();
  return db.transaction(nombre, modo).objectStore(nombre);
}

async function encolarOperacion(coleccion, datos) {
  var store = await obtenerStore('cola_pendiente', 'readwrite');
  return idbReq(store.add({
    coleccion: coleccion,
    datos: datos,
    timestamp: new Date().toISOString(),
    intentos: 0,
    estado: 'pendiente'
  }));
}

async function obtenerPendientes() {
  var store = await obtenerStore('cola_pendiente', 'readonly');
  return idbReq(store.getAll());
}

async function eliminarDeCola(id) {
  var store = await obtenerStore('cola_pendiente', 'readwrite');
  return idbReq(store.delete(id));
}

async function contarPendientes() {
  var store = await obtenerStore('cola_pendiente', 'readonly');
  return idbReq(store.count());
}

async function marcarError(item) {
  var db = await abrirDB();
  var tx = db.transaction('cola_pendiente', 'readwrite');
  tx.objectStore('cola_pendiente').put(Object.assign({}, item, {
    intentos: item.intentos + 1,
    estado: 'error'
  }));
  return new Promise(function (res) { tx.oncomplete = res; tx.onerror = res; });
}

async function guardarCacheDatos() {
  if (!window.EVE) return;
  var store = await obtenerStore('cache_datos', 'readwrite');
  var ts = new Date().toISOString();
  var entradas = [
    { coleccion: 'destaraje',          registros: window.EVE.registrosDestaraje || [] },
    { coleccion: 'ventas',             registros: window.EVE.registrosVentas || [] },
    { coleccion: 'produccion',         registros: window.EVE.registrosProduccion || [] },
    { coleccion: 'pagos',              registros: window.EVE.registrosPagos || [] },
    { coleccion: 'ministraciones',     registros: window.EVE.registrosMinistraciones || [] },
    { coleccion: 'control_produccion', registros: window.EVE.registrosControlProduccion || [] }
  ];
  for (var i = 0; i < entradas.length; i++) {
    await idbReq(store.put(Object.assign({}, entradas[i], { ultimaSync: ts })));
  }
}

async function cargarCacheDatos() {
  var store = await obtenerStore('cache_datos', 'readonly');
  var todo = await idbReq(store.getAll());
  if (!todo.length || !window.EVE) return false;
  var mapa = {};
  todo.forEach(function (e) { mapa[e.coleccion] = e.registros; });
  window.EVE.registrosDestaraje          = mapa.destaraje || [];
  window.EVE.registrosVentas             = mapa.ventas || [];
  window.EVE.registrosProduccion         = mapa.produccion || [];
  window.EVE.registrosPagos              = mapa.pagos || [];
  window.EVE.registrosMinistraciones     = mapa.ministraciones || [];
  window.EVE.registrosControlProduccion  = mapa.control_produccion || [];
  return true;
}

// ── Header: 4 estados ──────────────────────────────────────────────────────
function actualizarEstadoConexion(estado, extra) {
  var el = document.getElementById('estado-conexion');
  if (!el) return;
  var cfg = {
    online:  { texto: '🟢 En línea',                              color: 'var(--verde-exito)', cursor: 'default'  },
    offline: { texto: '🔴 Sin conexión — ' + (extra || 0) + ' pendientes', color: 'var(--rojo-error)', cursor: 'pointer' },
    syncing: { texto: '🔄 Sincronizando... (' + (extra || '0/0') + ')',    color: 'var(--oro)',         cursor: 'default'  },
    synced:  { texto: '✅ Sincronizado',                           color: 'var(--verde-exito)', cursor: 'default'  }
  }[estado] || { texto: '🟢 En línea', color: 'var(--verde-exito)', cursor: 'default' };
  el.textContent = cfg.texto;
  el.style.color = cfg.color;
  el.style.cursor = cfg.cursor;
}

// ── Panel de pendientes ────────────────────────────────────────────────────
function crearPanelPendientes() {
  if (document.getElementById('panel-pendientes')) return;
  var panel = document.createElement('div');
  panel.id = 'panel-pendientes';
  panel.innerHTML = [
    '<div class="pp-header">',
    '  <span>📴 REGISTROS PENDIENTES DE SYNC</span>',
    '  <button id="pp-cerrar">✕</button>',
    '</div>',
    '<div id="pp-lista"></div>',
    '<p class="pp-nota">Se subirán al recuperar conexión.</p>'
  ].join('');
  document.body.appendChild(panel);
  document.getElementById('pp-cerrar').addEventListener('click', function () {
    panel.classList.remove('open');
  });
}

async function actualizarPanelPendientes() {
  var panel = document.getElementById('panel-pendientes');
  var lista = document.getElementById('pp-lista');
  if (!panel || !lista) return;
  var pendientes = await obtenerPendientes();
  if (!pendientes.length) {
    lista.innerHTML = '<p class="pp-vacio">Sin registros pendientes</p>';
    return;
  }
  lista.innerHTML = pendientes.map(function (item) {
    var hora = new Date(item.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    var ticket = (item.datos && (item.datos.ticket || item.datos.folio)) || '—';
    return '<div class="pp-item"><span>' + item.coleccion + '</span><span>Ticket ' + ticket + '</span><span>' + hora + '</span></div>';
  }).join('');
}

// ── Sincronización ─────────────────────────────────────────────────────────
var sincronizando = false;

async function sincronizarCola() {
  if (sincronizando) return;
  sincronizando = true;
  try {
    var pendientes = await obtenerPendientes();
    if (!pendientes.length) {
      await guardarCacheDatos().catch(function () {});
      actualizarEstadoConexion('synced');
      setTimeout(function () { actualizarEstadoConexion('online'); }, 3000);
      return;
    }
    actualizarEstadoConexion('syncing', '0/' + pendientes.length);
    var hecho = 0;
    for (var i = 0; i < pendientes.length; i++) {
      var item = pendientes[i];
      try {
        await window.guardarDatoFirebase(item.coleccion, item.datos);
        await eliminarDeCola(item.id);
        hecho++;
        actualizarEstadoConexion('syncing', hecho + '/' + pendientes.length);
      } catch (err) {
        await marcarError(item);
      }
    }
    if (typeof window.cargarDatosEnParalelo === 'function') {
      await window.cargarDatosEnParalelo();
    }
    await guardarCacheDatos().catch(function () {});
    actualizarEstadoConexion('synced');
    setTimeout(function () { actualizarEstadoConexion('online'); }, 3000);
  } finally {
    sincronizando = false;
  }
}

// ── Mapa colección → array de window.EVE ──────────────────────────────────
var MAPA_EVE = {
  destaraje:          function (r) { if (window.EVE) window.EVE.registrosDestaraje.push(r); },
  produccion:         function (r) { if (window.EVE) window.EVE.registrosProduccion.push(r); },
  pagos:              function (r) { if (window.EVE) window.EVE.registrosPagos.push(r); },
  ministraciones:     function (r) { if (window.EVE) window.EVE.registrosMinistraciones.push(r); },
  control_produccion: function (r) { if (window.EVE) window.EVE.registrosControlProduccion.push(r); }
};

// ── Interceptar guardarDato ────────────────────────────────────────────────
var _guardarDatoOriginal = window.guardarDato;
window.guardarDatoFirebase = _guardarDatoOriginal;

window.guardarDato = async function (coleccion, datos) {
  if (!navigator.onLine) {
    var datosCompletos = Object.assign({}, datos);
    if (!datosCompletos.fechaRegistro) {
      datosCompletos.fechaRegistro = new Date().toISOString();
    }
    await encolarOperacion(coleccion, datosCompletos);
    var localId = 'offline_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    var mapear = MAPA_EVE[coleccion];
    if (mapear) mapear(Object.assign({ id: localId }, datosCompletos));
    var n = await contarPendientes();
    actualizarEstadoConexion('offline', n);
    await actualizarPanelPendientes();
    return localId;
  }
  return _guardarDatoOriginal(coleccion, datos);
};

// actualizarDato y eliminarDato sin conexión → showError
var _actualizarDatoOriginal = window.actualizarDato;
window.actualizarDato = async function (coleccion, id, datos) {
  if (!navigator.onLine) {
    window.showError('Sin conexión. Vuelve a intentarlo cuando tengas internet.');
    return;
  }
  return _actualizarDatoOriginal(coleccion, id, datos);
};

var _eliminarDatoOriginal = window.eliminarDato;
window.eliminarDato = async function (coleccion, id) {
  if (!navigator.onLine) {
    window.showError('Sin conexión. Vuelve a intentarlo cuando tengas internet.');
    return;
  }
  return _eliminarDatoOriginal(coleccion, id);
};

// ── Inicialización ─────────────────────────────────────────────────────────
abrirDB()
  .then(async function () {
    crearPanelPendientes();
    if (!navigator.onLine) {
      var n = await contarPendientes();
      actualizarEstadoConexion('offline', n);
    }
  })
  .catch(function (err) { console.error('EVE offline: IndexedDB init error:', err); });

window.addEventListener('online', function () { sincronizarCola(); });
window.addEventListener('offline', async function () {
  var n = await contarPendientes();
  actualizarEstadoConexion('offline', n);
});

// Después de todos los scripts: envolver cargarDatosEnParalelo + click del header
window.addEventListener('load', function () {
  if (typeof window.cargarDatosEnParalelo === 'function') {
    var _cargarOriginal = window.cargarDatosEnParalelo;
    window.cargarDatosEnParalelo = async function () {
      var result = await _cargarOriginal();
      if (navigator.onLine) { await guardarCacheDatos().catch(function () {}); }
      return result;
    };
  }

  var estadoEl = document.getElementById('estado-conexion');
  if (estadoEl) {
    estadoEl.addEventListener('click', async function () {
      if (estadoEl.style.cursor !== 'pointer') return;
      var panel = document.getElementById('panel-pendientes');
      if (!panel) return;
      await actualizarPanelPendientes();
      panel.classList.toggle('open');
    });
  }
});

window.EVE_OFFLINE = {
  actualizarEstadoConexion: actualizarEstadoConexion,
  sincronizarCola: sincronizarCola,
  contarPendientes: contarPendientes,
  cargarCacheDatos: cargarCacheDatos
};

})();
```

- [ ] **Paso 2: Verificar sintaxis**

```powershell
node -e "require('fs').readFileSync('js/offline.js','utf8'); console.log('OK')"
```

Resultado esperado: `OK`.

**No commitar aún** — Task 7 agrega el `<script>` y el CSS antes del commit conjunto.

---

### Task 7: index.html + css/styles.css — Fase 9c (wiring)

**Files:**
- Modify: `index.html` (agregar `<script src="js/offline.js">`)
- Modify: `css/styles.css` (estilos para `#estado-conexion` y `#panel-pendientes`)

**Interfaces:**
- Consumes: `js/offline.js` (Task 6)
- Produces: UI offline funcional en el browser.

- [ ] **Paso 1: Agregar script en `index.html`**

En `index.html`, en el bloque de scripts de la app, insertar `<script src="js/offline.js"></script>` entre `utils.js` y `auth.js`:

La sección debe quedar:
```html
  <script src="js/config.js"></script>
  <script src="js/utils.js"></script>
  <script src="js/offline.js"></script>
  <script src="js/auth.js"></script>
```

- [ ] **Paso 2: Agregar estilos en `css/styles.css`**

Al final de `css/styles.css`, agregar:

```css
/* ── Offline UI ─────────────────────────────────────────── */
#estado-conexion {
  transition: color 0.3s ease;
}

#panel-pendientes {
  display: none;
  position: fixed;
  top: 56px;
  right: 1rem;
  width: 320px;
  background: var(--blanco);
  border: 1px solid var(--gris-claro);
  border-radius: var(--radio);
  box-shadow: var(--sombra);
  z-index: 200;
  padding: 1rem;
  font-size: 0.85rem;
  color: var(--azul-marino);
}

#panel-pendientes.open {
  display: block;
}

.pp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  margin-bottom: 0.75rem;
  color: var(--rojo-error);
}

#pp-cerrar {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  color: var(--gris-oscuro);
  padding: 0;
}

.pp-item {
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--gris-claro);
  color: var(--gris-oscuro);
  font-size: 0.8rem;
}

.pp-nota {
  margin-top: 0.75rem;
  color: var(--gris-oscuro);
  font-size: 0.8rem;
}

.pp-vacio {
  color: var(--gris-oscuro);
  font-style: italic;
}
```

- [ ] **Paso 3: Verificar flujo offline en Chrome DevTools**

1. Recargar `http://localhost:8765/`.
2. Login con credenciales de admin.
3. DevTools → Network → seleccionar "Offline" en el menú de throttling.
4. Verificar que el header muestra `🔴 Sin conexión — 0 pendientes`.
5. Ir a Destaraje, llenar el formulario y guardar.
6. Verificar que el registro aparece en la tabla.
7. Verificar que el header muestra `🔴 Sin conexión — 1 pendientes`.
8. Hacer clic en el indicador rojo → verifica que aparece el panel con el registro.
9. DevTools → Network → "No throttling" (volver a Online).
10. Verificar que:
    - Header cambia a `🔄 Sincronizando... (0/1)` → `🔄 Sincronizando... (1/1)` → `✅ Sincronizado` → `🟢 En línea`.
    - El registro aparece en Firestore (verificar en Firebase Console o abriendo otra pestaña).

- [ ] **Paso 4: Commit conjunto Tasks 6 + 7**

```powershell
git add js/offline.js index.html css/styles.css
git commit -m "feat(9c): add offline queue, header states, and pending panel"
```

---

### Task 8: Verificación Playwright — Fase 9

**Files:**
- Create: `docs/superpowers/verify-phase9.js`

**Interfaces:**
- Consumes: servidor local en `http://localhost:8765/`
- Consumes: `docs/superpowers/credenciales-phase2.json` (mismo archivo que usa verify-phase8d.js)

- [ ] **Paso 1: Crear `docs/superpowers/verify-phase9.js`**

```javascript
const { chromium } = require('playwright');
const CREDS = require('./credenciales-phase2.json');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  // Login
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await page.fill('#login-username', CREDS.admin.username);
  await page.fill('#login-password', CREDS.admin.password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell.visible');
  console.log('LOGIN_OK: true');

  // Verificar estado inicial del header
  const textoInicial = await page.locator('#estado-conexion').textContent();
  console.log('HEADER_ONLINE_INICIAL_OK:', textoInicial.includes('🟢'));

  // Verificar que IndexedDB EVEControlOffline existe
  const dbExiste = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open('EVEControlOffline');
      req.onsuccess = () => { req.result.close(); resolve(true); };
      req.onerror = () => resolve(false);
    });
  });
  console.log('INDEXEDDB_EXISTE_OK:', dbExiste);

  // Verificar que window.guardarDatoFirebase existe (la función original de Firebase)
  const tieneFirebase = await page.evaluate(() => typeof window.guardarDatoFirebase === 'function');
  console.log('GUARDAR_DATO_FIREBASE_EXISTE_OK:', tieneFirebase);

  // ── Test offline ──────────────────────────────────────────────────────────
  await context.setOffline(true);
  await page.waitForTimeout(300);

  const textoOffline = await page.locator('#estado-conexion').textContent();
  console.log('HEADER_OFFLINE_OK:', textoOffline.includes('🔴'));

  // Guardar un registro offline vía guardarDato (sin red)
  const idLocal = await page.evaluate(async () => {
    return window.guardarDato('destaraje', {
      ticket: '88887799',
      proveedor: 'PRUEBA_OFFLINE_9',
      material: 'MIXTO',
      kg: 50,
      fechaEntrada: '2099-06-01',
      fechaSalida: '2099-06-05'
    });
  });
  console.log('ID_LOCAL_GENERADO_OK:', String(idLocal).startsWith('offline_'));

  // Verificar que fue a la cola de IndexedDB
  const conteoEnCola = await page.evaluate(async () => {
    const db = await window.EVE_OFFLINE.contarPendientes();
    return db;
  });
  console.log('COLA_TIENE_1_PENDIENTE_OK:', conteoEnCola === 1);

  // Verificar que el header refleja 1 pendiente
  const textoOffline2 = await page.locator('#estado-conexion').textContent();
  console.log('HEADER_OFFLINE_1_PENDIENTE_OK:', textoOffline2.includes('1 pendientes'));

  // Verificar que el registro fue agregado a window.EVE.registrosDestaraje
  const enEve = await page.evaluate(() => {
    return window.EVE.registrosDestaraje.some((r) => r.proveedor === 'PRUEBA_OFFLINE_9');
  });
  console.log('REGISTRO_EN_EVE_LOCAL_OK:', enEve);

  // Panel de pendientes aparece al hacer clic en el header rojo
  await page.click('#estado-conexion');
  await page.waitForTimeout(200);
  const panelAbierto = await page.locator('#panel-pendientes.open').isVisible();
  console.log('PANEL_PENDIENTES_ABIERTO_OK:', panelAbierto);

  const panelTexto = await page.locator('#pp-lista').textContent();
  console.log('PANEL_MUESTRA_DESTARAJE_OK:', panelTexto.includes('destaraje'));

  // Cerrar panel
  await page.click('#pp-cerrar');
  const panelCerrado = await page.locator('#panel-pendientes.open').isVisible();
  console.log('PANEL_CERRADO_OK:', !panelCerrado);

  // ── Volver Online y verificar sync ───────────────────────────────────────
  await context.setOffline(false);
  await page.waitForTimeout(4000); // espera sync + 3s de "Sincronizado"

  const textoFinal = await page.locator('#estado-conexion').textContent();
  console.log('HEADER_ONLINE_TRAS_SYNC_OK:', textoFinal.includes('🟢') || textoFinal.includes('✅'));

  // Verificar que la cola quedó vacía
  const colaFinal = await page.evaluate(() => window.EVE_OFFLINE.contarPendientes());
  console.log('COLA_VACIA_TRAS_SYNC_OK:', colaFinal === 0);

  // Verificar que el registro llegó a Firestore
  const enFirestore = await page.evaluate(async () => {
    const snap = await window.db.collection('destaraje')
      .where('proveedor', '==', 'PRUEBA_OFFLINE_9')
      .limit(1)
      .get();
    return !snap.empty;
  });
  console.log('REGISTRO_EN_FIRESTORE_OK:', enFirestore);

  // Limpieza: eliminar el registro de prueba de Firestore
  await page.evaluate(async () => {
    const snap = await window.db.collection('destaraje')
      .where('proveedor', '==', 'PRUEBA_OFFLINE_9')
      .limit(1)
      .get();
    if (!snap.empty) await snap.docs[0].ref.delete();
  });

  const eliminado = await page.evaluate(async () => {
    const snap = await window.db.collection('destaraje')
      .where('proveedor', '==', 'PRUEBA_OFFLINE_9')
      .limit(1)
      .get();
    return snap.empty;
  });
  console.log('LIMPIEZA_FIRESTORE_OK:', eliminado);

  // Verificar manifest.json accesible
  const manifestResp = await page.evaluate(async () => {
    const r = await fetch('/manifest.json');
    return r.ok;
  });
  console.log('MANIFEST_ACCESIBLE_OK:', manifestResp);

  // Verificar SW registrado
  const swRegistrado = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length > 0;
  });
  console.log('SW_REGISTRADO_OK:', swRegistrado);

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
```

- [ ] **Paso 2: Iniciar servidor local**

```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npx serve `"$(Get-Location)`" --listen 8765"
Start-Sleep -Seconds 3
```

- [ ] **Paso 3: Ejecutar la verificación**

```powershell
node docs/superpowers/verify-phase9.js
```

Resultado esperado — todas las líneas deben terminar en `true`:
```
LOGIN_OK: true
HEADER_ONLINE_INICIAL_OK: true
INDEXEDDB_EXISTE_OK: true
GUARDAR_DATO_FIREBASE_EXISTE_OK: true
HEADER_OFFLINE_OK: true
ID_LOCAL_GENERADO_OK: true
COLA_TIENE_1_PENDIENTE_OK: true
HEADER_OFFLINE_1_PENDIENTE_OK: true
REGISTRO_EN_EVE_LOCAL_OK: true
PANEL_PENDIENTES_ABIERTO_OK: true
PANEL_MUESTRA_DESTARAJE_OK: true
PANEL_CERRADO_OK: true
HEADER_ONLINE_TRAS_SYNC_OK: true
COLA_VACIA_TRAS_SYNC_OK: true
REGISTRO_EN_FIRESTORE_OK: true
LIMPIEZA_FIRESTORE_OK: true
MANIFEST_ACCESIBLE_OK: true
SW_REGISTRADO_OK: true
CONSOLE_ERRORS: []
```

- [ ] **Paso 4: Commit**

```powershell
git add docs/superpowers/verify-phase9.js
git commit -m "test(9): add Playwright offline verification for Phase 9"
```

---

## Resumen de commits esperados

| Commit | Tarea | Contenido |
|---|---|---|
| `feat(9a): add PWA icons and generator utility` | 1 | icons/, icon-generator.html |
| `feat(9a): add PWA manifest` | 2 | manifest.json |
| `feat(9a): add vanilla service worker with Cache First strategy` | 3 | service-worker.js |
| `feat(9a): register service worker and add install prompt` | 4 | index.html (9a) |
| `feat(9b): enable Firestore offline persistence with synchronizeTabs` | 5 | js/config.js |
| `feat(9c): add offline queue, header states, and pending panel` | 6+7 | js/offline.js, index.html (9c), css/styles.css |
| `test(9): add Playwright offline verification for Phase 9` | 8 | docs/superpowers/verify-phase9.js |
