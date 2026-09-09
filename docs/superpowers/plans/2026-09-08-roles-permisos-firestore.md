# Sistema de Roles y Permisos Finos — Plan (solo diseño, sin código)

> **Estado:** Pendiente de revisión del usuario. NO IMPLEMENTAR TAREA 3 (reglas de Firestore) sin que el usuario apruebe el texto exacto de las reglas antes de desplegarlas.

**Objetivo:** Reemplazar el esquema binario actual de permisos por usuario (todo-o-nada por módulo) por un sistema de Roles reutilizables con nivel `lectura` / `escritura` / `ninguno` por módulo, aplicado tanto en el frontend (ocultar/deshabilitar acciones) como en las reglas de seguridad de Firestore (protección real del lado servidor).

**Arquitectura:** Nueva colección `roles` en Firestore; `users/{uid}` gana un campo `rolId`. El frontend resuelve los permisos del usuario logueado a un objeto `permisosResueltos` (uno de `lectura|escritura|ninguno` por módulo) una sola vez al iniciar sesión, y todas las pantallas consultan ese objeto mediante dos helpers centralizados en vez de checks ad-hoc. Las reglas de Firestore hacen la misma resolución del lado servidor con `get()`, para que la protección no dependa solo de la UI.

**Tech Stack:** Vanilla JS + Firebase Auth + Firestore (sin build step), reglas de seguridad Firestore v2.

**Spec:** Diagnóstico y diseño confirmados en conversación con el usuario (2026-09-08); no hay documento de spec separado — este plan es la especificación.

## Global Constraints

- Ningún usuario real debe perder acceso durante la migración (cada usuario existente recibe un rol equivalente a sus permisos actuales antes de borrar/dejar de usar el esquema viejo).
- Tarea 3 (reglas de Firestore) **no se escribe como archivo final ni se despliega** sin que el usuario revise el texto exacto de las reglas primero.
- Las reglas nuevas se prueban en el emulador de Firestore / Rules Playground con una matriz de casos **antes** de tocar producción.
- Cobertura obligatoria de los 11 módulos: Destaraje, Pagos, Ventas, Precios, Rendimientos, CxP, Control Producción, Inventario, Reportes, Dashboard, Admin.
- No introducir abstracciones ni pantallas que no pidió el usuario (YAGNI) — el objetivo es reemplazar el esquema actual, no rediseñar la app.

---

## TAREA 1 — Modelo de Roles

### 1.1 Colección `roles` y campo `rolId`

**Archivos:**
- Modificar: `js/config.js` — agregar `ROLES: 'roles'` a `window.COLECCIONES`.
- Nueva colección Firestore `roles` (no requiere archivo de código, solo convención de datos).

**Forma de los datos (no es código, es el esquema a validar contigo):**

```
roles/{rolId}
  nombre: string                  // ej. "Auditor CxP", "Capturista Destaraje"
  permisos: {
    destaraje: 'ninguno' | 'lectura' | 'escritura',
    pagos: 'ninguno' | 'lectura' | 'escritura',
    ventas: 'ninguno' | 'lectura' | 'escritura',
    precios: 'ninguno' | 'lectura' | 'escritura',
    rendimientos: 'ninguno' | 'lectura' | 'escritura',
    cxp: 'ninguno' | 'lectura' | 'escritura',
    controlProduccion: 'ninguno' | 'lectura' | 'escritura',
    inventario: 'ninguno' | 'lectura' | 'escritura',
    reportes: 'ninguno' | 'lectura' | 'escritura',
    dashboard: 'ninguno' | 'lectura' | 'escritura',
    admin: 'ninguno' | 'lectura' | 'escritura'   // ver 1.4 sobre el mapeo de admin
  },
  permisosExtra: {
    ventas_precios: boolean,      // ver 1.4, no colapsa limpio en lectura/escritura
    cxp_reportes: boolean
  },
  activo: boolean,
  creadoEn: timestamp,
  actualizadoEn: timestamp

users/{uid}
  ...campos existentes (username, email, authUid, active)...
  rolId: string | null            // nuevo — referencia a roles/{rolId}
  permissions: {...}              // se conserva sin tocar durante la transición (ver 1.3)
```

**Decisión de diseño — Admin como módulo dentro del esquema:** hoy `permissions.admin` (acceso total) y `permissions.auditoria` (solo la sub-pestaña de auditoría) son dos flags independientes. Propongo mapearlos así dentro de `permisos.admin`:
- `'escritura'` = acceso completo a Admin (equivalente a `permissions.admin === true` hoy).
- `'lectura'` = solo la sub-pestaña de Auditoría (equivalente a `permissions.auditoria === true` hoy).
- `'ninguno'` = botón "Admin" oculto (como hoy sin ninguno de los dos flags).

Esto reutiliza el mismo esquema de 3 niveles sin crear un caso especial. Avísame si prefieres mantenerlos separados.

### 1.2 Pantalla de administración de Roles

**Archivos:**
- Crear: `js/admin-roles.js` — nuevo módulo IIFE, mismo patrón que `js/admin-usuarios.js`.
- Modificar: `index.html` — agregar `<script src="js/admin-roles.js">` y una sub-pestaña "Roles" dentro de Admin (junto a Usuarios/Auditoría).
- Modificar: `js/admin.js` — agregar la entrada "Roles" a `SUBPESTANAS`, visible solo si `permisos.admin === 'escritura'` (gestionar roles es una acción de escritura sobre el sistema, no debe ser visible con `admin: 'lectura'`).

**Funcionalidad:**
- Listar roles activos (nombre + resumen de permisos).
- Crear rol: nombre + un selector (`ninguno/lectura/escritura`) por cada uno de los 11 módulos + checkboxes para `permisosExtra`.
- Editar rol existente.
- Desactivar rol (`activo: false`, **no borrar** — un rol podría estar referenciado por `rolId` en usuarios existentes; si se borra físicamente, esos usuarios quedarían con una referencia rota).
- No permitir desactivar un rol si hay usuarios activos con ese `rolId` sin antes reasignarlos (validación en el frontend antes de escribir).

### 1.3 Asignar rol a usuario (reemplazo del checkboxes suelto)

**Archivos:**
- Modificar: `js/admin-usuarios.js`.

**Cambios:**
- Agregar un `<select>` de "Rol" poblado desde `roles` (solo roles `activo: true`), que escribe `rolId` en el doc del usuario.
- Mantener visible el bloque de checkboxes de `PERMISOS_DISPLAY` actual pero renombrado a "Permisos heredados (solo lectura, para referencia durante la migración)" — deshabilitado, no editable — hasta que confirmes que se puede eliminar por completo. Esto evita que alguien edite el esquema viejo pensando que sigue vigente.
- `crearUsuarioNuevo()` y `manejarEnvioFormulario()` pasan a exigir `rolId` (con un rol por defecto tipo "Sin acceso" preseleccionado) en vez de construir `permissions` desde checkboxes.

### 1.4 Migración de usuarios existentes

**Archivos:**
- Nueva función dentro de `js/admin-roles.js`: botón "Generar roles desde permisos actuales" (visible una sola vez, pensado para ejecutarse una vez y luego quitarlo o dejarlo oculto tras confirmación).

**Lógica (descripción, no código):**
1. Leer todos los docs de `users`.
2. Agrupar usuarios por firma exacta de su `permissions` actual (mismo conjunto de flags en `true`).
3. Por cada firma única, crear un doc en `roles` con nombre autogenerado (`"Rol migrado 1"`, `"Rol migrado 2"`, ...) y `permisos` calculados así:
   - Para los 10 módulos de `ORDEN_TABS`: `permissions[modulo] === true` → `'escritura'`, si no → `'ninguno'`. (Nota: esto asume que "tener el tab visible hoy" equivale a "puede escribir" porque hoy no existe un nivel intermedio real; ningún usuario pierde capacidad, pero tampoco se les baja a `'lectura'` automáticamente — alguien deberá revisar manualmente después cuáles deberían quedar en solo lectura).
   - `admin`: `permissions.admin === true` → `'escritura'`; si no y `permissions.auditoria === true` → `'lectura'`; si no → `'ninguno'`.
   - `permisosExtra.ventas_precios` = `permissions.ventas_precios === true`.
   - `permisosExtra.cxp_reportes` = `permissions.cxp_reportes === true`.
   - Los flags `inventario_ajuste` y `rendimientos_editar` **no** generan un rol distinto porque, según el punto siguiente, se resuelven automáticamente desde `escritura` del módulo correspondiente.
4. Asignar el `rolId` correspondiente a cada usuario.
5. Mostrar una tabla de vista previa (usuario → rol propuesto) **antes** de escribir nada, con un botón de confirmación explícito.
6. No tocar ni borrar `permissions` en el doc del usuario (queda como respaldo/histórico).

**Decisión de diseño — por qué `ventas_precios` y `cxp_reportes` no se convierten en niveles lectura/escritura:** los otros dos flags ad-hoc (`inventario_ajuste`, `rendimientos_editar`) controlan una **acción de escritura** (ajustar inventario, editar rendimiento) y por eso se resuelven limpio como parte de `'escritura'` del módulo. Pero `ventas_precios` y `cxp_reportes` controlan la **visibilidad de un dato sensible dentro de una pantalla de solo consulta** (ver precios de compra en Ventas, ver reportes dentro de CxP) — no son una acción de modificar datos. Forzarlos dentro de lectura/escritura perdería esa distinción. Por eso quedan como `permisosExtra` independientes, ortogonales al nivel del módulo. Confírmame si esto es correcto o si en tu cabeza esos dos casos sí deberían fusionarse con `escritura`.

### 1.5 Resolución de permisos al iniciar sesión

**Archivos:**
- Modificar: `js/auth.js`, función `establecerSesionActiva(usuario)`.

**Lógica:**
- Si `usuario.rolId` existe: leer `roles/{rolId}`, usar su `permisos` (+ `permisosExtra`) como `usuario.permisosResueltos`.
- Si `usuario.rolId` NO existe (usuario no migrado, o el doc de rol fue borrado): construir `permisosResueltos` al vuelo desde `usuario.permissions` con la misma lógica del punto 1.4, como red de seguridad para que nadie quede bloqueado por un dato faltante.
- `permisosResueltos` se guarda en `window.EVE.currentUser.permisosResueltos` y viaja con el resto de la sesión (no se vuelve a leer de Firestore hasta el siguiente login).

**Interfaz que producen 1.1–1.5, consumida por la Tarea 2:**
- `window.EVE.currentUser.permisosResueltos` → objeto `{ [modulo]: 'ninguno'|'lectura'|'escritura', ... }` + `permisosExtra: {ventas_precios, cxp_reportes}`.

---

## TAREA 2 — Aplicación real de permisos en el frontend

### 2.1 Helpers centralizados

**Archivos:**
- Crear: `js/permisos.js` (nuevo, cargado antes que los módulos que lo usan).

**Funciones que expone (firma, no implementación):**
- `window.puedeLeer(modulo)` → `boolean` — `true` si `permisosResueltos[modulo]` es `'lectura'` o `'escritura'`.
- `window.puedeEscribir(modulo)` → `boolean` — `true` solo si `permisosResueltos[modulo] === 'escritura'`.
- `window.tienePermisoExtra(clave)` → `boolean` — para `ventas_precios` / `cxp_reportes`.

Estas 3 funciones reemplazan los checks actuales (`permisos.inventario_ajuste`, `permisos.rendimientos_editar`, `permissions.ventas_precios === true`, `permissions.cxp_reportes`) y agregan la capacidad de gatear escritura en los módulos que hoy no tienen ningún control.

### 2.2 Visibilidad de pestañas (`ninguno` = módulo invisible)

**Archivos:**
- Modificar: `js/auth.js` — `tabsVisiblesPorPermiso(permisosResueltos)` cambia el filtro de `permissions[tab.permiso] === true` a `permisosResueltos[tab.permiso] !== 'ninguno'`.
- Misma función, línea del botón admin: cambia de `permissions.admin || permissions.auditoria` a `permisosResueltos.admin !== 'ninguno'`.

### 2.3 Gateo de escritura módulo por módulo

Para cada módulo, la regla general es: **todo botón/acción que cree, edite, borre, apruebe, ajuste o importe datos** se oculta o deshabilita cuando `puedeEscribir(modulo)` es `false`. Los 4 módulos marcados como "sin gateo hoy" no tienen ningún control existente que reutilizar — hay que localizar sus botones de acción desde cero.

| Módulo | Archivo | Estado actual | Trabajo en Tarea 2 |
|---|---|---|---|
| Destaraje | `js/destaraje.js` | Sin ningún check | Localizar los botones de alta/edición/borrado de tickets y envolverlos con `puedeEscribir('destaraje')` |
| Pagos | `js/pagos.js` | Sin ningún check | Localizar alta de pago/ministración y envolver con `puedeEscribir('pagos')` |
| Ventas | `js/ventas.js` | Ya usa `ventas_precios` (línea ~236) | Agregar `puedeEscribir('ventas')` para altas/ediciones de venta; mantener `tienePermisoExtra('ventas_precios')` intacto para ver precios |
| Precios | `js/precios.js` | Sin check confirmado — revisar en implementación | Envolver alta/edición de precio y ajustes de proveedor con `puedeEscribir('precios')` |
| Rendimientos | `js/rendimientos.js` | Ya usa `rendimientos_editar` (línea ~168) | Sustituir ese check por `puedeEscribir('rendimientos')` (comportamiento equivalente tras la migración 1.4) |
| CxP | `js/cxp.js` | Sin ningún check (excepto `cxp_reportes` en `reportes-ui.js`) | Localizar aprobar/editar/registrar en CxP y envolver con `puedeEscribir('cxp')`; mantener `tienePermisoExtra('cxp_reportes')` intacto |
| Control Producción | `js/control-produccion.js` | Sin ningún check | Localizar alta/edición de registros y envolver con `puedeEscribir('controlProduccion')` |
| Inventario | `js/inventario.js` | Ya usa `inventario_ajuste` (línea ~319, función `puedeAjustarInventario()`) | Sustituir ese check por `puedeEscribir('inventario')` |
| Reportes | `js/reportes-ui.js` | Ya usa `cxp_reportes` (línea ~210) | Es un módulo de solo consulta — no debería tener acciones de escritura propias; con `puedeLeer('reportes')` basta para decidir si se muestra |
| Dashboard | `js/dashboard.js` | Sin acciones de escritura (solo lectura/agregación) | No requiere gateo de escritura, solo el gateo de pestaña de 2.2 |
| Admin | `js/admin.js`, `js/admin-usuarios.js`, `js/admin-roles.js` | Gateo propio vía `SUBPESTANAS` | Cambiar de `permissions.admin`/`permissions.auditoria` al mapeo de 1.1 (`permisosResueltos.admin === 'escritura'` para Usuarios/Roles, `!== 'ninguno'` para ver Auditoría) |

**Nota honesta:** para Destaraje, Pagos, Control Producción y Precios no tengo memorizados los nombres exactos de las funciones/botones de escritura — el primer paso real de implementación en cada uno es releer el archivo y listar sus puntos de mutación (`.add(`, `.set(`, `.update(`, `.delete(` sobre Firestore, y los botones que disparan esos flujos) antes de envolverlos.

### 2.4 Verificación (no hay suite de pruebas automatizada en este proyecto)

Como en la sesión anterior, no hay ambiente local/staging confirmado, así que la verificación es manual:
- Crear (o reutilizar) un usuario de prueba con un rol `lectura` en un módulo y confirmar que los botones de escritura de ese módulo no aparecen o están deshabilitados.
- Confirmar que un usuario con `ninguno` en un módulo no ve la pestaña.
- Repetir para cada uno de los 11 módulos antes de dar la tarea por cerrada.

---

## TAREA 3 — Reglas de Firestore reales (BLOQUEADA hasta tu revisión explícita)

**Recordatorio de tu instrucción, para que quede constando en el propio plan: no se escribe el archivo final de reglas ni se despliega nada de esta tarea sin que revises el texto exacto primero.**

### 3.1 Decisión abierta #1 — costo de `get()` (lo que pediste confirmar)

Cada operación de lectura o escritura sobre una colección protegida requeriría, dentro de la regla, leer `users/{uid}` y luego `roles/{rolId}` — es decir **2 lecturas de documento adicionales por cada operación del usuario**, cobradas como lecturas de Firestore igual que cualquier lectura normal.

**Confirmo que está contemplado**, y propongo además una optimización concreta para reducirlo a **1 lectura adicional en vez de 2**: en lugar de que la regla resuelva el rol completo (`users` → `roles`) en cada operación, se puede **desnormalizar** el mapa de permisos directamente sobre `users/{uid}.permisosResueltos` en el momento en que se crea/edita el usuario o se le reasigna un rol (ya lo calculamos de todas formas en el punto 1.5 del lado cliente). Así, la regla de Firestore solo necesita `get(users/{uid})` — una sola lectura — y nunca toca `roles` directamente. La colección `roles` queda solo como la fuente de edición desde el Admin; el dato que las reglas realmente usan vive copiado en el propio doc del usuario.

Para un sistema interno de este tamaño (pocos usuarios, uso de oficina) el costo en cualquiera de las dos versiones es marginal, pero la versión desnormalizada es más barata y más simple de escribir en reglas. Recomiendo esa, salvo que prefieras mantener `roles` como única fuente de verdad incluso a costa de la lectura extra.

### 3.2 Decisión abierta #2 — ¿restringir también la lectura?

Recomiendo **restringir lectura y escritura**, no solo escritura: si dejamos la lectura abierta a cualquier autenticado, un usuario con `ninguno` o `lectura` en un módulo sensible (por ejemplo Pagos) seguiría pudiendo leer la colección cruda desde la consola del navegador — exactamente el hueco de seguridad que motivó esta tarea. Regla propuesta: `allow read` si el permiso del módulo es `lectura` o `escritura`; `allow write` solo si es `escritura`.

### 3.3 Mapeo módulo → colección (necesita tu confirmación, no es 1:1)

Las reglas de Firestore se escriben por colección, pero los permisos son por "módulo" de la UI. Este es el mapeo que propongo, con las ambigüedades marcadas:

| Módulo | Colecciones que gatea | Nota |
|---|---|---|
| Destaraje | `destaraje` | — |
| Pagos | `pagos`, `ministraciones` | **Asumo** que ministraciones cae bajo Pagos, confírmalo |
| Ventas | `ventas`, `composiciones` | **Asumo** que composiciones cae bajo Ventas |
| Precios | `precios`, `ajustes_precio_proveedor` | — |
| Rendimientos | (sin colección propia) | Rendimientos parece ser un cálculo sobre `destaraje`/`control_produccion`, no tiene escritura propia — probablemente no necesita regla propia, solo el gateo de pestaña de la Tarea 2 |
| CxP | `cuentas_por_pagar`, `auditorias`, `auditoria_fotos` | **Asumo** que comisiones y proveedores NO van aquí, confírmalo |
| Control Producción | `control_produccion` | — |
| Inventario | `inventario`, `inventario_inicial` | — |
| Reportes / Dashboard | (sin colección propia) | Ver 3.4 — son agregadores de lectura sobre las demás colecciones |
| Admin | `users` (ya regulado), `roles` (nuevo) | — |
| Sin módulo claro | `proveedores`, `comisiones`, `config` | **Necesito que me digas** bajo qué módulo caen — por ahora propongo `proveedores`→Pagos, `comisiones`→Pagos, `config`→solo Admin (`escritura`), lectura abierta a cualquier autenticado (necesario para que la app cargue configuración global al iniciar sesión) |

### 3.4 Decisión abierta #3 — cómo leen Reportes y Dashboard

Reportes y Dashboard no tienen colección propia: agregan datos de otras colecciones (ventas, cxp, inventario, etc.). Esto genera un conflicto real: si un usuario tiene `reportes: 'lectura'` pero `cxp: 'ninguno'`, ¿puede ver dentro de Reportes datos que provienen de `cuentas_por_pagar`?

Recomiendo que **no** — que cada colección se quede gobernada estrictamente por el permiso de su propio módulo, y que Reportes/Dashboard simplemente hereden lo que ya puedan leer de los módulos subyacentes (si no tienen acceso a CxP, esa sección del reporte les saldrá vacía o deberá ocultarse en la Tarea 2). La alternativa — dejar que "Reportes: lectura" abra todas las colecciones sin importar el resto de permisos — contradice el principio de mínimo privilegio que motivó todo este cambio. Si prefieres la alternativa, dímelo y ajusto el diseño de la Tarea 2 para que Reportes/Dashboard usen su propio permiso en vez de depender del de cada colección.

### 3.5 Plan de trabajo de la Tarea 3 (una vez resueltas 3.1–3.4)

1. Confirmar contigo las decisiones de 3.1, 3.2, 3.3 y 3.4.
2. Redactar el texto exacto de `firestore.rules` (función `permisoDe(modulo)` vía `get()` sobre `users/{uid}`, reemplazando el bloque comodín actual `match /{coleccion}/{docId}` por bloques específicos por colección).
3. Mostrarte el archivo completo para tu revisión línea por línea — **sin aplicar nada todavía**.
4. Levantar el Firebase Local Emulator Suite (o usar el Rules Playground de la consola) y correr una matriz de pruebas: por cada uno de los 11 módulos × 3 niveles de permiso × {lectura, escritura} — confirmar que el resultado esperado (permitir/denegar) coincide.
5. Solo tras tu aprobación explícita del texto Y de los resultados del emulador, desplegar con `firebase deploy --only firestore:rules`.
6. Verificar inmediatamente después del deploy que un usuario admin normal puede seguir entrando y operando (smoke test en producción), con plan de rollback (reglas anteriores guardadas) listo por si algo falla.

---

## Resumen de lo que necesito que confirmes antes de tocar código

1. ¿El mapeo `admin: escritura/lectura/ninguno` propuesto en 1.1 (lectura = solo Auditoría) te sirve, o prefieres mantenerlo separado?
2. ¿`ventas_precios` y `cxp_reportes` como `permisosExtra` ortogonales (1.4) es correcto, o deberían fusionarse con `escritura`?
3. Optimización de reglas: ¿desnormalizar `permisosResueltos` en `users/{uid}` (1 lectura extra) en vez de leer `roles` en cada regla (2 lecturas extra) — de acuerdo?
4. ¿Restringir también lectura por módulo (recomendado) o dejarla abierta y solo restringir escritura?
5. Mapeo módulo→colección de 3.3: confirmar `ministraciones`→Pagos, `composiciones`→Ventas, y decidir dónde caen `proveedores`, `comisiones`, `config`.
6. Reportes/Dashboard (3.4): ¿mínimo privilegio estricto por colección subyacente (recomendado), o permiso propio que abre todo?

Con esas respuestas puedo pasar a implementar Tarea 1 y Tarea 2 directamente, y dejar el texto de Tarea 3 listo para tu revisión final antes de cualquier despliegue.
