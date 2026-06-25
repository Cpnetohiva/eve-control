# Fase 9 — PWA + Modo Offline

Fuente: `EVERPLASTIC COO.md` (sección "MODO OFFLINE (PWA)"). Continúa
la Fase 8d, ya fusionada a `master`. Implementación en 3 sub-fases
secuenciales e independientemente verificables.

Dispositivo objetivo: **Android Chrome** (único requisito de campo).
Enfoque técnico: **Service Worker vanilla** (sin Workbox), alineado con
el patrón del proyecto (vanilla JS, sin bundler ni dependencias de
runtime salvo Firebase/jsPDF/SheetJS).

---

## Sub-fases

| Sub-fase | Nombre | Entrega |
|---|---|---|
| **9a** | Instalable | App instalable en Android, app shell cacheado, funciona sin red para lectura |
| **9b** | Firebase offline nativo | `enablePersistence()` — lectura y escritura offline básica sin UI adicional |
| **9c** | Cola propia + UI de estado | IndexedDB, interceptación de escrituras, 4 estados en header, panel de pendientes |

---

## Fase 9a — Instalable

### Archivos nuevos

**`generate-icons.js`** (raíz del repo, Node.js, corre una sola vez):
- Usa el módulo `canvas` de npm
- Genera `icons/icon-192.png` e `icons/icon-512.png`
- Fondo: `#001D3D` (azul marino corporativo)
- Texto: "EVE" centrado, fuente bold, color `#FFC300` (oro corporativo)
- Los PNGs generados se commitean al repo; el script no es parte del runtime

**`manifest.json`** (raíz):
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
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

**`service-worker.js`** (raíz):

Cache name versionado: `eve-control-v3-r1` (incrementar `r2`, `r3`...
en cada deploy relevante — se encarga el desarrollador al hacer push).

*Install event* — precachea:
- App shell propio: `index.html`, `css/styles.css`, todos los `js/*.js`
- CDN scripts: Firebase App compat, Firebase Firestore compat, jsPDF,
  jsPDF-autoTable, SheetJS (`xlsx.full.min.js`)
- Google Fonts CSS (la URL que ya carga `index.html`)

*Fetch event* — Cache First:
- Si el recurso está en caché → sirve directo sin red
- Si no está en caché → red, guarda la respuesta en caché antes de devolverla
- Solo aplica a recursos `GET`; peticiones `POST`/Firebase REST pasan
  directamente a red (las maneja Firebase SDK internamente)

*Activate event*:
- Elimina todos los caches cuyo nombre no sea `eve-control-v3-r<N>` actual
- `clients.claim()` para tomar control de tabs existentes sin recargar

*Update*: `skipWaiting()` en install → actualización automática al
recargar. Notificación opcional: `"🔄 Nueva versión disponible. Recarga para actualizar."` vía `postMessage` a los clientes activos.

### Modificaciones a `index.html`

En `<head>`:
```html
<link rel="manifest" href="manifest.json">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="EVE Control">
```
(El `<meta name="theme-color">` ya existe.)

Al final del `<body>`, antes de los scripts de la app:
```html
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/eve-control-v2/service-worker.js')
        .catch((err) => console.error('SW error:', err));
    });
  }
</script>
```

**Prompt de instalación** — en el mismo bloque de script inline:
- Captura `beforeinstallprompt` y guarda el evento en `window.__installPrompt`
- Crea dinámicamente un botón `[📲 Instalar App]` en `.header-actions`
  del header, inicialmente oculto
- Lo muestra solo si hay evento guardado y `localStorage.getItem('eve-app-instalada')` es falso
- Al hacer clic: `__installPrompt.prompt()` → espera resultado → si
  `outcome === 'accepted'` → `localStorage.setItem('eve-app-instalada', '1')` → oculta el botón permanentemente

### Criterio de aceptación 9a

- Lighthouse PWA score ≥ 90 en Chrome DevTools
- Chrome Android muestra banner "Añadir a pantalla de inicio" o ícono instalable en la barra de direcciones
- Con modo avión activado tras la primera visita: recargar → la app abre sin red
- Sin errores de consola

---

## Fase 9b — Firebase offline nativo

### Modificación a `js/config.js`

Inmediatamente después de `window.db = firebase.firestore()`:

```javascript
window.db.enablePersistence({ synchronizeTabs: true })
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('EVE: persistencia offline limitada — múltiples tabs activas');
    } else if (err.code === 'unimplemented') {
      console.warn('EVE: persistencia offline no disponible en este navegador');
    }
  });
```

`synchronizeTabs: true` — cuando hay varias pestañas abiertas, la
pestaña "propietaria" de la persistencia cambia dinámicamente sin
lanzar errores en las demás.

### Qué entrega esta fase

- Lectura offline: `cargarDatos()` devuelve datos del caché local de
  Firestore si no hay red
- Escritura offline básica: `guardarDato()` / `actualizarDato()` /
  `eliminarDato()` se encolan internamente en el caché de Firestore y
  se sincronizan automáticamente al recuperar la conexión
- Sin cambios de UI — el indicador `#estado-conexion` sigue mostrando
  solo `🟢 En línea` (los 4 estados vienen en 9c)

### Criterio de aceptación 9b

- Con modo avión: guardar un registro en Destaraje → aparece en tabla → volver a red → confirmar en Firestore que el registro existe
- Sin errores de consola en ningún escenario

---

## Fase 9c — Cola propia + UI de estado

### `js/offline.js` (nuevo)

#### IndexedDB — base de datos `EVEControlOffline` versión 1

Dos object stores:

**`cola_pendiente`** (keyPath: `id`, autoIncrement):
```javascript
{
  id:         auto-increment,
  coleccion:  'destaraje'|'produccion'|'pagos'|'ministraciones'|'control_produccion',
  datos:      { ...registro completo },
  timestamp:  ISO string,
  intentos:   0,
  estado:     'pendiente'|'error'
}
```

**`cache_datos`** (keyPath: `coleccion`):
```javascript
{
  coleccion:  string,
  registros:  [...],
  ultimaSync: ISO string
}
```

#### Interceptación de escrituras

`window.guardarDato` en `utils.js` se reemplaza por una versión que
evalúa `navigator.onLine`:

- **Online** → comportamiento actual (Firebase directo)
- **Offline** → guardar en `cola_pendiente` + agregar al array
  `window.EVE` correspondiente para que aparezca en tabla
  inmediatamente + llamar `actualizarEstadoConexion()` con el nuevo
  conteo

Solo `guardarDato` (crear) va a la cola. `actualizarDato` y
`eliminarDato` **no** soportan modo offline — si se intenta sin red,
muestran `showError('Sin conexión. Vuelve a intentarlo cuando tengas internet.')`.

La identificación del array `window.EVE` correcto por colección:
```javascript
const MAPA_EVE = {
  destaraje:          (r) => window.EVE.registrosDestaraje.push(r),
  produccion:         (r) => window.EVE.registrosProduccion.push(r),
  pagos:              (r) => window.EVE.registrosPagos.push(r),
  ministraciones:     (r) => window.EVE.registrosMinistraciones.push(r),
  control_produccion: (r) => window.EVE.registrosControlProduccion.push(r)
};
```

#### Sincronización automática

```
window.addEventListener('online') → sincronizarCola()
```

Flujo de `sincronizarCola()`:
1. Leer todos los registros de `cola_pendiente` con `estado: 'pendiente'`
2. Si no hay ninguno → actualizar caché y pasar al paso 6
3. Cambiar header a `🔄 Sincronizando... (0/N)`
4. Para cada registro (en orden de `timestamp`):
   a. Intentar `window.guardarDatoFirebase(coleccion, datos)` (referencia directa a Firebase, sin pasar por la intercepción)
   b. Éxito → eliminar de `cola_pendiente`, actualizar contador
   c. Error por ticket duplicado → descartar de cola, `showError` con mensaje de conflicto
   d. Otro error → `intentos++`, dejar en cola con `estado: 'error'`
5. `cargarDatosEnParalelo()` para refrescar `window.EVE`
6. Header → `✅ Sincronizado` durante 3 segundos → `🟢 En línea`

#### Resolución de conflictos

"Firebase gana siempre." Si al subir un registro local, Firebase ya
tiene un documento con el mismo ticket en esa colección:
- Se descarta el registro local (eliminar de `cola_pendiente`)
- `showError('⚠️ El ticket [X] ya existía en el servidor. Se conservó la versión del servidor.')`
- El `cargarDatosEnParalelo()` posterior trae la versión de Firebase

#### Persistencia del caché local

Tras cada `cargarDatosEnParalelo()` exitoso (online), `offline.js`
actualiza `cache_datos` con los arrays actuales de `window.EVE` y el
timestamp. Si al arrancar la app no hay red y `cargarDatosEnParalelo()`
falla, `offline.js` lee `cache_datos` de IndexedDB y repuebla
`window.EVE` directamente — el resto de la app no cambia.

---

### 4 estados del header

El `#estado-conexion` existente se convierte en el indicador de estado.
Función central `actualizarEstadoConexion(estado, extra)`:

| `estado` | Texto mostrado | Color CSS | Cuándo |
|---|---|---|---|
| `'online'` | `🟢 En línea` | `--verde-exito` | `navigator.onLine && cola vacía` |
| `'offline'` | `🔴 Sin conexión — N pendientes` | `--rojo-error` | `!navigator.onLine` |
| `'syncing'` | `🔄 Sincronizando... (N/M)` | `--oro` | Durante `sincronizarCola()` |
| `'synced'` | `✅ Sincronizado` | `--verde-exito` | 3s tras sync exitosa |

El elemento `#estado-conexion` recibe `cursor: pointer` cuando el
estado es `'offline'`. Al hacer clic → abre `#panel-pendientes`.

---

### Panel de registros pendientes

Modal ligero (no usa `.modal-overlay` — es un panel pequeño anclado
al header para no tapar el contenido):

```
┌─────────────────────────────────────────┐
│ 📴 REGISTROS PENDIENTES DE SYNC (N)     │
├─────────────────────────────────────────┤
│ Destaraje  Ticket 9260  650 kg  14:32   │
│ Pagos      Ticket 9260  $6,500  15:01   │
├─────────────────────────────────────────┤
│ Se subirán al recuperar conexión.       │
│                          [✕ Cerrar]     │
└─────────────────────────────────────────┘
```

ID: `#panel-pendientes`. Se crea dinámicamente en `offline.js` y se
inserta en el `<body>`. Se muestra/oculta con clase CSS `open`.

---

### Modificaciones a archivos existentes

**`js/utils.js`:**
- Renombrar internamente la función original de Firebase a
  `window.guardarDatoFirebase` (para que `sincronizarCola` la use
  directamente)
- `window.guardarDato` pasa a ser el wrapper que evalúa `navigator.onLine`

**`index.html`:**
- `<script src="js/offline.js"></script>` antes de `<script src="js/auth.js">`

**`css/styles.css`:**
- `#estado-conexion` con `cursor: pointer` y `transition` de color
- `#panel-pendientes` — panel flotante bajo el header, con las mismas
  variables CSS del proyecto

---

### Criterio de aceptación 9c

- **Online → Offline → Online:** guardar registro sin conexión → aparece
  en tabla con datos locales → volver conexión → sync automática →
  registro visible en Firebase.
- **Header states:** los 4 estados cambian correctamente en cada escenario.
- **Panel pendientes:** al tocar 🔴 muestra la lista con datos correctos.
- **Conflicto:** sembrar registro con mismo ticket en Firebase, intentar
  subir el local → mensaje de conflicto, Firebase prevalece.
- **Sin errores de consola** en ningún escenario.

---

## Fuera de alcance

- Sincronización de `actualizarDato` y `eliminarDato` offline
- Soporte iOS Safari
- Lighthouse score en categorías distintas a PWA
- Reporte offline (los reportes requieren datos completos — se deshabilitan sin conexión mostrando `showError`)
- Notificaciones push

## Archivos finales

```
eve-control-v2/
├── manifest.json              ← 9a (nuevo)
├── service-worker.js          ← 9a (nuevo)
├── generate-icons.js          ← 9a (nuevo, one-time script)
├── icons/
│   ├── icon-192.png           ← 9a (generado)
│   └── icon-512.png           ← 9a (generado)
├── index.html                 ← 9a + 9c (modificado)
├── css/styles.css             ← 9c (modificado)
└── js/
    ├── config.js              ← 9b (modificado)
    ├── utils.js               ← 9c (modificado)
    └── offline.js             ← 9c (nuevo)
```
