# Auditoría de precios: PET con 9.50 y 9.70

Fecha: 2026-11-13. Solo lectura: no se modificó código ni se escribió en Firestore.
Alcance: por qué un mismo material (PET) quedó con precios distintos (9.50 y 9.70) cuando el precio vigente es 9.70 desde el 09/11/2026.

> Esta auditoría sale del código. **No hubo acceso a Firestore**, así que la causa concreta está sin confirmar hasta correr el script de la sección 3.

---

## 1. Resumen ejecutivo

- **El precio no vive en Báscula ni se calcula al mostrar reportes.** Se asigna una sola vez, cuando se crea la CxP del ticket, y se guarda congelado en el documento de la CxP.
- **Un precio nuevo no reprecia nada.** Dar de alta 9.70 con vigencia retroactiva al 09/11 solo escribe en `precios`. Las CxP creadas antes con 9.50 se quedan con 9.50.
- **Hipótesis principal (la más probable, sin confirmar):** CxP creada antes del alta del precio 9.70. Los tickets de PET con fecha de entrada desde el 09/11 se convirtieron en CxP mientras el catálogo aún tenía 9.50 vigente, y el 9.70 se cargó después con fecha retroactiva.
- **Otras tres causas posibles, que los datos distinguen:**

| Causa | Cómo se reconoce en la CxP |
|---|---|
| Ajuste de proveedor | `ajusteProveedorAplicado` con valor y `precioBase` = 9.70, pero `precioAplicado` = 9.50 (ajuste de −0.20) |
| Precio negociado | `precioNegociado` con valor (tiene prioridad sobre el de lista) |
| Caché desactualizado | La CxP se creó **después** del alta del 9.70 y aun así quedó con `precioBase` = 9.50: el cliente tenía `window.EVE.precios` viejo (memoria o caché offline) |

- **Falso positivo posible:** en Pagos y en los reportes el precio mostrado es `precioEfectivo` = `precioAplicado` + comisión por kg. Una diferencia de 0.20 puede ser comisión y no precio. La comisión vigente se guarda en `comisionPorKg`.

---

## 2. Evidencia del código

### 2.1 Dónde se congela el precio en la CxP

- Se crea en `generarYGuardarCxP` (`js/cxp.js:417-440`). Llama a `window.obtenerPrecioVigente(registro.material, registro.fechaEntrada, registro.proveedor)` y lanza error si no hay precio (`js/cxp.js:418-421`).
- `calcularCxP` (`js/cxp.js:7-21`) calcula con ese precio:
  - `precioAplicado = precioInfo.precio` (ya incluye el ajuste del proveedor)
  - `precioEfectivo = precioAplicado + comisionPorKg`
  - `montoMaterial`, `montoComision` y `total` salen de ahí.
- `construirDocCxP` (`js/cxp.js:50-70`) guarda además:
  - `precioBase` (`js/cxp.js:54`): el precio de catálogo sin ajuste
  - `ajusteProveedorAplicado` (`js/cxp.js:55`): `{tipo, valor}` o `null`
  - `precioNegociado: null` y `motivoAjustePrecio: null` (`js/cxp.js:65-66`)
  - `fechaTicket = registro.fechaEntrada` (`js/cxp.js:49`). **El campo de la CxP se llama `fechaTicket`, no `fechaEntrada`.**
- `fechaRegistro` (ISO) lo agrega `guardarDato` al guardar (`js/offline.js:370-371`) y se refleja en memoria en `js/cxp.js:360`.
- El precio negociado se fija manualmente en `ajustarPrecioCxP` (`js/cxp.js:637-648`) y, mientras exista, manda sobre `precioAplicado` (`js/cxp.js:663`, `733`).

### 2.2 Cómo funciona `obtenerPrecioVigente` (`js/utils.js:90-115`)

1. Normaliza el material en ambos lados (`js/utils.js:93-95`).
2. Busca en `window.EVE.precios` **en memoria** el primer registro con `fechaInicio <= fecha` y (`fechaFin === null` o `fechaFin >= fecha`) (`js/utils.js:94-98`).
3. Si hay proveedor y existe un ajuste vigente a esa fecha (`obtenerAjusteProveedorVigente`, `js/precios.js:188-192`), devuelve `{...base, precio: precioFinal, precioBase, ajusteProveedorAplicado}` (`js/utils.js:101-114`). El ajuste es `precioBase + valor` (monto) o `precioBase * (1 + valor/100)` (porcentaje).
4. Las fechas se comparan como texto `YYYY-MM-DD`, sin `Date` ni zona horaria. No hay riesgo dd/mm vs mm/dd ahí. La importación convierte `DD-MM-AAAA` a ISO con `split('-')` y validación previa (`js/admin-importar.js:15-18`, `178-179`).
5. **Dos consecuencias importantes:**
   - Lee la **memoria** (`window.EVE.precios`, cargada en `js/auth.js:199` o desde caché offline en `js/offline.js:186`), no Firestore. Un cliente con el catálogo viejo asigna el precio viejo.
   - Es una función de la fecha: con vigencia retroactiva, la consulta *hacia atrás* ya devuelve 9.70 para el 09/11. El problema es que nadie la vuelve a ejecutar sobre las CxP ya creadas.

### 2.3 Por qué una vigencia retroactiva no reprecia las CxP existentes

- Alta de precio (`manejarEnvioPrecio`, `js/precios.js:259-287`): solo llama a `actualizarDato('precios', ...)` para cerrar el precio contenedor y a `guardarDato('precios', ...)` para el nuevo. **No toca `cuentas_por_pagar`.**
- `construirNuevoPrecio` (`js/precios.js:46-92`) permite fechas pasadas: cierra el contenedor un día antes y hereda su `fechaFin`. Solo avisa en pantalla (`js/precios.js:233-257`) y no menciona las CxP afectadas.
- La importación de precios (`js/admin-importar.js`, hoja Precios Generales) encadena vigencias igual y tampoco reprecia.
- Las CxP solo se reprecian en dos casos (`js/cxp.js:1006-1020`, y `js/cxp.js:683-699` para cambio de material): se edita el ticket y cambia material, proveedor o `fechaEntrada`. Si solo cambia ticket o kg, **se conserva el precio congelado** (`js/cxp.js:1021-1024`).
- Báscula solo avisa, no bloquea ni guarda precio (`js/destaraje.js:158-162`).

### 2.4 Dónde se ve cada precio

- Pagos con origen en CxP usa `cxp.precioEfectivo` (`js/pagos.js:549`). La captura manual toma `precioPorKg` del formulario (`js/pagos.js:140-154`), sin consultar el catálogo.
- Los reportes leen lo guardado (`js/reportes.js:1243`, `1420-1421`) y marcan "(negociado)" si hay `precioNegociado`.

---

## 3. Datos reales

**Sin acceso a Firestore desde esta sesión.** Pega el siguiente fragmento en la consola del navegador con EVE Control abierto y sesión iniciada (usuario con permiso de leer CxP y Precios). Solo lee datos: no escribe, no repricia, no llama a `guardarDato`, `actualizarDato` ni `eliminarDato`.

Qué hace:
- Lee **de Firestore** `cuentas_por_pagar` (filtro por `fechaTicket >= 2026-11-09`) y `precios`, para no depender de la memoria.
- Compara el catálogo fresco contra `window.EVE.precios` y avisa si la memoria está desactualizada (diagnóstico de caché).
- Clasifica cada CxP de PET, imprime `console.table` con totales y descarga un CSV.
- Los ajustes de proveedor se toman de `window.EVE.ajustesPrecioProveedor` (memoria), porque no se verificó el nombre de su colección. El mismo `precioBase` vs vigente también delata ajustes viejos.

```js
(async () => {
  const MATERIAL = 'PET';
  const DESDE = '2026-11-09';
  const norm = (m) => window.normalizarMaterial(m);
  const redondear = (n) => Math.round(n * 100) / 100;

  // 1) Lecturas frescas (solo get)
  const [snapCxp, snapPrecios] = await Promise.all([
    window.db.collection('cuentas_por_pagar').where('fechaTicket', '>=', DESDE).get(),
    window.db.collection('precios').get()
  ]);
  const cxps = snapCxp.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => norm(c.material) === norm(MATERIAL));
  const preciosFrescos = snapPrecios.docs.map((d) => ({ id: d.id, ...d.data() }));

  // 2) Diagnóstico de caché: ¿la memoria del cliente coincide con Firestore?
  const enMemoria = (window.EVE.precios || []).length;
  const idsMemoria = new Set((window.EVE.precios || []).map((p) => p.id));
  const faltanEnMemoria = preciosFrescos.filter((p) => !idsMemoria.has(p.id));
  console.log(`Precios en Firestore: ${preciosFrescos.length} | en memoria: ${enMemoria} | faltan en memoria: ${faltanEnMemoria.length}`);
  if (faltanEnMemoria.length) console.warn('CACHÉ DESACTUALIZADO en este cliente:', faltanEnMemoria);

  // 3) Precio base vigente a una fecha, con el catálogo fresco
  const baseVigente = (material, fecha) => preciosFrescos.find((p) =>
    norm(p.material) === norm(material) && p.fechaInicio <= fecha && (p.fechaFin === null || p.fechaFin >= fecha)) || null;
  const ajusteVigente = (material, proveedor, fecha) => (window.EVE.ajustesPrecioProveedor || []).find((a) =>
    norm(a.material) === norm(material) && a.proveedor === proveedor && a.fechaInicio <= fecha && (a.fechaFin === null || a.fechaFin >= fecha)) || null;

  // 4) Clasificación
  const filas = cxps.map((c) => {
    const base = baseVigente(c.material, c.fechaTicket);
    const ajuste = ajusteVigente(c.material, c.proveedor, c.fechaTicket);
    let vigente = base ? base.precio : null;
    if (base && ajuste) {
      vigente = ajuste.tipoAjuste === 'monto' ? base.precio + ajuste.valorAjuste : base.precio * (1 + ajuste.valorAjuste / 100);
    }
    const congelado = (c.precioNegociado !== null && c.precioNegociado !== undefined) ? Number(c.precioNegociado) : Number(c.precioAplicado);
    const difPorKg = vigente === null ? null : redondear(vigente - congelado);
    const kg = Number(c.kg) || 0;

    let causa;
    if (vigente === null) causa = 'SIN_PRECIO_VIGENTE';
    else if (Math.abs(difPorKg) < 0.005) causa = 'COINCIDE';
    else if (c.precioNegociado !== null && c.precioNegociado !== undefined) causa = 'PRECIO_NEGOCIADO';
    else if (c.ajusteProveedorAplicado && Math.abs(Number(c.precioBase) - base.precio) < 0.005) causa = 'AJUSTE_PROVEEDOR';
    else if (c.fechaRegistro && base.fechaRegistro && c.fechaRegistro < base.fechaRegistro) causa = 'CXP_ANTES_DEL_ALTA_DEL_PRECIO';
    else causa = 'POSIBLE_CACHE_U_OTRO'; // CxP creada después del alta y aun así con precio distinto

    return {
      ticket: c.ticket, proveedor: c.proveedor, fechaEntrada: c.fechaTicket, fechaRegistroCxP: c.fechaRegistro || '',
      fechaRegistroPrecioVigente: base ? (base.fechaRegistro || '') : '',
      kg, precioBase: c.precioBase ?? '', ajusteProveedorAplicado: c.ajusteProveedorAplicado ? JSON.stringify(c.ajusteProveedorAplicado) : '',
      precioNegociado: c.precioNegociado ?? '', precioAplicado: c.precioAplicado, comisionPorKg: c.comisionPorKg ?? '',
      precioVigenteALaFecha: vigente === null ? '' : redondear(vigente), difPorKg: difPorKg ?? '',
      difPesos: difPorKg === null ? '' : redondear(difPorKg * kg),
      estadoPago: c.estado, pagado: c.pagado, saldo: c.saldo, causa
    };
  }).sort((a, b) => (a.fechaEntrada + a.ticket).localeCompare(b.fechaEntrada + b.ticket));

  console.table(filas);

  // 5) Totales por causa
  const totales = {};
  filas.forEach((f) => {
    const t = totales[f.causa] || (totales[f.causa] = { cxp: 0, kg: 0, difPesos: 0, difPesosYaPagadas: 0 });
    t.cxp += 1; t.kg += f.kg; t.difPesos = redondear(t.difPesos + (Number(f.difPesos) || 0));
    if (f.estadoPago === 'liquidado' || Number(f.pagado) > 0) t.difPesosYaPagadas = redondear(t.difPesosYaPagadas + (Number(f.difPesos) || 0));
  });
  console.log('Totales por causa (difPesos > 0: se pagó/cobró de menos frente al vigente):');
  console.table(totales);

  // 6) CSV
  const cols = Object.keys(filas[0] || { ticket: '' });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...filas.map((f) => cols.map((k) => esc(f[k])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `auditoria-precios-${MATERIAL}-${DESDE}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
})();
```

Notas de uso:
- Si la consulta pide un índice o falla por permisos, el error aparece en consola; no se escribe nada.
- `fechaRegistro` del precio solo existe si se guardó con `guardarDato` (lo agrega `js/offline.js:370-371`). Si viene vacío, `CXP_ANTES_DEL_ALTA_DEL_PRECIO` no puede decidirse y la fila cae en `POSIBLE_CACHE_U_OTRO`. Revisa esos casos a mano.
- `difPesos` usa el precio del material (con ajuste), sin comisión.

---

## 4. Qué falta confirmar con los datos y qué implica cada resultado

| Resultado del script | Qué significa | Implicación |
|---|---|---|
| Mayoría en `CXP_ANTES_DEL_ALTA_DEL_PRECIO` | El 9.70 se cargó con fecha retroactiva después de crear las CxP | Es el hueco de diseño: alta de precio no reprecia. Hay que repreciar las CxP afectadas |
| `AJUSTE_PROVEEDOR` | Hay un ajuste vigente (p. ej. −0.20) para ese proveedor | No es error. Confirmar que el ajuste sigue siendo el acordado antes de tocar nada |
| `PRECIO_NEGOCIADO` | Alguien fijó el precio a mano en la CxP (`js/cxp.js:637-648`) | No es error. Respetar siempre; revisar el motivo guardado en `motivoAjustePrecio` |
| `POSIBLE_CACHE_U_OTRO` con CxP posterior al alta | Un cliente creó la CxP con `window.EVE.precios` viejo (`js/utils.js:94`) | Hay que fijar la relectura del catálogo al crear CxP. Revisar `creadoPor` y el dispositivo |
| Aviso "CACHÉ DESACTUALIZADO" en la consola | La memoria de este cliente no tiene precios que Firestore sí | Confirma el riesgo de caché en esta sesión |
| `SIN_PRECIO_VIGENTE` | No existe precio a esa fecha | Aparte del problema; no debería existir CxP sin precio (`js/cxp.js:419`) |
| La diferencia es exactamente la comisión | No hay discrepancia de precio: se comparó `precioEfectivo` contra `precioAplicado` | Ninguna acción sobre precios |
| `COINCIDE` en todas | El 9.50 vs 9.70 viene de otra fuente (pagos capturados a mano, `js/pagos.js:140-154`) | Revisar los registros de Pagos: ahí el precio es un campo libre sin consulta al catálogo |

También por confirmar:
1. Si las CxP afectadas ya tienen abonos o están pagadas (la edición de precio exige revertir abonos, ver `js/cxp.js:987-993`).
2. Si el precio 9.70 se dio de alta por pantalla o por importación, y cuándo (`fechaRegistro` del documento en `precios`).
3. El nombre de la colección de ajustes por proveedor, para leerla fresca en el script.

---

## 5. Propuesta de corrección (en lenguaje claro, sin implementar)

Orden de prioridad:

1. **Repreciar solo las CxP pendientes que no tengan ajuste de proveedor ni precio negociado.** Un proceso que, tras un alta retroactiva, busque las CxP del material desde la fecha de inicio del precio y, si están sin abonos, les ponga el precio vigente y recalcule montos con `recalcularMontosCxP` (`js/cxp.js:618`). Debe mostrar antes una lista de lo que cambiaría (ticket, precio actual, precio nuevo, diferencia en pesos) y pedir confirmación. Las CxP con ajuste o precio negociado se listan aparte y no se tocan.
2. **Aviso al dar de alta un precio retroactivo.** Hoy el aviso solo habla del cierre del precio anterior (`js/precios.js:233-257`). Debería decir cuántas CxP existen con fecha de ticket desde el nuevo inicio y cuáles quedarían con precio distinto, para que quien captura sepa que hay trabajo pendiente.
3. **Relectura del catálogo al crear una CxP.** Antes de congelar el precio, consultar `precios` en Firestore (o al menos confirmar que la memoria está al día). Así un cliente con caché viejo no vuelve a crear CxP con el precio anterior. Cuidar el modo sin conexión: si no se puede releer, avisar que el precio podría estar desactualizado.
4. **CxP ya pagadas o con abonos.** No repreciar automáticamente. Mostrar un reporte con la diferencia en pesos por proveedor y decidir caso por caso: ajuste contra pagos futuros, saldo a favor o saldo en contra del proveedor, o dejarlo así con una nota. Cualquier cambio debe dejar rastro de auditoría.

Fuera de alcance de esta auditoría: la falla conocida de `scripts/verificar-gastos-tipo.js` y cualquier cambio a `firestore.rules`.
