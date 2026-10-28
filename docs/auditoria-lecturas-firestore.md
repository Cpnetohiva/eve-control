# Auditoría de lecturas de Firestore — plan de carga reducida

- **Fecha:** 2026-10-28
- **Modo:** solo lectura. No se modificó código ni `CACHE_NAME`.
- **Contexto (cifras del usuario, medidas en consola):** plan Spark, tope de 50 mil lecturas por día. Una carga completa de `window.EVE` descarga **1,824 documentos** (`registrosDestaraje` 523, `cuentasPorPagar` 521, `registrosPagos` 501, `cuentasPorCobrar` 60, `cobros` 57, `ventas` 51, `gastos` 50, `precios` 31, el resto menos de 12). Consumo diario de 28–30 mil lecturas, con un pico de 47 mil.
- **Método:** lectura de `js/auth.js`, `js/utils.js`, `js/offline.js`, `js/permisos.js`, `js/config.js`, `index.html`, `service-worker.js` y búsqueda de `window.EVE.<campo>`, `.get()`, `onSnapshot` y `cargarDatos` en todo `js/`. No se ejecutó la app: las cifras de documentos son las que dio el usuario; el resto es lectura de código.
- **Nota sobre el encargo:** el texto de los puntos 3 a 6 llegó incompleto. Se interpretó así: (3) módulos que reconstruyen datos a partir de **todo** `window.EVE.cuentasPorPagar`; (4) dependencias entre módulos; (5) qué pasa con colecciones que un rol limitado no puede leer; (6) este reporte. Si se quería otra cosa en 4 o 5, hay que reorientar esas secciones.

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

## 7. Plan de carga reducida (propuesta, nada implementado)

Ordenado por ahorro esperado frente a riesgo:

1. **Medir antes de cambiar.** Contador de documentos leídos dentro de `window.cargarDatos` (y en las consultas de 1.5), con el motivo de la carga (inicio, recarga, usuario). Confirma cuántas cargas son evitables.
2. **Carga diferida por pestaña.** Descargar al primer `render` del módulo solo las colecciones que necesita (sección 2), respetando las dependencias de la sección 4. Dashboard, Reportes, Trazabilidad y Admin pasan a pedir bajo demanda. Es el cambio más grande en lecturas y el de mayor riesgo, por la sección 5.
3. **Quitar lo que no se usa:** no descargar `ministraciones` mientras `MINISTRACIONES_ACTIVAS` sea `false`; no bajar `auditorias`, `auditoria_fotos` ni `comisiones` hasta abrir CxP/Auditoría.
4. **Usar la caché IndexedDB que ya se escribe:** pintar desde `cargarCacheDatos` (hoy sin uso) y traer solo lo cambiado desde `ultimaSync` (`where(campoFecha, '>', ultimaSync)`). Requiere confirmar que **todas** las colecciones graban una marca de modificación fiable (hay `fechaRegistro` en pagos, pero no se verificó en el resto) y resolver los borrados, que una consulta incremental no ve.
5. **Acotar por fecha lo que crece:** `destaraje`, `cuentas_por_pagar` y `pagos` con ventana (por ejemplo, cuentas abiertas más las últimas N semanas), y consulta bajo demanda para el histórico. Afecta PEPS, cortes semanales y Trazabilidad: necesita diseño propio.
6. **Evitar el duplicado en `admin-importar.js:1474-1475`** reutilizando `window.EVE` en lugar de bajar `pagos` y `cuentas_por_pagar` otra vez, y poner `limit` a `recibos_pago`.
7. **Evitar recargas innecesarias tras actualizar el service worker:** hoy el aviso lleva a `location.reload()` y a otra carga completa; con la caché del punto 4 sería barata.

Fuera de alcance de esta auditoría: reglas de Firestore (no se tocan), cambios de plan de Firebase y el costo de escrituras.

---

## 8. Limitaciones

- No se ejecutó la app ni se midieron lecturas reales; el tamaño de `control_produccion`, `inventario*` y `auditoria_fotos` no se conoce.
- Los conteos de referencias por archivo indican uso, no frecuencia; "indispensable" es un juicio sobre el código leído, no una prueba.
- No se revisaron las reglas (`firestore.rules`) para confirmar que cada módulo coincide con la lectura que `CARGAS_MODULO` le asigna.
