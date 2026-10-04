// Verificación de la base del módulo Cotizaciones: permisos con patrón whitelist (usuarios existentes sin la key
// 'cotizaciones'), navegación, folios consecutivos por año con transacción (incluida una carrera de dos usuarios), emisor
// (config/emisor) con valores por omisión y validación, y que las reglas, el precache y index.html estén al día.
// Carga js/config.js, js/utils.js, js/permisos.js, js/auth.js y js/cotizaciones.js en un contexto vm con un Firestore simulado
// (la simulación de transacciones reintenta si otro escribió antes, como el SDK real).
//
// Uso: node scripts/verificar-cotizaciones-base.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/auth.js', 'js/cotizaciones.js'];
const leer = (relativa) => fs.readFileSync(path.join(RAIZ, relativa), 'utf8');

// Firestore mínimo: documentos por ruta con versión, get/set y runTransaction con control optimista de concurrencia.
function crearDbSimulada() {
  const docs = new Map();
  const estadisticas = { reintentos: 0 };
  const ref = (ruta) => ({ ruta, get: async () => instantanea(ruta), set: async (datos, opciones) => escribir(ruta, datos, opciones) });
  const instantanea = (ruta) => {
    const doc = docs.get(ruta);
    return { exists: !!doc, data: () => (doc ? { ...doc.datos } : undefined), version: doc ? doc.version : 0 };
  };
  const escribir = (ruta, datos, opciones) => {
    const doc = docs.get(ruta);
    const base = opciones && opciones.merge && doc ? doc.datos : {};
    docs.set(ruta, { datos: { ...base, ...datos }, version: (doc ? doc.version : 0) + 1 });
  };
  return {
    docs,
    estadisticas,
    collection: (nombre) => ({ doc: (id) => ref(`${nombre}/${id}`) }),
    async runTransaction(fn) {
      for (let intento = 0; intento < 5; intento++) { // el SDK real también reintenta 5 veces por omisión
        const lecturas = new Map();
        const escrituras = [];
        const tx = {
          async get(r) { const s = instantanea(r.ruta); lecturas.set(r.ruta, s.version); await Promise.resolve(); return s; },
          set(r, datos) { escrituras.push([r.ruta, datos]); }
        };
        const resultado = await fn(tx);
        const choque = Array.from(lecturas).some(([ruta, version]) => (docs.has(ruta) ? docs.get(ruta).version : 0) !== version);
        if (choque) { estadisticas.reintentos++; continue; }
        escrituras.forEach(([ruta, datos]) => escribir(ruta, datos));
        return resultado;
      }
      throw new Error('Transacción abortada por contención');
    }
  };
}

function crearContexto(fechaMexico) {
  const elementos = {};
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { getElementById: (id) => (elementos[id] = elementos[id] || { style: {}, addEventListener() {} }), querySelectorAll: () => [] },
    firebase: {
      initializeApp() {},
      firestore() { return { enablePersistence() { return Promise.resolve(); } }; },
      auth() { return { onAuthStateChanged() {}, signInWithEmailAndPassword() {} }; }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) vm.runInContext(leer(archivo), sandbox, { filename: archivo });
  sandbox.window.db = crearDbSimulada();
  if (fechaMexico) sandbox.window.obtenerFechaMexico = () => fechaMexico;
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

// ── Permisos y navegación ────────────────────────────────────────────────────────────────────────────────────────────
caso('cotizaciones está en el catálogo de permisos y en la navegación', () => {
  const w = crearContexto();
  afirmar(w.EVE_MODULOS_PERMISOS.includes('cotizaciones'), 'falta en MODULOS_PERMISOS');
  igual(w.tabsVisiblesPorPermiso({ cotizaciones: 'lectura' }).map((t) => t.id), ['cotizaciones'], 'pestañas con lectura');
});

caso('un usuario existente SIN la key cotizaciones no ve la pestaña ni lee ni escribe (whitelist)', () => {
  const w = crearContexto();
  const permisosViejos = { ventas: 'escritura', gastos: 'lectura', admin: 'ninguno', permisosExtra: {} };
  w.EVE.currentUser = { permisosResueltos: permisosViejos };
  afirmar(!w.tabsVisiblesPorPermiso(permisosViejos).some((t) => t.id === 'cotizaciones'), 'la pestaña se mostró sin permiso');
  afirmar(w.puedeLeer('cotizaciones') === false, 'puedeLeer debe ser false con la key undefined');
  afirmar(w.puedeEscribir('cotizaciones') === false, 'puedeEscribir debe ser false con la key undefined');
});

caso('valores raros en la key (null, "", "ninguno", "x") tampoco dan acceso', () => {
  const w = crearContexto();
  ['ninguno', '', null, 'x', true].forEach((valor) => {
    w.EVE.currentUser = { permisosResueltos: { cotizaciones: valor } };
    afirmar(!w.puedeLeer('cotizaciones') && !w.puedeEscribir('cotizaciones'), `acceso con ${JSON.stringify(valor)}`);
    afirmar(!w.tabsVisiblesPorPermiso({ cotizaciones: valor }).some((t) => t.id === 'cotizaciones'), `pestaña con ${JSON.stringify(valor)}`);
  });
});

caso('lectura lee y no escribe; escritura lee y escribe', () => {
  const w = crearContexto();
  w.EVE.currentUser = { permisosResueltos: { cotizaciones: 'lectura' } };
  afirmar(w.puedeLeer('cotizaciones') && !w.puedeEscribir('cotizaciones'), 'lectura');
  w.EVE.currentUser = { permisosResueltos: { cotizaciones: 'escritura' } };
  afirmar(w.puedeLeer('cotizaciones') && w.puedeEscribir('cotizaciones'), 'escritura');
});

caso('rol sin la key y usuarios legacy quedan en ninguno', () => {
  const w = crearContexto();
  igual(w.calcularPermisosResueltosDesdeRol({ permisos: { ventas: 'escritura' } }).cotizaciones, 'ninguno', 'rol viejo');
  igual(w.resolverPermisosDesdeLegacy({ ventas: true }).cotizaciones, 'ninguno', 'legacy');
});

caso('ningún chequeo de módulo en js/ usa blacklist de "ninguno"', () => {
  const ofensores = [];
  fs.readdirSync(path.join(RAIZ, 'js')).filter((f) => f.endsWith('.js')).forEach((archivo) => {
    leer(`js/${archivo}`).split('\n').forEach((linea, i) => {
      if (/permisosResueltos[^\n]*(!==|!=) *'ninguno'/.test(linea) || /\.permisos(Resueltos)?\[[^\]]+\] *(!==|!=) *'ninguno'/.test(linea)) ofensores.push(`${archivo}:${i + 1}`);
    });
  });
  igual(ofensores, [], 'chequeos tipo blacklist');
});

caso('el rol de Admin incluye cotizaciones entre los módulos asignables', () => {
  afirmar(/\{ clave: 'cotizaciones', nombre: 'Cotizaciones' \}/.test(leer('js/admin-roles.js')), 'falta en MODULOS_ROL');
});

// ── Colecciones, reglas, precache ────────────────────────────────────────────────────────────────────────────────────
caso('COLECCIONES declara las colecciones nuevas', () => {
  const w = crearContexto();
  igual([w.COLECCIONES.COTIZACIONES, w.COLECCIONES.ORDENES_COMPRA, w.COLECCIONES.CLIENTES_COTIZACION, w.COLECCIONES.CONTADORES],
    ['cotizaciones', 'ordenes_compra', 'clientes_cotizacion', 'contadores'], 'nombres de colección');
});

caso('firestore.rules (raíz y rules-test) tiene los bloques con el patrón estándar', () => {
  ['firestore.rules', 'rules-test/firestore.rules'].forEach((archivo) => {
    const reglas = leer(archivo);
    ['cotizaciones', 'ordenes_compra', 'clientes_cotizacion'].forEach((col) => {
      const bloque = reglas.match(new RegExp(`match /${col}/\\{docId\\} \\{([^}]*)\\}`));
      afirmar(bloque, `${archivo}: falta match /${col}`);
      afirmar(bloque[1].includes("allow read: if puedeLeer('cotizaciones');"), `${archivo}: ${col} sin puedeLeer`);
      afirmar(bloque[1].includes("allow write: if puedeEscribir('cotizaciones');"), `${archivo}: ${col} sin puedeEscribir`);
    });
    afirmar(/match \/contadores\/\{docId\}/.test(reglas), `${archivo}: falta match /contadores`);
    afirmar(reglas.includes('request.resource.data.ultimo == resource.data.ultimo + 1'), `${archivo}: contadores sin guarda de incremento`);
  });
});

caso('service worker precachea js/cotizaciones.js e index.html lo carga, antes de admin-config.js', () => {
  afirmar(leer('service-worker.js').includes("'js/cotizaciones.js'"), 'falta en APP_SHELL');
  const index = leer('index.html');
  const pos = index.indexOf('js/cotizaciones.js');
  afirmar(pos !== -1 && pos < index.indexOf('js/admin-config.js'), 'index.html no lo carga antes de admin-config.js');
});

// ── Emisor ───────────────────────────────────────────────────────────────────────────────────────────────────────────
caso('emisor sin documento: razón social de RIVAL PLASTIC, campos vacíos y vigencia 15', async () => {
  const w = crearContexto();
  const emisor = await w.EVE_COTIZACIONES.obtenerEmisor();
  igual(emisor, {
    razonSocial: 'RIVAL PLASTIC SAPI DE CV', rfc: '', domicilioFiscal: '', telefono: '', correo: '',
    condicionesPagoDefault: '', condicionesEntregaDefault: '', vigenciaDias: 15
  }, 'emisor por omisión');
});

caso('guardar emisor lo persiste en config/emisor y obtenerEmisor lo devuelve (el PDF leerá de ahí)', async () => {
  const w = crearContexto();
  await w.EVE_COTIZACIONES.guardarEmisor({
    razonSocial: ' RIVAL PLASTIC SAPI DE CV ', rfc: 'RPS010101AAA', domicilioFiscal: 'Calle 1', telefono: '555', correo: 'a@b.com',
    condicionesPagoDefault: 'Contado', condicionesEntregaDefault: 'En planta', vigenciaDias: '30'
  });
  afirmar(w.db.docs.has('config/emisor'), 'no se escribió config/emisor');
  const emisor = await w.EVE_COTIZACIONES.obtenerEmisor();
  igual([emisor.razonSocial, emisor.rfc, emisor.vigenciaDias, emisor.condicionesPagoDefault], ['RIVAL PLASTIC SAPI DE CV', 'RPS010101AAA', 30, 'Contado'], 'emisor guardado');
});

caso('validación del emisor: razón social, correo y vigencia', () => {
  const w = crearContexto();
  const valido = { razonSocial: 'X', correo: '', vigenciaDias: 15 };
  igual(w.EVE_COTIZACIONES.validarEmisor(valido), null, 'válido');
  afirmar(w.EVE_COTIZACIONES.validarEmisor({ ...valido, razonSocial: '  ' }), 'razón social vacía');
  afirmar(w.EVE_COTIZACIONES.validarEmisor({ ...valido, correo: 'sin-arroba' }), 'correo inválido');
  [0, -1, 1.5, 'abc', 400, ''].forEach((v) => afirmar(w.EVE_COTIZACIONES.validarEmisor({ ...valido, vigenciaDias: v }), `vigencia ${v}`));
});

caso('guardar emisor inválido no escribe nada', async () => {
  const w = crearContexto();
  let fallo = false;
  try { await w.EVE_COTIZACIONES.guardarEmisor({ razonSocial: '', vigenciaDias: 15 }); } catch (e) { fallo = true; }
  afirmar(fallo && !w.db.docs.has('config/emisor'), 'escribió un emisor inválido');
});

// ── Folios ───────────────────────────────────────────────────────────────────────────────────────────────────────────
caso('formato COT-AAAA-0001 / OC-AAAA-0001 y consecutivo', async () => {
  const w = crearContexto('2026-10-03');
  const f = w.EVE_COTIZACIONES;
  igual([await f.generarFolio('cotizacion'), await f.generarFolio('cotizacion'), await f.generarFolio('ordenCompra')],
    ['COT-2026-0001', 'COT-2026-0002', 'OC-2026-0001'], 'folios');
});

caso('el contador reinicia por año y no pasa a 4 dígitos antes del 10000', async () => {
  const w = crearContexto('2026-12-31');
  const f = w.EVE_COTIZACIONES;
  await f.generarFolio('cotizacion');
  igual(await f.generarFolio('cotizacion', 2027), 'COT-2027-0001', 'año nuevo');
  igual(await f.generarFolio('cotizacion', 2026), 'COT-2026-0002', 'año anterior sigue su cuenta');
  w.db.docs.set('contadores/COT-2028', { datos: { ultimo: 9999 }, version: 1 });
  igual(await f.generarFolio('cotizacion', 2028), 'COT-2028-10000', 'desborde a 5 dígitos');
});

caso('dos usuarios a la vez NUNCA reciben el mismo folio', async () => {
  const w = crearContexto('2026-10-03');
  const folios = await Promise.all(Array.from({ length: 4 }, () => w.EVE_COTIZACIONES.generarFolio('cotizacion')));
  igual(new Set(folios).size, 4, 'folios únicos');
  igual(folios.slice().sort(), Array.from({ length: 4 }, (_, i) => `COT-2026-${String(i + 1).padStart(4, '0')}`), 'sin huecos');
  afirmar(w.db.estadisticas.reintentos > 0, 'la simulación no produjo contención; la prueba no ejercitó la carrera');
});

caso('tomarFolioEnTransaccion: si la transacción falla, el folio no se consume', async () => {
  const w = crearContexto('2026-10-03');
  try {
    await w.db.runTransaction(async (tx) => { await w.EVE_COTIZACIONES.tomarFolioEnTransaccion(tx, 'cotizacion'); throw new Error('falló el guardado'); });
  } catch (e) { /* esperado */ }
  igual(await w.EVE_COTIZACIONES.generarFolio('cotizacion'), 'COT-2026-0001', 'folio tras fallo');
});

caso('tipo o año inválido se rechaza sin escribir', async () => {
  const w = crearContexto('2026-10-03');
  for (const args of [['otro'], ['cotizacion', 1999], ['cotizacion', 'abc']]) {
    let fallo = false;
    try { await w.EVE_COTIZACIONES.generarFolio(...args); } catch (e) { fallo = true; }
    afirmar(fallo, `aceptó ${JSON.stringify(args)}`);
  }
  igual(w.db.docs.size, 0, 'documentos escritos');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
