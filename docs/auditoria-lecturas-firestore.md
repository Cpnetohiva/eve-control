# Auditoría de lecturas de Firestore — plan de carga reducida

- **Fecha:** 2026-10-28
- **Modo:** solo lectura. No se modificó código ni `CACHE_NAME`.
- **Contexto (cifras del usuario, medidas en consola):** plan Spark, tope de 50 mil lecturas por día. Una carga completa de `window.EVE` descarga **1,824 documentos** (`registrosDestaraje` 523, `cuentasPorPagar` 521, `registrosPagos` 501, `cuentasPorCobrar` 60, `cobros` 57, `ventas` 51, `gastos` 50, `precios` 31, el resto menos de 12). Consumo diario de 28–30 mil lecturas, con un pico de 47 mil.
- **Método:** lectura de `js/auth.js`, `js/utils.js`, `js/offline.js`, `js/permisos.js`, `js/config.js`, `index.html`, `service-worker.js` y búsqueda de `window.EVE.<campo>`, `.get()`, `onSnapshot` y `cargarDatos` en todo `js/`. No se ejecutó la app: las cifras de documentos son las que dio el usuario; el resto es lectura de código.
- **Alcance:** las secciones 1 a 6 cubren la carga inicial, el uso por módulo y la reconstrucción desde todo el CxP; la 7, qué tolera una ventana de fechas; la 8, el plan de carga reducida con estimaciones y riesgos; la 9, las reglas rechazadas.

---

## 1. Qué se descarga al iniciar sesión

### 1.1 Resumen

| Aspecto | Hallazgo |
|---|---|
| Método | `get()` de la colección completa (`window.cargarDatos`, `js/utils.js:280`: `db.collection(c).get()` sin filtro ni límite). **No hay `onSnapshot` en ningún archivo de `js/`.** |
| Disparador | `onAuthStateChanged` (`js/auth.js:406`) → `establecerSesionActiva` → `cargarDatosEnParalelo` (`js/auth.js:135`). Corre **una vez por cada carga de página** (F5, pestaña nueva, volver a abrir la PWA, recarga tras actualizar el service worker) y en cada inicio de sesión. |
| Alcance | 23 colecciones en paralelo con `Promise.allSettled`, más `users/{uid}` y `config/sistema` (1 documento cada una). |
| Filtro por rol | Sí, **por módulo, no por documento**: cada colección se pide solo si `puedeLeer(modulo)` es verdadero (`js/auth.js:147`). Si no, se resuelve a `[]` sin leer. Si se tiene permiso, se descarga **toda** la colección, sin filtro de fecha, proveedor ni estado. |
| Permiso denegado | `permission-denied` se degrada a `[]` y el login sigue. Cualquier otro error tumba el login. |
| Caché de Firestore | `enablePersistence({ synchronizeTabs: true })` (`js/config.js:13`). `get()` con red va al servidor y **factura cada documento devuelto**, aunque no haya cambiado. La persistencia no reduce estas lecturas. |
| Caché IndexedDB propia | `guardarCacheDatos` (`js/offline.js:84`) **escribe** una copia tras cada carga, pero `cargarCacheDatos` (`js/offline.js:133`) **no se llama desde ningún lado**: es código sin uso. La copia no evita ninguna lectura. |

### 1.2 Colecciones descargadas (`CARGAS_MODULO`, `js/auth.js:96`)

| Campo de `window.EVE` | Colección | Permiso que la habilita | Documentos medidos |
|---|---|---|---|
| `registrosDestaraje` / `registrosVentas` | `destaraje` (se parte en memoria: ticket numérico → Báscula; `'V'` → ventas legado) | `destaraje` | 523 |
| `registrosPagos` | `pagos` | `pagos` | 501 |
| `registrosMinistraciones` | `ministraciones` | `pagos` | < 12 |
| `registrosControlProduccion` | `control_produccion` | `control_produccion` | no indicado |
| `precios` | `precios` | `precios` | 31 |
| `ajustesPrecioProveedor` | `ajustes_precio_proveedor` | `precios` | < 12 |
| `cuentasPorPagar` | `cuentas_por_pagar` | `cxp` | 521 |
| `auditorias`, `proveedores`, `comisiones`, `auditoriaFotos` | `auditorias`, `proveedores`, `comisiones`, `auditoria_fotos` | `cxp` | < 12 cada una (salvo que `auditoria_fotos` crece con las fotos) |
| `ventas` | `ventas` | `ventas` | 51 |
| `composiciones` | `composiciones` | `ventas` **o** `rendimientos` | < 12 |
| `cuentasPorCobrar` | `cuentas_por_cobrar` | `cxc` | 60 |
| `cobros` | `cobros` | `cxc` | 57 |
| `gastos` | `gastos` | `gastos` | 50 |
| `flujoMovimientos` | `flujo_movimientos` | `flujo` | < 12 |
| `cotizaciones`, `clientesCotizacion` | `cotizaciones`, `clientes_cotizacion` | `cotizaciones` | < 12 |
| `ordenesCompra` | `ordenes_compra` | `ordenesCompra` | < 12 |
| `recibosDinero` | `recibos_dinero` | `recibosDinero` | < 12 |
| `inventario`, `inventarioInicial` | `inventario`, `inventario_inicial` | `inventario` | < 12 |

Un usuario con todos los permisos descarga las 23. Un rol limitado descarga solo las de sus módulos, pero cada una **completa**.

### 1.3 Recargas posteriores

| Evento | ¿Vuelve a descargar `window.EVE`? |
|---|---|
| Después de guardar | **No.** Los módulos actualizan la memoria a mano (`window.EVE.registrosPagos.push(...)`, `refrescarEnMemoria`). |
| Al cambiar de pestaña | **No.** `activarTab` solo llama `modulo.render` (`js/auth.js:230`). |
| Al actualizar el service worker | El SW hace `skipWaiting()` + `clients.claim()`; `controllerchange` muestra un aviso y, **si el usuario acepta, `location.reload()`** (`index.html:123-126`). Esa recarga repite la descarga completa (1,824 lecturas). |
| Evento `online` (`js/offline.js:311`) | Solo sincroniza la cola de escrituras y vuelve a guardar la copia en IndexedDB. No lee Firestore. |
| Cerrar e iniciar sesión | Descarga completa. |

### 1.4 Los "3 listeners activos en tiempo real"

**No existen listeners de Firestore.** `git grep onSnapshot` no encuentra nada fuera de documentos. Lo que sí hay, y que quizá se confundió con listeners:

1. `firebase.auth().onAuthStateChanged` (`js/auth.js:406`): dispara la carga completa. Es lo que más lecturas genera.
2. `window.addEventListener('online')` (`js/offline.js:311`): sincroniza la cola offline.
3. `window.addEventListener('offline')` (`js/offline.js:312`): solo cambia el indicador de conexión.

Ninguno mantiene una suscripción abierta a documentos, así que el consumo no viene de tiempo real.

### 1.5 Lecturas fuera de `window.EVE`

Consultas que se suman a las 1,824:

| Dónde | Consulta | Frecuencia | Riesgo |
|---|---|---|---|
| `js/recibos-pago.js:8` | `recibos_pago` ordenada por fecha, **sin límite** | Cada vez que se abre Recibos de Pago | Crece con el tiempo |
| `js/historial.js:45` | `historial_cambios` últimos 200 | Cada vez que se abre Admin → Historial | Acotada a 200 |
| `js/pagos.js:248` | `recibos_pendientes` con `estado == 'pendiente_pago'` | Al mostrar Pagos | Acotada por estado |
| `js/cxp.js:1189` | `recibos_pendientes` por proveedor | Al elegir un proveedor | Acotada |
| `js/ordenescompra.js:165,176` | `listarOCs()` y `listarOCsPorRango` leen toda la colección | Ninguna llamada encontrada fuera de su archivo | Duplicaría `window.EVE.ordenesCompra` si se usa |
| `js/ordenescompra.js:240`, `js/recibosdinero.js:262` | `cargarDatos()` vuelve a bajar toda la colección | **Ninguna llamada encontrada** (solo se exportan) | Código sin uso hoy |
| `js/destaraje.js:341`, `js/cxp.js:776`, `js/cxc.js:69-75, 231` | Consultas por `ticket`/`ventaId`/`cxcId` | Al editar o eliminar | Acotadas |
| `js/admin-roles.js:31,53,70`, `js/admin-usuarios.js:127,132` | `roles` y `users` completas | Al abrir Admin | Pocas filas |
| `js/admin-importar.js:1474-1475` | `pagos` y `cuentas_por_pagar` completas | Al importar | **Duplica** 1,022 documentos ya en memoria |
| `config/telegram`, `config/sistema`, `config/emisor` | 1 documento | Al exportar, reportar o abrir configuración | Despreciable |

---

## 2. Módulo por módulo: qué lee de `window.EVE`

Fuente: conteo de referencias `window.EVE.<campo>` por archivo. "Indispensable" = sin esa colección el módulo no puede calcular su pantalla principal. "Prescindible" = se usa solo para una vista lateral, un dato de apoyo o un reporte.

| Módulo (archivo) | Lee | Indispensable | Prescindible / diferible |
|---|---|---|---|
| **Báscula** (`destaraje.js`) | `registrosDestaraje`, `precios` | `registrosDestaraje` (consecutivo, duplicados, lista) | `precios` (solo precio sugerido) |
| **Control Producción** (`control-produccion.js`) | `registrosControlProduccion`, `registrosDestaraje`, `ventas`, `inventarioInicial`; indirectas por `utils.js`: `composiciones`, `precios`, `comisiones` | `registrosControlProduccion`, `registrosDestaraje` (saldos y tickets de origen), `ventas` y `inventarioInicial` (saldos por etapa), `composiciones` (Selección) | Trazabilidad (ver abajo) |
| **Inventario** (`inventario.js`) | `inventario`, `inventarioInicial`, `registrosControlProduccion`, `registrosDestaraje`, `ventas` | Las cinco (el saldo se reconstruye con todas) | — |
| **Historial por Material** (subpestaña de Inventario, `inventario.js:1711`) | Las mismas que Inventario | Las mismas | — |
| **Trazabilidad** (subvista de Control Producción, `trazabilidad.js`) | `registrosDestaraje`, `registrosControlProduccion`, `registrosVentas`, `ventas`, `cuentasPorPagar` | `registrosDestaraje`, `registrosControlProduccion` | `cuentasPorPagar` (pago/estado del ticket), `registrosVentas`/`ventas` |
| **Rendimientos** (`rendimientos.js`) | `composiciones` (27 refs), `registrosDestaraje` (panel de pendientes) | `composiciones` | `registrosDestaraje` solo para "Composiciones pendientes" |
| **CxP** (`cxp.js`) | `cuentasPorPagar` (38 refs), `proveedores`, `registrosDestaraje`, `registrosPagos`, `auditorias` | `cuentasPorPagar`, `proveedores`, `registrosPagos` (abonos y PEPS) | `registrosDestaraje`, `auditorias` |
| **Pagos** (`pagos.js`) | `registrosPagos` (10), `cuentasPorPagar`, `registrosMinistraciones`, `proveedores`, `registrosDestaraje` | `registrosPagos`, `cuentasPorPagar` | `registrosMinistraciones` (hoy ocultas por `MINISTRACIONES_ACTIVAS = false` y aun así se descargan) |
| **Ventas** (`ventas.js`) | `ventas` (16), `registrosVentas`, `registrosDestaraje`, `registrosControlProduccion`, `inventarioInicial` | `ventas` | Las otras cuatro son para existencias disponibles |
| **CxC** (`cxc.js`) | `cuentasPorCobrar` (21), `cobros` | Ambas | — |
| **Cobros** (`cobros.js`) | `cobros`, `cuentasPorCobrar` | Ambas | — |
| **Gastos** (`gastos.js`) | `gastos` | `gastos` | — |
| **Precios** (`precios.js`) | `precios` (15), `ajustesPrecioProveedor` (8) | Ambas | — |
| **Dashboard** (`dashboard.js`) | `registrosDestaraje`, `cuentasPorPagar`, `registrosPagos`, `cobros`, `gastos`, `precios`, `composiciones` | Depende de la vista: KG/$ por mes usa CxP; Real vs Teórico usa `registrosDestaraje` + `composiciones` | Todo es diferible hasta abrir la vista |
| **Reportes** (`reportes.js`, `reportes-ui.js`) | `cuentasPorPagar`, `cuentasPorCobrar`, `registrosPagos`, `registrosDestaraje`, `registrosControlProduccion`, `registrosVentas`, `ventas`, `composiciones`, `proveedores` | Cada reporte necesita solo 1–3 colecciones | Todo es diferible hasta elegir el reporte |
| **Flujo** (`flujo.js`) | `flujoMovimientos` (10), `gastos`, `cobros`, `registrosPagos` | `flujoMovimientos` | Las otras tres alimentan el semanal |
| **Admin** (`admin-*.js`) | `admin-backup`/`admin-datos`: casi todas, para exportar; `admin-auditoria`: `registrosDestaraje`, `cuentasPorPagar`, `registrosPagos`; `admin-config`: `comisiones`; `admin-importar`: varias y además 2 lecturas propias | — | Todo es diferible; exportar/respaldar podría leer al momento |
| Cotizaciones, Órdenes de Compra, Recibos de dinero | `cotizaciones`+`clientesCotizacion`; `ordenesCompra`; `recibosDinero`+`clientesCotizacion` | Su propia colección | — |

Colecciones que ningún módulo de captura usa a diario pero se bajan siempre: `auditorias`, `auditoriaFotos`, `comisiones`, `ajustesPrecioProveedor`, `registrosMinistraciones` (con el interruptor apagado).

---

## 3. Módulos que reconstruyen datos a partir de TODO `window.EVE.cuentasPorPagar`

`cuentasPorPagar` es la segunda colección más grande (521) y la que más módulos recorren completa:

| Módulo | Para qué la recorre | Evidencia |
|---|---|---|
| **CxP** | Cortes semanales, PEPS, saldos por proveedor, comprometido por cuenta, vistas y PDF | 38 referencias en `cxp.js` |
| **Pagos** | Saldo pendiente por proveedor, resolver las cuentas de un recibo, detectar abonos vinculados | `pagos.js:82, 450, 769, 1009` |
| **Dashboard** | Agregados KG/$ por mes y material, exposición, posición de IVA | `dashboard.js:119, 340` |
| **Reportes** | Entradas de material (CxP), listas únicas de proveedor y material | `reportes-ui.js:56, 60, 358, 380` |
| **Trazabilidad** | Estado de pago por ticket | `trazabilidad.js:426` |
| **Admin → Auditoría** | Cruce de tickets contra CxP | `admin-auditoria.js:54` |
| **Admin → Datos/Respaldo/Importar** | Exportar o comparar | `admin-datos.js`, `admin-importar.js:1474-1475` |

Efecto: no se puede quitar `cuentasPorPagar` de la carga inicial sin tocar a estos siete; en cambio sí se podría cargar bajo demanda para Dashboard, Reportes, Trazabilidad y Admin.

`registrosDestaraje` (523) y `registrosPagos` (501) tienen el mismo patrón: los recorren completos CxP, Pagos, Dashboard, Reportes, Trazabilidad, Inventario, Control Producción y Admin.

---

## 4. Dependencias entre módulos (lo que complica recortar)

- **Control Producción** necesita `destaraje`, `ventas` e `inventarioInicial` (saldos por etapa y ticket de origen) además de su colección. Un rol con solo `control_produccion` recibe esas tres colecciones vacías.
- **Selección** necesita `composiciones`, que se habilitan con `ventas` o `rendimientos`, **no** con `control_produccion`. Un rol con solo Control Producción trabaja sin composiciones y sin que haya aviso de error.
- **Inventario** y **Ventas** comparten el cálculo de existencias: ambos necesitan `destaraje`, `control_produccion`, `inventario_inicial` y `ventas`.
- **Pagos** y **CxP** se necesitan mutuamente (`registrosPagos` ↔ `cuentasPorPagar`).
- **Dashboard** y **Reportes** no tienen colecciones propias: viven de lo que haya cargado cualquier otro módulo.

---

## 5. Colecciones que un rol limitado no puede leer

La app no marca error: la colección queda en `[]` y cada módulo trabaja con lo que haya. Combinaciones que producen datos silenciosamente incompletos:

| Rol con solo… | Colecciones que quedan vacías | Consecuencia |
|---|---|---|
| `dashboard` o `reportes` | **Todas** (ninguno de los dos aparece en `CARGAS_MODULO`) | Pantallas en blanco o en cero, sin aviso |
| `control_produccion` | `destaraje`, `ventas`, `inventario_inicial`, `composiciones` | Sin tickets de origen ni saldos; Selección sin composiciones |
| `ventas` | `destaraje`, `control_produccion`, `inventario_inicial` | Existencias disponibles incompletas |
| `inventario` | `destaraje`, `control_produccion`, `ventas` | Saldos de Inventario e Historial por Material incorrectos |
| `cxp` sin `pagos` | `pagos`, `ministraciones`, `destaraje` | Abonos y PEPS incompletos |
| `pagos` sin `cxp` | `cuentas_por_pagar`, `proveedores`, `auditorias`, `comisiones`, `auditoria_fotos` | No se pueden resolver cuentas ni saldos |
| `rendimientos` | Solo recibe `composiciones`; falta `destaraje` | Panel "Composiciones pendientes" vacío |

Si se recorta la carga por módulo, hay que respetar estas dependencias o se reproducen estos mismos huecos para todos los roles.

---

## 6. Estimación del consumo

- 1,824 documentos + 2 por carga ≈ **1,826 lecturas por carga completa**.
- 28–30 mil lecturas diarias ≈ **15 a 16 cargas completas al día**; el pico de 47 mil ≈ **26 cargas**.
- Las consultas de la sección 1.5 suman poco frente a esto, salvo `recibos_pago` (sin límite) y los importadores de `admin-importar` (1,022 documentos por uso).
- El consumo crece con el tamaño de las colecciones: `destaraje`, `cuentas_por_pagar` y `pagos` ya suman 1,545 de los 1,824 (85 %) y solo crecen.

No se midió cuántas de esas cargas son F5, pestañas nuevas, recargas por actualización del service worker o varios usuarios/dispositivos; es el dato que falta para priorizar.

---

## 7. Qué tolera una ventana de fechas y qué no

Criterio: un módulo **no tolera** una ventana si calcula saldos o estados acumulando desde el primer registro, o si necesita ver cualquier registro antiguo para validar uno nuevo. **Tolera** una ventana si lo que muestra o valida se decide solo con registros abiertos o recientes, o si el usuario ya elige el periodo.

### 7.1 No toleran cargar solo una ventana

| Módulo | Por qué | Evidencia |
|---|---|---|
| **Inventario** (saldo por etapa) | El ledger suma **todos** los eventos desde el inicio: `construirEventos` mezcla `inventarioInicial`, `registrosDestaraje`, `registrosControlProduccion`, ventas y ajustes, los ordena y los acumula. Quitar los antiguos cambia el saldo de hoy. | `inventario.js:178`, y usos en `:324, :351, :418, :575, :635` |
| **Historial por Material** | Es el mismo ledger, mostrado con el saldo de etapa tras cada movimiento. | `inventario.js:571`, subpestaña `:1711` |
| **Control Producción** | Valida saldo disponible por etapa en una fecha, resuelve el ticket de origen y reparte entradas contra el historial. Avisa o bloquea según el saldo calculado. | `control-produccion.js:535`, `control-produccion-reglas.js:250` (`resolverTicketOrigen`) |
| **Ventas** (existencias) | Para ofrecer cantidades disponibles reutiliza el mismo saldo por etapa. | `ventas.js` usa `registrosDestaraje`, `registrosControlProduccion`, `inventarioInicial` |
| **Trazabilidad** | Sigue un ticket o lote a través de recepción, procesos, venta y pago, sin importar su antigüedad. | `trazabilidad.js:426` |
| **Rendimientos → Composiciones pendientes** | Revisa todos los tickets de Báscula contra la cobertura de cada versión de composición; con ventana, los pendientes viejos dejarían de aparecer. | `rendimientos.js:182` |
| **Báscula** (alta y edición) | El consecutivo y la detección de duplicados se resuelven contra la lista completa en memoria. Solo toleraría ventana si esas validaciones pasan a consultas por ticket. | `destaraje.js` |
| **Admin → Auditoría, Datos, Respaldo** | Cruzan o exportan todo el historial desde la fecha de corte (`fechaCorteAuditoria`, hoy 2026-07-01). | `admin-auditoria.js:54`, `admin-backup.js:17` |
| **Precios y Composiciones** | No por tamaño sino por vigencias: se resuelve el precio o la composición **a la fecha del registro**, que puede ser antigua. Son pequeñas (31 y menos de 12 documentos): no conviene recortarlas. | `utils.js`, `rendimientos.js` |

### 7.2 Sí toleran una ventana (con condiciones)

| Módulo | Qué sí hace falta cargar | Condición para no romper nada |
|---|---|---|
| **CxP** | Todas las cuentas con `saldo > 0` más las liquidadas de las últimas N semanas. | La ventana debe cubrir el corte semanal vigente (`calcularCorteSemanalCxP`). El PEPS solo mira cuentas abiertas, que siempre entran. Reportes y estados de cuenta históricos deben consultar por rango bajo demanda. Las acciones que revisan el documento fresco (`verificarSinPagosFrescos`, `docFresco`) ya van al servidor. |
| **Pagos** | Pagos recientes, más los de cuentas abiertas. | `revertirPagosSiExiste` (`cxp.js:490`) busca por `grupoPagoId` en `registrosPagos`: debe poder consultar el grupo si no está en memoria. |
| **CxC y Cobros** | Cuentas abiertas más cobros recientes. | Son 60 y 57 documentos: el ahorro es pequeño, no es prioridad. |
| **Gastos y Flujo** | El periodo que se ve (el flujo es semanal). | Si hubiera saldos acumulados, necesitarían un saldo inicial. |
| **Dashboard** | Los meses de la vista. | Las vistas por mes y año deberían pedir su rango al abrirse. |
| **Reportes** | Solo el periodo que el usuario elige. | Hoy filtran en memoria (`reportes-ui.js`); pueden pasar a consultar por rango. |

### 7.3 Lo que cambiaría el cálculo

- **Ledger con saldo inicial.** El ledger sí podría usar ventana si parte de un **saldo inicial a una fecha de corte** (el tipo de evento `inicial` ya existe). Hoy no hay una colección de cortes cerrados; habría que crearla y validarla contra el ledger completo antes de confiar en ella.
- **Consulta por ticket.** Las validaciones de Báscula y de CxP por ticket ya existen como consultas (`where('ticket', '==', …)`), así que pueden sustituir al recorrido en memoria.

---

## 8. Plan de carga reducida (propuesta, nada implementado)

### 8.1 Dos palancas

**(a) Por rol: solo las colecciones de los módulos con permiso.** Esto **ya existe** (`puedeLeer(modulo)` en `cargarDatosEnParalelo`). Lo que falta es corregir los huecos de la sección 5: dar a cada módulo las colecciones que realmente necesita (Control Producción necesita `destaraje`, `ventas`, `inventario_inicial` y `composiciones`; Dashboard y Reportes no cargan nada). Sin esa corrección, recortar más reproduce datos incompletos.

**(b) Carga diferida por módulo, la primera vez que se abre.** Un registro de dependencias `módulo → colecciones` (derivable de la sección 2) y una función `asegurarColecciones([...])` que baja lo que falte, comparte la descarga entre módulos y marca cada colección como cargada. `renderModulo` (`auth.js:217`) debe esperar esa carga antes de llamar a `render`, con indicador de "Cargando…".

Orden sugerido:

1. Contador de lecturas en `window.cargarDatos` para confirmar el origen de las cargas (sin esto, todo lo demás es estimación).
2. Dejar de bajar al inicio `ministraciones` (interruptor apagado) y las de CxP que solo usan Auditoría y Reportes (`auditorias`, `auditoria_fotos`, `comisiones`).
3. Carga diferida (b), empezando por Dashboard, Reportes, Admin, Trazabilidad y los módulos de finanzas.
4. Ventana para CxP y Pagos (sección 7.2) y consulta por ticket en Báscula.
5. Caché IndexedDB con lectura incremental, solo si todas las colecciones guardan una marca de modificación fiable (no verificado) y se resuelven los borrados.

### 8.2 Estimación de lecturas por carga

Base: los conteos medidos. Los documentos "< 12" de las colecciones pequeñas se cuentan como hasta 12 cada uno; `config/sistema` y `users/{uid}` suman 2. Las reglas de Firestore hacen un `get()` del documento del usuario por consulta evaluada y, según la documentación de facturación, esa lectura también se cobra (aprox. 1 por colección pedida; no se verificó en la consola).

| Escenario | Colecciones | Hoy | Con (a) y (b) |
|---|---|---|---|
| **Operador de Báscula y Control Producción** (`destaraje`, `control_produccion`, `precios` en lectura) | `destaraje` 523, `control_produccion` < 12, `precios` 31; y las que Control Producción necesita y hoy no recibe: `ventas` 51, `inventario_inicial` < 12, `composiciones` < 12 | **≈ 570–600**, con datos incompletos en Control Producción | **≈ 650–690** al corregir las dependencias; **no baja**, porque `destaraje` completo no admite ventana (7.1) |
| **Admin** (los 23 módulos, escritura) | Todas | **≈ 1,830** (1,826 más ~23 de reglas) | **≈ 1,830** si abre todo en la sesión; ≈ 600–1,000 si abre 2 o 3 módulos |
| **Rol financiero** (`cxp`, `pagos`, `cxc`, `gastos`, `flujo`, `dashboard`, `reportes`) | `cuentas_por_pagar` 521, `pagos` 501, `cuentas_por_cobrar` 60, `cobros` 57, `gastos` 50, CxP complementarias (`proveedores`, `auditorias`, `comisiones`, `auditoria_fotos`) < 48, `ministraciones` y `flujo` < 24 | **≈ 1,220–1,290** (Dashboard y Reportes sin `destaraje` ni `composiciones`) | **≈ 700–800** con una ventana que retenga ~30 % de CxP y Pagos (suposición, no medida); **≈ 600** si además se difieren `auditorias`, `fotos`, `comisiones` y `ministraciones` |

Lectura honesta: el recorte grande lo da la **ventana** en CxP y Pagos (1,022 documentos), no la carga diferida. La carga diferida ahorra mucho a roles de uno o dos módulos y casi nada a Admin si abre todo. El operador de planta es el caso que menos ahorra, porque su colección principal (`destaraje`, 523) alimenta el ledger y no admite ventana.

Con el patrón actual de 15–16 cargas diarias, bajar el promedio de 1,826 a ~700 dejaría el consumo cerca de 11 mil lecturas al día (cálculo, no medición).

### 8.3 Riesgos

**Datos desactualizados**
- Hoy todo se descarga al mismo instante y ninguna pantalla se actualiza sola. Con carga diferida cada módulo tendría una foto de **otro momento**: CxP cargada a las 9:00 y Pagos a las 11:30 pueden contradecirse (un abono hecho por otra persona aparece en uno y no en otro). Mitigación: guardar la hora de carga por colección y refrescar módulos abiertos hace más de N minutos.
- Los módulos que escriben en memoria tras guardar (`push`, `refrescarEnMemoria`) asumen que la lista ya estaba completa; si la colección aún no está cargada, el `push` crearía una lista parcial que luego se pisaría o duplicaría al cargarse.

**Concurrencia**
- Dos personas capturando en Báscula: el consecutivo de ticket y la detección de duplicados salen de la lista en memoria. Con ventana o carga tardía pueden aceptar un ticket repetido. Las operaciones que ya usan transacciones (folios en `contadores`, cobros, composiciones) no cambian; las de Báscula no tienen transacción hoy.
- Dos personas pagando la misma CxP: ya hay lectura fresca del documento antes de abonar (`pagos.js:456`, `cxp.js:605`); con ventana esa protección sigue valiendo para la cuenta en cuestión, no para totales.
- Una carga diferida lenta mientras otra persona guarda puede devolver una colección a medias entre dos escrituras.
- Cola offline: `sincronizarCola` reenvía escrituras que pueden referirse a registros que, con ventana, ya no están en memoria.

### 8.4 Puntos del código que hoy asumen que todo `window.EVE` está cargado

| Dónde | Suposición |
|---|---|
| `js/auth.js:217-242` (`renderModulo`, `renderTabs`) | `render` es síncrono: no espera datos. Habría que hacerlo asíncrono. |
| `js/auth.js:171-206` | Asigna las 25 listas de una vez, unifica proveedores sobre todas (`unificarProveedoresCargados`) y calcula `ordenesCompraProveedores`, `comisionPorKg` y el catálogo dentro de la misma función. |
| `js/auth.js:254-284` (`limpiarEstadoLocal`) y `window.EVE` inicial | Las listas arrancan en `[]`: una lista vacía no distingue "no cargada" de "sin registros". Falta un estado de carga por colección. |
| `js/offline.js:84-121` (`guardarCacheDatos`) | Guarda `\|\| []` de cada lista tras cada carga y **sobrescribiría con vacíos** una caché buena si se guarda con colecciones aún sin cargar. |
| `js/offline.js` (envoltorio de `cargarDatosEnParalelo`) | Se engancha a esa función por nombre en `load`; si se parte en varias, hay que envolver la nueva. |
| `js/admin-backup.js:17` (`construirBackupCompleto`), `js/admin-datos.js` | Exportan todo `window.EVE`: con colecciones sin cargar, el respaldo saldría incompleto sin aviso. |
| `js/admin-auditoria.js:54`, `js/trazabilidad.js:426`, `js/dashboard.js:119, 340`, `js/reportes-ui.js:56, 60, 358, 380` | Leen `window.EVE.cuentasPorPagar` y otras como si siempre estuvieran. |
| `js/utils.js` (`obtenerComposicionVigente`, `obtenerComisionVigente`, precio vigente) | Se usan desde varios módulos sin saber si `composiciones`, `comisiones` o `precios` ya se cargaron. |
| `js/control-produccion.js`, `js/ventas.js`, `js/inventario.js` | Calculan saldos con `registrosDestaraje`, `registrosControlProduccion`, `ventas` e `inventarioInicial` a la vez. |
| `js/cxp.js:452, 490, 850` | Buscan en `registrosPagos` y `registrosDestaraje` completos. |
| `scripts/verificar-*.js` | Las pruebas arman `window.EVE` completo; habría que añadir casos con colecciones sin cargar. |

---

## 9. Reglas rechazadas en 7 días (4)

**Lo que no se pudo hacer:** no tengo acceso a la consola de Firebase, así que no vi cuáles son las 4 reglas rechazadas ni sus rutas. Lo que sigue es qué intentos de lectura o escritura **no permitidos para un rol limitado** existen en el código, comparado con `firestore.rules`.

### 9.1 La carga inicial no es la causa probable

`cargarDatosEnParalelo` filtra con `puedeLeer(modulo)` antes de pedir cada colección, y los módulos coinciden uno a uno con `firestore.rules` (revisadas las 23: `composiciones` = `ventas` o `rendimientos`; `ministraciones` = `pagos`; las 4 de CxP = `cxp`; etc.). Una regla rota en el login produciría rechazos en cada inicio de sesión, no 4 en una semana. Las excepciones serían una colección nueva sin su regla desplegada (el comentario de `auth.js:138` lo prevé) o un `permisosResueltos` desactualizado.

### 9.2 Intentos fuera de la carga inicial que sí pueden ser rechazados

| # | Dónde | Qué intenta | Rol que lo dispara | Qué hace la regla | Efecto para el usuario |
|---|---|---|---|---|---|
| 1 | `js/destaraje.js:336-343`, llamado desde `confirmarEliminar` (`:362`) | Lee `cuentas_por_pagar` por ticket **sin comprobar `puedeLeer('cxp')`** | Báscula **sin** permiso de CxP | `cuentas_por_pagar` exige `puedeLeer('cxp')` → **rechaza** | El `catch` (`:367`) muestra el error de permisos y **no deja eliminar** el registro |
| 2 | `js/ventas.js:672` → `EVE_CXC.generarCxCDesdeVenta` | Escribe en `cuentas_por_cobrar` tras guardar la venta, sin comprobar permiso de CxC | Ventas **sin** `cxc` en escritura | `cuentas_por_cobrar` exige `puedeEscribir('cxc')` → **rechaza** | La venta ya quedó guardada y falla la creación de su CxC |
| 3 | `js/ventas.js:892` → `EVE_CXC.eliminarVentaConCxC` (`cxc.js:60-80`) | Lee `cuentas_por_cobrar` y `cobros` por `ventaId` | Ventas **sin** `cxc` | Exige `puedeLeer('cxc')` → **rechaza** | No se puede eliminar la venta |
| 4 | `js/recibos-pago.js:8` | Lee `recibos_pago` entera | Rol con **solo `cxc`**: la pestaña se muestra con `['cxp','pagos','cxc']` (`auth.js:45`) | La regla exige `cxp` o `pagos` → **rechaza** | La pestaña falla al abrir |

Son cuatro puntos distintos y coinciden en número con las 4 reglas, pero **eso no prueba que sean esos**: puede ser un solo punto repetido o rutas que no encontré. Tampoco verifiqué que existan roles configurados así; depende de los roles reales en `roles/`.

### 9.3 Comprobaciones que sí están bien

- Las correcciones de kg y proveedor desde Báscula (`cxp.js:775-790`, `:930-940`) comprueban `puedeLeer('cxp')` antes de consultar.
- Pagos y CxP consultan `recibos_pendientes` con permisos que la regla acepta.
- `historial_cambios` se escribe desde cualquier usuario autenticado (permitido) y solo se lee en Admin.
- En el cliente `puedeLeer` no considera el comodín de Admin con escritura (las reglas sí): no genera rechazos, pero un Admin con permisos parciales ve colecciones vacías.

### 9.4 Cómo confirmarlo

1. La gráfica de "Reglas rechazadas" de la consola no da la ruta. Para identificarla, revisar el registro de auditoría en Cloud Logging filtrando por `permission-denied` y `firestore.googleapis.com` (si está habilitado), o reproducir con usuarios de prueba: uno de Báscula sin CxP (eliminar un registro), uno de Ventas sin CxC (crear y eliminar una venta) y uno con solo CxC (abrir Recibos de Pago).
2. Corrección sugerida (no hecha): comprobar el permiso antes de cada una de esas lecturas y degradar a un aviso claro.

---

## 10. Limitaciones

- No se ejecutó la app ni se midieron lecturas reales; el tamaño de `control_produccion`, `inventario*` y `auditoria_fotos` se infiere de "el resto menos de 12".
- Los conteos de referencias por archivo indican uso, no frecuencia; "indispensable" y "tolera ventana" son juicios sobre el código leído, no pruebas.
- Las estimaciones de la sección 8.2 son aritmética sobre los conteos medidos y suposiciones declaradas; ninguna se midió.
- Las 4 reglas rechazadas de la consola no se vieron: la sección 9 es un análisis de código contra `firestore.rules`.
- No se tocaron `firestore.rules` ni el código.
