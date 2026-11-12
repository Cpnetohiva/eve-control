// Dashboard Ejecutivo (A13): el selector de periodo del encabezado (y sus campos de rango de fechas) solo se muestra en las pestañas que lo usan
// (Materiales, Ventas, Por pagar, Por cobrar, y Inventario / Punto de equilibrio si se encienden) y se oculta en el Reporte mensual, que tiene su propio
// selector de mes. Se oculta con la clase body.sin-periodo (sin quitar el elemento ni cambiar su valor).
// Sin navegador: extracción por texto de dashboard-ejecutivo/index.html y vm (mismo método que verificar-paridad-sin-iva.js).
//
// Uso: node scripts/verificar-selector-periodo.js [ruta/index.html] [ruta/respaldo-anterior]   (código de salida 1 si algo falla)
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

// Respaldo anterior: el bakNN más alto cuyo showTab todavía no maneja la clase sin-periodo
function buscarRespaldo() {
  if (process.argv[3]) return path.resolve(process.argv[3]);
  const nums = fs.readdirSync(CARPETA).map((f) => (f.match(/^index\.html\.bak(\d+)$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => b - a);
  for (const n of nums) {
    const r = path.join(CARPETA, 'index.html.bak' + n);
    if (!/sin-periodo/.test(fs.readFileSync(r, 'utf8'))) return r;
  }
  return null;
}
const extraer = (texto) => ({
  funcion(nombre) {
    const ini = texto.indexOf('function ' + nombre + '(');
    if (ini < 0) return '';
    let i = texto.indexOf('{', ini), nivel = 0;
    for (; i < texto.length; i++) {
      if (texto[i] === '{') nivel++;
      else if (texto[i] === '}' && --nivel === 0) return texto.slice(ini, i + 1);
    }
    return '';
  },
  linea(n) { const m = texto.match(new RegExp('^(?:const|let) ' + n + '\\s*=.*$', 'm')); return m ? m[0] : ''; }
});

// ── 1. HTML y CSS ──
const body = (html.match(/<body([^>]*)>/) || ['', ''])[1];
afirmar(/class="sin-periodo"/.test(body), 'a) el HTML arranca con body.sin-periodo (la pestaña inicial es el Reporte mensual)');
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
const regla = css.match(/body\.sin-periodo\s+([^{]+)\{([^}]*)\}/);
afirmar(!!regla, 'a) existe la regla CSS body.sin-periodo …');
const oculta = regla ? regla[1].split(',').map((x) => x.trim().replace(/^body\.sin-periodo\s*/, '')) : [];
afirmar(regla && regla[2].includes('display:none!important'), 'a) la regla oculta con display:none!important (gana al display en línea de #rangoBox)');
afirmar(oculta.sort().join() === '#rangoBox,#selPeriodo' || (regla && /body\.sin-periodo #selPeriodo\s*,\s*body\.sin-periodo #rangoBox/.test(regla[0] + ',' + css.slice(css.indexOf(regla[0]) - 40, css.indexOf(regla[0])))), 'a) la regla afecta solo a #selPeriodo y #rangoBox');
const reglasPeriodo = [...css.matchAll(/body\.sin-periodo[^{]*\{/g)].map((m) => m[0]);
afirmar(reglasPeriodo.every((r) => /#selPeriodo|#rangoBox/.test(r)) && !/body\.sin-periodo[^{]*(chkSocios|tagSocios|btnRef|btnSalir|\.btn|button|header|\.hrow)/.test(css), 'f) ninguna regla sin-periodo toca el interruptor de socios, Actualizar, Imprimir, Salir ni el resto del encabezado');
// Los elementos siguen en el HTML (no se quitan) y su valor no se toca
afirmar(/<select id="selPeriodo">/.test(html) && /id="rangoBox"/.test(html) && /id="fDesde"/.test(html) && /id="fHasta"/.test(html), 'd) el selector y los campos de rango siguen existiendo en el HTML (solo se ocultan)');
afirmar(!/selPeriodo['"]?\)?\.(remove|parentNode|outerHTML)|selPeriodo[^;\n]*\.value\s*=[^=]/.test(html), 'd) ningún código quita el selector ni le asigna un valor');
// Los controles que no dependen del periodo no tienen clase ni atributo que los oculte
const ctl = (id) => (html.match(new RegExp('<[^>]*id="' + id + '"[^>]*>')) || [''])[0];
['chkSocios', 'btnRef', 'btnSalir'].forEach((id) => afirmar(!!ctl(id) && !/hidden|sin-periodo|display:\s*none/.test(ctl(id)), `f) #${id} no se oculta en el HTML`));
afirmar(/<button class="btn ghost" onclick="imprimirConGraficas\(\)">🖨 Imprimir<\/button>/.test(html), 'f) el botón Imprimir sigue en el encabezado sin atributos de ocultación');
// Impresión: el bloque de controles del encabezado es .noprint (no se imprime) y el selector tampoco aparece
afirmar(/<div class="hrow noprint" style="gap:8px">\s*<select id="selPeriodo">/.test(html), 'g) el selector vive dentro del bloque .noprint del encabezado');
afirmar(/@media print\s*\{[\s\S]*?\.noprint[\s\S]*?display:none!important/.test(css), 'g) en @media print .noprint y los botones se ocultan: Imprimir no muestra el selector');

// ── 2. showTab en vm con un DOM mínimo ──
function cargar(ruta) {
  const texto = fs.readFileSync(ruta, 'utf8');
  const { funcion } = extraer(texto);
  const showTab = funcion('showTab');
  afirmar(!!showTab, `${path.basename(ruta)}: se extrajo showTab`);
  const clases = new Set(/class="sin-periodo"/.test((texto.match(/<body([^>]*)>/) || ['', ''])[1]) ? ['sin-periodo'] : []);
  const PESTANAS = ['reporte', 'materiales', 'ventas', 'inventario', 'cxp', 'cxc', 'pe'];
  const botones = PESTANAS.map((p) => ({ dataset: { p }, on: false, classList: { toggle(c, v) { this.dueno.on = !!v; }, dueno: null } }));
  botones.forEach((b) => { b.classList.dueno = b; });
  const paneles = PESTANAS.map((p) => ({ id: 'p-' + p, on: false, classList: { toggle(c, v) { this.dueno.on = !!v; }, dueno: null } }));
  paneles.forEach((b) => { b.classList.dueno = b; });
  const ctx = {
    MOSTRAR_PUNTO_EQUILIBRIO: false, charts: {},
    document: {
      body: { classList: { toggle(c, v) { if (v === undefined) v = !clases.has(c); if (v) clases.add(c); else clases.delete(c); }, add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c) } },
      querySelectorAll: (sel) => (sel === 'nav button' ? botones : sel === '.panel' ? paneles : [])
    }
  };
  vm.createContext(ctx);
  vm.runInContext(showTab + ';globalThis.showTab = showTab;', ctx);
  return { showTab: ctx.showTab, clases, botones, paneles, visible: () => !clases.has('sin-periodo'), activa: () => (botones.find((b) => b.on) || {}).dataset && botones.find((b) => b.on).dataset.p };
}
const A = cargar(HTML_RUTA);
// a) al arrancar
afirmar(A.visible() === false, 'a) al arrancar el selector de periodo está oculto (body.sin-periodo)');
const navActivo = (html.match(/<nav id="nav">([\s\S]*?)<\/nav>/) || ['', ''])[1].match(/<button data-p="(\w+)" class="on">/);
afirmar(navActivo && navActivo[1] === 'reporte' && /<section class="panel on" id="p-reporte">/.test(html), 'a) la pestaña activa al arrancar es Reporte mensual');
// b) pestañas que lo usan
['materiales', 'ventas', 'cxp', 'cxc'].forEach((p) => {
  A.showTab(p);
  afirmar(A.visible() === true && A.activa() === p, `b) showTab('${p}') muestra el selector de periodo`);
  afirmar(A.paneles.find((x) => x.id === 'p-' + p).on && !A.paneles.find((x) => x.id === 'p-reporte').on, `b) y activa su panel (${p})`);
});
// c) el reporte mensual lo oculta
A.showTab('reporte');
afirmar(A.visible() === false && A.activa() === 'reporte', "c) showTab('reporte') oculta el selector");
A.showTab('ventas'); A.showTab('reporte');
afirmar(A.visible() === false, 'c) ocultarlo es repetible: Ventas → Reporte mensual lo oculta otra vez');
// pestañas ocultas por bandera: showTab('pe') no hace nada (mantiene el estado)
A.showTab('cxp'); A.showTab('pe');
afirmar(A.activa() === 'cxp' && A.visible() === true, "b) showTab('pe') con el punto de equilibrio apagado no cambia nada");

// d) el valor de PER se conserva entre cambios de pestaña: showTab no toca PER ni el valor del selector
{
  const el = { selPeriodo: { value: 'anio' }, fDesde: { value: '2026-03-01' }, fHasta: { value: '2026-03-31' } };
  const antes = JSON.stringify(el);
  const B = cargar(HTML_RUTA);
  ['materiales', 'reporte', 'ventas', 'cxp', 'reporte', 'cxc', 'materiales'].forEach((p) => B.showTab(p));
  afirmar(JSON.stringify(el) === antes, 'd) el periodo elegido (valor del selector y fechas) se conserva tras cambiar de pestaña varias veces');
  afirmar(!/showTab[\s\S]{0,400}(selPeriodo|PER\s*=)/.test(extraer(html).funcion('showTab')), 'd) showTab no lee ni asigna el selector ni PER');
}

// ── 3. calc() y el Reporte mensual no cambian contra el respaldo anterior ──
const LINEAS = ['num', 'fmt\\$', 'fmt\\$2', 'fmtN', 'fmtPct', 'esc', 'iso', 'fdate', 'norm', 'MATERIALES_ALIAS', 'normMat', 'PROVEEDORES_SOCIOS', 'limpiaSocio', 'sum', 'MESES', 'MESES_L', 'UNIDAD_PZ',
  'dayDiff', 'inP', 'tipoNormG', 'rmM', 'dia10', 'diaAnterior', 'verSocioG', 'esSaldoInicialCta', 'FLUJO_INICIO', 'subtotalCxc', 'baseCxc', 'INCLUIR_SOCIOS'];
const FUNCS = ['esProveedorSocio', 'incluirSocios', 'grp', 'aging', 'calc', 'abonosVigentesAl', 'cxpAlCorteDet', 'abonosCxcAl', 'ventaDeCuentaCxc', 'descuentosCxcAl', 'descuentosCxcMonto', 'descuentoLineaVenta', 'subNetoLineaVenta', 'cxcAlCorteDet', 'puenteCxPMes', 'puenteCxCMes',
  'rmFilasRubro', 'rmTablaRubro', 'rmBloqueCxP', 'rmBloqueCxC', 'rReporteMensual', 'mesAnteriorISO'];
function cargarCalculo(ruta) {
  const texto = fs.readFileSync(ruta, 'utf8');
  const { funcion, linea } = extraer(texto);
  const lineas = LINEAS.map(linea).filter(Boolean), funcs = FUNCS.map(funcion).filter(Boolean);
  const kpiLinea = (texto.match(/^function kpi\(.*$/m) || [''])[0];
  const el = {};
  const ctx = { console: { warn() {}, info() {}, error() {}, log() {}, table() {} }, localStorage: { getItem: () => null, removeItem() {} }, $: (id) => el[id] || (el[id] = { value: '', innerHTML: '' }), barRow: () => '', COL_FALLAS: [] };
  vm.createContext(ctx);
  vm.runInContext(`
    const HOY = '2026-11-10'; let DB = null, PER = { desde: '', hasta: '', label: '' }, R = null;
    ${lineas.filter((l) => !/^let (COL_FALLAS|INCLUIR_SOCIOS)/.test(l)).join('\n')}
    let INCLUIR_SOCIOS = false; let COL_FALLAS = [];
    ${kpiLinea}
    ${funcs.join('\n')}
    globalThis.api = { calc: (db, per) => { DB = db; PER = per; return (R = calc()); }, setIncluir: (v) => { INCLUIR_SOCIOS = v; }, getPER: () => PER,
      reporte: (db, mes) => { DB = db; $('rmMes').value = mes; rReporteMensual(); return $('rmCuerpo').innerHTML; } };
  `, ctx);
  return ctx.api;
}
const vacio = () => ({ cxp: [], cxc: [], ventas: [], destaraje: [], cobros: [], pagos: [], gastos: [], flujo: [], precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [] });
function datos() {
  const d = vacio();
  d.destaraje = [{ id: 'd1', ticket: '1001', proveedor: 'PROV A', material: 'P.P MOLIDO', kg: 700, fechaSalida: '2026-10-05' }, { id: 'd2', ticket: '1002', proveedor: 'GERMAN', material: 'PET', kg: 300, fechaSalida: '2026-09-06' }];
  d.cxp = [{ id: 'x1', ticket: '1001', proveedor: 'PROV A', material: 'P.P MOLIDO', kg: 700, total: 3500, saldo: 1500, fechaTicket: '2026-10-05', abonos: [{ monto: 2000, fecha: '2026-10-10' }] },
    { id: 'x2', ticket: '1002', proveedor: 'GERMAN', material: 'PET', kg: 300, total: 1800, saldo: 1800, fechaTicket: '2026-09-06', abonos: [] }];
  d.ventas = [{ id: 'v1', folio: 'V-1', fecha: '2026-10-03', cliente: 'C1', lineas: [{ material: 'PET MOLIDO', cantidad: 1000, unidad: 'KG', precioUnitario: 10, subtotal: 10000, ivaTrasladado: 1600, totalLinea: 11600 }] },
    { id: 'v2', folio: 'V-2', fecha: '2026-09-15', cliente: 'C2', lineas: [{ material: 'PET MOLIDO', cantidad: 400, unidad: 'KG', precioUnitario: 12, subtotal: 4800, totalLinea: 4800 }] }];
  d.cxc = [{ id: 'c1', folio: 'V-1', cliente: 'C1', fechaVenta: '2026-10-03', subtotal: 10000, total: 11600, ivaTrasladado: 1600, saldo: 5800, cobrado: 5800, abonos: [{ monto: 5800, fecha: '2026-10-20' }] }];
  d.cobros = [{ id: 'k1', cxcId: 'c1', cliente: 'C1', pagado: 5800, iva: 800, fecha: '2026-10-20', origen: 'cxc_cobro' }, { id: 'k2', cliente: 'C3', pagado: 2000, fecha: '2026-10-22', origen: 'anticipo' }];
  d.pagos = [{ id: 'p1', proveedor: 'PROV A', pagado: 2320, iva: 320, fecha: '2026-10-10', origen: 'pago' }, { id: 'p2', proveedor: 'PROV B', pagado: 500, fecha: '2026-10-11', origen: 'anticipo' }];
  d.gastos = [{ id: 'g1', fecha: '2026-10-12', concepto: 'Renta', montoBase: 700, tipoGasto: 'operativo' }];
  d.flujo = [{ id: 'm1', tipo: 'Saldo inicial', fecha: '2026-09-01', importe: 10000 }, { id: 'm3', tipo: 'Anticipo a proveedor', fecha: '2026-10-16', importe: 300 }];
  d.proveedores = [{ id: 'PROV A', nombre: 'PROV A', saldoAFavor: [] }]; d.clientes = [{ id: 'C1', saldoAFavor: [] }];
  return d;
}
const rutaRespaldo = buscarRespaldo();
if (!rutaRespaldo) {
  console.log('Nota: no hay un respaldo index.html.bakNN anterior a este cambio; se omite la comparación de calc() y del Reporte mensual.');
} else {
  const nuevo = cargarCalculo(HTML_RUTA), viejo = cargarCalculo(rutaRespaldo);
  const periodos = [{ desde: '2026-10-01', hasta: '2026-10-31', label: 'Oct' }, { desde: '2026-09-01', hasta: '2026-09-30', label: 'Sep' }, { desde: '0000-00-00', hasta: '9999-99-99', label: 'Todo' }];
  [false, true].forEach((s) => periodos.forEach((per) => {
    nuevo.setIncluir(s); viejo.setIncluir(s);
    const a = nuevo.calc(datos(), per), b = viejo.calc(datos(), per);
    afirmar(JSON.stringify(a) === JSON.stringify(b) && Object.keys(a).length > 40, `e) calc() devuelve JSON idéntico de ${Object.keys(a).length} R.* contra el respaldo (${per.label}, socios ${s ? 'incluidos' : 'excluidos'})`);
  }));
  ['2026-09', '2026-10'].forEach((mes) => {
    nuevo.setIncluir(false); viejo.setIncluir(false);
    const a = nuevo.reporte(datos(), mes), b = viejo.reporte(datos(), mes);
    afirmar(a === b && a.length > 1000, `e) el Reporte mensual de ${mes} sale idéntico al respaldo (${a.length} caracteres)`);
  });
  // El respaldo anterior no tenía la clase: el selector se veía siempre (por eso falla esta prueba contra él)
  afirmar(!/sin-periodo/.test(fs.readFileSync(rutaRespaldo, 'utf8')), `e) el respaldo (${path.basename(rutaRespaldo)}) mostraba el selector siempre`);
}

console.log(`${ok}/${total} comprobaciones correctas`);
if (ok !== total) process.exitCode = 1;
