// Contador diario de lecturas a Firestore (window.EVE_LECTURAS y window.verLecturas, js/utils.js) y su conexión con
// js/auth.js e index.html. Carga utils.js en un vm con localStorage/sessionStorage y una base de datos simulada.
//
// Uso: node scripts/verificar-contador-lecturas.js   (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (archivo) => fs.readFileSync(path.join(RAIZ, archivo), 'utf8');

function almacen(roto) {
  const datos = new Map();
  const falla = () => { throw new Error('storage no disponible'); };
  return {
    getItem: roto ? falla : (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: roto ? falla : (k, v) => { datos.set(k, String(v)); },
    removeItem: roto ? falla : (k) => { datos.delete(k); },
    key: roto ? falla : (i) => Array.from(datos.keys())[i] || null,
    get length() { if (roto) falla(); return datos.size; }
  };
}

function crearContexto(opciones) {
  opciones = opciones || {};
  const tablas = [];
  const logs = [];
  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')), warn() {}, error() {}, table: (t) => tablas.push(t) },
    Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error,
    setTimeout, clearTimeout, document: {},
    localStorage: opciones.localStorage || almacen(false),
    sessionStorage: opciones.sessionStorage || almacen(false)
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {};
  sandbox.window.EVE_MODULES = {};
  sandbox.window.materialesPZ = () => [];
  const servidor = (n, deCache) => ({
    size: n, docs: new Array(n).fill({ id: 'x', data: () => ({}) }), metadata: { fromCache: !!deCache }
  });
  sandbox.window.db = {
    collection: (c) => ({ get: async () => servidor((opciones.tamanos || {})[c] || 0, (opciones.cache || {})[c]) })
  };
  vm.createContext(sandbox);
  vm.runInContext(leer('js/utils.js'), sandbox, { filename: 'js/utils.js' });
  return { w: sandbox.window, tablas, logs };
}

const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (r, e, m) => afirmar(JSON.stringify(r) === JSON.stringify(e), `${m}: esperado ${JSON.stringify(e)}, obtenido ${JSON.stringify(r)}`);
const guardado = (ctx) => JSON.parse(ctx.w.localStorage.getItem(`eve_lecturas_${hoy()}`));

caso('(1) cargarDatos suma los documentos que vienen del servidor, por colección', async () => {
  const ctx = crearContexto({ tamanos: { destaraje: 523, pagos: 501 } });
  await ctx.w.cargarDatos('destaraje');
  await ctx.w.cargarDatos('pagos');
  const g = guardado(ctx);
  igual([g.total, g.porColeccion.destaraje, g.porColeccion.pagos], [1024, 523, 501], 'totales');
});

caso('(2) los snapshots que vienen de caché no se cuentan', async () => {
  const ctx = crearContexto({ tamanos: { destaraje: 523 }, cache: { destaraje: true } });
  const filas = await ctx.w.cargarDatos('destaraje');
  igual(filas.length, 523, 'cargarDatos sigue devolviendo los datos');
  afirmar(!ctx.w.localStorage.getItem(`eve_lecturas_${hoy()}`) || guardado(ctx).total === 0, 'no debe contar caché');
});

caso('(3) un documento suelto (users, config) cuenta como 1 y de caché como 0', () => {
  const ctx = crearContexto();
  ctx.w.EVE_LECTURAS.contar('users', { exists: true, metadata: { fromCache: false } });
  ctx.w.EVE_LECTURAS.contar('config', { exists: true, metadata: { fromCache: true } });
  const g = guardado(ctx);
  igual([g.total, g.porColeccion.users, g.porColeccion.config], [1, 1, undefined], 'documento');
});

caso('(4) motivo: por omisión recarga; login tras marcarMotivo; consulta tras terminarCarga', async () => {
  const ctx = crearContexto({ tamanos: { destaraje: 10 } });
  ctx.w.EVE_LECTURAS.iniciarCarga();
  await ctx.w.cargarDatos('destaraje');
  ctx.w.EVE_LECTURAS.marcarMotivo('login');
  ctx.w.EVE_LECTURAS.iniciarCarga();
  await ctx.w.cargarDatos('destaraje');
  ctx.w.EVE_LECTURAS.terminarCarga();
  await ctx.w.cargarDatos('destaraje');
  const g = guardado(ctx);
  igual(g.porMotivo, {
    recarga: { lecturas: 10, cargas: 1 },
    login: { lecturas: 10, cargas: 1 },
    consulta: { lecturas: 10, cargas: 0 }
  }, 'por motivo');
  igual([g.total, g.cargas], [30, 2], 'total y cargas');
});

caso('(5) la bandera de sessionStorage da actualizacion-sw y se consume una vez', async () => {
  const ss = almacen(false);
  ss.setItem('eve_motivo_carga', 'actualizacion-sw');
  const ctx = crearContexto({ sessionStorage: ss, tamanos: { destaraje: 5 } });
  await ctx.w.cargarDatos('destaraje');
  igual(Object.keys(guardado(ctx).porMotivo), ['actualizacion-sw'], 'motivo');
  igual(ss.getItem('eve_motivo_carga'), null, 'bandera consumida');
});

caso('(6) al cambiar el día se reinicia y se borran las claves de días anteriores', async () => {
  const ls = almacen(false);
  ls.setItem('eve_lecturas_2020-01-01', JSON.stringify({ total: 99 }));
  const ctx = crearContexto({ localStorage: ls, tamanos: { destaraje: 7 } });
  await ctx.w.cargarDatos('destaraje');
  igual(guardado(ctx).total, 7, 'solo lo de hoy');
  igual(ls.getItem('eve_lecturas_2020-01-01'), null, 'clave vieja borrada');
});

caso('(7) localStorage y sessionStorage no disponibles: no lanza y cargarDatos funciona', async () => {
  const ctx = crearContexto({ localStorage: almacen(true), sessionStorage: almacen(true), tamanos: { destaraje: 3 } });
  const filas = await ctx.w.cargarDatos('destaraje');
  igual(filas.length, 3, 'datos');
  ctx.w.EVE_LECTURAS.marcarMotivo('login');
  ctx.w.EVE_LECTURAS.iniciarCarga();
  ctx.w.verLecturas();
});

caso('(8) verLecturas imprime por colección y por motivo, total de hoy y porcentaje de 50,000', async () => {
  const ctx = crearContexto({ tamanos: { destaraje: 523, pagos: 477 } });
  await ctx.w.cargarDatos('destaraje');
  await ctx.w.cargarDatos('pagos');
  ctx.w.verLecturas();
  igual(ctx.tablas.length, 2, 'dos console.table');
  afirmar(JSON.stringify(ctx.tablas[0]).includes('523'), 'tabla por colección');
  afirmar(ctx.logs.some((l) => l.includes('1,000') || l.includes('1000')), 'total de hoy: ' + ctx.logs.join('|'));
  afirmar(ctx.logs.some((l) => /\b2(\.0+)?%/.test(l)), 'porcentaje: ' + ctx.logs.join('|'));
});

caso('(9) auth.js e index.html están conectados', () => {
  const auth = leer('js/auth.js');
  afirmar(auth.includes("EVE_LECTURAS.contar('users'"), 'auth: users');
  afirmar(auth.includes("EVE_LECTURAS.contar('config'"), 'auth: config/sistema');
  afirmar(auth.includes('EVE_LECTURAS.iniciarCarga()'), 'auth: iniciarCarga');
  afirmar(auth.includes("EVE_LECTURAS.marcarMotivo('login')"), 'auth: login');
  afirmar(auth.includes('EVE_LECTURAS.terminarCarga()'), 'auth: terminarCarga');
  const idx = leer('index.html');
  const i = idx.indexOf('eve_motivo_carga');
  afirmar(i > 0 && i < idx.indexOf('window.location.reload()'), 'index: bandera antes de location.reload()');
});

(async () => {
  let fallos = 0;
  for (const c of casos) {
    try { await c.fn(); console.log(`ok   ${c.nombre}`); } catch (e) { fallos += 1; console.log(`FALLA ${c.nombre}: ${e.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos pasan`);
  process.exit(fallos ? 1 : 0);
})();
