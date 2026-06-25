# Fase 8a — Panel Admin: Gestión de Usuarios

Fuente: `EVERPLASTIC COO.md` (sección "PANEL ADMIN (`admin.js`)",
subsección "Gestión de Usuarios"). Primera de 4 sub-fases del Panel Admin
(8a Usuarios → 8b Importación de Datos → 8c Backup/Exportación +
Configuración del Sistema → 8d Gestión de Datos), decomposición acordada
al iniciar el brainstorming de esta fase. Continúa la Fase 7 (Reportes UI
+ Telegram), ya fusionada a `master`.

## Objetivo

El botón "Admin" del header (`#btn-admin`, ya existe en `index.html`,
visible hoy solo si `permissions.admin === true`, sin ningún manejador de
clic) abre un panel con una pantalla de gestión de usuarios: lista de
usuarios existentes, alta de usuario nuevo, edición (incluido resetear
contraseña), y activar/desactivar — sin borrado permanente.

## Arquitectura

- **`js/admin.js`** (nuevo): el "shell" del Panel Admin. Conecta su propio
  listener a `#btn-admin` (sin tocar `js/auth.js`, que sigue siendo el
  único responsable de la visibilidad del botón); al hacer clic, quita la
  clase `active` de cualquier tab regular, limpia `#main-content` y
  renderiza el panel. Construye una barra de sub-navegación interna —en
  esta fase solo existe la sub-pestaña "Usuarios", diseñada para que
  fases futuras agreguen hermanas ("Importar Datos", "Backup y Config",
  "Gestión de Datos") sin reestructurar el shell. Para salir del panel,
  el usuario hace clic en cualquier tab regular (Destaraje, Reportes,
  etc.) — `activarTab` ya limpia `#main-content` al cambiar, no se
  necesita un botón "Volver" dedicado.
- **`js/admin-usuarios.js`** (nuevo): toda la lógica de usuarios — helpers
  de validación, CRUD (crear/editar/activar/desactivar), tabla y
  formulario. Namespace `window.EVE_ADMIN_USUARIOS`, consumido por
  `admin.js` (misma relación unidireccional que `control-produccion.js`
  consumiendo `trazabilidad.js`: `admin.js` llama a
  `window.EVE_ADMIN_USUARIOS.crearVistaUsuarios()`, nunca al revés).
- **Sin cambios a `js/auth.js`** ni a ningún otro módulo existente.
- **Decisión deliberada — sin caché en `window.EVE`:** a diferencia de
  los módulos operativos (que cargan sus datos una sola vez al iniciar
  sesión y nunca vuelven a leer Firestore, para minimizar lecturas en
  pantallas de uso constante), la lista de usuarios se recarga con
  `window.cargarDatos(window.COLECCIONES.USERS)` cada vez que se abre la
  sub-pestaña "Usuarios" y después de cada creación/edición/cambio de
  estado, guardada en una variable de módulo (no en `window.EVE`). Esta
  pantalla la usan solo administradores, con poca frecuencia — el
  refetch mantiene la lista siempre exacta sin lógica de parcheo local.

## Datos

Forma del documento en la colección `users` (ya existente, sin cambios de
esquema, solo formalizando lo que ya usa `js/auth.js`):

```
{
  username: string,
  password: string,       // texto plano, igual que hoy en auth.js
  active: boolean,
  permissions: {
    destaraje: boolean,
    produccion: boolean,
    pagos: boolean,
    controlProduccion: boolean,
    reportes: boolean,
    admin: boolean
  },
  fechaRegistro: string    // ISO, agregado automáticamente por guardarDato()
}
```

Los 6 permisos corresponden 1:1 a los 5 tabs de `ORDEN_TABS`
(`js/auth.js:14-20`) más el flag `admin` que controla la visibilidad de
`#btn-admin`. No existen permisos separados para Ministraciones
(vive dentro de Pagos) ni Trazabilidad (vive dentro de Control
Producción) — consistente con que tampoco tienen su propia entrada en
`ORDEN_TABS`.

## Validación

- **Username**: obligatorio, no vacío después de `trim()`. Único —
  comparación exacta (`===`, mismo criterio que ya usa el login en
  `js/auth.js:122`) contra los usuarios ya cargados en memoria. Duplicado
  bloquea el guardado con un error claro vía `showError`, sin llamar a
  Firestore.
- **Password**: obligatorio al crear (no se puede crear un usuario sin
  contraseña). Al editar, el campo va vacío por defecto
  (`placeholder="Dejar vacío para no cambiar"`); si se deja vacío, la
  propiedad `password` se omite del objeto enviado a `actualizarDato`
  (mismo criterio ya usado para `ticketOrigen` opcional en
  `js/destaraje.js`, Fase 6).
- **Permisos**: ningún mínimo requerido — un usuario con cero permisos
  marcados es válido (simplemente no vería ningún tab al iniciar sesión).
- **Auto-bloqueo**: comparando contra `window.EVE.currentUser.id` —
  - El botón Activar/Desactivar de la fila correspondiente al usuario con
    sesión activa aparece deshabilitado.
  - Dentro del modal de edición de ese mismo usuario, el checkbox de
    permiso "Admin" aparece deshabilitado (no se puede quitar el propio
    acceso de administrador).
  - Ambas reglas se aplican solo a la propia fila/modal — no afectan la
    edición de otros usuarios administradores.

## UI

- **Tabla de usuarios** (columnas: Username | Permisos | Activo |
  Acciones): una fila por usuario, permisos mostrados como lista corta de
  nombres (ej. "Destaraje, Pagos, Admin"), columna Activo como ✓/✗
  (texto, no icono SVG), columna Acciones con un botón "Editar".
- **Botón "+ Nuevo Usuario"** sobre la tabla → abre un modal (mismo patrón
  `.modal-overlay`/`.modal` ya usado en `control-produccion.js`) con:
  username (texto), password (`type="password"`, mismo criterio de
  enmascarado en pantalla que ya usa `#login-password` — el
  almacenamiento sigue siendo texto plano, sin cambios), los 6
  checkboxes de permisos, activo (checkbox, marcado por defecto).
- **Modal de editar usuario**: mismos campos prellenados con los valores
  actuales, excepto password (siempre vacío, con el placeholder descrito
  arriba), más la regla de auto-bloqueo del checkbox Admin cuando aplica.
- **Activar/Desactivar**: botón en cada fila de la tabla (fuera del
  modal), alterna `active` con un `confirm()` previo (mismo patrón ya
  usado para eliminar en otros módulos, ej.
  `control-produccion.js:514-525`), deshabilitado en la propia fila.
  Nunca se borra el documento de Firestore — no existe ninguna acción de
  borrado permanente en esta pantalla.

## Archivos

- Crear `js/admin-usuarios.js`: namespace `window.EVE_ADMIN_USUARIOS`,
  validación, CRUD, tabla, modal de crear/editar.
- Crear `js/admin.js`: shell del Panel Admin, listener de `#btn-admin`,
  sub-navegación (solo "Usuarios" en esta fase), delega a
  `EVE_ADMIN_USUARIOS.crearVistaUsuarios()`.
- Modificar `index.html`: agregar `<script src="js/admin-usuarios.js">` y
  `<script src="js/admin.js">` (en ese orden de dependencia) después de
  `reportes-ui.js`.
- Modificar `css/styles.css`: estilos para el shell del Panel Admin
  (sub-navegación), la tabla de usuarios, el layout de los 6 checkboxes
  de permisos dentro del modal. Reutilizar `.card`, `.modal-overlay`/
  `.modal`, `.btn-primary`/`.btn-secondary` donde aplique.

## Fuera de alcance

- Importación de Datos (Excel), Backup/Exportación, Configuración del
  Sistema (Telegram, horario de reporte automático), Gestión de Datos
  (borrado masivo) — sub-fases futuras del Panel Admin (8b/8c/8d).
- Borrado permanente de usuarios — explícitamente descartado para esta
  fase; activar/desactivar es la única acción que termina el ciclo de
  vida de un usuario.
- Cualquier cambio a `js/auth.js` o a cualquier otro módulo operativo —
  esta fase es enteramente aditiva.

## Criterio de aceptación

- Node: helpers de validación de `admin-usuarios.js` (username vacío,
  duplicado exacto, password vacío al crear, password vacío al editar →
  se omite del payload) con fixtures de usuarios en memoria, sin Firestore
  real.
- Playwright en vivo: iniciar sesión como admin, abrir el panel,
  confirmar que aparece la tabla con el usuario de prueba, crear un
  usuario de prueba nuevo con un subconjunto de permisos, confirmar que
  aparece en la tabla, editarlo (cambiar permisos, resetear password
  dejando el campo vacío para los demás campos), confirmar que el botón
  Activar/Desactivar de la fila propia del admin logueado está
  deshabilitado, desactivar el usuario de prueba y confirmar que
  `active` cambia a `false` en Firestore, sin borrar ningún documento.
  Sin errores de consola.
