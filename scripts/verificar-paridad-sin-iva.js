// Paridad del cálculo sin IVA entre EVE Control (js/utils.js: window.cobroSinIva, window.montoSinIvaDeAbono, window.subtotalVenta)
// y el Dashboard Ejecutivo (dashboard-ejecutivo/index.html: cobroSinIva dentro de calc(), subtotalCxc, baseCxc y el reporte mensual de CxC).
// Sin navegador: se extrae por texto la lógica del HTML (la de utils.js se carga completa) y se corren las dos con los mismos casos.
// Lo que NO se puede extraer sin navegador: el render real (Chart.js, estilos) y la lectura de Firestore; solo se corre la lógica.
//
// Uso: node scripts/verificar-paridad-sin-iva.js [ruta/index.html]   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const HTML_RUTA = path.resolve(process.argv[2] || path.join(RAIZ, '..', 'dashboard-ejecutivo', 'index.html'));
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const cerca = (a, b, m) => afirmar(Math.abs(a - b) < 0.005, `${m}: esperado ${b}, obtenido ${a}`);
if (!fs.existsSync(HTML_RUTA)) { console.error('No existe ' + HTML_RUTA); process.exit(1); }
const html = fs.readFileSync(HTML_RUTA, 'utf8');

// ── Extracción del HTML ──
function extraerFuncion(nombre) {
  const ini = html.indexOf('function ' + nombre + '(');
  if (ini < 0) return '';
  let i = html.indexOf('{', ini), nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) return html.slice(ini, i + 1);
  }
  return '';
}
function extraerLinea(nombre) {
  const m = html.match(new RegExp('^(?:const|let) ' + nombre + '\\s*=.*$', 'm'));
  return m ? m[0] : '';
}
// "const cobroSinIva=c=>{ ... };" vive dentro de calc(): se extrae el bloque por llaves.
function extraerCobroSinIva() {
  const ini = html.indexOf('const cobroSinIva=c=>{');
  if (ini < 0) return '';
  let i = html.indexOf('{', ini), nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) return html.slice(ini, i + 2);   // incluye el ';'
  }
  return '';
}
const bloqueCobro = extraerCobroSinIva();
afirmar(!!bloqueCobro, 'se extrajo cobroSinIva del HTML (calc)');
const LINEAS = ['num', 'fmt\\$2', 'fmt\\$', 'fmtN', 'fmtPct', 'esc', 'iso', 'fdate', 'norm', 'MATERIALES_ALIAS', 'normMat', 'PROVEEDORES_SOCIOS', 'limpiaSocio', 'sum', 'MESES', 'MESES_L', 'UNIDAD_PZ',
  'dayDiff', 'inP', 'tipoNormG', 'rmM', 'dia10', 'diaAnterior', 'verSocioG', 'esSaldoInicialCta', 'subtotalCxc', 'baseCxc', 'INCLUIR_SOCIOS'];
const FUNCS = ['esProveedorSocio', 'incluirSocios', 'grp', 'aging', 'calc', 'abonosCxcAl', 'cxcAlCorteDet', 'puenteCxCMes', 'rmBloqueCxC'];
const lineas = LINEAS.map(extraerLinea), funcs = FUNCS.map(extraerFuncion);
afirmar(lineas.every(Boolean), 'constantes del HTML encontradas; faltan: ' + LINEAS.filter((n, i) => !lineas[i]).join(', '));
afirmar(funcs.every(Boolean), 'funciones del HTML encontradas; faltan: ' + FUNCS.filter((n, i) => !funcs[i]).join(', '));

const ctxHtml = { console: { warn() {}, info() {}, error: console.error, log() {} }, localStorage: { getItem: () => null }, COL_FALLAS: [] };
vm.createContext(ctxHtml);
vm.runInContext(`
  const HOY = '2026-11-09'; let DB = null, PER = { desde: '', hasta: '', label: '' };
  ${lineas.join('\n')}
  ${funcs.join('\n')}
  // Mismo cálculo que dentro de calc(): se arma con los mismos índices que calc() y el bloque extraído
  function cobroHtml(c, cxcs, ventas) {
    const cxcPorId = {}; cxcs.forEach((x) => (cxcPorId[x.id] = x));
    const ventaPorId = {}; ventas.forEach((v) => (ventaPorId[v.id] = v));
    ${bloqueCobro}
    return cobroSinIva(c);
  }
  globalThis.api = { cobroHtml, calc: (db, per) => { DB = db; PER = per; return calc(); }, rmBloqueCxC: (db, d, h, Rm) => { DB = db; return rmBloqueCxC(d, h, Rm); },
    cxcAlCorteDet: (db, c) => { DB = db; return cxcAlCorteDet(c); }, baseCxc, subtotalCxc };
`, ctxHtml);
const H = ctxHtml.api;

// ── Contexto de EVE Control (js/ reales) ──
function crearUtils() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { getElementById: () => null, createElement: () => ({}) }, navigator: { onLine: true },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox; sandbox.window.EVE = {}; sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const a of ['js/config.js', 'js/utils.js']) vm.runInContext(leer(a), sandbox, { filename: a });
  return sandbox.window;
}
const W = crearUtils();

// ── Casos de cobros: las dos implementaciones deben dar lo mismo ──
const cxc = (id, folio, subtotal, totalCxc, extra) => Object.assign({ id, folio, cliente: 'C ' + folio, subtotal, total: totalCxc, ivaTrasladado: 0, ivaRetenido: 0, abonos: [] }, extra || {});
const cobro = (id, cxcId, pagado, extra) => Object.assign({ id, cxcId, pagado, iva: 0, fecha: '2026-09-20', origen: 'cxc_cobro' }, extra || {});
const CUENTAS = [
  cxc('c2', 'V-2026-002', 116000, 134560, { ivaTrasladado: 18560 }),
  cxc('c6', 'V-2026-006', 33180, 33180, { ivaTrasladado: 5308.8, ivaRetenido: 5308.8 }),
  cxc('c15', 'V-2026-015', 50730, 58846.8, { ivaTrasladado: 8116.8 }),
  { id: 'cH', folio: 'V-H', cliente: 'C H', total: 1160, ivaTrasladado: 260, ivaRetenido: 100, abonos: [] }   // h) sin subtotal guardado
];
const VENTAS = [{ id: 'v9', lineas: [{ material: 'PET', cantidad: 100, precioUnitario: 10, subtotal: 1000, totalLinea: 1160 }] }];
const casos = [
  ['a) V-2026-002', cobro('k', 'c2', 134560), CUENTAS, VENTAS, 116000],
  ['b) V-2026-006', cobro('k', 'c6', 33180, { iva: 5308.8 }), CUENTAS, VENTAS, 33180],
  ['c) V-2026-015', cobro('k', 'c15', 58846.8), CUENTAS, VENTAS, 50730],
  ['d) cobro parcial', cobro('k', 'c15', 29423.4), CUENTAS, VENTAS, 25365],
  ['e) sin CxC con línea de venta', cobro('k', 'nada', 580, { ventaId: 'v9', material: 'pet' }), [], VENTAS, 500],
  ['f) sin CxC ni línea: pagado menos iva', cobro('k', 'nada', 580, { iva: 80 }), [], [], 500],
  ['g) anticipo completo', cobro('k', 'c2', 5000, { origen: 'anticipo', iva: 100 }), CUENTAS, VENTAS, 5000],
  ['g2) anticipo sin cxcId completo', cobro('k', undefined, 700, { origen: 'anticipo', iva: 50 }), CUENTAS, VENTAS, 700],
  // h) cuenta sin subtotal guardado: subtotal = total − IVA trasladado + IVA retenido = 1160 − 260 + 100 = 1000
  ['h) cuenta sin subtotal guardado con IVA trasladado y retenido', cobro('k', 'cH', 1160), CUENTAS, VENTAS, 1000]
];
casos.forEach(([nombre, c, cuentas, ventas, esperado]) => {
  const web = W.cobroSinIva(c, cuentas, ventas), ejec = H.cobroHtml(c, cuentas, ventas);
  cerca(web, esperado, `${nombre}: EVE Control (js/utils.js)`);
  cerca(ejec, esperado, `${nombre}: Dashboard Ejecutivo`);
  cerca(web, ejec, `${nombre}: paridad entre ambos`);
});
// montoSinIvaDeAbono (EVE) = baseCxc (Ejecutivo) para los mismos abonos
[[134560, CUENTAS[0]], [33180, CUENTAS[1]], [29423.4, CUENTAS[2]], [1160, CUENTAS[3]], [100, { total: 0 }]].forEach(([monto, cuenta], i) => {
  cerca(W.montoSinIvaDeAbono({ monto }, cuenta), H.baseCxc(monto, cuenta), `montoSinIvaDeAbono = baseCxc (caso ${i + 1})`);
});
cerca(W.montoSinIvaDeAbono({ monto: 1160 }, CUENTAS[3]), 1000, 'h) montoSinIvaDeAbono con cuenta sin subtotal guardado');

// subtotalVenta (EVE) = ventasMonto de calc() (Ejecutivo): línea con subtotal, línea sin subtotal (cantidad × precio) y IVA aparte
{
  const venta = { id: 'v1', folio: 'V-1', cliente: 'ACME', fecha: '2026-10-01', totalVenta: 232, lineas: [
    { material: 'PET', cantidad: 1000, unidad: 'KG', precioUnitario: 0.1, subtotal: 100, ivaTrasladado: 16, totalLinea: 116 },
    { material: 'HDPE', cantidad: 1000, unidad: 'KG', precioUnitario: 0.1, ivaTrasladado: 16, totalLinea: 116 }] };
  const db = { cxp: [], cxc: [], ventas: [venta], destaraje: [], cobros: [], pagos: [], gastos: [], flujo: [], precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [] };
  const R = H.calc(db, { desde: '2026-10-01', hasta: '2026-10-31', label: 'x' });
  cerca(W.subtotalVenta(venta), 200, 'subtotalVenta (EVE) suma las líneas, no totalVenta');
  cerca(R.ventasMonto, W.subtotalVenta(venta), 'ventas del Ejecutivo (calc) = subtotalVenta de EVE');
  afirmar(W.subtotalVenta({ id: 'v0', totalVenta: 500, lineas: [] }) === null, 'subtotalVenta: venta sin líneas = null (EVE marca la venta)');
}

// Pagado y anticipos: el Ejecutivo cuenta el anticipo completo, como EVE Control (js/flujo.js / js/dashboard.js)
{
  const db = { cxp: [], cxc: [], ventas: [], destaraje: [], cobros: [], gastos: [], flujo: [], precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [], pagos: [
    { id: 'p1', fecha: '2026-10-05', pagado: 1160, iva: 160, origen: 'pago' },
    { id: 'p2', fecha: '2026-10-06', pagado: 3000, iva: 0, origen: 'anticipo' },
    { id: 'p3', fecha: '2026-10-07', pagado: 500, iva: 100, origen: 'anticipo' },
    { id: 'p4', fecha: '2026-10-08', pagado: 9999, iva: 0, origen: 'pago', revertido: true }] };
  const R = H.calc(db, { desde: '2026-10-01', hasta: '2026-10-31', label: 'x' });
  cerca(R.pagado, 1000 + 3000 + 500, 'Ejecutivo: pagado = pagado − iva y anticipos completos, sin revertidos');
  cerca(R.anticipos, 3500, 'Ejecutivo: anticipos completos');
}

// ── i) y j) Reporte mensual de CxC en base: septiembre con ventas con IVA totalmente cobradas, y octubre ──
// Septiembre: A (IVA 16 %, subtotal 2,000,000, total 2,320,000) cobrada completa; B (sin IVA 1,229,773) cobrada en parte (1,148,469).
//   generado 3,229,773 · cobrado 3,148,469 · saldo final 81,304.
// Octubre: se cobra el resto de B (81,304) y 3,140,003 de C (4,126,186.20, sin IVA) → cobrado 3,221,307; generado 4,126,186.20; final 986,183.20.
{
  const A = cxc('A', 'V-A', 2000000, 2320000, { ivaTrasladado: 320000, fechaVenta: '2026-09-05', abonos: [{ monto: 2320000, fecha: '2026-09-20' }] });
  const B = cxc('B', 'V-B', 1229773, 1229773, { fechaVenta: '2026-09-10', abonos: [{ monto: 1148469, fecha: '2026-09-25' }, { monto: 81304, fecha: '2026-10-12' }] });
  const C = cxc('C', 'V-C', 4126186.2, 4126186.2, { fechaVenta: '2026-10-03', abonos: [{ monto: 3140003, fecha: '2026-10-20' }] });
  const venta = (id, folio, fecha, subtotal, iva) => ({ id, folio, cliente: 'C ' + folio, fecha, totalVenta: subtotal + iva,
    lineas: [{ material: 'PET', cantidad: 1, unidad: 'KG', precioUnitario: subtotal, subtotal, ivaTrasladado: iva, totalLinea: subtotal + iva }] });
  const cobros = [
    cobro('k1', 'A', 2320000, { fecha: '2026-09-20' }), cobro('k2', 'B', 1148469, { fecha: '2026-09-25' }),
    cobro('k3', 'B', 81304, { fecha: '2026-10-12' }), cobro('k4', 'C', 3140003, { fecha: '2026-10-20' })
  ];
  const db = { cxp: [], cxc: [A, B, C], ventas: [venta('A', 'V-A', '2026-09-05', 2000000, 320000), venta('B', 'V-B', '2026-09-10', 1229773, 0), venta('C', 'V-C', '2026-10-03', 4126186.2, 0)],
    destaraje: [], cobros, pagos: [], gastos: [], flujo: [], precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [] };
  const periodo = (desde, hasta) => {
    const Rm = H.calc(db, { desde, hasta, label: 'x' });
    return H.rmBloqueCxC(db, desde, hasta, Rm);
  };
  const sep = periodo('2026-09-01', '2026-09-30');
  const m = (h, re) => { const r = h.match(re); return r ? Number(r[1].replace(/[$,]/g, '')) : NaN; };
  cerca(m(sep, /Saldo inicial \(al [^<]*\)<\/td><td class="n">(-?\$[\d,.]+)/), 0, 'i) septiembre: saldo inicial');
  cerca(m(sep, /Generado en el mes \(ventas\)<\/td><td class="n">(-?\$[\d,.]+)/), 3229773, 'i) septiembre: generado');
  cerca(m(sep, /Cobrado en el mes en efectivo<\/td><td class="n">(-?\$[\d,.]+)/), -3148469, 'i) septiembre: cobrado (la fila lo muestra restando)');
  cerca(m(sep, /= Saldo final \(al [^<]*\)<\/td><td class="n">(-?\$[\d,.]+)/), 81304, 'i) septiembre: saldo final');
  afirmar(!/warnbar/.test(sep), 'i) septiembre: ningún aviso amarillo');
  afirmar(!/IVA trasladado o retenido/.test(sep), 'i) ya no existe el aviso de cuentas con IVA');
  const oct = periodo('2026-10-01', '2026-10-31');
  cerca(m(oct, /Saldo inicial \(al [^<]*\)<\/td><td class="n">(-?\$[\d,.]+)/), 81304, 'j) octubre: saldo inicial');
  cerca(m(oct, /Generado en el mes \(ventas\)<\/td><td class="n">(-?\$[\d,.]+)/), 4126186.2, 'j) octubre: generado');
  cerca(m(oct, /Cobrado en el mes en efectivo<\/td><td class="n">(-?\$[\d,.]+)/), -3221307, 'j) octubre: cobrado (la fila lo muestra restando)');
  cerca(m(oct, /= Saldo final \(al [^<]*\)<\/td><td class="n">(-?\$[\d,.]+)/), 986183.2, 'j) octubre: saldo final');
  afirmar(!/warnbar/.test(oct), 'j) octubre: ningún aviso amarillo');
  // El saldo de septiembre por cuenta está en base: A (con IVA) queda en 0, no en negativo
  const det = H.cxcAlCorteDet(db, '2026-09-30');
  cerca(det.filas.find((f) => f.c.id === 'A').saldo, 0, 'i) la cuenta con IVA totalmente cobrada queda en saldo 0 (no negativo)');
  afirmar(det.filas.every((f) => f.saldo > -0.005), 'i) ninguna cuenta con saldo negativo');
}

// El encabezado "Todos los importes son sin impuestos" sigue en el reporte y la sección CxC lo dice también
afirmar(/Todos los importes son sin impuestos/.test(html), 'el reporte mensual conserva "Todos los importes son sin impuestos"');
afirmar(/Todo en base sin IVA: se usa el subtotal de cada cuenta/.test(extraerFuncion('rmBloqueCxC')), 'la sección CxC dice que está en base sin IVA');
afirmar(!/IVA trasladado o retenido distinto de 0/.test(html), 'ya no existe el aviso "traen IVA trasladado o retenido distinto de 0"');

console.log(`${ok}/${total} comprobaciones correctas`);
if (ok !== total) process.exitCode = 1;
