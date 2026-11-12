// Un abono o cobro revertido no cuenta en ningún corte (Dashboard Ejecutivo y posición de IVA del Dashboard).
// Sin navegador: la lógica del Dashboard Ejecutivo está inline en dashboard-ejecutivo/index.html, así que se extraen sus funciones
// (abonosVigentesAl, cxpAlCorteDet, abonosCxcAl, cxcAlCorteDet y los puentes del mes) y se corren en vm con datos sintéticos.
// js/dashboard.js (calcularVistaPosicionIva) se carga en vm con su js/ real.
//
// Uso: node scripts/verificar-reversiones-corte.js [ruta/index.html]   (código de salida 1 si algo falla)
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

// Extrae el texto de "function nombre(...) { ... }" contando llaves (suficiente para estas funciones).
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
const FUNCIONES = ['abonosVigentesAl', 'cxpAlCorteDet', 'abonosCxcAl', 'ventaDeCuentaCxc', 'descuentosCxcAl', 'descuentosCxcMonto', 'descuentoLineaVenta', 'subNetoLineaVenta', 'cxcAlCorteDet', 'puenteCxPMes', 'puenteCxCMes'];
const fuentes = FUNCIONES.map(extraerFuncion);
// Ayudas de base sin IVA (constantes de una línea del HTML)
const ayudasBase = ['subtotalCxc', 'baseCxc'].map((n) => (html.match(new RegExp('^const ' + n + '=.*$', 'm')) || [''])[0]);
afirmar(ayudasBase.every(Boolean), 'se encontraron subtotalCxc y baseCxc');
afirmar(fuentes[0] && fuentes[1] && fuentes[2] && fuentes[3], 'se encontraron las funciones de corte en el HTML');

const ctx = { DB: { cxp: [], cxc: [], cobros: [] } };
vm.createContext(ctx);
vm.runInContext(`
  const num = (x) => Number(x) || 0;
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const verSocioG = () => true;
  const dia10 = (f) => String(f || '').slice(0, 10);
  const diaAnterior = (f) => { const [y, m, d] = f.split('-').map(Number); return iso(new Date(y, m - 1, d - 1)); };
  ${ayudasBase.join('\n')}
  ${fuentes.join('\n')}
  globalThis.api = { abonosVigentesAl, cxpAlCorteDet, abonosCxcAl, cxcAlCorteDet,
    puenteCxPMes: typeof puenteCxPMes === 'function' ? puenteCxPMes : null, puenteCxCMes: typeof puenteCxCMes === 'function' ? puenteCxCMes : null };
`, ctx);
const api = ctx.api;
const saldoCxc = (cuentas, corte) => { ctx.DB.cxc = cuentas; return api.cxcAlCorteDet(corte).todo; };
const saldoCxp = (cuentas, corte) => { ctx.DB.cxp = cuentas; return api.cxpAlCorteDet(corte).todo; };

// El modelo guarda los abonos vigentes en c.abonos y los revertidos en c.abonosRevertidos (con fechaReversion si existe).
const ab = (monto, fecha, extra) => Object.assign({ monto, fecha }, extra || {});

// a) Cobro de 98,112 con fecha 30/09 revertido el 09/11 y registrado de nuevo con la misma fecha: no se descuenta dos veces.
{
  const c = { id: 'x1', fechaVenta: '2026-09-15', total: 98112,
    abonos: [ab(98112, '2026-09-30')], abonosRevertidos: [ab(98112, '2026-09-30', { revertido: true, fechaReversion: '2026-11-09' })] };
  cerca(saldoCxc([c], '2026-09-30'), 0, 'a) saldo al 30/09 con cobro revertido y vuelto a registrar');
  cerca(saldoCxc([c], '2026-10-31'), 0, 'a) saldo al 31/10');
  cerca(saldoCxc([c], '2026-11-30'), 0, 'a) saldo al 30/11');
}
// b) Tres cobros idénticos de 38,304 con fecha 31/10 revertidos el 01/11 y uno vigente: saldo al 31/10 igual a 0, nunca negativo.
{
  const rev = () => ab(38304, '2026-10-31', { revertido: true, fechaReversion: '2026-11-01' });
  const c = { id: 'x2', fechaVenta: '2026-10-10', total: 38304, abonos: [ab(38304, '2026-10-31')], abonosRevertidos: [rev(), rev(), rev()] };
  cerca(saldoCxc([c], '2026-10-31'), 0, 'b) saldo al 31/10');
  afirmar(saldoCxc([c], '2026-10-31') >= -0.005, 'b) el saldo al 31/10 nunca es negativo');
  cerca(saldoCxc([c], '2026-11-01'), 0, 'b) saldo al 01/11');
}
// c) Revertido dentro del mismo mes: el abono revertido no aparece en el puente ni en el saldo.
{
  const c = { id: 'x3', fechaVenta: '2026-10-02', total: 1000, abonos: [], abonosRevertidos: [ab(400, '2026-10-10', { revertido: true, fechaReversion: '2026-10-20' })] };
  cerca(saldoCxc([c], '2026-10-15'), 1000, 'c) al 15/10 (entre cobro y reversión) el saldo no lo descuenta');
  cerca(saldoCxc([c], '2026-10-31'), 1000, 'c) al 31/10');
  if (api.puenteCxCMes) { ctx.DB.cxc = [c]; const p = api.puenteCxCMes('2026-10-01', '2026-10-31'); cerca(p.calculado, p.final, 'c) el puente del mes cuadra'); }
  else afirmar(false, 'c) existe puenteCxCMes');
}
// d) Revertido sin fechaReversion: tampoco cuenta.
{
  const c = { id: 'x4', fechaVenta: '2026-09-01', total: 500, abonos: [], abonosRevertidos: [ab(500, '2026-09-20', { revertido: true })] };
  cerca(saldoCxc([c], '2026-09-30'), 500, 'd) sin fechaReversion no descuenta');
  cerca(saldoCxc([c], '2026-12-31'), 500, 'd) al final del año tampoco');
}
// e) Pagos de CxP revertidos el mismo mes: el puente no cambia.
{
  const base = { id: 'p1', proveedor: 'P', fechaTicket: '2026-10-01', total: 1000, abonos: [ab(300, '2026-10-05')] };
  const conRev = Object.assign({}, base, { abonosRevertidos: [ab(200, '2026-10-06', { revertido: true, fechaReversion: '2026-10-25' })] });
  ctx.DB.cxp = [base];
  const sin = api.puenteCxPMes ? api.puenteCxPMes('2026-10-01', '2026-10-31') : null;
  ctx.DB.cxp = [conRev];
  const con = api.puenteCxPMes ? api.puenteCxPMes('2026-10-01', '2026-10-31') : null;
  afirmar(!!sin && !!con, 'e) existe puenteCxPMes');
  if (sin && con) {
    cerca(con.final, sin.final, 'e) saldo final igual con y sin el pago revertido');
    cerca(con.calculado, sin.calculado, 'e) puente igual con y sin el pago revertido');
    cerca(con.calculado, con.final, 'e) el puente cuadra');
    cerca(con.final, 700, 'e) saldo final = 1000 - 300');
  }
  cerca(saldoCxp([conRev], '2026-10-15'), 700, 'e) al 15/10 el revertido no cuenta');
}
// El HTML ya no lee abonosRevertidos ni usa fechaReversion en los cortes.
afirmar(!/abonosRevertidos/.test(html), 'el HTML ya no lee abonosRevertidos');
afirmar(!/fechaReversion/.test(html), 'el HTML ya no usa fechaReversion');

// js/dashboard.js: la posición de IVA no suma el IVA de cobros revertidos.
{
  const codigo = fs.readFileSync(path.join(RAIZ, 'js', 'dashboard.js'), 'utf8');
  const win = { EVE: {}, EVE_MODULES: {} };
  const sandbox = { window: win, console, document: { addEventListener() {}, getElementById() { return null; } }, localStorage: { getItem() { return null; }, setItem() {} } };
  vm.createContext(sandbox);
  let cargado = true;
  try { vm.runInContext(codigo + '\n;globalThis.__f = calcularVistaPosicionIva;', sandbox); } catch (e) { cargado = false; console.error('No se pudo cargar js/dashboard.js: ' + e.message); }
  afirmar(cargado, 'js/dashboard.js carga en vm');
  if (cargado) {
    win.EVE.cobros = [{ fecha: '2026-10-10', iva: 100 }, { fecha: '2026-10-11', iva: 50, revertido: true, fechaReversion: '2026-11-01' }];
    win.EVE.registrosPagos = []; win.EVE.gastos = [];
    const filas = sandbox.__f();
    const oct = filas.find((f) => String(f.mes).startsWith('2026-10'));
    afirmar(!!oct, 'hay fila de octubre en la posición de IVA');
    if (oct) cerca(oct.trasladado, 100, 'IVA trasladado de octubre sin el cobro revertido');
  }
}

console.log(`${ok}/${total} comprobaciones correctas`);
if (ok !== total) process.exitCode = 1;
