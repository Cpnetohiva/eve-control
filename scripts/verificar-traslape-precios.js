// Traslape de vigencias de precios (caso real PET): dos registros de 9.50 con fechaInicio 2026-07-23 (uno cerrado el 2026-11-08 y un
// duplicado con fechaFin null) y un 9.70 desde 2026-11-09. El duplicado abierto seguía ganando y obtenerPrecioVigente devolvía 9.50.
// Cubre: js/precios.js (construirNuevoPrecio cierra TODOS los contenedores, detectarTraslapes, accionesDeTraslape),
// js/utils.js (obtenerPrecioVigente elige la fechaInicio más reciente), js/admin-importar.js (importación idempotente y con cierres
// múltiples en el mismo lote), js/admin-traslapes.js (acciones con rastro).
//
// Uso: node scripts/verificar-traslape-precios.js   (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['config.js', 'utils.js', 'rendimientos.js', 'precios.js', 'inventario.js', 'cxp.js', 'pagos.js', 'control-produccion.js', 'control-produccion-reglas.js', 'ventas.js', 'admin-importar.js', 'admin-traslapes.js'];

function crearDbFalso() {
  const db = {
    lotes: [], contador: 0,
    batch() {
      const operaciones = [];
      return {
        set(ref, datos) { operaciones.push({ tipo: 'set', coleccion: ref.coleccion, id: ref.id, datos }); },
        update(ref, datos) { operaciones.push({ tipo: 'update', coleccion: ref.coleccion, id: ref.id, datos }); },
        delete(ref) { operaciones.push({ tipo: 'delete', coleccion: ref.coleccion, id: ref.id }); },
        async commit() { db.lotes.push(operaciones); }
      };
    },
    collection(coleccion) { return { doc: (id) => ({ coleccion, id: id || `auto${++db.contador}` }) }; }
  };
  return db;
}

function crearContexto(precios) {
  const window = { EVE_MODULES: {} };
  window.window = window;
  window.EVE = {
    registrosDestaraje: [], registrosVentas: [], registrosControlProduccion: [], registrosPagos: [], cuentasPorPagar: [],
    proveedores: [], precios: precios || [], ajustesPrecioProveedor: [], comisiones: [], auditorias: [], composiciones: [], ventas: [],
    inventarioInicial: [], inventario: [], fechaCorteAuditoria: '2026-07-01',
    currentUser: { username: 'neto', permisosResueltos: { admin: 'escritura' } }
  };
  window.cargarDatosEnParalelo = async () => {};
  window.showError = () => {};
  window.showSuccess = () => {};
  const firebase = { initializeApp() {}, firestore: () => ({ enablePersistence: () => ({ catch() {} }) }) };
  const el = () => ({ addEventListener() {}, appendChild() {}, querySelector: () => el(), querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} }, style: {} });
  const ctx = vm.createContext({ window, firebase, console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, XLSX: {}, document: { getElementById: () => null, createElement: el } });
  for (const f of ARCHIVOS) vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js', f), 'utf8'), ctx, { filename: f });
  window.db = crearDbFalso(); // utils.js reasigna window.db al cargarse: se pone el doble después
  window.escrituras = [];
  window.actualizarDato = async (coleccion, id, cambios) => { window.escrituras.push({ tipo: 'update', coleccion, id, cambios }); };
  window.eliminarDato = async (coleccion, id) => { window.escrituras.push({ tipo: 'delete', coleccion, id }); };
  window.historial = [];
  window.EVE_HISTORIAL = { registrar: (e) => window.historial.push(e) };
  window.confirm = () => true;
  return window;
}

// Estado detectado en producción: A cerrado, B (duplicado) abierto, C el 9.70.
const A = { id: 'A', material: 'PET', precio: 9.5, fechaInicio: '2026-07-23', fechaFin: '2026-11-08', fechaRegistro: '2026-07-23T10:00:00.000Z' };
const B = { id: 'B', material: 'PET', precio: 9.5, fechaInicio: '2026-07-23', fechaFin: null, fechaRegistro: '2026-07-23T10:05:00.000Z' };
const C = { id: 'C', material: 'PET', precio: 9.7, fechaInicio: '2026-11-09', fechaFin: null, fechaRegistro: '2026-11-12T10:00:00.000Z' };
const FECHAS_POSTERIORES = ['2026-11-09', '2026-11-10', '2026-12-31', '2027-03-01'];

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const lanza = (fn, texto, mensaje) => {
  try { fn(); } catch (error) { afirmar(error.message.includes(texto), `${mensaje}: el error "${error.message}" no contiene "${texto}"`); return; }
  throw new Error(`${mensaje}: debía lanzar "${texto}"`);
};
const copia = (lista) => JSON.parse(JSON.stringify(lista));

// ── Escenario exacto ──
caso('escenario exacto (A cerrado, B duplicado abierto, C 9.70 desde 2026-11-09): obtenerPrecioVigente da 9.70 del 2026-11-09 en adelante y 9.50 antes', () => {
  [[A, B, C], [B, A, C], [C, B, A]].forEach((orden, i) => {
    const w = crearContexto(copia(orden));
    FECHAS_POSTERIORES.forEach((f) => igual(w.obtenerPrecioVigente('PET', f).precio, 9.7, `orden ${i}, fecha ${f}`));
    igual(w.obtenerPrecioVigente('PET', '2026-11-08').precio, 9.5, `orden ${i}, 2026-11-08`);
    igual(w.obtenerPrecioVigente('PET', '2026-07-23').precio, 9.5, `orden ${i}, 2026-07-23`);
  });
});

caso('el alta de 9.70 desde 2026-11-09 con los dos 9.50 abiertos cierra LOS DOS y el vigente es 9.70 (así nació el problema)', () => {
  const w = crearContexto([{ ...A, fechaFin: null }, { ...B }]);
  const { cierres, nuevo } = w.EVE_PRECIOS.construirNuevoPrecio({ material: 'PET', precio: 9.7, fechaInicio: '2026-11-09' }, w.EVE.precios);
  igual(cierres.map((c) => [c.id, c.fechaFin]).sort(), [['A', '2026-11-08'], ['B', '2026-11-08']], 'cierra los dos');
  igual([nuevo.fechaInicio, nuevo.fechaFin], ['2026-11-09', null], 'el nuevo queda abierto');
  // Se aplica lo que devolvió y se consulta.
  cierres.forEach((c) => { w.EVE.precios.find((p) => p.id === c.id).fechaFin = c.fechaFin; });
  w.EVE.precios.push({ id: 'C', ...nuevo });
  FECHAS_POSTERIORES.forEach((f) => igual(w.obtenerPrecioVigente('PET', f).precio, 9.7, `fecha ${f}`));
  // A y B quedan con el mismo rango (duplicado exacto ya cerrado): el detector aún lo marca, pero C (9.70) ya no se traslapa con nadie.
  const grupos = w.EVE_PRECIOS.detectarTraslapes(w.EVE.precios);
  igual(grupos.map((g) => g.registros.map((r) => r.id)), [['A', 'B']], 'solo A y B (duplicado inofensivo); C no se traslapa');
});

caso('alta con un solo contenedor sigue funcionando igual (hereda el fin, un solo cierre, `cierre` compatible)', () => {
  const w = crearContexto([{ id: 'X', material: 'PET', precio: 9, fechaInicio: '2026-01-01', fechaFin: '2026-12-31' }]);
  const r = w.EVE_PRECIOS.construirNuevoPrecio({ material: 'PET', precio: 9.7, fechaInicio: '2026-06-01' }, w.EVE.precios);
  igual([r.cierre, r.cierres.length, r.nuevo.fechaFin], [{ id: 'X', fechaFin: '2026-05-31' }, 1, '2026-12-31'], 'cierre simple');
});

caso('alta que choca con una fecha existente (duplicado exacto) se bloquea con mensaje claro', () => {
  const w = crearContexto(copia([A, B, C]));
  lanza(() => w.EVE_PRECIOS.construirNuevoPrecio({ material: 'PET', precio: 9.8, fechaInicio: '2026-11-09' }, w.EVE.precios), 'Ya existe un precio para PET que inicia exactamente el', 'duplicado exacto');
});

caso('alta que no deja el historial limpio (registros posteriores ya traslapados entre sí) se bloquea y manda al detector', () => {
  const w = crearContexto([
    { id: 'P1', material: 'PET', precio: 9.5, fechaInicio: '2026-08-01', fechaFin: null },
    { id: 'P2', material: 'PET', precio: 9.6, fechaInicio: '2026-09-01', fechaFin: null }
  ]);
  lanza(() => w.EVE_PRECIOS.construirNuevoPrecio({ material: 'PET', precio: 9.4, fechaInicio: '2026-07-01' }, w.EVE.precios), 'Traslapes de precios', 'traslape irresoluble');
});

caso('el nuevo nunca invade a un precio posterior que ya existe', () => {
  const w = crearContexto([
    { id: 'V', material: 'PET', precio: 9, fechaInicio: '2026-01-01', fechaFin: null },
    { id: 'F', material: 'PET', precio: 10, fechaInicio: '2026-09-01', fechaFin: null }
  ]);
  const r = w.EVE_PRECIOS.construirNuevoPrecio({ material: 'PET', precio: 9.5, fechaInicio: '2026-06-01' }, w.EVE.precios);
  igual([r.cierres.map((c) => c.id), r.nuevo.fechaFin], [['V'], '2026-08-31'], 'el nuevo termina un día antes del siguiente');
});

// ── Detector ──
caso('detector (solo lectura): el estado real aparece como un grupo PET con duplicado exacto; ofrece cerrar B y eliminar duplicado', () => {
  const w = crearContexto(copia([A, B, C]));
  const antes = JSON.stringify(w.EVE.precios);
  const grupos = w.EVE_PRECIOS.detectarTraslapes(w.EVE.precios);
  igual([grupos.length, grupos[0].material, grupos[0].duplicadoExacto, grupos[0].registros.map((r) => r.id)], [1, 'PET', true, ['A', 'B', 'C']], 'un grupo');
  const acciones = w.EVE_PRECIOS.accionesDeTraslape(grupos[0]);
  igual(acciones.get('B'), { cerrarA: '2026-11-08', puedeEliminar: true }, 'B: cerrar al 08/11 y eliminable');
  igual(acciones.get('A'), { cerrarA: null, puedeEliminar: true }, 'A: eliminable');
  igual(acciones.get('C'), { cerrarA: null, puedeEliminar: false }, 'C: sin acciones');
  igual(JSON.stringify(w.EVE.precios), antes, 'detectar no modifica nada');
  igual(w.escrituras.length, 0, 'ni escribe');
});

caso('detector: precios bien encadenados y materiales distintos no se marcan', () => {
  const w = crearContexto([
    { id: '1', material: 'PET', precio: 9.5, fechaInicio: '2026-01-01', fechaFin: '2026-11-08' },
    { id: '2', material: 'PET', precio: 9.7, fechaInicio: '2026-11-09', fechaFin: null },
    { id: '3', material: 'CARTON', precio: 2, fechaInicio: '2026-01-01', fechaFin: null }
  ]);
  igual(w.EVE_PRECIOS.detectarTraslapes(w.EVE.precios).length, 0, 'sin traslapes');
});

// ── Acciones con confirmación y rastro ──
caso('cerrar B deja el registro de quién y cuándo y escribe solo ese precio; luego eliminar el duplicado exacto', async () => {
  const w = crearContexto(copia([A, B, C]));
  await w.EVE_ADMIN_TRASLAPES.cerrarRegistro('B', '2026-11-08', { usuario: 'neto' });
  igual(w.escrituras.map((e) => [e.tipo, e.id]), [['update', 'B']], 'solo B');
  const cambios = w.escrituras[0].cambios;
  igual([cambios.fechaFin, cambios.cierreTraslapePor], ['2026-11-08', 'neto'], 'quién');
  afirmar(!Number.isNaN(Date.parse(cambios.cierreTraslapeEn)), 'cuándo (ISO)');
  igual(w.historial.map((h) => [h.coleccion, h.accion, h.registroId]), [['precios', 'edicion', 'B']], 'historial');
  // B y A quedaron idénticos: duplicado exacto sin traslape con C.
  await w.EVE_ADMIN_TRASLAPES.eliminarDuplicado('B', { usuario: 'neto' });
  igual(w.EVE.precios.map((p) => p.id), ['A', 'C'], 'B eliminado de la memoria');
  igual(w.escrituras.map((e) => [e.tipo, e.id]), [['update', 'B'], ['delete', 'B']], 'update y delete');
  igual(w.historial[1].accion, 'eliminacion', 'historial de la eliminación');
  igual(w.EVE_PRECIOS.detectarTraslapes(w.EVE.precios).length, 0, 'ya no hay traslapes');
  FECHAS_POSTERIORES.forEach((f) => igual(w.obtenerPrecioVigente('PET', f).precio, 9.7, `fecha ${f}`));
});

caso('nunca elimina el único precio de una fecha de inicio', async () => {
  const w = crearContexto(copia([A, B, C]));
  let error = null;
  try { await w.EVE_ADMIN_TRASLAPES.eliminarDuplicado('C', {}); } catch (e) { error = e; }
  afirmar(error && /único precio/.test(error.message), 'debía rechazar eliminar C');
  igual(w.escrituras.length, 0, 'sin escrituras');
});

// ── Importación ──
const fila = (material, precio, fecha) => ({ Material: material, Precio: precio, 'Fecha Vigencia': fecha, Notas: '' });

caso('importación: dos 9.50 abiertos + fila 9.70 desde 09-11-2026 cierra los dos en el MISMO lote que el nuevo', async () => {
  const w = crearContexto([{ ...A, fechaFin: null }, { ...B }]);
  const hoja = w.EVE_ADMIN_IMPORTAR.procesarHojaPreciosGenerales([fila('PET', 9.7, '09-11-2026')]);
  igual([hoja[0].valido, hoja[0].registro.cierres.length], [true, 2], 'fila válida con dos cierres');
  afirmar(/Cierra 2 precios/.test(hoja[0].info), 'la vista previa avisa que cierra 2');
  await w.EVE_ADMIN_IMPORTAR.procesarConfirmacionPreciosGenerales(hoja);
  igual(w.db.lotes.length, 1, 'un solo lote');
  igual(w.db.lotes[0].map((o) => [o.tipo, o.id === 'A' || o.id === 'B' ? o.id : 'nuevo']), [['update', 'A'], ['update', 'B'], ['set', 'nuevo']], 'dos cierres + nuevo juntos');
  igual(w.db.lotes[0].filter((o) => o.tipo === 'update').map((o) => o.datos.fechaFin), ['2026-11-08', '2026-11-08'], 'fechas de cierre');
  igual(w.obtenerPrecioVigente('PET', '2026-11-10').precio, 9.7, 'la memoria queda con 9.70');
});

caso('importación idempotente: reimportar la misma fila no crea otro registro (se rechaza como ya existente)', async () => {
  const w = crearContexto(copia([A, C]));
  const hoja = w.EVE_ADMIN_IMPORTAR.procesarHojaPreciosGenerales([fila('PET', 9.7, '09-11-2026')]);
  igual(hoja[0].valido, false, 'no es válida');
  afirmar(/ya existe/i.test(hoja[0].motivo) && /no se vuelve a crear/.test(hoja[0].motivo), `motivo claro: ${hoja[0].motivo}`);
  igual(w.db.lotes.length, 0, 'no escribe');
});

caso('importación: misma fecha con otro precio se bloquea como duplicado (no pisa ni duplica)', () => {
  const w = crearContexto(copia([A, C]));
  const hoja = w.EVE_ADMIN_IMPORTAR.procesarHojaPreciosGenerales([fila('PET', 9.8, '09-11-2026')]);
  igual(hoja[0].valido, false, 'bloqueada');
  afirmar(/Ya existe un precio para PET que inicia exactamente/.test(hoja[0].motivo), `motivo: ${hoja[0].motivo}`);
});

caso('dividirEnLotes: una cadena de cierres + nuevo nunca se separa entre lotes', () => {
  const w = crearContexto([]);
  const ops = [
    { tipo: 'update', id: 'a', unidoConSiguiente: true }, { tipo: 'update', id: 'b', unidoConSiguiente: true }, { tipo: 'set', id: 'n1' },
    { tipo: 'update', id: 'c', unidoConSiguiente: true }, { tipo: 'update', id: 'd', unidoConSiguiente: true }, { tipo: 'set', id: 'n2' }
  ];
  igual(w.EVE_ADMIN_IMPORTAR.dividirEnLotes(ops, 4).map((l) => l.map((o) => o.id)), [['a', 'b', 'n1'], ['c', 'd', 'n2']], 'cadenas completas por lote');
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
