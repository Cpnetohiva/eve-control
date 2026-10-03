// K24d — La caché offline de datos se limpia al cerrar sesión de forma EXPLÍCITA (y solo entonces).
//
// Carga en un contexto vm js/config.js, js/offline.js y js/auth.js reales, con un IndexedDB en memoria (patrón de K22b, ahora con
// clear y con la cola de pendientes) y un DOM/Firebase mínimos, y comprueba que:
//  - al pulsar Cerrar sesión la caché de datos (incluida control_produccion y la config) queda vacía y se cerró la sesión;
//  - la cola de registros pendientes de subir NO se borra (se perderían capturas hechas sin red);
//  - al iniciar sesión con red los datos se vuelven a guardar en la caché;
//  - sin sesión iniciada en ese dispositivo no se restaura ningún dato;
//  - la expiración de la sesión (onAuthStateChanged sin usuario) y la pérdida de red NO limpian la caché;
//  - sin sesión guardarCacheDatos no escribe (no repone lo limpiado ni pisa la caché con colecciones vacías);
//  - si falla la limpieza, la sesión se cierra igual.
//
// Uso: node scripts/verificar-cache-sesion.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');

// IndexedDB en memoria: almacen = { cache_datos: Map, cola_pendiente: [] }; almacen.fallarClear simula un error al limpiar.
function crearIndexedDBFalso(almacen) {
  const clonar = (x) => structuredClone(x);
  return {
    open() {
      const req = {};
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: (n) => n in almacen },
          createObjectStore(n) { if (!(n in almacen)) almacen[n] = n === 'cache_datos' ? new Map() : []; },
          transaction(nombre) {
            const tx = {};
            tx.objectStore = () => ({
              put(valor) { if (nombre === 'cache_datos') almacen.cache_datos.set(valor.coleccion, clonar(valor)); },
              add(valor) { if (nombre === 'cola_pendiente') almacen.cola_pendiente.push(clonar(valor)); const r = {}; setTimeout(() => { r.result = 1; if (r.onsuccess) r.onsuccess(); }, 0); return r; },
              delete() {},
              clear() {
                if (almacen.fallarClear) throw new Error('fallo simulado al limpiar');
                if (nombre === 'cache_datos') almacen.cache_datos.clear(); else almacen.cola_pendiente.length = 0;
              },
              count() { const r = {}; setTimeout(() => { r.result = nombre === 'cola_pendiente' ? almacen.cola_pendiente.length : almacen.cache_datos.size; if (r.onsuccess) r.onsuccess(); }, 0); return r; },
              getAll() {
                const r = {};
                setTimeout(() => { r.result = nombre === 'cache_datos' ? Array.from(almacen.cache_datos.values()).map(clonar) : almacen.cola_pendiente.map(clonar); if (r.onsuccess) r.onsuccess(); }, 0);
                return r;
              }
            });
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
          }
        };
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: db } });
        if (req.onsuccess) req.onsuccess({ target: { result: db } });
      }, 0);
      return req;
    }
  };
}

// Un contexto = una carga de la página en el dispositivo (el almacén IndexedDB se comparte entre contextos).
function crearContexto(almacen) {
  const elementos = new Map();
  const elemento = (id) => {
    if (!elementos.has(id)) {
      const manejadores = {};
      elementos.set(id, {
        id, style: {}, textContent: '', innerHTML: '', value: '', manejadores,
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener(tipo, fn) { manejadores[tipo] = fn; }, appendChild() {}
      });
    }
    return elementos.get(id);
  };
  const estado = { signOut: 0, onAuthStateChanged: null };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error,
    setTimeout, clearTimeout, structuredClone, navigator: { onLine: true }, indexedDB: crearIndexedDBFalso(almacen),
    document: { getElementById: elemento, createElement: () => elemento(`nuevo-${elementos.size}`), body: elemento('body') },
    firebase: {
      initializeApp() {},
      firestore() { return { enablePersistence() { return Promise.resolve(); } }; },
      auth() {
        return {
          onAuthStateChanged(cb) { estado.onAuthStateChanged = cb; },
          signOut: async () => { estado.signOut += 1; }
        };
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  for (const archivo of ['js/config.js', 'js/offline.js', 'js/auth.js']) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  return { w: sandbox.window, estado, clicSalir: () => elemento('btn-salir').manejadores.click() };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  afirmar(a === b, `${mensaje}: esperado ${b}, obtenido ${a}`);
}
const nuevoAlmacen = () => ({ cache_datos: new Map(), cola_pendiente: [] });
const colecciones = (almacen) => Array.from(almacen.cache_datos.keys()).sort();

const PELETIZADO = {
  id: 'p5', ticket: 'P-005', tipoProceso: 'PELETIZADO', fecha: '2026-09-12', totalInput: 500, totalOutput: 500,
  inputs: [{ material: 'P.E. MOLIDO', kg: 300, ticketOrigen: 'P-001' }, { material: 'P.P. MOLIDO', kg: 200, ticketOrigen: 'P-002' }],
  outputs: [{ material: 'PELLET CAJAS', kg: 480, esMerma: false }, { material: 'PIEDRAS', kg: 20, esMerma: true }]
};

// Sesión iniciada con red: usuario cargado, datos en memoria y la caché guardada (lo que hace el envoltorio de cargarDatosEnParalelo).
async function iniciarSesionConDatos(ctx) {
  ctx.w.EVE.currentUser = { id: 'u1', active: true };
  ctx.w.EVE.registrosControlProduccion = [PELETIZADO];
  ctx.w.EVE.metaEficiencia = 85;
  await ctx.w.EVE_OFFLINE.guardarCacheDatos();
}

caso('K24d: al cerrar sesión (botón) la caché de datos queda vacía, incluida control_produccion y la config', async () => {
  const almacen = nuevoAlmacen();
  const ctx = crearContexto(almacen);
  await iniciarSesionConDatos(ctx);
  afirmar(colecciones(almacen).includes('control_produccion') && colecciones(almacen).includes('config'), 'antes: la caché tiene control_produccion y config');
  igual(almacen.cache_datos.get('control_produccion').registros[0].inputs.length, 2, 'antes: guarda los inputs completos del Peletizado');
  await ctx.clicSalir();
  igual(ctx.estado.signOut, 1, 'se cerró la sesión de Firebase');
  igual(colecciones(almacen), [], 'la caché de datos quedó vacía');
  igual([ctx.w.EVE.currentUser, ctx.w.EVE.registrosControlProduccion], [null, []], 'el estado en memoria también');
});

caso('K24d: cerrar sesión no borra la cola de registros pendientes de subir', async () => {
  const almacen = nuevoAlmacen();
  almacen.cola_pendiente.push({ id: 1, coleccion: 'destaraje', datos: { ticket: '99' }, estado: 'pendiente', intentos: 0 });
  const ctx = crearContexto(almacen);
  await iniciarSesionConDatos(ctx);
  await ctx.clicSalir();
  igual(almacen.cola_pendiente.length, 1, 'la cola sigue intacta');
});

caso('K24d: sin sesión iniciada en ese dispositivo no se restaura ningún dato', async () => {
  const almacen = nuevoAlmacen();
  const ctx = crearContexto(almacen);
  await iniciarSesionConDatos(ctx);
  await ctx.clicSalir();
  const despues = crearContexto(almacen); // el dispositivo vuelve a abrir la app
  igual(await despues.w.EVE_OFFLINE.cargarCacheDatos(), false, 'no hay nada que restaurar');
  igual([despues.w.EVE.currentUser, despues.w.EVE.registrosControlProduccion], [null, []], 'la memoria sigue vacía');
  const nunca = crearContexto(nuevoAlmacen()); // dispositivo en el que nunca se inició sesión
  igual(await nunca.w.EVE_OFFLINE.cargarCacheDatos(), false, 'tampoco en un dispositivo sin historial');
});

caso('K24d: al iniciar sesión con red los datos se vuelven a guardar y se pueden restaurar', async () => {
  const almacen = nuevoAlmacen();
  const ctx = crearContexto(almacen);
  await iniciarSesionConDatos(ctx);
  await ctx.clicSalir();
  igual(colecciones(almacen), [], 'tras cerrar sesión: vacía');
  const login = crearContexto(almacen);
  await iniciarSesionConDatos(login);
  afirmar(colecciones(almacen).includes('control_produccion'), 'tras iniciar sesión la caché se recargó');
  const arranque = crearContexto(almacen);
  igual(await arranque.w.EVE_OFFLINE.cargarCacheDatos(), true, 'se restaura');
  igual(arranque.w.EVE.registrosControlProduccion.map((r) => r.ticket), ['P-005'], 'con los registros');
  igual(arranque.w.EVE.metaEficiencia, 85, 'y la config');
});

caso('K24d: la sesión que expira o se pierde (onAuthStateChanged sin usuario) NO limpia la caché', async () => {
  const almacen = nuevoAlmacen();
  const ctx = crearContexto(almacen);
  await iniciarSesionConDatos(ctx);
  const antes = colecciones(almacen);
  await ctx.estado.onAuthStateChanged(null); // expiración / sesión perdida: Firebase avisa sin usuario
  igual(colecciones(almacen), antes, 'la caché sigue completa');
  igual(ctx.estado.signOut, 0, 'no se llamó a signOut');
  const arranque = crearContexto(almacen);
  igual(await arranque.w.EVE_OFFLINE.cargarCacheDatos(), true, 'la app sigue pudiendo arrancar con datos');
});

caso('K24d: sin sesión guardarCacheDatos no escribe (no pisa la caché con colecciones vacías)', async () => {
  const almacen = nuevoAlmacen();
  const ctx = crearContexto(almacen);
  await iniciarSesionConDatos(ctx);
  const copia = JSON.stringify(Array.from(almacen.cache_datos.entries()));
  const sinSesion = crearContexto(almacen); // 'online' llega antes de que Firebase restaure la sesión
  await sinSesion.w.EVE_OFFLINE.guardarCacheDatos();
  igual(JSON.stringify(Array.from(almacen.cache_datos.entries())), copia, 'la caché no cambió');
  await ctx.clicSalir();
  await ctx.w.EVE_OFFLINE.guardarCacheDatos(); // una escritura rezagada después de cerrar sesión
  igual(colecciones(almacen), [], 'tras cerrar sesión una escritura rezagada no repone la caché');
});

caso('K24d: si falla la limpieza, la sesión se cierra igual y no se lanza error', async () => {
  const almacen = nuevoAlmacen();
  const ctx = crearContexto(almacen);
  await iniciarSesionConDatos(ctx);
  almacen.fallarClear = true;
  await ctx.clicSalir();
  igual([ctx.estado.signOut, ctx.w.EVE.currentUser], [1, null], 'sesión cerrada');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try {
      await fn();
      console.log(`PASS  ${nombre}`);
    } catch (error) {
      fallos += 1;
      console.log(`FAIL  ${nombre}\n      ${error.stack ? error.stack.split('\n').slice(0, 3).join('\n      ') : error.message}`);
    }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos > 0 ? 1 : 0);
})();
