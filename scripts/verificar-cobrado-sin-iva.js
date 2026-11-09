// Regla de negocio: ventas, cobrado y pagado se muestran siempre sin IVA. Los cobros se convierten a base prorrateando:
// pagado × subtotal / total de la cuenta por cobrar (cubre el IVA retenido). Una sola definición en js/utils.js
// (window.subtotalLineaVenta, window.subtotalVenta, window.cobroSinIva, window.montoSinIvaDeAbono) usada por Flujo, Dashboard,
// Ventas y Reportes. Sin navegador: js/ reales en vm con datos sintéticos.
//
// Uso: node scripts/verificar-cobrado-sin-iva.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const cerca = (a, b, m) => afirmar(Math.abs(a - b) < 0.005, `${m}: esperado ${b}, obtenido ${a}`);

function crearContexto(datos) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { getElementById: () => null, createElement: () => ({}) }, navigator: { onLine: true },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = Object.assign({
    registrosDestaraje: [], registrosVentas: [], composiciones: [], precios: [], registrosControlProduccion: [],
    cuentasPorPagar: [], ventas: [], cuentasPorCobrar: [], cobros: [], gastos: [], registrosPagos: [], flujoMovimientos: [], currentUser: null
  }, datos || {});
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const a of ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/reportes.js', 'js/cxc.js', 'js/dashboard.js', 'js/flujo.js']) vm.runInContext(leer(a), sandbox, { filename: a });
  sandbox.window.obtenerFechaMexico = () => '2026-11-04';
  return sandbox.window;
}

// ── Cuentas por cobrar y cobros reales de la regla ──
const cxc = (id, folio, subtotal, totalCxc, extra) => Object.assign({ id, folio, cliente: 'CLIENTE ' + folio, subtotal, total: totalCxc, ivaTrasladado: 0, ivaRetenido: 0, abonos: [] }, extra || {});
const cobro = (id, cxcId, pagado, extra) => Object.assign({ id, cxcId, pagado, iva: 0, fecha: '2026-09-20', cliente: 'CLIENTE', folio: 'V', origen: 'cxc_cobro' }, extra || {});
const CUENTAS = [
  cxc('c2', 'V-2026-002', 116000, 134560, { ivaTrasladado: 18560 }),
  cxc('c6', 'V-2026-006', 33180, 33180, { ivaTrasladado: 5308.8, ivaRetenido: 5308.8 }),   // IVA trasladado y retenido: se compensan
  cxc('c15', 'V-2026-015', 50730, 58846.8, { ivaTrasladado: 8116.8 })
];
const w = crearContexto({ cuentasPorCobrar: CUENTAS });
const sin = (c, cuentas, ventas) => w.cobroSinIva(c, cuentas === undefined ? CUENTAS : cuentas, ventas || []);

// a) V-2026-002: pagado 134,560, subtotal 116,000, total 134,560 → 116,000
cerca(sin(cobro('k2', 'c2', 134560)), 116000, 'a) V-2026-002');
// b) V-2026-006: pagado 33,180, subtotal 33,180, total 33,180 → 33,180. El método anterior (pagado − iva con iva 5,308.80) daba 27,871.20.
cerca(sin(cobro('k6', 'c6', 33180, { iva: 5308.8 })), 33180, 'b) V-2026-006 con prorrateo');
cerca(33180 - 5308.8, 27871.2, 'b) (documentado) el método anterior pagado − iva daba 27871.20, incorrecto con IVA retenido');
// c) V-2026-015: pagado 58,846.80, subtotal 50,730, total 58,846.80 → 50,730
cerca(sin(cobro('k15', 'c15', 58846.8)), 50730, 'c) V-2026-015');
// d) Cobro parcial: la mitad del total cobra la mitad del subtotal
cerca(sin(cobro('kp', 'c15', 29423.4)), 25365, 'd) cobro parcial prorrateado');
// e) Sin CxC: se usa la línea de venta (pagado × subtotal / totalLinea)
const ventas = [{ id: 'v9', lineas: [{ material: 'PET', cantidad: 100, precioUnitario: 10, subtotal: 1000, totalLinea: 1160 }] }];
cerca(sin(cobro('ke', 'no-existe', 580, { ventaId: 'v9', material: 'pet' }), [], ventas), 500, 'e) sin CxC, con línea de venta');
// f) Sin CxC ni línea: pagado − iva
cerca(sin(cobro('kf', 'no-existe', 580, { iva: 80 }), [], []), 500, 'f) sin CxC ni línea usa pagado menos iva');
// g) Anticipo de cliente: completo, aunque traiga iva o cxcId con IVA
cerca(sin(cobro('kg', 'c2', 5000, { origen: 'anticipo', iva: 100 })), 5000, 'g) anticipo de cliente completo');

// montoSinIvaDeAbono: la misma proporción subtotal / total
cerca(w.montoSinIvaDeAbono({ monto: 134560 }, CUENTAS[0]), 116000, 'montoSinIvaDeAbono V-2026-002');
cerca(w.montoSinIvaDeAbono({ monto: 33180 }, CUENTAS[1]), 33180, 'montoSinIvaDeAbono V-2026-006');
cerca(w.montoSinIvaDeAbono({ monto: 100 }, { total: 0 }), 100, 'montoSinIvaDeAbono con cuenta sin total deja el monto');
// Subtotal derivado cuando la cuenta no lo trae: total − IVA trasladado + IVA retenido
cerca(w.montoSinIvaDeAbono({ monto: 116 }, { total: 116, ivaTrasladado: 16, ivaRetenido: 0 }), 100, 'montoSinIvaDeAbono sin subtotal guardado');

// h) y i) Flujo: revertido excluido; septiembre en base y octubre sin cambio
{
  const wf = crearContexto({
    cuentasPorCobrar: CUENTAS,
    cobros: [
      cobro('s1', 'c2', 134560, { fecha: '2026-09-10', fechaRegistro: '2026-09-10T10:00:00Z' }),
      cobro('s2', 'c2', 134560, { fecha: '2026-09-11', revertido: true }),
      cobro('o1', 'c15', 58846.8, { fecha: '2026-10-05', fechaRegistro: '2026-10-05T10:00:00Z' }),
      cobro('a1', 'c2', 5000, { fecha: '2026-10-06', origen: 'anticipo', fechaRegistro: '2026-10-06T10:00:00Z' })
    ]
  });
  const movs = wf.EVE_FLUJO.construirMovimientosFlujo({ cobros: wf.EVE.cobros, cuentasPorCobrar: wf.EVE.cuentasPorCobrar, ventas: wf.EVE.ventas });
  afirmar(movs.length === 3, 'h) el cobro revertido no entra al flujo (3 movimientos)');
  const sep = movs.filter((m) => m.fecha.startsWith('2026-09')), oct = movs.filter((m) => m.fecha.startsWith('2026-10'));
  cerca(sep.reduce((s, m) => s + m.entrada, 0), 116000, 'i) septiembre entra en base (116,000)');
  cerca(oct.find((m) => m.concepto === 'Cobro').entrada, 50730, 'i) octubre: el cobro con IVA también entra en base');
  cerca(oct.find((m) => m.concepto === 'Anticipo cliente').entrada, 5000, 'i) el anticipo de cliente cuenta completo');
  cerca(wf.EVE_FLUJO.calcularTotalesFlujo(movs).entradas, 116000 + 50730 + 5000, 'i) entradas totales del flujo en base');
  // El flujo y los reportes TXT/CSV derivan de ese cálculo: no recalculan aparte (usan los mismos movimientos).
  const filasCsv = wf.EVE_FLUJO.construirFilasCSVFlujo(movs, wf.EVE_FLUJO.calcularTotalesFlujo(movs), 0);
  cerca(filasCsv.filter((f) => f.Origen === 'cobro').reduce((s, f) => s + f.Entrada, 0), 116000 + 50730 + 5000, 'i) el CSV suma las mismas entradas');
  const txt = wf.EVE_FLUJO.generarTXTFlujo(movs, { etiquetaReporte: 'X', etiquetaPeriodo: 'Y' }, wf.EVE_FLUJO.calcularTotalesFlujo(movs), 0);
  afirmar(/ENTRADAS: \$171,730\.00/.test(txt), 'i) el TXT trae las entradas en base: ' + (txt.match(/ENTRADAS: [^\n]*/) || [''])[0]);
}

// j) subtotalVenta: con IVA devuelve la suma de líneas (no totalVenta); sin líneas queda marcada
{
  const conIva = { id: 'v1', folio: 'V-1', cliente: 'ACME', fecha: '2026-10-01', totalVenta: 232, lineas: [
    { material: 'PET', cantidad: 1000, unidad: 'KG', precioUnitario: 0.1, subtotal: 100, ivaTrasladado: 16, totalLinea: 116 },
    { material: 'HDPE', cantidad: 1000, unidad: 'KG', precioUnitario: 0.1, ivaTrasladado: 16, totalLinea: 116 }] };   // sin subtotal guardado: cantidad × precio
  cerca(w.subtotalLineaVenta(conIva.lineas[1]), 100, 'j) subtotalLineaVenta usa cantidad × precioUnitario si falta subtotal');
  cerca(w.subtotalVenta(conIva), 200, 'j) subtotalVenta = suma de líneas, no totalVenta (232)');
  afirmar(w.subtotalVenta({ id: 'v0', totalVenta: 500, lineas: [] }) === null && w.subtotalVenta({ id: 'v0' }) === null, 'j) una venta sin líneas devuelve null');
  const sinLineas = { id: 'v0', folio: 'V-0', cliente: 'ACME', fecha: '2026-10-02', totalVenta: 500, lineas: [] };
  const r = w.construirReporteVentas([conIva, sinLineas]);
  cerca(r.totalVentas, 200, 'j) el reporte suma subtotales y no suma la venta sin líneas');
  afirmar(r.sinLineas.length === 1 && r.sinLineas[0].folio === 'V-0' && r.sinLineas[0].totalVenta === 500, 'j) la venta sin líneas sale aparte con su totalVenta');
  afirmar(r.grupos.length === 1 && r.grupos[0].subtotal === 200, 'j) el grupo del folio con líneas lleva el subtotal');
  cerca(r.grupos[0].lineas.reduce((s, l) => s + l.total, 0), 200, 'j) las líneas del reporte van a subtotal');
  cerca(r.porProducto.reduce((s, p) => s + p.total, 0), 200, 'j) resumen por producto a subtotal');
  cerca(r.porCliente.reduce((s, c) => s + c.total, 0), 200, 'j) resumen por cliente a subtotal');
  // Dashboard > Entradas vs Salidas se mueve con el reporte (mismo cálculo)
  const wd = crearContexto({ ventas: [conIva, sinLineas] });
  const ev = wd.EVE_DASHBOARD.calcularVistaEntradasVsSalidas('todo');
  cerca(ev.totales.salidasMonto, 200, 'j) Dashboard > Entradas vs Salidas usa el subtotal (sin IVA) de las ventas');
  // Los filtros de monto comparan contra el subtotal
  const f1 = wd.obtenerVentasReporte('', '', { montoDesde: '210' });   // totalVenta 232 pasaría; el subtotal 200 no
  afirmar(!f1.some((v) => v.id === 'v1'), 'j) el filtro de monto compara contra el subtotal (200), no contra totalVenta (232)');
  afirmar(wd.obtenerVentasReporte('', '', { montoDesde: '150', montoHasta: '250' }).some((v) => v.id === 'v1'), 'j) el filtro incluye la venta con subtotal dentro del rango');
  // Salidas TXT y CSV
  const txt = w.generarTXTVentas([conIva, sinLineas], { etiquetaReporte: 'X', etiquetaPeriodo: 'Y' });
  afirmar(/TOTAL VENTAS \(SIN IVA\): \$200\.00/.test(txt) && /VENTAS SIN LÍNEAS/.test(txt) && /V-0.*SIN LÍNEAS.*\$500\.00/.test(txt), 'j) el TXT marca la venta sin líneas aparte');
  const csv = w.construirFilasCSVVentas([conIva, sinLineas]);
  afirmar(csv.some((f) => f.seccion === 'SIN LINEAS' && f.folio === 'V-0' && f.total === 500) && csv.find((f) => f.seccion === 'TOTALES').total === 200, 'j) el CSV marca la venta sin líneas y el total no la suma');
}

// k) Pagado por Mes y Proveedor: pagado − iva, anticipo completo, sin revertidos
{
  const wk = crearContexto({ registrosPagos: [
    { id: 'p1', fecha: '2026-10-05', proveedor: 'PROV A', pagado: 1160, iva: 160, origen: 'pago' },
    { id: 'p2', fecha: '2026-10-06', proveedor: 'PROV A', pagado: 3000, iva: 0, origen: 'anticipo' },
    { id: 'p3', fecha: '2026-10-07', proveedor: 'PROV A', pagado: 9999, iva: 0, revertido: true },
    { id: 'p4', fecha: '2026-10-08', proveedor: 'PROV A', pagado: 500, iva: 100, origen: 'anticipo' }
  ] });
  const m = wk.EVE_DASHBOARD.calcularVistaPagadoPorMesProveedor();
  const fila = m.filas.find((f) => f.clave.includes('PROV A'));
  cerca(fila['2026-10'], 1000 + 3000 + 500, 'k) pagado sin IVA (1,000) + anticipos completos (3,000 y 500), sin el revertido');
}

// Cobrado por Mes y Cliente: abonos prorrateados a base
{
  const wc = crearContexto({ cuentasPorCobrar: [
    Object.assign({}, CUENTAS[0], { cliente: 'ACME', abonos: [{ monto: 134560, fecha: '2026-09-20' }, { monto: 999, fecha: '2026-09-21', revertido: true }] }),
    Object.assign({}, CUENTAS[1], { cliente: 'ACME', abonos: [{ monto: 33180, fecha: '2026-10-05' }] })
  ] });
  const c = wc.EVE_DASHBOARD.calcularVistaCobradoPorMesCliente('todo');
  cerca(c.totales['2026-09'], 116000, 'Cobrado por Mes y Cliente: septiembre en base');
  cerca(c.totales['2026-10'], 33180, 'Cobrado por Mes y Cliente: IVA retenido no distorsiona (33,180)');
}

// l) El banner de septiembre, el chip de cobro con IVA y la línea AVISO ya no existen en el flujo ni en sus reportes
{
  const flujo = leer('js/flujo.js');
  afirmar(!/puede estar incompleto|TEXTO_AVISO_SEPTIEMBRE|avisoPeriodoIncompleto|flujo-aviso-septiembre|FLUJO_FECHA_GASTOS_COMPLETOS/.test(flujo), 'l) sin banner de septiembre ni su código en js/flujo.js');
  afirmar(!/Cobro con IVA|TEXTO_ALERTA_IVA|alertaIva|chip-warn'\;\s*\n\s*alerta/.test(flujo) && !/alerta\.className/.test(flujo), 'l) sin chip de cobro con IVA en js/flujo.js');
  afirmar(!/AVISO: /.test(flujo) && !/'Alerta'/.test(flujo), 'l) sin línea AVISO ni columna Alerta en TXT, PDF y CSV');
  afirmar(!/config\.aviso/.test(leer('js/vista-captura.js')), 'l) la vista para captura ya no tiene la opción de aviso de septiembre');
  const wf = crearContexto();
  afirmar(wf.EVE_FLUJO.TEXTO_AVISO_SEPTIEMBRE === undefined && wf.EVE_FLUJO.avisoPeriodoIncompleto === undefined && wf.EVE_FLUJO.TEXTO_ALERTA_IVA === undefined, 'l) EVE_FLUJO ya no exporta los avisos');
  const movs = wf.EVE_FLUJO.construirMovimientosFlujo({ cobros: [cobro('z', 'c2', 134560, { fecha: '2026-09-10', iva: 18560 })], cuentasPorCobrar: CUENTAS });
  afirmar(!('alertaIva' in movs[0]), 'l) el movimiento de cobro no trae alertaIva');
  const csv = wf.EVE_FLUJO.construirFilasCSVFlujo(movs, wf.EVE_FLUJO.calcularTotalesFlujo(movs), 0);
  afirmar(!JSON.stringify(csv).includes('AVISO') && !('Alerta' in csv[0]), 'l) el CSV no trae AVISO ni columna Alerta');
  const txt = wf.EVE_FLUJO.generarTXTFlujo(movs, { etiquetaReporte: 'X', etiquetaPeriodo: 'Y', desde: '2026-09-01', hasta: '2026-09-30' }, wf.EVE_FLUJO.calcularTotalesFlujo(movs), 0);
  afirmar(!/AVISO/.test(txt) && !/incompleto/.test(txt), 'l) el TXT de un periodo con septiembre no trae AVISO');
}

console.log(`${ok}/${total} comprobaciones correctas`);
if (ok !== total) process.exitCode = 1;
