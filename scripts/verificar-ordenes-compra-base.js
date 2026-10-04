// Verificación de la base del módulo Órdenes de Compra (OC a proveedor): el módulo 'ordenesCompra' en el catálogo de permisos,
// en los roles y en la navegación (grupo Compras), patrón whitelist con la key undefined (usuarios existentes) y los bloques
// ordenes_compra y contadores de firestore.rules (raíz y rules-test) PREPARADOS, sin desplegar.
//
// Las reglas se prueban de verdad: se toma el texto real de cada bloque, se traduce a JavaScript (puedeLeer / puedeEscribir /
// esAdminEscritura / docId.matches / request.resource.data / resource.data) y se evalúa con usuarios y documentos simulados.
// No sustituye al Playground ni al emulador de Firestore (ver el reporte): comprueba la lógica escrita en el archivo.
//
// Uso: node scripts/verificar-ordenes-compra-base.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/auth.js'];
const leer = (relativa) => fs.readFileSync(path.join(RAIZ, relativa), 'utf8');
const ARCHIVOS_REGLAS = ['firestore.rules', 'rules-test/firestore.rules'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { getElementById: () => ({ style: {}, addEventListener() {} }), querySelectorAll: () => [] },
    firebase: {
      initializeApp() {},
      firestore() { return { enablePersistence() { return Promise.resolve(); } }; },
      auth() { return { onAuthStateChanged() {}, signInWithEmailAndPassword() {} }; }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) vm.runInContext(leer(archivo), sandbox, { filename: archivo });
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

// ── Evaluador de reglas ──────────────────────────────────────────────────────────────────────────────────────────────────
// Extrae el bloque `match /coleccion/{docId} { ... }` y devuelve sus `allow <operaciones>: if <condición>;`.
function bloqueDe(reglas, coleccion) {
  const m = reglas.match(new RegExp(`match /${coleccion}/\\{docId\\} \\{([\\s\\S]*?)\\n    \\}`));
  if (!m) throw new Error(`no se encontró match /${coleccion}`);
  const sinComentarios = m[1].split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  return Array.from(sinComentarios.matchAll(/allow\s+([a-z, ]+?)\s*:\s*if\s+([\s\S]*?);/g)).map(([, ops, condicion]) => ({
    operaciones: ops.split(',').map((o) => o.trim()),
    condicion: condicion.replace(/\s+/g, ' ').trim()
  }));
}

const OPERACIONES = { read: ['read', 'get', 'list'], get: ['read', 'get'], list: ['read', 'list'], write: ['write', 'create', 'update', 'delete'], create: ['write', 'create'], update: ['write', 'update'], delete: ['write', 'delete'] };

// Traduce una expresión de reglas a JavaScript. Solo admite lo que usan estos bloques; si aparece otra cosa, falla.
function traducir(expresion) {
  return expresion
    .replace(/(\w+)\.matches\('([^']*)'\)/g, (_, variable, patron) => `new RegExp('^(?:${patron.replace(/\\/g, '\\\\')})$').test(${variable})`)
    .replace(/puedeLeer\('(\w+)'\)/g, "ctx.puedeLeer('$1')")
    .replace(/puedeEscribir\('(\w+)'\)/g, "ctx.puedeEscribir('$1')")
    .replace(/esAdminEscritura\(\)/g, 'ctx.esAdminEscritura()')
    .replace(/estaAutenticado\(\)/g, 'ctx.autenticado')
    .replace(/request\.resource\.data\.(\w+)/g, 'ctx.nuevo.$1')
    .replace(/resource\.data\.(\w+)/g, 'ctx.actual.$1')
    .replace(/([\w.]+)\s+in\s+(\[[^\]]*\])/g, '$2.includes($1)');
}

// Funciones auxiliares del archivo de reglas (`function nombre(a, b) { return <expresión>; }`) que NO son de permisos
// (puedeLeer, puedeEscribir, esAdminEscritura, estaAutenticado y permisoModulo las resuelve el contexto). Devuelve { nombre: fn }.
const FUNCIONES_DE_PERMISOS = ['puedeLeer', 'puedeEscribir', 'esAdminEscritura', 'estaAutenticado', 'permisoModulo'];
function funcionesDe(reglas) {
  const propias = {};
  Array.from(reglas.matchAll(/function\s+(\w+)\(([^)]*)\)\s*\{\s*return\s+([\s\S]*?);\s*\}/g)).forEach(([, nombre, parametros, cuerpo]) => {
    if (FUNCIONES_DE_PERMISOS.includes(nombre)) return;
    const params = parametros.split(',').map((p) => p.trim()).filter(Boolean);
    propias[nombre] = new Function(...params, `return !!(${traducir(cuerpo.replace(/\s+/g, ' '))});`);
  });
  return propias;
}

// Traduce la condición de una regla a JavaScript; las llamadas a funciones auxiliares van por ctx.fn.
function compilar(condicion, propias) {
  let js = traducir(condicion);
  Object.keys(propias || {}).forEach((nombre) => { js = js.replace(new RegExp(`\\b${nombre}\\(`, 'g'), `ctx.fn.${nombre}(`); });
  if (/\b(get|exists|let|function)\b\s*\(/.test(js.replace(/ctx\.\w+/g, ''))) throw new Error(`condición no soportada por el evaluador: ${condicion}`);
  return new Function('ctx', 'docId', `return !!(${js});`);
}

// permisos: { modulo: 'lectura' | 'escritura' | ... } o null (sin sesión). Devuelve true si ALGUNA regla `allow` aplicable lo permite.
function permite(reglas, coleccion, operacion, { permisos, docId, actual, nuevo }) {
  const resueltos = permisos || {};
  const propias = funcionesDe(reglas);
  const ctx = {
    autenticado: permisos !== null,
    actual,
    nuevo,
    puedeLeer: (m) => permisos !== null && (ctx.esAdminEscritura() || ['lectura', 'escritura'].includes(resueltos[m])),
    puedeEscribir: (m) => permisos !== null && (ctx.esAdminEscritura() || resueltos[m] === 'escritura'),
    esAdminEscritura: () => permisos !== null && resueltos.admin === 'escritura',
    fn: propias
  };
  return bloqueDe(reglas, coleccion)
    .filter((r) => r.operaciones.some((o) => OPERACIONES[operacion].includes(o)))
    .some((r) => compilar(r.condicion, propias)(ctx, docId));
}

// ── Permisos, roles y navegación ─────────────────────────────────────────────────────────────────────────────────────────
caso('ordenesCompra está en MODULOS_PERMISOS, en MODULOS_ROL (admin-roles.js) y en ORDEN_TABS dentro del grupo Compras', () => {
  const w = crearContexto();
  afirmar(w.EVE_MODULOS_PERMISOS.includes('ordenesCompra'), 'falta en MODULOS_PERMISOS');
  afirmar(w.EVE_MODULOS_PERMISOS.includes('admin') && w.EVE_MODULOS_PERMISOS.includes('cotizaciones'), 'los módulos anteriores siguen');
  igual(new Set(w.EVE_MODULOS_PERMISOS).size, w.EVE_MODULOS_PERMISOS.length, 'sin módulos repetidos');
  afirmar(/\{ clave: 'ordenesCompra', nombre: '[^']+' \}/.test(leer('js/admin-roles.js')), 'falta en MODULOS_ROL de admin-roles.js');
  const visibles = w.tabsVisiblesPorPermiso({ ordenesCompra: 'lectura' });
  igual(visibles.map((t) => [t.id, t.nombre, t.grupo, t.permiso]), [['ordenesCompra', 'Ordenes de Compra', 'compras', 'ordenesCompra']], 'pestaña con lectura');
  // La agrupación real en la barra (navegacion.js) la cubre verificar-navegacion.js.
});

caso('MODULOS_ROL y MODULOS_PERMISOS cubren los mismos módulos (un rol puede dar y quitar el permiso nuevo)', () => {
  const w = crearContexto();
  const fuente = leer('js/admin-roles.js');
  const claves = Array.from(fuente.split('const MODULOS_ROL = [')[1].split('];')[0].matchAll(/clave: '(\w+)'/g)).map((m) => m[1]);
  igual(claves.slice().sort(), w.EVE_MODULOS_PERMISOS.slice().sort(), 'módulos de roles vs catálogo de permisos');
  const rol = { permisos: { ordenesCompra: 'escritura' } };
  igual(w.calcularPermisosResueltosDesdeRol(rol).ordenesCompra, 'escritura', 'rol con el permiso nuevo');
  igual(w.calcularPermisosResueltosDesdeRol({ permisos: {} }).ordenesCompra, 'ninguno', 'rol sin la key → ninguno');
  igual(w.calcularPermisosResueltosDesdeRol(null).ordenesCompra, 'ninguno', 'sin rol → ninguno');
});

caso('un usuario existente SIN la key ordenesCompra (key undefined) no ve la pestaña ni lee ni escribe (whitelist)', () => {
  const w = crearContexto();
  const permisosViejos = { ventas: 'escritura', cotizaciones: 'escritura', gastos: 'lectura', admin: 'ninguno', permisosExtra: {} };
  w.EVE.currentUser = { permisosResueltos: permisosViejos };
  afirmar(!w.tabsVisiblesPorPermiso(permisosViejos).some((t) => t.id === 'ordenesCompra'), 'la pestaña se mostró sin permiso');
  afirmar(w.puedeLeer('ordenesCompra') === false, 'puedeLeer debe ser false con la key undefined');
  afirmar(w.puedeEscribir('ordenesCompra') === false, 'puedeEscribir debe ser false con la key undefined');
  afirmar(w.tabsVisiblesPorPermiso(permisosViejos).some((t) => t.id === 'cotizaciones'), 'tener cotizaciones no quita su pestaña');
});

caso('valores raros en la key (null, "", "ninguno", "x", true) tampoco dan acceso; lectura lee y no escribe; escritura ambas', () => {
  const w = crearContexto();
  ['ninguno', '', null, 'x', true, 1].forEach((valor) => {
    w.EVE.currentUser = { permisosResueltos: { ordenesCompra: valor } };
    afirmar(!w.puedeLeer('ordenesCompra') && !w.puedeEscribir('ordenesCompra'), `acceso con ${JSON.stringify(valor)}`);
    afirmar(!w.tabsVisiblesPorPermiso({ ordenesCompra: valor }).some((t) => t.id === 'ordenesCompra'), `pestaña con ${JSON.stringify(valor)}`);
  });
  w.EVE.currentUser = { permisosResueltos: { ordenesCompra: 'lectura' } };
  afirmar(w.puedeLeer('ordenesCompra') && !w.puedeEscribir('ordenesCompra'), 'lectura');
  w.EVE.currentUser = { permisosResueltos: { ordenesCompra: 'escritura' } };
  afirmar(w.puedeLeer('ordenesCompra') && w.puedeEscribir('ordenesCompra'), 'escritura');
  w.EVE.currentUser = null;
  afirmar(!w.puedeLeer('ordenesCompra') && !w.puedeEscribir('ordenesCompra'), 'sin sesión');
});

caso('el permiso de cotizaciones NO da acceso a Órdenes de Compra y viceversa; el legacy (permissions) queda en ninguno', () => {
  const w = crearContexto();
  w.EVE.currentUser = { permisosResueltos: { cotizaciones: 'escritura' } };
  afirmar(w.puedeEscribir('cotizaciones') && !w.puedeLeer('ordenesCompra'), 'cotizaciones no da ordenesCompra');
  w.EVE.currentUser = { permisosResueltos: { ordenesCompra: 'escritura' } };
  afirmar(w.puedeEscribir('ordenesCompra') && !w.puedeLeer('cotizaciones'), 'ordenesCompra no da cotizaciones');
  const legacy = w.resolverPermisosDesdeLegacy({ destaraje: true, cotizaciones: true });
  igual([legacy.ordenesCompra, legacy.cotizaciones], ['ninguno', 'escritura'], 'usuario legacy');
  igual(w.resolverPermisosDesdeLegacy(null).ordenesCompra, 'ninguno', 'sin permissions');
});

caso('el módulo se registra con el MISMO id que la pestaña (ordenesCompra): renderModulo lo encuentra y ya no muestra "en construcción"', () => {
  const auth = leer('js/auth.js');
  afirmar(/const modulo = window\.EVE_MODULES\[moduloId\];[\s\S]*?Módulo en construcción/.test(auth), 'renderModulo debe conservar el marcador para módulos sin pantalla');
  const w = crearContexto();
  afirmar(w.EVE_MODULES.ordenesCompra === undefined, 'sin cargar ordenescompra.js no hay pantalla');
  vm.runInContext(leer('js/cotizaciones.js'), w, { filename: 'js/cotizaciones.js' });
  vm.runInContext(leer('js/ordenescompra.js'), w, { filename: 'js/ordenescompra.js' });
  afirmar(w.EVE_MODULES.ordenesCompra && typeof w.EVE_MODULES.ordenesCompra.render === 'function', 'EVE_MODULES.ordenesCompra.render');
  afirmar(w.EVE_MODULES.ordenescompra === undefined, 'el id en minúsculas no existe: la pestaña se llama ordenesCompra');
  const idTab = w.tabsVisiblesPorPermiso({ ordenesCompra: 'lectura' })[0].id;
  igual(idTab, 'ordenesCompra', 'id de la pestaña');
  afirmar(!/ordenesCompra/.test(leer('js/cotizaciones.js')), 'cotizaciones.js no depende del módulo de OC');
});

caso('auth.js carga ordenes_compra con el permiso ordenesCompra y reinicia ordenesCompra / ordenesCompraProveedores al salir', () => {
  const auth = leer('js/auth.js');
  afirmar(/campo: 'ordenesCompra', coleccion: window\.COLECCIONES\.ORDENES_COMPRA, modulo: 'ordenesCompra'/.test(auth), 'falta la carga de ordenes_compra');
  afirmar(/window\.EVE\.ordenesCompra = datos\.ordenesCompra;/.test(auth), 'falta asignar window.EVE.ordenesCompra');
  afirmar((auth.match(/window\.EVE\.ordenesCompraProveedores = /g) || []).length === 2, 'ordenesCompraProveedores se asigna al cargar y al reiniciar');
  afirmar((auth.match(/window\.EVE\.ordenesCompra = \[\];/g) || []).length === 1 && /ordenesCompra: \[\],\s*ordenesCompraProveedores: \[\]/.test(auth), 'estado inicial y reinicio');
});

caso('auditoría whitelist: ningún chequeo de permisos usa blacklist de "ninguno" (!== / != \'ninguno\')', () => {
  const carpeta = path.join(RAIZ, 'js');
  const culpables = fs.readdirSync(carpeta).filter((f) => f.endsWith('.js'))
    .filter((f) => /(!==?|===?)\s*'ninguno'|'ninguno'\s*(!==?|===?)/.test(leer(`js/${f}`).replace(/\/\/.*$/gm, '')));
  igual(culpables, [], 'archivos con comparación directa contra "ninguno"');
  afirmar(/permisosResueltos\[permiso\] === 'lectura' \|\| permisosResueltos\[permiso\] === 'escritura'/.test(leer('js/auth.js')), 'tabsVisiblesPorPermiso debe ser whitelist');
  afirmar(/permisosResueltos\.admin === 'lectura' \|\| permisosResueltos\.admin === 'escritura'/.test(leer('js/auth.js')), 'btn-admin debe ser whitelist');
});

// ── Reglas de Firestore (preparadas, sin desplegar) ──────────────────────────────────────────────────────────────────────
const usuario = (permisos) => ({ permisos });
const SIN_SESION = { permisos: null };
const SOLO_OC = usuario({ ordenesCompra: 'escritura' });
const SOLO_OC_LECTURA = usuario({ ordenesCompra: 'lectura' });
const SOLO_COT = usuario({ cotizaciones: 'escritura' });
const SOLO_COT_LECTURA = usuario({ cotizaciones: 'lectura' });
const AMBOS = usuario({ cotizaciones: 'escritura', ordenesCompra: 'escritura' });
const ADMIN = usuario({ admin: 'escritura' });
const ADMIN_LECTURA = usuario({ admin: 'lectura' });
const VIEJO_SIN_KEY = usuario({ ventas: 'escritura', gastos: 'lectura', admin: 'ninguno' });

// La raíz lleva las máquinas de estados (create / update / delete con validación); rules-test conserva su `write` genérico: el
// borrador de rules-test no se sincroniza con la raíz (ver el último caso de este archivo).
caso('reglas: ordenes_compra usa puedeLeer/puedeEscribir(ordenesCompra) en ambos archivos (ya no el permiso de cotizaciones)', () => {
  ARCHIVOS_REGLAS.forEach((archivo) => {
    const reglas = leer(archivo);
    const bloque = bloqueDe(reglas, 'ordenes_compra');
    const esperado = archivo === 'firestore.rules'
      ? [
        [['read'], "puedeLeer('ordenesCompra')"],
        [['create'], "puedeEscribir('ordenesCompra') && request.resource.data.estado == 'Emitida'"],
        [['update'], "puedeEscribir('ordenesCompra') && transicionOrdenCompraValida(resource.data.estado, request.resource.data.estado)"],
        [['delete'], "puedeEscribir('ordenesCompra') && resource.data.estado == 'Emitida'"]
      ]
      : [[['read'], "puedeLeer('ordenesCompra')"], [['write'], "puedeEscribir('ordenesCompra')"]];
    igual(bloque.map((r) => [r.operaciones, r.condicion]), esperado, `${archivo}: ordenes_compra`);
    afirmar(!bloque.some((r) => r.condicion.includes('cotizaciones')), `${archivo}: ordenes_compra aún menciona cotizaciones`);
  });
});

caso('reglas: ordenes_compra — con ordenesCompra lee/escribe; con solo cotizaciones, key undefined o sin sesión, NO', () => {
  ARCHIVOS_REGLAS.forEach((archivo) => {
    const r = leer(archivo);
    // Documentos con un estado válido para cada operación: aquí solo se prueba el PERMISO (las transiciones, más abajo).
    const contexto = { create: { nuevo: { estado: 'Emitida' } }, update: { actual: { estado: 'Emitida' }, nuevo: { estado: 'Recibida' } }, delete: { actual: { estado: 'Emitida' } }, read: {} };
    const p = (u, op) => permite(r, 'ordenes_compra', op, { permisos: u.permisos, docId: 'abc', actual: {}, nuevo: {}, ...contexto[op] });
    ['create', 'update', 'delete'].forEach((op) => afirmar(p(SOLO_OC, op) && !p(SOLO_OC_LECTURA, op), `${archivo}: ${op} requiere escritura de ordenesCompra`));
    afirmar(p(SOLO_OC, 'read') && p(SOLO_OC_LECTURA, 'read'), `${archivo}: lectura con ordenesCompra`);
    [SOLO_COT, SOLO_COT_LECTURA, VIEJO_SIN_KEY, SIN_SESION].forEach((u) => ['read', 'create', 'update', 'delete'].forEach((op) => afirmar(!p(u, op), `${archivo}: ${op} no debe permitirse a ${JSON.stringify(u.permisos)}`)));
    afirmar(p(ADMIN, 'read') && p(ADMIN, 'create') && !p(ADMIN_LECTURA, 'create'), `${archivo}: Admin con escritura sigue pudiendo; Admin de solo lectura no escribe`);
  });
});

const contador = (r, u, op, docId, { actual, nuevo }) => permite(r, 'contadores', op, { permisos: u.permisos, docId, actual: actual === undefined ? undefined : { ultimo: actual }, nuevo: nuevo === undefined ? undefined : { ultimo: nuevo } });

caso('reglas: contadores — el folio OC- solo con ordenesCompra y el COT- solo con cotizaciones (leer, crear e incrementar)', () => {
  ARCHIVOS_REGLAS.forEach((archivo) => {
    const r = leer(archivo);
    // OC-
    afirmar(contador(r, SOLO_OC, 'read', 'OC-2026', { actual: 3 }), `${archivo}: OC- lectura con ordenesCompra`);
    afirmar(contador(r, SOLO_OC, 'create', 'OC-2026', { nuevo: 1 }), `${archivo}: OC- crear con ordenesCompra`);
    afirmar(contador(r, SOLO_OC, 'update', 'OC-2026', { actual: 3, nuevo: 4 }), `${archivo}: OC- incrementar con ordenesCompra`);
    afirmar(contador(r, SOLO_OC_LECTURA, 'read', 'OC-2026', { actual: 3 }), `${archivo}: OC- lectura con permiso de lectura`);
    afirmar(!contador(r, SOLO_OC_LECTURA, 'update', 'OC-2026', { actual: 3, nuevo: 4 }) && !contador(r, SOLO_OC_LECTURA, 'create', 'OC-2026', { nuevo: 1 }), `${archivo}: OC- con solo lectura no escribe`);
    // COT-
    afirmar(contador(r, SOLO_COT, 'read', 'COT-2026', { actual: 3 }) && contador(r, SOLO_COT, 'create', 'COT-2026', { nuevo: 1 }) && contador(r, SOLO_COT, 'update', 'COT-2026', { actual: 3, nuevo: 4 }), `${archivo}: COT- con cotizaciones`);
    afirmar(!contador(r, SOLO_COT_LECTURA, 'update', 'COT-2026', { actual: 3, nuevo: 4 }) && contador(r, SOLO_COT_LECTURA, 'read', 'COT-2026', { actual: 3 }), `${archivo}: COT- con solo lectura`);
    // Quien tiene ambos puede con ambos.
    afirmar(contador(r, AMBOS, 'update', 'COT-2026', { actual: 1, nuevo: 2 }) && contador(r, AMBOS, 'update', 'OC-2026', { actual: 1, nuevo: 2 }), `${archivo}: con ambos permisos funcionan los dos folios`);
  });
});

caso('reglas: contadores — con solo UN permiso NO se puede leer, crear ni incrementar el folio del otro módulo', () => {
  ARCHIVOS_REGLAS.forEach((archivo) => {
    const r = leer(archivo);
    afirmar(!contador(r, SOLO_OC, 'read', 'COT-2026', { actual: 3 }) && !contador(r, SOLO_COT, 'read', 'OC-2026', { actual: 3 }), `${archivo}: lectura cruzada`);
    afirmar(!contador(r, SOLO_OC, 'update', 'COT-2026', { actual: 3, nuevo: 4 }), `${archivo}: ordenesCompra no debe incrementar COT-`);
    afirmar(!contador(r, SOLO_COT, 'update', 'OC-2026', { actual: 3, nuevo: 4 }), `${archivo}: cotizaciones no debe incrementar OC-`);
    afirmar(!contador(r, SOLO_OC, 'create', 'COT-2026', { nuevo: 1 }), `${archivo}: ordenesCompra no debe crear COT-`);
    afirmar(!contador(r, SOLO_COT, 'create', 'OC-2026', { nuevo: 1 }), `${archivo}: cotizaciones no debe crear OC-`);
    afirmar(!contador(r, SOLO_COT, 'delete', 'OC-2026', { actual: 3 }) && !contador(r, SOLO_OC, 'delete', 'OC-2026', { actual: 3 }), `${archivo}: borrar contadores es solo de Admin`);
  });
});

caso('reglas: contadores — un id con prefijo desconocido (o que solo CONTIENE el prefijo) solo lo toca Admin', () => {
  ARCHIVOS_REGLAS.forEach((archivo) => {
    const r = leer(archivo);
    ['XYZ-2026', 'COT2026', 'OC2026', 'cot-2026', 'oc-2026', 'XCOT-2026', 'XOC-2026', 'folio', ''].forEach((id) => {
      [AMBOS, SOLO_OC, SOLO_COT].forEach((u) => {
        afirmar(!contador(r, u, 'read', id, { actual: 3 }), `${archivo}: leyó "${id}" sin ser Admin`);
        afirmar(!contador(r, u, 'create', id, { nuevo: 1 }), `${archivo}: creó "${id}" sin ser Admin`);
        afirmar(!contador(r, u, 'update', id, { actual: 3, nuevo: 4 }), `${archivo}: incrementó "${id}" sin ser Admin`);
      });
      afirmar(contador(r, ADMIN, 'read', id, { actual: 3 }) && contador(r, ADMIN, 'update', id, { actual: 3, nuevo: 99 }) && contador(r, ADMIN, 'delete', id, { actual: 3 }), `${archivo}: Admin sí puede con "${id}"`);
    });
    afirmar(!contador(r, ADMIN_LECTURA, 'update', 'OC-2026', { actual: 3, nuevo: 4 }) && !contador(r, ADMIN_LECTURA, 'delete', 'OC-2026', { actual: 3 }), `${archivo}: Admin de solo lectura no escribe`);
    [VIEJO_SIN_KEY, SIN_SESION].forEach((u) => ['COT-2026', 'OC-2026'].forEach((id) => {
      afirmar(!contador(r, u, 'read', id, { actual: 3 }) && !contador(r, u, 'create', id, { nuevo: 1 }) && !contador(r, u, 'update', id, { actual: 3, nuevo: 4 }), `${archivo}: key undefined / sin sesión sobre ${id}`);
    }));
  });
});

caso('reglas: contadores — la guarda de incremento sigue intacta (crear solo en 1, subir de uno en uno, Admin puede corregir)', () => {
  ARCHIVOS_REGLAS.forEach((archivo) => {
    const r = leer(archivo);
    ['OC-2026', 'COT-2026'].forEach((id) => {
      const u = id.startsWith('OC') ? SOLO_OC : SOLO_COT;
      afirmar(contador(r, u, 'create', id, { nuevo: 1 }), `${archivo}: ${id} crear en 1`);
      [0, 2, 5, -1, 100].forEach((n) => afirmar(!contador(r, u, 'create', id, { nuevo: n }), `${archivo}: ${id} no debe crearse en ${n}`));
      afirmar(!contador(r, ADMIN, 'create', id, { nuevo: 5 }), `${archivo}: ni Admin crea fuera de 1 (igual que antes)`);
      afirmar(contador(r, u, 'update', id, { actual: 7, nuevo: 8 }), `${archivo}: ${id} subir de uno en uno`);
      [7, 6, 0, 9, 10, 100].forEach((n) => afirmar(!contador(r, u, 'update', id, { actual: 7, nuevo: n }), `${archivo}: ${id} no debe pasar de 7 a ${n}`));
      afirmar(contador(r, ADMIN, 'update', id, { actual: 7, nuevo: 3 }), `${archivo}: Admin puede corregir el contador de ${id}`);
    });
    const texto = leer(archivo);
    afirmar(texto.includes('request.resource.data.ultimo == 1') && texto.includes('request.resource.data.ultimo == resource.data.ultimo + 1'), `${archivo}: las dos guardas siguen escritas`);
  });
});

caso('reglas: rules-test NO se sincronizó con la raíz (cada archivo conserva sus bloques propios); clientes_cotizacion no cambió', () => {
  const raiz = leer('firestore.rules');
  const prueba = leer('rules-test/firestore.rules');
  afirmar(prueba.includes('BORRADOR - pendiente de revisión antes de deploy'), 'rules-test conserva sus bloques en borrador');
  afirmar(raiz.includes("allow read: if puedeLeer('ventas') || puedeLeer('rendimientos');"), 'la raíz conserva sus bloques propios');
  afirmar(!prueba.includes("puedeLeer('ventas') || puedeLeer('rendimientos')"), 'rules-test conserva su versión de composiciones');
  afirmar(!prueba.includes('transicionCotizacionValida') && !prueba.includes('transicionOrdenCompraValida'), 'rules-test no lleva las máquinas de estados (solo la raíz)');
  ARCHIVOS_REGLAS.forEach((archivo) => {
    const reglas = leer(archivo);
    igual(bloqueDe(reglas, 'clientes_cotizacion').map((r) => r.condicion), ["puedeLeer('cotizaciones')", "puedeEscribir('cotizaciones')"], `${archivo}: clientes_cotizacion`);
  });
  igual(bloqueDe(prueba, 'cotizaciones').map((r) => r.condicion), ["puedeLeer('cotizaciones')", "puedeEscribir('cotizaciones')"], 'rules-test: cotizaciones conserva su write genérico');
});

// ── Máquinas de estados en las reglas (solo la raíz) ───────────────────────────────────────────────────────────────────────
const REGLAS_RAIZ = () => leer('firestore.rules');
const estados = (...nombres) => nombres;

// Transiciones permitidas por la máquina real (js/cotizaciones.js TRANSICIONES + Reemplazada) y por la de OC.
const COT_ESTADOS = estados('Borrador', 'Enviada', 'Aceptada', 'Rechazada', 'Cancelada', 'Reemplazada');
const COT_PERMITIDAS = {
  Borrador: ['Borrador', 'Enviada', 'Cancelada'],
  Enviada: ['Aceptada', 'Rechazada', 'Cancelada', 'Reemplazada'],
  Aceptada: ['Cancelada'],
  Rechazada: ['Reemplazada'],
  Cancelada: [],
  Reemplazada: ['Enviada', 'Rechazada']
};
const OC_ESTADOS = estados('Emitida', 'Recibida', 'Cancelada');
const OC_PERMITIDAS = { Emitida: ['Emitida', 'Recibida', 'Cancelada'], Recibida: ['Cancelada'], Cancelada: [] };

caso('reglas: cotizaciones — matriz completa de transiciones (6×6) con escritura; lo no listado se rechaza', () => {
  const r = REGLAS_RAIZ();
  COT_ESTADOS.forEach((de) => COT_ESTADOS.forEach((a) => {
    const real = permite(r, 'cotizaciones', 'update', { permisos: SOLO_COT.permisos, docId: 'c1', actual: { estado: de }, nuevo: { estado: a } });
    igual(real, COT_PERMITIDAS[de].includes(a), `cotizaciones ${de} → ${a}`);
  }));
});

caso('reglas: cotizaciones — todas las transiciones que hace la app están permitidas (TRANSICIONES de cotizaciones.js + revisiones)', () => {
  const w = crearContexto();
  vm.runInContext(leer('js/cotizaciones.js'), w, { filename: 'js/cotizaciones.js' });
  const fuente = leer('js/cotizaciones.js');
  const enApp = [];
  // TRANSICIONES de js/cotizaciones.js, leída del código real.
  const bloque = fuente.split('const TRANSICIONES = {')[1].split('};')[0];
  Array.from(bloque.matchAll(/\[(ESTADO_\w+)\]: \[([^\]]*)\]/g)).forEach(([, de, a]) => {
    Array.from(a.matchAll(/ESTADO_\w+/g)).forEach(([hacia]) => enApp.push([de, hacia]));
  });
  const nombre = { ESTADO_BORRADOR: 'Borrador', ESTADO_ENVIADA: 'Enviada', ESTADO_ACEPTADA: 'Aceptada', ESTADO_RECHAZADA: 'Rechazada', ESTADO_CANCELADA: 'Cancelada', ESTADO_REEMPLAZADA: 'Reemplazada' };
  afirmar(enApp.length >= 5, 'no se pudo leer TRANSICIONES del código');
  // crearRevision: Enviada | Rechazada → Reemplazada; eliminar una revisión: Reemplazada → Enviada | Rechazada.
  const todas = [...enApp.map(([de, a]) => [nombre[de], nombre[a]]), ['Enviada', 'Reemplazada'], ['Rechazada', 'Reemplazada'], ['Reemplazada', 'Enviada'], ['Reemplazada', 'Rechazada']];
  todas.forEach(([de, a]) => afirmar(permite(REGLAS_RAIZ(), 'cotizaciones', 'update', { permisos: SOLO_COT.permisos, docId: 'c1', actual: { estado: de }, nuevo: { estado: a } }), `la app hace ${de} → ${a} y las reglas lo rechazan`));
  // Y los estados de la app son exactamente los de la matriz.
  igual(w.EVE_COTIZACIONES.ESTADOS.slice().sort(), COT_ESTADOS.slice().sort(), 'estados de cotizaciones.js vs reglas');
});

caso('reglas: cotizaciones — alta solo en Borrador; borrar solo un Borrador; sin permiso de escritura nada de eso', () => {
  const r = REGLAS_RAIZ();
  const c = (u, op, extra) => permite(r, 'cotizaciones', op, { permisos: u.permisos, docId: 'c1', ...extra });
  COT_ESTADOS.forEach((estado) => {
    igual(c(SOLO_COT, 'create', { nuevo: { estado } }), estado === 'Borrador', `crear en ${estado}`);
    igual(c(SOLO_COT, 'delete', { actual: { estado } }), estado === 'Borrador', `borrar un ${estado}`);
  });
  [SOLO_COT_LECTURA, SOLO_OC, VIEJO_SIN_KEY, SIN_SESION].forEach((u) => {
    afirmar(!c(u, 'create', { nuevo: { estado: 'Borrador' } }) && !c(u, 'delete', { actual: { estado: 'Borrador' } }) && !c(u, 'update', { actual: { estado: 'Borrador' }, nuevo: { estado: 'Enviada' } }), `${JSON.stringify(u.permisos)} no debe escribir`);
  });
  afirmar(c(SOLO_COT, 'read', {}) && c(SOLO_COT_LECTURA, 'read', {}) && !c(SOLO_OC, 'read', {}), 'lectura de cotizaciones sigue por su permiso');
  afirmar(c(ADMIN, 'create', { nuevo: { estado: 'Borrador' } }) && !c(ADMIN, 'create', { nuevo: { estado: 'Aceptada' } }), 'Admin también pasa por la máquina de estados');
});

caso('reglas: cotizaciones — un documento sin estado (o con un estado inventado) no se puede actualizar ni borrar', () => {
  const r = REGLAS_RAIZ();
  const c = (op, extra) => permite(r, 'cotizaciones', op, { permisos: SOLO_COT.permisos, docId: 'c1', ...extra });
  ['Hackeada', '', 'borrador', 'BORRADOR', undefined, null].forEach((raro) => {
    afirmar(!c('update', { actual: { estado: raro }, nuevo: { estado: 'Enviada' } }), `actualizó desde ${JSON.stringify(raro)}`);
    afirmar(!c('delete', { actual: { estado: raro } }), `borró un ${JSON.stringify(raro)}`);
    afirmar(!c('create', { nuevo: { estado: raro } }), `creó en ${JSON.stringify(raro)}`);
  });
  afirmar(!c('update', { actual: { estado: 'Borrador' }, nuevo: { estado: 'Hackeada' } }), 'un estado nuevo inventado');
});

caso('reglas: ordenes_compra — matriz completa de transiciones (3×3) con escritura; lo no listado se rechaza', () => {
  const r = REGLAS_RAIZ();
  OC_ESTADOS.forEach((de) => OC_ESTADOS.forEach((a) => {
    const real = permite(r, 'ordenes_compra', 'update', { permisos: SOLO_OC.permisos, docId: 'o1', actual: { estado: de }, nuevo: { estado: a } });
    igual(real, OC_PERMITIDAS[de].includes(a), `ordenes_compra ${de} → ${a}`);
  }));
  ['Borrador', 'Enviada', 'Aceptada', 'Hackeada', '', undefined].forEach((raro) => {
    afirmar(!permite(r, 'ordenes_compra', 'update', { permisos: SOLO_OC.permisos, docId: 'o1', actual: { estado: raro }, nuevo: { estado: 'Recibida' } }), `actualizó desde ${JSON.stringify(raro)}`);
    afirmar(!permite(r, 'ordenes_compra', 'update', { permisos: SOLO_OC.permisos, docId: 'o1', actual: { estado: 'Emitida' }, nuevo: { estado: raro } }), `pasó a ${JSON.stringify(raro)}`);
  });
});

caso('reglas: ordenes_compra — alta solo Emitida; borrar solo una Emitida; la OC no hereda reglas de Borrador', () => {
  const r = REGLAS_RAIZ();
  const o = (u, op, extra) => permite(r, 'ordenes_compra', op, { permisos: u.permisos, docId: 'o1', ...extra });
  [...OC_ESTADOS, 'Borrador'].forEach((estado) => {
    igual(o(SOLO_OC, 'create', { nuevo: { estado } }), estado === 'Emitida', `crear en ${estado}`);
    igual(o(SOLO_OC, 'delete', { actual: { estado } }), estado === 'Emitida', `borrar una ${estado}`);
  });
  [SOLO_OC_LECTURA, SOLO_COT, VIEJO_SIN_KEY, SIN_SESION].forEach((u) => {
    afirmar(!o(u, 'create', { nuevo: { estado: 'Emitida' } }) && !o(u, 'delete', { actual: { estado: 'Emitida' } }) && !o(u, 'update', { actual: { estado: 'Emitida' }, nuevo: { estado: 'Recibida' } }), `${JSON.stringify(u.permisos)} no debe escribir`);
  });
});

caso('reglas: las máquinas de estados de OC en las reglas coinciden con TRANSICIONES_OC de ordenescompra.js', () => {
  const sandbox = crearContexto();
  vm.runInContext(leer('js/cotizaciones.js'), sandbox, { filename: 'js/cotizaciones.js' });
  vm.runInContext(leer('js/ordenescompra.js'), sandbox, { filename: 'js/ordenescompra.js' });
  const oc = sandbox.EVE_ORDENES_COMPRA;
  igual(oc.ESTADOS_OC, OC_ESTADOS, 'ESTADOS_OC');
  OC_ESTADOS.forEach((de) => OC_ESTADOS.forEach((a) => {
    const enReglas = permite(REGLAS_RAIZ(), 'ordenes_compra', 'update', { permisos: SOLO_OC.permisos, docId: 'o1', actual: { estado: de }, nuevo: { estado: a } });
    // Quedarse en Emitida es la edición del documento (no es una transición de TRANSICIONES_OC).
    igual(enReglas, de === 'Emitida' && a === 'Emitida' ? true : oc.transicionValida(de, a), `${de} → ${a}: reglas vs módulo`);
  }));
});

caso('reglas: contadores no cambiaron (COT- exige cotizaciones, OC- exige ordenesCompra) y la raíz sigue declarando ambas funciones de transición', () => {
  const r = REGLAS_RAIZ();
  const bloque = bloqueDe(r, 'contadores').map((x) => [x.operaciones, x.condicion]);
  afirmar(bloque.some(([, c]) => c.includes("docId.matches('COT-.*') && puedeLeer('cotizaciones')") && c.includes("docId.matches('OC-.*') && puedeLeer('ordenesCompra')")), 'lectura por prefijo');
  afirmar(/function transicionCotizacionValida\(de, a\)/.test(r) && /function transicionOrdenCompraValida\(de, a\)/.test(r), 'funciones de transición');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
