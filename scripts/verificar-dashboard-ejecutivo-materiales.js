// Dashboard Ejecutivo: kg de báscula vs importe de la CxP (interruptor de socios solo en importes), inicio del flujo derivado,
// cobertura de la CxP total y ausencia del precio promedio por kg.
// Sin navegador: se extraen por texto las funciones de dashboard-ejecutivo/index.html y se corren en vm con datos sintéticos
// (mismo método que scripts/verificar-reversiones-corte.js). La parte visual (render real, Chart.js) NO se prueba aquí.
//
// Uso: node scripts/verificar-dashboard-ejecutivo-materiales.js [ruta/index.html]   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const HTML_RUTA = path.resolve(process.argv[2] || path.join(RAIZ, '..', 'dashboard-ejecutivo', 'index.html'));
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const cerca = (a, b, m) => afirmar(Math.abs(a - b) < 0.005, `${m}: esperado ${b}, obtenido ${a}`);
if (!fs.existsSync(HTML_RUTA)) { console.error('No existe ' + HTML_RUTA); process.exit(1); }
const html = fs.readFileSync(HTML_RUTA, 'utf8');

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
// Línea de una declaración de primer nivel: "const nombre ..." o "let nombre ..."
function extraerLinea(nombre) {
  const m = html.match(new RegExp('^(?:const|let) ' + nombre + '\\s*=.*$', 'm'));
  return m ? m[0] : '';
}

// ── Extracción ──
const LINEAS = ['num', 'fmt\\$', 'fmt\\$2', 'fmtN', 'fmtPct', 'esc', 'iso', 'fdate', 'norm', 'PROVEEDORES_SOCIOS', 'limpiaSocio', 'sum', 'MESES', 'MESES_L', 'UNIDAD_PZ',
  'dayDiff', 'inP', 'tipoNormG', 'rmM', 'dia10', 'diaAnterior', 'verSocioG', 'esSaldoInicialCta', 'FLUJO_INICIO', 'subtotalCxc', 'baseCxc', 'INCLUIR_SOCIOS'];
const FUNCS = ['esProveedorSocio', 'incluirSocios', 'grp', 'aging', 'calc', 'abonosVigentesAl', 'cxpAlCorteDet', 'abonosCxcAl', 'cxcAlCorteDet', 'puenteCxPMes', 'puenteCxCMes',
  'autopruebaCxP', 'autopruebaCxC', 'rmFilasRubro', 'rmTablaRubro', 'rmBloqueCxP', 'rmBloqueCxC', 'rReporteMensual', 'rMateriales'];
const lineas = LINEAS.map((n) => extraerLinea(n));
const funcs = FUNCS.map(extraerFuncion);
afirmar(lineas.every(Boolean), 'se encontraron todas las constantes: ' + LINEAS.filter((n, i) => !lineas[i]).join(', '));
afirmar(funcs.every(Boolean), 'se encontraron todas las funciones: ' + FUNCS.filter((n, i) => !funcs[i]).join(', '));
// kpi es una función de una línea ("function kpi(...){...}")
const kpiLinea = (html.match(/^function kpi\(.*$/m) || [''])[0];
afirmar(!!kpiLinea, 'se encontró kpi');

const bandera = { incluir: true };
const elementos = {};
const ctx = {
  console: { warn() {}, info() {}, error: console.error, log: console.log },
  localStorage: { getItem: () => (bandera.incluir ? null : '0') },
  $: (id) => elementos[id] || (elementos[id] = { value: '', innerHTML: '' }),
  barRow: () => '', chart: () => {}, C_NAVY: '#000', COL_FALLAS: []
};
vm.createContext(ctx);
const HOY_FIJO = '2026-11-09';
vm.runInContext(`
  const HOY = '${HOY_FIJO}'; let DB = null, PER = {desde:'',hasta:'',label:''}, R = null;
  ${lineas.filter((l) => !/^let COL_FALLAS/.test(l)).join('\n')}
  let COL_FALLAS = [];
  ${kpiLinea}
  ${funcs.join('\n')}
  globalThis.api = {
    set(db, per) { DB = db; PER = per; }, calc: () => (R = calc()), rMateriales, rReporteMensual, FLUJO_INICIO, fdate, getR: () => R, setIncluir: (v) => { INCLUIR_SOCIOS = v; }, setPER: (p) => { PER = p; }
  };
`, ctx);
const api = ctx.api;
// El interruptor ahora vive en la variable INCLUIR_SOCIOS (ya no en localStorage): `bandera.incluir` la asigna dentro del contexto.
Object.defineProperty(bandera, 'incluir', { get: () => bandera._v, set: (v) => { bandera._v = v; api.setIncluir(v); } });

const vacio = () => ({ cxp: [], cxc: [], ventas: [], destaraje: [], cobros: [], pagos: [], gastos: [], flujo: [], precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [] });
const PER_OCT = { desde: '2026-10-01', hasta: '2026-10-31', label: 'Octubre 2026' };

// ── Datos de materiales: PET (propio + socio GERMAN), HDPE con ticket pendiente sin cuenta por pagar ──
const db = vacio();
db.destaraje = [
  { ticket: '1001', proveedor: 'PROV A', material: 'PET', kg: 1000, fechaSalida: '2026-10-05' },
  { ticket: '1002', proveedor: 'GERMAN', material: 'PET', kg: 500, fechaSalida: '2026-10-06' },
  { ticket: '1003', proveedor: 'PROV A', material: 'HDPE', kg: 300, fechaSalida: '2026-10-07' },
  { ticket: '1004', proveedor: 'PROV B', material: 'HDPE', kg: 200, fechaEntrada: '2026-10-08' },   // ticket pendiente de aprobar: sin CxP
  { ticket: '0999', proveedor: 'PROV A', material: 'PET', kg: 9999, fechaSalida: '2026-09-15' }       // fuera del periodo
];
db.cxp = [
  { id: 'c1', ticket: '1001', proveedor: 'PROV A', material: 'PET', kg: 1000, total: 5000, saldo: 5000, fechaTicket: '2026-10-05' },
  { id: 'c2', ticket: '1002', proveedor: 'GERMAN', material: 'PET', kg: 500, total: 2500, saldo: 2500, fechaTicket: '2026-10-06' },
  { id: 'c3', ticket: '1003', proveedor: 'PROV A', material: 'HDPE', kg: 300, total: 1200, saldo: 1200, fechaTicket: '2026-10-07' }
];
db.cxc = [{ id: 'x1', cliente: 'CLI', total: 4000, saldo: 4000, fecha: '2026-10-10', fechaVenta: '2026-10-10' }];

function correr(incluir) { bandera.incluir = incluir; api.set(db, PER_OCT); return api.calc(); }
const Rin = correr(true), Rex = correr(false);

// a) Los kg de materiales son iguales con el interruptor en incluir y en excluir (y vienen de la báscula completa).
cerca(Rin.kgBascula, 2000, 'a) kg de báscula con socios incluidos');
cerca(Rex.kgBascula, 2000, 'a) kg de báscula con socios excluidos');
cerca(Rin.kgBasculaMat.PET.kg, 1500, 'a) PET incluido');
cerca(Rex.kgBasculaMat.PET.kg, 1500, 'a) PET excluido (el socio sigue en kg)');
afirmar(JSON.stringify(Rin.kgBasculaMat) === JSON.stringify(Rex.kgBasculaMat), 'a) kg por material idénticos con y sin interruptor');
cerca(Rex.kgBasculaMat.HDPE.kg, 500, 'a) HDPE incluye el ticket pendiente');

// b) El importe cambia con el interruptor.
cerca(Rin.comprasMonto, 8700, 'b) importe con socios');
cerca(Rex.comprasMonto, 6200, 'b) importe sin socios');
cerca(Rex.compras.PET.monto, 5000, 'b) importe PET sin socios');

// c) Kg sin cuenta por pagar = báscula − TODAS las CxP del material (sin filtro de socios), con un ticket pendiente.
cerca(Rin.kgSinCxpMat.HDPE, 200, 'c) HDPE: 500 de báscula − 300 con CxP = 200 (ticket pendiente)');
cerca(Rin.kgSinCxpMat.PET, 0, 'c) PET: la CxP del socio sí se resta aunque el interruptor la oculte');
cerca(Rex.kgSinCxpMat.PET, 0, 'c) PET con socios excluidos: igual');
cerca(Rex.kgSinCxp, 200, 'c) total sin cuenta por pagar con socios excluidos');
cerca(Rin.kgSinCxp, Rex.kgSinCxp, 'c) no depende del interruptor');
// La pantalla de Materiales trae las columnas pedidas y el dato calculado (no el texto fijo).
bandera.incluir = true; api.set(db, PER_OCT); api.calc(); api.rMateriales();
const panel = ctx.$('p-materiales').innerHTML;
afirmar(/Kg báscula/.test(panel) && /Importe comprado/.test(panel) && /Kg sin cuenta por pagar/.test(panel), 'c) la tabla de Materiales trae Kg báscula, Importe comprado y Kg sin cuenta por pagar');
afirmar(/200 kg<\/b> de báscula no tienen cuenta por pagar/.test(panel), 'c) el aviso trae los kg calculados');
afirmar(!/tickets sin precio vigente/.test(panel + html), 'c) ya no existe el texto "tickets sin precio vigente o aún sin aprobar"');
afirmar(!/\$\/kg|promedio/i.test(panel), 'd) la pestaña Materiales no muestra $/kg ni promedio');

// d) Ya no existe el precio promedio por kg en el HTML de compras (Materiales, avisos y encabezados).
afirmar(!/comprasMonto\s*\/\s*R\.comprasKg|R\.comprasKg/.test(html), 'd) no queda el cálculo de promedio por kg de compras');
afirmar(!/promedio <b>/.test(html), 'd) no queda la frase "promedio $/kg" en el HTML');

// e) FLUJO_INICIO derivado y sin el texto fijo 01/10/2026.
afirmar(api.FLUJO_INICIO === '2026-09-01', 'e) FLUJO_INICIO es 2026-09-01');
afirmar(!/01\/10\/2026/.test(html), 'e) el HTML ya no trae el texto fijo 01/10/2026');
afirmar(/'Desde el arranque del flujo \('\+fdate\(FLUJO_INICIO\)\+'\)'/.test(html), 'e) los textos usan fdate(FLUJO_INICIO)');
const jsFlujo = fs.readFileSync(path.join(RAIZ, 'js', 'flujo.js'), 'utf8');
const mf = jsFlujo.match(/const FLUJO_FECHA_INICIO\s*=\s*'(\d{4}-\d{2}-\d{2})'/);
afirmar(!!mf && mf[1] === api.FLUJO_INICIO, 'e) js/flujo.js tiene el mismo valor: ' + (mf && mf[1]));

// Reporte mensual: septiembre muestra flujo y el acumulado al inicio de octubre es el neto de septiembre.
const dbf = vacio();
dbf.cobros = [{ id: 'k1', fecha: '2026-09-10', pagado: 1000, iva: 0 }];
dbf.pagos = [{ id: 'p1', fecha: '2026-09-12', pagado: 400, iva: 0 }];
dbf.cobros.push({ id: 'k0', fecha: '2026-08-20', pagado: 7777, iva: 0 }); // anterior al arranque: no cuenta
function reporte(mes) { ctx.$('rmMes').value = mes; ctx.$('rmCuerpo').innerHTML = ''; api.set(dbf, { desde: '', hasta: '', label: '' }); api.rReporteMensual(); return ctx.$('rmCuerpo').innerHTML; }
const sep = reporte('2026-09');
afirmar(!/Este mes es anterior/.test(sep) && /Neto del mes/.test(sep), 'e) el reporte de septiembre muestra flujo');
afirmar(/Acumulado al inicio del mes<\/div><div class="val">\$0\.00/.test(sep), 'e) septiembre inicia en $0.00');
afirmar(/Neto del mes<\/div><div class="val">\$600\.00/.test(sep), 'e) neto de septiembre = $600.00');
const oct = reporte('2026-10');
afirmar(/Acumulado al inicio del mes<\/div><div class="val">\$600\.00/.test(oct), 'e) el acumulado al inicio de octubre es el neto de septiembre ($600.00)');
const ago = reporte('2026-08');
afirmar(/inicia el 01\/09\/2026; este mes es anterior/.test(ago), 'e) agosto sigue sin flujo y dice 01/09/2026');

// f) La frase de cobertura no depende del interruptor.
const cob = (R) => (R.cxcTotal > 0 && R.cxpTotalConSocios > 0 ? Math.round(R.cxcTotal / R.cxpTotalConSocios * 100) : null);
cerca(Rin.cxpTotalConSocios, Rex.cxpTotalConSocios, 'f) CxP total con socios igual con y sin interruptor');
cerca(Rin.cxpTotalConSocios, 8700, 'f) CxP total con socios = 8,700');
afirmar(Rex.cxpTotal < Rin.cxpTotal, 'f) (control) cxpTotal sí cambia con el interruptor');
afirmar(cob(Rin) === cob(Rex), 'f) el porcentaje de cobertura es igual con y sin interruptor');
afirmar(/R\.cxcTotal\/R\.cxpTotalConSocios\*100/.test(html) && /de lo que debemos \(incluye socios\)/.test(html), 'f) la frase usa la CxP con socios y dice "incluye socios"');

// Etiquetas: el interruptor y los chips dicen que aplica solo a importes.
afirmar(/Incluir material de socios \(solo importes\)/.test(html), 'etiqueta del interruptor dice solo importes');
afirmar(/Importes: material de socios \$\{socios\?'incluido':'excluido'\}/.test(html), 'los chips dicen Importes: material de socios');
afirmar(!/no cuentan como entradas/.test(html), 'ya no dice que las compras de socios no cuentan como entradas');

// Reporte mensual, sección Material: kg de báscula, importe de la CxP con interruptor.
{
  const dbm = db;
  const get = (incluir) => { bandera.incluir = incluir; ctx.$('rmMes').value = '2026-10'; api.set(dbm, { desde: '', hasta: '', label: '' }); api.rReporteMensual(); return ctx.$('rmCuerpo').innerHTML; };
  const con = get(true), sin = get(false);
  const fila = (h, m) => { const r = h.match(new RegExp('<tr><td>' + m + '</td>(.*?)</tr>')); return r ? r[1] : ''; };
  afirmar(fila(con, 'PET').includes('<td class="n">1,500</td>') && fila(sin, 'PET').includes('<td class="n">1,500</td>'), 'mensual) kg de entradas PET = 1,500 con y sin interruptor');
  afirmar(fila(con, 'PET').includes('$7,500.00') && fila(sin, 'PET').includes('$5,000.00'), 'mensual) importe de entradas PET cambia con el interruptor');
  afirmar(/aplica solo a importes/.test(con), 'mensual) la nota dice que el interruptor aplica solo a importes');
}

console.log(`${ok}/${total} comprobaciones correctas`);
if (ok !== total) process.exitCode = 1;
