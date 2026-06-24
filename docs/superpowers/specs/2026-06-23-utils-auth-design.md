# Fase 2 — `utils.js` + `auth.js`

Fuente: `docs/PROMPT_ORIGINAL_EVE_CONTROL.md`. Continúa la fase 1
(`docs/superpowers/specs/2026-06-23-setup-base-design.md`), ya fusionada a `master`.

Descomposición del proyecto completo (sin cambios respecto a la fase 1):

1. Setup + base ✅ (fusionado)
2. **`utils.js` + `auth.js` ← esta fase**
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

Login funcional contra Firebase real, sesión persistente, permisos por usuario,
carga paralela de datos a `window.EVE`, y tabs visibles según permiso (con
placeholder, ya que los módulos reales llegan en fases siguientes).

## `js/utils.js`

Funciones puras + wrappers de Firestore (usa `window.db` y `window.COLECCIONES`
de `js/config.js`, fase 1). Sin estado propio.

- `formatearKg(valor, material)` → `"650 KG"` o `"400 PZ"`. Unidad = `"PZ"` si
  `material` (en mayúsculas, trim) está en `window.MATERIALES_PZ`; si no, `"KG"`.
  Separador de miles con `toLocaleString('es-MX')`.
- `formatearMoneda(valor)` → `"$15,000.00"` vía
  `valor.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })`.
- `formatearFecha(fechaISO)` → convierte `"YYYY-MM-DD"` a `"DD/MM/AAAA"` para
  mostrar en UI. **Decisión de diseño:** el almacenamiento en Firestore y los
  cálculos internos (orden, semana ISO, comparaciones) se quedan en
  `YYYY-MM-DD` — es el formato de los datos ya existentes y el único que ordena
  lexicográficamente igual que cronológicamente. `formatearFecha` es solo para
  presentación (tablas, reportes, etc.); se usa en fases posteriores cuando se
  rendericen tablas.
- `obtenerFechaMexico()` → `"YYYY-MM-DD"` de hoy en zona horaria
  `America/Mexico_City` (vía `Intl.DateTimeFormat` con `timeZone`).
- `obtenerInicioSemana()` → `"YYYY-MM-DD"` del lunes de la semana actual, misma
  zona horaria.
- `descargarArchivo(blob, nombre)` → crea `<a>` temporal con
  `URL.createObjectURL`, dispara descarga, revoca el URL.
- `exportarCSV(datos, nombre)` → genera CSV (headers = claves del primer
  objeto) y llama `descargarArchivo`.
- `guardarDato(coleccion, datos)` → `Promise<id>`. Agrega `fechaRegistro` (ISO
  timestamp) si no viene en `datos`, hace `db.collection(coleccion).add(...)`.
- `actualizarDato(coleccion, id, datos)` → `db.collection(coleccion).doc(id).update(datos)`.
- `eliminarDato(coleccion, id)` → `db.collection(coleccion).doc(id).delete()`.
- `cargarDatos(coleccion)` → `Promise<array>`, cada elemento `{ id, ...datos }`.
- `showSuccess(mensaje)` / `showError(mensaje)` → toasts en `#toast-container`
  usando `.toast`/`.toast-success`/`.toast-error` (ya existen desde la fase 1).
  Verde 3s, rojo 4s, auto-remove con `setTimeout`.

Todas las funciones se exponen en `window` (mismo patrón que `config.js`):
`window.formatearKg`, `window.guardarDato`, etc.

## `js/auth.js`

### Objeto global

```javascript
window.EVE = {
  currentUser: null,
  registrosDestaraje: [],
  registrosVentas: [],
  registrosProduccion: [],
  registrosPagos: [],
  registrosMinistraciones: [],
  registrosControlProduccion: []
};
```

### Flujo de login

1. `cargarDatos(COLECCIONES.USERS)` para obtener la lista de usuarios.
2. Buscar coincidencia exacta de `username` (case-sensitive) y `password`
   (texto plano — **nota de seguridad:** el sistema actual ya almacena
   contraseñas en texto plano en Firestore; esta fase replica esa lógica
   tal cual, sin agregar hashing, para no romper compatibilidad con los
   usuarios reales ya existentes. No se introduce ningún cambio de
   seguridad sin que se decida explícitamente).
3. Si no hay coincidencia → error genérico: `"Usuario o contraseña incorrectos"`
   (no se distingue cuál de los dos falló).
4. Si coincide pero `active !== true` → `"Usuario desactivado. Contacta al administrador."`
5. Si válido: guardar en `localStorage` (`eve_session`):
   `{ userId, username, permissions }`.
6. Cargar en paralelo (`Promise.all`, siempre las 5 colecciones completas, sin
   filtrar por permiso): `destaraje`, `produccion`, `pagos`, `ministraciones`,
   `control_produccion`.
7. Separar el resultado de `destaraje`:
   - ticket que matchea `/^\d+$/` → `window.EVE.registrosDestaraje`
   - ticket `=== 'V'` → `window.EVE.registrosVentas`
   - cualquier otro valor → se descarta (no se espera, no rompe nada)
8. `produccion` → `registrosProduccion`, `pagos` → `registrosPagos`,
   `ministraciones` → `registrosMinistraciones`,
   `control_produccion` → `registrosControlProduccion`, sin transformar.
9. Ocultar `#login-screen`, mostrar `#app-shell`, renderizar tabs (ver abajo).

### Auto-login

Al cargar la página: si existe `eve_session` en `localStorage`, releer el
usuario correspondiente (`userId`) desde Firestore para confirmar que sigue
existiendo y `active === true`, y refrescar `permissions` (evita confiar en
permisos cacheados obsoletos). Si la revalidación falla, limpiar
`localStorage` y mostrar `#login-screen` normalmente. Si es válida, continuar
como un login normal desde el paso 6.

### Logout (`#btn-salir`)

Limpia `localStorage.removeItem('eve_session')`, resetea `window.EVE` a su
estado inicial (todos los arrays vacíos, `currentUser: null`), oculta
`#app-shell`, muestra `#login-screen`.

### Tabs y permisos

- Un tab por módulo con permiso `true`, en este orden fijo: Destaraje,
  Producción, Pagos, Control Producción, Reportes.
- `#btn-admin` se oculta (`display: none`) si `permissions.admin` no es `true`.
- Como los módulos reales (`destaraje.js`, etc.) no existen todavía, cada tab
  y el botón Admin usan un mecanismo de placeholder: `window.EVE_MODULES` es un
  objeto vacío donde las fases siguientes registrarán
  `{ render(container) {...} }` por módulo. Si no hay nada registrado para el
  tab activo, `#main-content` muestra `"Módulo en construcción"`. Este es el
  punto de extensión que usarán las fases 3-8.

## Cambios en `index.html`

Agregar, después de `js/config.js` y antes de cerrar `</body>`:
```html
<script src="js/utils.js"></script>
<script src="js/auth.js"></script>
```
No se modifica el resto del markup (los ids necesarios ya existen desde la fase 1).

## Fuera de alcance

- Lógica real de cada módulo (Destaraje, Producción, etc.) → fases 3-6.
- Reportes, Admin, Voz → fases 7-9.
- Indicador de conexión dinámico, Service Worker, IndexedDB → fase 10.
- Hashing/seguridad de contraseñas → no solicitado, no se cambia en esta fase.

## Criterio de aceptación

Verificado contra Firebase real (`everplastic`), solo lectura, con los 3
usuarios reales:

- `Admin` / `4W9EVE12` → login correcto, ve los 5 tabs + botón Admin,
  `window.EVE` poblado con datos reales, sin errores de consola.
- `Matilde` / `1357` → login correcto, ve solo tabs Destaraje y Reportes, sin
  botón Admin.
- `Christian` / `8642` → login correcto, ve tabs Producción, Pagos y Reportes,
  sin botón Admin.
- Contraseña incorrecta → mensaje de error inline, se queda en login.
- Logout → vuelve a login, `localStorage` limpio.
- Recargar la página con sesión válida → auto-login sin pedir credenciales,
  revalidado contra Firestore.
