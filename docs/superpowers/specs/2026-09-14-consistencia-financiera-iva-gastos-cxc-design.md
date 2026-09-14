# Consistencia Financiera — IVA, Gastos, CxC/Cobros

Diseño de tres piezas para dar consistencia financiera al sistema:
captura de IVA por transacción en Ventas/CxP/Pagos, un módulo nuevo de
Gastos operativos, y un espejo completo de CxP (Cuentas por Cobrar +
módulo Cobros). Cierra con el cálculo de Flujo de Efectivo Histórico y
Posición de IVA.

## Contexto de negocio confirmado

- La mayoría de las compras de materia prima (Báscula/CxP) son sin
  factura → sin IVA acreditable.
- Algunas ventas son en efectivo, sin factura → sin IVA trasladado.
- Los gastos operativos fijos normalmente sí traen factura con IVA
  (renta, mantenimiento); nómina no lleva IVA.
- El campo IVA se captura **por transacción individual**, como monto en
  pesos, default 0, nunca inferido automáticamente de un % — porque no
  todas las transacciones del mismo tipo se comportan igual.

## Decisiones de arquitectura confirmadas en brainstorming

1. **CxC — espejo estricto de CxP.** Toda venta genera un CxC 100%
   pendiente al registrarse, sin excepción, incluidas las ventas de
   contado. Se liquidan vía Cobros como paso separado, igual que
   CxP/Pagos. (Se descartó permitir un "cobro inmediato" opcional en el
   formulario de Ventas que auto-liquidara el CxC al crearse.)
2. **Fecha esperada de cobro — manual libre.** Campo de fecha en el
   formulario de Ventas, default = fecha de venta, editable por el
   usuario en cada venta. Se descartó un plazo configurable por sistema
   o por cliente: la variabilidad real de pago entre clientes hace que
   un default fijo no aporte precisión.
3. **CxC granular por línea de venta.** Un doc de `cuentas_por_cobrar`
   por línea de venta (no uno por venta completa), igual que CxP es un
   doc por ticket con un solo material. El IVA de la venta (capturado a
   nivel documento) se prorratea por línea, proporcional a
   `subtotal de la línea / totalVenta`.
4. **IVA de CxP se suma a `total`/`saldo`**, no queda solo informativo:
   si una compra sí trae factura con IVA, eso es efectivo real que se
   le paga al proveedor.
5. **Cobros arranca sin flujo de recibo firmable** (esa complejidad
   queda reservada para Pagos/CxP, donde sí importa evidenciar pagos en
   efectivo a proveedores). Fase 2 si se necesita evidencia firmada de
   un cobro.
6. **Posición de IVA se causa sobre fecha real de movimiento de
   efectivo** (Cobros/Pagos/Gastos), no sobre fecha de emisión de
   Ventas/CxP — consistente con el Art. 1-B de la LIVA (el IVA se causa
   al cobro/pago efectivamente percibido). El IVA de cada abono/pago se
   prorratea proporcional a `monto del abono / total del documento
   padre × iva del documento padre`, capturado en el momento en que se
   registra el movimiento. Esto deja Flujo de Efectivo Histórico y
   Posición de IVA sobre el mismo eje temporal.

## 1. Estructura de campos

### `ventas` (modificado)

Se mantiene todo lo existente (`cliente`, `fecha`, `lineas[]`,
`totalVenta`, `observaciones`, `ticketsOrigen[]?`). Se agregan:

```
iva: number                    // default 0, monto en pesos, a nivel del
                                // documento de venta completo (no por línea)
fechaEsperadaCobro: string      // YYYY-MM-DD, manual, default = fecha, editable
```

Lectura retrocompatible: `Number(venta.iva) || 0` en cualquier consumidor.
Documentos existentes sin el campo se comportan como `iva: 0`. Sin
migración retroactiva de datos.

### `cuentas_por_pagar` (modificado)

CxP no tiene pantalla de "captura de compra" (se genera automáticamente
desde Destaraje/Auditoría), así que no hay dónde teclear IVA al crearse.
Se agrega como campo editable post-creación:

```
iva: number   // default 0
```

Se edita con una función nueva `ajustarIvaCxP(cxpId, iva, ajustadoPor)`,
calcada de `ajustarPrecioCxP` (mismo guard `verificarSinPagosFrescos`,
misma acción "Editar" en la fila de la tabla). Al editarse, el nuevo
valor se suma a `total`/`saldo`:

```
total = montoMaterial + montoComision + iva
saldo = total   // el guard exige pagado === 0, así que no hay que
                // prorratear contra abonos previos
```

### `pagos` (modificado)

Se agrega un campo nuevo, calculado al momento de construir cada
`registroPago` (en `registrarPagoGeneral`, en el flujo de recibo
pendiente, y en cualquier otro call site que arme un doc de `pagos`):

```
iva: number   // IVA acreditable causado por ESTE pago específico:
              // (registroPago.pagado / cxp.total) * cxp.iva
              // 0 si el CxP padre tiene iva: 0
```

Se centraliza en un helper nuevo y genérico:

```
calcularIvaProrrateado(montoMovimiento, totalDocumento, ivaDocumento)
// → totalDocumento > 0 ? (montoMovimiento / totalDocumento) * ivaDocumento : 0
// Reutilizado igual por pagos y por cobros — sin esto, cada call site
// duplicaría la misma división.
```

### `gastos` (nueva colección)

```
montoBase: number
iva: number                 // default 0
categoria: 'Fijo' | 'Variable'
beneficiario: string        // texto libre, opcional ('')
fecha: string                // YYYY-MM-DD, fecha de pago
notas: string                 // opcional ('')
creadoPor: string
fechaRegistro: string          // ISO, automático vía guardarDato()
```

Sin campo `total` persistido ni plantilla de recurrencia — un gasto no
tiene abonos/estados, cada uno se captura individualmente aunque se
repita mes a mes. `montoBase + iva` se calcula al vuelo donde se
necesite.

### `cuentas_por_cobrar` (nueva, espejo de `cuentas_por_pagar`)

Un doc por línea de venta (ver decisión #3):

```
ventaId: string              // referencia al doc en 'ventas'
folioVenta: string            // venta.folio, para mostrar en UI
cliente: string                // análogo a 'proveedor'
material: string
kg: number
fechaVenta: string             // YYYY-MM-DD, ancla FIFO (análogo a fechaTicket)
fechaEsperadaCobro: string      // = venta.fechaEsperadaCobro
montoBase: number               // = línea.subtotal
iva: number                      // prorrateado: (línea.subtotal / totalVenta) * venta.iva
total: number                     // montoBase + iva — este es el que usa el saldo/FIFO
cobrado: number                    // análogo a 'pagado' en CxP
saldo: number                       // total - cobrado
estado: 'pendiente' | 'parcial' | 'liquidado'
abonos: [{ monto, fecha, referencia, registradoPor, fechaRegistro, abonoId, grupoCobroId }]
creadoPor: string
fechaRegistro: string
```

### `cobros` (nueva, espejo de `pagos`)

```
cliente: string
material: string
kg: number
precioPorKg: number            // opcional, informativo
cobrado: number                 // monto de este cobro específico
total: number                    // total del CxC afectado (trazabilidad)
iva: number                       // IVA trasladado causado por ESTE cobro:
                                   // calcularIvaProrrateado(cobrado, cxc.total, cxc.iva)
fecha: string
origen: 'cobro_general' | 'cxc_cobro_especifico'
grupoCobroId: string
registradoPor: string
fechaRegistro: string
```

## 2. Reutilización de CxP/Pagos

### Reutilizable tal cual, sin tocar su código

- `guardarDato` / `actualizarDato` / `cargarDatos` / `eliminarDato`
  (`js/utils.js`) — genéricos por nombre de colección.
- `aplicarAbono(cxp, abono)` y `calcularEstado(pagado, saldo)`
  (`js/cxp.js`) — genéricos, solo usan `pagado`/`saldo`/`estado`/`abonos`.
- `generarGrupoPagoId()` / `generarAbonoId()` — generadores de ID
  genéricos (solo cambia el nombre de la variable en el call site:
  `grupoCobroId`).

### Necesita generalización mínima (no duplicar)

- **`distribuirPago(cuentas, monto, fecha, referencia, registradoPor)`**
  está listo para reutilizarse en ambos sentidos salvo por un detalle:
  ordena internamente por el nombre literal `fechaTicket`. Se agrega un
  5º parámetro opcional `campoFecha = 'fechaTicket'` (default preserva
  los call sites actuales de CxP sin cambios); Cobros lo invoca pasando
  `'fechaVenta'`. Con este único cambio, el FIFO + abonos parciales se
  comparte 100% entre Pagos y Cobros.
- `agregarPorProveedorCxP(cuentas)` y `filtrarCxP(cuentas, filtros)`
  están escritas específicamente para el campo `proveedor`. Se
  generalizan a `agregarPorCampoCuenta(cuentas, campoEntidad)` /
  `filtrarCuentas(cuentas, filtros, campoEntidad)`, reutilizadas desde
  CxP (`'proveedor'`) y CxC (`'cliente'`).
- `verificarSinPagosFrescos(cxp)` — pendiente de revisar en
  implementación si hace un query hardcodeado a `cuentas_por_pagar`; si
  es así, necesita un análogo `verificarSinCobrosFrescos` apuntando a
  `cuentas_por_cobrar`.

### Lógica genuinamente nueva

- Disparo automático de generación de CxC al guardar una venta (hook
  síncrono en `js/ventas.js`, justo después de `guardarDato('ventas',
  venta)`). CxP nunca se genera de forma síncrona al capturar el dato
  origen — siempre es un paso posterior (batch o manual desde
  Auditoría). CxC sí, por decisión de negocio (espejo estricto).
- Prorrateo de IVA por línea al generar CxC.
- `calcularIvaProrrateado(montoMovimiento, totalDocumento, ivaDocumento)`
  — helper nuevo, sin análogo en CxP/Pagos actual (hoy no existe ningún
  concepto de IVA en pagos).
- Deduplicación análoga a `yaExisteCxP` pero con clave compuesta
  (`ventaId` + índice de línea, en vez de `ticket` simple) — necesaria
  si alguna vez se edita una venta ya guardada.

### Reutilizable como plantilla de UI, no como código compartido

La tabla "Por Proveedor" de CxP, el modal de registrar pago, y el flujo
de recibo en dos etapas son buenos moldes para copiar en `js/cxc.js` /
`js/cobros.js`, pero manipulan el DOM con IDs específicos — no se
comparten sin duplicar estructura. Alcance acotado (decisión #5):
Cobros arranca solo con registro directo de cobro (total/parcial); el
flujo de recibo firmable en dos etapas queda fuera de esta fase.

## 3. Impacto en Ventas / Inventario / Trazabilidad

Archivos tocados: `js/ventas.js` (campos nuevos en formulario + disparo
de generación de CxC), `js/cxc.js` y `js/cobros.js` (nuevos), `js/gastos.js`
(nuevo), `js/dashboard.js` (nueva vista, sección 5), `js/auth.js` (carga
de `gastos`/`cuentasPorCobrar`/`cobros` a `window.EVE`), `js/admin-usuarios.js`
y roles (permisos nuevos: `gastos`, `cxc`, `cobros`), `index.html`
(tabs/scripts nuevos).

**Verificado explícitamente — no rompe nada:** `js/inventario.js:77` y
`js/trazabilidad.js:53,63,144` solo leen `venta.lineas[].subtotal` /
`.material` / `.cantidad`, nunca acceden a campos a nivel raíz del
documento de venta fuera de `lineas`, `cliente`, `fecha`. Lo mismo
`js/reportes.js:130`. Agregar `iva`/`fechaEsperadaCobro` como campos
nuevos a nivel raíz no afecta ninguna iteración existente en esos tres
archivos. Cero riesgo de regresión ahí.

## 4. Reglas de Firestore

Mismo rigor que `recibos_pendientes`/`recibos_pago`: create/update/delete
separados, sin `write` genérico.

```
match /gastos/{docId} {
  allow read: if puedeLeer('gastos');
  allow create: if puedeEscribir('gastos');
  allow update: if puedeEscribir('gastos');
  allow delete: if puedeEscribir('gastos');
  // Un gasto no tiene abonos/estado que proteger — borrar es seguro,
  // a diferencia de CxP/CxC.
}

match /cuentas_por_cobrar/{docId} {
  allow read: if puedeLeer('cxc');
  allow create: if puedeEscribir('cxc');
  allow update: if puedeEscribir('cxc') || puedeEscribir('cobros');
  // CxC ajusta iva/material (permiso 'cxc'); Cobros aplica abonos
  // (pagado/saldo/estado/abonos, permiso 'cobros').
  allow delete: if false;
}

match /cobros/{docId} {
  allow read: if puedeLeer('cxc') || puedeLeer('cobros');
  allow create: if puedeEscribir('cobros');
  allow update: if false;
  allow delete: if false;   // comprobante inmutable, igual que recibos_pago
}
```

**Nota de asimetría consciente:** hoy `cuentas_por_pagar`, `pagos` y
`ventas` usan `allow write` genérico (create+update+delete bajo un solo
permiso), no el patrón estricto. Las 3 colecciones nuevas arrancan con
más rigor que sus propios espejos existentes. Endurecer retroactivamente
CxP/Pagos/Ventas queda fuera de este plan.

Antes de cualquier deploy, ampliar `matriz-pruebas-firestore-rules.md`
con las 3 colecciones nuevas y correr una matriz dedicada en el
Firestore Rules Playground con los usuarios reales, igual que se hizo
para `recibos_pendientes`/`recibos_pago`.

## 5. Flujo de Efectivo Histórico y Posición de IVA

Viven como una vista nueva dentro de **Dashboard** (no un módulo
aparte), mismo archivo `js/dashboard.js`, mismo namespace
`window.EVE_DASHBOARD` — Dashboard ya es el lugar que cruza colecciones
por mes calendario sin exportar documentos, que es exactamente lo que
piden estos dos cálculos (ver
`docs/superpowers/specs/2026-09-05-dashboard-exposicion-financiera-design.md`).

Ambos cálculos comparten el mismo eje temporal: la **fecha real del
movimiento de efectivo** (`cobros.fecha`, `pagos.fecha`, `gastos.fecha`),
nunca la fecha de emisión de `ventas`/`cuentas_por_pagar`.

### Flujo de Efectivo Histórico

Reutiliza `agruparPorMesY` con una clave fija en vez de
material/proveedor:

```
agruparPorMesY(EVE.cobros, c => c.fecha, c => 'Cobros', c => Number(c.cobrado) || 0)
agruparPorMesY(EVE.registrosPagos.filter(p => !p.revertido), p => p.fecha, p => 'Pagos', p => Number(p.pagado) || 0)
agruparPorMesY(EVE.gastos, g => g.fecha, g => 'Gastos', g => (Number(g.montoBase) || 0) + (Number(g.iva) || 0))
```

`construirMatrizMesClave` arma directamente la tabla Mes × [Cobros,
Pagos, Gastos] sin funciones nuevas de agregación. "Flujo Neto" es una
columna calculada después sobre la matriz ya construida:
`fila.Cobros - fila.Pagos - fila.Gastos`.

### Posición de IVA (efectivo, Art. 1-B LIVA)

Usa el campo `iva` ya prorrateado y guardado en cada movimiento (sección
1) — sin necesidad de volver a dividir en el cálculo:

```
// IVA trasladado
agruparPorMesY(EVE.cobros, c => c.fecha, c => 'IVA Trasladado', c => Number(c.iva) || 0)

// IVA acreditable — pagos (prorrateado) + gastos (1:1, sin abonos parciales)
agruparPorMesY(
  [...EVE.registrosPagos.filter(p => !p.revertido), ...EVE.gastos],
  r => r.fecha,
  () => 'IVA Acreditable',
  r => Number(r.iva) || 0
)
```

Como `pagos` y `gastos` usan el mismo nombre de campo `iva`, se pueden
concatenar en un solo arreglo y pasar por una sola llamada a
`agruparPorMesY`. "Posición Neta de IVA" es una columna calculada
después: `fila['IVA Trasladado'] - fila['IVA Acreditable']`.

## Fuera de alcance (explícito)

- Exportación TXT/PDF/CSV/Telegram para Gastos/CxC/Cobros.
- Plantilla de recurrencia para Gastos.
- Flujo de recibo firmable en dos etapas para Cobros (fase 2 si se
  necesita evidencia firmada de un cobro).
- Backfill retroactivo de CxC para ventas ya existentes en Firestore —
  la generación de CxC es solo hacia adelante, desde que se implemente.
- Plazo de crédito configurable por sistema o por cliente (descartado a
  favor de fecha manual libre).
- Endurecer retroactivamente las reglas de `cuentas_por_pagar`, `pagos`
  o `ventas` al patrón estricto create/update/delete.
- Recalcular Posición de IVA en base devengada (fecha de emisión) — se
  descartó a favor de base de efectivo.

## Fases sugeridas (alto nivel, sin desglosar tareas — eso es trabajo de writing-plans)

1. Pieza 1: campo `iva` en Ventas + `ajustarIvaCxP` en CxP + campo
   `iva` en Pagos (`calcularIvaProrrateado`).
2. Pieza 2: módulo Gastos completo (colección + CRUD + permiso).
3. Pieza 3: CxC + Cobros (generalización de `distribuirPago` y
   funciones de agregación/filtrado, generación automática desde
   Ventas, módulo Cobros).
4. Reglas de Firestore para las 3 colecciones nuevas + matriz de
   pruebas en Playground + deploy.
5. Dashboard: Flujo de Efectivo Histórico + Posición de IVA.
