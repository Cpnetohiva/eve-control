// Paridad de la normalización de materiales entre EVE Control (js/config.js: window.normalizarMaterial, con window.MATERIALES_ALIAS
// y window.CATALOGO_MATERIALES) y el Dashboard Ejecutivo (dashboard-ejecutivo/index.html: normMat, que antes era norm()).
// Sin navegador: se extrae por texto la lógica del HTML y se corre en vm (mismo método que verificar-paridad-sin-iva.js).
// Además de comparar las dos funciones, se corre calc() del Ejecutivo y la vista «KG por Mes y Material» de js/dashboard.js con los
// mismos tickets para comprobar que agrupan igual (caso real: P.P MOLIDO contra P.P. MOLIDO).
//
// Uso: node scripts/verificar-paridad-material.js [ruta/index.html]   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const HTML_RUTA = path.resolve(process.argv[2] || path.join(RAIZ, '..', 'dashboard-ejecutivo', 'index.html'));
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
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
function extraerLinea(nombre) {
  const m = html.match(new RegExp('^(?:const|let) ' + nombre + '\\s*=.*$', 'm'));
  return m ? m[0] : '';
}

// ── EVE Control: js/config.js y js/utils.js reales, más js/dashboard.js para la vista de Finanzas ──
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
  document: { getElementById: () => null, createElement: () => ({}), addEventListener() {} }, navigator: { onLine: true }, localStorage: { getItem: () => null, setItem() {} },
  firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
};
sandbox.window = sandbox; sandbox.EVE = {}; sandbox.EVE_MODULES = {};
vm.createContext(sandbox);
for (const a of ['js/config.js', 'js/utils.js', 'js/dashboard.js']) vm.runInContext(leer(a), sandbox, { filename: a });
const W = sandbox.window;
afirmar(typeof W.normalizarMaterial === 'function' && !!W.MATERIALES_ALIAS && Array.isArray(W.CATALOGO_MATERIALES), 'EVE Control: normalizarMaterial, MATERIALES_ALIAS y CATALOGO_MATERIALES cargados');

// ── Ejecutivo: normMat (o norm() en un respaldo anterior) y calc() ──
const LINEAS = ['num', 'fmt\\$2', 'fmt\\$', 'fmtN', 'fmtPct', 'esc', 'iso', 'fdate', 'norm', 'PROVEEDORES_SOCIOS', 'limpiaSocio', 'sum', 'MESES', 'MESES_L', 'UNIDAD_PZ',
  'dayDiff', 'inP', 'INCLUIR_SOCIOS'];
const FUNCS = ['esProveedorSocio', 'incluirSocios', 'grp', 'aging', 'calc', 'descuentoLineaVenta', 'subNetoLineaVenta'];
const lineas = LINEAS.map(extraerLinea), funcs = FUNCS.map(extraerFuncion);
afirmar(lineas.every(Boolean), 'constantes del HTML encontradas; faltan: ' + LINEAS.filter((n, i) => !lineas[i]).join(', '));
afirmar(funcs.every(Boolean), 'funciones del HTML encontradas; faltan: ' + FUNCS.filter((n, i) => !funcs[i]).join(', '));
const lineaAlias = extraerLinea('MATERIALES_ALIAS'), lineaNormMat = extraerLinea('normMat');
const tieneNormMat = !!(lineaAlias && lineaNormMat);
afirmar(tieneNormMat, 'el Ejecutivo define MATERIALES_ALIAS y normMat (con el respaldo anterior solo existe norm(), que no usa los alias)');
// Variables de bloque de las "const" no cruzan vm.runInContext entre llamadas: todo va en un solo script.
const ctx = { console: { warn() {}, info() {}, error() {}, log() {} }, localStorage: { getItem: () => null, removeItem() {} }, COL_FALLAS: [] };
vm.createContext(ctx);
vm.runInContext(`
  const HOY = '2026-11-10'; let DB = null, PER = { desde: '', hasta: '', label: '' };
  ${lineas.join('\n')}
  ${tieneNormMat ? lineaAlias + '\n' + lineaNormMat : ''}
  ${funcs.join('\n')}
  globalThis.api = { norm: ${tieneNormMat ? 'normMat' : 'norm'}, calc: (db, per) => { DB = db; PER = per; return calc(); } };
`, ctx);
const H = ctx.api;

// ── 1. La tabla de alias del Ejecutivo es la de EVE Control (mismas claves y canónicos) ──
if (tieneNormMat) {
  const tabla = vm.runInNewContext('(' + lineaAlias.replace(/^const MATERIALES_ALIAS\s*=\s*/, '').replace(/;\s*$/, '') + ')');
  afirmar(JSON.stringify(Object.entries(tabla).sort()) === JSON.stringify(Object.entries(W.MATERIALES_ALIAS).sort()), 'la tabla de alias del Ejecutivo es idéntica a window.MATERIALES_ALIAS de js/config.js');
}

// ── 2. Misma salida de normalizarMaterial y de la normalización del Ejecutivo para cada material, alias y variante ──
const base = new Set();
W.CATALOGO_MATERIALES.forEach((m) => base.add(m.nombre));
Object.entries(W.MATERIALES_ALIAS).forEach(([a, c]) => { base.add(a); base.add(c); });
['P.P MOLIDO', 'P.P. MOLIDO', 'p.p molido', 'p.p. molido', 'P.P  MOLIDO', ' P.P. MOLIDO ', 'P.P.  MOLIDO', '\tP.P MOLIDO\n', 'Bidón', 'BIDÓN', 'bidon', 'Garrafa Molida', 'multi lechero', 'Multi-Lechero', 'pet', ' PET ', '', '   ', null, undefined, 123].forEach((v) => base.add(v));
const variantes = (t) => {
  if (typeof t !== 'string' || !t) return [t];
  return [t, t.toLowerCase(), ' ' + t + ' ', t.replace(/ /g, '  '), t.charAt(0) + t.slice(1).toLowerCase()];
};
const casos = [];
base.forEach((t) => variantes(t).forEach((v) => casos.push(v)));
const distintos = [];
casos.forEach((t) => { const a = W.normalizarMaterial(t), b = H.norm(t); if (a !== b) distintos.push({ texto: t, evecontrol: a, ejecutivo: b }); });
afirmar(distintos.length === 0, `normalizarMaterial = normalización del Ejecutivo en ${casos.length} textos (difieren ${distintos.length}: ${JSON.stringify(distintos.slice(0, 6))})`);
// Casos nombrados (el real que motivó el ajuste)
[['P.P MOLIDO', 'P.P. MOLIDO'], ['P.P. MOLIDO', 'P.P. MOLIDO'], ['p.p molido', 'P.P. MOLIDO'], ['  P.P   MOLIDO ', 'P.P. MOLIDO'], ['GARRAFA', 'BIDON'], ['pead', 'DURO'], ['P.E..', 'P.E.'], ['Pet', 'PET']].forEach(([t, esperado]) => {
  afirmar(W.normalizarMaterial(t) === esperado, `EVE Control: «${t}» → «${esperado}»`);
  afirmar(H.norm(t) === esperado, `Ejecutivo: «${t}» → «${esperado}»`);
});
// Cada alias se resuelve a un nombre canónico que existe en el catálogo
Object.values(W.MATERIALES_ALIAS).forEach((c) => afirmar(W.CATALOGO_MATERIALES.some((m) => m.nombre === c), `el canónico «${c}» existe en el catálogo`));

// ── 3. calc() del Ejecutivo agrupa igual que Finanzas «KG por Mes y Material» (mismos tickets, mismos kg) ──
{
  const tickets = [
    { id: 'a', ticket: '1001', proveedor: 'P', material: 'P.P MOLIDO', kg: 700, fechaSalida: '2026-10-05' },
    { id: 'b', ticket: '1002', proveedor: 'P', material: 'P.P. MOLIDO', kg: 300, fechaSalida: '2026-10-06' },
    { id: 'c', ticket: '1003', proveedor: 'P', material: 'garrafa', kg: 50, fechaSalida: '2026-10-07' },
    { id: 'd', ticket: '1004', proveedor: 'P', material: 'BIDON', kg: 25, fechaSalida: '2026-10-08' },
    { id: 'e', ticket: '1005', proveedor: 'P', material: 'PET', kg: 10, fechaSalida: '2026-10-09' }];
  const cxp = tickets.map((t) => ({ id: 'x' + t.id, ticket: t.ticket, proveedor: 'P', material: t.material, kg: t.kg, total: t.kg * 5, fechaTicket: t.fechaSalida, saldo: 0, abonos: [] }));
  const db = { cxp, cxc: [], ventas: [{ id: 'v1', fecha: '2026-10-10', cliente: 'C', lineas: [{ material: 'P.P MOLIDO', cantidad: 5, precioUnitario: 1, subtotal: 5 }, { material: 'P.P. MOLIDO', cantidad: 5, precioUnitario: 1, subtotal: 5 }] }],
    destaraje: tickets, cobros: [], pagos: [], gastos: [], flujo: [], precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [] };
  const R = H.calc(db, { desde: '2026-10-01', hasta: '2026-10-31', label: 'x' });
  W.EVE.registrosDestaraje = tickets;
  const vista = W.EVE_DASHBOARD.calcularVistaKgPorMesMaterial();
  const finanzas = {};
  vista.filas.forEach((f) => { if (f['2026-10']) finanzas[f.clave] = f['2026-10']; });
  const ejec = {};
  Object.entries(R.kgBasculaMat).forEach(([m, x]) => { ejec[m] = x.kg; });
  afirmar(JSON.stringify(Object.entries(ejec).sort()) === JSON.stringify(Object.entries(finanzas).sort()), `kg por material: Ejecutivo ${JSON.stringify(ejec)} = Finanzas ${JSON.stringify(finanzas)}`);
  afirmar(ejec['P.P. MOLIDO'] === 1000 && !('P.P MOLIDO' in ejec), 'P.P MOLIDO y P.P. MOLIDO suman 1,000 kg bajo una sola clave');
  afirmar(ejec.BIDON === 75, 'garrafa y BIDON suman 75 kg bajo BIDON');
  afirmar(R.kgBascula === 1085, 'el total de kg no cambia (1,085)');
  afirmar(Object.keys(R.kgCxpMat).sort().join('|') === Object.keys(R.kgBasculaMat).sort().join('|') && R.kgSinCxp === 0, 'kg con cuenta por pagar agrupan igual que la báscula (sin kg sin CxP falsos)');
  afirmar(Object.keys(R.compras).sort().join('|') === Object.keys(ejec).sort().join('|'), 'compras por material agrupan igual');
  afirmar(R.ventas['P.P. MOLIDO'] && R.ventas['P.P. MOLIDO'].cant === 10 && !('P.P MOLIDO' in R.ventas), 'ventas por producto agrupan P.P MOLIDO con P.P. MOLIDO');
}

console.log(`${ok}/${total} comprobaciones correctas`);
if (ok !== total) process.exitCode = 1;
