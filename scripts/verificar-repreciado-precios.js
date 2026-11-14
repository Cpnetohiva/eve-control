// Precios congelados con el catálogo desactualizado (caso PET: 9.70 vigente desde 2026-11-09, CxP posteriores en 9.50).
// Cubre: js/precios-sync.js (sincronizar, asegurarPreciosFrescos), js/utils.js (obtenerPrecioVigente con vigencias traslapadas),
// js/cxp.js (generarYGuardarCxP vía aprobarManualmente, planificarRepreciado, aplicarRepreciado).
// Sin navegador: js/ reales en vm con un Firestore en memoria.
//
// Uso: node scripts/verificar-repreciado-precios.js   (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/precios-sync.js', 'js/cxp.js'];

const clonar = (x) => JSON.parse(JSON.stringify(x));

// Firestore en memoria: get() de colección, where (==, in, >=, <=) encadenable, doc().get(), runTransaction. Registra lecturas y escrituras.
// Con { source: 'server' } y sin conexión lanza, igual que el SDK.
function crearDb(colecciones, estado) {
  const almacen = clonar(colecciones);
  const escrituras = [];
  const lecturas = [];
  const instantanea = (coleccion, id) => {
    const dato = (almacen[coleccion] || {})[id];
    return { exists: !!dato, id, data: () => (dato ? clonar(dato) : undefined) };
  };
  const cumple = (dato, f) => {
    const v = dato[f.campo];
    if (f.op === '==') return v === f.valor;
    if (f.op === 'in') return f.valor.includes(v);
    if (f.op === '>=') return v >= f.valor;
    if (f.op === '<=') return v <= f.valor;
    return false;
  };
  const consulta = (coleccion, filtros) => ({
    where: (campo, op, valor) => consulta(coleccion, [...filtros, { campo, op, valor }]),
    get: async (opciones) => {
      if (opciones && opciones.source === 'server' && estado.sinServidor) throw new Error('unavailable');
      lecturas.push({ coleccion, filtros });
      return { docs: Object.keys(almacen[coleccion] || {}).filter((id) => filtros.every((f) => cumple(almacen[coleccion][id], f))).map((id) => instantanea(coleccion, id)) };
    }
  });
  return {
    almacen, escrituras, lecturas,
    runTransaction: async (fn) => {
      const pendientes = [];
      const tx = { get: async (ref) => instantanea(ref.coleccion, ref.id), update: (ref, datos) => pendientes.push([ref, datos]) };
      const resultado = await fn(tx);
      pendientes.forEach(([ref, datos]) => {
        Object.assign(almacen[ref.coleccion][ref.id], clonar(datos));
        escrituras.push({ coleccion: ref.coleccion, id: ref.id, cambios: datos });
      });
      return resultado;
    },
    collection: (coleccion) => ({
      doc: (id) => ({ coleccion, id, get: async () => instantanea(coleccion, id) }),
      where: (campo, op, valor) => consulta(coleccion, [{ campo, op, valor }]),
      get: (opciones) => consulta(coleccion, []).get(opciones)
    })
  };
}

// Catálogo real en Firestore: PET 9.50 hasta 08/11 y 9.70 desde 09/11.
const PRECIOS_SERVIDOR = {
  p950: { material: 'PET', precio: 9.5, fechaInicio: '2026-01-01', fechaFin: '2026-11-08', fechaRegistro: '2026-01-01T10:00:00.000Z' },
  p970: { material: 'PET', precio: 9.7, fechaInicio: '2026-11-09', fechaFin: null, fechaRegistro: '2026-11-12T10:00:00.000Z' }
};
// Catálogo viejo en la memoria de un equipo que no se enteró: 9.50 abierto.
const PRECIOS_CACHE_VIEJA = [{ id: 'p950', material: 'PET', precio: 9.5, fechaInicio: '2026-01-01', fechaFin: null, fechaRegistro: '2026-01-01T10:00:00.000Z' }];

function crearContexto({ colecciones, precios, ajustes, cuentas, enLinea, sinServidor, pendientes }) {
  const estado = { sinServidor: !!sinServidor };
  const navegador = { onLine: enLinea !== false };
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {}, navigator: navegador,
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {
    cuentasPorPagar: cuentas || [], registrosDestaraje: [], registrosDestarajeRaw: [], registrosPagos: [], proveedores: [{ nombre: 'JOSE PEREZ' }],
    precios: precios || [], ajustesPrecioProveedor: ajustes || [], currentUser: { username: 'Admin' }
  };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  const w = sandbox.window;
  w.db = crearDb(colecciones || {}, estado);
  w.estadoRed = estado;
  w.navegador = navegador;
  w.puedeEscribir = () => true;
  w.puedeLeer = () => true;
  w.guardados = [];
  w.guardarDato = async (coleccion, datos) => { const id = `nuevo${w.guardados.length + 1}`; w.guardados.push({ coleccion, id, datos: clonar(datos) }); return id; };
  w.historial = [];
  w.EVE_HISTORIAL = { registrar: (entrada) => w.historial.push(entrada) };
  w.EVE_OFFLINE = { contarPendientes: async () => pendientes || 0, guardarCacheDatos: async () => {} };
  w.mensajes = [];
  w.showError = (m) => w.mensajes.push(m);
  // Ajuste de proveedor (vive en js/precios.js): lee window.EVE.ajustesPrecioProveedor con el mismo criterio de vigencia.
  w.obtenerAjusteProveedorVigente = (material, proveedor, fecha) => (w.EVE.ajustesPrecioProveedor || []).find((a) =>
    w.normalizarMaterial(a.material) === w.normalizarMaterial(material) && a.proveedor === proveedor && a.fechaInicio <= fecha && (a.fechaFin === null || a.fechaFin >= fecha)) || null;
  return w;
}

const registro = (extra) => ({ ticket: '3001', proveedor: 'JOSE PEREZ', material: 'PET', kg: 1000, fechaEntrada: '2026-11-10', fechaSalida: '2026-11-10', ...extra });
const cxp = (extra) => ({
  ticket: '3001', proveedor: 'JOSE PEREZ', material: 'PET', kg: 1000, fechaTicket: '2026-11-10',
  precioAplicado: 9.5, precioBase: 9.5, ajusteProveedorAplicado: null, comisionPorKg: 0.5, precioEfectivo: 10, montoMaterial: 9500, montoComision: 500, total: 10000,
  pagado: 0, saldo: 10000, iva: 0, estado: 'pendiente', aprobacion: { tipo: 'manual' }, abonos: [], precioNegociado: null, creadoPor: 'capturista', ...extra
});
const conId = (mapa) => Object.keys(mapa).map((id) => ({ id, ...clonar(mapa[id]) }));

// Escenario con CxP en memoria y en Firestore (mismos documentos).
function escenarioCxP(mapaCuentas, extra) {
  return crearContexto({
    colecciones: { precios: PRECIOS_SERVIDOR, ajustes_precio_proveedor: {}, cuentas_por_pagar: mapaCuentas, pagos: {}, recibos_pendientes: {} },
    precios: conId(PRECIOS_SERVIDOR), cuentas: conId(mapaCuentas), ...extra
  });
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const FILTRO = { material: 'PET', desde: '2026-11-09', hasta: '2026-11-30' };

// ── 1) Precio retroactivo con la caché vieja ──
caso('retroactivo con caché vieja: con conexión la CxP nace con 9.70 (relee el servidor) y no se marca precioDeCache', async () => {
  const w = crearContexto({ colecciones: { precios: PRECIOS_SERVIDOR, ajustes_precio_proveedor: {} }, precios: clonar(PRECIOS_CACHE_VIEJA) });
  igual(w.obtenerPrecioVigente('PET', '2026-11-10').precio, 9.5, 'la memoria vieja da 9.50 antes de releer');
  await w.EVE_CXP.aprobarManualmente(registro(), 'prueba');
  const doc = w.guardados.find((g) => g.coleccion === 'cuentas_por_pagar').datos;
  igual([doc.precioAplicado, doc.precioBase, doc.total, doc.precioDeCache], [9.7, 9.7, 9700, undefined], 'CxP con el precio vigente');
  igual(w.db.lecturas.map((l) => l.coleccion).sort(), ['ajustes_precio_proveedor', 'precios'], 'solo lee el catálogo de ese material');
  igual(w.db.lecturas[0].filtros[0].campo, 'material', 'la lectura es por material, no la colección entera');
});

caso('retroactivo con caché vieja: sin conexión la CxP se crea con 9.50 marcada precioDeCache:true y avisa', async () => {
  const w = crearContexto({ colecciones: { precios: PRECIOS_SERVIDOR }, precios: clonar(PRECIOS_CACHE_VIEJA), enLinea: false });
  await w.EVE_CXP.aprobarManualmente(registro(), 'prueba');
  const doc = w.guardados.find((g) => g.coleccion === 'cuentas_por_pagar').datos;
  igual([doc.precioAplicado, doc.precioDeCache], [9.5, true], 'precio de caché marcado');
  afirmar(w.mensajes.length === 1 && /revisa/i.test(w.mensajes[0]), 'debe avisar que se revise');
  igual(w.db.lecturas.length, 0, 'sin conexión no lee');
});

caso('con conexión pero el servidor no responde (lectura falla): se crea igual, marcada precioDeCache:true', async () => {
  const w = crearContexto({ colecciones: { precios: PRECIOS_SERVIDOR }, precios: clonar(PRECIOS_CACHE_VIEJA), sinServidor: true });
  await w.EVE_CXP.aprobarManualmente(registro(), 'prueba');
  const doc = w.guardados.find((g) => g.coleccion === 'cuentas_por_pagar').datos;
  igual([doc.precioAplicado, doc.precioDeCache], [9.5, true], 'degrada a caché marcada');
});

caso('varias CxP del mismo material seguidas leen el servidor una sola vez (no multiplica lecturas)', async () => {
  const w = crearContexto({ colecciones: { precios: PRECIOS_SERVIDOR, ajustes_precio_proveedor: {} }, precios: clonar(PRECIOS_CACHE_VIEJA) });
  await w.EVE_CXP.aprobarManualmente(registro({ ticket: '3001' }), 'prueba');
  await w.EVE_CXP.aprobarManualmente(registro({ ticket: '3002' }), 'prueba');
  igual(w.db.lecturas.length, 2, 'una vuelta (precios + ajustes), no dos');
});

// ── 2) Vigencias traslapadas ──
caso('vigencias traslapadas: gana la de fechaInicio más reciente aunque aparezca después en la lista', () => {
  const w = crearContexto({ precios: [
    { id: 'a', material: 'PET', precio: 9.7, fechaInicio: '2026-11-09', fechaFin: null },
    { id: 'b', material: 'PET', precio: 9.5, fechaInicio: '2026-01-01', fechaFin: null } // sin cerrar: traslapa con a
  ] });
  igual(w.obtenerPrecioVigente('PET', '2026-11-10').precio, 9.7, 'a primero en la lista');
  const w2 = crearContexto({ precios: [
    { id: 'b', material: 'PET', precio: 9.5, fechaInicio: '2026-01-01', fechaFin: null },
    { id: 'a', material: 'PET', precio: 9.7, fechaInicio: '2026-11-09', fechaFin: null }
  ] });
  igual(w2.obtenerPrecioVigente('PET', '2026-11-10').precio, 9.7, 'a al final de la lista');
  igual(w2.obtenerPrecioVigente('PET', '2026-11-08').precio, 9.5, 'antes del 09/11 sigue 9.50');
});

caso('vigencias traslapadas con la misma fechaInicio: gana la capturada después (fechaRegistro)', () => {
  const w = crearContexto({ precios: [
    { id: 'a', material: 'PET', precio: 9.7, fechaInicio: '2026-11-09', fechaFin: null, fechaRegistro: '2026-11-12T10:00:00.000Z' },
    { id: 'b', material: 'PET', precio: 9.6, fechaInicio: '2026-11-09', fechaFin: null, fechaRegistro: '2026-11-10T10:00:00.000Z' }
  ] });
  igual(w.obtenerPrecioVigente('PET', '2026-11-10').precio, 9.7, 'la más reciente por fechaRegistro');
});

// ── 3) Repreciado ──
const ESCENARIO_MIXTO = {
  pendiente: cxp({ ticket: '3001' }),
  conPagos: cxp({ ticket: '3002', pagado: 2000, saldo: 8000, estado: 'parcial', abonos: [{ monto: 2000 }] }),
  negociada: cxp({ ticket: '3003', precioNegociado: 9.4, precioAplicado: 9.5 }),
  conAjuste: cxp({ ticket: '3004', precioAplicado: 9.3, ajusteProveedorAplicado: { tipo: 'monto', valor: -0.2 } }),
  yaCorrecta: cxp({ ticket: '3005', precioAplicado: 9.7, precioBase: 9.7, total: 10200, montoMaterial: 9700, saldo: 10200, precioEfectivo: 10.2 }),
  otroMaterial: cxp({ ticket: '3006', material: 'CARTON' }),
  fueraDeRango: cxp({ ticket: '3007', fechaTicket: '2026-11-05' })
};

caso('vista previa: la CxP pendiente se reprecia; con pagos, precio negociado y ajuste de proveedor no; las correctas y de otro rango/material no aparecen', () => {
  const w = escenarioCxP(ESCENARIO_MIXTO);
  const plan = w.EVE_CXP.planificarRepreciado(w.EVE.cuentasPorPagar, FILTRO);
  igual(plan.repreciables.map((i) => i.ticket), ['3001'], 'solo la pendiente');
  igual(plan.noRepreciables.map((i) => [i.ticket, i.motivos]), [
    ['3002', ['Con abonos o pagos']], ['3003', ['Precio negociado']], ['3004', ['Ajuste de proveedor']]
  ], 'las tres excluidas, con su motivo');
  const i = plan.repreciables[0];
  igual([i.precioActual, i.precioNuevo, i.diferenciaPesos, i.kg, i.creadoPor], [9.5, 9.7, 200, 1000, 'capturista'], 'datos de la fila');
  igual(plan.totales, { repreciables: 1, diferenciaRepreciables: 200, noRepreciables: 3, diferenciaNoRepreciables: 600 }, 'totales');
  igual(plan.porProveedorNoRepreciables, [{ proveedor: 'JOSE PEREZ', cuentas: 3, diferenciaPesos: 600 }], 'diferencia por proveedor');
  igual(w.db.escrituras.length + w.guardados.length, 0, 'la vista previa no escribe');
});

caso('aplicar: solo escribe la pendiente, recalcula con recalcularMontosCxP y registra quién, cuándo y el precio anterior', async () => {
  const w = escenarioCxP(ESCENARIO_MIXTO);
  const plan = w.EVE_CXP.planificarRepreciado(w.EVE.cuentasPorPagar, FILTRO);
  const res = await w.EVE_CXP.aplicarRepreciado(plan.repreciables, { usuario: 'neto' });
  igual([res.repreciadas.length, res.omitidas.length], [1, 0], 'una repreciada');
  igual(w.db.escrituras.map((e) => e.id), ['pendiente'], 'solo se escribió la pendiente');
  const d = w.db.almacen.cuentas_por_pagar.pendiente;
  igual([d.precioAplicado, d.precioBase, d.precioEfectivo, d.montoMaterial, d.montoComision, d.total, d.saldo, d.estado], [9.7, 9.7, 10.2, 9700, 500, 10200, 10200, 'pendiente'], 'montos recalculados');
  igual([d.repreciado.por, d.repreciado.precioAnterior, d.repreciado.totalAnterior, d.repreciado.precioNuevo, d.repreciado.totalNuevo], ['neto', 9.5, 10000, 9.7, 10200], 'rastro del repreciado');
  afirmar(!Number.isNaN(Date.parse(d.repreciado.en)), 'repreciado.en debe ser una fecha ISO');
  igual(w.db.almacen.cuentas_por_pagar.conPagos.precioAplicado, 9.5, 'la que tiene pagos quedó igual');
  igual(w.db.almacen.cuentas_por_pagar.negociada.precioNegociado, 9.4, 'la negociada quedó igual');
  igual(w.db.almacen.cuentas_por_pagar.conAjuste.precioAplicado, 9.3, 'la de ajuste quedó igual');
  igual(w.EVE.cuentasPorPagar.find((c) => c.id === 'pendiente').total, 10200, 'la memoria también se actualiza');
  igual(w.historial.length, 1, 'queda en historial');
  igual(w.EVE_CXP.planificarRepreciado(w.EVE.cuentasPorPagar, FILTRO).repreciables.length, 0, 'una segunda vista previa ya no la ofrece (idempotente)');
});

caso('aplicar: si la CxP recibió un pago después de la vista previa, se omite y no se escribe', async () => {
  const w = escenarioCxP({ pendiente: cxp({ ticket: '3001' }) });
  const plan = w.EVE_CXP.planificarRepreciado(w.EVE.cuentasPorPagar, FILTRO);
  Object.assign(w.db.almacen.cuentas_por_pagar.pendiente, { pagado: 500, saldo: 9500, abonos: [{ monto: 500 }] });
  const res = await w.EVE_CXP.aplicarRepreciado(plan.repreciables, { usuario: 'neto' });
  igual([res.repreciadas.length, res.omitidas.length], [0, 1], 'omitida');
  igual(w.db.escrituras.length, 0, 'sin escrituras');
});

caso('aplicar: sin conexión no escribe nada', async () => {
  const w = escenarioCxP({ pendiente: cxp() });
  const plan = w.EVE_CXP.planificarRepreciado(w.EVE.cuentasPorPagar, FILTRO);
  w.navegador.onLine = false;
  let error = null;
  try { await w.EVE_CXP.aplicarRepreciado(plan.repreciables, {}); } catch (e) { error = e; }
  afirmar(error, 'debía rechazar sin conexión');
  igual(w.db.escrituras.length, 0, 'sin escrituras');
});

// ── 4) Sincronización del catálogo ──
caso('sincronizar: reemplaza el catálogo de memoria por el del servidor y respeta el intervalo mínimo', async () => {
  const w = crearContexto({ colecciones: { precios: PRECIOS_SERVIDOR, ajustes_precio_proveedor: {} }, precios: clonar(PRECIOS_CACHE_VIEJA) });
  const r1 = await w.EVE_PRECIOS_SYNC.sincronizar({ motivo: 'foco' });
  igual(r1.ok, true, 'primera sincronización');
  igual(w.obtenerPrecioVigente('PET', '2026-11-10').precio, 9.7, 'la memoria ya tiene 9.70');
  const lecturas = w.db.lecturas.length;
  const r2 = await w.EVE_PRECIOS_SYNC.sincronizar({ motivo: 'foco' });
  igual([r2.ok, r2.motivo, w.db.lecturas.length], [false, 'reciente', lecturas], 'segunda dentro del intervalo no lee');
  const r3 = await w.EVE_PRECIOS_SYNC.sincronizar({ forzar: true });
  igual(r3.ok, true, 'forzada sí lee');
});

caso('sincronizar: sin conexión, con capturas pendientes por subir o sin sesión no toca la memoria', async () => {
  const sinRed = crearContexto({ colecciones: { precios: PRECIOS_SERVIDOR }, precios: clonar(PRECIOS_CACHE_VIEJA), enLinea: false });
  igual((await sinRed.EVE_PRECIOS_SYNC.sincronizar({})).motivo, 'sin_conexion', 'sin conexión');
  const conCola = crearContexto({ colecciones: { precios: PRECIOS_SERVIDOR }, precios: clonar(PRECIOS_CACHE_VIEJA), pendientes: 2 });
  igual((await conCola.EVE_PRECIOS_SYNC.sincronizar({})).motivo, 'cola_pendiente', 'cola pendiente');
  igual(conCola.EVE.precios.length, 1, 'memoria intacta con cola pendiente');
  const sinSesion = crearContexto({ colecciones: { precios: PRECIOS_SERVIDOR }, precios: clonar(PRECIOS_CACHE_VIEJA) });
  sinSesion.EVE.currentUser = null;
  igual((await sinSesion.EVE_PRECIOS_SYNC.sincronizar({})).motivo, 'sin_sesion', 'sin sesión');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try {
      await fn();
      console.log(`OK   ${nombre}`);
    } catch (error) {
      fallos++;
      console.log(`FALLA ${nombre}\n     ${error.message}`);
    }
  }
  console.log(`\n${casos.length - fallos} de ${casos.length} casos pasan.`);
  process.exit(fallos ? 1 : 0);
})();
