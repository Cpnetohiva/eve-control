// Reporte mensual del Dashboard Ejecutivo (A12): pagos y anticipos a proveedores en UNA sola fila «Pagos a proveedores» y sin cinco notas explicativas.
// Sin navegador: extracción por texto de dashboard-ejecutivo/index.html y vm (mismo método que verificar-paridad-sin-iva.js). Se compara contra el respaldo
// anterior (index.html.bakNN: el más alto que todavía trae la fila «Anticipos a proveedores»).
//
// Uso: node scripts/verificar-reporte-mensual-limpio.js [ruta/index.html] [ruta/respaldo-anterior]   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const CARPETA = path.join(RAIZ, '..', 'dashboard-ejecutivo');
const HTML_RUTA = path.resolve(process.argv[2] || path.join(CARPETA, 'index.html'));
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const cerca = (a, b, m) => afirmar(Math.abs(a - b) < 0.005, `${m}: esperado ${b}, obtenido ${a}`);
if (!fs.existsSync(HTML_RUTA)) { console.error('No existe ' + HTML_RUTA); process.exit(1); }
const html = fs.readFileSync(HTML_RUTA, 'utf8');

function buscarRespaldo() {
  if (process.argv[3]) return path.resolve(process.argv[3]);
  const nums = fs.readdirSync(CARPETA).map((f) => (f.match(/^index\.html\.bak(\d+)$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => b - a);
  for (const n of nums) {
    const r = path.join(CARPETA, 'index.html.bak' + n);
    if (/Anticipos a proveedores/.test(fs.readFileSync(r, 'utf8'))) return r;
  }
  return null;
}

const extraer = (texto) => {
  const funcion = (nombre) => {
    const ini = texto.indexOf('function ' + nombre + '(');
    if (ini < 0) return '';
    let i = texto.indexOf('{', ini), nivel = 0;
    for (; i < texto.length; i++) {
      if (texto[i] === '{') nivel++;
      else if (texto[i] === '}' && --nivel === 0) return texto.slice(ini, i + 1);
    }
    return '';
  };
  const linea = (n) => { const m = texto.match(new RegExp('^(?:const|let) ' + n + '\\s*=.*$', 'm')); return m ? m[0] : ''; };
  return { funcion, linea };
};
const LINEAS = ['num', 'fmt\\$', 'fmt\\$2', 'fmtN', 'fmtPct', 'esc', 'iso', 'fdate', 'norm', 'MATERIALES_ALIAS', 'normMat', 'PROVEEDORES_SOCIOS', 'limpiaSocio', 'sum', 'MESES', 'MESES_L', 'UNIDAD_PZ',
  'dayDiff', 'inP', 'tipoNormG', 'rmM', 'dia10', 'diaAnterior', 'verSocioG', 'esSaldoInicialCta', 'FLUJO_INICIO', 'subtotalCxc', 'baseCxc', 'INCLUIR_SOCIOS'];
const FUNCS = ['esProveedorSocio', 'incluirSocios', 'grp', 'aging', 'calc', 'abonosVigentesAl', 'cxpAlCorteDet', 'abonosCxcAl', 'cxcAlCorteDet', 'puenteCxPMes', 'puenteCxCMes',
  'rmFilasRubro', 'rmTablaRubro', 'rmBloqueCxP', 'rmBloqueCxC', 'rReporteMensual', 'mesAnteriorISO'];

function cargar(ruta) {
  const texto = fs.readFileSync(ruta, 'utf8');
  const { funcion, linea } = extraer(texto);
  const lineas = LINEAS.map(linea), funcs = FUNCS.map(funcion);
  const faltan = LINEAS.filter((n, i) => !lineas[i]).concat(FUNCS.filter((n, i) => !funcs[i]));
  afirmar(faltan.length === 0, `${path.basename(ruta)}: se extrajeron las constantes y funciones del reporte mensual (faltan: ${faltan.join(', ') || 'ninguna'})`);
  const kpiLinea = (texto.match(/^function kpi\(.*$/m) || [''])[0];
  const el = {};
  const ctx = { console: { warn() {}, info() {}, error() {}, log() {}, table() {} }, localStorage: { getItem: () => null, removeItem() {} },
    $: (id) => el[id] || (el[id] = { value: '', innerHTML: '' }), barRow: () => '', COL_FALLAS: [] };
  vm.createContext(ctx);
  vm.runInContext(`
    const HOY = '2026-11-10'; let DB = null, PER = { desde: '', hasta: '', label: '' }, R = null;
    ${lineas.filter((l) => !/^let (COL_FALLAS|INCLUIR_SOCIOS)/.test(l)).join('\n')}
    let INCLUIR_SOCIOS = false; let COL_FALLAS = [];
    ${kpiLinea}
    ${funcs.join('\n')}
    globalThis.api = { calc: (db, per) => { DB = db; PER = per; return (R = calc()); }, setIncluir: (v) => { INCLUIR_SOCIOS = v; },
      reporte: (db, mes) => { DB = db; $('rmMes').value = mes; rReporteMensual(); return $('rmCuerpo').innerHTML; } };
  `, ctx);
  return { api: ctx.api, texto };
}

// ── Datos sintéticos ──
const vacio = () => ({ cxp: [], cxc: [], ventas: [], destaraje: [], cobros: [], pagos: [], gastos: [], flujo: [], precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [] });
function datos(opciones) {
  const o = opciones || {};
  const d = vacio();
  d.cxp = [{ id: 'x1', ticket: '1001', proveedor: 'PROV A', material: 'PET', kg: 700, total: 3500, saldo: 1500, fechaTicket: '2026-10-05', iva: o.ivaCxp || 0, abonos: [{ monto: 2000, fecha: '2026-10-10' }] },
    { id: 'x2', ticket: '1002', proveedor: 'PROV B', material: 'HDPE', kg: 300, total: 1800, saldo: 1800, fechaTicket: '2026-09-06', abonos: [{ monto: 400, fecha: '2026-09-12' }] }];
  d.ventas = [{ id: 'v1', folio: 'V-1', fecha: '2026-10-03', cliente: 'C1', lineas: [{ material: 'PET MOLIDO', cantidad: 1000, unidad: 'KG', precioUnitario: 10, subtotal: 10000, ivaTrasladado: 1600, totalLinea: 11600 }] },
    { id: 'v2', folio: 'V-2', fecha: '2026-09-15', cliente: 'C2', lineas: [{ material: 'PET MOLIDO', cantidad: 400, unidad: 'KG', precioUnitario: 12, subtotal: 4800, totalLinea: 4800 }] }];
  d.cxc = [{ id: 'c1', folio: 'V-1', cliente: 'C1', fechaVenta: '2026-10-03', subtotal: 10000, total: 11600, ivaTrasladado: 1600, saldo: 5800, cobrado: 5800, abonos: [{ monto: 5800, fecha: '2026-10-20' }] },
    { id: 'c2', folio: 'V-2', cliente: 'C2', fechaVenta: '2026-09-15', subtotal: 4800, total: 4800, saldo: 4800, cobrado: 0, abonos: [] }];
  d.cobros = [{ id: 'k1', cxcId: 'c1', cliente: 'C1', pagado: 5800, iva: 800, fecha: '2026-10-20', origen: 'cxc_cobro' }, { id: 'k2', cliente: 'C3', pagado: 2000, fecha: '2026-10-22', origen: 'anticipo' }];
  d.pagos = [{ id: 'p1', proveedor: 'PROV A', pagado: 2320, iva: 320, fecha: '2026-10-10', origen: 'pago' }, { id: 'p5', proveedor: 'PROV B', pagado: 464, iva: 64, fecha: '2026-09-12', origen: 'pago' },
    { id: 'p9', proveedor: 'PROV A', pagado: 99, fecha: '2026-10-12', origen: 'pago', revertido: true }];
  if (o.anticipos !== false) d.pagos.push({ id: 'p2', proveedor: 'PROV B', pagado: 500, iva: 80, fecha: '2026-10-11', origen: 'anticipo' });
  d.gastos = [{ id: 'g1', fecha: '2026-10-12', concepto: 'Renta', montoBase: 700, total: 812, iva: 112, tipoGasto: 'operativo' }, { id: 'g2', fecha: '2026-10-14', concepto: 'Maquina', montoBase: 400, tipoGasto: 'inversion' },
    { id: 'g3', fecha: '2026-09-12', concepto: 'Luz', montoBase: 150, tipoGasto: 'operativo' }];
  d.flujo = [{ id: 'm1', tipo: 'Saldo inicial', fecha: '2026-09-01', importe: 10000 }, { id: 'm2', tipo: 'Aportación o préstamo', fecha: '2026-10-15', importe: 2000 },
    { id: 'm4', tipo: 'Otra salida', fecha: '2026-10-18', importe: 60 }];
  if (o.manual !== false) d.flujo.push({ id: 'm3', tipo: 'Anticipo a proveedor', fecha: '2026-10-16', importe: 300 });
  d.proveedores = [{ id: 'PROV A', nombre: 'PROV A', saldoAFavor: [{ monto: 100, fecha: '2026-10-01' }] }]; d.clientes = [{ id: 'C1', saldoAFavor: [{ monto: 50, fecha: '2026-10-01' }] }];
  return d;
}

// ── Lectura de cifras del reporte ──
const monto = (t) => Number(String(t).replace(/[^0-9.\-]/g, ''));
const filaPagos = (h) => { const m = h.match(/<tr><td>Pagos a proveedores<\/td><td class="n">([^<]*)<\/td><td class="n">([^<]*)<\/td><td class="n[^"]*">([^<]*)<\/td><\/tr>/); return m ? { entradas: m[1], salidas: m[2], neto: m[3] } : null; };
const kpiDe = (h, lbl) => { const m = h.match(new RegExp('<div class="lbl">' + lbl + '</div><div class="val">([^<]*)</div>')); return m ? monto(m[1]) : NaN; };
const totalFila = (h, nombre) => { const m = h.match(new RegExp('<tr class="tot"><td>' + nombre + '</td><td class="n">([^<]*)</td><td class="n">([^<]*)</td><td class="n[^"]*">([^<]*)</td>')); return m ? [monto(m[1]), monto(m[2]), monto(m[3])] : null; };
const cifrasFlujo = (h) => ({ ini: kpiDe(h, 'Acumulado al inicio del mes'), ent: kpiDe(h, 'Entradas'), sal: kpiDe(h, 'Salidas'), neto: kpiDe(h, 'Neto del mes'), cierre: kpiDe(h, 'Acumulado al cierre del mes'),
  operativo: totalFila(h, 'Flujo operativo'), inversion: totalFila(h, 'Flujo inversión'), financiamiento: totalFila(h, 'Flujo financiamiento') });

const nuevo = cargar(HTML_RUTA);
const PER_OCT = { desde: '2026-10-01', hasta: '2026-10-31', label: 'Octubre' };

// ── a) Una sola fila de pagos; sin fila ni subtítulo de anticipos ──
{
  const h = nuevo.api.reporte(datos(), '2026-10');
  afirmar((h.match(/<tr><td>Pagos a proveedores/g) || []).length === 1, 'a) existe una sola fila «Pagos a proveedores» en el reporte de octubre');
  afirmar(!/Anticipos a proveedores/.test(h) && !/Anticipos a proveedores/.test(nuevo.texto), 'a) no existe la fila «Anticipos a proveedores» (ni en la salida ni en el HTML)');
  afirmar(!/Pagos con origen anticipo/.test(h) && !/Pagos con origen anticipo/.test(nuevo.texto) && !/movimientos manuales «Anticipo a proveedor»/.test(nuevo.texto), 'a) no existe el subtítulo «Pagos con origen anticipo y movimientos manuales…»');
  const f = filaPagos(h);
  afirmar(!!f && f.entradas === '—', 'a) la fila de pagos es una salida (sin entradas) con el formato de las demás');
}

// ── b) El importe = pagos (sin IVA) + anticipos + anticipos manuales; coincide con el pagado de calc() ──
{
  const db = datos();
  const R = nuevo.api.calc(db, PER_OCT);
  const f = filaPagos(nuevo.api.reporte(db, '2026-10'));
  const esperado = (2320 - 320) + 500 + 300; // pago sin IVA + anticipo completo + anticipo manual
  cerca(monto(f.salidas), esperado, 'b) la fila suma pagos (sin IVA) + anticipos + anticipos manuales');
  cerca(R.pagado, (2320 - 320) + 500, 'b) calc().pagado = pagos sin IVA + anticipos (los manuales no entran a calc().pagado)');
  cerca(monto(f.salidas), R.pagado + 300, 'b) la fila = calc().pagado + anticipos manuales (nada se cuenta dos veces)');
  // Sin anticipos manuales, la fila es exactamente el pagado total de calc() (el que usa P1 de la conciliación)
  const sinMan = datos({ manual: false });
  const Rsm = nuevo.api.calc(sinMan, PER_OCT);
  cerca(monto(filaPagos(nuevo.api.reporte(sinMan, '2026-10')).salidas), Rsm.pagado, 'b) sin anticipos manuales la fila es exactamente calc().pagado');
  afirmar(!/Pagos con origen/.test(nuevo.api.reporte(sinMan, '2026-10')), 'b) sin subtítulo tampoco');
}

// ── c) Un mes sin anticipos muestra solo los pagos ──
{
  const db = datos();
  const R = nuevo.api.calc(db, { desde: '2026-09-01', hasta: '2026-09-30', label: 'Sep' });
  const h = nuevo.api.reporte(db, '2026-09');
  const f = filaPagos(h);
  afirmar(R.anticipos === 0 && !!f, 'c) septiembre no tiene anticipos y la fila existe');
  cerca(monto(f.salidas), 464 - 64, 'c) septiembre: la fila muestra solo el pago sin IVA (400)');
  cerca(monto(f.salidas), R.pagado, 'c) septiembre: la fila = calc().pagado');
  // Sin pagos en el mes (agosto no tiene flujo): no hay fila ni error
  const db2 = datos({ anticipos: false, manual: false }); db2.pagos = [];
  const h2 = nuevo.api.reporte(db2, '2026-10');
  afirmar(filaPagos(h2) === null, 'c) un mes sin pagos ni anticipos no muestra la fila');
}

// ── d) Entradas, salidas, neto, operativo y acumulado iguales a los del respaldo anterior; e) notas fuera ──
const rutaRespaldo = buscarRespaldo();
if (!rutaRespaldo) {
  console.log('Nota: no hay un respaldo index.html.bakNN con la fila «Anticipos a proveedores»; se omite la comparación contra el respaldo.');
} else {
  const viejo = cargar(rutaRespaldo);
  afirmar(/Anticipos a proveedores/.test(viejo.texto) && /Este acumulado mide el efectivo/.test(viejo.texto), `d) el respaldo (${path.basename(rutaRespaldo)}) todavía trae la fila y las notas`);
  ['2026-09', '2026-10'].forEach((mes) => [true, false].forEach((conSocios) => [{}, { manual: false }, { anticipos: false, manual: false }].forEach((o, i) => {
    nuevo.api.setIncluir(conSocios); viejo.api.setIncluir(conSocios);
    const a = cifrasFlujo(nuevo.api.reporte(datos(o), mes)), b = cifrasFlujo(viejo.api.reporte(datos(o), mes));
    afirmar(Object.values(a).every((v) => v !== null && !Number.isNaN(v)), `d) ${mes}: se leyeron entradas, salidas, neto, operativo y acumulados (caso ${i}, socios ${conSocios})`);
    afirmar(JSON.stringify(a) === JSON.stringify(b), `d) ${mes} caso ${i} socios ${conSocios}: entradas, salidas, neto, operativo, inversión, financiamiento y acumulados = respaldo (${JSON.stringify(a.ent)}/${JSON.stringify(b.ent)})`);
  })));
  // La fila fusionada = las dos filas del respaldo sumadas
  const hv = viejo.api.reporte(datos(), '2026-10');
  const sumaVieja = (hv.match(/<tr><td>(?:Pagos|Anticipos) a proveedores[\s\S]*?<\/tr>/g) || []).map((t) => monto((t.match(/<td class="n">([^<]*)<\/td><td class="n">([^<]*)<\/td>/) || [])[2])).reduce((s, x) => s + x, 0);
  cerca(monto(filaPagos(nuevo.api.reporte(datos(), '2026-10')).salidas), sumaVieja, 'd) la fila fusionada = las dos filas del respaldo sumadas');
  // El resto de los importes del reporte son los mismos, número por número
  const numeros = (h) => (h.replace(/<tr><td>(?:Pagos|Anticipos) a proveedores[\s\S]*?<\/tr>/g, '').match(/-?\$[\d,]+\.\d{2}/g) || []);
  ['2026-09', '2026-10'].forEach((mes) => {
    const a = numeros(nuevo.api.reporte(datos(), mes)), b = numeros(viejo.api.reporte(datos(), mes));
    afirmar(a.length > 20 && JSON.stringify(a) === JSON.stringify(b), `d) ${mes}: los mismos ${a.length} importes del reporte (salvo la fila fusionada)`);
  });

  // ── f) calc() devuelve JSON idéntico ──
  const periodos = [PER_OCT, { desde: '2026-09-01', hasta: '2026-09-30', label: 'Sep' }, { desde: '0000-00-00', hasta: '9999-99-99', label: 'Todo' }, { desde: '2026-11-01', hasta: '2026-11-30', label: 'Nov' }];
  let n = 0;
  [false, true].forEach((s) => periodos.forEach((per) => {
    nuevo.api.setIncluir(s); viejo.api.setIncluir(s);
    const a = nuevo.api.calc(datos(), per), b = viejo.api.calc(datos(), per);
    n++;
    afirmar(JSON.stringify(a) === JSON.stringify(b) && Object.keys(a).length > 40, `f) calc() devuelve JSON idéntico de los ${Object.keys(a).length} R.* (${per.label}, socios ${s ? 'incluidos' : 'excluidos'})`);
  }));
  afirmar(n === 8, 'f) se compararon 8 corridas de calc()');
}

// ── e) Las cinco notas ya no existen; siguen el chip, la nota del flujo y los avisos de control ──
{
  const CINCO = [
    ['a) acumulado', 'Este acumulado mide el efectivo generado o consumido desde el'],
    ['b) CxP roll-forward', 'Se usa el total de cada cuenta tal cual'],
    ['c) exposición neta CxP', 'El saldo a favor suma los movimientos no revertidos con fecha hasta el corte'],
    ['d) CxC roll-forward', 'Roll-forward con abonos y fechas, no con el campo saldo de hoy'],
    ['d) CxC base sin IVA', 'Las cuentas por cobrar no se filtran por el interruptor de socios'],
    ['e) exposición neta CxC', 'Suma los movimientos no revertidos con fecha hasta el corte']
  ];
  const salidas = [nuevo.api.reporte(datos(), '2026-10'), nuevo.api.reporte(datos(), '2026-09'), nuevo.api.reporte(datos({ ivaCxp: 50 }), '2026-10')];
  CINCO.forEach(([n, frag]) => {
    afirmar(!nuevo.texto.includes(frag), `e) ${n}: el texto ya no existe en el HTML`);
    afirmar(salidas.every((h) => !h.includes(frag)), `e) ${n}: ya no sale en el reporte mensual`);
  });
  afirmar(!/Exposición neta = saldo C[xP]/.test(nuevo.texto), 'e) las notas de la exposición neta (CxP y CxC) se borraron completas');
  const h = salidas[0];
  afirmar(/<span class="pill (ok|warn)">Importes: material de socios (incluido|excluido)<\/span>/.test(h) && /<h2>3 · Cuentas por pagar/.test(h), 'e) sigue el chip «Importes: material de socios incluido/excluido»');
  nuevo.api.setIncluir(true);
  afirmar(/Importes: material de socios incluido/.test(nuevo.api.reporte(datos(), '2026-10')), 'e) el chip cambia a «incluido» con el interruptor');
  nuevo.api.setIncluir(false);
  afirmar(/Importes: material de socios excluido/.test(nuevo.api.reporte(datos(), '2026-10')), 'e) y a «excluido» sin él');
  afirmar(salidas.every((x) => x.includes('El flujo es efectivo de todos los proveedores y clientes: el interruptor «Incluir material de socios» no lo afecta.')), 'e) sigue la nota del flujo que dice que el interruptor no lo afecta');
  afirmar(/class="warnbar"/.test(nuevo.texto) && /El puente no cuadra por/.test(nuevo.texto) && /no coinciden con las compras del tablero/.test(nuevo.texto) && /no coincide con las ventas del tablero/.test(nuevo.texto) && /no coinciden con los cobros ligados por cxcId/.test(nuevo.texto) && /con saldo negativo o menor a un centavo/.test(nuevo.texto), 'e) siguen todos los avisos de control en el código');
  afirmar(/<div class="warnbar">[^<]*IVA distinto de 0/.test(salidas[2]), 'e) un aviso de control se sigue mostrando (cuenta del mes con IVA distinto de 0)');
  afirmar(/No se pudo leer la colección «proveedores»/.test(nuevo.texto) && /No se pudo leer la colección «clientes»/.test(nuevo.texto), 'e) siguen los avisos de colección ilegible');
  afirmar(/Reporte mensual para socios/.test(h) && /Todos los importes son sin impuestos/.test(h), 'e) el encabezado del reporte y su «Todos los importes son sin impuestos» siguen');
}

console.log(`${ok}/${total} comprobaciones correctas`);
if (ok !== total) process.exitCode = 1;
