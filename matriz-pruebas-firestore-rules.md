# Matriz de pruebas — Firestore Rules Playground

**Proyecto:** EVE Control — Sistema de Roles y Permisos (Tarea 3)
**Fecha:** 2026-09-10
**Instrucciones:** Pega el texto de reglas ya aprobado en el editor del Playground (Firestore Database → Rules → ícono ▶ Playground) **sin publicar**. Para cada fila: Authenticated=Yes, Firebase UID según la tabla de UIDs, Operación (= Simulation type del Playground) y Colección (= Location del Playground) según la fila, Run — y anota el resultado real en la última columna.

**Antes de arrancar:** confirma que Admin y MatildeMontero ya tienen `permisosResueltos` escrito en su doc real de Firestore. Si falta en alguno, todo lo suyo saldrá ❌ por el fallback `'ninguno'` — eso sería un falso negativo, no un problema de las reglas.

**Nota sobre tipos de simulación:** el Playground no tiene un tipo "Write" genérico.
- Filas marcadas **Update** → usa simulation type **Update**.
- Filas marcadas **Create** sobre `historial_cambios` (#26) → simulation type **Create**, porque ese log solo se escribe con `.add()` (nunca update).
- Filas marcadas **Delete** (#32) → simulation type **Delete**.
- Para **Get** no hace falta document data. Para **Update/Create** el Playground pide un JSON de body — cualquier contenido dummy sirve (ej. `{"x":1}`), ninguna regla de esta versión inspecciona `resource.data`.
- Fila #38 requiere asignar temporalmente el permiso indicado entre paréntesis al usuario (Firestore Console → `roles/{rolId}.permisos.gastos` o `users/{uid}.permisosResueltos.gastos`) antes de correr el check — no reflejan el estado real de producción.

## UIDs de referencia

| Usuario | UID |
|---|---|
| Admin (`admin@everplastic.local`) | `stXEoFGfFFS44hbNyDw7RSn7MN53` |
| MatildeMontero (`matildemontero@everplastic.local`, rol Báscula) | `uqLH17FHSWcIXYniNvP8mlUptpg2` |

## Matriz completa (22 checks)

| # | Usuario | Colección | Operación | Resultado esperado | Nota | Resultado real |
|---|---|---|---|---|---|---|
| 14 | Admin (permiso: admin:escritura) | `pagos/doc1` | Get | ✅ permitido | | |
| 15 | Admin (permiso: admin:escritura) | `cuentas_por_pagar/doc1` | Get | ✅ permitido | | |
| 16 | Admin (permiso: admin:escritura) | `comisiones/doc1` | Get | ✅ permitido | | |
| 17 | Admin (permiso: admin:escritura) | `comisiones/doc1` | Update | ✅ permitido | Único que puede escribir ahí | |
| 18 | Admin (permiso: admin:escritura) | `historial_cambios/doc1` | Get | ✅ permitido | | |
| 19 | Admin (permiso: admin:escritura) | `destaraje/doc1` | Update | ✅ permitido | | |
| 20 | Admin (permiso: admin:escritura) | `users/uqLH17FHSWcIXYniNvP8mlUptpg2` (doc de MatildeMontero) | Get | ✅ permitido | | |
| 21 | Admin (permiso: admin:escritura) | `roles/rol1` | Update | ✅ permitido | | |
| 22 | MatildeMontero (permiso: destaraje:escritura) | `destaraje/doc1` | Update | ✅ permitido | | |
| 23 | MatildeMontero (permiso: pagos:ninguno) | `pagos/doc1` | Update | ❌ denegado | | |
| 24 | MatildeMontero (permiso: cxp:ninguno) | `comisiones/doc1` | Get | ❌ denegado | No tiene cxp ni admin | |
| 25 | MatildeMontero (permiso: admin:ninguno) | `historial_cambios/doc1` | Get | ❌ denegado | No tiene admin | |
| 26 | MatildeMontero | `historial_cambios/doc1` | Create | ✅ permitido | Log abierto (no requiere permiso de módulo) | |
| 27 | MatildeMontero (permiso: admin:ninguno) | `roles/rol1` | Get | ❌ denegado | | |
| 28 | MatildeMontero | `users/uqLH17FHSWcIXYniNvP8mlUptpg2` (su propio doc) | Update | ❌ denegado | Solo lectura propia; escritura exclusiva de Admin | |
| 29 | Admin (permiso: admin:escritura) | `gastos/doc1` | Get | ✅ permitido | Vía `esAdminEscritura()` | |
| 30 | Admin (permiso: admin:escritura) | `gastos/doc1` | Create | ✅ permitido | | |
| 31 | Admin (permiso: admin:escritura) | `gastos/doc1` | Update | ✅ permitido | | |
| 32 | Admin (permiso: admin:escritura) | `gastos/doc1` | Delete | ✅ permitido | Delete comparte el mismo permiso que create/update (sin abonos que proteger) | |
| 35 | MatildeMontero (permiso: gastos:ninguno) | `gastos/doc1` | Get | ❌ denegado | Ningún rol tiene `gastos` asignado todavía (default `'ninguno'`) | |
| 36 | MatildeMontero (permiso: gastos:ninguno) | `gastos/doc1` | Create | ❌ denegado | | |
| 38 | MatildeMontero (permiso: gastos:lectura — asignación temporal) | `gastos/doc1` | Get | ✅ permitido | Cobertura aislada de `puedeLeer('gastos')` sin el atajo de `esAdminEscritura()`. Requiere asignar `gastos:'lectura'` temporalmente antes de correr el check | |

## Matriz del commit 20b714b — bloques `ordenes_compra` y `contadores` (22 checks)

Reglas preparadas, **sin desplegar**. Pegar el texto de `firestore.rules` en el editor del Playground **sin publicar**. Cada bloque va con su propio usuario (Authenticated=Yes y el UID del encabezado); la tabla indica Tipo de simulacion (Simulation type) y Ubicacion (Location). Los permisos de cada usuario deben estar en su `permisosResueltos` real, o en un rol de prueba asignado desde Admin -> Roles.

**Documento previo para los casos update:** las reglas de `update` leen `resource.data.ultimo`, y el Playground toma `resource` del documento real en Firestore. El Playground solo simula, no escribe, asi que `contadores/COT-2026` debe existir antes de correr los casos update. Si no existe, crearlo en Firestore Console -> Data -> `contadores` -> Add document, ID `COT-2026`, campo `ultimo` de tipo number con valor `1`. En el Playground, cuerpo del update "actual + 1" = `{"ultimo": 2}` y "actual + 2" = `{"ultimo": 3}` (si el contador real ya tiene otro valor, usar ese valor + 1 y + 2). Para los casos create, el cuerpo es `{"ultimo": 1}`. Los demas casos create (`ordenes_compra/prueba`, `cotizaciones/prueba`) aceptan un cuerpo dummy como `{"x":1}`. Si el documento no existe, el update "actual + 1" saldria Deny por un falso negativo, no por las reglas.

### Bloque 1 - UID de Admin (`stXEoFGfFFS44hbNyDw7RSn7MN53`)

| # | Tipo de simulacion | Ubicacion | Esperado |
|---|---|---|---|
| 1 | get | `contadores/COT-2026` | Allow |
| 2 | get | `contadores/XYZ-2026` | Allow |
| 3 | create | `ordenes_compra/prueba` | Allow |

### Bloque 2 - UID de usuario con SOLO permiso cotizaciones en escritura (UID pendiente: crear rol de prueba en Admin -> Roles y asignarlo)

| # | Tipo de simulacion | Ubicacion | Esperado |
|---|---|---|---|
| 1 | get | `contadores/COT-2026` | Allow |
| 2 | update (ultimo = actual + 1) | `contadores/COT-2026` | Allow |
| 3 | update (ultimo = actual + 2) | `contadores/COT-2026` | Deny |
| 4 | get | `contadores/OC-2026` | Deny |
| 5 | create (ultimo = 1) | `contadores/OC-2027` | Deny |
| 6 | get | `ordenes_compra/prueba` | Deny |
| 7 | create | `ordenes_compra/prueba` | Deny |
| 8 | create | `cotizaciones/prueba` | Allow |

Nota: las filas 2 y 3 son update; `contadores/COT-2026` debe existir antes con `ultimo` numerico (ver "Documento previo para los casos update" arriba).

### Bloque 3 - UID de usuario con SOLO permiso ordenesCompra en escritura (UID pendiente: crear rol de prueba en Admin -> Roles y asignarlo)

| # | Tipo de simulacion | Ubicacion | Esperado |
|---|---|---|---|
| 1 | create (ultimo = 1) | `contadores/OC-2027` | Allow |
| 2 | get | `contadores/OC-2027` | Allow |
| 3 | get | `contadores/COT-2026` | Deny |
| 4 | update (ultimo = actual + 1) | `contadores/COT-2026` | Deny |
| 5 | create | `ordenes_compra/prueba` | Allow |
| 6 | create | `cotizaciones/prueba` | Deny |
| 7 | delete | `contadores/OC-2027` | Deny |

Nota: la fila 4 es update; `contadores/COT-2026` debe existir antes con `ultimo` numerico (ver "Documento previo para los casos update" arriba). La fila 2 hace get de `contadores/OC-2027`: da Allow por la regla de lectura aunque el documento no exista (las reglas evaluan solo permiso y prefijo).

### Bloque 4 - UID de MatildeMontero (`uqLH17FHSWcIXYniNvP8mlUptpg2`), usuario sin permiso cotizaciones ni ordenesCompra

| # | Tipo de simulacion | Ubicacion | Esperado |
|---|---|---|---|
| 1 | get | `contadores/COT-2026` | Deny |
| 2 | get | `contadores/OC-2026` | Deny |
| 3 | get | `contadores/XYZ-2026` | Deny |
| 4 | create | `ordenes_compra/prueba` | Deny |

Nota: confirmar antes que el rol Báscula de MatildeMontero no tenga `cotizaciones` ni `ordenesCompra` (en `users/{uid}.permisosResueltos`); si los tuviera, los Deny serian falsos negativos de la preparacion, no de las reglas.

## Caso sin cobertura real (no bloqueante)

Ningún usuario real tiene hoy `admin:'lectura'` (solo `'escritura'` en Admin, `'ninguno'` en el resto de los usuarios), así que el caso "auditoría de solo-lectura puede ver Admin/roles/historial pero no escribir" no se puede probar con datos reales sin editar temporalmente un rol. Dado que el fallback por defecto es denegar, el riesgo de dejarlo sin probar ahora es bajo — se puede correr el día que se dé de alta a un usuario con ese perfil.

El check #38 de `gastos` tiene la misma naturaleza: se ejecuta con una asignación temporal de permiso (no con el estado real de producción), porque hoy ningún rol real tiene `gastos:'lectura'` ni `gastos:'escritura'` asignado. Revertir esa asignación temporal después de correr el Playground para no dejar datos de prueba en `roles`/`users` reales.

## Resultado

| Total checks | Pass | Fail | Fecha de ejecución |
|---|---|---|---|
| 22 | | | |

**Autorización de deploy:** pendiente hasta confirmar los 22 checks.

## Matriz de las máquinas de estados — bloques `cotizaciones` y `ordenes_compra` (16 checks)

Reglas en `firestore.rules` (raíz), **sin desplegar**. Cubren `create` solo en `Borrador` / `Emitida`, `update` solo por las transiciones válidas (`transicionCotizacionValida`, `transicionOrdenCompraValida`) y `delete` solo de un `Borrador` / una `Emitida`. El Admin pasa por la misma máquina de estados, así que basta con el UID de Admin (`stXEoFGfFFS44hbNyDw7RSn7MN53`).

**Documentos previos (Firestore Console → Data):** el Playground toma `resource` del documento real, así que antes de correr los `update` y `delete` hay que crear, con el campo `estado` de tipo string: `cotizaciones/p-borrador` (`Borrador`), `cotizaciones/p-enviada` (`Enviada`), `cotizaciones/p-aceptada` (`Aceptada`), `cotizaciones/p-reemplazada` (`Reemplazada`), `ordenes_compra/p-emitida` (`Emitida`) y `ordenes_compra/p-recibida` (`Recibida`). Borrarlos al terminar. En los `create` y `update` el cuerpo de la simulación es `{"estado": "<nuevo>"}`.

| # | Tipo | Ubicación | Cuerpo | Esperado |
|---|---|---|---|---|
| 1 | create | `cotizaciones/nueva` | `{"estado":"Borrador"}` | Allow |
| 2 | create | `cotizaciones/nueva` | `{"estado":"Aceptada"}` | Deny |
| 3 | update | `cotizaciones/p-borrador` | `{"estado":"Enviada"}` | Allow |
| 4 | update | `cotizaciones/p-borrador` | `{"estado":"Aceptada"}` | Deny |
| 5 | update | `cotizaciones/p-enviada` | `{"estado":"Reemplazada"}` | Allow |
| 6 | update | `cotizaciones/p-aceptada` | `{"estado":"Reemplazada"}` | Deny |
| 7 | update | `cotizaciones/p-reemplazada` | `{"estado":"Rechazada"}` | Allow |
| 8 | delete | `cotizaciones/p-borrador` | — | Allow |
| 9 | delete | `cotizaciones/p-enviada` | — | Deny |
| 10 | create | `ordenes_compra/nueva` | `{"estado":"Emitida"}` | Allow |
| 11 | create | `ordenes_compra/nueva` | `{"estado":"Recibida"}` | Deny |
| 12 | update | `ordenes_compra/p-emitida` | `{"estado":"Recibida"}` | Allow |
| 13 | update | `ordenes_compra/p-recibida` | `{"estado":"Cancelada"}` | Allow |
| 14 | update | `ordenes_compra/p-recibida` | `{"estado":"Emitida"}` | Deny |
| 15 | delete | `ordenes_compra/p-emitida` | — | Allow |
| 16 | delete | `ordenes_compra/p-recibida` | — | Deny |

Estas 16 filas son una muestra de la matriz completa (6×6 de cotizaciones y 3×3 de OC), que sí se evalúa entera en `scripts/verificar-ordenes-compra-base.js`. Esa prueba traduce el texto real de las reglas a JavaScript: comprueba la lógica escrita en el archivo, pero **no sustituye al Playground** ni al emulador de Firestore.

## Matriz del módulo Flujo de efectivo — bloque `flujo_movimientos` (6 checks)

Regla preparada, **sin desplegar**. Pegar el texto de `firestore.rules` en el editor del Playground **sin publicar**. Mismo patrón que `cobros`, pero con el permiso propio `flujo` (lectura con `puedeLeer('flujo')`, escritura con `puedeEscribir('flujo')`). Para el Bloque 2 hay que asignar `flujo` al usuario de prueba desde Admin -> Roles (un usuario con `admin:escritura` ya lo cubre por `esAdminEscritura()`). Cuerpo dummy para create: `{"x":1}`.

### Bloque 1 - UID de Admin (`stXEoFGfFFS44hbNyDw7RSn7MN53`)

| # | Tipo de simulacion | Ubicacion | Esperado |
|---|---|---|---|
| 1 | get | `flujo_movimientos/prueba` | Allow |
| 2 | create | `flujo_movimientos/prueba` | Allow |

### Bloque 2 - UID de usuario con SOLO permiso flujo en lectura (crear rol de prueba en Admin -> Roles y asignarlo)

| # | Tipo de simulacion | Ubicacion | Esperado |
|---|---|---|---|
| 1 | get | `flujo_movimientos/prueba` | Allow |
| 2 | create | `flujo_movimientos/prueba` | Deny |

### Bloque 3 - UID de usuario SIN permiso flujo (p. ej. MatildeMontero, rol Báscula)

| # | Tipo de simulacion | Ubicacion | Esperado |
|---|---|---|---|
| 1 | get | `flujo_movimientos/prueba` | Deny |
| 2 | create | `flujo_movimientos/prueba` | Deny |
