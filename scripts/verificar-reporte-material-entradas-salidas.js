// Reporte mensual del Dashboard Ejecutivo, sección 2: dos tablas independientes (Entradas de material / Salidas de producto
// terminado), sin columnas de diferencia. Sin navegador: se extraen por texto las funciones de dashboard-ejecutivo/index.html y
// se corren en vm (mismo método que scripts/verificar-dashboard-ejecutivo-materiales.js). El aspecto real y la impresión NO se prueban aquí.
//
// Uso: node scripts/verificar-reporte-material-entradas-salidas.js [ruta/index.html]   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_RUTA = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'dashboard-ejecutivo', 'index.html'));
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
if (!fs.existsSync(HTML_RUTA)) { console.error('No existe ' + HTML_RUTA); process.exit(1); }
const html = fs.readFileSync(HTML_RUTA, 'utf8');

function extraerFuncion(nombre) {
  const ini = html.indexOf('function ' + nombre + '(');
  if (ini < 0) return '';
  let i = html.indexOf('{', ini), nivel = 0;
  for (; i < html.length; i++) { if (html[i] === '{') nivel++; if (html[i] === '}' && --nivel === 0) return html.slice(ini, i + 1); }
  return '';
}
function extraerLinea(nombre) { const m = html.match(new RegExp('^(?:const|let) ' + nombre + '\\s*=.*$', 'm')); return m ? m[0] : ''; }

const LINEAS = ['num', 'fmt\\$', 'fmt\\$2', 'fmtN', 'fmtPct', 'esc', 'iso', 'fdate', 'norm', 'MATERIALES_ALIAS', 'normMat', 'PROVEEDORES_SOCIOS', 'limpiaSocio', 'sum', 'MESES', 'MESES_L', 'UNIDAD_PZ',
  'dayDiff', 'inP', 'tipoNormG', 'rmM', 'dia10', 'diaAnterior', 'verSocioG', 'esSaldoInicialCta', 'FLUJO_INICIO', 'subtotalCxc', 'baseCxc', 'INCLUIR_SOCIOS'];
const FUNCS = ['esProveedorSocio', 'incluirSocios', 'grp', 'aging', 'calc', 'abonosVigentesAl', 'cxpAlCorteDet', 'abonosCxcAl', 'cxcAlCorteDet', 'puenteCxPMes', 'puenteCxCMes',
  'autopruebaCxP', 'autopruebaCxC', 'rmFilasRubro', 'rmTablaRubro', 'rmBloqueCxP', 'rmBloqueCxC', 'rReporteMensual'];
const lineas = LINEAS.map(extraerLinea), funcs = FUNCS.map(extraerFuncion);
afirmar(lineas.every(Boolean), 'se encontraron las constantes: ' + LINEAS.filter((n, i) => !lineas[i]).join(', '));
afirmar(funcs.every(Boolean), 'se encontraron las funciones: ' + FUNCS.filter((n, i) => !funcs[i]).join(', '));
const bloqueSocios = (html.match(/let INCLUIR_SOCIOS=false;\r?\ntry\{[^\n]*\}catch\(e\)\{\}/) || [''])[0];

const elementos = {};
const ctx = {
  console: { warn() {}, info() {}, error: console.error, log() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  $: (id) => elementos[id] || (elementos[id] = { value: '', innerHTML: '' }),
  barRow: () => '', chart: () => {}, C_NAVY: '#000', COL_FALLAS: []
};
vm.createContext(ctx);
vm.runInContext(`
  const HOY = '2026-11-09'; let DB = null, PER = {desde:'',hasta:'',label:''}, R = null;
  ${lineas.filter((l) => !/^let (COL_FALLAS|INCLUIR_SOCIOS)/.test(l)).join('\n')}
  let COL_FALLAS = [];
  ${bloqueSocios}
  ${(html.match(/^function kpi\(.*$/m) || [''])[0]}
  ${funcs.join('\n')}
  globalThis.api = { set(db) { DB = db; PER = { desde: '', hasta: '', label: '' }; }, rReporteMensual, setIncluir: (v) => { INCLUIR_SOCIOS = v; } };
`, ctx);
const api = ctx.api;

const vacio = () => ({ cxp: [], cxc: [], ventas: [], destaraje: [], cobros: [], pagos: [], gastos: [], flujo: [], precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [] });
function generar(db, incluir) {
  api.setIncluir(incluir); api.set(db); ctx.$('rmMes').value = '2026-10'; api.rReporteMensual();
  return ctx.$('rmCuerpo').innerHTML;
}
// Parte el HTML de la sección 2 en sus dos tablas
function tablas(h) {
  const ini = h.indexOf('<h2>2 · Material'); const fin = h.indexOf('<h2>', ini + 5);
  const sec = h.slice(ini, fin < 0 ? undefined : fin);
  const e = sec.indexOf('<h3>Entradas de material</h3>'), s = sec.indexOf('<h3>Salidas de producto terminado</h3>');
  return { sec, ent: e >= 0 && s > e ? sec.slice(e, s) : '', sal: s >= 0 ? sec.slice(s) : '' };
}
const filasDe = (t) => [...t.matchAll(/<tr(?: class="tot")?>(.*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, '')));
const nro = (s) => Number(String(s).replace(/[$,]/g, ''));

// ── Datos: entran MIXTO/PET/LECHERO (+ HDPE sin kg ni importe), salen PET CRISTAL, CAJA CO30, TAMBO ──
const db = vacio();
db.destaraje = [
  { ticket: '1', proveedor: 'PROV A', material: 'PET', kg: 1000, fechaSalida: '2026-10-05' },
  { ticket: '2', proveedor: 'GERMAN', material: 'PET', kg: 500, fechaSalida: '2026-10-06' },
  { ticket: '3', proveedor: 'PROV A', material: 'MIXTO', kg: 3000, fechaSalida: '2026-10-07' },
  { ticket: '4', proveedor: 'MARIO M', material: 'LECHERO', kg: 200, fechaSalida: '2026-10-08' },   // kg de socio, sin importe con socios excluidos
  { ticket: '5', proveedor: 'PROV B', material: 'HDPE', kg: 0, fechaSalida: '2026-10-09' }       // ni kg ni importe: no aparece
];
db.cxp = [
  { id: 'c1', ticket: '1', proveedor: 'PROV A', material: 'PET', kg: 1000, total: 5000, saldo: 5000, fechaTicket: '2026-10-05' },
  { id: 'c2', ticket: '2', proveedor: 'GERMAN', material: 'PET', kg: 500, total: 2500, saldo: 2500, fechaTicket: '2026-10-06' },
  { id: 'c3', ticket: '3', proveedor: 'PROV A', material: 'MIXTO', kg: 3000, total: 6000, saldo: 6000, fechaTicket: '2026-10-07' },
  { id: 'c4', ticket: '4', proveedor: 'MARIO M', material: 'LECHERO', kg: 200, total: 800, saldo: 800, fechaTicket: '2026-10-08' }
];
db.ventas = [
  { id: 'v1', cliente: 'CLI', fecha: '2026-10-10', lineas: [
    { material: 'PET CRISTAL', unidad: 'KG', cantidad: 800, subtotal: 4000 },
    { material: 'CAJA CO30', unidad: 'PZ', cantidad: 120, subtotal: 9000 },
    { material: 'TAMBO', unidad: 'PZ', cantidad: 30, subtotal: 3000 } ] },
  { id: 'v2', cliente: 'CLI2', fecha: '2026-10-20', lineas: [{ material: 'PET CRISTAL', unidad: 'KG', cantidad: 200, subtotal: 1000 }] },
  { id: 'v3', cliente: 'CLI3', fecha: '2026-09-20', lineas: [{ material: 'OTRO', unidad: 'KG', cantidad: 9999, subtotal: 99999 }] }   // fuera del mes
];
const ex = generar(db, false), inc = generar(db, true);
const Tex = tablas(ex), Tin = tablas(inc);
const fe = filasDe(Tex.ent), fi = filasDe(Tin.ent), fs_ = filasDe(Tex.sal);

// a) Entradas: solo materiales con kg o importe; kg iguales con y sin socios; importe cambia.
const dataE = (f) => f.filter((r) => r[0] !== 'Material' && r[0] !== 'TOTAL');
afirmar(dataE(fe).map((r) => r[0]).sort().join() === 'LECHERO,MIXTO,PET', 'a) entradas lista MIXTO, PET y LECHERO y no HDPE (sin kg ni importe)');
const kgDe = (f, m) => nro((f.find((r) => r[0] === m) || [0, 'NaN'])[1]);
const impDe = (f, m) => (f.find((r) => r[0] === m) || [0, 0, ''])[2];
afirmar(['PET', 'MIXTO', 'LECHERO'].every((m) => kgDe(fe, m) === kgDe(fi, m)), 'a) los kg son iguales con el interruptor incluido y excluido');
afirmar(kgDe(fe, 'PET') === 1500 && kgDe(fe, 'LECHERO') === 200, 'a) los kg incluyen a los socios (PET 1,500; LECHERO 200)');
afirmar(nro(impDe(fe, 'PET')) === 5000 && nro(impDe(fi, 'PET')) === 7500, 'a) el importe de PET cambia con el interruptor (5,000 vs 7,500)');

// b) Guion cuando hay kg pero importe cero (LECHERO es de socio excluido).
afirmar(impDe(fe, 'LECHERO') === '—', 'b) LECHERO con kg y sin importe (socio excluido) muestra guion en Importe');
afirmar(nro(impDe(fi, 'LECHERO')) === 800, 'b) con socios incluidos LECHERO muestra su importe');

// c) Totales de entradas = suma de filas.
{
  const tot = fe.find((r) => r[0] === 'TOTAL'), tin = fi.find((r) => r[0] === 'TOTAL');
  afirmar(!!tot && nro(tot[1]) === dataE(fe).reduce((t, r) => t + nro(r[1]), 0), 'c) total de kg de entradas = suma de sus filas');
  afirmar(nro(tot[2]) === dataE(fe).reduce((t, r) => t + (r[2] === '—' ? 0 : nro(r[2])), 0), 'c) total de importe de entradas = suma de sus filas (excluido)');
  afirmar(nro(tin[1]) === 4700 && nro(tin[2]) === 14300, 'c) totales con socios incluidos: 4,700 kg y $14,300');
  afirmar(/<tr class="tot"><td>TOTAL<\/td>/.test(Tex.ent) && /tr\.tot td\{font-weight:700/.test(html), 'c) la fila TOTAL va en negritas (tr.tot)');
}

// d) Salidas: kg y piezas separados; importe = ventas del mes.
const dataS = (f) => f.filter((r) => r[0] !== 'Producto' && r[0] !== 'TOTAL');
afirmar(dataS(fs_).map((r) => r[0]).sort().join() === 'CAJA CO30,PET CRISTAL,TAMBO', 'd) salidas lista PET CRISTAL, CAJA CO30 y TAMBO y no la venta de otro mes');
{
  const por = (m) => fs_.find((r) => r[0] === m);
  afirmar(por('PET CRISTAL')[1] === '1,000' && por('PET CRISTAL')[2] === '—', 'd) un producto en KG pone la cantidad en Kg y guion en Piezas');
  afirmar(por('CAJA CO30')[1] === '—' && por('CAJA CO30')[2] === '120', 'd) un producto en PZ pone la cantidad en Piezas y guion en Kg');
  const t = fs_.find((r) => r[0] === 'TOTAL');
  afirmar(nro(t[1]) === 1000 && nro(t[2]) === 150, 'd) total de kg (1,000) y de piezas (150) sin mezclarse');
  afirmar(nro(t[3]) === 17000 && nro(t[3]) === dataS(fs_).reduce((s, r) => s + nro(r[3]), 0), 'd) importe total (17,000) = suma de ventas del mes = suma de filas');
  afirmar(t.length === 4, 'd) la tabla de salidas tiene 4 columnas (Producto, Kg, Piezas, Importe)');
}

// e) Ya no hay diferencias, ni función dif, ni ceros por falta de contraparte.
afirmar(!/Diferencia/.test(ex) && !/Diferencia/.test(inc), 'e) el reporte ya no tiene encabezados Diferencia');
afirmar(!/const dif=/.test(html) && !/\bdif\(/.test(html), 'e) la función dif ya no existe en index.html');
afirmar(!/Material: entradas vs salidas/.test(html) && /Material: entradas y salidas del mes/.test(html), 'e) el título es "2 · Material: entradas y salidas del mes"');
afirmar(!/Entradas kg|Salidas pzas|Salidas \$/.test(Tex.sec), 'e) ya no están los encabezados de la tabla única');
afirmar(!/<td class="n">0<\/td>/.test(Tex.sec) && !/\$0\.00<\/td>/.test(Tex.ent), 'e) no hay filas con ceros por falta de contraparte en entradas');
afirmar(!/PET CRISTAL/.test(Tex.ent) && !/MIXTO/.test(Tex.sal), 'e) las tablas no se cruzan por nombre');
afirmar(!/rendimiento|producci[oó]n/i.test(Tex.sec.replace(/producto terminado/gi, '')), 'e) no se agrega rendimiento ni producción');

// f) Sin datos: cada tabla muestra "Sin movimientos en el mes".
{
  const t = tablas(generar(vacio(), false));
  afirmar((t.ent.match(/Sin movimientos en el mes/g) || []).length === 1 && (t.sal.match(/Sin movimientos en el mes/g) || []).length === 1, 'f) sin datos cada tabla muestra "Sin movimientos en el mes"');
  afirmar(!/class="tot"/.test(t.ent) && !/class="tot"/.test(t.sal), 'f) sin datos no hay fila TOTAL');
  const solo = vacio(); solo.ventas = db.ventas;
  const t2 = tablas(generar(solo, false));
  afirmar(/Sin movimientos en el mes/.test(t2.ent) && !/Sin movimientos en el mes/.test(t2.sal), 'f) solo con ventas: entradas vacía y salidas con datos');
}

// g) Orden: entradas por kg desc; salidas por importe desc.
{
  const kgs = dataE(fe).map((r) => nro(r[1]));
  afirmar(kgs.every((v, i) => i === 0 || kgs[i - 1] >= v) && dataE(fe)[0][0] === 'MIXTO', 'g) entradas ordenadas por kg de mayor a menor (MIXTO primero)');
  const ms = dataS(fs_).map((r) => nro(r[3]));
  afirmar(ms.every((v, i) => i === 0 || ms[i - 1] >= v) && dataS(fs_)[0][0] === 'CAJA CO30', 'g) salidas ordenadas por importe de mayor a menor (CAJA CO30 primero)');
}

// h) Chip de socios y notas.
afirmar(/Importes: material de socios excluido/.test(ex) && /Importes: material de socios incluido/.test(inc), 'h) el chip de socios sigue presente (excluido / incluido)');
afirmar(/El interruptor «Incluir material de socios» aplica solo a importes\. Los kg de entradas son siempre los de la báscula completa\./.test(ex), 'h) la nota del interruptor sigue presente');
afirmar(/Kg de entradas: báscula completa\. Importe de entradas: cuenta por pagar, con el interruptor de socios aplicado\. Salidas: ventas del mes sin IVA\. Montos de material, no efectivo\./.test(ex), 'h) la nota al pie queda como se pidió');
afirmar(!/No representa variación de inventario/.test(Tex.sec), 'h) la nota vieja de inventario ya no está');

// Maquetación (texto): dos columnas, apiladas bajo 900 px y en impresión.
afirmar(/\.rm-dos\{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:flex-start\}/.test(html), 'maquetación) grid de dos columnas con align-items flex-start');
afirmar(/@media\(max-width:900px\)\{\.rm-dos\{grid-template-columns:1fr\}\}/.test(html), 'maquetación) se apila por debajo de 900 px');
afirmar(/#p-reporte \.rm-dos\{grid-template-columns:1fr\}/.test(html) && /#p-reporte \.rm-dos>div\{break-inside:avoid/.test(html), 'maquetación) apiladas y sin cortarse dentro de @media print');

console.log(`${ok}/${total} comprobaciones correctas`);
if (ok !== total) process.exitCode = 1;
