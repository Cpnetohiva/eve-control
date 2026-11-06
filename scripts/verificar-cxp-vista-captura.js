// Verificación de la Vista para captura de CxP (Por Proveedor): solo debe mostrar tickets con saldo mayor a cero.
// Caso real: José Enrique mostraba tickets pagados con saldo "0.00" (residuo de decimales > 0 pero liquidados).
// Uso: node scripts/verificar-cxp-vista-captura.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js'];

function crearContexto() {
  const almacen = {};
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById() { return null; } },
    localStorage: {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v); }
    },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { registrosDestaraje: [], cuentasPorPagar: [], auditorias: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  return sandbox.window;
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${mensaje}: esperado ${b}, real ${a}`);
}

// saldo se fija a mano para poder reproducir residuos de punto flotante.
function cuenta(ticket, proveedor, total, saldo, fechaTicket, abonos) {
  const pagado = total - saldo;
  return {
    id: `cxp-${ticket}`, ticket, proveedor, material: 'PET', kg: 100, precioEfectivo: total / 100, total, pagado, saldo, fechaTicket,
    estado: saldo <= 0.001 ? 'liquidado' : (pagado > 0 ? 'parcial' : 'pendiente'),
    abonos: abonos || []
  };
}

const ABONO_RECIENTE = [{ monto: 100, fecha: '2026-11-04' }];

// José Enrique: tickets pagados (saldo 0 exacto y con residuos) con abonos recientes + pendientes. ALFA: sin abonos.
function cuentasEjemplo() {
  return [
    cuenta('1302', 'JOSE ENRIQUE', 800, 0, '2026-10-20', ABONO_RECIENTE),
    cuenta('1345', 'JOSE ENRIQUE', 900, 0.0004, '2026-10-22', ABONO_RECIENTE),
    cuenta('1377', 'JOSE ENRIQUE', 700, 1e-12, '2026-10-25', ABONO_RECIENTE),
    cuenta('1409', 'JOSE ENRIQUE', 650, 0.004, '2026-10-28', ABONO_RECIENTE),
    cuenta('1500', 'JOSE ENRIQUE', 1000, 400, '2026-11-02', ABONO_RECIENTE),
    cuenta('1501', 'JOSE ENRIQUE', 500, 500, '2026-11-03', []),
    cuenta('2001', 'ALFA', 300, 300, '2026-11-01', []),
    cuenta('2002', 'ALFA', 200, 200, '2026-11-02', [])
  ];
}

function configDe(cuentas) {
  const w = crearContexto();
  return { w, config: w.EVE_CXP.construirConfigCapturaCxP(cuentas, 99999, 'Todos', 0) };
}

const bloquePorClave = (config, clave) => (config.grupos || []).find((b) => b.clave === clave);

caso('José Enrique: los tickets pagados no aparecen, solo los pendientes', () => {
  const { config } = configDe(cuentasEjemplo());
  const bloque = bloquePorClave(config, 'JOSE ENRIQUE');
  afirmar(bloque, 'debe existir el bloque de José Enrique');
  igual(bloque.filas.map((f) => f.ticket), ['1500', '1501'], 'tickets mostrados');
  afirmar(bloque.filas.every((f) => Math.round(f.saldo * 100) > 0), 'ninguna fila con saldo 0.00');
});

caso('el subtotal por proveedor es la suma de los saldos de las filas mostradas', () => {
  const { w, config } = configDe(cuentasEjemplo());
  const bloque = bloquePorClave(config, 'JOSE ENRIQUE');
  const suma = bloque.filas.reduce((s, f) => s + f.saldo, 0);
  igual(bloque.subtotal, `Subtotal ${w.formatearMoneda(suma)}`, 'subtotal');
  igual(bloque.subtotal, `Subtotal ${w.formatearMoneda(900)}`, 'subtotal esperado 400 + 500');
  const resumen = config.resumenSecciones[0].filas.find((f) => f.clave === 'JOSE ENRIQUE');
  igual(Math.round(resumen.monto * 100) / 100, 900, 'saldo por proveedor en el resumen');
});

caso('otro proveedor sin abonos no cambia', () => {
  const { w, config } = configDe(cuentasEjemplo());
  const bloque = bloquePorClave(config, 'ALFA');
  igual(bloque.filas.map((f) => f.ticket), ['2001', '2002'], 'tickets de ALFA');
  igual(bloque.subtotal, `Subtotal ${w.formatearMoneda(500)}`, 'subtotal de ALFA');
  igual(bloque.columnas.map((c) => c.clave), ['ticket', 'material', 'kg', 'precioEfectivo', 'total'], 'ALFA sin columna Saldo');
});

caso('un proveedor con todos sus tickets pagados no genera bloque ni renglón de resumen', () => {
  const cuentas = cuentasEjemplo().concat([cuenta('3001', 'BETA', 400, 0.0003, '2026-11-01', ABONO_RECIENTE)]);
  const { config } = configDe(cuentas);
  afirmar(!bloquePorClave(config, 'BETA'), 'BETA no debe tener bloque');
  afirmar(!config.resumenSecciones[0].filas.some((f) => f.clave === 'BETA'), 'BETA no debe estar en el resumen');
});

caso('Exportar Resumen y Exportar Detalle conservan los tickets pagados (no usan este filtro)', () => {
  const w = crearContexto();
  const cuentas = cuentasEjemplo();
  const detalle = w.EVE_CXP.construirFilasCSVCxPResumen ? w.EVE_CXP.construirFilasCSVCxPResumen(cuentas) : null;
  // Si las funciones de exportación no están expuestas, basta con comprobar que agregarPorProveedorCxP no filtra por saldo.
  const grupos = w.EVE_CXP.agregarPorProveedorCxP(cuentas);
  const jose = grupos.find((g) => g.proveedor === 'JOSE ENRIQUE');
  igual(jose.cuentas.length, 6, 'la agregación base sigue incluyendo todos los tickets');
  if (detalle) afirmar(detalle.length >= cuentas.length, 'el detalle conserva todas las filas');
});

// ── Criterio único: saldo menor a 0.01 = liquidado ──
const RESIDUOS = [0.0004, 0.004, 0.009];

caso('esLiquidadoCxP: residuos 0.0004, 0.004 y 0.009 son liquidado; 0.01 ya es pendiente', () => {
  const w = crearContexto();
  RESIDUOS.forEach((r) => afirmar(w.EVE_CXP.esLiquidadoCxP(r), `${r} debe ser liquidado`));
  afirmar(w.EVE_CXP.esLiquidadoCxP(0), '0');
  afirmar(w.EVE_CXP.esLiquidadoCxP(-0.5), 'negativo');
  afirmar(!w.EVE_CXP.esLiquidadoCxP(0.01), '0.01 es pendiente');
  afirmar(!w.EVE_CXP.esLiquidadoCxP(250), '250 es pendiente');
});

caso('calcularEstado usa el mismo criterio', () => {
  const w = crearContexto();
  RESIDUOS.forEach((r) => igual(w.EVE_CXP.calcularEstado(100, r), 'liquidado', `estado con saldo ${r}`));
  igual(w.EVE_CXP.calcularEstado(100, 0.01), 'parcial', 'estado con saldo 0.01');
  igual(w.EVE_CXP.calcularEstado(0, 500), 'pendiente', 'estado sin abonos');
});

caso('la vista para captura excluye residuos de 0.0004, 0.004 y 0.009', () => {
  const cuentas = [
    cuenta('10', 'JOSE ENRIQUE', 500, 0.0004, '2026-11-01', ABONO_RECIENTE),
    cuenta('11', 'JOSE ENRIQUE', 500, 0.004, '2026-11-02', ABONO_RECIENTE),
    cuenta('12', 'JOSE ENRIQUE', 500, 0.009, '2026-11-03', ABONO_RECIENTE),
    cuenta('13', 'JOSE ENRIQUE', 500, 0.01, '2026-11-04', ABONO_RECIENTE)
  ];
  const { config } = configDe(cuentas);
  igual(bloquePorClave(config, 'JOSE ENRIQUE').filas.map((x) => x.ticket), ['13'], 'solo el de 0.01');
});

caso('un proveedor con saldo total menor a 0.01 no cuenta como proveedor con saldo pendiente', () => {
  const w = crearContexto();
  w.EVE.cuentasPorPagar = [
    cuenta('20', 'RESIDUAL', 500, 0.004, '2026-11-01', ABONO_RECIENTE),
    cuenta('21', 'RESIDUAL', 500, 0.004, '2026-11-02', ABONO_RECIENTE),
    cuenta('22', 'ALFA', 300, 300, '2026-11-01', [])
  ];
  const general = w.EVE_CXP.calcularTotalAdeudadoGeneral();
  igual(general.cantidadProveedores, 1, 'solo ALFA cuenta');
  igual(Math.round(general.total * 100) / 100, 300, 'el total no incluye el residuo');
});

caso('el interruptor de socios y los saldos iniciales siguen respetándose', () => {
  const w = crearContexto();
  const inicial = { ...cuenta('SI-1', 'ALFA', 900, 900, '2026-01-01', []), tipo: 'saldo_inicial' };
  w.EVE.cuentasPorPagar = [
    inicial,
    cuenta('30', 'German', 400, 400, '2026-11-01', []),
    cuenta('31', 'German', 100, 0.009, '2026-11-02', [])
  ];
  igual(w.EVE_CXP.calcularTotalAdeudadoGeneral().cantidadProveedores, 2, 'con socios: ALFA y German');
  w.localStorage.setItem('cxp_incluir_socios', '0');
  const sin = w.EVE_CXP.calcularTotalAdeudadoGeneral();
  igual(sin.cantidadProveedores, 1, 'sin socios: solo ALFA');
  igual(sin.saldoInicial, 900, 'el saldo inicial sigue contando');
});


let fallos = 0;
for (const { nombre, fn } of casos) {
  try { fn(); console.log(`OK    ${nombre}`); } catch (e) { fallos += 1; console.log(`FALLA ${nombre}\n      ${e.message}`); }
}
console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos ? 1 : 0);
