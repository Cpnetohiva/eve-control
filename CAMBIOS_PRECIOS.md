# Cambios: precios congelados con catálogo desactualizado

Fecha: 2026-11-13. **Sin commit** (a la espera de autorización). Contexto y diagnóstico en `AUDITORIA_PRECIOS.md`.
El repreciado **no se ejecutó contra datos reales**; solo se probó con un Firestore en memoria.

## 1. Causa de fondo y qué se hizo

`window.EVE.precios` se leía una sola vez al iniciar sesión (`js/auth.js`) o salía de la caché offline (`js/offline.js`), y ningún botón «↻ Actualizar» lo releía. Un precio dado de alta desde otro equipo no llegaba a quien ya tenía la sesión abierta, y sus CxP congelaban el precio viejo.

| # | Cambio | Dónde |
|---|---|---|
| 1 | Sincronización del catálogo al recuperar foco o conexión (`precios` y `ajustes_precio_proveedor`), con mínimo de 2 min entre lecturas. Se omite sin conexión, sin sesión, sin permiso y si hay capturas sin conexión por subir (para no borrar precios locales que Firestore aún no tiene). Al terminar actualiza la caché offline. | `js/precios-sync.js` (nuevo), `js/auth.js:200-202` |
| 2 | Antes de congelar el precio en una CxP: con conexión se lee **del servidor** (`get({source:'server'})`) solo el catálogo y ajustes de ese material; sin conexión o si la lectura falla, la CxP se crea con la memoria, queda con `precioDeCache: true` y se avisa. La lectura se reutiliza 60 s por material, así que un lote de CxP del mismo material no multiplica lecturas. | `js/cxp.js:417-440` y `js/precios-sync.js` (`asegurarPreciosFrescos`) |
| 3 | `obtenerPrecioVigente`: con vigencias traslapadas gana la de `fechaInicio` más reciente (empate: `fechaRegistro` más reciente). | `js/utils.js:90-106` |
| 4 | Herramienta Admin > «Repreciar CxP» con vista previa. Lógica en `js/cxp.js` y pantalla en `js/admin-repreciar.js` (nuevo). | ver abajo |
| 5 | Pruebas nuevas. | `scripts/verificar-repreciado-precios.js` (nuevo) |

### Herramienta de repreciado
- `planificarRepreciado(cuentas, {material, desde, hasta})` (`js/cxp.js:1538`): pura, **no escribe**. Lista las CxP del material y rango (por `fechaTicket`) cuyo `precioBase` difiere del precio de catálogo vigente a esa fecha.
  - Repreciables: sin abonos ni pagos, sin `precioNegociado`, sin `ajusteProveedorAplicado`.
  - No repreciables (listadas aparte, con su motivo y su diferencia en pesos, y totales por proveedor): con abonos o pagos, precio negociado, ajuste de proveedor, ajuste de proveedor que hoy sí aplicaría, sin precio vigente, saldo inicial.
  - Columnas: ticket, proveedor, fecha, kg, precio actual, precio nuevo, diferencia $, creada por.
- `aplicarRepreciado(items, {usuario})` (`js/cxp.js:1578`): por cada CxP, antes de escribir verifica pagos frescos y recibos pendientes, y dentro de una transacción vuelve a leer la cuenta y revalida todas las condiciones. Si algo cambió desde la vista previa, la omite con su motivo. Recalcula con `recalcularMontosCxP` y guarda en la CxP:
  `repreciado: { por, en (ISO), precioAnterior, precioBaseAnterior, totalAnterior, precioNuevo, totalNuevo, motivo }`. También se registra en el historial y se actualiza la memoria.
- Pantalla (`js/admin-repreciar.js`): material + rango → «Vista previa» (relee catálogo y CxP del rango del servidor) → botón «Repreciar estas CxP…» → `window.confirm` con cantidad y diferencia total → escritura dentro de `protegerContraDobleRegistro`. Visible solo para Admin con escritura (`js/admin.js`).
- Es idempotente: tras repreciar, la CxP ya coincide con el catálogo y no vuelve a aparecer.

## 2. Archivos tocados

| Archivo | Cambio |
|---|---|
| `js/precios-sync.js` | Nuevo (sincronización y lectura fresca por material) |
| `js/admin-repreciar.js` | Nuevo (pantalla de repreciado) |
| `scripts/verificar-repreciado-precios.js` | Nuevo (12 casos) |
| `js/cxp.js` (CRLF conservado) | +151 líneas: lectura fresca y `precioDeCache` en `generarYGuardarCxP`; `planificarRepreciado`, `aplicarRepreciado`, `motivosNoRepreciable`; exporta también `recalcularMontosCxP` y `MOTIVO_REPRECIADO` |
| `js/utils.js` (CRLF conservado) | `obtenerPrecioVigente` con desempate por vigencia más reciente |
| `js/auth.js` (CRLF conservado) | `marcarCargaCompleta()` tras la carga inicial |
| `js/admin.js` | Subpestaña «Repreciar CxP» |
| `index.html`, `service-worker.js` | Scripts nuevos en `<script>` y `APP_SHELL`; `CACHE_NAME` r254 → **r255** |

`firestore.rules` no se tocó: las reglas de `cuentas_por_pagar` no restringen campos, así que `precioDeCache` y `repreciado` se aceptan.

## 3. Resultados de pruebas

- **Prueba nueva:** `node scripts/verificar-repreciado-precios.js` → **12 de 12**. Contra los archivos originales de `js/utils.js` y `js/cxp.js` fallan 9 de 12 (los 3 que pasan prueban solo `precios-sync.js`, que es archivo nuevo, o un empate que ya resolvía por casualidad el orden de la lista).
- Casos: retroactivo con caché vieja (con conexión: 9.70; sin conexión: 9.50 con `precioDeCache`; servidor caído: igual), lecturas no multiplicadas, vigencias traslapadas (dos), vista previa (pendiente sí; con pagos, negociado y ajuste no), aplicar (solo escribe la pendiente, recalcula, deja rastro, idempotente), aplicar con pago llegado después, aplicar sin conexión, sincronización (reemplaza, intervalo, sin conexión / cola pendiente / sin sesión).
- **Suites existentes del área** (CxP, precios, pagos, edición de ticket, desalineación, captura, recibos, dashboard, offline, appshell y las demás relacionadas): todas en 0, incluida `verificar-appshell.js` con `CACHE_NAME` r255.
- **Fallan sin relación con estos cambios** (también fallan con el código original, comprobado restaurándolo): `verificar-currentuser-id.js` y `verificar-orden-proveedor-ticket.js`. No se tocaron. (`verificar-gastos-tipo.js`, falla conocida según `CLAUDE.md`, no apareció como fallo en esta corrida.)
- No se probó en navegador: la pantalla de Admin y los listeners de foco/conexión no tienen prueba automática. Conviene revisarlos a mano (paso 2 de abajo).

## 4. Cómo ejecutar el repreciado en la app (después de autorizar y desplegar)

1. Despliega la versión (r255) y cierra y abre la app en un equipo para que tome el service worker nuevo. Entra como Admin.
2. Revisa la pantalla antes de usarla: Admin > **Repreciar CxP** debe aparecer y cargar sin errores en consola.
3. Elige material **PET**, desde **2026-11-09** y hasta hoy; pulsa **Vista previa**. No escribe nada.
4. Revisa la tabla «Se pueden repreciar»: precio actual 9.50, precio nuevo 9.70, diferencia en pesos y «creada por». Compara el total con el que esperabas (kg × 0.20).
5. Revisa «No se tocan»: ahí están las CxP con pagos, precio negociado o ajuste de proveedor, con su diferencia por proveedor. **Esas no se corrigen aquí**; se decide aparte (ver `AUDITORIA_PRECIOS.md`, sección 5).
6. Si todo cuadra, pulsa **Repreciar estas CxP…** y confirma el cuadro. Al terminar verás cuántas se repreciaron y cuáles se omitieron, con motivo.
7. Vuelve a pulsar **Vista previa**: debe mostrar 0 repreciables.
8. Comprueba una CxP en CxP (precio 9.70, total recalculado) y que en Firestore el documento tenga `repreciado` con tu usuario, la fecha y el precio anterior.
9. Si algo no cuadra, el precio anterior y el total anterior están en `repreciado.precioAnterior` y `repreciado.totalAnterior` de cada CxP para revertir a mano.

## 5. Pendientes y límites

- El catálogo se actualiza al recuperar foco o conexión, no en tiempo real: un precio dado de alta con la app en primer plano llega al volver a enfocar la ventana (máx. cada 2 min) o al crear la siguiente CxP, que siempre lee el servidor.
- Las CxP ya pagadas o con abonos siguen sin tratamiento automático (propuesta 4 de la auditoría).
- Sigue sin existir un aviso al dar de alta un precio retroactivo (propuesta 2 de la auditoría); no se pidió en este trabajo.
- Si no puedes leer `precios` (permiso), `sincronizar` no hace nada; ese caso ya existía.

---

# Parte 2: prevención de traslape de vigencias

**Causa real detectada:** PET tenía dos registros de 9.50 con `fechaInicio` 2026-07-23 (uno cerrado el 2026-11-08 y un duplicado con `fechaFin` null). Al dar de alta 9.70 desde 2026-11-09, `construirNuevoPrecio` cerraba solo un contenedor, el duplicado seguía abierto y `obtenerPrecioVigente` devolvía 9.50 para toda fecha posterior. (Esto es independiente de la caché de la parte 1: ahí el catálogo estaba al día pero mal formado.)

## Qué cambió

| # | Pedido | Cambio | Dónde |
|---|---|---|---|
| 1 | Cerrar **todos** los registros que cubren la nueva fecha | `construirNuevoPrecio` devuelve `cierres` (todos los contenedores, abiertos o con fin posterior) y mantiene `cierre` (el primero) por compatibilidad. El nuevo hereda el fin: abierto si algún contenedor lo estaba, si no el más lejano; y nunca invade a un precio posterior ya existente. El alta manual y la importación cierran todos. | `js/precios.js` (`construirNuevoPrecio`, `encontrarPreciosContenedores`, `manejarEnvioPrecio`, aviso del formulario), `js/admin-importar.js` (`procesarFilaPrecioGeneral`, `ejecutarCierreYNuevo`) |
| 2 | Bloquear duplicados y traslapes irresolubles; importación idempotente | Se bloquea con mensaje: misma fecha de inicio (ya existía) y registros posteriores ya traslapados entre sí (manda a Admin > Traslapes de precios). En importación, una fila idéntica a un precio existente (mismo material, fecha y precio) se rechaza con «Ya existe… no se vuelve a crear»; con la misma fecha y otro precio se bloquea por duplicada. Varios cierres + el nuevo viajan **en el mismo lote** de Firestore (`dividirEnLotes` ahora respeta cadenas, no solo pares). | `js/precios.js`, `js/admin-importar.js` |
| 3 | Detector de traslapes en administración | `detectarTraslapes` (solo lectura, por material) y `accionesDeTraslape`; pantalla Admin > **Traslapes de precios**. Acciones: «Cerrar al DD/MM/AAAA» (si un registro posterior invade) y «Eliminar duplicado» (solo si hay otro con la misma fecha de inicio; nunca se elimina el único). Ambas piden confirmación, y dejan quién y cuándo: `historial_cambios` y, al cerrar, `cierreTraslapePor` y `cierreTraslapeEn` en el precio. «Buscar» relee el catálogo del servidor antes de listar. | `js/precios.js`, `js/admin-traslapes.js` (nuevo), `js/admin.js`, `index.html`, `service-worker.js` |
| 4 | Confirmar que `obtenerPrecioVigente` elige la fechaInicio más reciente | Confirmado y cubierto por prueba (hecho en la parte 1, `js/utils.js:90-106`; empate de fechaInicio: gana la de `fechaRegistro` más reciente). Se prueba con las tres permutaciones de orden de la lista. | `js/utils.js` |
| 5 | Prueba del escenario exacto | `scripts/verificar-traslape-precios.js` (14 casos): A cerrado, B duplicado abierto, C 9.70 desde 2026-11-09 → exige 9.70 en 2026-11-09, 11-10, 12-31 y 2027-03-01 y 9.50 antes; el alta con ambos 9.50 abiertos; importación; detector; acciones. | `scripts/verificar-traslape-precios.js` (nuevo) |

`js/admin-importar.js` exporta además `procesarConfirmacionPreciosGenerales` y `dividirEnLotes` (para poder probarlos). Los finales de línea CRLF de `precios.js`, `admin-importar.js`, `admin.js`, `cxp.js`, `utils.js`, `auth.js` e `index.html` se conservaron. `CACHE_NAME` sigue en **r255** (el mismo cambio de versión cubre ambas partes, aún sin commit).

## Resultados de pruebas
- `node scripts/verificar-traslape-precios.js` → **14 de 14**. Con `precios.js`, `admin-importar.js` y `utils.js` originales pasan 4 de 14 (fallan el escenario exacto, el alta con dos abiertos, el detector, las acciones y la importación).
- `node scripts/verificar-repreciado-precios.js` (parte 1) → 12 de 12.
- Todas las demás suites de `scripts/verificar-*.js` en 0, incluidas `verificar-importadores.js`, `verificar-normalizacion-materiales.js` y `verificar-appshell.js`. Siguen fallando solo `verificar-currentuser-id.js` y `verificar-orden-proveedor-ticket.js`, que ya fallaban antes de estos cambios.
- No hay prueba en navegador de la pantalla «Traslapes de precios»; revísala a mano.

## Pasos para limpiar el PET real (cuando autorices y se despliegue)
1. Admin > **Traslapes de precios** > «Buscar traslapes». Debe aparecer PET con los tres registros (9.50 cerrado, 9.50 abierto, 9.70).
2. En el 9.50 abierto: **Cerrar al 08/11/2026** (queda con el rango idéntico al otro 9.50) y confirma.
3. Vuelve a buscar: quedará PET como duplicado exacto. En uno de los dos 9.50: **Eliminar duplicado** y confirma. (Si prefieres conservar el duplicado ya cerrado, no es dañino: ya no gana a nada.)
4. Verifica en Precios que PET vigente es 9.70 y entonces corre **Repreciar CxP** (parte 1) para PET desde 2026-11-09.

## Límites
- Los **ajustes por proveedor** (`construirNuevoAjustePrecio`) tienen el mismo patrón de un solo cierre; no se tocaron porque el pedido era de precios. Conviene el mismo endurecimiento en otra tarea.
- El alta manual cierra los contenedores uno por uno (`actualizarDato`), no en un lote: si falla a medias, el detector lo mostrará. La importación sí es en un solo lote.
- Registros con `fechaFin` anterior a su `fechaInicio` (datos corruptos) no se tratan especialmente.

---

# Parte 3: aviso de repreciado al dar de alta un precio

**Qué hace:** al guardar un precio con `fechaInicio` igual o anterior a hoy (alta manual en Precios o importación de Precios Generales), se cuentan las CxP del material, desde esa fecha hasta hoy, que quedarían con precio distinto. Si hay alguna, aparece un aviso: *«N CxP de PET desde DD/MM/AAAA quedarían con precio distinto al nuevo (diferencia $X; A repreciables, B no se tocan)»*, con el botón **Revisar y repreciar**. El botón abre Admin > Repreciar CxP con el material y el rango ya cargados y corre la vista previa (que solo lee). **El aviso no escribe nada**: repreciar sigue pidiendo la confirmación explícita de la Parte 1.

## Reglas
- Fecha futura (`fechaInicio` > hoy): no hay aviso y ni siquiera se leen CxP.
- Cuenta repreciables y no repreciables (con pagos, negociado, ajuste de proveedor); la diferencia total es la suma de ambas. Si no hay ninguna con precio distinto, no hay aviso.
- Lee las CxP del servidor (una consulta por rango de `fechaTicket`); si falla o no hay conexión, usa la memoria. Sin permiso de lectura de CxP no calcula nada. Cualquier error del aviso se atrapa: el alta ya guardada nunca se afecta.
- El botón solo aparece si el usuario puede escribir en CxP y ver la subpestaña Repreciar (Admin con escritura). Los demás ven el aviso sin botón.
- En la importación, si hay varias filas del mismo material se usa la fecha de inicio más antigua; las altas se toman antes de que se limpie el análisis del archivo y el aviso aparece al final de la tarjeta de importación, después de recargar los datos.

## Archivos y líneas

| Archivo | Líneas | Cambio |
|---|---|---|
| `js/cxp.js` | 1580-1626, 1707-1708 | `resumirAvisoRepreciado` (pura, usa `planificarRepreciado`) y `avisoRepreciadoTrasAlta` (con lectura); exportadas |
| `js/admin-repreciar.js` | 118-155, 180-188 | `mostrarAvisoTrasAlta` (aviso + botón), `avisarTrasAlta`, `fijarPreseleccion`; la pantalla recibe material y rango y lanza la vista previa |
| `js/admin.js` | 72-76, 83-96 | `renderAdmin`/`mostrarPanelAdmin` aceptan una subpestaña inicial; `abrirRepreciar(datos)` exportada en `EVE_ADMIN` |
| `js/precios.js` | 371, 1041-1043, 1054 | `manejarEnvioPrecio` llama al aviso tras guardar; contenedor `#precios-aviso-repreciar`; expone `manejarEnvioPrecio` para pruebas |
| `js/admin-importar.js` | 1690-1705 | `manejarConfirmarImportacion` toma las altas de Precios Generales y muestra el aviso tras importar |
| `scripts/verificar-aviso-repreciado.js` | nuevo | 10 casos |

No se agregaron archivos de `js/` (nada nuevo en `index.html` ni `APP_SHELL`). `CACHE_NAME` sigue en **r255**: nada se ha publicado desde que se subió a r255 en la Parte 1, así que el mismo número cubre las tres partes. Si se hace commit por partes, súbelo en cada commit. CRLF conservado en `cxp.js`, `precios.js`, `admin.js` y `admin-importar.js` (0 líneas solo-LF).

## Resultados de pruebas
- `node scripts/verificar-aviso-repreciado.js` → **10 de 10**. Sin los cambios en `js/` pasa 1 de 10 (solo el de «sin permiso para abrir, sin botón», que depende de código ya existente en `admin-repreciar.js`).
- Los tres casos pedidos: **alta retroactiva con CxP afectadas** (aparece: «2 CxP de PET», $400.00, «1 repreciables, 1 no se tocan», el botón abre Repreciar con `{PET, 2026-11-09, hoy}` y las únicas escrituras son el alta y el cierre del precio anterior, ninguna en `cuentas_por_pagar`); **fecha futura** (no aparece, 0 lecturas de CxP); **sin CxP afectadas** (ya con el precio nuevo, otro material o fuera del rango: no aparece).
- Casos extra: alta con fecha de hoy, aviso con lectura del servidor caída (usa la memoria y el alta se conserva), sin permiso de CxP, aviso sin botón, importación con y sin CxP afectadas, y revisión por texto de que ambos flujos llaman al aviso después de guardar.
- Todas las suites de `scripts/verificar-*.js` (precios, CxP, importadores, normalización de materiales, edición de ticket, appshell, recibos, dashboard, offline y demás), incluidas `verificar-traslape-precios.js` (14/14) y `verificar-repreciado-precios.js` (12/12): en 0. Solo fallan `verificar-currentuser-id.js` y `verificar-orden-proveedor-ticket.js`, que ya fallaban antes de estos cambios.

## Límites
- Sin prueba en navegador: el aviso en pantalla, el botón y el salto a Admin > Repreciar solo se probaron con un DOM mínimo. La prueba de importación cubre el cálculo y la revisión por texto, no el flujo completo de `manejarConfirmarImportacion`.
- Si el aviso de la importación se pierde porque la pantalla se repinta, el mismo cálculo se obtiene abriendo Admin > Repreciar CxP a mano.
- El aviso mide diferencias contra el catálogo vigente completo, no solo contra el precio recién dado de alta; si había otras CxP ya desfasadas del mismo material en ese rango, también se cuentan (es lo que la vista previa va a mostrar).
