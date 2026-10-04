// Verificación de los alias de proveedor (J.ENRIQUE / J. ENRIQUE / J ENRIQUE -> JOSE ENRIQUE).
//
// Carga en un contexto vm js/config.js y js/utils.js y ejecuta casos sintéticos: la búsqueda del alias es insensible a
// mayúsculas, acentos, puntos y espacios repetidos; la unificación en memoria de registros históricos y de la colección
// 'proveedores' (saldo a favor) no reescribe nada y no duplica movimientos; los alias previos siguen igual.
//
// Uso: node scripts/verificar-proveedor-alias.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/pagos.js', 'js/admin-datos.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {};
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  return sandbox.window;
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  afirmar(a === b, `${mensaje}: esperado ${b}, obtenido ${a}`);
}

const w = crearContexto();
const norm = (valor) => w.normalizarProveedor(valor);

caso('Las cuatro variantes del catálogo van a JOSE ENRIQUE', () => {
  ['J.ENRIQUE', 'J. ENRIQUE', 'J ENRIQUE', 'JOSE ENRIQUE'].forEach((v) => igual(norm(v), 'JOSE ENRIQUE', v));
});

caso('Búsqueda insensible a mayúsculas, acentos, puntos y espacios repetidos', () => {
  ['j.enrique', 'J.Enrique', 'j. enrique', 'J  ENRIQUE', '  j . enrique  ', 'J..ENRIQUE', 'José Enrique', 'JOSÉ  ENRIQUE', 'jose enrique', 'J.  ENRIQUE']
    .forEach((v) => igual(norm(v), 'JOSE ENRIQUE', JSON.stringify(v)));
});

caso('Los alias que ya existían siguen igual', () => {
  igual(norm('ARTURO'), 'ARTURO LARA', 'ARTURO');
  igual(norm('arturo lara'), 'ARTURO LARA', 'ARTURO LARA');
  igual(norm('JESUS'), 'JESÚS', 'JESUS');
  igual(norm('Jesús'), 'JESÚS', 'Jesús');
  igual(norm('FÉLIX'), 'FELIX LOZANO', 'FÉLIX');
  igual(norm('felix'), 'FELIX LOZANO', 'felix');
});

caso('Proveedores sin alias solo se limpian (mayúsculas y espacios), no se tocan acentos ni puntos', () => {
  igual(norm('  juana  '), 'JUANA', 'JUANA');
  igual(norm('Francisco'), 'FRANCISCO', 'FRANCISCO');
  igual(norm('OLEGARIO'), 'OLEGARIO', 'OLEGARIO');
  igual(norm('J.R. PLASTICOS'), 'J.R. PLASTICOS', 'con puntos sin alias');
  igual(norm('JOSÉ LUIS'), 'JOSÉ LUIS', 'con acento sin alias');
  igual(norm(''), '', 'vacío');
  igual(norm(null), '', 'null');
});

caso('No confunde otros nombres que empiezan igual', () => {
  igual(norm('JOSE ENRIQUEZ'), 'JOSE ENRIQUEZ', 'ENRIQUEZ');
  igual(norm('J ENRIQUE LOPEZ'), 'J ENRIQUE LOPEZ', 'con apellido');
  igual(norm('ENRIQUE'), 'ENRIQUE', 'solo ENRIQUE');
});

caso('variantesProveedor devuelve el canónico y sus alias (para consultas where in)', () => {
  const v = w.variantesProveedor('j. enrique');
  igual(v[0], 'JOSE ENRIQUE', 'primero el canónico');
  ['J.ENRIQUE', 'J. ENRIQUE', 'J ENRIQUE', 'JOSE ENRIQUE'].forEach((x) => afirmar(v.includes(x), `incluye ${x}`));
  igual(w.variantesProveedor('JUANA'), ['JUANA'], 'sin alias solo él mismo');
  afirmar(w.variantesProveedor('FELIX').includes('FÉLIX') && w.variantesProveedor('FELIX').includes('FELIX LOZANO'), 'alias de FELIX LOZANO');
});

caso('unificarProveedorEnRegistros unifica en memoria y no toca otros campos', () => {
  const registros = [
    { id: 'a', proveedor: 'J.ENRIQUE', kg: 10 },
    { id: 'b', proveedor: 'JOSE ENRIQUE', kg: 20 },
    { id: 'c', proveedor: 'J. enrique', kg: 5 },
    { id: 'd', proveedor: 'JUANA', kg: 7 },
    { id: 'e', kg: 1 }
  ];
  w.unificarProveedorEnRegistros(registros);
  igual(registros.map((r) => r.proveedor), ['JOSE ENRIQUE', 'JOSE ENRIQUE', 'JOSE ENRIQUE', 'JUANA', undefined], 'proveedores');
  igual(registros.map((r) => r.kg), [10, 20, 5, 7, 1], 'kg intactos');
  const porProveedor = new Map();
  registros.filter((r) => r.proveedor).forEach((r) => porProveedor.set(r.proveedor, (porProveedor.get(r.proveedor) || 0) + r.kg));
  igual(porProveedor.get('JOSE ENRIQUE'), 35, 'agrupa los históricos bajo JOSE ENRIQUE');
  w.unificarProveedorEnRegistros(null);
  w.unificarProveedorEnRegistros(undefined);
});

caso('fusionarProveedoresDuplicados: un solo doc con los movimientos de ambos, sin duplicar', () => {
  const docs = [
    { id: 'J.ENRIQUE', nombre: 'J.ENRIQUE', ultimaActualizacion: '2026-09-01', saldoAFavor: [
      { monto: 500, grupoPagoId: 'g1', revertido: false },
      { monto: -200, grupoPagoId: 'g2', revertido: false }
    ] },
    { id: 'JOSE ENRIQUE', nombre: 'JOSE ENRIQUE', ultimaActualizacion: '2026-09-20', saldoAFavor: [
      { monto: 500, grupoPagoId: 'g1', revertido: true },
      { monto: 300, grupoPagoId: 'g3', revertido: false }
    ] },
    { id: 'JUANA', nombre: 'JUANA', saldoAFavor: [{ monto: 50, grupoPagoId: 'g9', revertido: false }] }
  ];
  const r = w.fusionarProveedoresDuplicados(docs);
  igual(r.map((p) => p.nombre).sort(), ['JOSE ENRIQUE', 'JUANA'], 'un doc por proveedor');
  const je = r.find((p) => p.nombre === 'JOSE ENRIQUE');
  igual(je.id, 'JOSE ENRIQUE', 'el doc canónico es la base');
  igual(je.saldoAFavor.length, 3, 'g1 no se cuenta dos veces');
  igual(je.saldoAFavor.find((m) => m.grupoPagoId === 'g1').revertido, true, 'gana el movimiento revertido');
  const total = je.saldoAFavor.filter((m) => !m.revertido).reduce((s, m) => s + m.monto, 0);
  igual(total, 100, 'saldo a favor = 300 − 200 (g1 revertido)');
});

caso('fusionarProveedoresDuplicados: si solo existe el doc con alias, se renombra a canónico en memoria', () => {
  const r = w.fusionarProveedoresDuplicados([{ id: 'J.ENRIQUE', nombre: 'J.ENRIQUE', saldoAFavor: [{ monto: 80, grupoPagoId: 'g1', revertido: false }] }]);
  igual(r.length, 1, 'un doc');
  igual(r[0].nombre, 'JOSE ENRIQUE', 'nombre canónico');
  igual(r[0].saldoAFavor.length, 1, 'movimientos conservados');
  igual(w.fusionarProveedoresDuplicados([]), [], 'lista vacía');
  igual(w.fusionarProveedoresDuplicados(undefined), [], 'undefined');
});

caso('Pagos: el datalist de proveedores deduplica J.ENRIQUE y JOSE ENRIQUE', () => {
  const lista = w.EVE_PAGOS.valoresUnicos(
    [[{ proveedor: 'J.ENRIQUE' }, { proveedor: 'J. ENRIQUE' }, { proveedor: 'JUANA' }], [{ proveedor: 'JOSE ENRIQUE' }]],
    'proveedor',
    w.PROVEEDORES_COMUNES
  );
  igual(lista.filter((p) => p.includes('ENRIQUE')), ['JOSE ENRIQUE'], 'una sola opción');
  afirmar(!lista.includes('J.ENRIQUE') && !lista.includes('J. ENRIQUE'), 'sin los alias');
  igual(w.EVE_PAGOS.valoresUnicos([[{ material: 'p.p molido' }]], 'material', []), ['P.P MOLIDO'], 'otros campos solo en mayúsculas');
});

caso('Pagos: obtenerTicketsPendientes con el proveedor tecleado como alias encuentra las CxP canónicas', () => {
  w.EVE.cuentasPorPagar = [
    { proveedor: 'JOSE ENRIQUE', ticket: '1', saldo: 100 },
    { proveedor: 'JOSE ENRIQUE', ticket: '2', saldo: 0 },
    { proveedor: 'JUANA', ticket: '3', saldo: 50 }
  ];
  ['J.ENRIQUE', 'j. enrique', 'JOSE ENRIQUE', 'José Enrique'].forEach((v) => {
    igual(w.EVE_PAGOS.obtenerTicketsPendientes(v).map((c) => c.ticket), ['1'], v);
  });
  igual(w.EVE_PAGOS.obtenerTicketsPendientes('JUANA').map((c) => c.ticket), ['3'], 'JUANA');
  igual(w.EVE_PAGOS.obtenerTicketsPendientes(''), [], 'vacío');
});

caso('Pagos: el filtro de proveedor acepta el alias tecleado', () => {
  const registros = [
    { ticket: '1', proveedor: 'JOSE ENRIQUE', material: 'X', fecha: '2026-09-01' },
    { ticket: '2', proveedor: 'JUANA', material: 'X', fecha: '2026-09-01' }
  ];
  const filtrar = (texto) => w.EVE_PAGOS.aplicarFiltrosTodos(registros, { proveedor: texto }).map((r) => r.ticket);
  igual(filtrar('J.ENRIQUE'), ['1'], 'alias');
  igual(filtrar('jose'), ['1'], 'texto parcial');
  igual(filtrar(''), ['1', '2'], 'sin filtro');
  igual(filtrar('juana'), ['2'], 'otro proveedor');
});

// ===== Riesgos de saldo a favor al fusionar documentos (proveedores) =====
const totalSaldo = (doc) => doc.saldoAFavor.filter((m) => !m.revertido).reduce((suma, m) => suma + m.monto, 0);
const docProv = (id, saldoAFavor) => ({ id, nombre: id, saldoAFavor });

caso('Riesgo 1: repeticiones legítimas dentro de un mismo documento se conservan (también con doc alias presente)', () => {
  const dos = [{ monto: 50, grupoPagoId: 'g1', revertido: false }, { monto: 50, grupoPagoId: 'g1', revertido: false }];
  const conAlias = w.fusionarProveedoresDuplicados([docProv('JOSE ENRIQUE', dos), docProv('J.ENRIQUE', [])]);
  igual(conAlias.length, 1, 'un doc fusionado');
  igual(conAlias[0].saldoAFavor.length, 2, 'las dos repeticiones siguen');
  igual(totalSaldo(conAlias[0]), 100, 'saldo');
  const alias = w.fusionarProveedoresDuplicados([docProv('J.ENRIQUE', dos.map((m) => ({ ...m }))), docProv('JOSE ENRIQUE', [])]);
  igual(totalSaldo(alias[0]), 100, 'saldo con las repeticiones en el alias');
});

caso('Riesgo 1b: entre documentos se toma el máximo de repeticiones, no la suma', () => {
  const mov = { monto: 50, grupoPagoId: 'g1', revertido: false };
  const r = w.fusionarProveedoresDuplicados([docProv('JOSE ENRIQUE', [{ ...mov }, { ...mov }]), docProv('J.ENRIQUE', [{ ...mov }])]);
  igual(r[0].saldoAFavor.length, 2, 'max(2, 1) = 2');
  igual(totalSaldo(r[0]), 100, 'saldo');
  const r2 = w.fusionarProveedoresDuplicados([docProv('JOSE ENRIQUE', [{ ...mov }]), docProv('J.ENRIQUE', [{ ...mov }, { ...mov }])]);
  igual(r2[0].saldoAFavor.length, 2, 'max(1, 2) = 2');
});

caso('Riesgo 2: copias entre documentos de un movimiento SIN grupoPagoId no se duplican (llave fecha|monto|motivo)', () => {
  const antiguo = { monto: 100, fecha: '2026-08-01', motivo: 'antiguo', revertido: false };
  const r = w.fusionarProveedoresDuplicados([docProv('J.ENRIQUE', [{ ...antiguo }]), docProv('JOSE ENRIQUE', [{ ...antiguo }])]);
  igual(r[0].saldoAFavor.length, 1, 'una sola copia');
  igual(totalSaldo(r[0]), 100, 'saldo = 100, no 200');
  const distintos = w.fusionarProveedoresDuplicados([
    docProv('J.ENRIQUE', [{ monto: 100, fecha: '2026-08-01', motivo: 'a', revertido: false }]),
    docProv('JOSE ENRIQUE', [{ monto: 100, fecha: '2026-08-02', motivo: 'a', revertido: false }])
  ]);
  igual(totalSaldo(distintos[0]), 200, 'movimientos distintos (otra fecha) sí se suman');
});

caso('Copias entre documentos con grupoPagoId: gana la revertida, esté en el doc canónico o en el alias', () => {
  const activo = { monto: 500, grupoPagoId: 'g1', revertido: false };
  const revertido = { monto: 500, grupoPagoId: 'g1', revertido: true, revertidoMotivo: 'error' };
  const enCanonico = w.fusionarProveedoresDuplicados([docProv('JOSE ENRIQUE', [{ ...revertido }]), docProv('J.ENRIQUE', [{ ...activo }])]);
  igual(enCanonico[0].saldoAFavor.map((m) => m.revertido), [true], 'revertida en el canónico');
  igual(totalSaldo(enCanonico[0]), 0, 'saldo 0');
  const enAlias = w.fusionarProveedoresDuplicados([docProv('JOSE ENRIQUE', [{ ...activo }]), docProv('J.ENRIQUE', [{ ...revertido }])]);
  igual(enAlias[0].saldoAFavor.map((m) => m.revertido), [true], 'revertida en el alias');
  igual(totalSaldo(enAlias[0]), 0, 'saldo 0');
  const sinRevertir = w.fusionarProveedoresDuplicados([docProv('JOSE ENRIQUE', [{ ...activo }]), docProv('J.ENRIQUE', [{ ...activo }])]);
  igual(totalSaldo(sinRevertir[0]), 500, 'activas en ambos: una sola vez');
});

caso('Riesgo 3: idsOrigen conserva los id de todos los documentos fusionados', () => {
  const r = w.fusionarProveedoresDuplicados([
    docProv('J.ENRIQUE', [{ monto: 300, grupoPagoId: 'g3', revertido: false }]),
    docProv('JOSE ENRIQUE', [{ monto: 500, grupoPagoId: 'g1', revertido: false }])
  ]);
  igual(r.length, 1, 'un doc en memoria');
  igual(r[0].id, 'JOSE ENRIQUE', 'base canónica');
  igual(r[0].idsOrigen.slice().sort(), ['J.ENRIQUE', 'JOSE ENRIQUE'], 'ambos ids');
  const soloAlias = w.fusionarProveedoresDuplicados([docProv('J ENRIQUE', [])]);
  igual(soloAlias[0].idsOrigen, ['J ENRIQUE'], 'solo el doc del alias');
});

caso('Riesgo 3: idsOrigen NO incluye JOSE ENRIQUEZ ni JOSÉ LUIS (solo nombre normalizado exactamente canónico)', () => {
  const r = w.fusionarProveedoresDuplicados([
    docProv('J.ENRIQUE', []), docProv('JOSE ENRIQUE', []), docProv('JOSE ENRIQUEZ', []), docProv('JOSÉ LUIS', []), docProv('JUANA', [])
  ]);
  igual(r.length, 4, 'JOSE ENRIQUEZ, JOSÉ LUIS y JUANA siguen separados');
  igual(r.find((p) => p.nombre === 'JOSE ENRIQUE').idsOrigen.slice().sort(), ['J.ENRIQUE', 'JOSE ENRIQUE'], 'solo los dos de JOSE ENRIQUE');
  igual(r.find((p) => p.nombre === 'JOSE ENRIQUEZ').idsOrigen, ['JOSE ENRIQUEZ'], 'ENRIQUEZ aparte');
  igual(r.find((p) => p.nombre === 'JOSÉ LUIS').idsOrigen, ['JOSÉ LUIS'], 'JOSÉ LUIS aparte');
});

caso('idsOrigen sobrevive a re-fusionar un doc ya fusionado (caché offline)', () => {
  const fusionado = w.fusionarProveedoresDuplicados([docProv('J.ENRIQUE', []), docProv('JOSE ENRIQUE', [])]);
  const deCache = JSON.parse(JSON.stringify(fusionado));
  const otra = w.fusionarProveedoresDuplicados(deCache);
  igual(otra[0].idsOrigen.slice().sort(), ['J.ENRIQUE', 'JOSE ENRIQUE'], 'ids conservados');
});

caso('Borrado de Admin: proveedores elimina todos los documentos de origen; otras colecciones, solo el id', () => {
  const memoria = w.fusionarProveedoresDuplicados([
    docProv('J.ENRIQUE', [{ monto: 300, grupoPagoId: 'g3', revertido: false }]),
    docProv('JOSE ENRIQUE', [{ monto: 500, grupoPagoId: 'g1', revertido: false }]),
    docProv('JUANA', [])
  ]);
  const aBorrar = w.EVE_ADMIN_DATOS.idsDocumentosParaBorrar('proveedores', memoria);
  igual(aBorrar.slice().sort(), ['J.ENRIQUE', 'JOSE ENRIQUE', 'JUANA'], 'proveedores');
  igual(w.EVE_ADMIN_DATOS.idsDocumentosParaBorrar('pagos', [{ id: 'p1' }, { id: 'p2' }, {}]), ['p1', 'p2'], 'otra colección, sin id se omite');
  igual(w.EVE_ADMIN_DATOS.idsDocumentosParaBorrar('proveedores', [{ id: 'X' }]), ['X'], 'doc sin idsOrigen (alta reciente en memoria)');
  igual(w.EVE_ADMIN_DATOS.idsDocumentosParaBorrar('precios', [{ id: 'a', idsOrigen: ['z'] }]), ['a'], 'idsOrigen solo cuenta en proveedores');
  const sobreviven = ['J.ENRIQUE', 'JOSE ENRIQUE', 'JUANA'].filter((id) => !aBorrar.includes(id));
  igual(sobreviven, [], 'no queda vivo ningún documento (el alias no reaparece)');
});

caso('Proveedor sin documento alias: comportamiento sin cambios', () => {
  const doc = docProv('JUANA', [{ monto: 50, grupoPagoId: 'g9', revertido: false }, { monto: 50, grupoPagoId: 'g9', revertido: false }]);
  const r = w.fusionarProveedoresDuplicados([doc]);
  igual(r.length, 1, 'un doc');
  afirmar(r[0] === doc, 'mismo objeto, no se clona');
  igual(r[0].saldoAFavor.length, 2, 'movimientos intactos, incluso repetidos');
  igual(r[0].nombre, 'JUANA', 'nombre');
  igual(r[0].idsOrigen, ['JUANA'], 'idsOrigen = su propio id');
  const canonicoSolo = w.fusionarProveedoresDuplicados([docProv('JOSE ENRIQUE', [{ monto: 10, grupoPagoId: 'g1', revertido: false }])]);
  igual(canonicoSolo[0].saldoAFavor.length, 1, 'JOSE ENRIQUE sin doc alias: igual');
  igual(w.fusionarProveedoresDuplicados([]), [], 'lista vacía');
});

caso('Sin alias nuevos nada cambia en proveedores sueltos', () => {
  const r = w.fusionarProveedoresDuplicados([{ id: 'FRANCISCO', nombre: 'FRANCISCO', saldoAFavor: [] }, { id: 'JUANA', nombre: 'JUANA' }]);
  igual(r.map((p) => p.nombre), ['FRANCISCO', 'JUANA'], 'igual');
});

let fallos = 0;
for (const { nombre, fn } of casos) {
  try {
    fn();
    console.log(`PASS  ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.log(`FAIL  ${nombre}\n      ${error.message}`);
  }
}
console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
