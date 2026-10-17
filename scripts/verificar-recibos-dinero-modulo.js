// Verificación de la lógica del módulo Recibos de dinero (js/recibosdinero.js) con un Firestore simulado: importe con letra,
// folio RD-DDMMAAAA-NNN en contadores/RD-DDMMAAAA (consecutivo, reinicia cada día, sin consumirse si el guardado falla, carrera de
// dos usuarios), validación, resumen de la operación con saldo pendiente, cancelación con motivo (estado final, folio conservado,
// relectura fresca), permisos, filtros y totales, y que el módulo NO toca cobros, CxC, Flujo ni ningún otro dato.
// La pantalla (DOM) se prueba en verificar-recibos-dinero-pantalla.js y el PDF en verificar-recibos-dinero-pdf.js.
//
// Uso: node scripts/verificar-recibos-dinero-modulo.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/auth.js', 'js/cotizaciones.js', 'js/cotizaciones-pdf.js', 'js/recibosdinero.js'];
const leer = (relativa) => fs.readFileSync(path.join(RAIZ, relativa), 'utf8');

const { crearDbSimulada } = require('./db-simulada');

function crearContexto(fechaMexico = '2026-10-16') {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    navigator: { onLine: true },
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
  sandbox.window.EVE.currentUser = { username: 'ventas1', permisosResueltos: { recibosDinero: 'escritura' } };
  sandbox.window.EVE.recibosDinero = [];
  return sandbox.window;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const rechaza = async (promesa) => { try { await promesa; } catch (error) { return error; } throw new Error('debía rechazar y no lo hizo'); };

const datosValidos = (extra) => ({
  tipo: 'Anticipo',
  cliente: { nombre: 'América Álvarez Sánchez', rfc: '', domicilio: 'San Luis Potosí, S.L.P.' },
  fecha: '2026-10-16', importe: '30000', moneda: 'MXN', formaPago: 'Transferencia', referencia: 'SPEI 123',
  concepto: 'Anticipo / pago a cuenta por compra de: 400 TAMBOS NUEVOS DE HDPE REPROCESO CAPACIDAD 220LTS', pedidoReferencia: '',
  partidas: [{ descripcion: 'TAMBO NUEVO 200 LTS HDPE REPROCESO', cantidad: '400', unidad: 'PZ', precioUnitario: '265' }], ...extra
});
const colecciones = (w) => Array.from(w.db.docs.keys()).map((ruta) => ruta.split('/')[0]);
const contador = (w, id) => (w.db.docs.get(`contadores/${id}`) || {}).datos;
const historialDe = (w) => Array.from(w.db.docs.entries()).filter(([ruta]) => ruta.startsWith('historial_cambios/')).map(([, d]) => d.datos);
const nuevoRecibo = (w, extra) => w.EVE_RECIBOS_DINERO.guardarRecibo(datosValidos(extra));

caso('importeConLetra: mayúsculas, formato "TREINTA MIL PESOS 00/100 MN", centavos, singular y millones exactos', () => {
  const { importeConLetra } = crearContexto().EVE_RECIBOS_DINERO;
  igual(importeConLetra(30000, 'MXN'), 'TREINTA MIL PESOS 00/100 MN', '30000');
  igual(importeConLetra(1, 'MXN'), 'UN PESO 00/100 MN', '1');
  igual(importeConLetra(1234.56, 'MXN'), 'UN MIL DOSCIENTOS TREINTA Y CUATRO PESOS 56/100 MN', '1234.56');
  igual(importeConLetra(0.5, 'MXN'), 'CERO PESOS 50/100 MN', '0.50');
  igual(importeConLetra(1000000, 'MXN'), 'UN MILLÓN DE PESOS 00/100 MN', 'millón exacto');
  igual(importeConLetra(100, 'MXN'), 'CIEN PESOS 00/100 MN', '100');
  igual(importeConLetra(2, 'USD'), 'DOS DÓLARES 00/100 USD', 'USD');
  igual(importeConLetra(1, 'USD'), 'UN DÓLAR 00/100 USD', 'USD singular');
  igual(importeConLetra(2000000.05, 'USD'), 'DOS MILLONES DE DÓLARES 05/100 USD', 'USD con centavos');
  igual(importeConLetra(2000000, 'USD'), 'DOS MILLONES DE DÓLARES 00/100 USD', 'USD millones exactos');
  afirmar(importeConLetra(12345.67, 'MXN') === importeConLetra(12345.67, 'MXN').toUpperCase(), 'siempre en mayúsculas');
});

caso('folio: RD-DDMMAAAA-NNN con 3 dígitos; fecha inválida no genera folio', () => {
  const { formatearFolio, diaDeFolio } = crearContexto().EVE_RECIBOS_DINERO;
  igual(formatearFolio('2026-10-16', 2), 'RD-16102026-002', 'ejemplo del formato Excel');
  igual(formatearFolio('2026-01-05', 12), 'RD-05012026-012', 'día y mes con cero a la izquierda');
  igual(formatearFolio('2026-12-31', 1000), 'RD-31122026-1000', 'más de 999 en un día no se trunca');
  igual(diaDeFolio('2026-10-16'), '16102026', 'DDMMAAAA');
  let error = null;
  try { formatearFolio('16/10/2026', 1); } catch (e) { error = e; }
  afirmar(error, 'una fecha que no es ISO debe rechazarse');
});

caso('validarRecibo: acepta datos válidos y marca cada campo malo; el RFC es opcional', () => {
  const { validarRecibo } = crearContexto().EVE_RECIBOS_DINERO;
  afirmar(validarRecibo(datosValidos()).ok, 'datos válidos');
  afirmar(validarRecibo(datosValidos({ cliente: { nombre: 'Cliente', rfc: 'aaa010101aaa', domicilio: '' } })).ok, 'RFC válido en minúsculas');
  afirmar(validarRecibo(datosValidos({ tipo: 'Pago de contado', partidas: [] })).ok, 'contado sin resumen');
  const malos = validarRecibo({ tipo: 'Otro', cliente: { nombre: ' ', rfc: '123' }, fecha: '2026-02-30', importe: '10.123', moneda: 'EUR', formaPago: 'Trueque', concepto: ' ', partidas: [] });
  igual(Object.keys(malos.errores).sort(), ['cliente.nombre', 'cliente.rfc', 'concepto', 'fecha', 'formaPago', 'importe', 'moneda', 'tipo'], 'campos con error');
  igual(Object.keys(validarRecibo(datosValidos({ importe: '0' })).errores), ['importe'], 'importe 0');
  igual(Object.keys(validarRecibo(datosValidos({ importe: '-5' })).errores), ['importe'], 'importe negativo');
  igual(Object.keys(validarRecibo(datosValidos({ importe: '1e5' })).errores), ['importe'], 'notación científica');
  afirmar(validarRecibo(datosValidos({ cliente: { nombre: '---' } })).errores['cliente.nombre'], 'un nombre solo de símbolos no vale');
});

caso('validarRecibo: filas vacías del resumen se ignoran; una fila a medias se marca; recibido mayor al total se rechaza; contado ignora el resumen', () => {
  const { validarRecibo } = crearContexto().EVE_RECIBOS_DINERO;
  const vacia = { descripcion: '', cantidad: '', unidad: 'PZ', precioUnitario: '' };
  afirmar(validarRecibo(datosValidos({ partidas: [vacia, ...datosValidos().partidas, vacia] })).ok, 'filas vacías entre partidas válidas');
  afirmar(validarRecibo(datosValidos({ partidas: [vacia] })).ok, 'resumen opcional: todas vacías');
  const media = validarRecibo(datosValidos({ partidas: [{ descripcion: 'Tambo', cantidad: '', unidad: 'PZ', precioUnitario: '' }] }));
  igual(Object.keys(media.errores).sort(), ['partidas.0.cantidad', 'partidas.0.precioUnitario'], 'fila a medias');
  igual(Object.keys(validarRecibo(datosValidos({ importe: '106001' })).errores), ['importe'], 'recibido mayor al total (400 × 265 = 106,000)');
  afirmar(validarRecibo(datosValidos({ importe: '106000' })).ok, 'recibido igual al total: saldo 0');
  afirmar(validarRecibo(datosValidos({ tipo: 'Pago de contado', partidas: [{ descripcion: 'X', cantidad: '0', unidad: 'TON', precioUnitario: '-1' }] })).ok, 'en contado el resumen se ignora, aunque traiga basura');
});

caso('validarRecibo: el resumen admite hasta MAX_PARTIDAS (12) partidas capturadas; las filas vacías no cuentan', () => {
  const { validarRecibo, MAX_PARTIDAS } = crearContexto().EVE_RECIBOS_DINERO;
  igual(MAX_PARTIDAS, 12, 'tope');
  const partida = (i) => ({ descripcion: `PRODUCTO ${i}`, cantidad: '1', unidad: 'PZ', precioUnitario: '10' });
  const vacia = { descripcion: '', cantidad: '', unidad: 'PZ', precioUnitario: '' };
  afirmar(validarRecibo(datosValidos({ importe: '10', partidas: Array.from({ length: 12 }, (_, i) => partida(i)) })).ok, '12 partidas');
  afirmar(validarRecibo(datosValidos({ importe: '10', partidas: [...Array.from({ length: 12 }, (_, i) => partida(i)), vacia, vacia] })).ok, '12 partidas más filas vacías');
  igual(Object.keys(validarRecibo(datosValidos({ importe: '10', partidas: Array.from({ length: 13 }, (_, i) => partida(i)) })).errores), ['partidas'], '13 partidas');
  afirmar(validarRecibo(datosValidos({ tipo: 'Pago de contado', importe: '10', partidas: Array.from({ length: 13 }, (_, i) => partida(i)) })).ok, 'en contado el resumen se ignora');
});

caso('calcularResumen / construirRecibo: saldo pendiente = total de la operación − recibido, con varias partidas', () => {
  const w = crearContexto();
  const partidas = [
    { descripcion: 'TAMBO NUEVO', cantidad: '400', unidad: 'PZ', precioUnitario: '265' },
    { descripcion: 'TAPA', cantidad: '400', unidad: 'PZ', precioUnitario: '12.50' },
    { descripcion: '', cantidad: '', unidad: 'PZ', precioUnitario: '' }
  ];
  igual(w.EVE_RECIBOS_DINERO.calcularResumen(partidas, 30000), { totalOperacion: 111000, importeRecibido: 30000, saldoPendiente: 81000 }, 'resumen');
  igual(w.EVE_RECIBOS_DINERO.calcularResumen([], 100), null, 'sin partidas no hay resumen');
  const r = w.EVE_RECIBOS_DINERO.construirRecibo(datosValidos({ partidas, cliente: { nombre: 'Cliente SA', rfc: 'aaa010101aaa', domicilio: '' } }), {});
  igual(r.resumen.partidas.map((p) => p.importe), [106000, 5000], 'importes por partida (la fila vacía no cuenta)');
  igual([r.resumen.totalOperacion, r.resumen.saldoPendiente], [111000, 81000], 'total y saldo guardados');
  igual([r.importe, r.moneda, r.importeLetra], [30000, 'MXN', 'TREINTA MIL PESOS 00/100 MN'], 'importe, moneda y letra');
  igual([r.cliente.rfc, r.clienteNormalizado], ['AAA010101AAA', 'cliente sa'], 'RFC en mayúsculas y cliente normalizado');
  igual(w.EVE_RECIBOS_DINERO.construirRecibo(datosValidos({ tipo: 'Pago de contado' }), {}).resumen, null, 'contado: sin resumen aunque haya partidas');
  igual(w.EVE_RECIBOS_DINERO.construirRecibo(datosValidos({ partidas: [] }), {}).resumen, null, 'anticipo sin partidas: sin resumen');
});

caso('guardarRecibo: Emitido, folio RD-DDMMAAAA-001, 002… en contadores/RD-DDMMAAAA, con historial atómico', async () => {
  const w = crearContexto('2026-10-16');
  const primero = await nuevoRecibo(w);
  const segundo = await nuevoRecibo(w, { importe: '500' });
  igual([primero.folio, segundo.folio], ['RD-16102026-001', 'RD-16102026-002'], 'folios consecutivos');
  igual(contador(w, 'RD-16102026').ultimo, 2, 'contador del día');
  const doc = w.db.docs.get(`recibos_dinero/${primero.id}`).datos;
  igual([doc.estado, doc.tipo, doc.creadoPor, doc.importeLetra], ['Emitido', 'Anticipo', 'ventas1', 'TREINTA MIL PESOS 00/100 MN'], 'documento');
  igual(doc.historialEstados.map((h) => [h.de, h.a, h.usuario]), [[null, 'Emitido', 'ventas1']], 'historialEstados');
  igual(historialDe(w).map((h) => [h.coleccion, h.accion, h.registroId === primero.id || h.registroId === segundo.id]), [['recibos_dinero', 'alta', true], ['recibos_dinero', 'alta', true]], 'historial_cambios');
});

caso('el consecutivo reinicia cada día y el día es el de emisión (hoy en México), no la fecha capturada', async () => {
  const w = crearContexto('2026-10-16');
  await nuevoRecibo(w);
  await nuevoRecibo(w);
  w.obtenerFechaMexico = () => '2026-10-17';
  const manana = await nuevoRecibo(w);
  igual(manana.folio, 'RD-17102026-001', 'otro día reinicia en 001');
  const atrasado = await nuevoRecibo(w, { fecha: '2026-09-01' });
  igual(atrasado.folio, 'RD-17102026-002', 'una fecha capturada atrasada usa el contador de hoy');
  igual(atrasado.documento.fecha, '2026-09-01', 'y conserva su fecha capturada');
  igual(contador(w, 'RD-16102026').ultimo, 2, 'el contador del día anterior no cambió');
});

caso('si el guardado falla no se consume el folio; si dos usuarios piden a la vez, folios distintos', async () => {
  const w = crearContexto();
  w.db.estadisticas.fallarEn = 'recibos_dinero/';
  await rechaza(nuevoRecibo(w));
  w.db.estadisticas.fallarEn = null;
  igual(contador(w, 'RD-16102026'), undefined, 'el contador no se creó');
  igual(colecciones(w).filter((c) => c === 'historial_cambios').length, 0, 'ni el historial');
  const [a, b, c] = await Promise.all([nuevoRecibo(w), nuevoRecibo(w), nuevoRecibo(w)]);
  igual([a.folio, b.folio, c.folio].sort(), ['RD-16102026-001', 'RD-16102026-002', 'RD-16102026-003'], 'carrera de tres usuarios');
  afirmar(w.db.estadisticas.reintentos > 0, 'hubo reintentos por contención');
});

caso('guardarRecibo: datos inválidos con errores por campo, sin permiso y sin conexión no escriben nada', async () => {
  const w = crearContexto();
  const e1 = await rechaza(w.EVE_RECIBOS_DINERO.guardarRecibo(datosValidos({ importe: '' })));
  igual(Object.keys(e1.errores), ['importe'], 'errores por campo');
  w.EVE.currentUser.permisosResueltos = { recibosDinero: 'lectura' };
  afirmar(/permiso/.test((await rechaza(nuevoRecibo(w))).message), 'solo lectura no emite');
  w.EVE.currentUser.permisosResueltos = {};
  afirmar(/permiso/.test((await rechaza(nuevoRecibo(w))).message), 'sin permiso no emite');
  w.EVE.currentUser.permisosResueltos = { recibosDinero: 'escritura' };
  w.navigator.onLine = false;
  afirmar(/Sin conexión/.test((await rechaza(nuevoRecibo(w))).message), 'sin conexión no emite');
  igual(w.db.docs.size, 0, 'no se escribió nada en ningún caso');
});

caso('cancelarRecibo: motivo obligatorio, Emitido → Cancelado, folio e importes intactos, historial; Cancelado es final', async () => {
  const w = crearContexto();
  const { id, folio, documento } = await nuevoRecibo(w);
  afirmar(/motivo/i.test((await rechaza(w.EVE_RECIBOS_DINERO.cancelarRecibo(id, '  '))).message), 'sin motivo no cancela');
  igual(w.db.docs.get(`recibos_dinero/${id}`).datos.estado, 'Emitido', 'sigue Emitido');
  const r = await w.EVE_RECIBOS_DINERO.cancelarRecibo(id, 'Cliente desistió de la compra');
  const doc = w.db.docs.get(`recibos_dinero/${id}`).datos;
  igual([doc.estado, doc.folio, doc.motivoCancelacion, doc.canceladoPor], ['Cancelado', folio, 'Cliente desistió de la compra', 'ventas1'], 'cancelado con folio y motivo');
  const { estado, motivoCancelacion, canceladoPor, canceladoEn, historialEstados, actualizadoPor, actualizadoEn, ...resto } = doc;
  const { estado: e0, historialEstados: h0, ...restoOriginal } = documento;
  igual(resto, restoOriginal, 'importes, cliente, concepto y resumen no cambiaron');
  igual(doc.historialEstados.map((h) => [h.de, h.a, h.motivo || null]), [[null, 'Emitido', null], ['Emitido', 'Cancelado', 'Cliente desistió de la compra']], 'historialEstados con el motivo');
  igual(r.documento.estado, 'Cancelado', 'devuelve el documento actualizado');
  const e2 = await rechaza(w.EVE_RECIBOS_DINERO.cancelarRecibo(id, 'otra vez'));
  afirmar(/ya está en estado Cancelado/.test(e2.message) && e2.documentoActual && e2.documentoActual.estado === 'Cancelado', 'no se cancela dos veces y el error trae el documento actual');
  igual(historialDe(w).map((h) => h.accion), ['alta', 'cancelacion'], 'historial_cambios');
  igual(contador(w, 'RD-16102026').ultimo, 1, 'cancelar no toca el contador: el folio no se reutiliza');
  const siguiente = await nuevoRecibo(w);
  igual(siguiente.folio, 'RD-16102026-002', 'el siguiente recibo NO reutiliza el folio cancelado');
});

caso('no existe forma de eliminar ni de editar un recibo desde el módulo; cancelar sin permiso o sin conexión no cambia nada', async () => {
  const w = crearContexto();
  const api = Object.keys(w.EVE_RECIBOS_DINERO);
  afirmar(!api.some((k) => /elimin|borrar|delete|editar|actualizar/i.test(k)), `API sin eliminar ni editar: ${api.join(', ')}`);
  const { id } = await nuevoRecibo(w);
  w.EVE.currentUser.permisosResueltos = { recibosDinero: 'lectura' };
  afirmar(/permiso/.test((await rechaza(w.EVE_RECIBOS_DINERO.cancelarRecibo(id, 'x'))).message), 'solo lectura no cancela');
  w.EVE.currentUser.permisosResueltos = { recibosDinero: 'escritura' };
  w.navigator.onLine = false;
  afirmar(/Sin conexión/.test((await rechaza(w.EVE_RECIBOS_DINERO.cancelarRecibo(id, 'x'))).message), 'sin conexión no cancela');
  igual(w.db.docs.get(`recibos_dinero/${id}`).datos.estado, 'Emitido', 'sigue Emitido');
  afirmar(/ya no existe/.test((await rechaza((async () => { w.navigator.onLine = true; return w.EVE_RECIBOS_DINERO.cancelarRecibo('inexistente', 'x'); })())).message), 'un id inexistente se informa');
});

caso('NO crea ni modifica cobros, anticipos, CxC, Flujo ni ningún otro dato: solo recibos_dinero, contadores e historial_cambios', async () => {
  const w = crearContexto();
  const ajenos = {
    'cobros/c1': { cliente: 'X', monto: 10 }, 'cuentas_por_cobrar/q1': { saldo: 500, pagado: 0 }, 'flujo_movimientos/f1': { monto: 99 },
    'ventas/v1': { cliente: 'X' }, 'proveedores/p1': { saldoAFavor: [{ monto: 5 }] }, 'cuentas_por_pagar/z1': { saldo: 7 }
  };
  Object.entries(ajenos).forEach(([ruta, datos]) => w.db.docs.set(ruta, { datos, version: 1 }));
  const antes = JSON.stringify(Array.from(w.db.docs.entries()).filter(([ruta]) => ruta in ajenos));
  w.EVE.cobros = [{ id: 'c1' }]; w.EVE.cuentasPorCobrar = [{ id: 'q1', saldo: 500 }]; w.EVE.flujoMovimientos = [];
  const memoriaAntes = JSON.stringify([w.EVE.cobros, w.EVE.cuentasPorCobrar, w.EVE.flujoMovimientos]);
  const { id } = await nuevoRecibo(w);
  await nuevoRecibo(w, { tipo: 'Pago de contado', partidas: [] });
  await w.EVE_RECIBOS_DINERO.cancelarRecibo(id, 'Error de captura');
  igual(JSON.stringify(Array.from(w.db.docs.entries()).filter(([ruta]) => ruta in ajenos)), antes, 'documentos ajenos intactos');
  igual(JSON.stringify([w.EVE.cobros, w.EVE.cuentasPorCobrar, w.EVE.flujoMovimientos]), memoriaAntes, 'datos en memoria intactos');
  igual(Array.from(new Set(colecciones(w))).sort(), ['contadores', 'cobros', 'cuentas_por_cobrar', 'cuentas_por_pagar', 'flujo_movimientos', 'historial_cambios', 'proveedores', 'recibos_dinero', 'ventas'].sort(), 'colecciones tocadas (las ajenas ya existían)');
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/recibosdinero.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ['cobros', 'cuentas_por_cobrar', 'CUENTAS_POR_COBRAR', 'COBROS', 'flujo', 'saldoAFavor', 'EVE_CXP', 'EVE_CXC', 'actualizarDato', 'eliminarDato', 'guardarDato'].forEach((t) => {
    afirmar(!fuente.includes(t), `js/recibosdinero.js no debe referirse a "${t}"`);
  });
});

caso('filtrarRecibos: por folio o cliente (sin acentos ni mayúsculas), tipo, estado y rango de fechas; totales por estado y moneda', async () => {
  const w = crearContexto('2026-10-16');
  const e = w.EVE_RECIBOS_DINERO;
  const a = await nuevoRecibo(w, { fecha: '2026-10-16' });
  const b = await nuevoRecibo(w, { tipo: 'Pago de contado', partidas: [], importe: '500', moneda: 'USD', fecha: '2026-10-10', cliente: { nombre: 'Plásticos del Norte' } });
  const c = await nuevoRecibo(w, { importe: '1000', fecha: '2026-09-30', cliente: { nombre: 'Otro Cliente' } });
  await e.cancelarRecibo(c.id, 'duplicado');
  const lista = [a, b, c].map((x) => ({ id: x.id, ...w.db.docs.get(`recibos_dinero/${x.id}`).datos }));
  const folios = (f) => e.filtrarRecibos(lista, f).map((r) => r.folio);
  igual(folios({}), ['RD-16102026-001', 'RD-16102026-002', 'RD-16102026-003'], 'sin filtros');
  igual(folios({ buscar: 'alvarez' }), ['RD-16102026-001'], 'cliente sin acentos');
  igual(folios({ buscar: 'PLASTICOS' }), ['RD-16102026-002'], 'cliente en mayúsculas y sin acento');
  igual(folios({ buscar: 'rd-16102026-003' }), ['RD-16102026-003'], 'folio completo');
  igual(folios({ buscar: '002' }), ['RD-16102026-002'], 'parte del folio');
  igual(folios({ tipo: 'Pago de contado' }), ['RD-16102026-002'], 'tipo');
  igual(folios({ estado: 'Cancelado' }), ['RD-16102026-003'], 'estado');
  igual(folios({ desde: '2026-10-01', hasta: '2026-10-15' }), ['RD-16102026-002'], 'rango');
  igual(folios({ desde: '2026-10-16' }), ['RD-16102026-001'], 'solo desde');
  igual(folios({ buscar: 'alvarez', estado: 'Cancelado' }), [], 'filtros combinados');
  const t = e.totalesPorEstado(lista);
  igual(t.map((x) => [x.estado, x.cantidad, x.porMoneda.map((m) => [m.moneda, m.total])]), [['Emitido', 2, [['MXN', 30000], ['USD', 500]]], ['Cancelado', 1, [['MXN', 1000]]]], 'totales por estado, sin mezclar monedas');
});

caso('clientesParaAutocompletar: clientes de recibos anteriores (con RFC y domicilio, el más reciente gana) y de Cotizaciones, sin duplicados', () => {
  const e = crearContexto().EVE_RECIBOS_DINERO;
  const recibos = [
    { fecha: '2026-09-01', cliente: { nombre: 'Américo Pérez', rfc: 'AAA010101AAA', domicilio: 'Calle 1' } },
    { fecha: '2026-10-01', cliente: { nombre: 'AMERICO PEREZ', rfc: '', domicilio: 'Calle 2' } },
    { fecha: '2026-10-02', cliente: { nombre: 'Zeta SA', rfc: '', domicilio: '' } }
  ];
  const clientes = [{ razonSocial: 'Beta SA', direccion: 'Av. Beta' }, { razonSocial: 'zeta sa', direccion: 'Av. Zeta' }];
  igual(e.clientesParaAutocompletar(recibos, clientes), [
    { nombre: 'AMERICO PEREZ', rfc: 'AAA010101AAA', domicilio: 'Calle 2' },
    { nombre: 'Beta SA', rfc: '', domicilio: 'Av. Beta' },
    { nombre: 'Zeta SA', rfc: '', domicilio: 'Av. Zeta' }
  ], 'una entrada por cliente; el recibo reciente gana el nombre, conserva el RFC previo y completa lo que falte');
  igual(e.clientesParaAutocompletar(undefined, undefined), [], 'sin datos');
});

caso('transiciones: solo Emitido → Cancelado (espejo de las reglas de Firestore)', () => {
  const { transicionValida, TRANSICIONES_RECIBO } = crearContexto().EVE_RECIBOS_DINERO;
  igual(TRANSICIONES_RECIBO, { Emitido: ['Cancelado'], Cancelado: [] }, 'mapa');
  igual([transicionValida('Emitido', 'Cancelado'), transicionValida('Cancelado', 'Emitido'), transicionValida('Emitido', 'Emitido'), transicionValida('Cancelado', 'Cancelado')], [true, false, false, false], 'transiciones');
  const reglas = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
  afirmar(/function transicionReciboDineroValida\(de, a\)\s*\{\s*return de == 'Emitido' && a == 'Cancelado';\s*\}/.test(reglas), 'las reglas permiten solo Emitido -> Cancelado');
  afirmar(/match \/recibos_dinero\/\{docId\}[\s\S]*?allow delete: if false;/.test(reglas), 'las reglas no permiten eliminar');
  afirmar(/docId\.matches\('RD-\.\*'\) && puedeEscribir\('recibosDinero'\)/.test(reglas), 'las reglas de contadores cubren RD-');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
