// Folios de ventas: la captura calcula el folio de forma local (máximo + 1 entre la memoria y Firestore), verifica en Firestore que
// esté libre antes de guardar y rechaza con aviso un folio que ya existe. El contador transaccional contadores/V-AAAA quedó
// DESACTIVADO (necesita reglas desplegadas): ninguna ruta activa lo usa.
//
// Carga en un vm las funciones reales de js/ventas.js sobre el Firestore simulado de scripts/db-simulada.js. Cada «dispositivo» tiene
// su propia lista en memoria (desactualizada a propósito) y comparte la misma base.
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
const FUNCIONES = ['formatearFolioVenta', 'maxNumeroFolioVentas', 'generarFolio', 'folioVentaExisteEnFirestore', 'maxNumeroFolioVentasEnFirestore',
  'asignarFolioVenta', 'verificarFolioDisponible', 'guardarVentaNueva', 'resolverFolioAlSincronizar',
  'refContadorFolioVentas', 'asignarFolioConContadorDesactivado', 'subirContadorFolioVentasAlMenos'];
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
// La base simulada cuenta las transacciones: el contador desactivado no debe usarse nunca
function espiarTransacciones(db) { db.transaccionesUsadas = 0; const original = db.runTransaction.bind(db); db.runTransaction = (fn) => { db.transaccionesUsadas++; return original(fn); }; }

(async () => {
  // ── 0. El problema original: dos memorias iguales dan el MISMO folio con el máximo + 1 solo en memoria ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-033']);
    const a = dispositivo(db, { memoria: ['V-2026-033'] });
    const b = dispositivo(db, { memoria: ['V-2026-033'] });
    igual(a.f.generarFolio(a.sandbox.window.EVE.ventas, '2026-10-12'), b.f.generarFolio(b.sandbox.window.EVE.ventas, '2026-10-12'), 'solo con la memoria ambos dispositivos obtienen el mismo folio (el problema)');
  }

  // ── 1. Un dispositivo con la lista desactualizada ya no repite el folio de otro: lee Firestore ──
  {
    const db = crearDbSimulada();
    espiarTransacciones(db);
    await sembrar(db, ['V-2026-032', 'V-2026-033']);
    const a = dispositivo(db, { memoria: ['V-2026-033'] });
    const b = dispositivo(db, { memoria: ['V-2026-033'] }); // no ve lo que captura A
    const va = venta({ cliente: 'A' });
    await a.f.guardarVentaNueva(va);
    const vb = venta({ cliente: 'B' });
    await b.f.guardarVentaNueva(vb);
    igual([va.folio, vb.folio], ['V-2026-034', 'V-2026-035'], 'B (memoria desactualizada) recibe el siguiente folio libre de Firestore, no el 034 de A');
    igual(foliosEnDb(db), ['V-2026-032', 'V-2026-033', 'V-2026-034', 'V-2026-035'], 'ambas ventas quedaron guardadas sin folios repetidos');
    afirmar(!va.folioProvisional && !vb.folioProvisional, 'con conexión no se marca provisional');
    afirmar(db.transaccionesUsadas === 0 && !db.docs.has('contadores/V-2026'), 'no se usa ninguna transacción ni el contador contadores/V-AAAA');
  }

  // ── 2. Folio que ya existe: se rechaza con aviso y no se guarda nada ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-034']);
    const d = dispositivo(db, { memoria: [] });
    let error = null;
    try { await d.f.guardarVentaNueva(venta({ folio: 'V-2026-034' })); } catch (e) { error = e; }
    afirmar(error && error.code === 'folio-duplicado' && /V-2026-034/.test(error.message) && /ya existe/.test(error.message), 'folio existente en la colección: se rechaza con aviso');
    afirmar(d.guardados.length === 0 && foliosEnDb(db).length === 1, 'no se escribió ninguna venta nueva ni se modificó la existente');
    const e = dispositivo(db, { memoria: ['V-2026-099'] });
    error = null;
    try { await e.f.verificarFolioDisponible('V-2026-099'); } catch (x) { error = x; }
    afirmar(error && error.code === 'folio-duplicado', 'folio presente solo en memoria: también se rechaza');
    let libre = null;
    try { await e.f.verificarFolioDisponible('V-2026-100'); libre = true; } catch (x) { libre = false; }
    afirmar(libre === true, 'un folio libre pasa la verificación');
  }

  // ── 3. Salta los folios que ya existen (p. ej. escritos por el importador) ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-033', 'V-2026-034', 'V-2026-035']);
    const d = dispositivo(db, { memoria: ['V-2026-033'] });
    const v = venta();
    await d.f.guardarVentaNueva(v);
    igual(v.folio, 'V-2026-036', 'el siguiente libre después de los existentes');
  }

  // ── 4. Máximo entre Firestore y memoria, por año ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-001', 'V-2026-040', 'V-2025-099', 'V-2027-005']);
    const v1 = venta();
    await dispositivo(db, { memoria: [] }).f.guardarVentaNueva(v1);
    igual(v1.folio, 'V-2026-041', 'máximo de 2026 en Firestore + 1 (ignora otros años)');
    const db2 = crearDbSimulada();
    await sembrar(db2, ['V-2026-010']);
    const v2 = venta();
    await dispositivo(db2, { memoria: ['V-2026-050'] }).f.guardarVentaNueva(v2);
    igual(v2.folio, 'V-2026-051', 'si la memoria va por delante de Firestore, se respeta el mayor');
    const v3 = venta({ fecha: '2027-01-03' });
    await dispositivo(db, { memoria: [], fecha: '2027-01-03' }).f.guardarVentaNueva(v3);
    igual(v3.folio, 'V-2027-006', 'otro año: su propia numeración');
  }

  // ── 5. Sin conexión: folio PROVISIONAL, sin tocar Firestore (comportamiento de la cola offline) ──
  {
    const db = crearDbSimulada();
    const d = dispositivo(db, { memoria: ['V-2026-033'], enLinea: false });
    const v = venta();
    const id = await d.f.guardarVentaNueva(v);
    igual([v.folio, v.folioProvisional], ['V-2026-034', true], 'folio local marcado como provisional');
    afirmar(String(id).startsWith('offline_') && d.guardados.length === 1 && d.guardados[0].datos.folioProvisional === true, 'se encola con la marca de provisional');
    afirmar(db.docs.size === 0, 'no se consultó ni escribió Firestore');
  }

  // ── 6. Al sincronizar: se conserva el provisional si está libre; se reasigna si ya existe ──
  {
    const db = crearDbSimulada();
    espiarTransacciones(db);
    await sembrar(db, ['V-2026-033']);
    const d = dispositivo(db, { memoria: [] });
    const libre = await d.f.resolverFolioAlSincronizar('ventas', { folio: 'V-2026-034', folioProvisional: true, fecha: '2026-10-12', cliente: 'X' }, {});
    igual([libre.folio, 'folioProvisional' in libre], ['V-2026-034', false], 'provisional libre: conserva el folio y se quita la marca');
    await sembrar(db, ['V-2026-034']);
    const mapa = {};
    const ocupado = await d.f.resolverFolioAlSincronizar('ventas', { folio: 'V-2026-034', folioProvisional: true, fecha: '2026-10-12', cliente: 'Y' }, mapa);
    afirmar(ocupado.folio !== 'V-2026-034' && /^V-2026-\d{3}$/.test(ocupado.folio) && !('folioProvisional' in ocupado), `provisional ya existente: se reasigna uno definitivo (${ocupado.folio})`);
    igual(mapa, { 'V-2026-034': ocupado.folio }, 'queda el mapa provisional -> definitivo');
    afirmar(await d.f.verificarFolioDisponible(ocupado.folio).then(() => true, () => false), 'el folio definitivo asignado está libre');
    const cxc = await d.f.resolverFolioAlSincronizar('cuentas_por_cobrar', { folio: 'V-2026-034', ventaId: 'offline_77', material: 'PET' }, mapa);
    igual(cxc.folio, ocupado.folio, 'la CxC encolada de esa venta sigue el cambio de folio');
    const cxcAjena = await d.f.resolverFolioAlSincronizar('cuentas_por_cobrar', { folio: 'V-2026-034', ventaId: 'abc123', material: 'PET' }, mapa);
    igual(cxcAjena.folio, 'V-2026-034', 'la CxC de una venta que ya estaba en Firestore no se toca');
    const otra = { folio: 'V-2026-034', cliente: 'Z' };
    afirmar((await d.f.resolverFolioAlSincronizar('ventas', otra, mapa)) === otra, 'una venta sin marca de provisional se sube tal cual');
    afirmar(db.transaccionesUsadas === 0 && !db.docs.has('contadores/V-2026'), 'la sincronización tampoco usa el contador');
  }

  // ── 7. El contador desactivado sigue disponible como función aparte (para reactivarlo) y no se llama desde ninguna ruta activa ──
  {
    const db = crearDbSimulada();
    await sembrar(db, ['V-2026-033']);
    const d = dispositivo(db, { memoria: [] });
    igual(await d.f.asignarFolioConContadorDesactivado('2026-10-12'), 'V-2026-034', 'la función desactivada conserva su comportamiento si se reactiva');
    igual((db.docs.get('contadores/V-2026') || {}).datos, { ultimo: 34, prefijo: 'V', anio: 2026 }, 'y escribe contadores/V-AAAA solo cuando se la llama');
  }
  const activo = ventasSrc.replace(/\/\/ ── DESACTIVADO[\s\S]*?(?=window\.EVE_FOLIOS_VENTAS|function filtrarPorHoyVentas)/, '');
  const bloqueDesactivado = (ventasSrc.match(/\/\/ ── DESACTIVADO[\s\S]*?(?=\nwindow\.EVE_FOLIOS_VENTAS)/) || [''])[0];
  afirmar(/DESACTIVADO: contador transaccional/.test(bloqueDesactivado) && /NO se llama desde ninguna parte/.test(bloqueDesactivado), 'el bloque del contador está comentado como desactivado');
  afirmar(!/asignarFolioConContadorDesactivado|subirContadorFolioVentasAlMenos|refContadorFolioVentas|runTransaction/.test(activo.replace(/\/\/.*$/gm, '')), 'ninguna ruta activa llama al contador ni abre transacciones');

  // ── 8. Estático ──
  const guardado = ventasSrc.slice(ventasSrc.indexOf('async function manejarEnvioFormulario'), ventasSrc.indexOf('function crearFormulario'));
  afirmar(guardado.includes('guardarVentaNueva(venta)') && !/venta\.folio = generarFolio/.test(guardado) && !/window\.guardarDato\('ventas'/.test(guardado), 'el formulario guarda con guardarVentaNueva');
  const bloqueGuardar = ventasSrc.slice(ventasSrc.indexOf('async function guardarVentaNueva'), ventasSrc.indexOf('async function resolverFolioAlSincronizar'));
  afirmar((ventasSrc.match(/venta\.folio = generarFolio/g) || []).length === 1 && bloqueGuardar.includes('venta.folio = generarFolio'), 'el folio por memoria solo se usa como provisional, dentro de guardarVentaNueva');
  afirmar((ventasSrc.match(/guardarDato\('ventas', venta\)/g) || []).length === 1 && bloqueGuardar.includes("guardarDato('ventas', venta)"), 'la única alta de ventas nuevas pasa por guardarVentaNueva');
  const offline = leer('js/offline.js');
  afirmar(offline.includes('window.EVE_FOLIOS_VENTAS.resolverFolioAlSincronizar(item.coleccion, item.datos, mapaFolios)') && offline.indexOf('resolverFolioAlSincronizar') < offline.indexOf('guardarDatoFirebase(item.coleccion, datosASubir)'), 'la cola offline resuelve el folio antes de subir cada operación');

  console.log(`${ok}/${total} verificaciones correctas`);
})().catch((e) => { console.error('FALLA: ' + (e.stack || e.message)); process.exitCode = 1; });
