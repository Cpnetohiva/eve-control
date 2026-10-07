// Ventas y Gastos sin IVA en la captura (js/ventas.js, js/gastos.js).
//
// Toda venta nueva se guarda con esFiscal=false, ivaTrasladado=0, retencionIVA=false, ivaRetenido=0 y totalLinea=subtotal
// (totalVenta = suma de subtotales); todo gasto nuevo con montoBase=monto capturado e iva=0. Lo ya guardado con IVA se
// respeta: la línea de una venta existente con IVA lo conserva tal cual (no se recalcula ni se borra) y un gasto con
// iva > 0 conserva iva y montoBase. La interfaz ya no tiene la casilla "Venta fiscal", los campos de IVA ni la derivación
// total/1.16 (se verifica sobre el código fuente: no hay DOM en este script).
//
// Uso: node scripts/verificar-sin-iva-ventas-gastos.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['config.js', 'utils.js', 'ventas.js', 'gastos.js'];
const leerFuente = (archivo) => fs.readFileSync(path.join(RAIZ, 'js', archivo), 'utf8');

function crearContexto() {
  const window = { EVE_MODULES: {} };
  window.window = window;
  window.EVE = {
    registrosDestaraje: [], registrosVentas: [], ventas: [], gastos: [], precios: [], ajustesPrecioProveedor: [],
    currentUser: { username: 'prueba', permisosResueltos: { admin: 'escritura' } }
  };
  const el = () => ({ addEventListener() {}, appendChild() {}, querySelector: () => el(), querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} }, style: {}, options: [] });
  const ctx = vm.createContext({
    window, console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, XLSX: {},
    firebase: { initializeApp() {}, firestore: () => ({ enablePersistence: () => ({ catch() {} }) }) },
    document: { getElementById: () => null, createElement: () => ({ options: [], children: [] }), createTextNode: () => el() }
  });
  for (const f of ARCHIVOS) vm.runInContext(leerFuente(f), ctx, { filename: f });
  return window;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

const MATERIAL = 'LECHERO';
const linea = (extra) => ({ material: MATERIAL, cantidad: 100, precioUnitario: 12.5, ...extra });

// ── Ventas ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

caso('Venta nueva: esFiscal=false, IVA 0, sin retención y totalLinea = subtotal; totalVenta = suma de subtotales', () => {
  const w = crearContexto();
  const venta = w.construirVentaDesdeFormulario({ cliente: 'cliente x', fecha: '2026-10-06', lineas: [linea(), linea({ cantidad: 40, precioUnitario: 10 })] });
  igual(venta.esFiscal, false, 'esFiscal');
  igual(venta.lineas.map((l) => [l.subtotal, l.ivaTrasladado, l.retencionIVA, l.ivaRetenido, l.totalLinea]),
    [[1250, 0, false, 0, 1250], [400, 0, false, 0, 400]], 'campos conservados en 0');
  igual(venta.totalVenta, 1650, 'totalVenta');
});

caso('Venta nueva: ignora cualquier IVA, retención o esFiscal que llegue en los datos (ya no hay controles)', () => {
  const w = crearContexto();
  const venta = w.construirVentaDesdeFormulario({
    cliente: 'X', fecha: '2026-10-06', esFiscal: 'true',
    lineas: [linea({ ivaTrasladado: 200, retencionIVA: true, ivaRetenido: 200 })]
  });
  igual([venta.esFiscal, venta.lineas[0].ivaTrasladado, venta.lineas[0].retencionIVA, venta.lineas[0].ivaRetenido, venta.totalVenta], [false, 0, false, 0, 1250], 'sin IVA');
});

caso('Venta nueva por el importador de Admin (sin campos de IVA): mismo resultado', () => {
  const w = crearContexto();
  const venta = w.construirVentaDesdeFormulario({ cliente: 'X', fecha: '2026-10-06', lineas: [{ material: MATERIAL, cantidad: '10', precioUnitario: '5' }] });
  igual([venta.esFiscal, venta.lineas[0].totalLinea, venta.totalVenta], [false, 50, 50], 'importador');
});

caso('Edición de una venta con IVA: conserva IVA trasladado, retención y esFiscal; no recalcula el 16%', () => {
  const w = crearContexto();
  const venta = w.construirVentaDesdeFormulario({
    cliente: 'X', fecha: '2026-10-06', esFiscal: true,
    lineas: [linea({ ivaConservado: true, ivaTrasladado: 123.45, retencionIVA: true, ivaRetenido: 123.45 }), linea({ ivaConservado: true, ivaTrasladado: 77, retencionIVA: false, ivaRetenido: 0 })]
  });
  igual(venta.esFiscal, true, 'esFiscal conservado');
  igual(venta.lineas.map((l) => [l.ivaTrasladado, l.retencionIVA, l.ivaRetenido]), [[123.45, true, 123.45], [77, false, 0]], 'IVA conservado');
  igual(venta.lineas.map((l) => l.totalLinea), [1250, 1327], 'totalLinea = subtotal + IVA - retenido');
  igual(venta.totalVenta, 2577, 'totalVenta');
});

caso('Edición de una venta con IVA: cambiar cantidad/precio no recalcula el IVA, y una línea nueva no lleva IVA', () => {
  const w = crearContexto();
  const venta = w.construirVentaDesdeFormulario({
    cliente: 'X', fecha: '2026-10-06', esFiscal: true,
    lineas: [linea({ cantidad: 200, ivaConservado: true, ivaTrasladado: 200, retencionIVA: false, ivaRetenido: 0 }), linea()]
  });
  igual(venta.lineas.map((l) => [l.subtotal, l.ivaTrasladado, l.totalLinea]), [[2500, 200, 2700], [1250, 0, 1250]], 'IVA fijo y línea nueva sin IVA');
});

caso('Edición de una venta sin IVA: sigue sin IVA y no se vuelve fiscal', () => {
  const w = crearContexto();
  const venta = w.construirVentaDesdeFormulario({ cliente: 'X', fecha: '2026-10-06', esFiscal: false, lineas: [linea()] });
  igual([venta.esFiscal, venta.lineas[0].ivaTrasladado, venta.totalVenta], [false, 0, 1250], 'sin IVA');
});

caso('ventas.js: sin casilla Venta fiscal, sin campos de IVA ni retención editables y sin el 16% automático', () => {
  const f = leerFuente('ventas.js');
  ['vt-fiscal', 've-fiscal', 'Venta Fiscal', "'vl-iva'", "'vl-retencion'", 'Retención IVA 100%', 'actualizarFiscal', 'obtenerEsFiscal', '* 0.16'].forEach((texto) => {
    afirmar(!f.includes(texto), `ventas.js ya no debe contener ${texto}`);
  });
  afirmar(f.includes('vl-iva-lectura'), 'el IVA existente se muestra como lectura');
  afirmar(f.includes('esFiscal: !!(anterior && anterior.esFiscal)'), 'la edición conserva el esFiscal de la venta');
});

// ── Gastos ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

caso('Gasto nuevo: el monto se guarda como montoBase con iva=0', () => {
  const w = crearContexto();
  const gasto = w.EVE_GASTOS.construirGastoDesdeFormulario({ montoBase: '1160', iva: 0, fecha: '2026-10-06', concepto: 'Luz' });
  igual([gasto.montoBase, gasto.iva], [1160, 0], 'montoBase e iva');
  const sinIva = w.EVE_GASTOS.construirGastoDesdeFormulario({ montoBase: '500', fecha: '2026-10-06' });
  igual([sinIva.montoBase, sinIva.iva], [500, 0], 'sin campo iva');
});

caso('Gasto existente con IVA: se conservan iva y montoBase tal cual', () => {
  const w = crearContexto();
  const gasto = w.EVE_GASTOS.construirGastoDesdeFormulario({ montoBase: 1000, iva: 160, fecha: '2026-10-06', concepto: 'Renta' });
  igual([gasto.montoBase, gasto.iva], [1000, 160], 'conservados');
});

caso('Totales (montoBase + iva) siguen bien con iva=0, con iva>0 y con gastos viejos sin campo iva', () => {
  const w = crearContexto();
  const stats = w.EVE_GASTOS.calcularStats([{ montoBase: 100, iva: 0 }, { montoBase: 1000, iva: 160 }, { montoBase: 50 }]);
  igual([stats.totalRegistros, stats.total], [3, 1310], 'calcularStats');
});

caso('gastos.js: sin casilla de IVA automático, sin campo IVA editable ni derivación total/1.16', () => {
  const f = leerFuente('gastos.js');
  ['calcularBaseIvaDesdeTotal', '1.16', 'ga-iva', 'gae-iva-auto', 'ga-total-pagado', 'gae-total-pagado', 'Calcular IVA automático'].forEach((texto) => {
    afirmar(!f.includes(texto), `gastos.js ya no debe contener ${texto}`);
  });
  afirmar(!/id="gae-iva"/.test(f), 'sin campo gae-iva editable');
  afirmar(f.includes('gae-iva-lectura') && f.includes('tieneIvaGuardado'), 'el IVA existente se muestra como lectura');
  const w = crearContexto();
  afirmar(!('calcularBaseIvaDesdeTotal' in w.EVE_GASTOS), 'ya no se exporta calcularBaseIvaDesdeTotal');
});

// ── Interfaz: IVA oculto en Cobros, Ventas (vista para captura), Gastos y Dashboard ──────────────────────────────────────

caso('Cobros: sin columna IVA en la tabla ni en el CSV (los documentos conservan el campo iva)', () => {
  const f = leerFuente('cobros.js');
  afirmar(!f.includes('<th data-tipo="moneda">IVA</th>'), 'sin encabezado IVA');
  afirmar(!f.includes("'IVA':"), 'sin columna IVA en el CSV');
  afirmar(!f.includes('registro.iva'), 'la fila de la tabla no lee iva');
  const columnas = (f.match(/<tr>(<th.*?)<\/tr>/) || [])[1].split('<th').length - 1;
  afirmar(f.includes(`celda.colSpan = ${columnas}`), `colSpan de la fila vacía = ${columnas} columnas`);
});

caso('Ventas: la vista para captura ya no muestra KPI de IVA (subtotal y total siguen)', () => {
  const f = leerFuente('ventas.js');
  const bloque = f.slice(f.indexOf('function abrirVistaCapturaVentas'), f.indexOf('function actualizarVisibilidadBotonCapturaVentas'));
  afirmar(!bloque.includes("label: 'IVA'") && !bloque.includes('ivaTrasladado'), 'sin KPI de IVA');
  afirmar(bloque.includes("label: 'Subtotal'") && bloque.includes("label: 'Total'"), 'Subtotal y Total se conservan');
});

caso('Gastos: sin columna ni KPI de IVA en la tabla y la vista para captura; el total sigue siendo montoBase + iva', () => {
  const f = leerFuente('gastos.js');
  afirmar(!f.includes('<th data-tipo="moneda">IVA</th>'), 'sin encabezado IVA');
  afirmar(!f.includes("etiqueta: 'IVA'") && !f.includes("label: 'IVA'"), 'sin columna ni KPI IVA en la vista para captura');
  afirmar(!f.includes('registro.iva || 0'), 'la fila de la tabla no imprime iva');
  const columnas = (f.match(/<tr>(<th.*?)<\/tr>/) || [])[1].split('<th').length - 1;
  afirmar(f.includes(`celda.colSpan = ${columnas}`), `colSpan de la fila vacía = ${columnas} columnas`);
  const w = crearContexto();
  igual(w.EVE_GASTOS.calcularStats([{ montoBase: 1000, iva: 160 }]).total, 1160, 'Total con IVA histórico intacto');
});

caso('Dashboard: sin pestaña Posición de IVA; los cálculos exportados siguen disponibles', () => {
  const f = leerFuente('dashboard.js');
  ['posicion-iva', "nombre: 'Posición de IVA'", 'renderizarTablaPosicionIva'].forEach((t) => afirmar(!f.includes(t), `dashboard.js ya no contiene ${t}`));
  afirmar(f.includes('calcularVistaPosicionIva,') && f.includes('calcularVistaFlujoEfectivoHistorico'), 'cálculos y Flujo de Efectivo intactos');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FAIL ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
