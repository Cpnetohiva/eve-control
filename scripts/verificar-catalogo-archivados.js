// K22c - Archivado frente a inexistente, Trazabilidad por cualquier material y piezas por proceso.
//
// Un material ARCHIVADO (activo:false, lo pone window.EVE_CATALOGO) no se ofrece en altas (selectores y datalists) pero
// sigue resolviendo en historial, reportes, trazabilidad, inventario con saldo y edicion de registros existentes. Los
// importadores distinguen "esta archivado" de "no esta en el catalogo". Una pieza (PZ) solo se ofrece como salida del
// proceso donde se produce (reglas.procesoProduccion).
//
// Carga los js/ reales en un vm (sin Firestore ni DOM) y ejercita un caso por consumidor tocado.
//
// Uso: node scripts/verificar-catalogo-archivados.js   (codigo de salida 1 si algun caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['config.js', 'utils.js', 'rendimientos.js', 'precios.js', 'inventario.js', 'cxp.js', 'pagos.js',
  'control-produccion.js', 'ventas.js', 'destaraje.js', 'admin-importar.js', 'trazabilidad.js', 'dashboard.js'];

function crearContexto() {
  const window = { EVE_MODULES: {} };
  window.window = window;
  window.EVE = {
    registrosDestaraje: [], registrosVentas: [], registrosControlProduccion: [], registrosPagos: [], cuentasPorPagar: [],
    proveedores: [], precios: [], ajustesPrecioProveedor: [], comisiones: [], auditorias: [], composiciones: [], ventas: [],
    inventarioInicial: [], inventario: [], fechaCorteAuditoria: '2026-07-01', currentUser: { username: 'prueba', permisosResueltos: { admin: 'escritura' } }
  };
  const el = () => ({ addEventListener() {}, appendChild() {}, querySelector: () => el(), querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} }, style: {}, options: [] });
  const ctx = vm.createContext({
    window, console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, XLSX: {},
    firebase: { initializeApp() {}, firestore: () => ({ enablePersistence: () => ({ catch() {} }) }) },
    document: { getElementById: () => null, createElement: () => ({ options: [], children: [] }), createTextNode: () => el() }
  });
  for (const f of ARCHIVOS) vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js', f), 'utf8'), ctx, { filename: f });
  return window;
}

// Contexto con materiales archivados: PET CRISTAL (subproducto recibible), DURO (crudo), RECHAZO CAJAS P.E. y una pieza.
function crearContextoConArchivados(archivados) {
  const w = crearContexto();
  const overrides = {};
  (archivados || ['PET CRISTAL', 'DURO', 'TAPON']).forEach((n) => { overrides[n] = { activo: false }; });
  w.EVE_CATALOGO.aplicar({ overrides });
  return w;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

// ── El catalogo: estado y variantes historicas ───────────────────────────────

caso('estadoDe distingue activo, archivado e inexistente (por nombre normalizado y con alias)', () => {
  const w = crearContextoConArchivados();
  igual(['LECHERO', 'PET CRISTAL', 'tapon', 'NO EXISTE', 'garrafa', 'pet   cristal'].map((n) => w.EVE_CATALOGO.estadoDe(n)),
    ['activo', 'archivado', 'archivado', 'inexistente', 'activo', 'archivado'], 'estados');
});

caso('Sin archivados nada cambia: las variantes historicas son iguales a las de alta', () => {
  const w = crearContexto();
  igual(w.materialesConStockHistoricos(), w.materialesConStock(), 'materialesConStock');
  igual(w.materialesProduciblesHistoricos(), w.materialesProducibles(), 'materialesProducibles');
  igual(w.materialesQueRequierenSeleccionHistoricos(), w.materialesQueRequierenSeleccion(), 'materialesQueRequierenSeleccion');
  igual(w.materialesRecibiblesHistoricos(), w.MATERIALES_COMUNES, 'recibibles');
  igual(w.materialesConStock().every((m) => w.EVE_CATALOGO.estadoDe(m) === 'activo'), true, 'todos activos');
});

caso('Con archivados: las listas de alta los excluyen y las historicas los incluyen', () => {
  const w = crearContextoConArchivados();
  ['materialesConStock', 'materialesProducibles', 'materialesQueRequierenSeleccion'].forEach((f) => {
    afirmar(!w[f]().includes('PET CRISTAL'), `${f} no incluye PET CRISTAL`);
  });
  afirmar(!w.MATERIALES_COMUNES.includes('PET CRISTAL') && !w.materialesQueRequierenSeleccion().includes('DURO'), 'alta: sin PET CRISTAL ni DURO');
  afirmar(w.materialesConStockHistoricos().includes('TAPON') && w.materialesProduciblesHistoricos().includes('PET CRISTAL'), 'historicas con archivados');
  afirmar(w.materialesQueRequierenSeleccionHistoricos().includes('DURO') && w.materialesRecibiblesHistoricos().includes('PET CRISTAL'), 'crudos y recibibles historicos con archivados');
});

// ── Selectores de edicion ──────────────────────────────────────────────────────

function selectFalso() {
  const sel = { options: [], appendChild(o) { this.options.push(o); }, children: null };
  return sel;
}

caso('utils: agregarOpcionSiArchivado conserva un archivado en un select de edicion y nada mas', () => {
  const w = crearContextoConArchivados();
  const sel = selectFalso();
  igual(w.agregarOpcionSiArchivado(sel, 'PET CRISTAL'), true, 'agrega el archivado');
  igual(sel.options.map((o) => o.value), ['PET CRISTAL'], 'con su valor');
  afirmar(/archivado/.test(sel.options[0].textContent), 'y lo marca como archivado');
  igual(w.agregarOpcionSiArchivado(sel, 'PET CRISTAL'), false, 'no duplica la opcion');
  igual([w.agregarOpcionSiArchivado(sel, 'LECHERO'), w.agregarOpcionSiArchivado(sel, 'NO EXISTE'), w.agregarOpcionSiArchivado(sel, ''), w.agregarOpcionSiArchivado(null, 'DURO')], [false, false, false, false], 'activo, inexistente, vacio y sin select: no agrega');
  igual(sel.options.length, 1, 'solo la del archivado');
});

caso('Bascula (destaraje.js) y Control Produccion: al editar conservan el material archivado de un registro existente', () => {
  const destaraje = fs.readFileSync(path.join(RAIZ, 'js/destaraje.js'), 'utf8');
  afirmar(/agregarOpcionSiArchivado\(document\.getElementById\('de-material'\), registro\.material\);\s*document\.getElementById\('de-material'\)\.value = registro\.material;/.test(destaraje), 'destaraje.js agrega la opcion antes de asignar el valor');
  const cp = fs.readFileSync(path.join(RAIZ, 'js/control-produccion.js'), 'utf8');
  afirmar(/function llenarSelectMaterial[\s\S]*?agregarOpcionSiArchivado\(select, valorActual\)/.test(cp), 'control-produccion.js conserva el valor archivado en llenarSelectMaterial');
  const rend = fs.readFileSync(path.join(RAIZ, 'js/rendimientos.js'), 'utf8');
  afirmar(/agregarOpcionSiArchivado\(select, normalizado\)/.test(rend), 'rendimientos.js conserva un subproducto archivado de una composicion existente');
});

// ── Trazabilidad ────────────────────────────────────────────────────────────

caso('Trazabilidad: el selector de material ofrece CUALQUIER material (piezas, rechazos y archivados), no solo los recibibles', () => {
  const w = crearContextoConArchivados();
  const valores = Array.from(w.EVE_TRAZABILIDAD.opcionesMaterialesTrazabilidad().matchAll(/value="([^"]+)"/g), (m) => m[1]);
  igual(valores.length, 44, 'los 44 materiales (los archivados incluidos)');
  ['CAJA CO30', 'TAMBO', 'RECHAZO CAJAS P.E.', 'PET CRISTAL', 'TAPON', 'DURO', 'LECHERO MOLIDO'].forEach((m) => afirmar(valores.includes(m), `${m} se puede buscar`));
  igual(valores, valores.slice().sort(), 'ordenados');
  const antes = w.MATERIALES_COMUNES.length;
  afirmar(antes < valores.length && !w.MATERIALES_COMUNES.includes('CAJA CO30'), 'antes (MATERIALES_COMUNES) no se podian buscar las piezas ni los rechazos');
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/trazabilidad.js'), 'utf8');
  afirmar(/\$\{opcionesMaterialesTrazabilidad\(\)\}/.test(fuente) && !/MATERIALES_COMUNES/.test(fuente), 'la vista usa el helper y ya no lee MATERIALES_COMUNES');
});

// ── Control Produccion: piezas por proceso ───────────────────────────────────

caso('Control Produccion: una pieza solo se ofrece como salida del proceso donde se produce', () => {
  const w = crearContexto();
  const f = (nombres, proceso) => w.EVE_CONTROL_PRODUCCION.filtrarPiezasPorProceso(nombres, proceso);
  const todos = w.materialesProducibles();
  ['SELECCION', 'MOLIENDA', 'LAVADO', 'PELETIZADO', 'EMPACADO'].forEach((p) => {
    igual(f(todos, p).filter((m) => w.materialesPZ().includes(m)), [], `${p}: ninguna pieza`);
    igual(f(todos, p).length, todos.length - 7, `${p}: solo se quitan las 7 piezas`);
  });
  igual(f(todos, 'PRODUCCION_CAJAS').filter((m) => w.materialesPZ().includes(m)), ['CAJA CO30', 'CAJA CH25', 'CAJA AGRO20'], 'CAJAS: sus tres cajas');
  igual(f(todos, 'PRODUCCION_TAMBOS').filter((m) => w.materialesPZ().includes(m)), ['TAMBO'], 'TAMBOS: TAMBO');
  igual(f(todos, 'PRODUCCION_TAPONES').filter((m) => w.materialesPZ().includes(m)), ['ORING', 'SELLO', 'TAPON'], 'TAPONES: oring, sello y tapon');
  igual(f(todos, 'MOLIENDA').filter((m) => !w.materialesPZ().includes(m)), todos.filter((m) => !w.materialesPZ().includes(m)), 'lo que no es pieza no se toca');
});

caso('Control Produccion: un PZ nuevo se ofrece solo en su proceso (reglas.procesoProduccion); sin la regla, solo en los procesos de pieza', () => {
  const w = crearContexto();
  w.EVE_CATALOGO.aplicar({ materiales: {
    'CAJA NUEVA': { unidad: 'PZ', seObtieneEnProduccion: true, requiereSeleccion: false, reglas: { procesoProduccion: 'PRODUCCION_TAMBOS' } },
    'PIEZA SIN REGLA': { unidad: 'PZ', seObtieneEnProduccion: true, requiereSeleccion: false }
  } });
  const f = (proceso) => w.EVE_CONTROL_PRODUCCION.filtrarPiezasPorProceso(w.materialesProducibles(), proceso);
  igual(['SELECCION', 'MOLIENDA', 'PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES'].map((p) => f(p).includes('CAJA NUEVA')),
    [false, false, false, true, false], 'CAJA NUEVA: solo PRODUCCION_TAMBOS');
  igual(['SELECCION', 'MOLIENDA', 'PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES'].map((p) => f(p).includes('PIEZA SIN REGLA')),
    [false, false, true, true, true], 'PIEZA SIN REGLA: en los tres procesos de pieza y en ningun otro');
  igual(w.EVE_CONTROL_PRODUCCION.PROCESOS_PZ.length, 3, 'los tres procesos de pieza');
});

// ── Importadores (K12) ──────────────────────────────────────────────────────────

const ARCHIVADO = (n) => `Material '${n}' está archivado`;
const NO_ESTA = (n) => `Material '${n}' no está en el catálogo`;

caso('Importador de Bascula: archivado e inexistente dan motivos distintos; un activo pasa', () => {
  const w = crearContextoConArchivados();
  const I = w.EVE_ADMIN_IMPORTAR;
  const fila = (material) => ({ Ticket: '9260', Proveedor: 'JOSE', Material: material, Kg: 100, 'Fecha Entrada': '01-08-2026', 'Fecha Salida': '01-08-2026' });
  const arch = I.procesarFilaDestaraje(fila('pet cristal'));
  const inex = I.procesarFilaDestaraje(fila('NO EXISTE'));
  igual([arch.valido, arch.motivo], [false, ARCHIVADO('PET CRISTAL')], 'archivado');
  igual([inex.valido, inex.motivo], [false, NO_ESTA('NO EXISTE')], 'inexistente');
  igual(I.procesarFilaDestaraje(fila('LECHERO')).valido, true, 'activo');
});

caso('Importadores de Precios y Ajustes: archivado frente a inexistente', () => {
  const w = crearContextoConArchivados();
  const I = w.EVE_ADMIN_IMPORTAR;
  const precio = (m) => I.procesarHojaPreciosGenerales([{ Material: m, Precio: 5, 'Fecha Vigencia': '01-08-2026', Notas: '' }])[0];
  const ajuste = (m) => I.procesarHojaAjustesProveedor([{ Material: m, Proveedor: 'JOSE', 'Tipo Ajuste': 'Monto', Valor: 0.5, 'Fecha Vigencia': '01-08-2026' }])[0];
  igual([precio('PET CRISTAL').valido, precio('PET CRISTAL').motivo], [false, ARCHIVADO('PET CRISTAL')], 'precio archivado');
  afirmar(/no está en el catálogo de materiales/.test(precio('NO EXISTE').motivo) && !/archivado/.test(precio('NO EXISTE').motivo), 'precio inexistente: ' + precio('NO EXISTE').motivo);
  igual([ajuste('PET CRISTAL').valido, ajuste('PET CRISTAL').motivo], [false, ARCHIVADO('PET CRISTAL')], 'ajuste archivado');
  afirmar(!/archivado/.test(ajuste('NO EXISTE').motivo), 'ajuste inexistente');
  igual(precio('LECHERO').valido, true, 'precio activo');
});

caso('Importador de Ventas: material archivado frente a no reconocido (con el numero de fila)', () => {
  const w = crearContextoConArchivados();
  const I = w.EVE_ADMIN_IMPORTAR;
  const venta = (m) => I.procesarHojaVentas([{ 'Grupo Venta': 'V1', Fecha: '10-06-2026', Cliente: 'C', 'Ticket Relacionado': '', Material: m, Kg: 10, Precio: 5, Total: '' }])[0];
  igual([venta('TAPON').valido, venta('TAPON').motivo], [false, `Fila 2: ${ARCHIVADO('TAPON')}`], 'archivado');
  igual(venta('XYZ').motivo, 'Fila 2: Material "XYZ" no reconocido', 'inexistente: el mensaje de siempre');
  igual(venta('LECHERO').valido, true, 'activo');
});

caso('Importador de Control Produccion: entradas y salidas archivadas dan el motivo archivado; inexistentes, el de siempre', () => {
  const w = crearContextoConArchivados();
  const I = w.EVE_ADMIN_IMPORTAR;
  const fila = (tipo, material, kg, extra) => ({ 'Grupo/Proceso': 'G', 'Tipo Proceso': 'SELECCION', 'Tipo Fila': tipo, Material: material, Kg: kg, 'Ticket Origen': '', 'Es Merma': '', Operador: 'ANA', Turno: 'Matutino', Fecha: '10-06-2026', ...extra });
  const entradaArch = I.procesarHojaControlProduccion([fila('ENTRADA', 'DURO', 100), fila('SALIDA', 'P.P.', 60), fila('SALIDA', 'BASURA', 40, { 'Es Merma': 'SI' })])[0];
  igual([entradaArch.valido, entradaArch.motivo], [false, ARCHIVADO('DURO')], 'entrada archivada');
  const salidaArch = I.procesarHojaControlProduccion([fila('ENTRADA', 'MIXTO', 100), fila('SALIDA', 'PET CRISTAL', 60), fila('SALIDA', 'BASURA', 40, { 'Es Merma': 'SI' })])[0];
  igual([salidaArch.valido, salidaArch.motivo], [false, ARCHIVADO('PET CRISTAL')], 'salida archivada');
  const inex = I.procesarHojaControlProduccion([fila('ENTRADA', 'ZZZ', 100), fila('SALIDA', 'P.P.', 60), fila('SALIDA', 'BASURA', 40, { 'Es Merma': 'SI' })])[0];
  igual([inex.valido, inex.motivo], [false, NO_ESTA('ZZZ')], 'inexistente');
  const bien = I.procesarHojaControlProduccion([fila('ENTRADA', 'MIXTO', 100), fila('SALIDA', 'P.P.', 60), fila('SALIDA', 'BASURA', 40, { 'Es Merma': 'SI' })])[0];
  igual(bien.valido, true, 'activos');
});

caso('Importador de Composiciones: un material de entrada archivado da el motivo archivado', () => {
  const w = crearContextoConArchivados();
  const I = w.EVE_ADMIN_IMPORTAR;
  const filas = (entrada) => [{ 'Material Entrada': entrada, Subproducto: 'P.P.', '%': 100, 'Es Merma': 'No', 'Procesos Válidos': '', 'Proceso Sugerido': '' }];
  const arch = I.procesarHojaComposiciones(filas('DURO'))[0];
  igual([arch.valido, arch.motivo], [false, ARCHIVADO('DURO')], 'archivado');
  afirmar(/no está en el catálogo de materiales/.test(I.procesarHojaComposiciones(filas('ZZZ'))[0].motivo), 'inexistente: el mensaje de siempre');
  afirmar(/no requiere composición/.test(I.procesarHojaComposiciones(filas('LECHERO MOLIDO'))[0].motivo), 'un molido activo: "no requiere composicion" como siempre');
});

caso('Importador de Inventario inicial: un archivado se PERMITE con un aviso; un inexistente sigue rechazado', () => {
  const w = crearContextoConArchivados();
  const I = w.EVE_ADMIN_IMPORTAR;
  const fila = (m) => ({ Material: m, Etapa: 'RECEPCIÓN', Kg: 100, Fecha: '', Nota: '' });
  const arch = I.procesarFilaInventarioInicial(fila('PET CRISTAL'));
  igual(arch.valido, true, 'archivado permitido');
  afirmar(/está archivado: se importa de todos modos/.test(arch.info), 'con aviso informativo (no bloquea): ' + arch.info);
  igual(I.procesarFilaInventarioInicial(fila('LECHERO')).info, undefined, 'un activo no lleva aviso');
  const inex = I.procesarFilaInventarioInicial(fila('ZZZ'));
  igual([inex.valido, inex.motivo], [false, NO_ESTA('ZZZ')], 'inexistente rechazado');
});

// ── Inventario ──────────────────────────────────────────────────────────────

caso('Inventario: un archivado con saldo distinto de 0 sigue apareciendo en la matriz (y desaparece de las listas de alta)', () => {
  const w = crearContextoConArchivados();
  const INV = w.EVE_INVENTARIO;
  const datos = { inventarioInicial: [{ material: 'PET CRISTAL', etapa: 'SELECCIÓN', kg: 120, fecha: '2026-06-01' }, { material: 'LECHERO', etapa: 'RECEPCIÓN', kg: 50, fecha: '2026-06-01' }], registrosDestaraje: [], registrosControlProduccion: [], ventas: [] };
  const filas = INV.combinarConAjustes(INV.calcularInventarioCalculado(datos), []);
  const matriz = INV.construirMatrizInventario(filas);
  igual(matriz.map((f) => f.material).sort(), ['LECHERO', 'PET CRISTAL'], 'la matriz trae el archivado con saldo');
  igual(matriz.find((f) => f.material === 'PET CRISTAL').totalPlanta, 120, 'con su saldo');
  afirmar(!w.materialesConStock().includes('PET CRISTAL'), 'pero no se ofrece en altas');
});

caso('Inventario: el selector de ajuste ofrece los activos mas los archivados con saldo (no los archivados sin saldo)', () => {
  const w = crearContextoConArchivados();
  const filas = [{ material: 'PET CRISTAL', etapa: 'SELECCIÓN', cantidadReal: 120 }, { material: 'DURO', etapa: 'RECEPCIÓN', cantidadReal: 0 }, { material: 'TAPON', etapa: 'PRODUCTO TERMINADO', cantidadReal: -5 }];
  const ofrecidos = w.EVE_INVENTARIO.materialesParaAjuste(filas);
  afirmar(ofrecidos.includes('PET CRISTAL') && ofrecidos.includes('TAPON'), 'archivados con saldo (positivo o negativo): se pueden corregir');
  afirmar(!ofrecidos.includes('DURO'), 'archivado con saldo 0: no se ofrece');
  igual(ofrecidos.length, w.materialesConStock().length + 2, 'los activos mas esos dos');
  igual(crearContexto().EVE_INVENTARIO.materialesParaAjuste(filas), crearContexto().materialesConStock().slice().sort(), 'sin archivados: exactamente los de siempre');
});

caso('Inventario: el inventario inicial acepta un archivado (decision 7) y rechaza un inexistente', () => {
  const w = crearContextoConArchivados();
  const reg = w.EVE_INVENTARIO.construirRegistroInventarioInicial({ material: 'pet cristal', etapa: 'SELECCIÓN', kg: 10, fecha: '2026-06-01' }, []);
  igual([reg.material, reg.kg], ['PET CRISTAL', 10], 'archivado aceptado');
  let error = null;
  try { w.EVE_INVENTARIO.construirRegistroInventarioInicial({ material: 'ZZZ', etapa: 'SELECCIÓN', kg: 10, fecha: '2026-06-01' }, []); } catch (e) { error = e; }
  afirmar(error && /no está en el catálogo/.test(error.message), 'inexistente rechazado');
});

// ── Ventas, Rendimientos y Dashboard ──────────────────────────────────────────

caso('Ventas: editar una venta con un material archivado valida; un inexistente se rechaza; las ventas nuevas no lo ofrecen', () => {
  const w = crearContextoConArchivados();
  const venta = (material) => w.construirVentaDesdeFormulario({ cliente: 'C', fecha: '2026-06-10', lineas: [{ material, cantidad: 10, precioUnitario: 5 }], observaciones: '', ticketsOrigen: '' });
  igual(venta('TAPON').lineas[0].material, 'TAPON', 'el archivado se resuelve');
  let error = null;
  try { venta('ZZZ'); } catch (e) { error = e; }
  afirmar(error && /no está en el catálogo/.test(error.message), 'inexistente rechazado');
  afirmar(!w.productosVenta().includes('TAPON') && !w.PRODUCTOS_VENTA.includes('TAPON'), 'productosVenta (datalist de alta) no lo ofrece');
});

caso('Rendimientos: un subproducto y un crudo archivados siguen validando; las pendientes cuentan los tickets de un crudo archivado', () => {
  const w = crearContextoConArchivados();
  const R = w.EVE_RENDIMIENTOS;
  igual(R.validarSubproducto('PET CRISTAL', false, 'MIXTO'), 'PET CRISTAL', 'subproducto archivado (K11: no se invalida)');
  const comp = R.construirNuevaComposicion({ materialEntrada: 'DURO', fechaVigencia: '2026-08-01', motivo: '', componentes: [{ subproducto: 'P.P.', porcentaje: 60 }, { subproducto: 'P.E.', porcentaje: 35 }, { subproducto: 'BASURA', porcentaje: 5, esMerma: true }], actualizadoPor: 'p' }, null);
  igual(comp.nuevo.materialEntrada, 'DURO', 'editar la composicion de un crudo archivado no dice "no requiere composicion"');
  const pendientes = R.calcularComposicionesPendientes([{ material: 'DURO', kg: 300, fechaSalida: '2026-08-05', fechaEntrada: '2026-08-05' }], []);
  igual(pendientes.filas.map((f) => [f.material, f.kgPendientes]), [['DURO', 300]], 'el crudo archivado con tickets sin composicion sigue pendiente');
  let error = null;
  try { R.construirNuevaComposicion({ materialEntrada: 'ZZZ', fechaVigencia: '2026-08-01', componentes: [{ subproducto: 'P.P.', porcentaje: 100 }] }, null); } catch (e) { error = e; }
  afirmar(error && /no está en el catálogo/.test(error.message), 'un inexistente sigue rechazado');
});

caso('Dashboard: un material archivado con tickets sin precio sigue contando como candidato a CxP faltante', () => {
  const w = crearContextoConArchivados();
  w.EVE.registrosDestaraje = [{ material: 'PET CRISTAL', kg: 100, fechaSalida: '2026-08-05', fechaEntrada: '2026-08-05' }];
  igual(w.EVE_DASHBOARD.calcularMaterialesSinPrecioVigente().map((m) => [m.material, m.ticketsSinPrecio]), [['PET CRISTAL', 1]], 'archivado sin precio');
  w.EVE.precios = [{ id: 'p', material: 'PET CRISTAL', precio: 5, fechaInicio: '2026-01-01', fechaFin: null }];
  igual(w.EVE_DASHBOARD.calcularMaterialesSinPrecioVigente(), [], 'con precio ya no');
});

// ── Ejecucion ──────────────────────────────────────────────────────────────

let fallos = 0;
for (const { nombre, fn } of casos) {
  try {
    fn();
    console.log(`PASS  ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.log(`FAIL  ${nombre}\n      ${error.message}`);
  }
}
console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
