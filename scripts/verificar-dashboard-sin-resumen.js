// Dashboard Ejecutivo sin la pestaña Resumen: ya no existen su botón, su panel, rResumen() ni la gráfica de tendencia; la pestaña inicial es
// el Reporte mensual y el orden es Reporte mensual, Materiales, Ventas, (Inventario), Por pagar, Por cobrar, (Punto de equilibrio).
// calc() y todos los campos R.* no cambian: se compara contra el respaldo anterior (el último index.html.bakNN que todavía trae rResumen).
// Sin navegador: extracción por texto de dashboard-ejecutivo/index.html y vm (mismo método que verificar-paridad-sin-iva.js).
//
// Uso: node scripts/verificar-dashboard-sin-resumen.js [ruta/index.html] [ruta/respaldo-con-Resumen]   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const CARPETA = path.join(RAIZ, '..', 'dashboard-ejecutivo');
const HTML_RUTA = path.resolve(process.argv[2] || path.join(CARPETA, 'index.html'));
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
if (!fs.existsSync(HTML_RUTA)) { console.error('No existe ' + HTML_RUTA); process.exit(1); }
const html = fs.readFileSync(HTML_RUTA, 'utf8');

// Respaldo con Resumen: el pasado por argumento o el bakNN más alto que aún traiga rResumen()
function buscarRespaldo() {
  if (process.argv[3]) return path.resolve(process.argv[3]);
  const nums = fs.readdirSync(CARPETA).map((f) => (f.match(/^index\.html\.bak(\d+)$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => b - a);
  for (const n of nums) {
    const r = path.join(CARPETA, 'index.html.bak' + n);
    if (/function rResumen\(/.test(fs.readFileSync(r, 'utf8'))) return r;
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

// ── 1. Lo que ya no existe ──
afirmar(!/data-p="resumen"/.test(html), '1) ya no existe el botón de pestaña Resumen');
afirmar(!/id="p-resumen"/.test(html) && !/p-resumen/.test(html), '1) ya no existe el panel p-resumen ni referencia a él');
afirmar(!/rResumen/.test(html), '1) ya no existe rResumen() ni su llamada');
afirmar(!/chTend/.test(html), '1) no queda ninguna referencia al canvas de tendencia (chTend)');
afirmar(!/Tendencia últimos 6 meses|📊 Resumen/.test(html), '1) no queda el título de la tendencia ni la etiqueta de la pestaña');
afirmar(!/<canvas id="chTend"/.test(html) && ![...html.matchAll(/chart\('(\w+)'/g)].some((m) => m[1] === 'chTend'), '1) ninguna gráfica de tendencia se crea con chart()');

// ── 2. Pestañas: orden y pestaña inicial ──
const nav = (html.match(/<nav id="nav">([\s\S]*?)<\/nav>/) || ['', ''])[1];
const botones = [...nav.matchAll(/<button data-p="(\w+)"([^>]*)>/g)].map((m) => ({ p: m[1], on: /class="on"/.test(m[2]) }));
afirmar(botones.map((b) => b.p).join(',') === 'reporte,materiales,ventas,inventario,cxp,cxc,pe', `2) orden de pestañas: Reporte mensual, Materiales, Ventas, (Inventario), Por pagar, Por cobrar, (Punto de equilibrio): ${botones.map((b) => b.p).join(',')}`);
afirmar(botones.filter((b) => b.on).map((b) => b.p).join() === 'reporte', '2) la única pestaña activa al abrir es Reporte mensual');
const paneles = [...html.matchAll(/<section class="panel( on)?" id="p-(\w+)"/g)].map((m) => ({ id: m[2], on: !!m[1] }));
afirmar(paneles.map((p) => p.id).join(',') === 'reporte,materiales,ventas,inventario,cxp,cxc,pe', '2) los paneles siguen el mismo orden: ' + paneles.map((p) => p.id).join(','));
afirmar(paneles.filter((p) => p.on).map((p) => p.id).join() === 'reporte', '2) el único panel visible al abrir es el Reporte mensual');
afirmar(botones.every((b) => paneles.some((p) => p.id === b.p)), '2) cada botón tiene su panel');
// Inventario y Punto de equilibrio siguen ocultos por sus banderas
afirmar(/const MOSTRAR_INVENTARIO\s*=\s*false/.test(html) && /const MOSTRAR_PUNTO_EQUILIBRIO\s*=\s*false/.test(html), '2) Inventario y Punto de equilibrio siguen apagados por sus banderas');
afirmar(/data-p="inventario"[^;]*bi\.hidden=true|bi\.hidden=true/.test(html) && /be\.hidden=true/.test(html), '2) siguen ocultándose los botones de Inventario y Punto de equilibrio');
// No se restaura la última pestaña: nada la guarda ni la lee y nadie llama a showTab al arrancar
afirmar(!/(localStorage|sessionStorage)\.(setItem|getItem)\(\s*['"][^'"]*(tab|pesta|panel)[^'"]*['"]/i.test(html), '2) la pestaña usada no se guarda ni se lee de localStorage o sessionStorage');
afirmar(!/location\.(hash|search)|URLSearchParams|history\.(pushState|replaceState)/.test(html), '2) la pestaña tampoco viene de la URL');
const llamadasShowTab = [...html.matchAll(/showTab\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => a !== 'p' && a !== 'b.dataset.p');
afirmar(llamadasShowTab.every((a) => a === "'pe'"), `2) showTab solo se invoca con 'pe' (botones de Punto de equilibrio) y desde el menú: ${JSON.stringify(llamadasShowTab)}`);

// ── 3. Selector de periodo, interruptor de socios e Imprimir siguen en el encabezado ──
afirmar(/id="selPeriodo"/.test(html) && /id="chkSocios"/.test(html) && /onclick="imprimirConGraficas\(\)"/.test(html), '3) siguen el selector de periodo, el interruptor de socios y el botón Imprimir');
afirmar(/\['selPeriodo','fDesde','fHasta'\]\.forEach\(id=>\$\(id\)\.onchange=\(\)=>renderAll\(\)\)/.test(html), '3) el selector de periodo sigue recalculando con renderAll');

// ── 4. renderAll, calc() y el reporte mensual ──
const LINEAS = ['num', 'fmt\\$', 'fmt\\$2', 'fmtN', 'fmtPct', 'esc', 'iso', 'fdate', 'norm', 'MATERIALES_ALIAS', 'normMat', 'PROVEEDORES_SOCIOS', 'limpiaSocio', 'sum', 'MESES', 'MESES_L', 'UNIDAD_PZ',
  'dayDiff', 'inP', 'tipoNormG', 'rmM', 'dia10', 'diaAnterior', 'verSocioG', 'esSaldoInicialCta', 'FLUJO_INICIO', 'subtotalCxc', 'baseCxc', 'INCLUIR_SOCIOS'];
const FUNCS = ['esProveedorSocio', 'incluirSocios', 'grp', 'aging', 'calc', 'abonosVigentesAl', 'cxpAlCorteDet', 'abonosCxcAl', 'cxcAlCorteDet', 'puenteCxPMes', 'puenteCxCMes',
  'autopruebaCxP', 'autopruebaCxC', 'rmFilasRubro', 'rmTablaRubro', 'rmBloqueCxP', 'rmBloqueCxC', 'rReporteMensual', 'renderAll', 'calcPeriodo', 'mesAnteriorISO'];

const vacio = () => ({ cxp: [], cxc: [], ventas: [], destaraje: [], cobros: [], pagos: [], gastos: [], flujo: [], precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [] });
function datosSinteticos() {
  const d = vacio();
  d.destaraje = [{ id: 'd1', ticket: '1001', proveedor: 'PROV A', material: 'P.P MOLIDO', kg: 700, fechaSalida: '2026-10-05' }, { id: 'd2', ticket: '1002', proveedor: 'GERMAN', material: 'PET', kg: 300, fechaSalida: '2026-10-06' },
    { id: 'd3', ticket: '1003', proveedor: 'PROV B', material: 'BIDON', kg: 120, fechaSalida: '2026-10-07' }, { id: 'd4', ticket: '1004', proveedor: 'PROV B', material: 'GARRAFA', kg: 30, fechaSalida: '2026-09-20' }];
  d.cxp = [{ id: 'x1', ticket: '1001', proveedor: 'PROV A', material: 'P.P MOLIDO', kg: 700, total: 3500, saldo: 1500, fechaTicket: '2026-10-05', abonos: [{ monto: 2000, fecha: '2026-10-10' }] },
    { id: 'x2', ticket: '1002', proveedor: 'GERMAN', material: 'PET', kg: 300, total: 1800, saldo: 1800, fechaTicket: '2026-10-06', abonos: [] },
    { id: 'x3', ticket: '1003', proveedor: 'PROV B', material: 'BIDON', kg: 120, total: 700, saldo: 700, fechaTicket: '2026-10-07', abonos: [] },
    { id: 'x4', proveedor: 'PROV C', tipo: 'saldo_inicial', material: 'PET', kg: 0, total: 900, saldo: 900, fechaTicket: '2026-09-01', abonos: [] }];
  d.ventas = [{ id: 'v1', folio: 'V-1', fecha: '2026-10-03', cliente: 'C1', lineas: [{ material: 'PET MOLIDO', cantidad: 1000, unidad: 'KG', precioUnitario: 10, subtotal: 10000, ivaTrasladado: 1600, totalLinea: 11600 }, { material: 'CAJA CO30', cantidad: 5, precioUnitario: 100, ivaTrasladado: 80, totalLinea: 580 }] },
    { id: 'v2', folio: 'V-2', fecha: '2026-09-15', cliente: 'C2', lineas: [{ material: 'P.P MOLIDO', cantidad: 400, unidad: 'KG', precioUnitario: 12, subtotal: 4800, ivaTrasladado: 0, ivaRetenido: 0, totalLinea: 4800 }] }];
  d.cxc = [{ id: 'c1', folio: 'V-1', cliente: 'C1', fechaVenta: '2026-10-03', subtotal: 10500, total: 12180, ivaTrasladado: 1680, saldo: 6090, cobrado: 6090, abonos: [{ monto: 6090, fecha: '2026-10-20' }] },
    { id: 'c2', folio: 'V-2', cliente: 'C2', fechaVenta: '2026-09-15', subtotal: 4800, total: 4800, saldo: 4800, cobrado: 0, abonos: [] }];
  d.cobros = [{ id: 'k1', cxcId: 'c1', cliente: 'C1', pagado: 6090, iva: 840, fecha: '2026-10-20', origen: 'cxc_cobro' }, { id: 'k2', cliente: 'C3', pagado: 2000, fecha: '2026-10-22', origen: 'anticipo' },
    { id: 'k3', cxcId: 'c2', cliente: 'C2', pagado: 100, fecha: '2026-10-23', revertido: true }];
  d.pagos = [{ id: 'p1', proveedor: 'PROV A', pagado: 2000, iva: 0, fecha: '2026-10-10', origen: 'pago' }, { id: 'p2', proveedor: 'PROV B', pagado: 500, iva: 0, fecha: '2026-10-11', origen: 'anticipo' },
    { id: 'p3', proveedor: 'PROV A', pagado: 99, fecha: '2026-10-12', revertido: true }];
  d.gastos = [{ id: 'g1', fecha: '2026-10-12', concepto: 'Renta', beneficiario: 'ARR', montoBase: 700, total: 812, iva: 112, tipoGasto: 'operativo' }, { id: 'g2', fecha: '2026-10-14', concepto: 'Maquina', montoBase: 400, tipoGasto: 'inversion' },
    { id: 'g3', fecha: '2026-10-15', concepto: 'Credito', montoBase: 250, tipoGasto: 'financiamiento' }, { id: 'g4', fecha: '2026-09-12', concepto: 'Luz', montoBase: 150, clasificacion: 'fijo' }];
  d.flujo = [{ id: 'm1', tipo: 'Saldo inicial', fecha: '2026-09-01', importe: 10000 }, { id: 'm2', tipo: 'Aportación o préstamo', fecha: '2026-10-15', importe: 2000 }, { id: 'm3', tipo: 'Anticipo a proveedor', fecha: '2026-10-16', importe: 300 },
    { id: 'm4', tipo: 'Inversión en activo', fecha: '2026-10-17', importe: 450 }, { id: 'm5', tipo: 'Otra salida', fecha: '2026-10-18', importe: 60 }];
  d.precios = [{ material: 'PET', fechaInicio: '2026-01-01', fechaFin: null, precio: 6 }];
  d.invIni = [{ id: 'i1', material: 'PET', kg: 100, etapa: 'x' }]; d.inv = [{ id: 'j1', material: 'PET', ajusteNeto: 5, etapa: 'x' }];
  d.prod = [{ id: 'q1', ticket: 'P1', inputs: [{ material: 'PET', kg: 20 }], outputs: [{ material: 'PET MOLIDO', kg: 18 }, { material: 'MERMA', kg: 2, esMerma: true }] }];
  d.proveedores = [{ id: 'PROV A', nombre: 'PROV A', saldoAFavor: [{ monto: 100, fecha: '2026-10-01' }] }]; d.clientes = [{ id: 'C1', saldoAFavor: [{ monto: 50, fecha: '2026-10-01' }] }];
  return d;
}

function cargar(ruta, elementos) {
  const texto = fs.readFileSync(ruta, 'utf8');
  const { funcion, linea } = extraer(texto);
  const lineas = LINEAS.map(linea).filter(Boolean), funcs = FUNCS.map(funcion).filter(Boolean);
  const kpiLinea = (texto.match(/^function kpi\(.*$/m) || [''])[0];
  const peCalcTxt = funcion('peCalc'), peParamsTxt = funcion('peParams');
  const llamadas = [];
  const ctx = {
    console: { warn() {}, info() {}, error() {}, log() {}, table() {} }, localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    $: (id) => elementos[id] || (elementos[id] = { value: '', innerHTML: '', checked: false, style: {} }), barRow: () => '', COL_FALLAS: [], llamadas,
    chart: (id) => llamadas.push('chart:' + id)
  };
  ['rMateriales', 'rVentas', 'rInventario', 'rCxP', 'rCxC', 'rPE', 'rResumen'].forEach((n) => { ctx[n] = () => llamadas.push(n); });
  vm.createContext(ctx);
  vm.runInContext(`
    const HOY = '2026-11-10'; let DB = null, PER = { desde: '', hasta: '', label: '' }, R = null;
    const MOSTRAR_INVENTARIO = false, MOSTRAR_PUNTO_EQUILIBRIO = false;
    ${lineas.filter((l) => !/^let INCLUIR_SOCIOS/.test(l)).join('\n')}
    let INCLUIR_SOCIOS = false;
    let COL_FALLAS = [];
    ${kpiLinea}
    ${funcs.join('\n')}
    ${peCalcTxt}\n${peParamsTxt}
    globalThis.api = { set(db) { DB = db; }, getR: () => R, getPER: () => PER, setPER: (p) => { PER = p; }, calc: (db, per) => { DB = db; PER = per; return (R = calc()); }, renderAll: () => renderAll(),
      reporte: (mes) => { $('rmMes').value = mes; rReporteMensual(); return $('rmCuerpo').innerHTML; }, setIncluir: (v) => { INCLUIR_SOCIOS = v; }, tienePeCalc: typeof peCalc === 'function' };
  `, ctx);
  return { api: ctx.api, ctx, llamadas, texto };
}

const el = { selPeriodo: { value: 'todo' }, rangoBox: { style: {} }, fDesde: { value: '' }, fHasta: { value: '' }, chkSocios: { checked: false }, tagSocios: { style: {} }, rmMes: { value: '' }, rmCuerpo: { innerHTML: '' } };
const actual = cargar(HTML_RUTA, el);
afirmar(actual.api.tienePeCalc, '4) peCalc() sigue existiendo (lo usa la pestaña de punto de equilibrio)');
actual.api.set(datosSinteticos());
let error = null;
try { actual.api.renderAll(); } catch (e) { error = e; }
afirmar(!error, '4) renderAll() no lanza errores con datos sintéticos' + (error ? ': ' + error.message : ''));
afirmar(!actual.llamadas.includes('rResumen'), '4) renderAll() ya no llama a rResumen');
afirmar(['rMateriales', 'rVentas', 'rCxP', 'rCxC'].every((n) => actual.llamadas.includes(n)) && !actual.llamadas.includes('rInventario') && !actual.llamadas.includes('rPE'), '4) renderAll() sigue armando Materiales, Ventas, Por pagar y Por cobrar (Inventario y Punto de equilibrio apagados)');
afirmar(!actual.llamadas.some((l) => l === 'chart:chTend'), '4) renderAll() no crea la gráfica de tendencia');
afirmar(/Reporte mensual para socios/.test(el.rmCuerpo.innerHTML), '4) renderAll() sigue armando el Reporte mensual');

// El selector de periodo: cambia R (Materiales, Ventas, Por pagar, Por cobrar) y el reporte mensual no lo altera
{
  const per = { desde: '2026-10-01', hasta: '2026-10-31', label: 'Octubre' };
  actual.api.calc(datosSinteticos(), per);
  const antes = JSON.stringify(actual.api.getR());
  const perAntes = actual.api.getPER();
  actual.api.reporte('2026-09');
  afirmar(actual.api.getPER() === perAntes && JSON.stringify(actual.api.getR()) === antes, '3) el Reporte mensual no depende del selector de periodo y deja intactos PER y R');
  const R1 = actual.api.calc(datosSinteticos(), { desde: '2026-09-01', hasta: '2026-09-30', label: 'Sep' });
  const R2 = actual.api.calc(datosSinteticos(), per);
  afirmar(R1.ventasMonto !== R2.ventasMonto && R1.kgBascula !== R2.kgBascula, '3) el selector de periodo sigue cambiando las cifras de las demás pestañas (ventas y kg distintos entre septiembre y octubre)');
}

// ── 5. calc() y los R.* no cambian contra el respaldo con Resumen ──
const rutaRespaldo = buscarRespaldo();
if (!rutaRespaldo) {
  console.log('Nota: no hay un respaldo index.html.bakNN con rResumen(); se omite la comparación de calc() contra el respaldo.');
} else {
  const viejo = cargar(rutaRespaldo, Object.assign({}, el, { rmMes: { value: '' }, rmCuerpo: { innerHTML: '' } }));
  afirmar(/function rResumen\(/.test(viejo.texto), `5) el respaldo (${path.basename(rutaRespaldo)}) todavía trae rResumen`);
  const periodos = [{ desde: '2026-10-01', hasta: '2026-10-31', label: 'Oct' }, { desde: '2026-09-01', hasta: '2026-09-30', label: 'Sep' }, { desde: '0000-00-00', hasta: '9999-99-99', label: 'Todo' }, { desde: '2026-11-01', hasta: '2026-11-30', label: 'Nov' }];
  let comparados = 0, campos = 0;
  [false, true].forEach((socios) => periodos.forEach((per) => {
    actual.api.setIncluir(socios); viejo.api.setIncluir(socios);
    const a = actual.api.calc(datosSinteticos(), per), b = viejo.api.calc(datosSinteticos(), per);
    const ja = JSON.stringify(a), jb = JSON.stringify(b);
    comparados++; campos = Object.keys(a).length;
    afirmar(ja === jb, `5) calc() entrega los mismos R.* (${Object.keys(a).length} campos) con socios ${socios ? 'incluidos' : 'excluidos'} y periodo ${per.label}`);
    afirmar(Object.keys(a).sort().join() === Object.keys(b).sort().join(), `5) mismos campos R.* (${per.label}, socios ${socios})`);
    ['PET', 'P.P. MOLIDO', 'BIDON'].forEach((m) => afirmar(a.precioMat(m) === b.precioMat(m), `5) R.precioMat('${m}') igual (${per.label}, socios ${socios})`));
  }));
  afirmar(comparados === 8 && campos > 40, `5) se compararon ${comparados} corridas de calc() con ${campos} campos R.*`);
  // Mismas campos que usan las demás pestañas y el Reporte mensual
  actual.api.setIncluir(false); viejo.api.setIncluir(false);
  ['2026-09', '2026-10'].forEach((mes) => {
    const a = actual.api.reporte(mes), b = viejo.api.reporte(mes);
    afirmar(a === b && a.length > 1000, `5) el Reporte mensual de ${mes} sale idéntico (${a.length} caracteres)`);
  });
}

console.log(`${ok}/${total} comprobaciones correctas`);
if (ok !== total) process.exitCode = 1;
