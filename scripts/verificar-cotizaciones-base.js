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
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/auth.js', 'js/cotizaciones.js', 'js/cotizaciones-pdf.js'];
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
          set(r, datos, opciones) { escrituras.push([r.ruta, datos, opciones]); },
          delete(r) { escrituras.push([r.ruta, null, { borrar: true }]); }
        };
        const resultado = await fn(tx);
        const choque = Array.from(lecturas).some(([ruta, version]) => (docs.has(ruta) ? docs.get(ruta).version : 0) !== version);
        if (choque) { estadisticas.reintentos++; continue; }
        // Todo o nada: si una escritura falla al confirmar, no se aplica ninguna.
        if (estadisticas.fallarEn && escrituras.some(([ruta]) => ruta.startsWith(estadisticas.fallarEn))) throw new Error('fallo simulado al confirmar');
        escrituras.forEach(([ruta, datos, opciones]) => (opciones && opciones.borrar ? docs.delete(ruta) : escribir(ruta, datos, opciones)));
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

// ── Eliminar cotización ──────────────────────────────────────────────────────────────────────────────────────────────
const historialDe = (w) => Array.from(w.db.docs.entries()).filter(([ruta]) => ruta.startsWith('historial_cambios/')).map(([, doc]) => doc.datos);

caso('eliminar: borra un Borrador y registra folio, cliente, total, estado, usuario y fecha en la misma transacción', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos());
  const antes = w.db.estadisticas.transacciones;
  const r = await w.EVE_COTIZACIONES.eliminarCotizacion(alta.id);
  igual(w.db.estadisticas.transacciones - antes, 1, 'transacciones usadas (borrado + historial juntos)');
  igual([r.folio, r.cliente, r.total], ['COT-2026-0001', 'Plásticos del Norte S.A.', 1160], 'resultado');
  igual(w.db.docs.has(`cotizaciones/${alta.id}`), false, 'la cotización debe desaparecer');
  const historial = historialDe(w);
  igual(historial.length, 1, 'entradas en historial_cambios');
  const h = historial[0];
  igual([h.coleccion, h.registroId, h.accion, h.usuario, h.valorNuevo], ['cotizaciones', alta.id, 'eliminacion', 'ventas1', null], 'encabezado del historial');
  igual(h.valorAnterior, { folio: 'COT-2026-0001', cliente: 'Plásticos del Norte S.A.', total: 1160, estado: 'Borrador' }, 'datos eliminados');
  afirmar(!Number.isNaN(Date.parse(h.timestamp)), 'el historial debe llevar la fecha de la eliminación');
  afirmar(h.motivo.includes('COT-2026-0001'), 'el motivo debe nombrar el folio');
});

caso('eliminar: relectura fresca; si otro usuario ya cambió el estado se rechaza y no se borra ni se registra nada', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos());
  w.EVE.cotizaciones = [{ id: alta.id, ...alta.documento }]; // la memoria de la pantalla todavía dice Borrador
  w.db.docs.get(`cotizaciones/${alta.id}`).datos.estado = 'Enviada';
  let error = null;
  try { await w.EVE_COTIZACIONES.eliminarCotizacion(alta.id); } catch (e) { error = e; }
  afirmar(error && /Enviada/.test(error.message) && /Borrador/.test(error.message), 'debía rechazar mencionando el estado actual');
  igual(error.documentoActual.estado, 'Enviada', 'el error trae el documento fresco');
  igual(w.db.docs.has(`cotizaciones/${alta.id}`), true, 'la cotización debe seguir existiendo');
  igual(historialDe(w).length, 0, 'sin entrada de historial');
});

caso('eliminar: cotización inexistente se rechaza y no escribe historial', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  let fallo = false;
  try { await w.EVE_COTIZACIONES.eliminarCotizacion('no-existe'); } catch (e) { fallo = /ya no existe/.test(e.message); }
  afirmar(fallo, 'debía rechazar');
  igual(w.db.docs.size, 0, 'documentos escritos');
});

caso('eliminar: si falla el registro en historial, tampoco se borra la cotización (atomicidad)', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos());
  w.db.estadisticas.fallarEn = 'historial_cambios/';
  let fallo = false;
  try { await w.EVE_COTIZACIONES.eliminarCotizacion(alta.id); } catch (e) { fallo = true; }
  afirmar(fallo, 'debía fallar');
  igual(w.db.docs.has(`cotizaciones/${alta.id}`), true, 'la cotización no debe borrarse sin su historial');
  igual(historialDe(w).length, 0, 'sin entrada de historial');
});

caso('eliminar: el folio no se reutiliza (el contador no baja) y el cliente no se borra', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const primera = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos());
  await w.EVE_COTIZACIONES.eliminarCotizacion(primera.id);
  igual(w.db.docs.get('contadores/COT-2026').datos.ultimo, 1, 'el contador no se decrementa');
  igual(w.db.docs.has('clientes_cotizacion/PLASTICOS-DEL-NORTE-S-A'), true, 'clientes_cotizacion intacto');
  igual((await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos())).folio, 'COT-2026-0002', 'el siguiente folio sigue la secuencia');
});

caso('eliminar: sin permiso de escritura (lectura, ninguno o key ausente) no borra ni registra nada', async () => {
  for (const permisos of [{ cotizaciones: 'lectura' }, { cotizaciones: 'ninguno' }, {}]) {
    const w = conEscritura(crearContexto('2026-10-03'));
    const alta = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos());
    w.EVE.currentUser = { username: 'visor', permisosResueltos: permisos };
    let fallo = false;
    try { await w.EVE_COTIZACIONES.eliminarCotizacion(alta.id); } catch (e) { fallo = true; }
    afirmar(fallo && w.db.docs.has(`cotizaciones/${alta.id}`) && historialDe(w).length === 0, `eliminó con ${JSON.stringify(permisos)}`);
  }
});

caso('eliminar: las reglas actuales ya lo permiten (cotizaciones con write de puedeEscribir; historial_cambios abierto a autenticados)', () => {
  ['firestore.rules', 'rules-test/firestore.rules'].forEach((archivo) => {
    const reglas = leer(archivo);
    const cotizaciones = reglas.match(/match \/cotizaciones\/\{docId\} \{([^}]*)\}/);
    afirmar(cotizaciones && cotizaciones[1].includes("allow write: if puedeEscribir('cotizaciones');"), `${archivo}: write de cotizaciones (incluye delete)`);
    const historial = reglas.match(/match \/historial_cambios\/\{docId\} \{([\s\S]*?)\n    \}/);
    afirmar(historial && historial[1].includes('allow write: if estaAutenticado();'), `${archivo}: historial_cambios debe permitir crear a cualquier autenticado`);
  });
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
  afirmar(/const editable = window\.puedeEscribir\('cotizaciones'\) && cotizacion\.estado === ESTADO_BORRADOR/.test(fuente), 'Editar debe depender de puedeEscribir y Borrador');
  afirmar(/const puedeEliminar = \(cotizacion\) => window\.puedeEscribir\('cotizaciones'\) && cotizacion\.estado === ESTADO_BORRADOR/.test(fuente), 'Eliminar debe depender de puedeEscribir y Borrador');
  afirmar(!/innerHTML\s*=\s*[^;'`]*\+/.test(fuente) && !/innerHTML\s*=\s*`[^`]*\$\{/.test(fuente), 'innerHTML con texto interpolado: usar textContent');
});

// ── Estados, transiciones y revisiones ──────────────────────────────────────────────────────────────────────────────────
const ESTADOS_TODOS = ['Borrador', 'Enviada', 'Aceptada', 'Rechazada', 'Cancelada', 'Reemplazada'];
const VALIDAS = { Borrador: ['Enviada'], Enviada: ['Aceptada', 'Rechazada', 'Cancelada'], Aceptada: ['Cancelada'], Rechazada: [], Cancelada: [], Reemplazada: [] };

// Alta con guardarCotizacion y, si hace falta, fuerza el estado en el Firestore simulado (como si otro usuario lo hubiera cambiado).
async function altaEn(w, estado, extra) {
  const r = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos(extra));
  w.db.docs.get(`cotizaciones/${r.id}`).datos.estado = estado;
  return r;
}
const docDe = (w, id) => w.db.docs.get(`cotizaciones/${id}`).datos;
const rechaza = async (promesa) => { try { await promesa; return null; } catch (e) { return e; } };

caso('estados: la tabla de transiciones es exactamente la definición cerrada', () => {
  const w = crearContexto();
  ESTADOS_TODOS.forEach((de) => ESTADOS_TODOS.forEach((a) => {
    igual(w.EVE_COTIZACIONES.transicionValida(de, a), VALIDAS[de].includes(a), `${de} → ${a}`);
  }));
  igual(w.EVE_COTIZACIONES.ESTADOS, ESTADOS_TODOS, 'catálogo de estados');
});

caso('estados: cada transición válida se aplica y cada inválida se rechaza sin escribir nada', async () => {
  for (const de of ESTADOS_TODOS) {
    for (const a of ESTADOS_TODOS) {
      const w = conEscritura(crearContexto('2026-10-03'));
      const alta = await altaEn(w, de);
      const error = await rechaza(w.EVE_COTIZACIONES.cambiarEstado(alta.id, de, a));
      if (VALIDAS[de].includes(a)) {
        afirmar(!error, `${de} → ${a} debía aplicarse: ${error && error.message}`);
        igual(docDe(w, alta.id).estado, a, `estado tras ${de} → ${a}`);
      } else {
        afirmar(error, `${de} → ${a} debía rechazarse`);
        igual(docDe(w, alta.id).estado, de, `estado intacto tras ${de} → ${a}`);
        igual(historialDe(w).length, 0, `sin historial tras rechazar ${de} → ${a}`);
      }
    }
  }
});

caso('estados: relectura fresca; si otro usuario ya cambió el estado se rechaza, trae el documento real y no escribe', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await altaEn(w, 'Enviada'); // en pantalla seguiría como Borrador
  const error = await rechaza(w.EVE_COTIZACIONES.cambiarEstado(alta.id, 'Borrador', 'Enviada'));
  afirmar(error && /ya está en estado Enviada/.test(error.message), `mensaje: ${error && error.message}`);
  igual(error.documentoActual.estado, 'Enviada', 'documento fresco en el error');
  const otra = await altaEn(w, 'Cancelada');
  afirmar(await rechaza(w.EVE_COTIZACIONES.cambiarEstado(otra.id, 'Enviada', 'Aceptada')), 'aceptó una cotización ya Cancelada');
  igual(docDe(w, otra.id).estado, 'Cancelada', 'estado real intacto');
  igual(historialDe(w).length, 0, 'sin historial');
  afirmar(/no existe/.test((await rechaza(w.EVE_COTIZACIONES.cambiarEstado('no-existe', 'Borrador', 'Enviada'))).message), 'inexistente');
});

caso('estados: historialEstados en el documento e historial_cambios, en UNA transacción por transición', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos());
  const antes = w.db.estadisticas.transacciones;
  await w.EVE_COTIZACIONES.cambiarEstado(alta.id, 'Borrador', 'Enviada');
  igual(w.db.estadisticas.transacciones - antes, 1, 'transacciones por transición');
  await w.EVE_COTIZACIONES.cambiarEstado(alta.id, 'Enviada', 'Aceptada');
  const historial = docDe(w, alta.id).historialEstados;
  igual(historial.map((h) => [h.de, h.a, h.usuario]), [['Borrador', 'Enviada', 'ventas1'], ['Enviada', 'Aceptada', 'ventas1']], 'historialEstados');
  historial.forEach((h) => afirmar(!Number.isNaN(Date.parse(h.fecha)) && /^\d{4}-\d{2}-\d{2}T/.test(h.fecha), 'fecha ISO'));
  const cambios = historialDe(w);
  igual(cambios.map((h) => [h.coleccion, h.registroId, h.accion, h.valorAnterior.estado, h.valorNuevo.estado, h.usuario]),
    [['cotizaciones', alta.id, 'cambio_estado', 'Borrador', 'Enviada', 'ventas1'], ['cotizaciones', alta.id, 'cambio_estado', 'Enviada', 'Aceptada', 'ventas1']], 'historial_cambios');
  afirmar(cambios.every((h) => h.motivo.includes('COT-2026-0001') && !Number.isNaN(Date.parse(h.timestamp))), 'motivo con folio y fecha');
});

caso('estados: atomicidad (si falla historial_cambios no cambia el estado) y sin permiso o sin conexión no escribe', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos());
  w.db.estadisticas.fallarEn = 'historial_cambios/';
  afirmar(await rechaza(w.EVE_COTIZACIONES.cambiarEstado(alta.id, 'Borrador', 'Enviada')), 'debía fallar');
  w.db.estadisticas.fallarEn = null;
  igual([docDe(w, alta.id).estado, docDe(w, alta.id).historialEstados], ['Borrador', undefined], 'estado intacto tras el fallo');
  w.navigator = { onLine: false };
  afirmar(/Sin conexión/.test((await rechaza(w.EVE_COTIZACIONES.cambiarEstado(alta.id, 'Borrador', 'Enviada'))).message), 'sin conexión');
  afirmar(/Sin conexión/.test((await rechaza(w.EVE_COTIZACIONES.crearRevision(alta.id))).message), 'revisión sin conexión');
  w.navigator = { onLine: true };
  for (const permisos of [{ cotizaciones: 'lectura' }, { cotizaciones: 'ninguno' }, {}]) {
    w.EVE.currentUser = { username: 'visor', permisosResueltos: permisos };
    afirmar(await rechaza(w.EVE_COTIZACIONES.cambiarEstado(alta.id, 'Borrador', 'Enviada')), `cambió estado con ${JSON.stringify(permisos)}`);
    afirmar(await rechaza(w.EVE_COTIZACIONES.crearRevision(alta.id)), `creó revisión con ${JSON.stringify(permisos)}`);
  }
  igual([docDe(w, alta.id).estado, historialDe(w).length], ['Borrador', 0], 'nada escrito');
});

caso('revisión: crea COT-…-R2 en Borrador copiando los datos, deja la anterior Reemplazada y NO consume el contador', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos({ notas: 'nota original' }));
  await w.EVE_COTIZACIONES.cambiarEstado(alta.id, 'Borrador', 'Enviada');
  w.obtenerFechaMexico = () => '2026-10-20';
  const antes = w.db.estadisticas.transacciones;
  const r = await w.EVE_COTIZACIONES.crearRevision(alta.id);
  igual(w.db.estadisticas.transacciones - antes, 1, 'transacciones (nueva + anterior + historial juntas)');
  igual(r.folio, 'COT-2026-0001-R2', 'folio');
  const nueva = docDe(w, r.id);
  igual([nueva.folio, nueva.folioBase, nueva.revision, nueva.cotizacionOrigenId, nueva.estado, nueva.creadoPor], ['COT-2026-0001-R2', 'COT-2026-0001', 2, alta.id, 'Borrador', 'ventas1'], 'campos de la revisión');
  const original = docDe(w, alta.id);
  ['cliente', 'clienteId', 'partidas', 'totales', 'condicionesPago', 'condicionesEntrega', 'notas', 'vigenciaDias', 'emisor'].forEach((campo) => igual(nueva[campo], original[campo], `copia de ${campo}`));
  igual(nueva.fecha, '2026-10-20', 'la revisión lleva la fecha de hoy');
  igual([original.estado, original.reemplazadaPor, original.estadoAntesReemplazo, original.revision, original.folioBase], ['Reemplazada', r.id, 'Enviada', 1, 'COT-2026-0001'], 'anterior');
  igual(original.historialEstados.map((h) => [h.de, h.a]), [['Borrador', 'Enviada'], ['Enviada', 'Reemplazada']], 'historialEstados de la anterior');
  igual(w.db.docs.get('contadores/COT-2026').datos.ultimo, 1, 'el contador no se toca');
  igual(Array.from(w.db.docs.keys()).filter((k) => k.startsWith('contadores/')), ['contadores/COT-2026'], 'sin contadores nuevos');
  const cambios = historialDe(w).slice(-2);
  igual(cambios.map((h) => [h.registroId, h.accion, h.valorNuevo.estado]), [[alta.id, 'cambio_estado', 'Reemplazada'], [r.id, 'revision', 'Borrador']], 'historial_cambios de la revisión');
});

caso('revisión: R3 sigue sobre el folio base, vale desde Rechazada y se rechaza desde Borrador, Aceptada, Cancelada o Reemplazada', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await altaEn(w, 'Rechazada');
  const r2 = await w.EVE_COTIZACIONES.crearRevision(alta.id);
  igual(docDe(w, alta.id).estadoAntesReemplazo, 'Rechazada', 'estado guardado de la anterior');
  await w.EVE_COTIZACIONES.cambiarEstado(r2.id, 'Borrador', 'Enviada');
  const r3 = await w.EVE_COTIZACIONES.crearRevision(r2.id);
  igual([r3.folio, docDe(w, r3.id).folioBase, docDe(w, r3.id).revision, docDe(w, r3.id).cotizacionOrigenId], ['COT-2026-0001-R3', 'COT-2026-0001', 3, r2.id], 'R3');
  for (const estado of ['Borrador', 'Aceptada', 'Cancelada', 'Reemplazada']) {
    const otra = await altaEn(w, estado);
    afirmar(await rechaza(w.EVE_COTIZACIONES.crearRevision(otra.id)), `creó revisión desde ${estado}`);
    afirmar(!docDe(w, otra.id).reemplazadaPor, `la ${estado} no debe quedar reemplazada`);
  }
  igual(w.db.docs.get('contadores/COT-2026').datos.ultimo, 5,'el contador solo avanzó por las 5 altas (ninguna revisión lo consumió)');
});

caso('revisión: dos usuarios a la vez → solo UNA revisión viva; el otro es rechazado con relectura fresca', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await altaEn(w, 'Enviada');
  const resultados = await Promise.allSettled([w.EVE_COTIZACIONES.crearRevision(alta.id), w.EVE_COTIZACIONES.crearRevision(alta.id)]);
  igual(resultados.map((r) => r.status).sort(), ['fulfilled', 'rejected'], 'resultados');
  const error = resultados.find((r) => r.status === 'rejected').reason;
  afirmar(/ya tiene una revisión/.test(error.message), `mensaje: ${error.message}`);
  igual(Array.from(w.db.docs.keys()).filter((k) => k.startsWith('cotizaciones/')).length, 2, 'solo la original y una revisión');
  igual(Array.from(w.db.docs.values()).filter((d) => d.datos.folio === 'COT-2026-0001-R2').length, 1, 'un solo R2');
  afirmar(w.db.estadisticas.reintentos > 0, 'la simulación no produjo contención');
  const tercera = await rechaza(w.EVE_COTIZACIONES.crearRevision(alta.id));
  afirmar(tercera && tercera.documentoActual.estado === 'Reemplazada', 'una anterior ya Reemplazada no admite otra revisión');
});

caso('revisión: una cotización sin campo revision se trata como R1 con folioBase = su folio', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const { revisionDe, folioBaseDe } = w.EVE_COTIZACIONES;
  igual([revisionDe({ folio: 'COT-2026-0009' }), folioBaseDe({ folio: 'COT-2026-0009' }), revisionDe({ revision: 'x' }), revisionDe({ revision: 0 })], [1, 'COT-2026-0009', 1, 1], 'helpers');
  const alta = await altaEn(w, 'Enviada');
  const original = docDe(w, alta.id);
  afirmar(original.revision === undefined && original.folioBase === undefined, 'la cotización de prueba debe ser "antigua"');
  const r = await w.EVE_COTIZACIONES.crearRevision(alta.id);
  igual([r.folio, docDe(w, r.id).revision, docDe(w, alta.id).revision, docDe(w, alta.id).folioBase], ['COT-2026-0001-R2', 2, 1, 'COT-2026-0001'], 'revisión de una cotización antigua');
});

caso('revisión: eliminar la revisión en Borrador restaura la anterior (estado guardado) y limpia reemplazadaPor, atómico', async () => {
  for (const previo of ['Enviada', 'Rechazada']) {
    const w = conEscritura(crearContexto('2026-10-03'));
    const alta = await altaEn(w, previo);
    const r2 = await w.EVE_COTIZACIONES.crearRevision(alta.id);
    const antes = w.db.estadisticas.transacciones;
    const resultado = await w.EVE_COTIZACIONES.eliminarCotizacion(r2.id);
    igual(w.db.estadisticas.transacciones - antes, 1, 'una transacción');
    igual(w.db.docs.has(`cotizaciones/${r2.id}`), false, 'la revisión desaparece');
    const original = docDe(w, alta.id);
    igual([original.estado, 'reemplazadaPor' in original, 'estadoAntesReemplazo' in original], [previo, false, false], `anterior restaurada a ${previo}`);
    igual(original.historialEstados.slice(-1).map((h) => [h.de, h.a]), [['Reemplazada', previo]], 'historialEstados de la restauración');
    igual([resultado.restaurada.id, resultado.restaurada.estado], [alta.id, previo], 'resultado');
    const cambios = historialDe(w).slice(-2);
    igual(cambios.map((h) => [h.registroId, h.accion]), [[r2.id, 'eliminacion'], [alta.id, 'cambio_estado']], 'historial_cambios');
    igual(w.db.docs.get('contadores/COT-2026').datos.ultimo, 1, 'el contador no cambia');
    // La anterior vuelve a ser revisable y la nueva revisión recupera el número R2.
    igual((await w.EVE_COTIZACIONES.crearRevision(alta.id)).folio, 'COT-2026-0001-R2', 'nueva revisión tras restaurar');
  }
});

caso('revisión: si falla el registro, ni se borra la revisión ni se restaura la anterior; eliminar una revisión ya no Borrador se rechaza', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await altaEn(w, 'Enviada');
  const r2 = await w.EVE_COTIZACIONES.crearRevision(alta.id);
  w.db.estadisticas.fallarEn = 'historial_cambios/';
  afirmar(await rechaza(w.EVE_COTIZACIONES.eliminarCotizacion(r2.id)), 'debía fallar');
  w.db.estadisticas.fallarEn = null;
  igual([w.db.docs.has(`cotizaciones/${r2.id}`), docDe(w, alta.id).estado], [true, 'Reemplazada'], 'nada a medias');
  await w.EVE_COTIZACIONES.cambiarEstado(r2.id, 'Borrador', 'Enviada');
  afirmar(await rechaza(w.EVE_COTIZACIONES.eliminarCotizacion(r2.id)), 'eliminó una revisión Enviada');
  igual(docDe(w, alta.id).estado, 'Reemplazada', 'la anterior sigue Reemplazada');
});

caso('revisión: eliminar una revisión cuya anterior ya no apunta a ella solo borra la revisión (no toca a nadie más)', async () => {
  const w = conEscritura(crearContexto('2026-10-03'));
  const alta = await altaEn(w, 'Enviada');
  const r2 = await w.EVE_COTIZACIONES.crearRevision(alta.id);
  docDe(w, alta.id).reemplazadaPor = 'otra-id';
  const resultado = await w.EVE_COTIZACIONES.eliminarCotizacion(r2.id);
  igual([resultado.restaurada, docDe(w, alta.id).estado, docDe(w, alta.id).reemplazadaPor], [null, 'Reemplazada', 'otra-id'], 'anterior intacta');
});

// Lista de seguimiento
const cot = (id, extra) => ({ id, folio: `COT-2026-${id}`, estado: 'Borrador', fecha: '2026-10-10', cliente: { razonSocial: 'Plásticos del Norte S.A.' }, totales: { total: 100 }, ...extra });
const ids = (lista) => lista.map((c) => c.id);

caso('lista: filtro de cliente sin distinguir mayúsculas ni acentos', () => {
  const { filtrarCotizaciones } = crearContexto().EVE_COTIZACIONES;
  const lista = [cot('1'), cot('2', { cliente: { razonSocial: 'ÁNGEL Reciclados' } }), cot('3', { cliente: { razonSocial: 'Otro' } })];
  igual(ids(filtrarCotizaciones(lista, { cliente: 'PLASTICOS' })), ['1'], 'sin acento y en mayúsculas');
  igual(ids(filtrarCotizaciones(lista, { cliente: 'plásticos del' })), ['1'], 'con acento');
  igual(ids(filtrarCotizaciones(lista, { cliente: 'angel' })), ['2'], 'Á → a');
  igual(ids(filtrarCotizaciones(lista, { cliente: '  ' })), ['1', '2', '3'], 'vacío no filtra');
  igual(ids(filtrarCotizaciones(lista, { cliente: 'zzz' })), [], 'sin coincidencias');
});

caso('lista: filtro de estado y Reemplazadas ocultas por defecto con interruptor', () => {
  const { filtrarCotizaciones } = crearContexto().EVE_COTIZACIONES;
  const lista = [cot('1'), cot('2', { estado: 'Enviada' }), cot('3', { estado: 'Reemplazada' })];
  igual(ids(filtrarCotizaciones(lista, {})), ['1', '2'], 'por defecto sin Reemplazadas');
  igual(ids(filtrarCotizaciones(lista, { verReemplazadas: true })), ['1', '2', '3'], 'con el interruptor');
  igual(ids(filtrarCotizaciones(lista, { estado: 'Enviada' })), ['2'], 'un estado');
  igual(ids(filtrarCotizaciones(lista, { estado: 'Reemplazada' })), ['3'], 'pedir Reemplazada la muestra aunque el interruptor esté apagado');
});

caso('lista: rango de fechas abierto (ninguno, solo Desde, solo Hasta, ambos) con límites inclusivos', () => {
  const { filtrarCotizaciones } = crearContexto().EVE_COTIZACIONES;
  const lista = ['2026-09-30', '2026-10-01', '2026-10-15', '2026-10-31', '2026-11-01'].map((fecha, i) => cot(String(i + 1), { fecha }));
  igual(ids(filtrarCotizaciones(lista, {})), ['1', '2', '3', '4', '5'], 'ninguno');
  igual(ids(filtrarCotizaciones(lista, { desde: '2026-10-15' })), ['3', '4', '5'], 'solo Desde (inclusivo)');
  igual(ids(filtrarCotizaciones(lista, { hasta: '2026-10-15' })), ['1', '2', '3'], 'solo Hasta (inclusivo)');
  igual(ids(filtrarCotizaciones(lista, { desde: '2026-10-01', hasta: '2026-10-31' })), ['2', '3', '4'], 'ambos');
  igual(ids(filtrarCotizaciones(lista, { desde: '2026-10-31', hasta: '2026-10-01' })), [], 'Desde posterior a Hasta');
  igual(ids(filtrarCotizaciones([cot('9', { fecha: undefined })], { desde: '2026-01-01' })), [], 'sin fecha no entra en un rango');
  igual(ids(filtrarCotizaciones([cot('9', { fecha: undefined })], {})), ['9'], 'sin fecha entra sin rango');
});

caso('lista: filtros combinados y totales por estado (cantidad e importe) según lo filtrado', () => {
  const { filtrarCotizaciones, totalesPorEstado } = crearContexto().EVE_COTIZACIONES;
  const lista = [
    cot('1', { totales: { total: 100.1 } }), cot('2', { totales: { total: 200.2 } }),
    cot('3', { estado: 'Enviada', totales: { total: 1160 } }), cot('4', { estado: 'Aceptada', totales: { total: 50 } }),
    cot('5', { estado: 'Enviada', fecha: '2026-09-01', totales: { total: 10 } }), cot('6', { estado: 'Reemplazada', totales: { total: 999 } })
  ];
  const todos = totalesPorEstado(filtrarCotizaciones(lista, {}));
  igual(todos.map((t) => [t.estado, t.cantidad, t.total]), [['Borrador', 2, 300.3], ['Enviada', 2, 1170], ['Aceptada', 1, 50], ['Rechazada', 0, 0], ['Cancelada', 0, 0], ['Reemplazada', 0, 0]], 'sin Reemplazadas por defecto');
  const octubre = totalesPorEstado(filtrarCotizaciones(lista, { desde: '2026-10-01', verReemplazadas: true }));
  igual(octubre.map((t) => [t.estado, t.cantidad, t.total]), [['Borrador', 2, 300.3], ['Enviada', 1, 1160], ['Aceptada', 1, 50], ['Rechazada', 0, 0], ['Cancelada', 0, 0], ['Reemplazada', 1, 999]], 'Desde + interruptor');
  igual(ids(filtrarCotizaciones(lista, { cliente: 'plasticos', estado: 'Enviada', desde: '2026-10-01' })), ['3'], 'cliente + estado + Desde');
});

caso('lista: infoRevisiones marca la revisión vigente de cada cotización con revisiones', () => {
  const { infoRevisiones } = crearContexto().EVE_COTIZACIONES;
  const lista = [
    cot('0001', { estado: 'Reemplazada' }), cot('0001-R2', { folioBase: 'COT-2026-0001', revision: 2, estado: 'Reemplazada' }),
    cot('0001-R3', { folioBase: 'COT-2026-0001', revision: 3, estado: 'Enviada' }), cot('0002', { estado: 'Aceptada' })
  ];
  lista[0].id = 'a'; lista[1].id = 'b'; lista[2].id = 'c'; lista[3].id = 'd';
  const info = infoRevisiones(lista);
  igual([info.get('COT-2026-0001').cantidad, info.get('COT-2026-0001').vigenteId], [3, 'c'], 'cadena con revisiones');
  igual([info.get('COT-2026-0002').cantidad, info.get('COT-2026-0002').vigenteId], [1, 'd'], 'cotización sin revisiones');
});

caso('estados: solo-lectura sin botones, colores solo por variables, filtro de Historial y reglas sin tocar', () => {
  const fuente = leer('js/cotizaciones.js');
  afirmar(/if \(window\.puedeEscribir\('cotizaciones'\)\) \{\s*\(TRANSICIONES\[cotizacion\.estado\] \|\| \[\]\)\.forEach/.test(fuente), 'los botones de estado deben depender de puedeEscribir');
  afirmar(/if \(window\.puedeEscribir\('cotizaciones'\)\) \{\s*\(TRANSICIONES/.test(fuente) && /ESTADOS_CON_REVISION\.includes\(cotizacion\.estado\)/.test(fuente), 'Crear revisión solo en Enviada o Rechazada y bajo puedeEscribir');
  afirmar(/ESTADOS_CON_CONFIRMACION\.includes\(nuevo\) && !window\.confirm/.test(fuente), 'Rechazada y Cancelada piden confirmación');
  afirmar(!/EVE_HISTORIAL\.registrar/.test(fuente.split('async function cambiarEstado')[1].split('// ── Lista de seguimiento')[0]), 'las transiciones no deben usar EVE_HISTORIAL.registrar');
  const css = leer('css/styles.css');
  ESTADOS_TODOS.forEach((e) => {
    const n = e.toLowerCase();
    ['bg', 'texto', 'borde'].forEach((p) => igual(css.split(`--estado-${n}-${p}:`).length - 1, 1, `--estado-${n}-${p} definida una sola vez`));
    const regla = css.match(new RegExp(`\\.cot-estado-${n} \\{([^}]*)\\}`));
    afirmar(regla && !/#[0-9a-fA-F]{3,8}\b|rgb/.test(regla[1]), `la etiqueta ${e} no debe usar colores literales`);
  });
  afirmar(/\{ value: 'cotizaciones', label: 'Cotizaciones' \}/.test(leer('js/historial.js')), 'el selector del Historial debe incluir cotizaciones');
});

// ── PDF de la cotización (jsPDF simulado; el PDF real se prueba en verificar-cotizaciones-pdf.js) ───────────────────────────
function crearJsPdfSimulado() {
  const creados = [];
  function jsPDF(opciones) {
    const doc = { opciones, textos: [], tablas: [], paginas: 1, pagina: 1, guardado: null, imagenes: 0, colores: [] };
    doc.internal = { pageSize: { getWidth: () => 215.9, getHeight: () => 279.4 }, getNumberOfPages: () => doc.paginas };
    ['setFont', 'setFontSize', 'setDrawColor', 'setLineWidth', 'rect', 'line'].forEach((nombre) => { doc[nombre] = () => doc; });
    doc.setTextColor = (...color) => { doc.colores.push(color); return doc; };
    doc.setFillColor = (...color) => { doc.colores.push(color); return doc; };
    doc.setPage = (n) => { doc.pagina = n; };
    doc.addPage = () => { doc.paginas++; doc.pagina = doc.paginas; };
    doc.addImage = () => { doc.imagenes++; };
    doc.getTextWidth = (t) => String(t).length * 3;
    doc.splitTextToSize = (t, ancho) => {
      const max = Math.max(10, Math.floor(ancho / 2));
      const lineas = [];
      for (let i = 0; i < String(t).length; i += max) lineas.push(String(t).slice(i, i + max));
      return lineas.length ? lineas : [''];
    };
    doc.text = (t, x, y, op) => { (Array.isArray(t) ? t : [t]).forEach((linea) => doc.textos.push({ texto: String(linea), pagina: doc.pagina, op })); };
    doc.autoTable = (op) => { doc.tablas.push(op); doc.lastAutoTable = { finalY: (op.startY || 0) + 10 + op.body.length * 8 }; };
    doc.save = (nombre) => { doc.guardado = nombre; };
    creados.push(doc);
    return doc;
  }
  return { jsPDF, creados };
}
const EMISOR_PDF = { razonSocial: 'ACME EMISOR DE PRUEBA SA', rfc: 'AEP010101AAA', domicilioFiscal: 'Calle Falsa 123, Col. Peñuelas', telefono: '555 1234', correo: 'ventas@acme.example', condicionesPagoDefault: '', condicionesEntregaDefault: '', vigenciaDias: 15 };
const textosDe = (doc) => doc.textos.map((t) => t.texto);

// Contexto con jsPDF simulado, el emisor guardado en config/emisor y una cotización dada de alta (con el estado pedido).
async function contextoPdf(estado, emisor, datos) {
  const w = conEscritura(crearContexto('2026-10-03'));
  const simulado = crearJsPdfSimulado();
  w.jspdf = { jsPDF: simulado.jsPDF };
  await w.EVE_COTIZACIONES.guardarEmisor(emisor || EMISOR_PDF);
  const alta = await w.EVE_COTIZACIONES.guardarCotizacion(datosValidos(datos));
  w.db.docs.get(`cotizaciones/${alta.id}`).datos.estado = estado || 'Enviada';
  const cotizacion = () => ({ id: alta.id, ...w.db.docs.get(`cotizaciones/${alta.id}`).datos });
  return { w, simulado, alta, cotizacion };
}

caso('PDF: total en letra (cero, un peso, mil, millón, centavos) en pesos mexicanos', () => {
  const { totalEnLetra } = crearContexto().EVE_COTIZACIONES_PDF;
  const esperado = [
    [0, 'CERO PESOS 00/100 M.N.'], [0.5, 'CERO PESOS 50/100 M.N.'], [1, 'UN PESO 00/100 M.N.'], [2, 'DOS PESOS 00/100 M.N.'],
    [15, 'QUINCE PESOS 00/100 M.N.'], [21, 'VEINTIUN PESOS 00/100 M.N.'], [22, 'VEINTIDÓS PESOS 00/100 M.N.'], [31, 'TREINTA Y UN PESOS 00/100 M.N.'],
    [100, 'CIEN PESOS 00/100 M.N.'], [101, 'CIENTO UN PESOS 00/100 M.N.'], [999, 'NOVECIENTOS NOVENTA Y NUEVE PESOS 00/100 M.N.'],
    [1000, 'UN MIL PESOS 00/100 M.N.'], [1001, 'UN MIL UN PESOS 00/100 M.N.'], [21000, 'VEINTIUN MIL PESOS 00/100 M.N.'], [100000, 'CIEN MIL PESOS 00/100 M.N.'],
    [1234.56, 'UN MIL DOSCIENTOS TREINTA Y CUATRO PESOS 56/100 M.N.'], [69.6, 'SESENTA Y NUEVE PESOS 60/100 M.N.'],
    [1000000, 'UN MILLÓN DE PESOS 00/100 M.N.'], [1000001, 'UN MILLÓN UN PESOS 00/100 M.N.'], [2000000, 'DOS MILLONES DE PESOS 00/100 M.N.'],
    [2500000.5, 'DOS MILLONES QUINIENTOS MIL PESOS 50/100 M.N.'], [1000000000, 'UN MIL MILLONES DE PESOS 00/100 M.N.'],
    [999999999999.99, 'NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE MILLONES NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE PESOS 99/100 M.N.']
  ];
  esperado.forEach(([importe, letra]) => igual(totalEnLetra(importe), letra, `total en letra de ${importe}`));
  igual([totalEnLetra(0.005), totalEnLetra(1.005), totalEnLetra(0.1 + 0.2), totalEnLetra('1160')], ['CERO PESOS 01/100 M.N.', 'UN PESO 01/100 M.N.', 'CERO PESOS 30/100 M.N.', 'UN MIL CIENTO SESENTA PESOS 00/100 M.N.'], 'redondeo a centavos y texto numérico');
  [-1, NaN, 'x', 1e12, Infinity].forEach((malo) => afirmar((() => { try { totalEnLetra(malo); return false; } catch (e) { return true; } })(), `aceptó ${malo}`));
});

caso('PDF: el nombre del archivo es el folio completo con la revisión', () => {
  const { nombreArchivo } = crearContexto().EVE_COTIZACIONES_PDF;
  igual([nombreArchivo({ folio: 'COT-2026-0001' }), nombreArchivo({ folio: 'COT-2026-0001-R2' }), nombreArchivo({ folio: 'COT-2026-0001-R10' })],
    ['COT-2026-0001.pdf', 'COT-2026-0001-R2.pdf', 'COT-2026-0001-R10.pdf'], 'nombres');
  igual([nombreArchivo({ folio: 'a/b\\c:d e' }), nombreArchivo({}), nombreArchivo(null)], ['a_b_c_d_e.pdf', 'cotizacion.pdf', 'cotizacion.pdf'], 'caracteres no seguros');
});

caso('PDF: fecha límite = fecha + vigencia (cruza mes y año, bisiesto); fecha inválida no inventa límite', () => {
  const { fechaLimite } = crearContexto().EVE_COTIZACIONES_PDF;
  igual([fechaLimite('2026-10-01', 15), fechaLimite('2026-12-20', 15), fechaLimite('2028-02-20', 10), fechaLimite('2026-10-01', '30'), fechaLimite('2026-10-01', 0)],
    ['2026-10-16', '2027-01-04', '2028-03-01', '2026-10-31', '2026-10-01'], 'fechas límite');
  igual([fechaLimite('2026-02-30', 15), fechaLimite('', 15), fechaLimite('03/10/2026', 15)], ['', '', ''], 'fechas inválidas');
});

caso('PDF: marca de agua por estado (Borrador, Cancelada, Rechazada y Reemplazada; Enviada y Aceptada sin marca)', async () => {
  const { marcaDeAgua } = crearContexto().EVE_COTIZACIONES_PDF;
  igual(['Borrador', 'Cancelada', 'Rechazada', 'Reemplazada'].map((e) => marcaDeAgua(e).texto), ['BORRADOR', 'CANCELADA', 'RECHAZADA', 'REEMPLAZADA'], 'textos');
  igual(['Enviada', 'Aceptada', 'otro', undefined].map((e) => marcaDeAgua(e)), [null, null, null, null], 'sin marca');
  for (const estado of ['Borrador', 'Cancelada', 'Rechazada', 'Reemplazada']) {
    const { w, simulado, cotizacion } = await contextoPdf(estado);
    await w.EVE_COTIZACIONES_PDF.generarPDF(cotizacion());
    igual(textosDe(simulado.creados[0]).filter((t) => t === estado.toUpperCase()).length, 1, `marca ${estado} en la página`);
  }
  for (const estado of ['Enviada', 'Aceptada']) {
    const { w, simulado, cotizacion } = await contextoPdf(estado);
    await w.EVE_COTIZACIONES_PDF.generarPDF(cotizacion());
    afirmar(!textosDe(simulado.creados[0]).some((t) => ['BORRADOR', 'CANCELADA', 'RECHAZADA', 'REEMPLAZADA'].includes(t)), `${estado} no debe llevar marca`);
  }
});

caso('PDF: leyenda "Sustituye a" en revisiones R2 o mayores (R2 → folio base, R3 → R2); la R1 no la lleva', async () => {
  const { w, simulado, alta } = await contextoPdf('Enviada');
  const r2 = await w.EVE_COTIZACIONES.crearRevision(alta.id);
  await w.EVE_COTIZACIONES.cambiarEstado(r2.id, 'Borrador', 'Enviada');
  const r3 = await w.EVE_COTIZACIONES.crearRevision(r2.id);
  const doc = (id) => ({ id, ...w.db.docs.get(`cotizaciones/${id}`).datos });
  await w.EVE_COTIZACIONES_PDF.generarPDF(doc(r2.id));
  await w.EVE_COTIZACIONES_PDF.generarPDF(doc(r3.id));
  await w.EVE_COTIZACIONES_PDF.generarPDF(doc(alta.id));
  const [pdfR2, pdfR3, pdfR1] = simulado.creados.map(textosDe);
  afirmar(pdfR2.includes('Sustituye a COT-2026-0001'), 'R2 sustituye a la base');
  afirmar(pdfR3.includes('Sustituye a COT-2026-0001-R2'), 'R3 sustituye a R2');
  afirmar(!pdfR1.some((t) => t.startsWith('Sustituye a')), 'la R1 no lleva leyenda');
  afirmar(pdfR2.includes('COT-2026-0001-R2') && pdfR3.includes('COT-2026-0001-R3'), 'folio completo con la revisión en el título');
  igual(simulado.creados.map((d) => d.guardado), ['COT-2026-0001-R2.pdf', 'COT-2026-0001-R3.pdf', 'COT-2026-0001.pdf'], 'nombres de archivo');
});

caso('PDF: el emisor sale de config/emisor (obtenerEmisor), no del código, y el contenido pedido está completo', async () => {
  const { w, simulado, cotizacion } = await contextoPdf('Enviada', null, { aplicaIva: true, notas: 'Entrega sujeta a existencia' });
  await w.EVE_COTIZACIONES_PDF.generarPDF(cotizacion());
  const textos = textosDe(simulado.creados[0]);
  ['ACME EMISOR DE PRUEBA SA', 'RFC: AEP010101AAA', 'Tel. 555 1234   ventas@acme.example', 'COTIZACIÓN', 'COT-2026-0001', 'Fecha: 03/10/2026',
    'Vigencia: 15 días - válida hasta el 18/10/2026', 'Plásticos del Norte S.A.', 'Ana Pérez', '8112345678', 'Av. 1 #100',
    'Subtotal', '$1,000.00', 'IVA 16%', '$160.00', 'TOTAL', '$1,160.00', 'UN MIL CIENTO SESENTA PESOS 00/100 M.N.',
    'Condiciones de pago', 'Contado', 'Condiciones de entrega', 'En planta', 'Notas', 'Entrega sujeta a existencia']
    .forEach((fragmento) => afirmar(textos.includes(fragmento), `falta "${fragmento}" en el PDF`));
  afirmar(textos.some((t) => t.startsWith('Domicilio fiscal: Calle Falsa 123')), 'domicilio fiscal del emisor');
  afirmar(!textos.includes('RIVAL PLASTIC SAPI DE CV'), 'no debe usar la razón social por omisión si config/emisor tiene otra');
  const tabla = simulado.creados[0].tablas[0];
  igual(tabla.head[0], ['Cant.', 'Unidad', 'Descripción', 'Precio unit.', 'Desc. %', 'Importe'], 'columnas de la tabla');
  igual(tabla.body, [['10', 'PZ', 'TAMBO', '$100.00', '0%', '$1,000.00']], 'partidas');
  igual([simulado.creados[0].opciones.format, simulado.creados[0].opciones.orientation], ['letter', 'portrait'], 'carta vertical');
});

caso('PDF: IVA solo si estaba marcado, y descuento (importe sin descuento, descuento y subtotal) solo si aplica', async () => {
  const sin = await contextoPdf('Enviada', null, { aplicaIva: false });
  await sin.w.EVE_COTIZACIONES_PDF.generarPDF(sin.cotizacion());
  const textosSin = textosDe(sin.simulado.creados[0]);
  afirmar(!textosSin.some((t) => t.startsWith('IVA')) && !textosSin.includes('Descuento') && textosSin.includes('Subtotal'), 'sin IVA ni descuento');
  igual(textosSin.includes('TOTAL') && textosSin.filter((t) => t === '$1,000.00').length >= 2, true, 'subtotal = total sin IVA');
  const con = await contextoPdf('Enviada', null, { aplicaIva: true, partidas: [partidaValida({ cantidad: '10', precioUnitario: '100', descuentoPct: '10' }), partidaValida({ cantidad: '3', precioUnitario: '49.99', descuentoPct: '0' })] });
  await con.w.EVE_COTIZACIONES_PDF.generarPDF(con.cotizacion());
  const textosCon = textosDe(con.simulado.creados[0]);
  ['Importe sin descuento', '$1,149.97', 'Descuento', '- $100.00', 'Subtotal', '$1,049.97', 'IVA 16%', '$168.00', '$1,217.97', 'UN MIL DOSCIENTOS DIECISIETE PESOS 97/100 M.N.']
    .forEach((fragmento) => afirmar(textosCon.includes(fragmento), `falta "${fragmento}"`));
});

caso('PDF: emisor incompleto (sin RFC o domicilio fiscal) avisa y pide confirmación; si acepta genera, si cancela no', async () => {
  igual(crearContexto().EVE_COTIZACIONES_PDF.faltantesEmisor({ razonSocial: 'X', rfc: ' ', domicilioFiscal: '' }), ['RFC', 'domicilio fiscal'], 'faltantes');
  igual(crearContexto().EVE_COTIZACIONES_PDF.faltantesEmisor(EMISOR_PDF), [], 'emisor completo');
  const incompleto = { ...EMISOR_PDF, rfc: '', domicilioFiscal: '' };
  const { w, simulado, cotizacion } = await contextoPdf('Enviada', incompleto);
  const mensajes = [];
  w.confirm = (mensaje) => { mensajes.push(mensaje); return false; };
  igual(await w.EVE_COTIZACIONES_PDF.generarPDF(cotizacion()), null, 'cancelar devuelve null');
  igual([simulado.creados.length, mensajes.length], [0, 1], 'sin PDF tras cancelar; un aviso');
  afirmar(mensajes[0].includes('RFC') && mensajes[0].includes('domicilio fiscal') && /de todos modos/.test(mensajes[0]), `aviso: ${mensajes[0]}`);
  w.confirm = (mensaje) => { mensajes.push(mensaje); return true; };
  igual(await w.EVE_COTIZACIONES_PDF.generarPDF(cotizacion()), 'COT-2026-0001.pdf', 'aceptar genera igual');
  igual(simulado.creados.length, 1, 'PDF generado');
  const textos = textosDe(simulado.creados[0]);
  afirmar(!textos.some((t) => t.startsWith('RFC:') || t.startsWith('Domicilio fiscal:')), 'no inventa RFC ni domicilio');
  // Con solo uno de los dos datos, avisa solo de ese.
  const soloRfc = await contextoPdf('Enviada', { ...EMISOR_PDF, domicilioFiscal: '' });
  const avisos = [];
  soloRfc.w.confirm = (m) => { avisos.push(m); return true; };
  await soloRfc.w.EVE_COTIZACIONES_PDF.generarPDF(soloRfc.cotizacion());
  afirmar(avisos.length === 1 && avisos[0].includes('domicilio fiscal') && !avisos[0].includes('RFC'), `aviso parcial: ${avisos[0]}`);
  // Emisor completo: no pregunta.
  const completo = await contextoPdf('Enviada');
  let preguntas = 0;
  completo.w.confirm = () => { preguntas++; return false; };
  igual(await completo.w.EVE_COTIZACIONES_PDF.generarPDF(completo.cotizacion()), 'COT-2026-0001.pdf', 'completo genera sin preguntar');
  igual(preguntas, 0, 'confirmaciones con emisor completo');
});

caso('PDF: generar el PDF no modifica ningún dato ni consume folio (cualquier estado y permiso de solo lectura)', async () => {
  for (const estado of ['Borrador', 'Enviada', 'Aceptada', 'Rechazada', 'Cancelada', 'Reemplazada']) {
    const { w, cotizacion } = await contextoPdf(estado);
    w.EVE.currentUser = { username: 'visor', permisosResueltos: { cotizaciones: 'lectura' } };
    const foto = () => JSON.stringify(Array.from(w.db.docs.entries()));
    const antes = foto();
    const transacciones = w.db.estadisticas.transacciones;
    await w.EVE_COTIZACIONES_PDF.generarPDF(cotizacion());
    igual(foto() === antes, true, `${estado}: los datos no deben cambiar`);
    igual(w.db.estadisticas.transacciones, transacciones, `${estado}: sin transacciones`);
    igual(w.db.docs.get('contadores/COT-2026').datos.ultimo, 1, `${estado}: el contador no avanza`);
  }
});

caso('PDF: acentos y eñe llegan íntegros al documento (emisor, cliente, partidas, condiciones y notas)', async () => {
  const emisor = { ...EMISOR_PDF, razonSocial: 'PEÑA Y COMPAÑÍA SA DE CV', domicilioFiscal: 'Av. Ñuñoa #5, Col. Niño Artillero' };
  const { w, simulado, cotizacion } = await contextoPdf('Enviada', emisor, {
    cliente: { razonSocial: 'Peñafiel Núñez S.A.', contacto: 'José Muñoz', telefono: '1', direccion: 'Calle Año Nuevo #1, Col. Peñuelas' },
    condicionesPago: 'Crédito a 30 días, según acuerdo', notas: '¡Gracias por su preferencia! Entrega después de las 16:00 h.',
    partidas: [partidaValida({ producto: '', descripcion: 'Envase para compañía, diseño único', unidad: 'PZ' })]
  });
  await w.EVE_COTIZACIONES_PDF.generarPDF(cotizacion());
  const textos = textosDe(simulado.creados[0]);
  ['PEÑA Y COMPAÑÍA SA DE CV', 'Peñafiel Núñez S.A.', 'José Muñoz', 'Calle Año Nuevo #1, Col. Peñuelas', 'Crédito a 30 días, según acuerdo', '¡Gracias por su preferencia! Entrega después de las 16:00 h.', 'Razón Social:', 'Teléfono:', 'Dirección:', 'COTIZACIÓN']
    .forEach((fragmento) => afirmar(textos.includes(fragmento), `falta "${fragmento}" con acentos`));
  afirmar(textos.some((t) => t.includes('Av. Ñuñoa #5, Col. Niño Artillero')), 'domicilio con eñes');
  igual(simulado.creados[0].tablas[0].body[0][2], 'Envase para compañía, diseño único', 'descripción libre con eñe y acentos');
  igual(w.EVE_COTIZACIONES_PDF.totalEnLetra(1234.56).includes('Ñ'), false, 'el total en letra no necesita eñe');
});

caso('PDF: con 30 partidas el cuerpo lleva las 30, el pie numera todas las páginas y el contenido cabe sin salirse', async () => {
  const partidas = Array.from({ length: 30 }, (_, i) => partidaValida({ cantidad: String(i + 1), precioUnitario: '10' }));
  const { w, simulado, cotizacion } = await contextoPdf('Borrador', null, { partidas, aplicaIva: false });
  await w.EVE_COTIZACIONES_PDF.generarPDF(cotizacion());
  const doc = simulado.creados[0];
  const tabla = doc.tablas[0];
  igual(tabla.body.length, 30, 'partidas en la tabla');
  igual([tabla.margin.left, tabla.margin.right, tabla.margin.bottom >= 20], [15, 15, true], 'márgenes (el pie reserva espacio abajo)');
  afirmar(typeof tabla.willDrawPage === 'function', 'la marca de agua debe pintarse en cada página nueva de la tabla');
  afirmar(doc.paginas > 1, `con 30 partidas el total y las condiciones deben pasar a otra página (páginas: ${doc.paginas})`);
  const pies = textosDe(doc).filter((t) => /^Página \d+ de \d+$/.test(t));
  igual(pies, Array.from({ length: doc.paginas }, (_, i) => `Página ${i + 1} de ${doc.paginas}`), 'pie de cada página');
  igual(textosDe(doc).filter((t) => t === 'BORRADOR').length, doc.paginas, 'marca de agua en cada página (incluida la que crea el contenido posterior a la tabla)');
});

caso('PDF: botón PDF en lista y formulario para cualquier estado y permiso; el módulo está en index.html y el service worker', () => {
  const fuente = leer('js/cotizaciones.js');
  const celda = fuente.split('function crearCeldaAcciones')[1].split('function crearTablaCotizaciones')[0];
  afirmar(celda.indexOf("'PDF'") !== -1 && celda.indexOf("'PDF'") < celda.indexOf("if (window.puedeEscribir('cotizaciones'))"), 'el botón PDF de la lista debe ir antes (y fuera) del bloque de puedeEscribir');
  const formulario = fuente.split('function crearFormulario')[1].split('form.addEventListener(\'submit\'')[0];
  afirmar(/if \(editando\) \{\s*const pdf = crearElemento\('button', 'btn-secondary cot-pdf', 'PDF'\)/.test(formulario), 'el botón PDF del formulario depende solo de editando (no de soloLectura)');
  afirmar(leer('index.html').includes('js/cotizaciones-pdf.js') && leer('service-worker.js').includes("'js/cotizaciones-pdf.js'"), 'index.html y APP_SHELL');
  const pdf = leer('js/cotizaciones-pdf.js');
  afirmar(!/RIVAL PLASTIC|RPS\d{6}/.test(pdf), 'el módulo del PDF no debe llevar datos del emisor fijos');
  afirmar(!/window\.db|\.collection\(|runTransaction|\.batch\(/.test(pdf), 'el módulo del PDF no debe tocar Firestore (el emisor llega por obtenerEmisor)');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
