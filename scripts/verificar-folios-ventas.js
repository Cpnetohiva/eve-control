// Folios de ventas: la captura toma el folio de un contador transaccional (contadores/V-AAAA) y nunca repite uno existente.
//
// Carga en un vm las funciones reales de js/ventas.js (y js/offline.js de forma estática) sobre el Firestore simulado de
// scripts/db-simulada.js (control optimista de transacciones, igual que Firestore: si dos capturas coinciden, una reintenta).
// Cada «dispositivo» tiene su propia lista en memoria (desactualizada a propósito) y comparte la misma base.
//
// Uso: node scripts/verificar-folios-ventas.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { crearDbSimulada } = require('./db-simulada');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8').replace(/\r\n/g, '\n');
const ventasSrc = leer('js/ventas.js');
let ok = 0, total = 0;
function afirmar(c, m) { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; }
function igual(a, b, m) { afirmar(JSON.stringify(a) === JSON.stringify(b), `${m}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); }

function extraer(nombre) {
  let inicio = ventasSrc.indexOf('async function ' + nombre + '(');
  if (inicio < 0) inicio = ventasSrc.indexOf('function ' + nombre + '(');
  if (inicio < 0) throw new Error('no se encontró ' + nombre);
  const fin = ventasSrc.indexOf('\n}\n', inicio);
  return ventasSrc.slice(inicio, fin + 3);
}
const FUNCIONES = ['formatearFolioVenta', 'maxNumeroFolioVentas', 'generarFolio', 'refContadorFolioVentas', 'folioVentaExisteEnFirestore',
  'maxNumeroFolioVentasEnFirestore', 'asignarFolioSinContador', 'asignarFolioVenta', 'verificarFolioDisponible', 'guardarVentaNueva',
  'subirContadorFolioVentasAlMenos', 'resolverFolioAlSincronizar'];
const CODIGO = (ventasSrc.match(/const INTENTOS_FOLIO_VENTA = \d+;/) || [''])[0] + '\n' + FUNCIONES.map(extraer).join('\n')
  + '\nthis.f = { ' + FUNCIONES.join(', ') + ' };';

// Un dispositivo: su propia memoria (ventas conocidas) y conexión, sobre la base compartida.
function dispositivo(db, { memoria = [], enLinea = true, fecha = '2026-10-12' } = {}) {
  const guardados = [];
  const sandbox = { console: { warn() {}, log() {}, error: console.error }, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, Map, Set, parseInt, Date };
  sandbox.window = sandbox;
  sandbox.navigator = { onLine: enLinea };
  sandbox.window.db = db;
  sandbox.window.COLECCIONES = { CONTADORES: 'contadores' };
  sandbox.window.EVE = { ventas: memoria.map((folio) => ({ folio })) };
  sandbox.window.obtenerFechaMexico = () => fecha;
  sandbox.window.guardarDato = async (coleccion, datos) => {
    guardados.push({ coleccion, datos: JSON.parse(JSON.stringify(datos)) });
    if (!sandbox.navigator.onLine) return 'offline_' + guardados.length;
    const ref = db.collection(coleccion).doc();
    await ref.set(datos);
    return ref.id;
  };
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox);
  return { f: sandbox.f, guardados, sandbox };
}
const sembrar = async (db, folios, extra) => { for (const folio of folios) await db.collection('ventas').doc().set({ folio, fecha: '2026-10-01', cliente: 'X', ...(extra || {}) }); };
const venta = (extra) => ({ cliente: 'ENVASES PLASTICOS', fecha: '2026-10-12', lineas: [], totalVenta: 0, ...(extra || {}) });
const foliosEnDb = (db) => Array.from(db.docs.entries()).filter(([r]) => r.startsWith('ventas/')).map(([, d]) => d.datos.folio).sort();
const contador = (db, anio = 2026) => (db.docs.get(`contadores/V-${anio}`) || {}).datos;

(async () => {
  // ── 0. El comportamiento anterior: dos memorias iguales dan el MISMO folio (la causa de V-2026-034 repetido) ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-033']);
    const a = dispositivo(db, { memoria: ['V-2026-033'] });
    const b = dispositivo(db, { memoria: ['V-2026-033'] });
    igual(a.f.generarFolio(a.sandbox.window.EVE.ventas, '2026-10-12'), b.f.generarFolio(b.sandbox.window.EVE.ventas, '2026-10-12'), 'máximo + 1 en memoria: ambos dispositivos obtienen el mismo folio (el problema)');
  }

  // ── 1. Dos capturas simultáneas desde dos dispositivos con memoria desactualizada: folios distintos ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-032', 'V-2026-033']);
    const a = dispositivo(db, { memoria: ['V-2026-033'] });
    const b = dispositivo(db, { memoria: ['V-2026-033'] });
    const va = venta({ cliente: 'A' });
    const vb = venta({ cliente: 'B' });
    await Promise.all([a.f.guardarVentaNueva(va), b.f.guardarVentaNueva(vb)]);
    afirmar(va.folio && vb.folio && va.folio !== vb.folio, `dos capturas simultáneas: folios distintos (${va.folio} y ${vb.folio})`);
    igual([va.folio, vb.folio].sort(), ['V-2026-034', 'V-2026-035'], 'son los dos siguientes al máximo existente');
    afirmar(db.estadisticas.reintentos >= 1, `hubo contención real y una transacción reintentó (${db.estadisticas.reintentos} reintento/s)`);
    igual(foliosEnDb(db), ['V-2026-032', 'V-2026-033', 'V-2026-034', 'V-2026-035'], 'ambas ventas quedaron guardadas, sin folios repetidos');
    igual(contador(db), { ultimo: 35, prefijo: 'V', anio: 2026 }, 'el contador quedó en el último folio asignado');
    afirmar(a.guardados.length + b.guardados.length === 2 && !a.guardados[0].datos.folioProvisional, 'con conexión no se marca provisional');
  }

  // ── 2. Muchas capturas a la vez desde tres dispositivos ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-033']);
    const disp = [dispositivo(db, { memoria: ['V-2026-033'] }), dispositivo(db, { memoria: [] }), dispositivo(db, { memoria: ['V-2026-010'] })];
    const ventas = [];
    const promesas = [];
    disp.forEach((d) => { for (let i = 0; i < 2; i++) { const v = venta(); ventas.push(v); promesas.push(d.f.guardarVentaNueva(v)); } });
    // las transacciones de la base simulada reintentan hasta 5 veces; con 6 simultáneas algunas pueden agotarlas, como en un uso extremo
    const resultados = await Promise.allSettled(promesas);
    const folios = ventas.filter((v, i) => resultados[i].status === 'fulfilled').map((v) => v.folio);
    afirmar(new Set(folios).size === folios.length && folios.length >= 3, `${folios.length} capturas simultáneas, todas con folio distinto: ${folios.sort().join(', ')}`);
    afirmar(new Set(foliosEnDb(db)).size === foliosEnDb(db).length, 'ningún folio repetido en la colección');
  }

  // ── 3. Folio que ya existe: se rechaza con aviso y no se guarda nada ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-034']);
    const d = dispositivo(db, { memoria: [] });
    let error = null;
    try { await d.f.guardarVentaNueva(venta({ folio: 'V-2026-034' })); } catch (e) { error = e; }
    afirmar(error && error.code === 'folio-duplicado' && /V-2026-034/.test(error.message) && /ya existe/.test(error.message), 'folio existente en la colección: se rechaza con aviso');
    afirmar(d.guardados.length === 0 && foliosEnDb(db).length === 1, 'no se escribió ninguna venta nueva ni se modificó la existente');
    // también si solo lo conoce la memoria del dispositivo (la venta aún no se ve en la consulta)
    const e = dispositivo(db, { memoria: ['V-2026-099'] });
    error = null;
    try { await e.f.verificarFolioDisponible('V-2026-099'); } catch (x) { error = x; }
    afirmar(error && error.code === 'folio-duplicado', 'folio presente solo en memoria: también se rechaza');
    let libre = null;
    try { await e.f.verificarFolioDisponible('V-2026-100'); libre = true; } catch (x) { libre = false; }
    afirmar(libre === true, 'un folio libre pasa la verificación');
  }

  // ── 4. Contador atrasado (p. ej. folios importados sin pasar por el contador): salta los que ya existen ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-033', 'V-2026-034', 'V-2026-035']);
    await db.collection('contadores').doc('V-2026').set({ ultimo: 33, prefijo: 'V', anio: 2026 });
    const d = dispositivo(db, { memoria: [] });
    const v = venta();
    await d.f.guardarVentaNueva(v);
    igual(v.folio, 'V-2026-036', 'contador en 33 con 034 y 035 ya existentes: se salta a 036');
    igual(contador(db).ultimo, 36, 'el contador alcanza al folio asignado');
  }

  // ── 5. Primera vez: el contador arranca en el máximo existente (Firestore o memoria) ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-001', 'V-2026-040', 'V-2025-099', 'V-2027-005']);
    const v1 = venta();
    await dispositivo(db, { memoria: [] }).f.guardarVentaNueva(v1);
    igual(v1.folio, 'V-2026-041', 'sin contador: arranca en el máximo de 2026 en Firestore (ignora otros años)');
    const db2 = crearDbSimulada();
    await sembrar(db2, ['V-2026-010']);
    const v2 = venta();
    await dispositivo(db2, { memoria: ['V-2026-050'] }).f.guardarVentaNueva(v2);
    igual(v2.folio, 'V-2026-051', 'si la memoria va por delante de Firestore, se respeta el mayor');
    const v3 = venta({ fecha: '2027-01-03' });
    await dispositivo(db, { memoria: [] , fecha: '2027-01-03' }).f.guardarVentaNueva(v3);
    igual(v3.folio, 'V-2027-006', 'otro año: su propio contador (contadores/V-2027)');
    afirmar(contador(db, 2026).ultimo === 41 && contador(db, 2027).ultimo === 6, 'cada año tiene su contador');
  }

  // ── 6. Sin conexión: folio PROVISIONAL, sin tocar Firestore (comportamiento de la cola offline) ──
  {
    const db = crearDbSimulada();
    const d = dispositivo(db, { memoria: ['V-2026-033'], enLinea: false });
    const v = venta();
    const id = await d.f.guardarVentaNueva(v);
    igual([v.folio, v.folioProvisional], ['V-2026-034', true], 'folio local marcado como provisional');
    afirmar(String(id).startsWith('offline_') && d.guardados.length === 1 && d.guardados[0].datos.folioProvisional === true, 'se encola con la marca de provisional');
    afirmar(db.docs.size === 0, 'no se consultó ni escribió Firestore (ni contador)');
  }

  // ── 7. Al sincronizar: se conserva el provisional si está libre; se reasigna si ya existe ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-033']);
    const d = dispositivo(db, { memoria: [] });
    const libre = await d.f.resolverFolioAlSincronizar('ventas', { folio: 'V-2026-034', folioProvisional: true, fecha: '2026-10-12', cliente: 'X' }, {});
    igual([libre.folio, 'folioProvisional' in libre], ['V-2026-034', false], 'provisional libre: conserva el folio y se quita la marca');
    igual(contador(db).ultimo, 34, 'el contador se sube hasta el folio conservado');

    await sembrar(db, ['V-2026-034']);
    const mapa = {};
    const ocupado = await d.f.resolverFolioAlSincronizar('ventas', { folio: 'V-2026-034', folioProvisional: true, fecha: '2026-10-12', cliente: 'Y' }, mapa);
    afirmar(ocupado.folio !== 'V-2026-034' && /^V-2026-\d{3}$/.test(ocupado.folio) && !('folioProvisional' in ocupado), `provisional ya existente: se reasigna uno definitivo (${ocupado.folio})`);
    igual(mapa, { 'V-2026-034': ocupado.folio }, 'queda el mapa provisional -> definitivo');
    afirmar(!(await d.f.verificarFolioDisponible(ocupado.folio).then(() => false, () => true)) , 'el folio definitivo asignado está libre');

    const cxc = await d.f.resolverFolioAlSincronizar('cuentas_por_cobrar', { folio: 'V-2026-034', ventaId: 'offline_77', material: 'PET' }, mapa);
    igual(cxc.folio, ocupado.folio, 'la CxC encolada de esa venta sigue el cambio de folio');
    const cxcAjena = await d.f.resolverFolioAlSincronizar('cuentas_por_cobrar', { folio: 'V-2026-034', ventaId: 'abc123', material: 'PET' }, mapa);
    igual(cxcAjena.folio, 'V-2026-034', 'la CxC de una venta que ya estaba en Firestore no se toca');
    const otra = { folio: 'V-2026-034', cliente: 'Z' };
    afirmar((await d.f.resolverFolioAlSincronizar('ventas', otra, mapa)) === otra, 'una venta sin marca de provisional se sube tal cual');
  }

  // ── 8. Sin permiso en contadores (reglas aún sin desplegar): no se bloquea la captura y el folio sigue verificado ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-033', 'V-2026-034']);
    db.runTransaction = async () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; };
    const d = dispositivo(db, { memoria: ['V-2026-033'] });
    const v = venta();
    await d.f.guardarVentaNueva(v);
    igual(v.folio, 'V-2026-035', 'permission-denied: cae al cálculo local pero verificado contra Firestore (salta el 034 que ya existe)');
    afirmar(!db.docs.has('contadores/V-2026'), 'no se crea ningún contador');
  }

  // ── 9. Estático ──
  const guardado = ventasSrc.slice(ventasSrc.indexOf('async function manejarEnvioFormulario'), ventasSrc.indexOf('function crearFormulario'));
  afirmar(guardado.includes('guardarVentaNueva(venta)') && !/venta\.folio = generarFolio/.test(guardado) && !/window\.guardarDato\('ventas'/.test(guardado), 'el formulario guarda con guardarVentaNueva (ya no asigna máximo + 1 en memoria)');
  const bloqueSinConexion = ventasSrc.slice(ventasSrc.indexOf('async function guardarVentaNueva'), ventasSrc.indexOf('async function subirContadorFolioVentasAlMenos'));
  afirmar((ventasSrc.match(/venta\.folio = generarFolio/g) || []).length === 1 && bloqueSinConexion.includes('venta.folio = generarFolio'), 'el folio por memoria solo se usa como provisional, dentro de guardarVentaNueva');
  afirmar((ventasSrc.match(/guardarDato\('ventas', venta\)/g) || []).length === 1 && bloqueSinConexion.includes("guardarDato('ventas', venta)"), 'la única alta de ventas nuevas pasa por guardarVentaNueva');
  afirmar(/window\.EVE_FOLIOS_VENTAS = \{/.test(ventasSrc), 'EVE_FOLIOS_VENTAS publicado para la sincronización');
  const offline = leer('js/offline.js');
  afirmar(offline.includes('window.EVE_FOLIOS_VENTAS.resolverFolioAlSincronizar(item.coleccion, item.datos, mapaFolios)') && offline.indexOf('resolverFolioAlSincronizar') < offline.indexOf('guardarDatoFirebase(item.coleccion, datosASubir)'), 'la cola offline resuelve el folio antes de subir cada operación');
  const reglas = leer('firestore.rules');
  afirmar(reglas.includes("docId.matches('V-.*') && puedeEscribir('ventas') && request.resource.data.ultimo >= 1")
    && reglas.includes("docId.matches('V-.*') && puedeEscribir('ventas') && request.resource.data.ultimo > resource.data.ultimo")
    && reglas.includes("docId.matches('V-.*') && puedeLeer('ventas')"), 'firestore.rules: el contador V-AAAA lo toca quien escribe Ventas y solo puede subir');
  afirmar(reglas.includes('allow create: if request.resource.data.ultimo == 1') && reglas.includes('request.resource.data.ultimo == resource.data.ultimo + 1'), 'firestore.rules: las reglas de COT-, OC- y RD- no cambiaron');

  console.log(`${ok}/${total} verificaciones correctas`);
})().catch((e) => { console.error('FALLA: ' + (e.stack || e.message)); process.exitCode = 1; });
