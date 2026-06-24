# Fase 1 — Setup inicial y estructura base

Fuente: `docs/PROMPT_ORIGINAL_EVE_CONTROL.md` (spec completo del proyecto EVE Control v3.0).

Este documento cubre únicamente la **Fase 1** del proyecto, según la descomposición acordada:

1. **Setup + base** (`index.html`, `styles.css`, `config.js`) ← esta fase
2. `utils.js` + `auth.js`
3. Módulo Destaraje y Ventas
4. Módulo Producción
5. Módulo Pagos + Ministraciones
6. Módulo Control de Producción
7. Módulo Reportes
8. Panel Admin
9. Reconocimiento de voz
10. PWA / Modo offline
11. Deploy final

## Objetivo de la fase

Tener el "esqueleto" de la app funcionando: al abrir `index.html` en un navegador se ve la
pantalla de login con el diseño correcto (paleta, tipografía, componentes base), sin errores
de consola, y con Firebase inicializado. Sin lógica de negocio todavía — eso llega en fases
posteriores.

## Repositorio

- Carpeta local: `eve-control-v2/` (ya creada, con `git init` local).
- Remoto destino (más adelante, no en esta fase): `cpnetohiva/eve-control-v2` en GitHub,
  desplegado vía GitHub Pages.
- No se toca el remoto hasta que el usuario lo apruebe explícitamente.

## Estructura de archivos de esta fase

```
eve-control-v2/
├── index.html
├── css/
│   └── styles.css
└── js/
    └── config.js
```

(Las carpetas `docs/` con el spec y el prompt original ya existen y no forman parte del
deploy de la app.)

## `js/config.js`

- Objeto `firebaseConfig` con las credenciales dadas en el prompt original (`apiKey`,
  `authDomain`, `projectId: "everplastic"`, `storageBucket`, `messagingSenderId`, `appId`).
- Inicializa Firebase App + Firestore usando el SDK **compat** (cargado por `<script>` en
  `index.html`, sin bundler), expone `window.db`.
- Constantes globales:
  - `MATERIALES_COMUNES` (lista del prompt original)
  - `MATERIALES_PZ = ['TAMBO', 'CAJA CO30']`
  - `PROVEEDORES_COMUNES` (lista del prompt original)
  - Nombres de colecciones Firestore: `COLECCIONES = { USERS: 'users', DESTARAJE: 'destaraje', PRODUCCION: 'produccion', PAGOS: 'pagos', MINISTRACIONES: 'ministraciones', CONTROL_PRODUCCION: 'control_produccion', CONFIG: 'config' }`.
- No incluye aún lógica de CRUD ni de sesión (eso es `utils.js` / `auth.js`, fase 2).

## `index.html`

- `<head>`: charset, viewport, título "EVE Control v3.0", `theme-color` (`#001D3D`), fuentes
  Google (DM Sans + JetBrains Mono), enlace a `css/styles.css`.
- SDKs por CDN (versiones fijadas en el prompt original): Firebase compat 10.7.1
  (`firebase-app-compat.js` + `firebase-firestore-compat.js`), jsPDF 2.5.1, jsPDF-autoTable
  3.5.31, SheetJS (xlsx).
- `<body>`:
  - **Pantalla de login** (`#login-screen`): card centrada con logo/título "EVE Control",
    inputs usuario/contraseña, botón "Entrar", placeholder para mensaje de error. Visible por
    defecto.
  - **Shell de la app** (`#app-shell`, oculto hasta login): header con título, indicador de
    estado de conexión (placeholder estático "🟢 En línea" por ahora — la lógica real llega en
    la fase PWA), botones "Admin" y "Salir"; barra de tabs (vacía, se llena por módulo en fases
    futuras); contenedor principal `#main-content`.
  - Contenedor de toasts (`#toast-container`) fijo, vacío.
  - Scripts al final del `<body>`: SDKs CDN primero, luego `js/config.js`. Los demás módulos
    (`utils.js`, `auth.js`, etc.) se añaden en sus respectivas fases — no se referencian todavía
    para evitar 404 de archivos inexistentes.
- Sin JS inline de lógica de negocio. Cualquier interacción de login en esta fase es solo
  marcado (no funcional) — autenticación real es fase 2.

## `css/styles.css`

- Variables CSS con la paleta exacta del prompt original (`--azul-marino: #001D3D`,
  `--oro: #FFC300`, `--azul-claro: #0077B6`, `--blanco`, `--gris-claro`, `--gris-oscuro`).
- Reset básico (`box-sizing`, márgenes).
- Tipografía: `font-family` general DM Sans; clase utilitaria `.mono` (JetBrains Mono) para
  números y datos.
- Componentes reutilizables que usarán todos los módulos futuros:
  - `.card` (fondo blanco, sombra suave, radio de borde)
  - `.tabs` / `.tab` (activo vs inactivo, color oro para activo)
  - `.modal` / `.modal-overlay` (oculto por defecto)
  - `.toast` (variantes `.toast-success` verde, `.toast-error` rojo)
  - Botones primario (oro sobre azul marino) y secundario
- Mobile-first: estilos base para pantallas pequeñas, `@media (min-width: 768px)` para
  ajustes de escritorio (más padding, layouts en fila en vez de columna).

## Fuera de alcance en esta fase

- Login funcional, sesión, permisos → fase 2 (`auth.js`)
- Cualquier módulo operativo, reportes, admin, voz → fases 3-9
- Service worker, manifest, IndexedDB → fase 10
- Push/deploy a GitHub → fase 11

## Criterio de aceptación

- Abrir `index.html` directamente en el navegador (o vía servidor estático local) muestra la
  pantalla de login con la paleta y tipografía correctas.
- Sin errores en la consola del navegador (los SDKs cargan, `config.js` inicializa Firebase
  sin lanzar excepción).
- Responsive: se ve bien tanto en viewport móvil como de escritorio.
