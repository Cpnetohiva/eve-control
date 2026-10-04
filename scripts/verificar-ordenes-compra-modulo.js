// Verificación de la lógica del módulo Órdenes de Compra (js/ordenescompra.js) con un Firestore simulado: validación, folio
// OC-AAAA-nnnn en contadores/OC-AAAA (consecutivo, sin reutilizar al eliminar, sin consumirse si el guardado falla, carrera de
// dos usuarios), estados y transiciones con relectura fresca, edición solo en Emitida, eliminación solo en Emitida, consultas
// por rango, proveedores derivados, filtros y totales, y el historial atómico.
// La pantalla y el PDF reales (DOM, jsPDF) se prueban en verificar-ordenes-compra-pantalla.js.
//
// Uso: node scripts/verificar-ordenes-compra-modulo.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/auth.js', 'js/cotizaciones.js', 'js/ordenescompra.js'];
const leer = (relativa) => fs.readFileSync(path.join(RAIZ, relativa), 'utf8');

const { crearDbSimulada } = require('./db-simulada');

function crearContexto(fechaMexico = '2026-10-04') {
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
  sandbox.window.db = crearDbSimulada();
  sandbox.window.obtenerFechaMexico = () => fechaMexico;
  sandbox.window.EVE.currentUser = { username: 'compras1', permisosResueltos: { ordenesCompra: 'escritura' } };
  sandbox.window.EVE.ordenesCompra = [];
  return sandbox.window;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const rechaza = async (promesa) => { try { await promesa; } catch (error) { return error; } throw new Error('debía rechazar y no lo hizo'); };

const datosValidos = (extra) => ({
  proveedor: { nombre: 'Recicladora del Norte', telefono: '8112345678', email: 'ventas@norte.example', domicilio: 'Av. Industria 100' },
  fecha: '2026-10-04', condicionesPago: 'Contado', condicionesEntrega: 'En planta', notas: '', aplicaIva: true,
  partidas: [{ producto: '', descripcion: 'Scrap PET', cantidad: '100', unidad: 'KG', precioUnitario: '10', descuentoPct: '' }], ...extra
});
const historialDe = (w) => Array.from(w.db.docs.entries()).filter(([ruta]) => ruta.startsWith('historial_cambios/')).map(([, d]) => d.datos);
const contador = (w, id = 'OC-2026') => (w.db.docs.get(`contadores/${id}`) || {}).datos;
const nuevaOC = async (w, extra) => w.EVE_ORDENES_COMPRA.guardarOrden(datosValidos(extra));

caso('validarOrden: proveedor, fecha y cada partida; sin errores con datos válidos (descuento vacío = 0)', () => {
  const { validarOrden } = crearContexto().EVE_ORDENES_COMPRA;
  afirmar(validarOrden(datosValidos()).ok, 'datos válidos');
  const malos = validarOrden({ proveedor: { nombre: ' ', email: 'x' }, fecha: '2026-02-30', partidas: [{ producto: '', descripcion: '', cantidad: '0', unidad: 'TON', precioUnitario: '-1', descuentoPct: '101' }] });
  igual(Object.keys(malos.errores).sort(), ['fecha', 'partidas.0.cantidad', 'partidas.0.descuentoPct', 'partidas.0.precioUnitario', 'partidas.0.producto', 'partidas.0.unidad', 'proveedor.email', 'proveedor.nombre'], 'campos con error');
  igual(Object.keys(validarOrden({ proveedor: { nombre: 'X' }, fecha: '2026-10-04', partidas: [] }).errores), ['partidas'], 'sin partidas');
  afirmar(validarOrden(datosValidos({ proveedor: { nombre: '---' } })).errores['proveedor.nombre'], 'un nombre solo de símbolos no vale');
  afirmar(validarOrden(datosValidos({ proveedor: { nombre: 'X', telefono: '', email: '', domicilio: '' } })).ok, 'teléfono, correo y domicilio son opcionales');
});

caso('alta: folio OC-2026-0001 en Emitida, totales con IVA 16%, emisor copiado, historialEstados y historial_cambios; contador en 1', async () => {
  const w = crearContexto();
  const r = await nuevaOC(w);
  igual(r.folio, 'OC-2026-0001', 'folio');
  const d = w.db.docs.get(`ordenes_compra/${r.id}`).datos;
  igual([d.estado, d.creadoPor, d.proveedorNormalizado], ['Emitida', 'compras1', 'recicladora del norte'], 'estado, autor y proveedor normalizado');
  igual(d.totales, { subtotal: 1000, aplicaIva: true, ivaTasa: 0.16, iva: 160, total: 1160 }, 'totales');
  igual(d.emisor.razonSocial, 'RIVAL PLASTIC SAPI DE CV', 'copia del emisor');
  igual(d.historialEstados.map((e) => [e.de, e.a, e.usuario]), [[null, 'Emitida', 'compras1']], 'historialEstados');
  igual(contador(w), { ultimo: 1, prefijo: 'OC', anio: 2026 }, 'contador');
  const h = historialDe(w);
  igual(h.length, 1, 'una entrada en historial_cambios');
  igual([h[0].coleccion, h[0].accion, h[0].registroId], ['ordenes_compra', 'alta', r.id], 'entrada de alta');
  const sinIva = await nuevaOC(w, { aplicaIva: false });
  igual([sinIva.folio, sinIva.documento.totales.iva, sinIva.documento.totales.total], ['OC-2026-0002', 0, 1000], 'sin IVA y folio consecutivo');
});

caso('folio: otro año = otro contador (OC-2027-0001); el contador de cotizaciones no se toca', async () => {
  const w = crearContexto('2027-01-02');
  const r = await nuevaOC(w, { fecha: '2027-01-02' });
  igual(r.folio, 'OC-2027-0001', 'folio del nuevo año');
  afirmar(!w.db.docs.has('contadores/COT-2027') && !w.db.docs.has('contadores/OC-2026'), 'solo OC-2027');
});

caso('alta: sin permiso (lectura, ninguno, key ausente), sin conexión o con datos inválidos NO escribe nada ni consume folio', async () => {
  for (const permisos of [{ ordenesCompra: 'lectura' }, { ordenesCompra: 'ninguno' }, { cotizaciones: 'escritura' }, {}]) {
    const w = crearContexto();
    w.EVE.currentUser = { username: 'x', permisosResueltos: permisos };
    await rechaza(nuevaOC(w));
    igual(w.db.docs.size, 0, `escribió con ${JSON.stringify(permisos)}`);
  }
  const w = crearContexto();
  const error = await rechaza(w.EVE_ORDENES_COMPRA.guardarOrden(datosValidos({ partidas: [] })));
  afirmar(error.errores && error.errores.partidas, 'devuelve errores por campo');
  w.navigator = { onLine: false };
  const sinRed = await rechaza(nuevaOC(w));
  afirmar(/Sin conexión/.test(sinRed.message), 'mensaje sin conexión');
  igual(w.db.docs.size, 0, 'nada escrito');
});

caso('alta: si el guardado falla al confirmar no se consume el folio ni queda historial; el siguiente intento recibe el 0001', async () => {
  const w = crearContexto();
  w.db.estadisticas.fallarEn = 'ordenes_compra/';
  await rechaza(nuevaOC(w));
  igual(w.db.docs.size, 0, 'nada quedó a medias');
  w.db.estadisticas.fallarEn = null;
  igual((await nuevaOC(w)).folio, 'OC-2026-0001', 'folio sin hueco');
});

caso('folio: dos usuarios a la vez reciben folios distintos y consecutivos (la transacción reintenta)', async () => {
  const w = crearContexto();
  const resultados = await Promise.all([nuevaOC(w), nuevaOC(w), nuevaOC(w)]);
  igual(resultados.map((r) => r.folio).sort(), ['OC-2026-0001', 'OC-2026-0002', 'OC-2026-0003'], 'folios');
  igual(contador(w).ultimo, 3, 'contador');
  afirmar(w.db.estadisticas.reintentos > 0, 'hubo reintentos por contención');
});

caso('editar: una Emitida conserva folio, estado e historial y registra la edición; una Recibida o Cancelada no se edita', async () => {
  const w = crearContexto();
  const alta = await nuevaOC(w);
  const editada = await w.EVE_ORDENES_COMPRA.guardarOrden(datosValidos({ notas: 'urgente' }), alta.id);
  igual([editada.folio, editada.documento.estado, editada.documento.notas, editada.documento.actualizadoPor], ['OC-2026-0001', 'Emitida', 'urgente', 'compras1'], 'edición');
  igual(contador(w).ultimo, 1, 'la edición no toca el contador');
  igual(historialDe(w).map((h) => h.accion), ['alta', 'edicion'], 'historial');
  await w.EVE_ORDENES_COMPRA.cambiarEstado(alta.id, 'Recibida');
  const error = await rechaza(w.EVE_ORDENES_COMPRA.guardarOrden(datosValidos({ notas: 'tarde' }), alta.id));
  afirmar(/Solo se puede editar una orden Emitida/.test(error.message) && error.documentoActual.estado === 'Recibida', 'no edita una Recibida y devuelve la copia real');
  igual(w.db.docs.get(`ordenes_compra/${alta.id}`).datos.notas, 'urgente', 'la Recibida no cambió');
});

caso('cambiarEstado: Emitida → Recibida → Cancelada con historialEstados y historial_cambios; las demás transiciones se rechazan', async () => {
  const w = crearContexto();
  const { cambiarEstado } = w.EVE_ORDENES_COMPRA;
  const a = await nuevaOC(w);
  const recibida = await cambiarEstado(a.id, 'Recibida');
  igual(recibida.documento.estado, 'Recibida', 'estado');
  await rechaza(cambiarEstado(a.id, 'Emitida'));
  await rechaza(cambiarEstado(a.id, 'Recibida'));
  const cancelada = await cambiarEstado(a.id, 'Cancelada');
  igual(cancelada.documento.historialEstados.map((e) => [e.de, e.a]), [[null, 'Emitida'], ['Emitida', 'Recibida'], ['Recibida', 'Cancelada']], 'historialEstados');
  for (const destino of ['Emitida', 'Recibida', 'Cancelada']) await rechaza(cambiarEstado(a.id, destino));
  const b = await nuevaOC(w);
  igual((await cambiarEstado(b.id, 'Cancelada')).documento.estado, 'Cancelada', 'Emitida → Cancelada directo');
  await rechaza(cambiarEstado(b.id, 'Recibida'));
  await rechaza(cambiarEstado(b.id, 'Borrador'));
  igual(historialDe(w).filter((h) => h.accion === 'cambio_estado').length, 3, 'tres cambios de estado registrados (los rechazados no dejan rastro)');
});

caso('cambiarEstado: relectura fresca — si otro usuario ya cambió el estado rechaza y entrega la copia real; sin permiso o sin red no cambia nada', async () => {
  const w = crearContexto();
  const a = await nuevaOC(w);
  // Otro usuario la canceló en el servidor mientras esta pantalla seguía viendo "Emitida".
  const ruta = `ordenes_compra/${a.id}`;
  w.db.docs.get(ruta).datos.estado = 'Cancelada';
  const error = await rechaza(w.EVE_ORDENES_COMPRA.cambiarEstado(a.id, 'Recibida'));
  igual(error.documentoActual.estado, 'Cancelada', 'copia real en el error');
  igual(w.db.docs.get(ruta).datos.estado, 'Cancelada', 'el servidor no cambió');
  w.db.docs.get(ruta).datos.estado = 'Emitida';
  w.EVE.currentUser = { username: 'x', permisosResueltos: { ordenesCompra: 'lectura' } };
  await rechaza(w.EVE_ORDENES_COMPRA.cambiarEstado(a.id, 'Recibida'));
  w.EVE.currentUser = { username: 'x', permisosResueltos: { ordenesCompra: 'escritura' } };
  w.navigator = { onLine: false };
  await rechaza(w.EVE_ORDENES_COMPRA.cambiarEstado(a.id, 'Recibida'));
  igual(w.db.docs.get(ruta).datos.estado, 'Emitida', 'sigue Emitida');
  await rechaza(w.EVE_ORDENES_COMPRA.cambiarEstado('no-existe', 'Recibida'));
});

caso('eliminarOC: solo una Emitida; deja rastro en historial_cambios; NO baja el contador (el folio no se reutiliza)', async () => {
  const w = crearContexto();
  const a = await nuevaOC(w);
  const b = await nuevaOC(w);
  const eliminada = await w.EVE_ORDENES_COMPRA.eliminarOC(b.id);
  igual([eliminada.folio, eliminada.proveedor, eliminada.total], ['OC-2026-0002', 'Recicladora del Norte', 1160], 'resultado');
  afirmar(!w.db.docs.has(`ordenes_compra/${b.id}`), 'el documento se borró');
  const h = historialDe(w).filter((x) => x.accion === 'eliminacion');
  igual([h.length, h[0].registroId, h[0].valorNuevo], [1, b.id, null], 'historial de la eliminación');
  igual(contador(w).ultimo, 2, 'el contador sigue en 2');
  igual((await nuevaOC(w)).folio, 'OC-2026-0003', 'el siguiente folio NO reutiliza el 0002');
  await w.EVE_ORDENES_COMPRA.cambiarEstado(a.id, 'Recibida');
  const error = await rechaza(w.EVE_ORDENES_COMPRA.eliminarOC(a.id));
  afirmar(/solo se elimina una orden Emitida/.test(error.message) && error.documentoActual.estado === 'Recibida', 'una Recibida no se elimina');
  afirmar(w.db.docs.has(`ordenes_compra/${a.id}`), 'sigue ahí');
  await rechaza(w.EVE_ORDENES_COMPRA.eliminarOC(''));
  await rechaza(w.EVE_ORDENES_COMPRA.eliminarOC('no-existe'));
});

caso('eliminarOC: sin permiso, sin red o con fallo al confirmar no borra nada ni deja historial a medias', async () => {
  const w = crearContexto();
  const a = await nuevaOC(w);
  const antes = historialDe(w).length;
  w.EVE.currentUser = { username: 'x', permisosResueltos: { ordenesCompra: 'lectura' } };
  await rechaza(w.EVE_ORDENES_COMPRA.eliminarOC(a.id));
  w.EVE.currentUser = { username: 'x', permisosResueltos: { ordenesCompra: 'escritura' } };
  w.db.estadisticas.fallarEn = 'historial_cambios/';
  await rechaza(w.EVE_ORDENES_COMPRA.eliminarOC(a.id));
  w.db.estadisticas.fallarEn = null;
  afirmar(w.db.docs.has(`ordenes_compra/${a.id}`) && historialDe(w).length === antes, 'nada cambió');
});

caso('obtenerOC, listarOCs y listarOCsPorRango: lectura del servidor, orden por folio descendente y rango inclusivo', async () => {
  const w = crearContexto();
  const fechas = ['2026-09-30', '2026-10-01', '2026-10-15', '2026-11-01'];
  for (const fecha of fechas) await nuevaOC(w, { fecha });
  const todas = await w.EVE_ORDENES_COMPRA.listarOCs();
  igual(todas.map((o) => o.folio), ['OC-2026-0004', 'OC-2026-0003', 'OC-2026-0002', 'OC-2026-0001'], 'todas, folio descendente');
  igual((await w.EVE_ORDENES_COMPRA.listarOCsPorRango('2026-10-01', '2026-10-15')).map((o) => o.fecha), ['2026-10-15', '2026-10-01'], 'rango inclusivo');
  igual((await w.EVE_ORDENES_COMPRA.listarOCsPorRango('2026-10-16', '')).map((o) => o.fecha), ['2026-11-01'], 'solo desde');
  igual((await w.EVE_ORDENES_COMPRA.listarOCsPorRango('', '2026-09-30')).map((o) => o.fecha), ['2026-09-30'], 'solo hasta');
  igual((await w.EVE_ORDENES_COMPRA.listarOCsPorRango('', '')).length, 4, 'sin límites');
  igual((await w.EVE_ORDENES_COMPRA.obtenerOC(todas[0].id)).folio, 'OC-2026-0004', 'obtenerOC');
  igual(await w.EVE_ORDENES_COMPRA.obtenerOC('no-existe'), null, 'obtenerOC de una inexistente');
});

caso('normalizarProveedor, proveedoresDeOrdenes y cargarDatos: minúsculas sin acentos, una entrada por proveedor (la más reciente)', async () => {
  const w = crearContexto();
  const oc = w.EVE_ORDENES_COMPRA;
  igual(oc.normalizarProveedor('  PLÁSTICOS   del  Norte '), 'plasticos del norte', 'normalización');
  igual(oc.normalizarProveedor(undefined), '', 'sin nombre');
  await nuevaOC(w, { fecha: '2026-09-01', proveedor: { nombre: 'Plásticos del Norte', telefono: '1' } });
  await nuevaOC(w, { fecha: '2026-10-01', proveedor: { nombre: 'PLASTICOS DEL NORTE', telefono: '2' } });
  await nuevaOC(w, { fecha: '2026-09-15', proveedor: { nombre: 'Acopios MX' } });
  await oc.cargarDatos();
  igual(w.EVE.ordenesCompra.length, 3, 'window.EVE.ordenesCompra');
  igual(w.EVE.ordenesCompraProveedores.map((p) => [p.nombre, p.telefono]), [['Acopios MX', ''], ['PLASTICOS DEL NORTE', '2']], 'proveedores derivados, el más reciente gana');
  w.EVE.currentUser = { username: 'x', permisosResueltos: {} };
  igual(await oc.cargarDatos(), [], 'sin permiso de lectura no carga nada');
});

caso('filtrarOrdenes y totalesPorEstado: por proveedor (sin acentos ni mayúsculas), estado y fechas; importes por estado en orden', async () => {
  const w = crearContexto();
  const oc = w.EVE_ORDENES_COMPRA;
  const a = await nuevaOC(w, { fecha: '2026-10-01', proveedor: { nombre: 'Plásticos del Norte' } });
  const b = await nuevaOC(w, { fecha: '2026-10-10', proveedor: { nombre: 'Acopios MX' }, aplicaIva: false });
  await oc.cambiarEstado(b.id, 'Recibida');
  await oc.cargarDatos();
  const lista = w.EVE.ordenesCompra;
  igual(oc.filtrarOrdenes(lista, { proveedor: 'PLASTICOS' }).map((o) => o.folio), [a.folio], 'proveedor');
  igual(oc.filtrarOrdenes(lista, { estado: 'Recibida' }).map((o) => o.folio), [b.folio], 'estado');
  igual(oc.filtrarOrdenes(lista, { desde: '2026-10-05', hasta: '2026-10-31' }).map((o) => o.folio), [b.folio], 'fechas');
  igual(oc.filtrarOrdenes(lista, {}).length, 2, 'sin filtros');
  igual(oc.totalesPorEstado(lista), [{ estado: 'Emitida', cantidad: 1, total: 1160 }, { estado: 'Recibida', cantidad: 1, total: 1000 }, { estado: 'Cancelada', cantidad: 0, total: 0 }], 'totales por estado');
});

caso('la máquina de estados del módulo es la definida: Emitida → Recibida | Cancelada, Recibida → Cancelada, Cancelada final', () => {
  const oc = crearContexto().EVE_ORDENES_COMPRA;
  igual(oc.ESTADOS_OC, ['Emitida', 'Recibida', 'Cancelada'], 'estados');
  igual(oc.TRANSICIONES_OC, { Emitida: ['Recibida', 'Cancelada'], Recibida: ['Cancelada'], Cancelada: [] }, 'transiciones');
  afirmar(!oc.transicionValida('Cancelada', 'Emitida') && !oc.transicionValida('Recibida', 'Emitida') && !oc.transicionValida('Emitida', 'Emitida'), 'no hay vueltas atrás');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
