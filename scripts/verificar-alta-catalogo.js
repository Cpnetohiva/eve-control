// Verificación del alta de materiales/productos en el catálogo:
//   1) LECHERO LAVADO ya está en el catálogo base (se obtiene en producción, se vende, no se recibe ni se selecciona).
//   2) window.EVE_CATALOGO.agregarMaterialAlCatalogo: alta válida, duplicado, alias, archivado, nombre parecido, sin permiso,
//      sin red, catálogo que cambió, reglas que niegan, y que el producto nuevo aparezca en Ventas, Inventario y Rendimientos.
//   3) Ventas: el aviso y la confirmación del alta (funciones puras) y que NUNCA se cree un producto al guardar la venta.
//
// Carga js/config.js, js/utils.js, js/rendimientos.js, js/inventario.js, js/control-produccion-reglas.js y js/ventas.js en un
// contexto vm, con Firestore (db.runTransaction), permisos, red e historial simulados (stubs).
//
// Uso: node scripts/verificar-alta-catalogo.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/rendimientos.js', 'js/inventario.js', 'js/control-produccion-reglas.js', 'js/ventas.js'];

// opciones: { admin (true), enLinea (true), remoto (extensión guardada o undefined), falla (error de Firestore) }
function crearContexto(opciones) {
  const cfg = Object.assign({ admin: true, enLinea: true, remoto: undefined, falla: null }, opciones);
  const estado = { escrituras: [], transacciones: 0, historial: [], remoto: cfg.remoto };
  const db = {
    collection: (coleccion) => ({ doc: (id) => ({ ruta: `${coleccion}/${id}` }) }),
    runTransaction: async (fn) => {
      estado.transacciones += 1;
      if (cfg.falla) throw cfg.falla;
      const tx = {
        get: async () => ({ exists: estado.remoto !== undefined, data: () => ({ catalogoExtra: estado.remoto }) }),
        set: (ref, datos, opcionesSet) => { estado.escrituras.push({ ruta: ref.ruta, datos, opcionesSet }); estado.remoto = datos.catalogoExtra; }
      };
      return fn(tx);
    }
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {}, navigator: { onLine: cfg.enLinea },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {};
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  sandbox.window.db = db;
  sandbox.window.puedeEscribir = (modulo) => cfg.admin && modulo === 'admin';
  sandbox.window.EVE_HISTORIAL = { registrar: async (entrada) => { estado.historial.push(entrada); } };
  // Lo que auth.js deja cargado al iniciar sesión: la extensión que hay en Firestore.
  sandbox.window.EVE.catalogoExtra = cfg.remoto;
  if (cfg.remoto !== undefined) sandbox.window.EVE_CATALOGO.aplicar(cfg.remoto);
  return { w: sandbox.window, estado };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  afirmar(a === b, `${mensaje}: esperado ${b}, obtenido ${a}`);
}
const alta = (w, nombre, opciones) => w.EVE_CATALOGO.agregarMaterialAlCatalogo(nombre, opciones);
const sinEscribir = (estado, mensaje) => afirmar(estado.escrituras.length === 0 && estado.historial.length === 0, `${mensaje}: no debe escribir ni registrar historial`);
const VACIO = { inventarioInicial: [], registrosDestaraje: [], registrosControlProduccion: [], ventas: [] };

// ===== 1) LECHERO LAVADO en el catálogo base =====

caso('LECHERO LAVADO: base, se obtiene en producción, se vende, no se recibe ni se selecciona', () => {
  const { w } = crearContexto();
  const entrada = w.EVE_CATALOGO.buscar('lechero lavado');
  afirmar(entrada, 'existe en el catálogo');
  igual([entrada.unidad, entrada.seObtieneEnProduccion, entrada.recibible, entrada.requiereSeleccion, entrada.activo], ['KG', true, false, false, undefined], 'banderas');
  afirmar(w.productosVenta().includes('LECHERO LAVADO') && w.PRODUCTOS_VENTA.includes('LECHERO LAVADO'), 'se ofrece en Ventas');
  afirmar(w.materialesConStock().includes('LECHERO LAVADO'), 'tiene existencias (Inventario)');
  afirmar(w.materialesProducibles().includes('LECHERO LAVADO'), 'sale de proceso');
  afirmar(!w.MATERIALES_COMUNES.includes('LECHERO LAVADO'), 'NO se recibe en báscula (ni Precios ni Pagos)');
  afirmar(!w.materialesQueRequierenSeleccion().includes('LECHERO LAVADO') && !w.materialesQueRequierenSeleccionHistoricos().includes('LECHERO LAVADO'), 'no se selecciona');
  igual(w.EVE_INVENTARIO.etapasOrigen('SELECCION', 'LECHERO LAVADO'), [], 'Selección no lo toma como entrada');
});

caso('LECHERO LAVADO: no contamina la lista de pellets de Peletizado y sí es entrada de Peletizado/venta', () => {
  const { w } = crearContexto();
  const pellets = w.EVE_CP_REGLAS.salidasLibresPermitidas('PELETIZADO');
  afirmar(!pellets.includes('LECHERO LAVADO'), 'no es una salida de pellet');
  igual(pellets, ['LECHERO PELETIZADO', 'P.E. PELETIZADO', 'P.P. PELETIZADO', 'PELLET AGRO20', 'PELLET CAJAS', 'PELLET TAMBO', 'PELLET TAPON', 'SUERO PELETIZADO'], 'los pellets de siempre');
  afirmar(w.EVE_INVENTARIO.etapasOrigen('PELETIZADO', 'LECHERO LAVADO').includes('LAVADO'), 'Peletizado lo toma de la etapa LAVADO');
});

caso('LECHERO LAVADO: aparece en Inventario (con saldo) y en Rendimientos (subproducto de una composición)', () => {
  const { w } = crearContexto();
  const filas = w.EVE_INVENTARIO.calcularInventarioCalculado({ ...VACIO, inventarioInicial: [{ material: 'LECHERO LAVADO', etapa: 'LAVADO', kg: 120, fecha: '2026-09-01' }] });
  igual(filas, [{ material: 'LECHERO LAVADO', etapa: 'LAVADO', cantidadCalculada: 120 }], 'fila de inventario');
  const { nuevo } = w.EVE_RENDIMIENTOS.construirNuevaComposicion({
    materialEntrada: 'LECHERO', fechaVigencia: '2026-09-01',
    componentes: [
      { subproducto: 'LECHERO LAVADO', porcentaje: 95, procesosValidos: ['LAVADO'], procesoSugerido: 'LAVADO' },
      { subproducto: 'BASURA', porcentaje: 5, esMerma: true }
    ]
  }, null);
  igual(nuevo.componentes.map((c) => c.subproducto), ['LECHERO LAVADO', 'BASURA'], 'Rendimientos acepta LECHERO LAVADO como subproducto');
});

caso('Cifras del catálogo base con LECHERO LAVADO: 44 entradas; recibibles (33) y crudos (19) sin cambio', () => {
  const { w } = crearContexto();
  igual([w.CATALOGO_MATERIALES.length, w.MATERIALES_COMUNES.length, w.materialesQueRequierenSeleccion().length], [44, 33, 19], 'entradas, recibibles, crudos');
});

// ===== 2) agregarMaterialAlCatalogo =====

caso('Alta válida: escribe una vez la extensión (version 1), refresca el catálogo en memoria y registra el historial', async () => {
  const { w, estado } = crearContexto();
  const r = await alta(w, '  suero   lavado ', { seObtieneEnProduccion: true, recibible: false });
  afirmar(r.ok, `ok: ${r.mensaje}`);
  igual(r.material, 'SUERO LAVADO', 'nombre normalizado (mayúsculas, sin espacios dobles)');
  igual(estado.transacciones, 1, 'una transacción');
  igual(estado.escrituras.length, 1, 'una escritura');
  igual(estado.escrituras[0].ruta, 'config/sistema', 'en config/sistema');
  igual(estado.escrituras[0].opcionesSet, { merge: true }, 'con merge');
  const extension = estado.escrituras[0].datos.catalogoExtra;
  igual(extension.version, 1, 'version + 1');
  igual(extension.materiales['SUERO LAVADO'], { nombre: 'SUERO LAVADO', unidad: 'KG', seObtieneEnProduccion: true, recibible: false, requiereSeleccion: false, activo: true, seVende: true, tipo: 'subproducto' }, 'entrada guardada con las banderas');
  igual(w.EVE.catalogoExtra, extension, 'window.EVE.catalogoExtra actualizado (para la caché offline)');
  afirmar(w.CATALOGO_MATERIALES.some((m) => m.nombre === 'SUERO LAVADO'), 'en el catálogo en memoria, sin recargar');
  igual(w.EVE_CATALOGO.errores, [], 'sin errores de extensión');
  igual(estado.historial.length, 1, 'una entrada de historial');
  igual([estado.historial[0].coleccion, estado.historial[0].accion, estado.historial[0].registroId], ['catalogo', 'alta', 'SUERO LAVADO'], 'historial');
  igual(estado.historial[0].valorAnterior, null, 'sin valor anterior');
  igual(estado.historial[0].valorNuevo.nombre, 'SUERO LAVADO', 'valor nuevo');
});

caso('Alta válida: conserva lo que ya había en la extensión (otros materiales, overrides y entradas con errores) y sube la version', async () => {
  const previa = { version: 4, materiales: { 'PLASTICO X': { nombre: 'PLASTICO X', unidad: 'KG', seObtieneEnProduccion: true, recibible: true, requiereSeleccion: true } }, overrides: { DURO: { alias: ['PEAD DURO'] } }, mermas: [] };
  const { w, estado } = crearContexto({ remoto: previa });
  const r = await alta(w, 'SUERO LAVADO', { seObtieneEnProduccion: true, recibible: false });
  afirmar(r.ok, `ok: ${r.mensaje}`);
  const extension = estado.escrituras[0].datos.catalogoExtra;
  igual(extension.version, 5, 'version 4 -> 5');
  igual(Object.keys(extension.materiales).sort(), ['PLASTICO X', 'SUERO LAVADO'], 'conserva el material anterior');
  igual(extension.overrides, previa.overrides, 'conserva los overrides');
  afirmar(w.CATALOGO_MATERIALES.some((m) => m.nombre === 'PLASTICO X') && w.CATALOGO_MATERIALES.some((m) => m.nombre === 'SUERO LAVADO'), 'ambos en memoria');
});

caso('Duplicado exacto: no crea nada (ni con otra capitalización o espacios)', async () => {
  const { w, estado } = crearContexto();
  for (const nombre of ['LECHERO LAVADO', 'lechero lavado', '  Lechero   Lavado  ', 'P.E.']) {
    const r = await alta(w, nombre, {});
    afirmar(!r.ok && r.codigo === 'duplicado', `${nombre}: ${r.codigo}`);
  }
  igual(estado.transacciones, 0, 'ni siquiera abre la transacción');
  sinEscribir(estado, 'duplicado');
});

caso('Alias existente: no crea nada y dice de quién es alias', async () => {
  const { w, estado } = crearContexto();
  const r = await alta(w, 'garrafa', {});
  afirmar(!r.ok && r.codigo === 'alias_existente' && r.existente === 'BIDON', `${r.codigo} ${r.existente}`);
  const r2 = await alta(w, 'p.p molido', {});
  afirmar(!r2.ok && r2.codigo === 'alias_existente' && r2.existente === 'P.P. MOLIDO', `${r2.codigo} ${r2.existente}`);
  sinEscribir(estado, 'alias');
});

caso('Material archivado: no crea otro con el mismo nombre', async () => {
  const { w, estado } = crearContexto({ remoto: { version: 1, overrides: { DURO: { activo: false } } } });
  const r = await alta(w, 'duro', {});
  afirmar(!r.ok && r.codigo === 'archivado', r.codigo);
  sinEscribir(estado, 'archivado');
});

caso('Nombre parecido: LECHERO LAVADOD sugiere LECHERO LAVADO y no crea nada', async () => {
  const { w, estado } = crearContexto();
  const r = await alta(w, 'LECHERO LAVADOD', {});
  afirmar(!r.ok && r.codigo === 'parecido', `codigo: ${r.codigo}`);
  igual(r.sugerencia, 'LECHERO LAVADO', 'sugerencia');
  afirmar(r.mensaje.includes('LECHERO LAVADO'), 'el mensaje nombra la sugerencia');
  const r2 = await alta(w, 'lechero lavad', {});
  igual([r2.codigo, r2.sugerencia], ['parecido', 'LECHERO LAVADO'], 'una letra de menos');
  const r3 = await alta(w, 'P E MOLIDO', {});
  igual([r3.codigo, r3.sugerencia], ['parecido', 'P.E. MOLIDO'], 'mismo texto sin puntos');
  sinEscribir(estado, 'parecido');
});

caso('Nombre parecido: con ignorarParecidos (el usuario confirmó que es otro producto) sí se crea; uno claramente distinto no avisa', async () => {
  const { w, estado } = crearContexto();
  const claro = w.EVE_CATALOGO.evaluarAltaMaterial('SUERO LAVADO');
  igual(claro.estado, 'ok', 'SUERO LAVADO no se parece a nada');
  const forzado = await alta(w, 'MIXTO 3', { ignorarParecidos: true });
  afirmar(forzado.ok, `MIXTO 3 confirmado: ${forzado.mensaje}`);
  igual(estado.escrituras.length, 1, 'se escribió');
});

caso('Sin permiso: un usuario que no es Admin con escritura no crea nada', async () => {
  const { w, estado } = crearContexto({ admin: false });
  const r = await alta(w, 'SUERO LAVADO', {});
  afirmar(!r.ok && r.codigo === 'sin_permiso', r.codigo);
  igual(estado.transacciones, 0, 'sin transacción');
  sinEscribir(estado, 'sin permiso');
  igual(w.EVE_CATALOGO.puedeEditarCatalogo(), false, 'puedeEditarCatalogo');
});

caso('Nombre vacío o demasiado largo: se rechaza', async () => {
  const { w, estado } = crearContexto();
  for (const nombre of ['', '   ', null, undefined, 'X'.repeat(41)]) {
    const r = await alta(w, nombre, {});
    afirmar(!r.ok && r.codigo === 'nombre_invalido', `${JSON.stringify(nombre)}: ${r.codigo}`);
  }
  sinEscribir(estado, 'nombre inválido');
});

caso('Sin conexión: no abre la transacción y avisa que no se guardó nada; unavailable y failed-precondition igual', async () => {
  const sinRed = crearContexto({ enLinea: false });
  const r = await alta(sinRed.w, 'SUERO LAVADO', {});
  afirmar(!r.ok && r.codigo === 'sin_conexion' && /No se guardo nada/.test(r.mensaje), `${r.codigo} ${r.mensaje}`);
  igual(sinRed.estado.transacciones, 0, 'sin transacción');
  for (const code of ['unavailable', 'failed-precondition']) {
    const { w, estado } = crearContexto({ falla: Object.assign(new Error('x'), { code }) });
    const rr = await alta(w, 'SUERO LAVADO', {});
    afirmar(!rr.ok && rr.codigo === 'sin_conexion', `${code}: ${rr.codigo}`);
    sinEscribir(estado, code);
    afirmar(!w.CATALOGO_MATERIALES.some((m) => m.nombre === 'SUERO LAVADO'), `${code}: el catálogo en memoria no cambia`);
  }
});

caso('Reglas de Firestore que niegan (permission-denied): se reporta, no se crea nada en memoria', async () => {
  const { w, estado } = crearContexto({ falla: Object.assign(new Error('denied'), { code: 'permission-denied' }) });
  const r = await alta(w, 'SUERO LAVADO', {});
  afirmar(!r.ok && r.codigo === 'sin_permiso_reglas', r.codigo);
  sinEscribir(estado, 'permission-denied');
  afirmar(!w.CATALOGO_MATERIALES.some((m) => m.nombre === 'SUERO LAVADO'), 'el catálogo en memoria no cambia');
});

caso('El catálogo cambió (otra persona agregó algo): aborta con "recarga" y no escribe', async () => {
  const { w, estado } = crearContexto();
  estado.remoto = { version: 3, materiales: {} }; // lo que otra persona guardó después de que este navegador cargó
  const r = await alta(w, 'SUERO LAVADO', {});
  afirmar(!r.ok && r.codigo === 'catalogo_cambio' && /recarga/.test(r.mensaje), `${r.codigo} ${r.mensaje}`);
  sinEscribir(estado, 'catálogo cambió');
});

caso('Extensión guardada mal formada: no agrega nada encima', async () => {
  const { w, estado } = crearContexto();
  estado.remoto = 'basura';
  const r = await alta(w, 'SUERO LAVADO', {});
  afirmar(!r.ok && r.codigo === 'catalogo_ilegible', r.codigo);
  sinEscribir(estado, 'extensión ilegible');
});

caso('Banderas recibidas: seVende=false no se ofrece en Ventas pero sí tiene existencias; recibible=true crea un crudo seleccionable', async () => {
  const { w } = crearContexto();
  const interno = await alta(w, 'ESCAMA INTERNA', { seVende: false, seObtieneEnProduccion: true, recibible: false });
  afirmar(interno.ok, interno.mensaje);
  afirmar(!w.productosVenta().includes('ESCAMA INTERNA') && !w.PRODUCTOS_VENTA.includes('ESCAMA INTERNA'), 'no se ofrece en Ventas');
  afirmar(w.materialesConStock().includes('ESCAMA INTERNA'), 'sí tiene existencias');
  igual(interno.entrada.tipo, 'intermedio', 'tipo derivado');
  const crudo = await alta(w, 'COSTAL NUEVO', { seObtieneEnProduccion: false, recibible: true });
  afirmar(crudo.ok, crudo.mensaje);
  afirmar(w.MATERIALES_COMUNES.includes('COSTAL NUEVO'), 'se recibe en báscula');
  afirmar(w.materialesQueRequierenSeleccion().includes('COSTAL NUEVO'), 'un crudo recibido pasa por Selección');
  igual(crudo.entrada.tipo, 'materia_prima', 'tipo derivado');
});

caso('Una pieza (PZ) nueva exige el proceso donde se produce', async () => {
  const { w, estado } = crearContexto();
  const sin = await alta(w, 'CAJA NUEVA', { unidad: 'PZ', seObtieneEnProduccion: true, recibible: false });
  afirmar(!sin.ok && sin.codigo === 'invalido', sin.codigo);
  sinEscribir(estado, 'pieza sin proceso');
  const con = await alta(w, 'CAJA NUEVA', { unidad: 'PZ', seObtieneEnProduccion: true, recibible: false, reglas: { procesoProduccion: 'PRODUCCION_CAJAS' } });
  afirmar(con.ok, con.mensaje);
  afirmar(w.materialesPZ().includes('CAJA NUEVA'), 'es pieza');
});

caso('distanciaEdicion: casos básicos', () => {
  const { w } = crearContexto();
  const d = w.EVE_CATALOGO.distanciaEdicion;
  igual([d('', ''), d('A', 'A'), d('A', 'B'), d('AB', 'A'), d('LECHERO LAVADOD', 'LECHERO LAVADO'), d('ABC', 'XYZ')], [0, 0, 1, 1, 1, 3], 'distancias');
});

// ===== El producto nuevo aparece en Ventas, Inventario y Rendimientos =====

caso('Un producto dado de alta aparece en Ventas, Inventario y Rendimientos sin recargar', async () => {
  const { w } = crearContexto();
  const r = await alta(w, 'SUERO LAVADO', { seObtieneEnProduccion: true, recibible: false });
  afirmar(r.ok, r.mensaje);
  // Ventas: se ofrece, se acepta en una línea y su aviso desaparece.
  afirmar(w.productosVenta().includes('SUERO LAVADO'), 'productosVenta()');
  const lineas = w.construirLineasDesdeFormulario([{ material: 'suero lavado', cantidad: 10, precioUnitario: 5 }], false);
  igual([lineas[0].material, lineas[0].unidad, lineas[0].subtotal], ['SUERO LAVADO', 'KG', 50], 'línea de venta');
  igual(w.estadoAvisoProducto('suero lavado'), { visible: false }, 'el aviso ya no aparece');
  // Inventario: tiene fila con saldo y cuenta como existencia vendible.
  const filas = w.EVE_INVENTARIO.calcularInventarioCalculado({ ...VACIO, inventarioInicial: [{ material: 'SUERO LAVADO', etapa: 'LAVADO', kg: 80, fecha: '2026-09-01' }] });
  igual(filas.map((f) => [f.material, f.etapa, f.cantidadCalculada]), [['SUERO LAVADO', 'LAVADO', 80]], 'Inventario');
  igual(w.EVE_INVENTARIO.calcularSaldoDisponibleEnFecha({ ...VACIO, inventarioInicial: [{ material: 'SUERO LAVADO', etapa: 'LAVADO', kg: 80, fecha: '2026-09-01' }] }, 'SUERO LAVADO', '2026-09-30'), 80, 'saldo disponible');
  // Rendimientos: se ofrece como subproducto de una composición.
  afirmar(w.materialesProducibles().includes('SUERO LAVADO'), 'materialesProducibles() (opciones de subproducto en Rendimientos)');
  const { nuevo } = w.EVE_RENDIMIENTOS.construirNuevaComposicion({
    materialEntrada: 'SUERO', fechaVigencia: '2026-09-01',
    componentes: [{ subproducto: 'SUERO LAVADO', porcentaje: 90, procesosValidos: ['LAVADO'] }, { subproducto: 'BASURA', porcentaje: 10, esMerma: true }]
  }, null);
  igual(nuevo.componentes[0].subproducto, 'SUERO LAVADO', 'Rendimientos');
});

// ===== 3) Ventas: aviso y confirmación =====

caso('Ventas: el aviso solo aparece para un producto fuera del catálogo y el botón solo con permiso', () => {
  const admin = crearContexto().w;
  igual(admin.estadoAvisoProducto(''), { visible: false }, 'vacío');
  igual(admin.estadoAvisoProducto('lechero lavado'), { visible: false }, 'un producto del catálogo');
  igual(admin.estadoAvisoProducto('garrafa'), { visible: false }, 'un alias resuelve a un material del catálogo');
  const conBoton = admin.estadoAvisoProducto('suero lavado');
  igual([conBoton.visible, conBoton.nombre, conBoton.puedeAgregar], [true, 'SUERO LAVADO', true], 'Admin: aviso con botón');
  afirmar(/no está en el catálogo/.test(conBoton.mensaje), 'mensaje');
  const sinPermiso = crearContexto({ admin: false }).w.estadoAvisoProducto('suero lavado');
  igual([sinPermiso.visible, sinPermiso.puedeAgregar], [true, false], 'sin permiso: solo el aviso, sin botón');
});

caso('Ventas: la confirmación muestra el nombre normalizado, la sugerencia de producto parecido y no deja crear un duplicado ni un alias', () => {
  const { w } = crearContexto();
  const ok = w.resumenAltaProducto('  suero   lavado ');
  igual([ok.nombre, ok.estado, ok.puedeCrear, ok.sugerencia, ok.usarExistente, ok.textoConfirmar], ['SUERO LAVADO', 'ok', true, null, null, 'Agregar al catálogo'], 'nuevo');
  const parecido = w.resumenAltaProducto('LECHERO LAVADOD');
  igual([parecido.estado, parecido.puedeCrear, parecido.sugerencia, parecido.textoConfirmar], ['parecido', true, 'LECHERO LAVADO', 'Crear de todos modos'], 'parecido');
  afirmar(parecido.mensaje.includes('LECHERO LAVADO'), 'la sugerencia está en el mensaje');
  const alias = w.resumenAltaProducto('garrafa');
  igual([alias.estado, alias.puedeCrear, alias.usarExistente], ['alias', false, 'BIDON'], 'alias');
  const duplicado = w.resumenAltaProducto('p.e.');
  igual([duplicado.estado, duplicado.puedeCrear, duplicado.usarExistente], ['duplicado', false, 'P.E.'], 'duplicado');
});

caso('Ventas: agregarProductoDesdeVenta usa se vende=true, se obtiene en producción=true, se recibe en báscula=false por omisión', async () => {
  const { w, estado } = crearContexto();
  const r = await w.agregarProductoDesdeVenta('suero lavado');
  afirmar(r.ok, r.mensaje);
  const entrada = estado.escrituras[0].datos.catalogoExtra.materiales['SUERO LAVADO'];
  igual([entrada.seVende, entrada.seObtieneEnProduccion, entrada.recibible, entrada.requiereSeleccion], [true, true, false, false], 'banderas por omisión');
  igual(estado.historial[0].motivo, 'Alta de material desde Ventas', 'el historial dice que vino de Ventas');
  const otra = crearContexto();
  const r2 = await otra.w.agregarProductoDesdeVenta('COSTAL', { seObtieneEnProduccion: false, recibible: true });
  afirmar(r2.ok, r2.mensaje);
  const e2 = otra.estado.escrituras[0].datos.catalogoExtra.materiales.COSTAL;
  igual([e2.seObtieneEnProduccion, e2.recibible], [false, true], 'las banderas que elige el usuario mandan');
});

caso('Ventas: agregarProductoDesdeVenta con un parecido solo crea si el usuario confirmó', async () => {
  const { w, estado } = crearContexto();
  const sin = await w.agregarProductoDesdeVenta('LECHERO LAVADOD', {}, false);
  afirmar(!sin.ok && sin.codigo === 'parecido', sin.codigo);
  sinEscribir(estado, 'sin confirmar');
  const con = await w.agregarProductoDesdeVenta('LECHERO LAVADOD', {}, true);
  afirmar(con.ok, con.mensaje);
});

caso('Ventas: NUNCA se crea el producto en silencio al guardar la venta', async () => {
  const { w, estado } = crearContexto();
  let error = null;
  try { w.construirLineasDesdeFormulario([{ material: 'PRODUCTO INEXISTENTE', cantidad: 1, precioUnitario: 1 }], false); } catch (e) { error = e; }
  afirmar(error && /no está en el catálogo/.test(error.message), `la venta se rechaza: ${error && error.message}`);
  igual(estado.transacciones, 0, 'no se abrió ninguna transacción');
  sinEscribir(estado, 'guardar una venta');
  let error2 = null;
  try { w.construirVentaDesdeFormulario({ cliente: 'X', fecha: '2026-09-01', lineas: [{ material: 'OTRO NUEVO', cantidad: 1, precioUnitario: 1 }] }); } catch (e) { error2 = e; }
  afirmar(error2 && /no está en el catálogo/.test(error2.message), 'construirVentaDesdeFormulario también');
  afirmar(!w.CATALOGO_MATERIALES.some((m) => m.nombre === 'PRODUCTO INEXISTENTE' || m.nombre === 'OTRO NUEVO'), 'el catálogo no cambió');
});

caso('Ventas: el código de la pantalla no llama al alta al guardar, solo desde el botón confirmado', () => {
  const ventas = fs.readFileSync(path.join(RAIZ, 'js/ventas.js'), 'utf8');
  igual((ventas.match(/agregarMaterialAlCatalogo\(/g) || []).length, 1, 'ventas.js llama a agregarMaterialAlCatalogo en un solo lugar (dentro de agregarProductoDesdeVenta)');
  igual((ventas.match(/agregarProductoDesdeVenta\(/g) || []).length, 2, 'agregarProductoDesdeVenta( aparece solo en su definición y en el botón Confirmar');
  const confirmar = ventas.slice(ventas.indexOf("confirmar.addEventListener('click'"));
  afirmar(/await agregarProductoDesdeVenta\(/.test(confirmar.slice(0, 600)), 'la llamada vive en el clic del botón Confirmar');
  afirmar(!/agregarProductoDesdeVenta|agregarMaterialAlCatalogo/.test(ventas.slice(ventas.indexOf('function construirVentaDesdeFormulario'), ventas.indexOf('function generarFolio'))), 'guardar la venta (construirVentaDesdeFormulario) no lo llama');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try {
      await fn();
      console.log(`PASS  ${nombre}`);
    } catch (error) {
      fallos += 1;
      console.log(`FAIL  ${nombre}\n      ${error.message}`);
    }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos > 0 ? 1 : 0);
})();
