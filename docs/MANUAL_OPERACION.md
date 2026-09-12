# Manual de Operación — EVE Control

Este manual documenta el funcionamiento real de EVE Control, módulo por módulo, basado
en el código fuente (`js/*.js`). Se construye de forma incremental y aprobada por bloques.

**Última actualización:** Bloque 1 (Destaraje, Precios, CxP) — 2026-09-12.

---

## Índice

1. [Destaraje](#1-destaraje)
2. [Precios](#2-precios)
3. [CxP (Cuentas por Pagar)](#3-cxp-cuentas-por-pagar)

*(Pendiente: Pagos, Control Producción, Rendimientos/Subproductos, Inventario, Ventas,
Trazabilidad, Dashboard, Reportes, Auditoría OCR, Comisiones, Admin, PWA/Offline, y el
Mapa de Interacciones final.)*

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
  `editarMaterialCxP` primero relEen el documento fresco desde Firestore
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

*Fin del bloque 1. Pendiente de aprobación antes de continuar con Pagos, Control
Producción y Rendimientos/Subproductos.*
