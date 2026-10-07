// Módulo Flujo de efectivo (js/flujo.js).
//
// Lógica pura (construirMovimientosFlujo, filtros, validación del movimiento manual, exportaciones TXT y CSV) cargando el js/ real
// en un vm, más comprobaciones sobre el código fuente de que el módulo quedó cableado: permiso tri-estado, pestaña en Finanzas,
// carga de datos, reglas de Firestore (raíz y rules-test), service worker y retiro del Flujo de Efectivo Histórico del Dashboard.
//
// Uso: node scripts/verificar-flujo.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['config.js', 'utils.js', 'permisos.js', 'flujo.js'];
const leer = (ruta) => fs.readFileSync(path.join(RAIZ, ruta), 'utf8');

function crearContexto() {
  const window = { EVE_MODULES: {} };
  window.window = window;
  window.EVE = { cobros: [], registrosPagos: [], gastos: [], flujoMovimientos: [], currentUser: null };
  const ctx = vm.createContext({
    window, console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout,
    firebase: { initializeApp() {}, firestore: () => ({ enablePersistence: () => ({ catch() {} }) }) },
    document: { getElementById: () => null, createElement: () => ({}) }
  });
  for (const f of ARCHIVOS) vm.runInContext(leer(`js/${f}`), ctx, { filename: f });
  return window;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const falla = (fn, texto, mensaje) => {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  afirmar(error && error.message.includes(texto), `${mensaje}: debía lanzar "${texto}", obtuvo ${error ? `"${error.message}"` : 'nada'}`);
};

const INICIO = '2026-10-01';
const cobro = (extra) => ({ fecha: '2026-10-05', cliente: 'CLIENTE A', folio: 'V-2026-001', pagado: 1000, iva: 0, revertido: false, fechaRegistro: '2026-10-05T10:00:00.000Z', ...extra });
const pago = (extra) => ({ fecha: '2026-10-06', proveedor: 'PROV A', ticket: '1160', pagado: 580, iva: 80, origen: 'cxp_pago_general', revertido: false, fechaRegistro: '2026-10-06T10:00:00.000Z', ...extra });
const gasto = (extra) => ({ fecha: '2026-10-07', concepto: 'Luz', beneficiario: 'CFE', montoBase: 300, iva: 48, fechaRegistro: '2026-10-07T10:00:00.000Z', ...extra });
const manual = (extra) => ({ id: 'm1', fecha: '2026-10-08', tipo: 'Entrada', concepto: 'Aportación', contraparte: 'Socio', folio: '', importe: 500, fechaRegistro: '2026-10-08T10:00:00.000Z', ...extra });

// ── Entradas ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

caso('FLUJO_FECHA_INICIO es 2026-10-01', () => {
  igual(crearContexto().EVE_FLUJO.FLUJO_FECHA_INICIO, INICIO, 'inicio');
});

caso('Cobros: entran los no revertidos desde el 1 de octubre, con cliente, folio e importe = pagado (sin columna de IVA)', () => {
  const w = crearContexto();
  const m = w.EVE_FLUJO.construirMovimientosFlujo({
    cobros: [cobro(), cobro({ revertido: true }), cobro({ fecha: '2026-09-30' }), cobro({ fecha: INICIO, pagado: 250, cliente: 'B', folio: 'V-2026-002' })]
  });
  igual(m.map((x) => [x.tipo, x.concepto, x.fecha, x.contraparte, x.folio, x.entrada, x.salida]),
    [['Entrada', 'Cobro', INICIO, 'B', 'V-2026-002', 250, 0], ['Entrada', 'Cobro', '2026-10-05', 'CLIENTE A', 'V-2026-001', 1000, 0]], 'entradas');
  afirmar(!m.some((x) => 'iva' in x), 'el movimiento no expone iva');
});

caso('Cobro con iva > 0 marca alertaIva; sin iva no', () => {
  const w = crearContexto();
  const m = w.EVE_FLUJO.construirMovimientosFlujo({ cobros: [cobro({ iva: 160 }), cobro({ iva: 0, fecha: '2026-10-06' }), cobro({ iva: undefined, fecha: '2026-10-07' })] });
  igual(m.map((x) => x.alertaIva), [true, false, false], 'alertaIva');
});

// ── Salidas ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

caso('Pagos: importe = pagado - iva, el anticipo cuenta completo, los revertidos y anteriores a octubre no entran', () => {
  const w = crearContexto();
  const m = w.EVE_FLUJO.construirMovimientosFlujo({
    pagos: [
      pago(),
      pago({ origen: 'anticipo', ticket: '', pagado: 1000, iva: 0, fecha: '2026-10-07', concepto: undefined }),
      pago({ origen: 'anticipo', pagado: 400, iva: 50, fecha: '2026-10-08' }),
      pago({ revertido: true }),
      pago({ fecha: '2026-09-30' }),
      pago({ iva: undefined, pagado: 200, fecha: '2026-10-09' })
    ]
  });
  igual(m.map((x) => [x.fecha, x.concepto, x.contraparte, x.folio, x.salida]), [
    ['2026-10-06', 'Pago a proveedor', 'PROV A', '1160', 500],
    ['2026-10-07', 'Anticipo a proveedor', 'PROV A', '', 1000],
    ['2026-10-08', 'Anticipo a proveedor', 'PROV A', '1160', 400],
    ['2026-10-09', 'Pago a proveedor', 'PROV A', '1160', 200]
  ], 'salidas por pago');
});

caso('Gastos: importe = montoBase (sin sumar iva), con respaldo total y luego monto; anteriores a octubre no entran', () => {
  const w = crearContexto();
  const m = w.EVE_FLUJO.construirMovimientosFlujo({
    gastos: [
      gasto(), gasto({ montoBase: undefined, total: 700, fecha: '2026-10-08' }), gasto({ montoBase: undefined, total: undefined, monto: 90, fecha: '2026-10-09' }),
      gasto({ fecha: '2026-09-15' }), gasto({ concepto: '', beneficiario: '', fecha: '2026-10-10' })
    ]
  });
  igual(m.map((x) => [x.concepto, x.contraparte, x.salida]), [['Luz', 'CFE', 300], ['Luz', 'CFE', 700], ['Luz', 'CFE', 90], ['Gasto', '', 300]], 'gastos');
});

caso('Movimientos manuales: Entrada suma y Salida resta; un manual anterior a octubre no entra al flujo', () => {
  const w = crearContexto();
  const m = w.EVE_FLUJO.construirMovimientosFlujo({
    movimientosManuales: [manual(), manual({ id: 'm2', tipo: 'Salida', importe: 120, concepto: '', fecha: '2026-10-09' }), manual({ id: 'm3', fecha: '2026-09-01' })]
  });
  igual(m.map((x) => [x.origen, x.tipo, x.concepto, x.entrada, x.salida, x.manualId, x.saldo]),
    [['manual', 'Entrada', 'Aportación', 500, 0, 'm1', 500], ['manual', 'Salida', 'Movimiento manual', 0, 120, 'm2', 380]], 'manuales');
});

// Documento que crea registrarPagoGeneral (cxp.js) para el sobrante de un pago general: ticket '', total 0, origen 'anticipo'.
const anticipoPagoGeneral = (extra) => ({ ticket: '', proveedor: 'PROV A', material: '', kg: 0, precioPorKg: 0, total: 0, pagado: 300, nota: 'Anticipo - saldo a favor', fecha: '2026-10-06', origen: 'anticipo', revertido: false, grupoPagoId: 'pago_1', fechaRegistro: '2026-10-06T10:05:00.000Z', ...extra });

caso('Anticipo de un pago general con sobrante: el pago del ticket y el anticipo cuentan completos como salidas del mismo día', () => {
  const w = crearContexto();
  const m = w.EVE_FLUJO.construirMovimientosFlujo({
    cobros: [cobro({ pagado: 2000 })],
    pagos: [pago({ pagado: 1000, iva: 0, origen: 'cxp_pago_general', grupoPagoId: 'pago_1' }), anticipoPagoGeneral()]
  });
  igual(m.map((x) => [x.concepto, x.contraparte, x.folio, x.salida, x.saldo]), [
    ['Cobro', 'CLIENTE A', 'V-2026-001', 0, 2000],
    ['Pago a proveedor', 'PROV A', '1160', 1000, 1000],
    ['Anticipo a proveedor', 'PROV A', '', 300, 700]
  ], 'pago del ticket + anticipo');
  igual(w.EVE_FLUJO.calcularTotalesFlujo(m).salidas, 1300, 'se cuenta todo el monto pagado (1000 + 300), no solo lo aplicado a tickets');
});

caso('Anticipo revertido: no cuenta; si se revierte todo el grupo solo queda lo que no se revirtió', () => {
  const w = crearContexto();
  const soloAnticipoRevertido = w.EVE_FLUJO.construirMovimientosFlujo({
    pagos: [pago({ pagado: 1000, iva: 0, origen: 'cxp_pago_general' }), anticipoPagoGeneral({ revertido: true })]
  });
  igual(soloAnticipoRevertido.map((x) => [x.concepto, x.salida]), [['Pago a proveedor', 1000]], 'el anticipo revertido no aparece');
  const grupoRevertido = w.EVE_FLUJO.construirMovimientosFlujo({
    pagos: [pago({ pagado: 1000, iva: 0, origen: 'cxp_pago_general', revertido: true }), anticipoPagoGeneral({ revertido: true })]
  });
  igual(grupoRevertido, [], 'todo el grupo revertido: flujo vacío');
});

caso('Anticipo con iva en el documento (dato atípico): cuenta completo, sin restar IVA; el pago normal sí resta su IVA', () => {
  const w = crearContexto();
  const m = w.EVE_FLUJO.construirMovimientosFlujo({ pagos: [anticipoPagoGeneral({ iva: 40 }), pago({ pagado: 580, iva: 80, fecha: '2026-10-07' })] });
  igual(m.map((x) => x.salida), [300, 500], 'anticipo completo, pago sin IVA');
});

// ── Orden y saldo ────────────────────────────────────────────────────────────────────────────────────────────────────────

caso('Orden por fecha y luego por fechaRegistro; el saldo es el acumulado en ese orden', () => {
  const w = crearContexto();
  const m = w.EVE_FLUJO.construirMovimientosFlujo({
    cobros: [cobro({ fecha: '2026-10-05', pagado: 1000, fechaRegistro: '2026-10-05T15:00:00.000Z' })],
    pagos: [pago({ fecha: '2026-10-05', pagado: 400, iva: 0, fechaRegistro: '2026-10-05T09:00:00.000Z' })],
    gastos: [gasto({ fecha: '2026-10-04', montoBase: 100, fechaRegistro: '2026-10-04T23:00:00.000Z' })]
  });
  igual(m.map((x) => [x.fecha, x.origen, x.saldo]), [['2026-10-04', 'gasto', -100], ['2026-10-05', 'pago', -500], ['2026-10-05', 'cobro', 500]], 'orden y saldo');
});

caso('Mismo día y mismo fechaRegistro: se conserva el orden de llegada (estable)', () => {
  const w = crearContexto();
  const m = w.EVE_FLUJO.construirMovimientosFlujo({
    cobros: [cobro({ folio: 'A', fechaRegistro: '' }), cobro({ folio: 'B', fechaRegistro: '' }), cobro({ folio: 'C', fechaRegistro: '' })]
  });
  igual(m.map((x) => x.folio), ['A', 'B', 'C'], 'estable');
});

caso('El saldo se redondea a centavos (sin 0.1 + 0.2 = 0.30000000000000004)', () => {
  const w = crearContexto();
  const m = w.EVE_FLUJO.construirMovimientosFlujo({ cobros: [cobro({ pagado: 0.1 }), cobro({ pagado: 0.2, fecha: '2026-10-06' })] });
  igual(m.map((x) => x.saldo), [0.1, 0.3], 'saldos');
  const t = w.EVE_FLUJO.calcularTotalesFlujo(m);
  igual([t.entradas, t.salidas, t.neto], [0.3, 0, 0.3], 'totales');
});

caso('Entradas vacías o sin datos: arreglo vacío, totales en 0 y saldoFinal con respaldo', () => {
  const w = crearContexto();
  igual(w.EVE_FLUJO.construirMovimientosFlujo({}), [], 'sin datos');
  igual(w.EVE_FLUJO.construirMovimientosFlujo(), [], 'sin argumento');
  const t = w.EVE_FLUJO.calcularTotalesFlujo([]);
  igual([t.entradas, t.salidas, t.neto], [0, 0, 0], 'totales vacíos');
  igual([w.EVE_FLUJO.saldoFinalFlujo([], 77), w.EVE_FLUJO.saldoFinalFlujo([])], [77, 0], 'saldoFinal vacío');
});

// ── Filtros de la vista ──────────────────────────────────────────────────────────────────────────────────────────────────

function ejemplo(w) {
  return w.EVE_FLUJO.construirMovimientosFlujo({
    cobros: [cobro({ fecha: '2026-10-01', pagado: 1000, cliente: 'JOSÉ PÉREZ' }), cobro({ fecha: '2026-10-12', pagado: 500, cliente: 'MARÍA' })],
    pagos: [pago({ fecha: '2026-10-12', pagado: 300, iva: 0, proveedor: 'RECICLADOS SA' })],
    gastos: [gasto({ fecha: '2026-10-14', montoBase: 100, concepto: 'Diésel', beneficiario: 'GASOLINERA' })]
  });
}
const REF = { hoy: '2026-10-14', inicioSemana: '2026-10-12', inicioMes: '2026-10-01' };

caso('Hoy / Esta Semana / Este Mes filtran por fecha y el saldo sigue siendo el acumulado desde el 1 de octubre', () => {
  const w = crearContexto();
  const todos = ejemplo(w);
  const hoy = w.EVE_FLUJO.filtrarMovimientosFlujo(todos, 'hoy', {}, REF);
  igual(hoy.map((x) => [x.concepto, x.saldo]), [['Diésel', 1100]], 'hoy conserva el saldo global (1000 + 500 - 300 - 100)');
  igual(w.EVE_FLUJO.filtrarMovimientosFlujo(todos, 'semana', {}, REF).length, 3, 'semana');
  igual(w.EVE_FLUJO.filtrarMovimientosFlujo(todos, 'mes', {}, REF).length, 4, 'mes');
  igual(w.EVE_FLUJO.saldoFinalFlujo(todos), 1100, 'saldo actual');
});

caso('Todos: filtra por fechas, tipo y texto (cliente, proveedor o concepto, sin distinguir acentos ni mayúsculas)', () => {
  const w = crearContexto();
  const todos = ejemplo(w);
  const filtrar = (f) => w.EVE_FLUJO.filtrarMovimientosFlujo(todos, 'todos', f, REF).map((x) => x.concepto + '|' + x.contraparte);
  igual(filtrar({}).length, 4, 'sin filtros');
  igual(filtrar({ desde: '2026-10-12' }).length, 3, 'desde');
  igual(filtrar({ hasta: '2026-10-01' }), ['Cobro|JOSÉ PÉREZ'], 'hasta');
  igual(filtrar({ tipo: 'Salida' }).length, 2, 'solo salidas');
  igual(filtrar({ tipo: 'Entrada' }).length, 2, 'solo entradas');
  igual(filtrar({ texto: 'jose perez' }), ['Cobro|JOSÉ PÉREZ'], 'cliente sin acentos');
  igual(filtrar({ texto: 'reciclados' }), ['Pago a proveedor|RECICLADOS SA'], 'proveedor');
  igual(filtrar({ texto: 'diesel' }), ['Diésel|GASOLINERA'], 'concepto sin acento');
  igual(filtrar({ texto: 'maria', tipo: 'Salida' }), [], 'texto + tipo combinados');
  const filtrado = w.EVE_FLUJO.filtrarMovimientosFlujo(todos, 'todos', { tipo: 'Salida' }, REF);
  igual(filtrado.map((x) => x.saldo), [1200, 1100].map((v, i) => [1500 - 300, 1100][i]), 'el saldo filtrado sigue siendo el global');
});

// ── Movimiento manual ────────────────────────────────────────────────────────────────────────────────────────────────────

caso('Movimiento manual: valida fecha obligatoria, formato, desde el 1 de octubre, importe > 0 y tipo', () => {
  const w = crearContexto();
  const construir = (extra) => w.EVE_FLUJO.construirMovimientoManualDesdeFormulario({ fecha: '2026-10-10', tipo: 'Salida', concepto: ' Fletes ', contraparte: ' X ', folio: '', importe: '150.5', notas: '', ...extra });
  const ok = construir({});
  igual([ok.fecha, ok.tipo, ok.concepto, ok.contraparte, ok.importe], ['2026-10-10', 'Salida', 'Fletes', 'X', 150.5], 'normaliza');
  falla(() => construir({ fecha: '' }), 'La fecha es obligatoria', 'sin fecha');
  falla(() => construir({ fecha: undefined }), 'La fecha es obligatoria', 'fecha indefinida');
  falla(() => construir({ fecha: '10/10/2026' }), 'AAAA-MM-DD', 'formato');
  falla(() => construir({ fecha: '2026-09-30' }), 'o posterior', 'antes del inicio');
  ['', 0, '0', -5, 'abc', null, undefined].forEach((importe) => falla(() => construir({ importe }), 'mayor a 0', `importe ${JSON.stringify(importe)}`));
  falla(() => construir({ tipo: 'Otro' }), 'Entrada o Salida', 'tipo');
  igual(construir({ fecha: INICIO }).fecha, INICIO, 'el 1 de octubre es válido');
});

// ── Exportaciones ────────────────────────────────────────────────────────────────────────────────────────────────────────

caso('TXT: encabezado con periodo, totales de entradas, salidas y neto, saldo final y el listado', () => {
  const w = crearContexto();
  w.formatearFecha = w.formatearFecha || ((f) => f);
  const movs = ejemplo(w);
  const t = w.EVE_FLUJO.calcularTotalesFlujo(movs);
  const txt = w.EVE_FLUJO.generarTXTFlujo(movs, { etiquetaReporte: 'MES', etiquetaPeriodo: 'DEL 01/10/2026 AL 14/10/2026' }, t, w.EVE_FLUJO.saldoFinalFlujo(movs));
  ['REPORTE DE FLUJO DE EFECTIVO', 'REPORTE: MES', 'PERIODO: DEL 01/10/2026 AL 14/10/2026', 'ENTRADAS:', 'SALIDAS:', 'NETO DEL PERIODO:', 'SALDO FINAL:', 'DETALLE DE MOVIMIENTOS:', 'JOSÉ PÉREZ', 'RECICLADOS SA', 'Diésel']
    .forEach((fragmento) => afirmar(txt.includes(fragmento), `el TXT debe incluir "${fragmento}"`));
  afirmar(!/iva/i.test(txt), 'el TXT no menciona IVA');
  igual([t.entradas, t.salidas, t.neto], [1500, 400, 1100], 'totales del ejemplo');
});

caso('CSV: una fila por movimiento más totales, neto y saldo final; sin columna de IVA; con la alerta de cobro con IVA', () => {
  const w = crearContexto();
  const movs = w.EVE_FLUJO.construirMovimientosFlujo({ cobros: [cobro({ iva: 160 })], gastos: [gasto({ montoBase: 100 })] });
  const filas = w.EVE_FLUJO.construirFilasCSVFlujo(movs, w.EVE_FLUJO.calcularTotalesFlujo(movs), w.EVE_FLUJO.saldoFinalFlujo(movs));
  igual(filas.length, 2 + 4, 'dos movimientos + 4 filas de resumen');
  igual(Object.keys(filas[0]), ['Fecha', 'Tipo', 'Concepto', 'Cliente/Proveedor', 'Folio', 'Entrada', 'Salida', 'Saldo', 'Origen', 'Alerta'], 'columnas');
  igual(filas[0].Alerta, 'Cobro con IVA: revisa la venta', 'alerta del cobro con IVA');
  igual(filas.slice(2).map((f) => [f.Concepto, f.Entrada, f.Salida, f.Saldo]),
    [['TOTAL ENTRADAS', 1000, '', ''], ['TOTAL SALIDAS', '', 100, ''], ['NETO DEL PERIODO', '', '', 900], ['SALDO FINAL', '', '', 900]], 'resumen');
  igual(w.EVE_FLUJO.construirFilasCSVFlujo([], { entradas: 0, salidas: 0, neto: 0 }, 0), [], 'sin movimientos no hay filas de resumen');
});

// ── Cableado del módulo ──────────────────────────────────────────────────────────────────────────────────────────────────

caso('Permiso: flujo está en MODULOS_PERMISOS y en el editor de roles; un rol sin la clave queda en ninguno (solo Admin lo asigna)', () => {
  const w = crearContexto();
  afirmar(/'gastos', 'flujo', 'cotizaciones'/.test(leer('js/permisos.js')), 'flujo en MODULOS_PERMISOS');
  afirmar(/\{ clave: 'flujo', nombre: 'Flujo de efectivo' \}/.test(leer('js/admin-roles.js')), 'flujo en MODULOS_ROL');
  igual(w.calcularPermisosResueltosDesdeRol({ permisos: { gastos: 'escritura' } }).flujo, 'ninguno', 'rol existente sin la clave');
  igual(w.calcularPermisosResueltosDesdeRol({ permisos: { flujo: 'escritura' } }).flujo, 'escritura', 'rol con flujo');
  igual(w.calcularPermisosResueltosDesdeRol(null).flujo, 'ninguno', 'sin rol');
  igual(w.resolverPermisosDesdeLegacy({ gastos: true, admin: true }).flujo, 'ninguno', 'usuario legacy no recibe flujo por omisión');
});

caso('auth.js: pestaña en el grupo Finanzas, carga de flujo_movimientos con el permiso flujo, estado inicial y reinicio al salir', () => {
  const auth = leer('js/auth.js');
  afirmar(/\{ permiso: 'flujo', id: 'flujo', nombre: 'Flujo de efectivo', grupo: 'finanzas' \}/.test(auth), 'ORDEN_TABS');
  afirmar(/\{ campo: 'flujoMovimientos', coleccion: window\.COLECCIONES\.FLUJO_MOVIMIENTOS, modulo: 'flujo' \}/.test(auth), 'CARGAS_MODULO');
  afirmar(/^\s*flujoMovimientos: \[\],/m.test(auth), 'estado inicial en window.EVE');
  afirmar(auth.includes('window.EVE.flujoMovimientos = datos.flujoMovimientos;') && auth.includes('window.EVE.flujoMovimientos = [];'), 'asignación al cargar y reinicio al salir');
  afirmar(/FLUJO_MOVIMIENTOS: 'flujo_movimientos'/.test(leer('js/config.js')), 'COLECCIONES');
});

caso('El módulo se registra como window.EVE_MODULES.flujo = { render } y se carga desde index.html y el service worker', () => {
  const w = crearContexto();
  afirmar(w.EVE_MODULES.flujo && typeof w.EVE_MODULES.flujo.render === 'function', 'EVE_MODULES.flujo.render');
  afirmar(leer('index.html').includes('<script src="js/flujo.js"></script>'), 'index.html');
  afirmar(leer('service-worker.js').includes("'js/flujo.js'"), 'APP_SHELL del service worker');
});

caso('firestore.rules (raíz y rules-test): flujo_movimientos con el patrón de cobros pero con el permiso flujo', () => {
  ['firestore.rules', 'rules-test/firestore.rules'].forEach((archivo) => {
    const bloque = leer(archivo).match(/match \/flujo_movimientos\/\{docId\} \{([^}]*)\}/);
    afirmar(bloque, `${archivo}: falta match /flujo_movimientos`);
    afirmar(bloque[1].includes("allow read: if puedeLeer('flujo');"), `${archivo}: sin puedeLeer('flujo')`);
    afirmar(bloque[1].includes("allow write: if puedeEscribir('flujo');"), `${archivo}: sin puedeEscribir('flujo')`);
  });
});

caso('flujo.js: historial en edición y eliminación, escritura solo con puedeEscribir("flujo") y ninguna columna ni KPI de IVA', () => {
  const f = leer('js/flujo.js');
  const codigo = f.split('\n').filter((linea) => !linea.trim().startsWith('//')).join('\n');
  afirmar((f.match(/accion: 'edicion'/g) || []).length === 1 && (f.match(/accion: 'eliminacion'/g) || []).length === 1, 'EVE_HISTORIAL en edición y eliminación');
  afirmar(f.includes("window.puedeEscribir(PERMISO)") && f.includes("const PERMISO = 'flujo';"), 'puedeEscribir(flujo)');
  afirmar(!/<th[^>]*>IVA<\/th>/.test(f) && !/label: 'IVA'/.test(f) && !/etiqueta: 'IVA'/.test(f), 'sin columna ni KPI de IVA');
  afirmar(!codigo.includes('cuentas_por_pagar') && !codigo.includes('cuentasPorPagar'), 'no lee CxP (los pagos ya están en pagos: se contarían doble)');
  afirmar(!/telegram/i.test(codigo), 'sin Telegram');
});

caso('Dashboard: sin la sub-pestaña Flujo de Efectivo Histórico ni su lógica exclusiva', () => {
  const d = leer('js/dashboard.js');
  ['flujo-efectivo', 'Flujo de Efectivo Histórico', 'renderizarTablaFlujoEfectivo', 'calcularVistaFlujoEfectivoHistorico', 'construirFilasFlujoEfectivo']
    .forEach((texto) => afirmar(!d.includes(texto), `dashboard.js ya no contiene ${texto}`));
  afirmar(d.includes('function agruparPorMesY') && d.includes('function construirMatrizMesClave'), 'los agregadores compartidos siguen');
  afirmar(d.includes("'subproductos-real-teorico'") && d.includes("'exposicion-actual'"), 'las demás sub-pestañas siguen');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FAIL ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
