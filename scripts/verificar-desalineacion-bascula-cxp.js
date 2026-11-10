// Detección de tickets desalineados entre Báscula y CxP (js/cxp.js: detectarDesalineacionBasculaCxP, renderizarAvisoDesalineacion).
// Función pura (sin Firestore): empareja por número de ticket (material y kg, luego material, luego cualquier cuenta libre; cada CxP una
// vez), compara kg (0.01), material, proveedor y fecha de entrada, excluye el ticket V y no marca tickets sin CxP. El aviso de Admin se
// pinta con un DOM mínimo simulado; el render real en navegador no se prueba aquí.
//
// Uso: node scripts/verificar-desalineacion-bascula-cxp.js   (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');

// DOM mínimo: elementos con hijos, texto, atributos y listeners.
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.listeners = {}; this.id = ''; this.className = ''; this._texto = ''; this._html = ''; }
  set textContent(v) { this._texto = String(v); }
  get textContent() { return this._texto + this._html.replace(/<[^>]*>/g, '') + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this._html = String(v); if (v === '') { this.children = []; this._texto = ''; } }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(ev, fn) { this.listeners[ev] = fn; }
  remove() { const i = cuerpo.children.indexOf(this); if (i >= 0) cuerpo.children.splice(i, 1); }
}
const cuerpo = new El('body');

function crearContexto(permisos) {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { createElement: (t) => new El(t), getElementById: (id) => cuerpo.children.find((c) => c.id === id) || null, body: cuerpo },
    navigator: { onLine: true },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorPagar: [], registrosDestaraje: [], registrosDestarajeRaw: [], registrosPagos: [], proveedores: [], precios: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ['js/config.js', 'js/utils.js', 'js/cxp.js']) vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  const w = sandbox.window;
  w.puedeEscribir = (m) => permisos[m] === 'escritura';
  w.puedeLeer = (m) => permisos[m] === 'escritura' || permisos[m] === 'lectura';
  w.db = { collection: () => { throw new Error('el aviso no debe leer Firestore'); } };
  return w;
}
const ADMIN = { cxp: 'escritura', destaraje: 'escritura' };

const bas = (ticket, proveedor, material, kg, fechaEntrada, extra) => ({ id: 'b' + ticket + material, ticket, proveedor, material, kg, fechaEntrada: fechaEntrada || '2026-10-01', fechaSalida: fechaEntrada || '2026-10-01', ...extra });
const cxp = (ticket, proveedor, material, kg, fechaTicket, extra) => ({ id: 'c' + ticket + material, ticket, proveedor, material, kg, fechaTicket: fechaTicket || '2026-10-01', total: 999, saldo: 999, abonos: [], ...extra });

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (r, e, m) => afirmar(JSON.stringify(r) === JSON.stringify(e), `${m}: esperado ${JSON.stringify(e)}, obtenido ${JSON.stringify(r)}`);
const detectar = (w, b, c, h) => w.EVE_CXP.detectarDesalineacionBasculaCxP(b, c, h);
const campos = (lista) => lista.map((d) => `${d.ticket}:${d.campo}`);

caso('d) ticket 1504: PET en Báscula y CRISTAL CON VERDE en CxP se marca por material', () => {
  const w = crearContexto(ADMIN);
  const r = detectar(w, [bas('1504', 'PROV A', 'PET', 1000)], [cxp('1504', 'PROV A', 'CRISTAL CON VERDE', 1000)]);
  igual(campos(r), ['1504:material'], 'solo material');
  igual([r[0].bascula, r[0].cxp], [w.normalizarMaterial('PET'), w.normalizarMaterial('CRISTAL CON VERDE')], 'valores');
});

caso('d) tickets 1066, 1069 y 1119: GUSTAVO en Báscula y GERMAN en CxP se marcan por proveedor', () => {
  const w = crearContexto(ADMIN);
  const tickets = ['1066', '1069', '1119'];
  const r = detectar(w, tickets.map((t) => bas(t, 'GUSTAVO', 'PET', 500)), tickets.map((t) => cxp(t, 'GERMAN', 'PET', 500)));
  igual(campos(r), ['1066:proveedor', '1069:proveedor', '1119:proveedor'], 'tres tickets por proveedor');
  igual([r[0].bascula, r[0].cxp], ['GUSTAVO', 'GERMAN'], 'valores');
});

caso('d) J.ENRIQUE contra JOSE ENRIQUE no se marca (alias); la igualdad exacta tampoco', () => {
  const w = crearContexto(ADMIN);
  igual(detectar(w, [bas('2001', 'J.ENRIQUE', 'PET', 100)], [cxp('2001', 'JOSE ENRIQUE', 'PET', 100)]), [], 'alias');
  igual(detectar(w, [bas('2002', 'PROV', 'PET', 100.005)], [cxp('2002', 'PROV', 'pet', 100)]), [], 'igualdad exacta (kg con tolerancia 0.01, material normalizado)');
});

caso('d) ticket sin CxP no se marca (pendiente de aprobar); el ticket V se excluye', () => {
  const w = crearContexto(ADMIN);
  igual(detectar(w, [bas('3001', 'PROV', 'PET', 100), bas('V', 'CLIENTE', 'PET', 50)], [cxp('V', 'OTRO', 'HDPE', 7)]), [], 'sin CxP y ticket V');
});

caso('d) CxP sin renglón en Báscula se marca con el motivo "CxP sin renglón en Báscula"', () => {
  const w = crearContexto(ADMIN);
  const r = detectar(w, [], [cxp('4001', 'PROV', 'PET', 100)]);
  igual(campos(r), ['4001:renglón'], 'campo');
  igual(r[0].bascula, 'CxP sin renglón en Báscula', 'motivo');
});

caso('d) ticket con dos materiales: se empareja por material (no marca falsas diferencias) y marca solo el que difiere', () => {
  const w = crearContexto(ADMIN);
  const b = [bas('5001', 'PROV', 'PET', 1000), bas('5001', 'PROV', 'BIDON', 200)];
  const alineado = [cxp('5001', 'PROV', 'BIDON', 200), cxp('5001', 'PROV', 'PET', 1000)];
  igual(detectar(w, b, alineado), [], 'emparejado por material, sin importar el orden');
  const conKg = [cxp('5001', 'PROV', 'BIDON', 250), cxp('5001', 'PROV', 'PET', 1000)];
  const r = detectar(w, b, conKg);
  igual(campos(r), ['5001:kg'], 'solo el kg del BIDON');
  igual([r[0].bascula, r[0].cxp], [200, 250], 'valores');
  // cada CxP se usa una sola vez: dos renglones iguales con una sola CxP no marcan el segundo (pendiente de aprobar)
  igual(detectar(w, [bas('5002', 'P', 'PET', 10), bas('5002', 'P', 'PET', 10)], [cxp('5002', 'P', 'PET', 10)]), [], 'renglón sobrante = pendiente');
  // y dos CxP con un renglón: la que sobra se marca sin renglón
  igual(campos(detectar(w, [bas('5003', 'P', 'PET', 10)], [cxp('5003', 'P', 'PET', 10, '2026-10-01', { id: 'x1' }), cxp('5003', 'P', 'PET', 10, '2026-10-01', { id: 'x2' })])), ['5003:renglón'], 'CxP que sobra');
});

caso('d) kg distinto (más de 0.01) y fecha de entrada distinta se marcan', () => {
  const w = crearContexto(ADMIN);
  const r = detectar(w, [bas('6001', 'PROV', 'PET', 1000, '2026-10-01'), bas('6002', 'PROV', 'PET', 500, '2026-10-02')],
    [cxp('6001', 'PROV', 'PET', 1000.5, '2026-10-01'), cxp('6002', 'PROV', 'PET', 500, '2026-10-04')]);
  igual(campos(r), ['6001:kg', '6002:fecha de entrada'], 'kg y fecha');
  igual([r[1].bascula, r[1].cxp], ['2026-10-02', '2026-10-04'], 'fechas');
});

caso('d) empareja por número de ticket, no por proveedor; las CxP de saldo inicial no cuentan', () => {
  const w = crearContexto(ADMIN);
  const r = detectar(w, [bas('7001', 'GUSTAVO', 'PET', 10)], [cxp('7001', 'GERMAN', 'PET', 10), cxp('7001', 'X', 'PET', 1, '2026-10-01', { aprobacion: { tipo: 'saldo_inicial' }, id: 'si' })]);
  igual(campos(r), ['7001:proveedor'], 'proveedor distinto; el saldo inicial se ignora');
});

caso('d) editadoPor y fecha salen de historial_cambios solo si ya está en memoria; sin historial quedan vacíos', () => {
  const w = crearContexto(ADMIN);
  const b = [bas('8001', 'GUSTAVO', 'PET', 10)], c = [cxp('8001', 'GERMAN', 'PET', 10)];
  igual([detectar(w, b, c)[0].editadoPor, detectar(w, b, c)[0].fecha], ['', ''], 'sin historial');
  const historial = [
    { coleccion: 'destaraje', accion: 'edicion', valorNuevo: { ticket: '8001' }, usuario: 'operador1', timestamp: '2026-10-05T10:00:00.000Z' },
    { coleccion: 'destaraje', accion: 'edicion', valorNuevo: { ticket: '8001' }, usuario: 'operador2', timestamp: '2026-10-06T09:00:00.000Z' },
    { coleccion: 'destaraje', accion: 'edicion', valorNuevo: { ticket: '9999' }, usuario: 'otro', timestamp: '2026-10-07T09:00:00.000Z' }
  ];
  const d = detectar(w, b, c, historial)[0];
  igual([d.editadoPor, d.fecha], ['operador2', '2026-10-06T09:00:00.000Z'], 'la edición más reciente del ticket');
  const llaves = Object.keys(d).sort();
  igual(llaves, ['bascula', 'campo', 'cxp', 'editadoPor', 'fecha', 'ticket'], 'forma del resultado, sin montos');
});

// ── e) el aviso ──
function conAviso(permisos, b, c) {
  cuerpo.children = [];
  const w = crearContexto(permisos);
  w.EVE.registrosDestaraje = b; w.EVE.cuentasPorPagar = c;
  const div = new El('div'); div.id = 'aviso'; cuerpo.appendChild(div);
  const n = w.EVE_CXP.renderizarAvisoDesalineacion(div);
  return { w, div, n };
}
const DESALINEADOS = [bas('1504', 'P', 'PET', 10), bas('1066', 'GUSTAVO', 'PET', 5), bas('1067', 'P', 'PET', 5)];
const CUENTAS = [cxp('1504', 'P', 'CRISTAL CON VERDE', 10), cxp('1066', 'GERMAN', 'PET', 5), cxp('1067', 'P', 'PET', 5)];

caso('e) el aviso cuenta tickets distintos, trae el botón Ver y no muestra montos', () => {
  const { div, n } = conAviso(ADMIN, [...DESALINEADOS, bas('1504', 'P', 'PET', 10)], [...CUENTAS]);
  igual(n, 2, 'dos tickets con diferencias (1504 y 1066)');
  igual(div.style.display === 'none', false, 'visible');
  afirmar(div.textContent.startsWith('2 tickets con diferencias entre Báscula y CxP'), `texto: ${div.textContent}`);
  igual(div.children.map((c) => c.textContent), ['2 tickets con diferencias entre Báscula y CxP', 'Ver'], 'texto y botón Ver');
  const uno = conAviso(ADMIN, [DESALINEADOS[0]], [CUENTAS[0]]);
  igual(uno.div.children[0].textContent, '1 ticket con diferencias entre Báscula y CxP', 'singular');
  afirmar(!/\$|total|saldo|999/i.test(div.textContent), 'sin montos');
});

caso('e) el botón Ver abre el modal con ticket, campo, valor en Báscula, valor en CxP, quién y cuándo, sin montos', () => {
  const { w, div } = conAviso(ADMIN, DESALINEADOS, CUENTAS);
  div.children[1].listeners.click();
  const modal = cuerpo.children.find((c) => c.id === 'desalineacion-overlay');
  afirmar(!!modal, 'se abrió el modal');
  const texto = modal.textContent;
  ['Ticket', 'Campo', 'En Báscula', 'En CxP', 'Editó', 'Cuándo', '1504', 'material', 'CRISTAL CON VERDE', '1066', 'proveedor', 'GUSTAVO', 'GERMAN'].forEach((t) => afirmar(texto.includes(t), `el modal debe incluir "${t}"`));
  afirmar(!/\$|999|total|saldo/i.test(texto), 'el modal no trae montos');
  // cerrar
  modal.children[0].children[modal.children[0].children.length - 1].listeners.click();
  igual(cuerpo.children.some((c) => c.id === 'desalineacion-overlay'), false, 'se cierra');
  void w;
});

caso('e) aparece solo con permisos de lectura de cxp y de destaraje; el operador nunca lo ve', () => {
  igual(conAviso(ADMIN, DESALINEADOS, CUENTAS).n, 2, 'Admin');
  igual(conAviso({ cxp: 'lectura', destaraje: 'lectura' }, DESALINEADOS, CUENTAS).n, 2, 'lectura de ambos');
  const operador = conAviso({ destaraje: 'escritura' }, DESALINEADOS, CUENTAS);
  igual([operador.n, operador.div.style.display, operador.div.children.length], [0, 'none', 0], 'operador sin cxp: oculto y vacío');
  igual(conAviso({ cxp: 'escritura' }, DESALINEADOS, CUENTAS).n, 0, 'sin lectura de destaraje');
});

caso('e) se recalcula con los datos en memoria y desaparece al alinear; sin lecturas nuevas de Firestore', () => {
  cuerpo.children = [];
  const w = crearContexto(ADMIN);
  w.EVE.registrosDestaraje = [bas('1504', 'P', 'PET', 10)]; w.EVE.cuentasPorPagar = [cxp('1504', 'P', 'CRISTAL CON VERDE', 10)];
  const div = new El('div'); cuerpo.appendChild(div);
  igual(w.EVE_CXP.renderizarAvisoDesalineacion(div), 1, 'con diferencia');
  w.EVE.cuentasPorPagar[0].material = 'PET';   // se alinea (por ejemplo, tras corregir la CxP)
  igual([w.EVE_CXP.renderizarAvisoDesalineacion(div), div.style.display, div.children.length], [0, 'none', 0], 'desaparece al alinear');
  w.EVE.registrosDestaraje.push(bas('1600', 'P', 'PET', 3)); w.EVE.cuentasPorPagar.push(cxp('1600', 'Q', 'PET', 3));
  igual(w.EVE_CXP.renderizarAvisoDesalineacion(div), 1, 'reaparece con datos nuevos en memoria');
  // w.db.collection lanza si se usa: llegó hasta aquí sin leer Firestore
});

caso('e) cableado: Báscula y CxP pintan el aviso en cada render y el operador no lo recibe (permisos)', () => {
  const des = fs.readFileSync(path.join(RAIZ, 'js/destaraje.js'), 'utf8');
  const cx = fs.readFileSync(path.join(RAIZ, 'js/cxp.js'), 'utf8');
  afirmar(/function renderizarVista\(\) \{\r?\n\s*if \(window\.EVE_CXP && window\.EVE_CXP\.renderizarAvisoDesalineacion\)/.test(des), 'Báscula lo recalcula en cada renderizarVista');
  afirmar(/destaraje-aviso-desalineacion/.test(des) && /cxp-aviso-desalineacion/.test(cx), 'contenedores en Báscula y en CxP');
  afirmar(/function renderizarVistaActiva\(\) \{\r?\n\s*renderizarAvisoDesalineacion/.test(cx), 'CxP lo recalcula en cada renderizarVistaActiva');
  const fn = cx.slice(cx.indexOf('function renderizarAvisoDesalineacion'), cx.indexOf('function abrirModalDesalineacion'));
  afirmar(/puedeLeer\('cxp'\)/.test(fn) && /puedeLeer\('destaraje'\)/.test(fn), 'exige lectura de cxp y de destaraje');
  afirmar(!/window\.db|collection\(|\.get\(\)/.test(fn + cx.slice(cx.indexOf('function detectarDesalineacionBasculaCxP'), cx.indexOf('function renderizarAvisoDesalineacion'))), 'sin lecturas de Firestore');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FAIL ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
