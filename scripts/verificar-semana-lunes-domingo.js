// La semana es lunes a domingo en todos los módulos (window.obtenerRangoSemana en js/utils.js).
// Parte 1: helper. Parte 2: periodos de CxP (Hoy, Esta Semana, Este Mes, Rango, Todos) con hoy = jueves 05/11/2026.
// Parte 3: los demás módulos filtran Esta Semana con tope en domingo.
// Uso: node scripts/verificar-semana-lunes-domingo.js   (código de salida 1 si algo falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');

function crearContexto(hoy, archivos) {
  const almacen = {};
  const sb = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem: (k) => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); } },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sb.window = sb;
  sb.window.EVE = { registrosDestaraje: [], cuentasPorPagar: [], auditorias: [] };
  sb.window.EVE_MODULES = {};
  vm.createContext(sb);
  for (const f of archivos) vm.runInContext(leer(f), sb, { filename: f });
  sb.window.obtenerFechaMexico = () => hoy;
  return sb.window;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, real ${JSON.stringify(real)}`);

const BASE = ['js/config.js', 'js/utils.js'];
const CXP = [...BASE, 'js/cxp.js'];

// ── Parte 1: helper ──
caso('obtenerRangoSemana: jueves 05/11/2026 → 02/11 a 08/11', () => {
  const w = crearContexto('2026-11-05', BASE);
  igual(w.obtenerRangoSemana('2026-11-05'), { inicio: '2026-11-02', fin: '2026-11-08' }, 'jueves');
  igual(w.obtenerRangoSemana(), { inicio: '2026-11-02', fin: '2026-11-08' }, 'sin argumento usa hoy');
});
caso('obtenerRangoSemana: domingo 08/11 pertenece a la misma semana; lunes 09/11 abre la siguiente', () => {
  const w = crearContexto('2026-11-05', BASE);
  igual(w.obtenerRangoSemana('2026-11-08'), { inicio: '2026-11-02', fin: '2026-11-08' }, 'domingo');
  igual(w.obtenerRangoSemana('2026-11-02'), { inicio: '2026-11-02', fin: '2026-11-08' }, 'lunes');
  igual(w.obtenerRangoSemana('2026-11-09'), { inicio: '2026-11-09', fin: '2026-11-15' }, 'lunes siguiente');
});
caso('obtenerRangoSemana: cruces de mes, año y bisiesto', () => {
  const w = crearContexto('2026-11-05', BASE);
  igual(w.obtenerRangoSemana('2026-10-31'), { inicio: '2026-10-26', fin: '2026-11-01' }, 'cruza mes');
  igual(w.obtenerRangoSemana('2026-12-31'), { inicio: '2026-12-28', fin: '2027-01-03' }, 'cruza año');
  igual(w.obtenerRangoSemana('2028-02-29'), { inicio: '2028-02-28', fin: '2028-03-05' }, 'bisiesto');
});
caso('obtenerInicioSemana sigue funcionando y coincide con el helper', () => {
  const w = crearContexto('2026-11-08', BASE);
  igual(w.obtenerInicioSemana(), '2026-11-02', 'domingo 08/11');
  w.obtenerFechaMexico = () => '2026-11-09';
  igual(w.obtenerInicioSemana(), '2026-11-09', 'lunes 09/11');
});
caso('utils.js: el helper de semana no usa toISOString ni Date UTC', () => {
  const t = leer('js/utils.js');
  const i = t.indexOf('window.obtenerRangoSemana');
  afirmar(i >= 0, 'existe');
  const bloque = t.slice(i, t.indexOf('window.obtenerInicioSemana'));
  afirmar(!/toISOString|UTC/.test(bloque), 'sin UTC');
});

// ── Parte 2: CxP ──
function cuenta(ticket, proveedor, saldo, fechaTicket, extra) {
  return { id: `c-${ticket}`, ticket, proveedor, material: 'PET', kg: 100, total: saldo, pagado: 0, saldo, fechaTicket, estado: 'pendiente', abonos: [], ...extra };
}
const CUENTAS = [
  cuenta('1', 'ALFA', 100, '2026-10-31'),
  cuenta('2', 'ALFA', 200, '2026-11-02'),
  cuenta('3', 'BETA', 300, '2026-11-05'),
  cuenta('4', 'BETA', 400, '2026-11-08'),
  cuenta('5', 'GERMAN', 500, '2026-11-04'),
  cuenta('6', 'ALFA', 600, '2026-11-09'),
  cuenta('7', 'ALFA', 50, '2026-09-01', { tipo: 'saldo_inicial', material: 'VARIOS', kg: 0 })
];
function ticketsEn(w, periodo, rango) {
  const r = w.EVE_CXP.calcularRangoPeriodoCxP(periodo, rango);
  return w.EVE_CXP.filtrarCxP(w.EVE.cuentasPorPagar, r).map((c) => c.ticket).sort();
}
function cxp() {
  const w = crearContexto('2026-11-05', CXP);
  w.EVE.cuentasPorPagar = CUENTAS;
  return w;
}
caso('CxP Esta Semana = lunes 02/11 a domingo 08/11 (31/10 y 09/11 fuera; lunes y domingo dentro)', () => {
  const w = cxp();
  igual(w.EVE_CXP.calcularRangoPeriodoCxP('semana'), { desde: '2026-11-02', hasta: '2026-11-08' }, 'rango');
  igual(ticketsEn(w, 'semana'), ['2', '3', '4', '5'], 'tickets');
});
caso('CxP: 31/10 no está en Esta Semana ni en Este Mes (octubre); sí en Todos', () => {
  const w = cxp();
  afirmar(!ticketsEn(w, 'semana').includes('1'), 'no en semana');
  afirmar(!ticketsEn(w, 'mes').includes('1'), 'no en mes');
  afirmar(w.EVE_CXP.filtrarCxP(w.EVE.cuentasPorPagar, {}).some((c) => c.ticket === '1'), 'sí en todos');
});
caso('CxP: Hoy ⊂ Esta Semana ⊂ Este Mes (cuando el mes la contiene) ⊂ Todos', () => {
  const w = cxp();
  const hoy = ticketsEn(w, 'hoy');
  const semana = ticketsEn(w, 'semana');
  const mes = ticketsEn(w, 'mes');
  const todos = w.EVE_CXP.filtrarCxP(w.EVE.cuentasPorPagar, {}).map((c) => c.ticket).sort();
  afirmar(hoy.length > 0 && hoy.every((t) => semana.includes(t)), 'hoy en semana');
  afirmar(semana.every((t) => mes.includes(t)), 'semana en mes');
  afirmar(mes.every((t) => todos.includes(t)), 'mes en todos');
});
caso('CxP: el rango de Hoy cae dentro del de Esta Semana todos los días, también a caballo de dos meses', () => {
  for (const hoy of ['2026-11-02', '2026-11-05', '2026-11-08', '2026-10-31', '2026-12-31']) {
    const w = crearContexto(hoy, CXP);
    const h = w.EVE_CXP.calcularRangoPeriodoCxP('hoy');
    const s = w.EVE_CXP.calcularRangoPeriodoCxP('semana');
    afirmar(s.desde <= h.desde && h.hasta <= s.hasta, `hoy ${hoy} dentro de ${JSON.stringify(s)}`);
  }
});
caso('CxP Rango 31/10 a 31/10 devuelve solo fechaTicket 2026-10-31', () => {
  const w = cxp();
  w.EVE.cuentasPorPagar = [...CUENTAS, cuenta('8', 'ALFA', 10, '2026-10-30'), cuenta('9', 'ALFA', 10, '2026-10-31')];
  const r = w.EVE_CXP.filtrarCxP(w.EVE.cuentasPorPagar, w.EVE_CXP.calcularRangoPeriodoCxP('rango', { desde: '2026-10-31', hasta: '2026-10-31' }));
  igual(r.map((c) => c.ticket).sort(), ['1', '9'], 'tickets');
  igual(r.every((c) => c.fechaTicket === '2026-10-31'), true, 'solo 31/10');
});
caso('CxP: el total de Todos coincide con Total Adeudado General con el interruptor de socios encendido y apagado', () => {
  const w = cxp();
  const totalTodos = () => w.EVE_CXP.filtrarCxP(w.EVE_CXP.cuentasVisiblesCxP(), {}).reduce((s, c) => s + c.saldo, 0);
  const totalGeneral = () => w.EVE_CXP.agregarPorProveedorCxP(w.EVE_CXP.cuentasVisiblesCxP()).filter((g) => g.saldo > 0).reduce((s, g) => s + g.saldo, 0);
  igual(totalTodos(), totalGeneral(), 'encendido');
  igual(totalTodos(), 2150, 'encendido: valor');
  w.localStorage.setItem('cxp_incluir_socios', '0');
  igual(totalTodos(), totalGeneral(), 'apagado');
  igual(totalTodos(), 1650, 'apagado: valor (sin GERMAN)');
});
caso('CxP: Todos > Esta Semana y el periodo activo usan el mismo rango que Por Proveedor (sin obtenerInicioSemana ni helper local)', () => {
  const t = leer('js/cxp.js');
  afirmar(!/obtenerInicioSemana/.test(t), 'cxp.js ya no usa obtenerInicioSemana');
  afirmar(!/function obtenerInicioMes/.test(t), 'sin obtenerInicioMes local');
  afirmar(/obtenerRangoSemana/.test(t), 'usa obtenerRangoSemana');
});

// ── Parte 3: otros módulos ──
caso('Pagos, Cobros, Gastos, Destaraje y Ventas: filtrarPorSemana incluye lunes a domingo y excluye el lunes siguiente', () => {
  const modulos = [['js/pagos.js', 'filtrarPorSemana', 'fecha'], ['js/cobros.js', 'filtrarPorSemana', 'fecha'], ['js/gastos.js', 'filtrarPorSemana', 'fecha'],
    ['js/destaraje.js', 'filtrarPorSemana', 'fechaSalida'], ['js/ventas.js', 'filtrarPorSemanaVentas', 'fecha']];
  for (const [archivo, fn, campo] of modulos) {
    const m = leer(archivo).replace(/\r\n/g, '\n').match(new RegExp(`function ${fn}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    afirmar(m, `${archivo}: no se encontró ${fn}`);
    const w = crearContexto('2026-11-05', BASE);
    const f = vm.runInContext(`(${m[0].replace(/^function \w+/, 'function')})`, w);
    const regs = ['2026-11-01', '2026-11-02', '2026-11-08', '2026-11-09'].map((d) => ({ [campo]: d }));
    igual(f(regs, '2026-11-02').map((r) => r[campo]), ['2026-11-02', '2026-11-08'], archivo);
  }
});

(async () => {
  let fallos = 0;
  for (const c of casos) {
    try { await c.fn(); console.log('OK   ', c.nombre); } catch (e) { fallos++; console.log('FALLA', c.nombre, '\n     ', e.message); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos pasan`);
  process.exit(fallos ? 1 : 0);
})();
