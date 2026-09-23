# Matriz de pruebas — Firestore Rules Playground

**Proyecto:** EVE Control — Sistema de Roles y Permisos (Tarea 3)
**Fecha:** 2026-09-10
**Instrucciones:** Pega el texto de reglas ya aprobado en el editor del Playground (Firestore Database → Rules → ícono ▶ Playground) **sin publicar**. Para cada fila: Authenticated=Yes, Firebase UID según la tabla de UIDs, Operación (= Simulation type del Playground) y Colección (= Location del Playground) según la fila, Run — y anota el resultado real en la última columna.

**Antes de arrancar:** confirma que Christian, Admin y Matilde ya tienen `permisosResueltos` escrito en su doc real de Firestore. Si falta en alguno, todo lo suyo saldrá ❌ por el fallback `'ninguno'` — eso sería un falso negativo, no un problema de las reglas.

**Nota sobre tipos de simulación:** el Playground no tiene un tipo "Write" genérico.
- Filas marcadas **Update** → usa simulation type **Update**.
- Filas marcadas **Create** sobre `historial_cambios` (#9, #26) → simulation type **Create**, porque ese log solo se escribe con `.add()` (nunca update).
- Filas marcadas **Delete** (#32) → simulation type **Delete**.
- Para **Get** no hace falta document data. Para **Update/Create** el Playground pide un JSON de body — cualquier contenido dummy sirve (ej. `{"x":1}`), ninguna regla de esta versión inspecciona `resource.data`.
- Filas #37-38 requieren asignar temporalmente el permiso indicado entre paréntesis al usuario (Firestore Console → `roles/{rolId}.permisos.gastos` o `users/{uid}.permisosResueltos.gastos`) antes de correr el check — no reflejan el estado real de producción.

## UIDs de referencia

| Usuario | UID |
|---|---|
| Admin (`admin@everplastic.local`) | `stXEoFGdFFS44hbNyDw7RSn7MN53` |
| Matilde (`matildemontero@everplastic.local`, rol Báscula) | `uqLH17FHSWcIXYniNvP8mlUptpg2` |

## Matriz completa (38 checks)

| # | Usuario | Colección | Operación | Resultado esperado | Nota | Resultado real |
|---|---|---|---|---|---|---|
| 1 | Christian (permiso: pagos:escritura) | `pagos/doc1` | Get | ✅ permitido | | |
| 2 | Christian (permiso: pagos:escritura) | `pagos/doc1` | Update | ✅ permitido | | |
| 3 | Christian (permiso: control_produccion:escritura) | `control_produccion/doc1` | Get | ✅ permitido | | |
| 4 | Christian (permiso: control_produccion:escritura) | `control_produccion/doc1` | Update | ✅ permitido | | |
| 5 | Christian (permiso: cxp:ninguno) | `cuentas_por_pagar/doc1` | Get | ❌ denegado | | |
| 6 | Christian (permiso: destaraje:ninguno) | `destaraje/doc1` | Get | ❌ denegado | | |
| 7 | Christian (permiso: cxp:ninguno) | `proveedores/doc1` | Get | ❌ denegado | Confirma que ya no hereda de 'pagos' | |
| 8 | Christian (permiso: cxp:ninguno) | `comisiones/doc1` | Get | ❌ denegado | No tiene cxp | |
| 9 | Christian | `historial_cambios/doc1` | Create | ✅ permitido | Log append-only, abierto a cualquier autenticado (no requiere permiso de módulo) | |
| 10 | Christian (permiso: admin:ninguno) | `historial_cambios/doc1` | Get | ❌ denegado | No tiene admin | |
| 11 | Christian (permiso: admin:ninguno) | `roles/rol1` | Get | ❌ denegado | | |
| 12 | Christian | `users/vpveBduFd6MQfN5x2PTOk7o3PBa2` (su propio doc) | Get | ✅ permitido | Puede leer el suyo aunque no tenga admin | |
| 13 | Christian (permiso: admin:ninguno) | `users/stXEoFGfFFS44hbNyDw7RSn7MN53` (doc de Admin) | Get | ❌ denegado | | |
| 14 | Admin (permiso: admin:escritura) | `pagos/doc1` | Get | ✅ permitido | | |
| 15 | Admin (permiso: admin:escritura) | `cuentas_por_pagar/doc1` | Get | ✅ permitido | | |
| 16 | Admin (permiso: admin:escritura) | `comisiones/doc1` | Get | ✅ permitido | | |
| 17 | Admin (permiso: admin:escritura) | `comisiones/doc1` | Update | ✅ permitido | Único que puede escribir ahí | |
| 18 | Admin (permiso: admin:escritura) | `historial_cambios/doc1` | Get | ✅ permitido | | |
| 19 | Admin (permiso: admin:escritura) | `destaraje/doc1` | Update | ✅ permitido | | |
| 20 | Admin (permiso: admin:escritura) | `users/I2HendUYCXMEcd2nqved8KxziWK2` (doc de Matilde) | Get | ✅ permitido | | |
| 21 | Admin (permiso: admin:escritura) | `roles/rol1` | Update | ✅ permitido | | |
| 22 | Matilde (permiso: destaraje:escritura) | `destaraje/doc1` | Update | ✅ permitido | | |
| 23 | Matilde (permiso: pagos:ninguno) | `pagos/doc1` | Update | ❌ denegado | | |
| 24 | Matilde (permiso: cxp:ninguno) | `comisiones/doc1` | Get | ❌ denegado | No tiene cxp ni admin | |
| 25 | Matilde (permiso: admin:ninguno) | `historial_cambios/doc1` | Get | ❌ denegado | No tiene admin | |
| 26 | Matilde | `historial_cambios/doc1` | Create | ✅ permitido | Log abierto (no requiere permiso de módulo) | |
| 27 | Matilde (permiso: admin:ninguno) | `roles/rol1` | Get | ❌ denegado | | |
| 28 | Matilde | `users/I2HendUYCXMEcd2nqved8KxziWK2` (su propio doc) | Update | ❌ denegado | Solo lectura propia; escritura exclusiva de Admin | |
| 29 | Admin (permiso: admin:escritura) | `gastos/doc1` | Get | ✅ permitido | Vía `esAdminEscritura()` | |
| 30 | Admin (permiso: admin:escritura) | `gastos/doc1` | Create | ✅ permitido | | |
| 31 | Admin (permiso: admin:escritura) | `gastos/doc1` | Update | ✅ permitido | | |
| 32 | Admin (permiso: admin:escritura) | `gastos/doc1` | Delete | ✅ permitido | Delete comparte el mismo permiso que create/update (sin abonos que proteger) | |
| 33 | Christian (permiso: gastos:ninguno) | `gastos/doc1` | Get | ❌ denegado | Ningún rol tiene `gastos` asignado todavía (default `'ninguno'`) | |
| 34 | Christian (permiso: gastos:ninguno) | `gastos/doc1` | Create | ❌ denegado | | |
| 35 | Matilde (permiso: gastos:ninguno) | `gastos/doc1` | Get | ❌ denegado | Mismo motivo que #33 | |
| 36 | Matilde (permiso: gastos:ninguno) | `gastos/doc1` | Create | ❌ denegado | | |
| 37 | Christian (permiso: gastos:escritura — asignación temporal) | `gastos/doc1` | Update | ✅ permitido | Cobertura aislada de `puedeEscribir('gastos')` sin el atajo de `esAdminEscritura()`. Requiere asignar `gastos:'escritura'` temporalmente antes de correr el check | |
| 38 | Matilde (permiso: gastos:lectura — asignación temporal) | `gastos/doc1` | Get | ✅ permitido | Cobertura aislada de `puedeLeer('gastos')` sin el atajo de `esAdminEscritura()`. Requiere asignar `gastos:'lectura'` temporalmente antes de correr el check | |

## Caso sin cobertura real (no bloqueante)

Ningún usuario real tiene hoy `admin:'lectura'` (solo `'escritura'` en Admin, `'ninguno'` en el resto de los usuarios), así que el caso "auditoría de solo-lectura puede ver Admin/roles/historial pero no escribir" no se puede probar con datos reales sin editar temporalmente un rol. Dado que el fallback por defecto es denegar, el riesgo de dejarlo sin probar ahora es bajo — se puede correr el día que se dé de alta a un usuario con ese perfil.

Los checks #37-38 de `gastos` tienen la misma naturaleza: se ejecutan con una asignación temporal de permiso (no con el estado real de producción), porque hoy ningún rol real tiene `gastos:'lectura'` ni `gastos:'escritura'` asignado. Revertir esa asignación temporal después de correr el Playground para no dejar datos de prueba en `roles`/`users` reales.

## Resultado

| Total checks | Pass | Fail | Fecha de ejecución |
|---|---|---|---|
| 38 | | | |

**Autorización de deploy:** pendiente hasta confirmar los 38 checks.
