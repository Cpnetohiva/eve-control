# Manual de Operación — EVE Control

Este manual documenta el funcionamiento real de EVE Control, módulo por módulo, basado
en el código fuente (`js/*.js`). Se construye de forma incremental y aprobada por bloques.

**Última actualización:** Bloque 4 (Dashboard, Reportes) — 2026-09-12.
Pendiente de aprobación.

---

## Índice

1. [Destaraje](#1-destaraje)
2. [Precios](#2-precios)
3. [CxP (Cuentas por Pagar)](#3-cxp-cuentas-por-pagar)
4. [Pagos](#4-pagos)
5. [Control Producción](#5-control-producción)
6. [Rendimientos / Subproductos](#6-rendimientos--subproductos)
7. [Inventario](#7-inventario)
8. [Ventas](#8-ventas)
9. [Trazabilidad](#9-trazabilidad-dentro-de-control-producción)
10. [Dashboard](#10-dashboard)
11. [Reportes](#11-reportes)

*(Pendiente: Auditoría OCR, Comisiones, Admin, PWA/Offline, y el Mapa de Interacciones
final.)*

---

## 1. Destaraje

### 1.1 Propósito y alcance

Destaraje es el punto de entrada de material comprado a proveedores: registra cada
ticket físico de báscula (proveedor, material, kilos, fecha de entrada y fecha de
salida del camión). Es el primer eslabón de la cadena de datos del sistema — de aquí
se derivan las Cuentas por Pagar (CxP), y a través de ellas los Pagos.

**Qué NO cubre:**
- No calcula precios ni montos a pagar — eso ocurre en CxP, que toma cada registro de
  Destaraje y le aplica el precio vigente del material (módulo Precios).
- No gestiona ventas de material procesado. Sin embargo, por diseño técnico, la
  colección Firestore `destaraje` también almacena registros de venta legacy marcados
  con `ticket = 'V'` (ver Nota Técnica 1.8.1) — estos se enrutan al módulo Ventas y no
  aparecen en la vista de Destaraje.
- No audita ni compara contra evidencia fotográfica — eso es el módulo Auditoría OCR.

### 1.2 Quién lo usa

El acceso se controla por el permiso de rol `destaraje` (`js/permisos.js`,
`window.puedeLeer('destaraje')` / `window.puedeEscribir('destaraje')`), asignado desde
Admin → Roles y Permisos con tres niveles posibles: `ninguno`, `lectura`, `escritura`.

- **Sin acceso (`ninguno`):** la pestaña "Destaraje" ni siquiera aparece en la barra de
  navegación (`tabsVisiblesPorPermiso` en `js/auth.js`).
- **Lectura:** ve las pestañas Hoy / Esta Semana / Todos, las estadísticas (Total
  Registros, Total KG, Total PZ si aplica), la barra de filtros y los botones de
  exportación (TXT/PDF/CSV). No ve el formulario de captura ni los botones
  Editar/Eliminar en la tabla.
- **Escritura:** además de lo anterior, ve el formulario de captura (incluyendo el
  botón de dictado por voz 🎤) y puede Editar o Eliminar cualquier registro.

### 1.3 Flujo de uso paso a paso

1. El usuario con escritura abre la pestaña "Destaraje". Por defecto se muestra la
   sub-pestaña **Hoy** (registros cuya `fechaSalida` es la fecha actual en zona horaria
   de México).
2. Llena el formulario: Ticket, Proveedor (con autocompletado vía `datalist`, lista de
   proveedores ya usados + `PROVEEDORES_COMUNES`), Material (catálogo cerrado, ver 1.4),
   Kg, Fecha Entrada, Fecha Salida. Alternativamente puede usar el botón 🎤 para dictar
   los 5 campos por voz (`parseDestaraje` en `js/voz.js` separa el texto reconocido en
   segmentos y llena el formulario automáticamente para revisión antes de guardar).
3. Al enviar, el sistema valida campos obligatorios y que Kg sea un número mayor a 0
   (`construirRegistroDesdeFormulario`), normaliza proveedor y material (mayúsculas +
   alias conocidos), guarda en Firestore (colección `destaraje`) y lo agrega a la tabla
   en memoria sin recargar la página.
4. Para revisar el histórico completo, cambia a la sub-pestaña **Todos**, donde aparece
   una barra de filtros (Ticket, Desde, Hasta, Proveedor, Material) — todos son campos
   de texto/fecha libres, sin catálogo cerrado en el filtro.
5. Para corregir un registro ya guardado, usa "Editar": abre un modal con los mismos
   campos más un campo opcional de "Motivo del cambio". El ticket en edición debe ser
   estrictamente numérico (`/^\d+$/`) — el modal de edición rechaza cualquier otro
   formato. Cada edición y eliminación queda registrada en el módulo Historial
   (`window.EVE_HISTORIAL.registrar`) con el valor anterior, el valor nuevo y el motivo.
6. Para exportar, usa los botones TXT / PDF / CSV de la barra de exportación — cada uno
   respeta la sub-pestaña activa y los filtros aplicados (ver 1.7).

### 1.4 Reglas de negocio y validaciones clave

- **Catálogo de materiales cerrado:** el formulario usa un `<select>` con
  `window.MATERIALES_COMUNES` (19 valores fijos, p. ej. BIDON, CRISTAL CON ETIQUETA,
  LECHERO, etc.) — no se puede capturar un material fuera de esa lista desde la UI.
- **Proveedor no es un catálogo cerrado:** es texto libre con sugerencias
  (`PROVEEDORES_COMUNES` + historial de proveedores ya usados). Se normaliza a
  mayúsculas y se resuelven alias conocidos (`window.PROVEEDORES_ALIAS`, p. ej.
  "ARTURO" → "ARTURO LARA").
- **Materiales por pieza (PZ):** `window.MATERIALES_PZ` (`TAMBO`, `CAJA CO30`,
  `CAJA CH25`, `CAJA AGRO20`) reutilizan el mismo campo `kg` para representar número de
  piezas — `calcularStatsDestaraje` los excluye del total en kilos y los suma aparte
  como "Total PZ".
- **Kg > 0 obligatorio:** rechaza guardar si Kg no es un número finito mayor a 0.
- **Ticket 'V' reservado:** si el ticket capturado es exactamente `'V'`, el registro se
  guarda en Firestore pero se omite silenciosamente de la tabla en memoria de Destaraje
  (pertenece a Ventas — ver Nota Técnica 1.8.1).
- **Edición restringida a tickets numéricos:** el modal de edición exige que el ticket
  cumpla `/^\d+$/`, a diferencia del formulario de alta que no impone ese formato.

### 1.5 Datos que produce/consume

- **Colección Firestore:** `destaraje` (constante `window.COLECCIONES.DESTARAJE`).
- **Campos del documento:** `ticket`, `proveedor`, `material`, `kg`, `fechaEntrada`,
  `fechaSalida`, `fechaRegistro` (agregado al insertar en memoria).
- **Carga inicial:** `js/auth.js` (`cargarDatosEnParalelo`) trae toda la colección
  `destaraje` y la separa con `clasificarDestaraje` en `window.EVE.registrosDestaraje`
  (tickets numéricos) y `window.EVE.registrosVentas` (ticket `'V'`).
- **Historial de auditoría de cambios:** cada edición/eliminación se registra también en
  la colección que usa `window.EVE_HISTORIAL.registrar` (módulo Historial).

### 1.6 Interacción con otros módulos

- **→ CxP:** cada registro de Destaraje es candidato a generar una Cuenta por Pagar.
  CxP lo detecta mediante `listarPendientesSinAuditar` (compara contra
  `window.EVE.cuentasPorPagar` para no duplicar y contra los resultados de auditorías ya
  procesadas). Si CxP aún no tiene datos, todos los registros de Destaraje sin foto
  auditada aparecen como pendientes en la alerta de CxP.
- **→ Auditoría OCR:** el módulo de auditoría compara fotos de tickets contra estos
  registros de Destaraje para marcarlos como `COINCIDE`, `CON_DIFERENCIAS`,
  `NO_VERIFICADO` o `SIN_REGISTRO`.
- **→ Ventas:** los registros con ticket `'V'` terminan en `window.EVE.registrosVentas`,
  fuera de la vista de Destaraje.
- **Depende de:** nada — es el punto de entrada de datos de compra de material.

### 1.7 Reportes/exportaciones relacionados

Desde la barra de exportación de Destaraje (`crearBotonesExportar`), respetando la
sub-pestaña activa (Hoy/Semana/Todos) y los filtros de la vista "Todos":
- **TXT** (`exportarReporteDestarajeTXT`)
- **PDF** (`exportarReporteDestarajePDF`)
- **CSV** (`exportarReporteDestarajeCSV`) — usa `construirFilasCSV` con
  `{ destaraje: datos.destaraje, ventas: [], pagos: [] }`, es decir, el CSV generado
  desde Destaraje **excluye** ventas y pagos aunque la función subyacente soporte
  ambos (se usa también desde el reporte general).

No hay integración con Telegram para Destaraje individual (esa función existe para CxP
y Pagos, ver sus secciones).

### 1.8 Errores comunes y qué hacer

| Mensaje | Causa | Solución |
|---|---|---|
| "Todos los campos son obligatorios" | Falta ticket, proveedor, material, fecha de entrada o fecha de salida | Completa el campo faltante antes de guardar |
| "Kg debe ser un número mayor a 0" | El campo Kg está vacío, es 0, negativo o no numérico | Corrige el valor de Kg |
| "Ticket debe ser numérico" | Se intentó editar un registro y el campo Ticket del modal no cumple `/^\d+$/` | Usa solo dígitos en el ticket al editar |
| "Tu navegador no soporta reconocimiento de voz" | El botón 🎤 se usó en un navegador sin Web Speech API | Usa el formulario manual o cambia de navegador (Chrome/Edge recomendados) |

#### Nota técnica 1.8.1 — Doble uso del ticket `'V'`

El formulario de captura de Destaraje no impide escribir `'V'` como ticket. Si ocurre,
el registro se guarda en Firestore normalmente, pero `insertarRegistroEnMemoria` lo
descarta silenciosamente de la tabla (sin aviso al usuario) porque ese valor está
reservado para registros legacy de Ventas. El registro sí es visible tras recargar la
página, porque en la carga inicial `clasificarDestaraje` lo enruta a
`window.EVE.registrosVentas`. Esto puede confundir a un usuario que capture por error
`'V'` como ticket: verá el mensaje "Registro guardado" pero el registro desaparecerá de
la tabla de Destaraje sin explicación visible en pantalla.

---

## 2. Precios

### 2.1 Propósito y alcance

Precios mantiene la lista de precios por Kg de cada material, con vigencia histórica
(fecha inicio/fin), y permite definir ajustes de precio específicos por combinación
Material + Proveedor. Es la fuente de verdad que CxP consulta para calcular el monto a
pagar de cada ticket de Destaraje.

**Qué NO cubre:**
- No genera Cuentas por Pagar ni aplica los precios a tickets — solo los define. La
  aplicación ocurre en CxP al momento de generar cada cuenta (`obtenerPrecioVigente`,
  usado desde `cxp.js`).
- No gestiona la comisión por Kg (existe una comisión global separada,
  `window.EVE.comisionPorKg`, configurada en Admin, que se suma al precio del material
  para obtener el "Precio Efectivo"). **Nota:** la comisión está discontinuada desde el
  31/08/2026 (`comisionPorKg = 0` de ahí en adelante); el histórico de $0.10/kg solo
  aplica a tickets con fecha anterior a esa fecha — ver capítulo Comisiones.
- No permite eliminar ni editar un precio o ajuste "in place" — cada cambio de precio
  es un nuevo registro con su propia vigencia (ver 2.4).

### 2.2 Quién lo usa

Controlado por el permiso de rol `precios`. Sin acceso, la pestaña no aparece.

- **Lectura:** ve las tres vistas (Precios Vigentes, Historial Completo, Ajustes por
  Proveedor), puede imprimir la lista de precios y exportar CSV. No ve los botones
  "+ Nuevo Precio", "+ Nuevo Ajuste por Proveedor", "Actualizar precio", "Eliminar" ni
  "Desactivar".
- **Escritura:** además de lo anterior, puede crear precios nuevos, crear ajustes por
  proveedor, actualizar un precio existente (equivalente a crear uno nuevo desde esa
  fecha), eliminar un precio del historial y desactivar un ajuste por proveedor.

Adicionalmente existe el permiso extra `ventas_precios` (`js/permisos.js`,
`tienePermisoExtra('ventas_precios')`), que **no** se evalúa dentro del módulo Precios
en sí, sino en el módulo Ventas (`js/ventas.js`): permite a un usuario sin acceso al
módulo Precios consultar precios vigentes desde la pantalla de Ventas.

### 2.3 Flujo de uso paso a paso

1. El usuario abre la pestaña "Precios"; por defecto ve **Precios Vigentes**: una tabla
   con Material, Precio, Comisión (global), Precio Efectivo (precio + comisión),
   vigente desde y notas.
2. Para dar de alta un precio nuevo, hace clic en "+ Nuevo Precio": selecciona Material
   (catálogo cerrado), captura Precio por Kg, Fecha de vigencia y notas opcionales. Si
   la fecha elegida cae dentro del rango de un precio ya existente (vigente o
   histórico) para ese material, el sistema muestra una advertencia in-line indicando
   que ese precio anterior quedará cerrado un día antes de la nueva fecha.
3. Al guardar, si corresponde, se cierra automáticamente el precio anterior
   (`fechaFin = nuevaFecha - 1 día`) y se crea el nuevo registro heredando el
   `fechaFin` original del precio cerrado (para no perder el límite si ya tenía uno).
4. Para actualizar un precio ya vigente, usa el botón "Actualizar precio" en la fila
   correspondiente — abre el mismo modal con el material prellenado.
5. Para revisar el histórico completo de un material, cambia a **Historial Completo**,
   selecciona el material en el selector y ve todas sus vigencias pasadas con su
   duración en días. Desde ahí puede "Eliminar" un precio del historial (con
   confirmación explícita de que no afecta CxP ya generadas).
6. Para definir un ajuste específico por proveedor (p. ej. un descuento o sobreprecio
   para un proveedor puntual), cambia a **Ajustes por Proveedor**, hace clic en
   "+ Nuevo Ajuste por Proveedor" y captura Material, Proveedor, Tipo de Ajuste (Monto
   Fijo o Porcentaje), Valor y Fecha de vigencia. El mismo mecanismo de cierre
   automático por fecha aplica aquí, mancomunado por Material+Proveedor.
7. Para dejar de aplicar un ajuste vigente, usa "Desactivar" (confirmación explícita de
   que no afecta CxP ya generadas, porque el ajuste queda copiado en cada CxP al
   generarse).
8. Para imprimir o exportar, usa "Imprimir lista de precios" (abre una ventana nueva
   con formato de impresión) o "Exportar CSV" (histórico completo, precios + ajustes).

### 2.4 Reglas de negocio y validaciones clave

- **Catálogo de materiales cerrado**, igual que en Destaraje (`MATERIALES_COMUNES`).
- **Un precio por fecha exacta:** no se puede crear un precio para un material que
  inicie exactamente en una fecha ya usada por otro precio del mismo material — hay que
  eliminar el existente primero. Mismo criterio para ajustes por proveedor
  (Material+Proveedor+fecha exacta).
- **Encadenamiento automático de vigencias:** al insertar un precio con fecha dentro de
  un rango existente, ese precio existente se cierra un día antes
  (`window.restarUnDia`) y el nuevo hereda el `fechaFin` original. Si la fecha no cae
  dentro de ningún rango existente, el sistema busca el siguiente precio futuro del
  mismo material y usa el día anterior a esa fecha como `fechaFin` del nuevo registro.
- **Precio > 0 obligatorio.** Valor de ajuste debe ser distinto de 0.
- **Los cambios no son retroactivos sobre CxP ya generadas:** cada Cuenta por Pagar
  copia el precio y el ajuste aplicado en el momento de su creación
  (`precioBase`, `ajusteProveedorAplicado`), así que eliminar o desactivar un
  precio/ajuste posterior no altera cuentas ya generadas.

### 2.5 Datos que produce/consume

- **Colecciones Firestore:** `precios` (`window.COLECCIONES.PRECIOS`) y
  `ajustes_precio_proveedor` (`window.COLECCIONES.AJUSTES_PRECIO_PROVEEDOR`).
- **Campos de `precios`:** `material`, `precio`, `fechaInicio`, `fechaFin` (o `null` si
  vigente), `notas`, `creadoPor`, `fechaRegistro`.
- **Campos de `ajustes_precio_proveedor`:** `material`, `proveedor`, `tipoAjuste`
  (`'monto'` o `'porcentaje'`), `valorAjuste`, `fechaInicio`, `fechaFin`.
- **Estado en memoria:** `window.EVE.precios` y `window.EVE.ajustesPrecioProveedor`,
  cargados en `js/auth.js` bajo el permiso del módulo `precios`.
- **Config relacionada:** `window.EVE.comisionPorKg`, cargada desde
  `window.obtenerComisionVigente` (no pertenece a este módulo, se define en Admin, pero
  se usa para calcular el Precio Efectivo mostrado aquí).

### 2.6 Interacción con otros módulos

- **→ CxP:** al generar una Cuenta por Pagar, `window.obtenerPrecioVigente(material,
  fechaEntrada, proveedor)` consulta el precio vigente del material en la fecha del
  ticket y, si existe, el ajuste vigente para ese Material+Proveedor. Si no hay precio
  vigente para el material en esa fecha, CxP **no puede generar la cuenta** y lanza el
  error `Sin precio vigente para "<material>" en la fecha <fecha>`.
- **→ Ventas:** con el permiso extra `ventas_precios`, el módulo Ventas puede consultar
  precios vigentes sin necesidad de acceso de lectura al módulo Precios completo.
- **Depende de:** nada directamente, pero es un requisito previo obligatorio para que
  CxP pueda operar sobre cualquier material.
- **Qué pasa si Precios aún no tiene datos:** cualquier ticket de Destaraje de un
  material sin precio vigente queda bloqueado para generar CxP hasta que se capture un
  precio con `fechaInicio` anterior o igual a la fecha del ticket.

### 2.7 Reportes/exportaciones relacionados

- **Imprimir lista de precios** (`abrirVistaImpresionPrecios`): abre una ventana nueva
  del navegador con una tabla de Material/Precio/Fecha Inicio/Fecha Fin agrupada por
  material y lanza el diálogo de impresión (`ventana.print()`). Si el navegador bloquea
  la ventana emergente, se muestra el error "El navegador bloqueó la ventana de
  impresión. Habilita pop-ups para este sitio."
- **Exportar CSV** (`exportarPreciosCSV`): histórico completo (no solo lo vigente),
  combinando Precios Generales y Ajustes por Proveedor en un solo archivo, con columna
  `Tipo` para distinguirlos. Nombre de archivo:
  `lista_precios_completa_<fecha>.csv`.

### 2.8 Errores comunes y qué hacer

| Mensaje | Causa | Solución |
|---|---|---|
| "El material es obligatorio" | No se seleccionó material al guardar precio o ajuste | Selecciona un material del catálogo |
| "El precio debe ser un número mayor a 0" | Precio vacío, 0 o negativo | Corrige el valor |
| "Ya existe un precio para X que inicia exactamente el [fecha]..." | Ya hay un precio/ajuste con esa fecha de inicio exacta para ese material (o material+proveedor) | Elige otra fecha o elimina el precio existente desde el historial |
| "El valor del ajuste debe ser un número distinto de 0" | Se intentó guardar un ajuste con valor 0 | Usa un valor distinto de cero (negativo para descuento) |
| "El navegador bloqueó la ventana de impresión..." | Pop-ups bloqueados al usar "Imprimir lista de precios" | Habilitar pop-ups para el sitio y reintentar |

---

## 3. CxP (Cuentas por Pagar)

### 3.1 Propósito y alcance

CxP convierte cada registro de Destaraje en una obligación de pago hacia el proveedor:
calcula el monto (kg × precio efectivo), controla abonos parciales, saldo pendiente,
saldo a favor del proveedor, y exige una aprobación (foto auditada, manual, o "anterior
al corte") antes de generar la cuenta. Es el módulo más sensible del sistema en
términos de control interno, porque involucra dinero.

**Qué NO cubre:**
- No registra el pago físico en sí como transacción "cerrada" e inmutable — cada abono
  puede revertirse (con motivo obligatorio), lo cual re-abre el saldo. El registro de
  pago paralelo vive en la colección `pagos` (módulo Pagos), generado automáticamente
  cuando se registra un abono desde CxP.
- No calcula ni aplica precios — los toma tal cual del módulo Precios en el momento de
  generar la cuenta.
- No procesa ni interpreta fotos de tickets — depende de que el módulo Auditoría OCR le
  entregue resultados ya clasificados como `COINCIDE`.

### 3.2 Quién lo usa

Controlado por el permiso de rol `cxp`.

- **Lectura:** ve la vista "Por Proveedor" (tarjetas con Total/Pagado/Saldo por
  proveedor, detalle de cuentas, historial de abonos) y la vista "Todos" (con filtros de
  fecha/proveedor/material/estado). Ve la barra de alerta de tickets pendientes de
  auditar, pero **no** ve los botones de acción: "Aprobar manualmente TODOS",
  "Generar pendientes anteriores al corte", "Aprobar manualmente" por ticket,
  "Registrar Pago", "Revertir" (abono o saldo a favor), "Ajustar precio", "Editar
  material". Ve el botón "Exportar CSV" (no está gateado por permiso de escritura).
- **Escritura:** acceso completo a todas las acciones anteriores.
- El permiso extra `cxp_reportes` (evaluado en el módulo Reportes, no en CxP) habilita
  la opción "CxP" en el selector de módulo de Reportes para generar estados de cuenta,
  consolidados e historial de pagos en TXT/PDF/CSV/Telegram (ver 3.7 y el futuro
  capítulo de Reportes).

### 3.3 Flujo de uso paso a paso

Existen **tres caminos** para que un ticket de Destaraje se convierta en una Cuenta por
Pagar:

1. **Vía auditoría fotográfica (flujo normal):** el módulo Auditoría OCR procesa fotos
   de tickets y las compara contra Destaraje. Los que resultan `COINCIDE` se pueden
   generar en lote con el botón "💰 Generar CxP de tickets COINCIDEN" desde Auditoría
   (`generarCxPDesdeAuditoria`), que llama internamente a CxP.
2. **Vía "Generar pendientes anteriores al corte":** para tickets con `fechaEntrada`
   anterior a la fecha de corte de auditoría configurada
   (`window.EVE.fechaCorteAuditoria`, por defecto `2026-07-01`), no se exige foto. El
   botón en la barra de alerta de CxP genera todas las cuentas pendientes de ese tipo de
   una sola vez (`generarCxPSinFoto`).
3. **Vía aprobación manual:** para tickets posteriores al corte que no tienen foto
   auditada, un usuario con escritura puede aprobarlos uno por uno desde la lista
   expandible de pendientes (botón "Aprobar manualmente", exige un motivo obligatorio),
   o en bloque con "Aprobar manualmente TODOS" (usa un motivo genérico fijo pensado para
   la carga histórica inicial de 2026, con confirmación explícita antes de ejecutar).

Una vez generada la cuenta:

4. En la vista "Por Proveedor", el usuario ve el total adeudado por proveedor. Si el
   proveedor tiene saldo a favor (de pagos anteriores que excedieron su deuda), se
   aplica automáticamente a la siguiente cuenta que se genere para ese proveedor
   (`aplicarSaldoAFavor`), antes de que el usuario intervenga.
5. Para registrar un pago, usa "Registrar Pago" sobre la tarjeta del proveedor: puede
   indicar un ticket específico (abono dirigido a esa cuenta) o dejarlo vacío para un
   "pago general", que se distribuye automáticamente entre las cuentas con saldo
   pendiente de ese proveedor, de la más antigua a la más reciente
   (`distribuirPago`). Si el monto excede la deuda total, el excedente se guarda como
   saldo a favor del proveedor (con confirmación si el proveedor no tenía cuentas
   pendientes).
6. Cada pago registrado genera también un documento en la colección `pagos` (ver
   módulo Pagos) con el mismo `grupoPagoId`, que permite revertir ambos en conjunto.
7. Si un abono fue un error, se puede "Revertir" desde el detalle de abonos de la
   cuenta (exige motivo). Esto mueve el abono de `abonos` a `abonosRevertidos`,
   recalcula pagado/saldo/estado, y si el abono provenía de un `grupoPagoId` también
   revierte el movimiento de saldo a favor asociado y el registro correspondiente en
   `pagos`.
8. Antes de que una cuenta reciba cualquier abono, se puede "Ajustar precio" (negociar
   un precio distinto al de Lista de Precios, con motivo obligatorio) o "Editar
   material" (si el ticket se catalogó mal, con motivo obligatorio y re-cálculo del
   precio vigente para el nuevo material). Ambas acciones se bloquean en cuanto la
   cuenta tiene al menos un abono aplicado ("Revierte los abonos primero").

### 3.4 Reglas de negocio y validaciones clave

- **No se duplican cuentas por ticket:** `yaExisteCxP` impide generar dos veces una CxP
  para el mismo ticket.
- **Precio vigente obligatorio:** si no hay precio vigente para el material en la fecha
  del ticket, no se puede generar la cuenta (error explícito con el nombre del material
  y la fecha).
- **Precio Efectivo = precio de Lista (o negociado) + comisión por Kg vigente** en la
  fecha del ticket (`window.obtenerComisionVigente`). El ajuste por proveedor, si
  existe, ya está incorporado en el precio antes de sumar la comisión. **Nota:** la
  comisión está discontinuada desde el 31/08/2026 (vale $0 para tickets con fecha igual
  o posterior); solo los tickets anteriores a esa fecha suman el histórico de
  $0.10/kg — ver capítulo Comisiones.
- **Saldo a favor se aplica automáticamente** a la siguiente cuenta generada del mismo
  proveedor, sin intervención manual, en el momento de crear la CxP.
- **Estado calculado:** `pendiente` (sin abonos), `parcial` (con abonos, saldo > 0),
  `liquidado` (saldo ≈ 0, tolerancia de 0.001).
- **Reversión con verificación de concurrencia:** `ajustarPrecioCxP` y
  `editarMaterialCxP` primero relee el documento fresco desde Firestore
  (`verificarSinPagosFrescos`) para detectar si alguien más registró un pago mientras se
  editaba; si el documento ya no existe o ya tiene pago, la operación se cancela con un
  mensaje explícito.
- **Cuentas de saldo inicial histórico** (`aprobacion.tipo === 'saldo_inicial'`) no
  permiten Ajustar precio ni Editar material (no tienen precio/material aplicable en el
  sentido normal).
- **Abonos requieren `abonoId` para poder revertirse:** si un abono antiguo no tiene
  `abonoId` (dato previo al fix de reversión), el sistema rechaza la reversión con un
  mensaje explícito en vez de fallar silenciosamente.

### 3.5 Datos que produce/consume

- **Colección Firestore:** `cuentas_por_pagar` (`window.COLECCIONES.CUENTAS_POR_PAGAR`).
- **Campos clave del documento:** `ticket`, `proveedor`, `material`, `kg`,
  `fechaTicket`, `precioAplicado`, `precioBase`, `comisionPorKg`, `precioEfectivo`,
  `montoMaterial`, `montoComision`, `total`, `pagado`, `saldo`, `estado`,
  `origenAuditoria`, `idAuditoria`, `idFotoAuditoria`, `aprobacion` (`{tipo, motivo,
  aprobadoPor, fecha}`), `abonos[]`, `abonosRevertidos[]`, `precioNegociado`,
  `motivoAjustePrecio`, `ajusteProveedorAplicado`, `materialAnterior`,
  `motivoAjusteMaterial`, `creadoPor`.
- **Estructura de cada abono:** `{ monto, fecha, referencia, registradoPor,
  fechaRegistro, grupoPagoId, abonoId }`. Al revertirse, se le agregan `motivo`,
  `revertidoPor`, `fechaReversion` y se mueve a `abonosRevertidos`.
- **Colección relacionada:** `proveedores` (saldo a favor por proveedor, array
  `saldoAFavor[]` con `{monto, fecha, motivo, grupoPagoId, revertido}`).
- **Escribe también en:** colección `pagos` (un documento por cada abono aplicado desde
  CxP, con `origen: 'cxp_pago_ticket'` o `'cxp_pago_general'`).
- **Estado en memoria:** `window.EVE.cuentasPorPagar`, `window.EVE.proveedores`,
  `window.EVE.auditorias`, `window.EVE.registrosPagos` (compartido con Pagos).

### 3.6 Interacción con otros módulos

- **← Destaraje:** fuente de los registros candidatos a CxP (`registrosDestaraje`).
- **← Precios:** consulta obligatoria de precio vigente + ajuste por proveedor antes de
  poder generar cualquier cuenta.
- **← Auditoría OCR:** entrega los resultados `COINCIDE` que disparan la generación
  automática de CxP con evidencia fotográfica.
- **→ Pagos:** cada abono registrado desde CxP crea un documento espejo en `pagos`.
  Revertir un abono desde CxP también revierte (marca `revertido: true`) el documento
  correspondiente en Pagos.
- **→ Proveedores (saldo a favor):** aplica y registra automáticamente movimientos de
  saldo a favor al generar cuentas o al recibir pagos que exceden la deuda.
- **Qué pasa si Destaraje o Precios aún no tienen datos:** sin registros de Destaraje no
  hay nada que generar; sin precio vigente para un material, ese ticket específico
  queda bloqueado (los demás no se ven afectados).

### 3.7 Reportes/exportaciones relacionados

- **Exportar CSV** (botón directo en CxP, `exportarCxPCSV`): dispara **dos** descargas
  en una sola acción —
  - `cuentas_por_pagar_resumen_<fecha>.csv`: una fila por cuenta, con totales agregados
    (Total, Pagado, Saldo, Cantidad Abonos, Cantidad Abonos Revertidos).
  - `cuentas_por_pagar_abonos_<fecha>.csv`: una fila por abono individual, incluyendo
    los revertidos con su motivo, quién revirtió y cuándo (columna `Estado Abono`:
    `Activo` o `Revertido`).
  - Cubre el histórico completo, no solo lo filtrado en pantalla.
- **Desde el módulo Reportes** (requiere el permiso extra `cxp_reportes`): Estado de
  Cuenta por proveedor, Consolidado por proveedor, e Historial de Pagos, cada uno en
  TXT/PDF/CSV y como mensaje/documento de Telegram
  (`enviarReporteCxPTelegram`). Estos reportes usan `aplanarAbonosCxP`, que solo itera
  el array `abonos` de cada cuenta — **los abonos revertidos quedan excluidos
  automáticamente** porque ya no están en ese array (se movieron a
  `abonosRevertidos` al revertirse).

### 3.8 Errores comunes y qué hacer

| Mensaje | Causa | Solución |
|---|---|---|
| "Sin precio vigente para "X" en la fecha [fecha]" | El material del ticket no tiene un precio cuya `fechaInicio` sea anterior o igual a la fecha del ticket | Captura un precio para ese material en Precios con fecha de vigencia adecuada |
| "No se encontró una cuenta por pagar para ese ticket" | Se registró un pago dirigido a un ticket que no tiene CxP generada para ese proveedor | Verifica el número de ticket o genera primero la CxP correspondiente |
| "El monto debe ser mayor a 0" | Campo monto vacío, 0 o negativo al registrar un pago | Corrige el monto |
| "Este abono no tiene un identificador válido y no puede revertirse (dato anterior al fix de reversión)." | El abono es de datos migrados/antiguos sin `abonoId` | No se puede revertir automáticamente; requiere corrección manual directa en Firestore o vía Admin |
| "No se puede ajustar el precio / editar el material: esta cuenta ya tiene abonos aplicados. Revierte los abonos primero." | Se intentó ajustar precio o material en una cuenta que ya recibió pagos | Revertir todos los abonos de esa cuenta antes de poder editarla |
| "Esta cuenta recibió un pago mientras se editaba, desde otra sesión..." | Otro usuario registró un abono en la misma cuenta mientras el primero tenía el modal de ajuste abierto | Recargar y revisar el estado actual antes de reintentar |
| "Esta cuenta ya no existe — probablemente fue eliminada. Recarga la página." | Se intentó ajustar una cuenta que fue eliminada por otro usuario/proceso | Recargar la página |

---

## 4. Pagos

### 4.1 Propósito y alcance

Registro de pagos a proveedores por material recibido y control del flujo de efectivo
semanal (ministraciones vs. pagos). Cubre dos rutas de captura: pagos vinculados a una
Cuenta por Pagar (CxP) generada previamente, y pagos "sueltos" capturados directamente
en este módulo (con o sin vínculo automático a una CxP existente).

### 4.2 Quién lo usa

Usuarios con el permiso de módulo `pagos`. Con nivel de solo lectura se puede ver el
historial, los filtros, las estadísticas, el Control de Flujo Semanal y exportar
reportes; se requiere nivel de escritura (`puedeEscribir('pagos')`) para ver el
formulario de captura, el panel de pago de CxP en lote, editar/eliminar pagos, y
gestionar ministraciones.

### 4.3 Flujo de uso paso a paso

**Ruta A — Pago de CxP en lote (panel de pago):**
1. Se selecciona un proveedor; el sistema lista sus cuentas por pagar con `saldo > 0`
   (`obtenerTicketsPendientes`).
2. El usuario marca una o varias cuentas y captura un monto total, fecha y referencia.
3. Al confirmar (`manejarConfirmarPagoCxP`), el sistema genera un `grupoPagoId` único
   (`window.EVE_CXP.generarGrupoPagoId()`) y distribuye el monto entre las cuentas
   marcadas (`window.EVE_CXP.distribuirPago`), en orden hasta agotar el monto o las
   cuentas.
4. Cada cuenta afectada se actualiza (`pagado`, `saldo`, `estado`, nuevo abono con el
   `grupoPagoId`), y se crea un documento espejo en `pagos` por cada cuenta
   (`origen: 'panel_cxp'`).
5. Si el monto excede la deuda total marcada, el sobrante se guarda como saldo a favor
   del proveedor (`window.EVE_CXP.guardarSaldoAFavor`).

**Ruta B — Formulario general de pago (independiente):**
1. El usuario llena ticket, proveedor, material, fecha, kg, precio por kg y monto
   pagado. El total se calcula automáticamente (`kg * precioPorKg`).
2. Si el ticket no corresponde a ninguna CxP existente, el sistema exige una nota
   explicativa (`requiereNotaPorTicketSinCxp`).
3. Al guardar (`manejarEnvioFormulario`), si existe una CxP cuyo `ticket` coincide
   (comparación por número de ticket), el sistema intenta enlazar el pago a esa cuenta
   automáticamente (`window.EVE_CXP.actualizarAbonoCxP`) — ver Nota técnica.
4. El registro de pago se guarda siempre, se muestra "Pago guardado" y aparece en las
   pestañas Hoy/Semana/Todos según su fecha.

**Ministraciones y Control de Flujo:**
1. En la pestaña "Esta Semana" se puede capturar una ministración (monto + fecha); el
   sistema calcula su semana ISO automáticamente.
2. El panel de Control de Flujo Semanal muestra el total ministrado, el total pagado
   (excluyendo pagos revertidos) y el saldo disponible de la semana.

**Edición/eliminación:** un pago con vínculo activo a una CxP (`pagoTieneVinculoActivo`
— su `grupoPagoId` aparece en un abono activo o en un saldo a favor no revertido) no
puede editarse en monto/ticket ni eliminarse desde Pagos; el sistema indica que debe
revertirse primero desde CxP.

### 4.4 Reglas de negocio y validaciones clave

- Campos obligatorios en el formulario general: ticket, proveedor, material, fecha, kg
  (> 0), precio por kg (> 0), pagado (≥ 0).
- Se exige nota cuando el ticket capturado no tiene CxP asociada
  (`requiereNotaPorTicketSinCxp`).
- Ministraciones: fecha obligatoria, monto > 0.
- Un pago marcado `revertido: true` se muestra tachado con chip "↩️ Revertido" y queda
  excluido de `calcularStats` y de `calcularControlFlujo`.
- El vínculo a CxP (`pagoTieneVinculoActivo`) bloquea edición de ticket/monto y
  eliminación mientras siga activo (abono no revertido o saldo a favor no revertido con
  ese `grupoPagoId`).

### 4.5 Datos que produce/consume

- **Colección `pagos`**: ticket, proveedor, material, fecha, kg, precioPorKg, total,
  pagado, nota, `revertido`, `grupoPagoId` (cuando viene de CxP u origen enlazado),
  `origen` (`panel_cxp` en pagos generados desde el panel de lote).
- **Colección `ministraciones`**: monto, fecha, semana (ISO).
- Consume: `window.EVE.cuentasPorPagar` (para vincular por ticket y listar pendientes
  por proveedor), catálogo de proveedores y materiales.
- En memoria: `window.EVE.registrosPagos`, `window.EVE.registrosMinistraciones`.

### 4.6 Interacción con otros módulos

- **← CxP:** el panel de pago en lote opera directamente sobre las cuentas por pagar
  (abonos, saldo, estado); cada abono de CxP genera un documento espejo en Pagos.
- **→ CxP:** un pago capturado desde el formulario general puede enlazarse
  automáticamente a una CxP existente por número de ticket.
- **← Destaraje/CxP:** el catálogo de tickets disponibles para pago proviene de las
  cuentas por pagar generadas a partir de Destaraje.

### 4.7 Reportes/exportaciones relacionados

- `window.exportarReportePagosTXT/PDF/CSV` (definidos en `js/reportes.js`), respetan la
  pestaña activa (Hoy/Semana/Todos) y los filtros de la barra (Ticket, Desde, Hasta,
  Proveedor, Material).

### 4.8 Errores comunes y qué hacer

| Mensaje | Causa | Solución |
|---|---|---|
| "El monto debe ser mayor a 0" | Monto vacío, 0 o negativo | Corrige el monto |
| Exige nota antes de guardar | Ticket capturado no coincide con ninguna CxP | Escribe una nota explicando el pago, o verifica el número de ticket |
| No permite editar/eliminar el pago | El pago tiene un vínculo activo con una CxP (`grupoPagoId` en un abono no revertido, o en un saldo a favor no revertido) | Revertir el abono correspondiente desde CxP primero |
| El pago se guarda pero no se refleja en la CxP esperada | El ticket coincide con una CxP de **otro proveedor** (el enlace automático solo compara ticket, no proveedor) — ver Nota técnica | Verificar manualmente en CxP y corregir el abono si fue mal aplicado |

**Nota técnica:**
1. El enlace automático de un pago independiente a una CxP (`manejarEnvioFormulario`)
   compara únicamente el número de **ticket**, sin verificar que el **proveedor**
   coincida. Si dos proveedores distintos usan el mismo número de ticket, el pago podría
   enlazarse a la CxP equivocada.
2. Si la llamada a `window.EVE_CXP.actualizarAbonoCxP` falla durante ese enlace
   automático, el error solo se registra en la consola del navegador
   (`console.error`) — el usuario nunca lo ve, y el mensaje "Pago guardado" se muestra
   igualmente, aun cuando la CxP no quedó actualizada.

---

## 5. Control Producción

### 5.1 Propósito y alcance

Registro de los procesos internos de transformación de material: Selección, Empacado,
Molienda, Lavado, Peletizado, Producción de Cajas y Producción de Tambos. Cada registro
documenta uno o más materiales de entrada (inputs, opcionalmente ligados a un ticket de
origen) y uno o más materiales de salida (outputs, marcando cuáles son merma),
permitiendo encadenar procesos (p. ej. Destaraje → Molienda → Lavado → Peletizado).
Incluye también, dentro de su misma interfaz, la vista de Trazabilidad.

### 5.2 Quién lo usa

Usuarios con permiso de módulo `control_produccion` (clave legacy en datos de usuario:
`controlProduccion`). Con solo lectura se pueden ver las pestañas, filtros,
estadísticas, tabla, exportar CSV y consultar Trazabilidad; se requiere escritura
(`puedeEscribir('control_produccion')`) para capturar o editar registros.

### 5.3 Flujo de uso paso a paso

1. Se genera automáticamente el siguiente número de ticket correlativo (`P-XXX`).
2. Se elige el tipo de proceso (uno de los 7 catálogos fijos); cada tipo sugiere un
   output principal, sin forzarlo.
3. Se capturan uno o más inputs: material, kg y, opcionalmente, un ticket de origen
   (el campo ofrece tanto tickets de Destaraje como tickets previos de Control
   Producción, permitiendo encadenar procesos).
4. Se capturan uno o más outputs: material, kg y si es merma o no. Debe existir al
   menos un output que no sea merma.
5. Se capturan operador, turno, fecha de inicio y fecha de fin (la fecha de fin debe
   ser posterior a la de inicio; con ello se calculan horas trabajadas, eficiencia,
   porcentaje de merma y productividad).
6. Antes de guardar, el sistema verifica si hay stock suficiente de cada material de
   entrada a la fecha de fin del proceso (`verificarStockSuficienteProceso`). Si no
   alcanza, se muestra una advertencia (`confirm()`) que el usuario puede aceptar para
   guardar de todas formas — es solo informativa, no bloquea el guardado.
7. El registro se guarda con su ticket `P-XXX`; queda disponible como posible
   `ticketOrigen` para procesos futuros.
8. Pestaña "Trazabilidad" (dentro de este mismo módulo): permite consultar la cadena
   completa de un ticket, desde su origen en Destaraje hasta los procesos que lo
   consumieron y sus outputs subsecuentes.

### 5.4 Reglas de negocio y validaciones clave

- El tipo de proceso debe ser una de las 7 claves del catálogo `PROCESOS`.
- Al menos un input (material requerido, kg finito y mayor a 0).
- Al menos un output (material requerido, kg finito y mayor a 0, marca de merma
  booleana); al menos un output no-merma.
- Operador, turno, fecha de inicio y fecha de fin son obligatorios; la fecha de fin debe
  ser estrictamente posterior a la de inicio.
- Eficiencia = kg del output principal / total de kg de inputs × 100 (verde ≥ 90%,
  naranja ≥ 80%, rojo < 80%).
- La verificación de stock suficiente es únicamente advertencia (`confirm()`); el
  usuario puede continuar y guardar aunque el stock calculado no alcance.

### 5.5 Datos que produce/consume

- **Colección `registrosControlProduccion`**: ticket (`P-XXX`), tipoProceso, inputs[]
  (`material, kg, ticketOrigen`), outputs[] (`material, kg, esMerma`), operador, turno,
  fechaInicio, fechaFin, horasTrabajo, eficiencia, porcentajeMerma, productividad.
- Consume: `window.EVE.registrosDestaraje` y registros previos de Control Producción
  (para el datalist de `ticketOrigen`), y datos de inventario/ventas para el cálculo de
  stock disponible (`window.EVE_INVENTARIO.calcularSaldoDisponibleEnFecha`).
- En memoria: `window.EVE.registrosControlProduccion`.
- Historial de auditoría vía `window.EVE_HISTORIAL.registrar` al crear/editar/eliminar.

### 5.6 Interacción con otros módulos

- **← Destaraje:** los tickets de Destaraje son la fuente típica de `ticketOrigen` en
  el primer proceso de una cadena.
- **↔ Control Producción (autoencadenado):** el output de un proceso puede volverse
  input de otro (vía `ticketOrigen` apuntando a un ticket `P-XXX` anterior).
- **← Rendimientos/Subproductos:** la composición vigente de un material define, de
  forma orientativa, qué subproductos y procesos "válidos" se esperan de él — pero
  Control Producción no lee ni aplica esas reglas (ver Nota técnica).
- **← Inventario:** se usa para validar (de forma advisoria) si hay stock suficiente
  del material de entrada a la fecha del proceso.
- **→ Trazabilidad:** cada registro es un eslabón consultable en la cadena completa de
  un ticket.
- **→ Reportes de Rendimiento:** los registros de Control Producción, junto con las
  entradas de Destaraje y las composiciones vigentes de Rendimientos, alimentan el
  reporte "esperado vs. real" (ver §6.7).

### 5.7 Reportes/exportaciones relacionados

- Exportación CSV histórica completa (`exportarControlProduccionCSV`): un cruce
  (cross-join) de inputs × outputs por registro — p. ej. 2 inputs × 1 output genera 2
  filas; un registro sin inputs/outputs genera 1 fila con campos vacíos. No existen
  exportaciones TXT/PDF propias de este módulo (ver Nota técnica sobre la columna
  Fecha).
- Desde el módulo Reportes: reporte "Control de Producción" (TXT/PDF/CSV), filtrado por
  periodo; y los reportes de categoría "📊 Rendimientos" (por Material, por Operador —
  contra una meta de eficiencia configurable, `window.EVE.metaEficiencia`, 90% por
  defecto — y por Proceso), exportables en TXT/PDF/CSV y enviables por Telegram.

### 5.8 Errores comunes y qué hacer

| Mensaje | Causa | Solución |
|---|---|---|
| "Debe haber al menos un output que no sea merma" | Todos los outputs capturados están marcados como merma | Agrega o corrige un output que no sea merma |
| "La fecha de fin debe ser posterior a la fecha de inicio" | Fecha de fin igual o anterior a la fecha de inicio | Corrige las fechas |
| Advertencia de stock insuficiente (`confirm()`) | El material de entrada no tiene suficiente saldo disponible calculado a la fecha del proceso | Verificar el stock real antes de continuar, o aceptar y guardar de todas formas si se confirma que es correcto |
| No se puede eliminar un ticket que ya fue usado como origen | (No aplica — ver Nota técnica: el sistema no lo impide) | Verificar manualmente en Trazabilidad antes de eliminar un ticket que pueda estar referenciado |

**Nota técnica:**
1. La eliminación de un registro (`confirmarEliminar`) no verifica si ese ticket está
   siendo usado como `ticketOrigen` en un proceso posterior. A diferencia de Pagos (que
   sí bloquea eliminar/editar si hay un vínculo activo), aquí se puede eliminar un
   eslabón de una cadena de producción sin ninguna advertencia, dejando referencias
   huérfanas.
2. La columna "Fecha" del CSV histórico usa `fechaInicio`, mientras que los filtros en
   pantalla (pestañas Hoy/Semana/Todos) usan `fechaFin`. Un registro puede aparecer en
   una pestaña distinta a la fecha que muestra su propia exportación CSV.
3. Los campos `procesosValidos` y `procesoSugerido`, capturados en el módulo
   Rendimientos por subproducto, son puramente informativos: Control Producción no los
   lee ni los valida al capturar outputs, por lo que es posible registrar un output con
   un proceso no contemplado en la composición vigente sin que el sistema lo señale.

---

## 6. Rendimientos / Subproductos

### 6.1 Propósito y alcance

Define, por material de entrada, la composición esperada de subproductos que debe
generar (porcentajes que deben sumar 100%, marcando cuáles son merma), con control de
versiones a través del tiempo (vigencia y cierre). Incluye un simulador de lote
(ilustrativo, no genera registros) y alimenta el cálculo de rendimiento
esperado-vs-real usado por Reportes.

### 6.2 Quién lo usa

Usuarios con permiso de módulo `rendimientos`. Con solo lectura se pueden consultar
composiciones vigentes, historial, usar el simulador de lote y exportar CSV; se
requiere escritura para crear o editar una composición.

### 6.3 Flujo de uso paso a paso

**Definir/actualizar una composición:**
1. Se elige el material de entrada y una fecha de vigencia (debe ser posterior a la
   fecha de vigencia de la versión anterior del mismo material, si existe).
2. Se agregan filas de componentes: nombre del subproducto, porcentaje, si es merma, y
   (si no es merma) los procesos válidos en los que puede generarse y un proceso
   sugerido entre los marcados.
3. Un chip muestra el total acumulado en vivo (verde si suma 100%, en alerta si no).
4. Si ya existe una versión vigente abierta para ese material, el sistema exige un
   motivo para la actualización y muestra un aviso indicando que la versión anterior se
   cerrará (con fecha de cierre = un día antes de la nueva fecha de vigencia).
5. Al guardar, se crea la nueva versión (`version = anterior + 1`, o `1` si es la
   primera) y, si aplica, se cierra la anterior en la misma operación.

**Consultar:**
- Pestaña "Composiciones": tabla de versiones vigentes por material, con acciones Ver,
  Editar e Historial.
- Pestaña "Historial": todas las versiones de un material, con su duración en días.
- Pestaña "Simulador de Lote": se elige un material (solo aquellos con composición
  vigente **hoy**) y una cantidad; el sistema calcula el kg estimado por subproducto y
  separa el total en aprovechable vs. merma. Es solo una proyección — no crea ningún
  registro.

### 6.4 Reglas de negocio y validaciones clave

- Debe existir al menos un componente; cada uno requiere nombre de subproducto y
  porcentaje finito mayor a 0; la suma de porcentajes (redondeada a 2 decimales) debe
  ser exactamente 100.
- La nueva fecha de vigencia debe ser posterior a la de la versión vigente anterior del
  mismo material.
- Se requiere un motivo al actualizar (cerrar) una versión previamente abierta.
- Si un componente se marca como merma, sus `procesosValidos` se fuerzan a vacío y su
  `procesoSugerido` a nulo (un subproducto de merma no tiene proceso de destino).
- "Vigente" se determina por fecha: `fechaVigencia <= hoy` y (`fechaCierre` nulo o
  `fechaCierre >= hoy`); si hay varias que cumplen, se toma la de `fechaVigencia` más
  reciente.

### 6.5 Datos que produce/consume

- **Colección `composiciones`**: materialEntrada, descripción, componentes[]
  (`subproducto, porcentaje, esMerma, procesosValidos[], procesoSugerido`),
  totalPorcentaje, version, fechaVigencia, fechaCierre, actualizadoPor, motivo.
- En memoria: `window.EVE.composiciones`.
- Consume: el catálogo de procesos definido en Control Producción
  (`window.EVE_CONTROL_PRODUCCION.PROCESOS`), más una opción sintética adicional
  "Venta Directa", para poblar los procesos válidos seleccionables.
- Historial de auditoría vía `window.EVE_HISTORIAL.registrar` al crear/editar (no existe
  función de eliminación en este módulo).

### 6.6 Interacción con otros módulos

- **← Control Producción:** su catálogo de procesos (`PROCESOS`) se usa para poblar las
  opciones de "procesos válidos"/"proceso sugerido" al definir una composición.
- **→ Control Producción / Destaraje (vía Reportes):** la composición vigente de cada
  material, junto con las entradas de Destaraje y los outputs reales de Control
  Producción, alimenta el cálculo de rendimiento esperado-vs-real (ver §6.7). El propio
  módulo de Rendimientos no ejecuta este cálculo; vive en `js/reportes.js`.
- **⚠️ Sin verificación cruzada con Control Producción:** los procesos "válidos"
  definidos aquí son informativos únicamente — no se validan al capturar un output real
  (ver Nota técnica de §5.8, punto 3).

### 6.7 Reportes/exportaciones relacionados

- Exportación CSV histórica completa (`exportarComposicionesCSV`): una fila por
  componente, ordenada por material y versión ascendente; la columna "Fecha Cierre"
  muestra `Vigente` cuando la versión sigue abierta.
- Desde el módulo Reportes, categoría "📊 Rendimientos": tres reportes —
  - **Por Material:** compara el kg esperado por subproducto (según la composición
    vigente aplicada a cada entrada de Destaraje del periodo) contra el kg real
    registrado en Control Producción.
  - **Por Operador:** compara la eficiencia real de cada operador contra una meta
    configurable (`window.EVE.metaEficiencia`, 90% por defecto).
  - **Por Proceso:** agrupa el mismo comparativo esperado-vs-real por tipo de proceso.
  - Los tres son exportables en TXT/PDF/CSV y enviables por Telegram
    (`enviarReporteRendimientoTelegram`).

### 6.8 Errores comunes y qué hacer

| Mensaje | Causa | Solución |
|---|---|---|
| "Debe capturar al menos un componente" | Se intentó guardar una composición sin filas de componentes | Agrega al menos un componente |
| "El porcentaje de todos los componentes debe sumar 100%" | La suma de porcentajes no es exactamente 100 tras redondear a 2 decimales | Ajusta los porcentajes hasta que el chip de total marque verde |
| Pide un motivo antes de guardar | Se está actualizando una versión ya vigente/abierta del mismo material | Escribe el motivo de la actualización |
| Un material no aparece en el Simulador de Lote | El material no tiene una composición vigente **a la fecha de hoy** (aunque tenga historial) | Verifica en "Composiciones" si existe una versión vigente actual para ese material |

**Nota técnica:**
1. Los campos `procesosValidos`/`procesoSugerido` capturados aquí no se aplican en
   ningún punto de validación en Control Producción; sirven únicamente como referencia
   visual/documental (ver también §5.8, punto 3).
2. No existe función de eliminación de composiciones en este módulo — solo creación de
   nuevas versiones (con cierre automático de la anterior). Una composición mal
   capturada solo puede corregirse creando una nueva versión correctiva, no borrando la
   errónea.

---

## 7. Inventario

### 7.1 Propósito y alcance

Muestra un inventario **calculado** (no capturado directamente): a partir de los eventos
de Destaraje (recepciones), Control Producción (consumos y salidas por etapa) y Ventas
(salidas por venta), reconstruye un saldo por material y etapa. Permite reconciliar ese
cálculo con la realidad física mediante ajustes manuales auditados, y cargar un
inventario inicial (stock físico existente al momento del corte). No es un módulo
transaccional de captura directa de existencias.

### 7.2 Quién lo usa

Usuarios con permiso de módulo `inventario`. Con solo lectura se puede ver la matriz,
el resumen, la merma acumulada, el historial de ajustes y exportar CSV; se requiere
escritura (`puedeEscribir('inventario')`) para aplicar ajustes manuales o registrar
inventario inicial.

### 7.3 Flujo de uso paso a paso

1. El sistema reconstruye una línea de tiempo de eventos (inventario inicial,
   recepciones de Destaraje, procesos de Control Producción, ventas), ordenada por
   fecha, y la procesa secuencialmente por material y etapa (`RECEPCIÓN`, `SELECCIÓN`,
   `EMPACADO`, `MOLIENDA`, `LAVADO`, `MEZCLADO`, `PELETIZADO`, `INYECCIÓN`, `SOPLADO`,
   `PRODUCTO TERMINADO`, `VENDIDO`).
2. Se muestra una matriz material × etapa con el saldo real (calculado + ajuste neto
   acumulado) de cada combinación, y un total en planta por material.
3. Un panel de resumen agrega: total en planta, listo para venta, en proceso y
   pendiente de procesar. Otro panel muestra la merma histórica acumulada por material
   (solo informativa, no es inventario disponible).
4. **Ajuste manual:** el usuario elige material + etapa (o da clic directo en una celda
   de la matriz), ve la cantidad calculada y la cantidad real actual, y captura la
   cantidad real física junto con un motivo obligatorio. La diferencia se guarda como
   ajuste acumulado y queda en un historial auditable.
5. **Inventario inicial:** carga única de stock físico existente por material + etapa
   (no permite duplicar la misma combinación); no aplica a la etapa `VENDIDO`.
6. Pestaña "Historial de Ajustes": selector de material + etapa, muestra cronológicamente
   todos los ajustes y la entrada de inventario inicial (si existe) para esa combinación.

### 7.4 Reglas de negocio y validaciones clave

- Al consumir un material (por proceso o venta), el sistema descuenta primero de la
  etapa más avanzada que tenga saldo (`ORDEN_CONSUMO`: de Producto Terminado hacia atrás
  hasta Recepción); si ninguna etapa tiene saldo suficiente, descuenta de `RECEPCIÓN`,
  lo que puede dejarla en negativo.
- Solo los outputs de Control Producción marcados como no-merma alimentan la etapa
  destino correspondiente al tipo de proceso (`ETAPA_POR_PROCESO`).
- El ajuste manual exige motivo obligatorio y una cantidad real numérica; no se puede
  deshacer, solo corregir con un nuevo ajuste.
- El inventario inicial exige material, etapa válida (no `VENDIDO`), kg > 0 y fecha; y
  bloquea duplicar la misma combinación material + etapa.
- Todos los cálculos se redondean a 2 decimales.

### 7.5 Datos que produce/consume

- **Colección `inventario`**: material, etapa, unidad, `ajusteNeto` (acumulado),
  `ajustes[]` (historial: fecha, cantidadAntes, cantidadDespues, diferencia, motivo,
  ajustadoPor).
- **Colección `inventario_inicial`**: material, etapa, kg, fecha, nota, creadoPor.
- Consume: `window.EVE.registrosDestaraje`, `window.EVE.registrosControlProduccion`, y
  `window.EVE.ventas` (la colección **nueva** de Ventas con folio — ver Nota técnica).
- En memoria: `window.EVE.inventario`, `window.EVE.inventarioInicial`.
- Historial de auditoría vía `window.EVE_HISTORIAL.registrar` (acción `ajuste`).

### 7.6 Interacción con otros módulos

- **← Destaraje:** cada recepción incrementa la etapa `RECEPCIÓN` del material.
- **← Control Producción:** cada proceso consume kg de los materiales de entrada (de la
  etapa con saldo disponible) y agrega los outputs no-merma a la etapa destino;
  también consume esta lógica (`calcularSaldoDisponibleEnFecha`) para su verificación
  advisoria de stock (§5.3, punto 6).
- **← Ventas:** cada línea de venta descuenta del material vendido y lo mueve a la
  etapa `VENDIDO`; Ventas también usa esta misma función para su propia verificación
  advisoria de stock (§8.3).
- **Depende de:** Destaraje, Control Producción y Ventas como únicas fuentes de eventos;
  no tiene entrada propia de "recepción" salvo el Inventario Inicial.

### 7.7 Reportes/exportaciones relacionados

- Exportación CSV del snapshot actual (`exportarInventarioCSV`): una fila por
  combinación material + etapa con saldo distinto de cero, incluyendo cantidad
  calculada, ajuste neto, cantidad real y estado. No hay exportación TXT/PDF, ni
  exportación específica del historial de ajustes (solo se puede consultar en pantalla).

### 7.8 Errores comunes y qué hacer

| Mensaje | Causa | Solución |
|---|---|---|
| "Selecciona un material" / "Selecciona una etapa válida" | Campos vacíos o inválidos en el modal de ajuste o de inventario inicial | Completa ambos campos |
| "La cantidad real debe ser un número" | Campo de cantidad real vacío o no numérico | Corrige el valor |
| "El motivo del ajuste es obligatorio" | Se intentó guardar un ajuste sin motivo | Escribe el motivo |
| "Ya existe un Inventario Inicial para este Material + Etapa" | Se intentó cargar dos veces el inventario inicial de la misma combinación | Usa "Ajustar" en vez de "Agregar Inventario Inicial" para corregir esa combinación |
| Una celda aparece en rojo como "⚠️ Error de captura" | La cantidad real quedó negativa (se consumió más de lo que el sistema calculó como disponible) | Revisar si falta una recepción de Destaraje, un ajuste inicial, o si hubo un consumo mal capturado |

**Nota técnica:**
1. `construirEventos` solo lee `window.EVE.ventas` (la colección nueva de Ventas, con
   folio). Los registros legado de Destaraje con ticket `'V'`
   (`window.EVE.registrosVentas`, ver Nota Técnica 1.8.1) que **no** han sido migrados
   a la nueva colección (§8.3, botón de migración) no descuentan nada del inventario
   calculado — el material vendido por esa vía legado seguirá apareciendo como
   disponible hasta que se migre.
2. Una cantidad real negativa solo se marca visualmente en rojo; el sistema no impide
   guardarla ni bloquea nuevos consumos sobre ella.

---

## 8. Ventas

### 8.1 Propósito y alcance

Registro de ventas a clientes con folio correlativo (`V-<año>-XXX`), soporta múltiples
productos por venta (líneas independientes de material, cantidad y precio). Incluye
una herramienta de migración de los registros legado de Destaraje con ticket `'V'`
(ver Nota Técnica 1.8.1) hacia esta colección.

### 8.2 Quién lo usa

Usuarios con permiso de módulo `ventas`. Con solo lectura se pueden ver pestañas,
filtros, estadísticas, tabla y exportar reportes; se requiere escritura
(`puedeEscribir('ventas')`) para el formulario, migrar registros legado, editar y
eliminar. El permiso extra `ventas_precios` controla si el usuario puede ver/capturar
el precio unitario manualmente (ver Nota técnica).

### 8.3 Flujo de uso paso a paso

1. Al abrir el formulario se previsualiza el siguiente folio correlativo del año en
   curso.
2. Se captura cliente y fecha, y se agregan una o más líneas: material (con
   autocompletado del catálogo fijo `PRODUCTOS_VENTA` más materiales históricos),
   cantidad y precio unitario. La unidad se determina automáticamente (`PZ` para cajas y
   tambo, `KG` para el resto).
   - Si el usuario **no** tiene el permiso extra `ventas_precios`, el campo de precio se
     oculta y se autocompleta con el precio vigente del material a la fecha de la venta
     (`window.obtenerPrecioVigente`) — ver Nota técnica.
3. Antes de guardar, se verifica (de forma advisoria, igual que en Control Producción)
   si hay stock suficiente por material a la fecha de la venta
   (`verificarStockSuficienteVenta`); si no alcanza, se pide confirmación explícita pero
   no se bloquea el guardado.
4. Al guardar, se asigna el folio real y se registra la venta; también admite captura
   por voz (`parseVenta`).
5. Se puede indicar opcionalmente una lista de tickets de origen (separados por coma)
   para conectar la venta con la cadena de Trazabilidad.
6. **Edición:** modal con motivo opcional, reconstruye completamente cliente, fecha y
   líneas.
7. **Eliminación:** solicita motivo opcional; no hay verificación de vínculos previos.
8. **Migración de registros legado:** si existen registros de Destaraje con ticket
   `'V'` sin migrar, aparece un botón que los convierte en documentos de esta colección
   (folio generado automáticamente, precio unitario en 0 pendiente de revisión), y marca
   el registro original como `migrado: true` para no volver a ofrecerlo.

### 8.4 Reglas de negocio y validaciones clave

- Cliente y fecha obligatorios; al menos una línea de producto.
- Por línea: material obligatorio, cantidad numérica > 0, precio unitario numérico ≥ 0.
- La unidad de cada producto está fijada por catálogo (`UNIDAD_POR_PRODUCTO`), no es
  editable por el usuario.
- El folio es correlativo por año (`V-<año>-XXX`), no reutilizable.
- La verificación de stock es únicamente advertencia; el usuario puede continuar y
  guardar aunque el stock calculado no alcance.

### 8.5 Datos que produce/consume

- **Colección `ventas`**: cliente, fecha, folio, `lineas[]` (`material, cantidad,
  unidad, precioUnitario, subtotal`), totalVenta, observaciones, `ticketsOrigen[]`
  (opcional), registradoPor.
- Consume: catálogo fijo `PRODUCTOS_VENTA`, precios vigentes (Precios) cuando el
  usuario no captura precio manualmente, e Inventario para la verificación advisoria de
  stock.
- En memoria: `window.EVE.ventas`. Se distingue de `window.EVE.registrosVentas`
  (registros legado con ticket `'V'`, ver Nota Técnica 1.8.1), que solo se incorpora a
  esta colección tras una migración explícita.
- Historial de auditoría vía `window.EVE_HISTORIAL.registrar` en edición y eliminación
  (no en creación ni en migración).

### 8.6 Interacción con otros módulos

- **← Precios:** si el usuario no tiene `ventas_precios`, el precio de cada línea se
  toma automáticamente del precio vigente del material a la fecha de la venta.
- **← Inventario:** se usa para validar (de forma advisoria) si hay stock suficiente del
  material vendido a la fecha de la venta.
- **← Destaraje:** los registros legado con ticket `'V'` son la fuente de la migración
  hacia esta colección.
- **→ Trazabilidad:** cada venta aparece como nodo terminal ("venta") en la cadena de un
  ticket, ya sea por `ticketsOrigen` (colección nueva) o por `ticketOrigen` (registros
  legado no migrados) — ver §9.

### 8.7 Reportes/exportaciones relacionados

- Exportación propia TXT/PDF/CSV/Telegram (`exportarVentasTXT/PDF/CSV/Telegram`),
  respetando la pestaña activa (Hoy/Semana/Todas) y los filtros (cliente, material,
  fechas, monto). El TXT y el PDF incluyen un desglose de kg/pz totales por material.

### 8.8 Errores comunes y qué hacer

| Mensaje | Causa | Solución |
|---|---|---|
| "El cliente es obligatorio" / "La fecha es obligatoria" | Campos vacíos al guardar | Completa los campos |
| "Debe agregar al menos un producto" | Se intentó guardar sin líneas | Agrega al menos una línea de producto |
| "Cantidad inválida para [material]" / "Precio inválido para [material]" | Cantidad ≤ 0 o precio negativo/no numérico en una línea | Corrige el valor de esa línea |
| Advertencia de stock insuficiente (`confirm()`) | El material no tiene suficiente saldo calculado a la fecha de la venta | Verificar el stock real antes de continuar, o aceptar y guardar de todas formas |
| El precio de una línea no se ve o no se puede editar | El usuario no tiene el permiso extra `ventas_precios` — el precio se autocompleta con el vigente | Solicitar el permiso extra si necesita capturar un precio distinto al vigente |

**Nota técnica:**
1. Cuando el usuario no tiene `ventas_precios`, el precio se fuerza silenciosamente al
   precio vigente calculado; si no existe un precio vigente para ese material en esa
   fecha, el precio queda en 0 sin ningún aviso visible.
2. La eliminación de una venta (`confirmarEliminar`) no verifica si el ticket de origen
   está referenciado en una cadena de Trazabilidad — a diferencia de Pagos, se puede
   eliminar sin advertencia.

---

## 9. Trazabilidad (dentro de Control Producción)

Trazabilidad no es un módulo con permiso propio ni pestaña de nivel superior: vive como
una sub-pestaña dentro de Control Producción (ver §5.1 y §5.3, punto 8), gateada por el
mismo permiso `control_produccion`. Este capítulo **no repite** el flujo de "consultar
la cadena de un ticket" ya documentado en §5.3.8 y §5.6; cubre únicamente lo que esta
vista aporta y que no está descrito ahí.

### 9.1 Qué aporta esta vista, más allá de lo ya documentado

- **Búsqueda por 5 criterios**, no solo por ticket: ticket, proveedor, material, tipo de
  proceso o folio de venta (`buscarTicketsPorCriterio`). Si el criterio elegido produce
  más de un ticket coincidente, se muestra una lista para elegir uno antes de construir
  la cadena.
- El árbol es **bidireccional**: hacia atrás (`construirArbolHaciaAtras`, sigue el
  `ticketOrigen` de cada input hasta llegar a una entrada de Destaraje) y hacia adelante
  (`construirArbolHaciaAdelante`, sigue qué procesos posteriores consumieron el ticket y
  en qué ventas terminó — tanto en la colección nueva `ventas` como en los registros
  legado `registrosVentas` no migrados).
- **Resumen global**, calculado sobre *todos* los tickets alcanzables desde el ticket
  buscado (no solo la cadena directa mostrada): kg de entrada, kg vendido, merma total,
  kg pendiente, eficiencia global, ingreso generado, costo de material (cruzando cada
  ticket de entrada contra su CxP) y margen (ingreso − costo).
- Un **banner destacado de merma histórica acumulada** (`calcularMermaGlobalHistorica`),
  calculado sobre todos los registros de Control Producción del sistema — no depende de
  la búsqueda activa.
- **Exportación propia en PDF** (`exportarTrazabilidadPDF`) del árbol y el resumen de la
  búsqueda activa. No existe exportación TXT ni CSV para esta vista.

### 9.2 Nota técnica

1. El "kg pendiente" del resumen global es una resta simple (entrada − salida − merma)
   sobre los eventos alcanzables desde el ticket buscado; **no** es el mismo cálculo que
   usa Inventario (`calcularSaldoDisponibleEnFecha`, ver §7), por lo que ambos números
   pueden no coincidir para el mismo material.
2. El "costo de material" del resumen toma el campo `total` de la CxP que coincide por
   número de **ticket** — el mismo patrón de coincidencia solo-por-ticket usado en
   Pagos (§4.8), sin verificar proveedor.

---

## 10. Dashboard

### 10.1 Propósito y alcance

Dashboard es un panel de solo lectura que consolida datos ya registrados en otros
módulos (Destaraje, CxP, Pagos) y los presenta agrupados por mes, para dar una vista
panorámica de volumen, monto expuesto y pagos realizados. No captura, edita ni elimina
ningún dato — es puramente un tablero de agregados mensuales.

**Qué NO cubre:**
- No genera ningún archivo exportable — a diferencia de todos los demás módulos
  documentados hasta ahora, Dashboard no tiene TXT, PDF, CSV ni Telegram (ver 10.7).
- No tiene formularios ni botones de edición: nada en esta vista es escribible, por lo
  que no aplica el patrón `puedeEscribir` usado en el resto del sistema.

### 10.2 Quién lo usa

Gateado por el permiso tri-estado `dashboard` (`MODULOS_PERMISOS`). Al ser una vista
100% de lectura, no existe una distinción de "solo lectura vs. lectura+escritura" dentro
del propio módulo — el permiso solo decide si la pestaña es visible.

### 10.3 Flujo de uso paso a paso

Al entrar se muestran 4 sub-pestañas:

1. **KG por Mes y Material** (`calcularVistaKgPorMesMaterial`): matriz mes×material
   construida sobre `registrosDestaraje.fechaSalida`, usando como catálogo base fijo
   `window.MATERIALES_COMUNES` (los 19 materiales siempre aparecen, incluso en cero),
   con totales por fila y columna.
2. **$ por Mes y Material** (`calcularVistaMontoPorMesMaterial`): misma estructura,
   sobre `cuentasPorPagar.fechaTicket`/`.total`, mismo catálogo base. Debajo de la
   matriz se muestra una tabla de alerta (`calcularMaterialesSinPrecioVigente`) que
   cruza las fechas de tickets de Destaraje contra las ventanas de vigencia
   (`fechaInicio`/`fechaFin`) de Precios, para señalar materiales/rangos de fecha con
   tickets que no tienen cobertura de precio — explica por qué esos tickets no han
   generado CxP.
3. **Pagado por Mes y Proveedor** (`calcularVistaPagadoPorMesProveedor`): sobre
   `registrosPagos` filtrados por `!revertido`, agrupado por proveedor — **sin**
   catálogo base, por lo que solo aparecen proveedores con pagos reales.
4. **Exposición Actual**: desglose completo proveedor→material del saldo de CxP
   (`agregarCxPPorProveedorYMaterial`, solo CxP con `saldo > 0`), con subtotales por
   proveedor y un gran total.

### 10.4 Reglas de negocio y validaciones clave

- No hay validaciones de captura — es un módulo de solo agregación.
- `agruparPorMesY`/`construirMatrizMesClave` es el agregador genérico mes×clave detrás
  de 3 de las 4 vistas; el parámetro opcional `catalogoBase` decide si se fuerzan filas
  en cero para claves sin datos (usado en las vistas 1 y 2, no en la 3).
- `calcularMaterialesSinPrecioVigente` es un cruce diagnóstico, no una validación que
  bloquee ninguna acción — solo informa.

### 10.5 Datos que produce/consume

- Consume: `window.EVE.registrosDestaraje`, `.cuentasPorPagar`, `.registrosPagos`,
  `window.MATERIALES_COMUNES`, y las ventanas de vigencia de Precios.
- No produce nada: no escribe en Firestore ni mantiene estado propio en
  `window.EVE`.

### 10.6 Interacción con otros módulos

- **← Destaraje:** vista "KG por Mes y Material".
- **← CxP:** vista "$ por Mes y Material" y "Exposición Actual".
- **← Pagos:** vista "Pagado por Mes y Proveedor".
- **← Precios:** alerta de materiales sin precio vigente.
- Ningún módulo consume datos que salgan de Dashboard — es una vista terminal.

### 10.7 Reportes/exportaciones relacionados

Ninguno. Dashboard no tiene ninguna función de exportación (ni CSV, ni TXT, ni PDF, ni
Telegram) — ver Nota técnica. Para obtener un archivo descargable con información
equivalente, debe usarse el módulo Reportes (§11).

### 10.8 Errores comunes y qué hacer

| Situación | Causa | Qué hacer |
|---|---|---|
| Un material no aparece con monto en "$ por Mes y Material" aunque tenga tickets de Destaraje | El material no tiene precio vigente definido en Precios para esa fecha — no se generó CxP | Revisar la tabla de alerta bajo esa misma pestaña y definir el precio vigente en Precios |
| Un proveedor no aparece en "Pagado por Mes y Proveedor" | No tiene pagos vigentes (o todos fueron revertidos) en el rango mostrado | No es un error — la vista solo lista proveedores con pagos activos |
| El total de "Exposición Actual" no coincide con lo esperado | Solo se incluyen CxP con `saldo > 0`; las liquidadas (`saldo = 0`) se excluyen | Verificar el estado de cada CxP en el módulo CxP |
| Se necesita descargar esta información | Dashboard no genera ningún export | Usar el módulo Reportes (§11) |

**Nota técnica:**
1. A diferencia de las otras tres vistas, "Pagado por Mes y Proveedor" no usa
   `catalogoBase`: un proveedor sin pagos en el rango simplemente no tiene fila, en vez
   de mostrarse en cero como ocurre con los materiales del catálogo en las vistas de
   KG/$.
2. `calcularMaterialesSinPrecioVigente` solo se muestra bajo "$ por Mes y Material" — no
   existe una alerta equivalente en ninguna otra vista del sistema para el mismo
   problema (tickets de Destaraje sin cobertura de precio vigente).

---

## 11. Reportes

### 11.1 Propósito y alcance

Reportes es el módulo dedicado a generar archivos exportables (TXT, PDF, CSV, Telegram)
filtrados por periodo, a partir de datos que ya existen en otros módulos. Es, junto con
Dashboard, un módulo de solo lectura — pero a diferencia de Dashboard, su salida es
siempre un archivo o un envío a Telegram, no una vista en pantalla (aunque también
ofrece una vista previa en texto antes de exportar).

**Qué NO cubre:**
- No es la única fuente de exportaciones del sistema: Destaraje (§1.7), CxP (§3.7),
  Pagos (§4.7), Control Producción (§5.7), Rendimientos (§6.7) y Ventas (§8.7) tienen
  cada uno su propia exportación local, con sus propios filtros de pestaña
  (Hoy/Semana/Todas). Reportes es una capa aparte con su propio sistema de filtros por
  periodo, y en varios casos reutiliza — o reimplementa con variaciones — las mismas
  funciones de generación (ver Nota técnica).

### 11.2 Quién lo usa

Gateado por el permiso tri-estado `reportes` (`MODULOS_PERMISOS`). Dentro de Reportes,
la categoría "CxP" del selector de módulo solo aparece si el usuario tiene además el
permiso extra `cxp_reportes` — el mismo permiso extra que gatea los reportes propios de
CxP en §3.7.

### 11.3 Flujo de uso paso a paso

1. **Selector de módulo** (`crearSelectorModulo`): "Reporte General", "Control de
   Producción", "📊 Rendimientos" y, si aplica, "CxP".
2. **Pestañas de periodo:** Hoy / Esta Semana / Este Mes / Personalizado (con selectores
   de fecha desde/hasta, visibles solo en Personalizado).
3. **Barra de filtros**, que cambia según el módulo activo:
   - *Reporte General:* ticket, proveedor, material, cliente.
   - *Control de Producción:* ticket, operador, turno, tipo de proceso.
   - *CxP:* ticket, proveedor, material, estado (pendiente/parcial/liquidado), y un
     selector de subtipo (Estado de Cuenta / Consolidado / Historial de Pagos).
   - *Rendimientos:* un selector de subtipo (Por Material / Por Operador / Por Proceso /
     Por Ticket) y, según el subtipo, material/operador/proceso. **"Por Ticket" no tiene
     filtros propios**: solo muestra un aviso ("El reporte por ticket usa la vista de
     Trazabilidad") y un botón que lleva directamente a la pestaña de Trazabilidad
     dentro de Control Producción (§9) — Reportes no genera nada por sí mismo en este
     caso.
4. **Botones de acción:** Vista Previa (muestra el texto en pantalla), Limpiar
   (resetea los filtros), y exportar TXT / PDF / CSV / Telegram.

### 11.4 Reglas de negocio y validaciones clave

- `obtenerRangoYEtiqueta(tabId, filtros)` resuelve el rango real por pestaña: Hoy = fecha
  actual; Semana = inicio de semana..hoy; Mes = inicio de mes..hoy; Personalizado =
  `filtros.desde`/`hasta` libres (si ambos quedan vacíos, se interpreta como "todos los
  registros").
- El Reporte General filtra Destaraje por `fechaSalida`, Pagos por `fecha` (excluyendo
  los revertidos), y Ventas por su propio conjunto normalizado (ver Nota técnica).
- La categoría "CxP" y el reporte "Por Ticket" de Rendimientos requieren o dependen del
  permiso extra `cxp_reportes` / de la vista de Trazabilidad respectivamente — ninguno
  de los dos genera su salida directamente dentro de Reportes.
- Los botones de exportar de Rendimientos "Por Material" y "Por Proceso" bloquean con un
  mensaje de error si no se seleccionó material o si no hay procesos en el periodo,
  respectivamente, en vez de generar un archivo vacío.

### 11.5 Datos que produce/consume

- Consume, según el módulo activo: `window.EVE.registrosDestaraje`, `.registrosPagos`,
  `.ventas`, `.registrosVentas` (legado), `.cuentasPorPagar`, `.registrosControlProduccion`,
  `.composiciones`, `.metaEficiencia` — prácticamente toda la memoria operativa del
  sistema, sin generar ninguna colección propia.
- Produce únicamente archivos de descarga (TXT/PDF/CSV) o mensajes enviados a Telegram —
  no escribe nada en Firestore ni en `window.EVE`.

### 11.6 Interacción con otros módulos

- **← Destaraje, CxP, Pagos, Control Producción, Rendimientos/Subproductos, Ventas:**
  fuente de todos los datos que Reportes agrega y exporta.
- **← Precios:** indirectamente, a través de los montos ya calculados en CxP.
- **→ Trazabilidad:** el subtipo "Por Ticket" de Rendimientos no genera nada dentro de
  Reportes; redirige a la vista de Trazabilidad en Control Producción (§9).
- Ningún módulo consume datos que salgan de Reportes.

### 11.7 Reportes/exportaciones relacionados

Este módulo *es* la capa de reportes, organizada en 4 categorías:

- **Reporte General:** `generarTXT`/`generarPDF`/`construirFilasCSV`,
  `enviarReporteTelegram` — construidos sobre `obtenerDatosPeriodo` (Destaraje + ventas
  normalizadas + Pagos).
- **Control de Producción:** `generarTXTControlProduccion`/`generarPDFControlProduccion`/
  `construirFilasCSVControlProduccion` — un resumen por periodo, una fila por registro
  (ver Nota técnica; distinto de la exportación histórica del propio módulo, §5.7).
- **CxP:** `generarTXTEstadoCuenta`/`Consolidado`/`HistorialPagos` (+ PDF/CSV/Telegram) —
  las mismas funciones ya referenciadas en §3.7, aplicadas aquí sobre un conjunto de
  cuentas filtrado por periodo/proveedor/material/estado propio de Reportes.
- **Rendimientos:** `generarTXTRendimientoMaterial`/`Operador`/`PorProceso` (+
  PDF/CSV/Telegram) — las mismas funciones ya referenciadas en §6.7.

### 11.8 Errores comunes y qué hacer

| Mensaje/Situación | Causa | Solución |
|---|---|---|
| "Selecciona un material" | Se intentó exportar Rendimientos "Por Material" sin elegir material | Selecciona un material en el filtro |
| "No hay procesos registrados en el período" | Se intentó exportar Rendimientos "Por Proceso" sin registros en el rango | Ajusta el periodo o el tipo de proceso |
| "El reporte por ticket se exporta/envía desde Trazabilidad" | Se intentó exportar/enviar Rendimientos "Por Ticket" desde Reportes | Usa la vista de Trazabilidad en Control Producción (§9) |
| La categoría "CxP" no aparece en el selector de módulo | El usuario no tiene el permiso extra `cxp_reportes` | Solicitar el permiso extra |
| Un dato de Destaraje o Pagos no aparece en el Reporte General para la fecha esperada | El filtro de periodo usa `fechaSalida` (Destaraje) o `fecha` (Pagos), no otras fechas del registro | Verificar cuál fecha se está usando como referencia |

**Nota técnica:**
1. `agregarPorMaterial` (campo genérico `material`/`kg`, usada por el Reporte General) y
   `agregarPorMaterialVentas` (§8, usa `cantidad`/`unidad` de las líneas de la colección
   `ventas`) son dos funciones distintas con el mismo propósito conceptual: no producen
   el mismo desglose si se comparan lado a lado, porque parten de datos y unidades
   distintas.
2. `obtenerVentasNormalizadas()` (usada solo por el Reporte General de este módulo)
   combina los registros legado de Destaraje con ticket `'V'` no migrados
   (`registrosDestarajeVentaSinMigrar`, o su respaldo
   `registrosVentas.filter(migrado !== true)`) **junto con** la colección nueva `ventas`
   — un universo de "ventas" más amplio que el que usa Inventario (§7, que solo lee la
   colección nueva `ventas`) o el propio módulo Ventas (§8, ídem). El mismo concepto de
   "ventas" tiene tres alcances distintos según el módulo o reporte desde el que se
   consulte.
3. `construirFilasCSV(datos)` es una única función compartida cuyo resultado depende
   por completo de cuáles de los tres arreglos `{destaraje, ventas, pagos}` llene quien
   la invoque: el CSV del Reporte General llena los tres; el CSV de Destaraje-solo
   (§1.7) llena solo `destaraje`; el CSV de Pagos-solo (§4.7) llena solo `pagos`. No es
   un error, pero no debe asumirse que "construirFilasCSV" siempre produce un CSV con
   las mismas columnas pobladas.
4. `construirFilasCSVControlProduccion` (este módulo) genera **una fila por registro**
   de Control Producción, con columnas resumen (incluida `mermaKg`, calculada sumando
   los outputs marcados `esMerma`). Esto es una forma completamente distinta de
   `construirFilasCSVControlProduccionHistorico` (§5.7), que genera un cross-join de una
   fila por cada combinación input×output de cada registro. Ambas exportan
   "Control de Producción" pero con estructuras de fila incompatibles entre sí.
5. En `obtenerDatosPeriodo`, el filtro de ventas normalizadas usa
   `aplicaFiltroExacto(r, 'proveedor', f.cliente)` — es decir, el campo interno se sigue
   llamando `'proveedor'` aunque conceptualmente representa al cliente de la venta
   (mismo patrón ya visto en Ventas, §8).

---

*Fin del bloque 4 (Dashboard, Reportes). Pendiente de tu revisión y aprobación en el
archivo antes de continuar con el commit y con el Bloque 5 (Auditoría OCR, Comisiones).*

**Corrección pendiente de tu confirmación:** al investigar Dashboard/Reportes detecté
que §4.5 (Pagos → Datos que produce/consume, ya commiteado en el bloque 2) decía
`window.EVE.pagos`/`window.EVE.ministraciones`, pero el nombre real de esos arreglos en
el código es `window.EVE.registrosPagos`/`window.EVE.registrosMinistraciones` (así están
en `js/auth.js` y en todo el código que los usa). Ya corregí la línea en el archivo; se
incluirá en el próximo commit junto con este bloque, salvo que prefieras que vaya
aparte.
