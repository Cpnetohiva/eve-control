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
  const estadisticas = { reintentos: 0, transacciones: 0, fallarEn: null };
  let autoId = 0;
  const ref = (ruta) => ({ ruta, id: ruta.split('/')[1], get: async () => instantanea(ruta), set: async (datos, opciones) => escribir(ruta, datos, opciones) });
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
    collection: (nombre) => ({ doc: (id) => ref(`${nombre}/${id === undefined ? `auto${++autoId}` : id}`) }),
    async runTransaction(fn) {
      estadisticas.transacciones++;
      for (let intento = 0; intento < 5; intento++) { // el SDK real también reintenta 5 veces por omisión
        const lecturas = new Map();
        const escrituras = [];
        const tx = {
          async get(r) { const s = instantanea(r.ruta); lecturas.set(r.ruta, s.version); await Promise.resolve(); return s; },
          set(r, datos, opciones) { escrituras.push([r.ruta, datos, opciones]); }
        };
        const resultado = await fn(tx);
        const choque = Array.from(lecturas).some(([ruta, version]) => (docs.has(ruta) ? docs.get(ruta).version : 0) !== version);
        if (choque) { estadisticas.reintentos++; continue; }
        // Todo o nada: si una escritura falla al confirmar, no se aplica ninguna.
        if (estadisticas.fallarEn && escrituras.some(([ruta]) => ruta.startsWith(estadisticas.fallarEn))) throw new Error('fallo simulado al confirmar');
        escrituras.forEach(([ruta, datos, opciones]) => escribir(ruta, datos, opciones));
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

// ── Captura de cotización: obligatorios, totales, guardado atómico ────────────────────────────────────────────────────
const partidaValida = (extra) => ({ producto: 'TAMBO', descripcion: '', cantidad: '10', unidad: 'PZ', precioUnitario: '100', descuentoPct: '0', ...extra });
const datosValidos = (extra) => ({
  cliente: { razonSocial: 'Plásticos del Norte S.A.', contacto: 'Ana Pérez', telefono: '8112345678', direccion: 'Av. 1 #100' },
  fecha: '2026-10-03', vigenciaDias: '15', condicionesPago: 'Contado', condicionesEntrega: 'En planta', notas: '', aplicaIva: true,
  partidas: [partidaValida()], ...extra
});
const conEscritura = (w) => { w.EVE.currentUser = { username: 'ventas1', permisosResueltos: { cotizaciones: 'escritura' } }; return w; };

caso('captura: cada dato de cliente es obligatorio, con mensaje por campo', () => {
  const w = crearContexto();
  const { validarCotizacion } = w.EVE_COTIZACIONES;
  igual(validarCotizacion(datosValidos()).ok, true, 'datos completos');
  const esperado = { razonSocial: 'La Razón Social es obligatoria', contacto: 'El Contacto es obligatorio', telefono: 'El Teléfono es obligatorio', direccion: 'La Dirección es obligatoria' };
  Object.keys(esperado).forEach((campo) => {
    ['', '   '].forEach((vacio) => {
      const d = datosValidos();
      d.cliente[campo] = vacio;
      const r = validarCotizacion(d);
      igual(Object.keys(r.errores), [`cliente.${campo}`], `solo debe fallar ${campo}`);
      igual(r.errores[`cliente.${campo}`], esperado[campo], `mensaje de ${campo}`);
    });
  });
  igual(Object.keys(validarCotizacion(datosValidos({ cliente: {} })).errores).length, 4, 'cliente vacío: 4 mensajes');
  afirmar(validarCotizacion(datosValidos({ cliente: { ...datosValidos().cliente, razonSocial: '***' } })).errores['cliente.razonSocial'], 'razón social sin letras ni números');
});

caso('captura: partidas — mínimo una, y cantidad y precio mayores a 0', () => {
  const w = crearContexto();
  const { validarCotizacion } = w.EVE_COTIZACIONES;
  igual(validarCotizacion(datosValidos({ partidas: [] })).errores.partidas, 'Agrega al menos una partida', 'sin partidas');
  [['cantidad', '0'], ['cantidad', ''], ['cantidad', '-3'], ['precioUnitario', '0'], ['precioUnitario', ''], ['precioUnitario', 'abc'], ['descuentoPct', '101'], ['descuentoPct', '-1'], ['unidad', 'XX']].forEach(([campo, valor]) => {
    const r = validarCotizacion(datosValidos({ partidas: [partidaValida({ [campo]: valor })] }));
    afirmar(r.errores[`partidas.0.${campo}`], `aceptó ${campo}=${JSON.stringify(valor)}`);
  });
  afirmar(validarCotizacion(datosValidos({ partidas: [partidaValida({ producto: '', descripcion: '' })] })).errores['partidas.0.producto'], 'sin producto ni descripción');
  igual(validarCotizacion(datosValidos({ partidas: [partidaValida({ producto: '', descripcion: 'Flete especial' }), partidaValida({ descuentoPct: '' })] })).ok, true, 'descripción libre y descuento vacío');
  const r = validarCotizacion(datosValidos({ partidas: [partidaValida(), partidaValida({ cantidad: '0' })] }));
  igual(Object.keys(r.errores), ['partidas.1.cantidad'], 'el error apunta a la partida 2');
});

caso('captura: fecha (calendario real) y vigencia', () => {
  const w = crearContexto();
  const { validarCotizacion } = w.EVE_COTIZACIONES;
  ['', '2026-02-30', '2026-13-01', '03/10/2026', 'hoy'].forEach((f) => afirmar(validarCotizacion(datosValidos({ fecha: f })).errores.fecha, `aceptó fecha ${f}`));
  igual(validarCotizacion(datosValidos({ fecha: '2028-02-29' })).ok, true, 'bisiesto válido');
  ['0', '', '1.5', '366', 'x'].forEach((v) => afirmar(validarCotizacion(datosValidos({ vigenciaDias: v })).errores.vigenciaDias, `aceptó vigencia ${v}`));
});

caso('totales: importe con descuento, subtotal, IVA sobre el subtotal con descuento y total', () => {
  const w = crearContexto();
  const { calcularImportePartida, calcularTotales } = w.EVE_COTIZACIONES;
  igual(calcularImportePartida({ cantidad: 10, precioUnitario: 100, descuentoPct: 10 }), 900, 'importe con 10%');
  igual(calcularImportePartida({ cantidad: '2.5', precioUnitario: '33.33', descuentoPct: '' }), 83.33, 'importe redondeado a 2 decimales');
  const partidas = [{ cantidad: 10, precioUnitario: 100, descuentoPct: 10 }, { cantidad: 3, precioUnitario: 49.99, descuentoPct: 0 }];
  igual(calcularTotales(partidas, true), { subtotal: 1049.97, aplicaIva: true, ivaTasa: 0.16, iva: 168, total: 1217.97 }, 'con IVA (IVA = 16% de 1049.97 = 167.9952)');
  igual(calcularTotales(partidas, false), { subtotal: 1049.97, aplicaIva: false, ivaTasa: 0.16, iva: 0, total: 1049.97 }, 'sin IVA');
  igual(calcularTotales([], true).total, 0, 'sin partidas');
});

caso('totales: redondeo consistente (1.005, acumulación flotante, total = subtotal + IVA exacto)', () => {
  const w = crearContexto();
  const { redondear2, calcularTotales } = w.EVE_COTIZACIONES;
  igual([redondear2(1.005), redondear2(2.675), redondear2(0.1 + 0.2), redondear2('x')], [1.01, 2.68, 0.3, 0], 'redondear2');
  const diez = Array.from({ length: 10 }, () => ({ cantidad: 1, precioUnitario: 0.1, descuentoPct: 0 }));
  igual(calcularTotales(diez, true), { subtotal: 1, aplicaIva: true, ivaTasa: 0.16, iva: 0.16, total: 1.16 }, '10 × 0.10');
  for (let precio = 0.01; precio < 50; precio += 0.37) {
    const t = calcularTotales([{ cantidad: 3, precioUnitario: precio, descuentoPct: 7.5 }], true);
    igual(t.total, w.EVE_COTIZACIONES.redondear2(t.subtotal + t.iva), `total consistente con precio ${precio.toFixed(2)}`);
    afirmar(Math.abs(t.iva - t.subtotal * 0.16) <= 0.005 + 1e-9, `IVA fuera de medio centavo con precio ${precio.toFixed(2)}`);
  }
});

caso('guardar: alta crea folio, documento Borrador con snapshot completo y cliente, en UNA transacción', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  await w.EVE_COTIZACIONES.guardarEmisor({ razonSocial: 'RIVAL PLASTIC SAPI DE CV', rfc: 'RPS010101AAA', domicilioFiscal: 'Calle 1', telefono: '555', correo: '', condicionesPagoDefault: '', condicionesEntregaDefault: '', vigenciaDias: 20 });
  const antes = w.db.estadisticas.transacciones;
  const r = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos());
  igual(w.db.estadisticas.transacciones - antes, 1, 'transacciones usadas (folio + documento + cliente juntos)');
  igual(r.folio, 'COT-2026-0001', 'folio');
  const doc = w.db.docs.get(`cotizaciones/${r.id}`).datos;
  igual([doc.folio, doc.estado, doc.fecha, doc.vigenciaDias, doc.creadoPor], ['COT-2026-0001', 'Borrador', '2026-10-03', 15, 'ventas1'], 'encabezado');
  igual(doc.totales, { subtotal: 1000, aplicaIva: true, ivaTasa: 0.16, iva: 160, total: 1160 }, 'totales guardados');
  igual(doc.partidas, [{ producto: 'TAMBO', descripcion: '', cantidad: 10, unidad: 'PZ', precioUnitario: 100, descuentoPct: 0, importe: 1000 }], 'partidas con importe');
  igual([doc.cliente.razonSocial, doc.cliente.telefono], ['Plásticos del Norte S.A.', '8112345678'], 'snapshot de cliente');
  igual([doc.emisor.razonSocial, doc.emisor.rfc, doc.emisor.vigenciaDias], ['RIVAL PLASTIC SAPI DE CV', 'RPS010101AAA', 20], 'snapshot del emisor vigente');
  igual(w.db.docs.get('contadores/COT-2026').datos.ultimo, 1, 'contador');
  const cliente = w.db.docs.get('clientes_cotizacion/PLASTICOS-DEL-NORTE-S-A').datos;
  igual([cliente.razonSocial, cliente.contacto, cliente.direccion], ['Plásticos del Norte S.A.', 'Ana Pérez', 'Av. 1 #100'], 'cliente guardado');
});

caso('guardar: si la transacción falla, no queda folio consumido ni documento ni cliente (atomicidad)', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  w.db.estadisticas.fallarEn = 'cotizaciones/';
  let fallo = false;
  try { await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos()); } catch (e) { fallo = true; }
  afirmar(fallo, 'debía fallar');
  igual(Array.from(w.db.docs.keys()), [], 'documentos tras el fallo (ni contador ni cotización ni cliente)');
  w.db.estadisticas.fallarEn = null;
  igual((await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos())).folio, 'COT-2026-0001', 'el folio no se perdió');
});

caso('guardar: cliente existente se actualiza (mismo documento) y no se duplica', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos());
  const d2 = datosValidos();
  d2.cliente = { razonSocial: 'PLASTICOS DEL NORTE, S.A.', contacto: 'Luis Gómez', telefono: '999', direccion: 'Nueva 5' };
  await w.EVE_COTIZACIONES.guardarCotizacion(d2);
  const claves = Array.from(w.db.docs.keys()).filter((k) => k.startsWith('clientes_cotizacion/'));
  igual(claves, ['clientes_cotizacion/PLASTICOS-DEL-NORTE-S-A'], 'un solo cliente');
  igual(w.db.docs.get(claves[0]).datos.contacto, 'Luis Gómez', 'contacto actualizado');
});

caso('guardar: dos usuarios a la vez reciben folios distintos y cada uno guarda su documento', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const resultados = await Promise.all([1, 2, 3, 4].map((n) => w.EVE_COTIZACIONES.guardarCotizacion(datosValidos({ notas: `n${n}` }))));
  igual(resultados.map((r) => r.folio).sort(), ['COT-2026-0001', 'COT-2026-0002', 'COT-2026-0003', 'COT-2026-0004'], 'folios');
  igual(new Set(resultados.map((r) => r.id)).size, 4, 'documentos distintos');
});

caso('editar un Borrador NO cambia el folio ni consume otro; solo Borrador es editable', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos());
  const edicion = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos({ aplicaIva: false, partidas: [partidaValida({ cantidad: '20' })] }), alta.id);
  igual(edicion.folio, 'COT-2026-0001', 'folio intacto');
  const doc = w.db.docs.get(`cotizaciones/${alta.id}`).datos;
  igual([doc.folio, doc.estado, doc.creadoPor, doc.totales.total, doc.actualizadoPor], ['COT-2026-0001', 'Borrador', 'ventas1', 2000, 'ventas1'], 'documento editado');
  igual(w.db.docs.get('contadores/COT-2026').datos.ultimo, 1, 'el contador no avanzó');
  w.db.docs.get(`cotizaciones/${alta.id}`).datos.estado = 'Enviada';
  let fallo = false;
  try { await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos(), alta.id); } catch (e) { fallo = /Borrador/.test(e.message); }
  afirmar(fallo, 'editó una cotización que ya no es Borrador');
});

caso('guardar: sin permiso de escritura (lectura, ninguno o key ausente) no escribe nada', async () => {
  for (const permisos of [{ cotizaciones: 'lectura' }, { cotizaciones: 'ninguno' }, {}]) {
    const w = crearContexto('2026-10-03');
    w.EVE.currentUser = { permisosResueltos: permisos };
    let fallo = false;
    try { await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos()); } catch (e) { fallo = true; }
    afirmar(fallo && w.db.docs.size === 0, `guardó con ${JSON.stringify(permisos)}`);
  }
});

caso('guardar: datos inválidos no escriben nada y devuelven los errores por campo', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  let errores = null;
  try { await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos({ cliente: { razonSocial: 'X', contacto: '', telefono: '', direccion: '' } })); } catch (e) { errores = e.errores; }
  igual(Object.keys(errores || {}), ['cliente.contacto', 'cliente.telefono', 'cliente.direccion'], 'errores');
  igual(w.db.docs.size, 0, 'documentos escritos');
});

caso('el módulo registra su pantalla, carga sus colecciones y la lista/edición respetan el permiso', () => {
  const w = crearContexto();
  afirmar(typeof w.EVE_MODULES.cotizaciones.render === 'function', 'falta EVE_MODULES.cotizaciones.render');
  const auth = leer('js/auth.js');
  afirmar(/campo: 'cotizaciones', coleccion: window\.COLECCIONES\.COTIZACIONES, modulo: 'cotizaciones'/.test(auth), 'auth no carga cotizaciones');
  afirmar(/campo: 'clientesCotizacion', coleccion: window\.COLECCIONES\.CLIENTES_COTIZACION, modulo: 'cotizaciones'/.test(auth), 'auth no carga clientes');
  const fuente = leer('js/cotizaciones.js');
  afirmar(/if \(window\.puedeEscribir\('cotizaciones'\)\) \{\s*const nueva/.test(fuente), 'el botón Nueva debe depender de puedeEscribir');
  afirmar(/const editable = window\.puedeEscribir\('cotizaciones'\) && c\.estado === ESTADO_BORRADOR/.test(fuente), 'Editar debe depender de puedeEscribir y Borrador');
  afirmar(!/innerHTML\s*=\s*[^;'`]*\+/.test(fuente) && !/innerHTML\s*=\s*`[^`]*\$\{/.test(fuente), 'innerHTML con texto interpolado: usar textContent');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
