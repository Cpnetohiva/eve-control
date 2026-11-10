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
// Para probar destaraje.js (construirRegistroDesdeFormulario y el datalist de Báscula) en el mismo contexto.
vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/destaraje.js'), 'utf8'), w, { filename: 'js/destaraje.js' });

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
  igual(norm('ENRIQUE HERNANDEZ VAZQUEZ'), 'ENRIQUE HERNANDEZ VAZQUEZ', 'ENRIQUE con apellidos');
  // 'ENRIQUE' suelto ya NO es un caso sin alias: Neto decidió que es JOSE ENRIQUE (ver los casos de variantes nuevas más abajo).
});

caso('variantesProveedor devuelve el canónico y sus alias (para consultas where in)', () => {
  const v = w.variantesProveedor('j. enrique');
  igual(v[0], 'JOSE ENRIQUE', 'primero el canónico');
  ['J.ENRIQUE', 'J. ENRIQUE', 'J ENRIQUE', 'JOSE ENRIQUE'].forEach((x) => afirmar(v.includes(x), `incluye ${x}`));
  igual(w.variantesProveedor('FRANCISCO'), ['FRANCISCO'], 'sin alias solo él mismo');
  igual(w.variantesProveedor('JUANA'), ['JUANA', 'JUANA G', 'JUANA G.0'], 'JUANA ahora tiene alias (JUANA G y JUANA G.0): el where in los incluye');
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


// ── Variantes nuevas (A7): ANTONIO HERNANDEZ, GERMAN, MARIO M, J.E./J/ENRIQUE y JUANA G ──
caso('a) ANTONIO HERNÁNDEZ en todas sus formas da ANTONIO HERNANDEZ (sin acento)', () => {
  [' antonio hernández ', 'ANTONIO HERNÁNDEZ', 'Antonio Hernandez', 'ANTONIO  HERNANDEZ', 'antonio hernandez'].forEach((v) => igual(norm(v), 'ANTONIO HERNANDEZ', JSON.stringify(v)));
});

caso('b) GERMÁN/german/German dan GERMAN; MARIO M./mario m dan MARIO M', () => {
  ['GERMÁN', 'german', 'German', ' GERMAN '].forEach((v) => igual(norm(v), 'GERMAN', JSON.stringify(v)));
  ['MARIO M.', 'mario m', 'Mario M', 'MARIO  M'].forEach((v) => igual(norm(v), 'MARIO M', JSON.stringify(v)));
});

caso('c) J.E., J. E., J, Enrique, ENRIQUE, J.ENRIQUE y Jose Enrique dan JOSE ENRIQUE', () => {
  ['J.E.', 'J. E.', 'J', 'j', 'Enrique', 'ENRIQUE', 'J.ENRIQUE', 'Jose Enrique'].forEach((v) => igual(norm(v), 'JOSE ENRIQUE', JSON.stringify(v)));
});

caso('d) Juana G, JUANA G., Juana G.0 y JUANA dan JUANA', () => {
  ['Juana G', 'JUANA G.', 'Juana G.0', 'JUANA', 'juana g . 0'].forEach((v) => igual(norm(v), 'JUANA', JSON.stringify(v)));
});

caso('e) NO se altera más allá de mayúsculas y espacios: otros nombres parecidos y un proveedor nuevo', () => {
  igual(norm('JOSE ENRIQUEZ'), 'JOSE ENRIQUEZ', 'JOSE ENRIQUEZ');
  igual(norm('JOSÉ LUIS'), 'JOSÉ LUIS', 'JOSÉ LUIS conserva su acento');
  igual(norm('JUANA GOVEA'), 'JUANA GOVEA', 'JUANA GOVEA');
  igual(norm('ENRIQUE HERNANDEZ VAZQUEZ'), 'ENRIQUE HERNANDEZ VAZQUEZ', 'ENRIQUE HERNANDEZ VAZQUEZ');
  igual(norm('ANTONIO'), 'ANTONIO', 'ANTONIO solo');
  igual(norm('MARIO MORANO'), 'MARIO MORANO', 'MARIO MORANO');
  igual(norm('GERMAN LOPEZ'), 'GERMAN LOPEZ', 'GERMAN LOPEZ');
  igual(norm('  pedro   perez '), 'PEDRO PEREZ', 'proveedor nuevo: solo mayúsculas y espacios');
  igual(norm('J.R. PLASTICOS'), 'J.R. PLASTICOS', 'J.R. PLASTICOS (con puntos, sin alias)');
  igual(norm('J LOPEZ'), 'J LOPEZ', 'J con apellido');
});

caso('f) los alias de antes siguen igual: JESUS y JESÚS dan JESÚS, FÉLIX y FELIX dan FELIX LOZANO, ARTURO da ARTURO LARA', () => {
  igual(norm('JESUS'), 'JESÚS', 'JESUS');
  igual(norm('JESÚS'), 'JESÚS', 'JESÚS');
  igual(norm('jesús'), 'JESÚS', 'jesús');
  igual(norm('FÉLIX'), 'FELIX LOZANO', 'FÉLIX');
  igual(norm('FELIX'), 'FELIX LOZANO', 'FELIX');
  igual(norm('ARTURO'), 'ARTURO LARA', 'ARTURO');
});

caso('claves de alias: cada una es distinta o igual a otra a propósito, y ninguna choca con un proveedor distinto ni con PROVEEDORES_COMUNES', () => {
  // La clave de búsqueda se reproduce igual que config.js: sin acentos, puntos -> espacio, espacios colapsados, mayúsculas.
  const clave = (v) => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  const porClave = {};
  Object.keys(w.PROVEEDORES_ALIAS).forEach((alias) => { (porClave[clave(alias)] = porClave[clave(alias)] || []).push(alias); });
  // Las que comparten clave deben apuntar al mismo canónico (J.ENRIQUE / J. ENRIQUE / J ENRIQUE; FÉLIX / FELIX; JOSE ENRIQUE).
  Object.keys(porClave).forEach((k) => {
    const destinos = new Set(porClave[k].map((a) => w.PROVEEDORES_ALIAS[a]));
    igual(destinos.size, 1, `la clave "${k}" (${porClave[k].join(', ')}) apunta a un solo canónico`);
  });
  igual(clave('J.E.'), 'J E', 'J.E. -> clave J E');
  igual(clave('JUANA G.'), clave('JUANA G'), 'JUANA G. y JUANA G comparten clave (intencional)');
  afirmar(clave('JUANA G.0') !== clave('JUANA G'), 'JUANA G.0 es otra clave');
  // Cada canónico nuevo existe como clave de sí mismo o es un proveedor de la lista: no se redirige a un nombre desconocido.
  const canonicos = new Set(Object.values(w.PROVEEDORES_ALIAS));
  igual(Array.from(canonicos).sort(), ['ANTONIO HERNANDEZ', 'ARTURO LARA', 'FELIX LOZANO', 'GERMAN', 'JESÚS', 'JOSE ENRIQUE', 'JUANA', 'MARIO M'], 'canónicos del alias');
  // PROVEEDORES_COMUNES: cada nombre sigue siendo su propio canónico (normalizarProveedor no lo cambia), en particular JESÚS con acento.
  w.PROVEEDORES_COMUNES.forEach((p) => igual(norm(p), p, 'PROVEEDORES_COMUNES: ' + p));
  afirmar(w.PROVEEDORES_COMUNES.includes('ANTONIO HERNANDEZ') && w.PROVEEDORES_COMUNES.includes('JESÚS'), 'ANTONIO HERNANDEZ agregado y JESÚS conserva su acento');
  // Ninguna clave nueva captura a un proveedor distinto: nombres reales parecidos no cambian
  ['ANTONIO', 'ANTONIO HERNANDEZ LOPEZ', 'GERMAN LOPEZ', 'GERMANO', 'MARIO', 'MARIO MORANO', 'MARIO MARTINEZ', 'JUANA GOVEA', 'JUANA GARCIA', 'JUANITA', 'JOSE', 'ENRIQUEZ', 'J.R. PLASTICOS']
    .forEach((n) => igual(norm(n), n, 'no capturado: ' + n));
});

caso('g) construirRegistroDesdeFormulario de destaraje.js guarda el proveedor unificado', () => {
  const base = { ticket: '1396', material: 'PET', kg: '100', fechaEntrada: '2026-10-01', fechaSalida: '2026-10-01' };
  igual(w.construirRegistroDesdeFormulario({ ...base, proveedor: 'ANTONIO HERNÁNDEZ' }).proveedor, 'ANTONIO HERNANDEZ', 'ANTONIO HERNÁNDEZ');
  igual(w.construirRegistroDesdeFormulario({ ...base, proveedor: 'GERMÁN' }).proveedor, 'GERMAN', 'GERMÁN');
  igual(w.construirRegistroDesdeFormulario({ ...base, proveedor: 'J.E.' }).proveedor, 'JOSE ENRIQUE', 'J.E.');
  igual(w.construirRegistroDesdeFormulario({ ...base, proveedor: 'JUANA G.0' }).proveedor, 'JUANA', 'JUANA G.0');
  igual(w.construirRegistroDesdeFormulario({ ...base, proveedor: 'MARIO M.' }).proveedor, 'MARIO M', 'MARIO M.');
});

caso('h) el datalist de Báscula (valoresUnicos) trae una sola opción con ANTONIO HERNÁNDEZ y ANTONIO HERNANDEZ', () => {
  const lista = w.valoresUnicos([[{ proveedor: 'ANTONIO HERNÁNDEZ' }, { proveedor: 'ANTONIO HERNANDEZ' }, { proveedor: 'J.E.' }, { proveedor: 'JUANA G' }, { proveedor: 'GERMÁN' }]], 'proveedor', w.PROVEEDORES_COMUNES);
  igual(lista.filter((p) => p.startsWith('ANTONIO')), ['ANTONIO HERNANDEZ'], 'una sola opción de ANTONIO');
  igual(lista.filter((p) => p.includes('ENRIQUE')), ['JOSE ENRIQUE'], 'J.E. se une a JOSE ENRIQUE');
  igual(lista.filter((p) => p.startsWith('JUANA')), ['JUANA'], 'JUANA G se une a JUANA');
  igual(lista.filter((p) => p.startsWith('GERMA')), ['GERMAN'], 'GERMÁN se une a GERMAN');
});

caso('i) unificarProveedorEnRegistros unifica en memoria registros viejos con las variantes nuevas, sin tocar lo demás', () => {
  const registros = [
    { id: 'a', proveedor: 'ANTONIO HERNÁNDEZ', kg: 10 }, { id: 'b', proveedor: 'ANTONIO HERNANDEZ', kg: 20 }, { id: 'c', proveedor: 'GERMÁN', kg: 1 },
    { id: 'd', proveedor: 'MARIO M.', kg: 2 }, { id: 'e', proveedor: 'J.E.', kg: 3 }, { id: 'f', proveedor: 'J', kg: 4 }, { id: 'g', proveedor: 'Enrique', kg: 5 },
    { id: 'h', proveedor: 'Juana G.0', kg: 6 }, { id: 'i', proveedor: 'JUANA GOVEA', kg: 7 }, { id: 'j', proveedor: 'PEDRO PEREZ', kg: 8 }
  ];
  w.unificarProveedorEnRegistros(registros);
  igual(registros.map((r) => r.proveedor), ['ANTONIO HERNANDEZ', 'ANTONIO HERNANDEZ', 'GERMAN', 'MARIO M', 'JOSE ENRIQUE', 'JOSE ENRIQUE', 'JOSE ENRIQUE', 'JUANA', 'JUANA GOVEA', 'PEDRO PEREZ'], 'proveedores unificados');
  igual(registros.map((r) => r.kg), [10, 20, 1, 2, 3, 4, 5, 6, 7, 8], 'kg intactos');
  const porProv = new Map(); registros.forEach((r) => porProv.set(r.proveedor, (porProv.get(r.proveedor) || 0) + r.kg));
  igual([porProv.get('ANTONIO HERNANDEZ'), porProv.get('JOSE ENRIQUE')], [30, 12], 'se agrupan bajo un solo nombre');
});

caso('j) un proveedor realmente nuevo se guarda sin trabas (sin alias, sin error, en mayúsculas) y aparece en el datalist', () => {
  const nuevo = w.construirRegistroDesdeFormulario({ ticket: '9001', proveedor: ' maría  fernanda ruiz ', material: 'PET', kg: '50', fechaEntrada: '2026-10-01', fechaSalida: '2026-10-01' });
  igual(nuevo.proveedor, 'MARÍA FERNANDA RUIZ', 'se guarda como lo escribió (mayúsculas y espacios limpios)');
  const lista = w.valoresUnicos([[{ proveedor: nuevo.proveedor }]], 'proveedor', w.PROVEEDORES_COMUNES);
  afirmar(lista.includes('MARÍA FERNANDA RUIZ'), 'aparece en las sugerencias');
  igual(w.variantesProveedor('MARÍA FERNANDA RUIZ'), ['MARÍA FERNANDA RUIZ'], 'sin variantes: solo él');
});

caso('variantesProveedor incluye las variantes nuevas (para consultas where in)', () => {
  const v = w.variantesProveedor('J.E.');
  igual(v[0], 'JOSE ENRIQUE', 'canónico primero');
  ['J.ENRIQUE', 'J.E.', 'J', 'ENRIQUE'].forEach((x) => afirmar(v.includes(x), 'incluye ' + x));
  afirmar(w.variantesProveedor('antonio hernández').includes('ANTONIO HERNANDEZ'), 'ANTONIO HERNANDEZ');
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
