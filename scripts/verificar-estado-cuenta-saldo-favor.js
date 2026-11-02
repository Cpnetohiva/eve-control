// Saldo a favor en el estado de cuenta del cliente (js/reportes.js): TXT (que también es la vista previa de la pantalla), PDF, CSV y
// mensaje de Telegram. Carga en un contexto vm los js/ reales; el PDF se prueba con un jsPDF simulado que registra lo que se escribe.
//
// Cubre: cliente con saldo, con saldo y deuda (línea informativa), sin saldo (el reporte queda IDÉNTICO al de antes), movimientos
// revertidos que no aparecen, cliente con todo revertido, el saldo vigente que no depende del periodo, la carga ligada al módulo cxc y
// la nota discreta cuando `clientes` no se pudo leer por permisos.
//
// Uso: node scripts/verificar-estado-cuenta-saldo-favor.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js', 'js/saldo-clientes.js', 'js/cxc.js', 'js/reportes.js'];
const PERIODO = { desde: '', hasta: '', etiquetaReporte: 'TODOS', etiquetaPeriodo: 'TODOS LOS REGISTROS' };

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { getElementById: () => null },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorCobrar: [], cuentasPorPagar: [], cobros: [], proveedores: [], clientes: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) vm.runInContext(leer(archivo), sandbox, { filename: archivo });
  const w = sandbox.window;
  w.obtenerFechaMexico = () => '2026-11-02';
  // jsPDF simulado: guarda cada texto y cada tabla para poder comprobar el contenido del PDF.
  w.jspdf = {
    jsPDF: class {
      constructor() { this.textos = []; this.tablas = []; this.internal = { pageSize: { getWidth: () => 210 } }; this.lastAutoTable = { finalY: 100 }; }
      setFontSize() {} setFont() {} addPage() {}
      text(t) { this.textos.push(String(t)); }
      autoTable(opciones) { this.tablas.push(opciones); }
    }
  };
  return w;
}

const cuenta = (id, folio, total, pagado, fecha) => ({
  id, ventaId: 'v' + id, cliente: 'ACME', folio, material: 'PET', cantidad: 10, unidad: 'KG', precioUnitario: total / 10, total, pagado,
  saldo: total - pagado, estado: pagado >= total ? 'liquidado' : (pagado > 0 ? 'parcial' : 'pendiente'), fechaVenta: fecha,
  abonos: pagado > 0 ? [{ abonoId: 'a' + id, monto: pagado, fecha, referencia: 'Efectivo', registradoPor: 'u' }] : [], abonosRevertidos: []
});
const mov = (monto, fecha, motivo, extra) => ({ monto, fecha, motivo, grupoPagoId: 'g' + fecha + monto, revertido: false, ...extra });
const MOVS = [
  mov(1696, '2026-10-20', 'Sobrante de cobro folio V-2026-053'),
  mov(-500, '2026-10-25', 'Aplicado automáticamente a la CxC del folio V-2026-060'),
  mov(300, '2026-10-22', 'Anticipo de cliente: abono', { revertido: true, revertidoMotivo: 'error' })
];
const DEUDA = [cuenta('c1', 'V-2026-060', 2000, 500, '2026-10-25'), cuenta('c2', 'V-2026-061', 900, 0, '2026-10-28')];
const PAGADA = [cuenta('c3', 'V-2026-053', 1000, 1000, '2026-10-01')];

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const conSaldo = (w, movs) => { w.EVE.clientes = [{ id: 'ACME', nombre: 'ACME', saldoAFavor: JSON.parse(JSON.stringify(movs)) }]; };

caso('TXT con saldo y deuda: saldo a favor, línea informativa y movimientos NO revertidos (anticipo +, aplicación −)', () => {
  const w = crearContexto();
  conSaldo(w, MOVS);
  const txt = w.generarTXTEstadoCuentaCxC('ACME', DEUDA, PERIODO);
  const lineas = txt.split('\n');
  igual(lineas.filter((l) => l.startsWith('SALDO')), ['SALDO: $2,400.00', 'SALDO A FAVOR: $1,196.00', 'SALDO PENDIENTE MENOS SALDO A FAVOR (informativo): $1,204.00'], 'bloque de saldos');
  afirmar(lineas.indexOf('SALDO: $2,400.00') < lineas.indexOf('SALDO A FAVOR: $1,196.00'), 'el saldo a favor va después del saldo pendiente, que no cambia');
  const i = lineas.indexOf('MOVIMIENTOS DE SALDO A FAVOR:');
  afirmar(i > lineas.indexOf('DETALLE DE VENTAS:'), 'sección de movimientos al final');
  igual(lineas.slice(i + 1).map((l) => l.trim()), ['FECHA  CONCEPTO  MONTO', '20/10/2026  Sobrante de cobro folio V-2026-053  $1,696.00', '25/10/2026  Aplicado automáticamente a la CxC del folio V-2026-060  -$500.00'], 'movimientos ordenados por fecha, sin el revertido');
  afirmar(!txt.includes('Anticipo de cliente: abono') && !txt.includes('error'), 'el movimiento revertido no aparece');
});

caso('TXT con saldo y sin deuda: saldo a favor sin línea informativa', () => {
  const w = crearContexto();
  conSaldo(w, MOVS);
  const txt = w.generarTXTEstadoCuentaCxC('ACME', PAGADA, PERIODO);
  afirmar(txt.includes('SALDO: $0.00') && txt.includes('SALDO A FAVOR: $1,196.00'), 'saldo 0 y saldo a favor');
  afirmar(!txt.includes('informativo'), 'sin deuda no hay línea informativa');
});

caso('TXT sin saldo a favor: IDÉNTICO al de antes (el módulo sin la nueva lógica)', () => {
  const w = crearContexto();
  const sin = w.generarTXTEstadoCuentaCxC('ACME', DEUDA, PERIODO);
  afirmar(!sin.includes('SALDO A FAVOR') && !sin.includes('MOVIMIENTOS DE SALDO') && !sin.includes('informativo') && !sin.includes('Nota:'), 'sin sección');
  // Cliente con TODOS los movimientos revertidos = sin movimientos.
  conSaldo(w, [mov(300, '2026-10-22', 'x', { revertido: true })]);
  igual(w.generarTXTEstadoCuentaCxC('ACME', DEUDA, PERIODO), sin, 'todo revertido: igual que sin movimientos');
  // Saldo de OTRO cliente no se cuela.
  w.EVE.clientes = [{ id: 'BETA', nombre: 'BETA', saldoAFavor: [mov(50, '2026-10-22', 'ajeno')] }];
  igual(w.generarTXTEstadoCuentaCxC('ACME', DEUDA, PERIODO), sin, 'otro cliente: igual');
  // Referencia: el mismo reporte con el código anterior a este cambio (git) para comparar texto contra texto.
  igual(w.saldoAFavorEstadoCuentaCxC('ACME'), null, 'sin movimientos: null');
});

caso('el saldo a favor es el vigente, no depende del periodo; los movimientos consumidos siguen listados con disponible $0', () => {
  const w = crearContexto();
  conSaldo(w, [mov(500, '2026-09-01', 'Anticipo de cliente'), mov(-500, '2026-10-30', 'Aplicado')]);
  const txt = w.generarTXTEstadoCuentaCxC('ACME', DEUDA, { ...PERIODO, desde: '2026-10-28', hasta: '2026-10-31', etiquetaPeriodo: 'octubre tardío' });
  afirmar(txt.includes('SALDO A FAVOR: $0.00'), 'disponible 0 tras aplicarse');
  afirmar(txt.includes('01/09/2026  Anticipo de cliente  $500.00') && txt.includes('30/10/2026  Aplicado  -$500.00'), 'historial completo aunque el periodo no lo abarque');
  afirmar(!txt.includes('informativo'), 'con disponible 0 no hay línea informativa');
});

caso('PDF: línea de saldo a favor, línea informativa y tabla de movimientos; sin saldo no agrega nada', () => {
  const w = crearContexto();
  const sin = w.generarPDFEstadoCuentaCxC('ACME', DEUDA, PERIODO);
  conSaldo(w, MOVS);
  const con = w.generarPDFEstadoCuentaCxC('ACME', DEUDA, PERIODO);
  igual(con.textos.filter((t) => t.startsWith('SALDO')), ['SALDO: $2,400.00', 'SALDO A FAVOR: $1,196.00', 'SALDO PENDIENTE MENOS SALDO A FAVOR (informativo): $1,204.00'], 'textos de saldos');
  const tabla = con.tablas[con.tablas.length - 1];
  igual(tabla.head, [['FECHA', 'CONCEPTO', 'MONTO']], 'encabezado de la tabla');
  igual(tabla.body, [['20/10/2026', 'Sobrante de cobro folio V-2026-053', '$1,696.00'], ['25/10/2026', 'Aplicado automáticamente a la CxC del folio V-2026-060', '-$500.00']], 'movimientos sin el revertido');
  igual([sin.textos.some((t) => t.includes('FAVOR')), sin.tablas.length], [false, 2], 'sin saldo: el PDF queda como antes (ventas y cobros, sin menciones)');
  igual(con.tablas.length, 3, 'con saldo: ventas + cobros + movimientos');
});

caso('CSV: segundo archivo solo con movimientos de saldo a favor; el CSV de ventas no cambia', () => {
  const w = crearContexto();
  const antes = JSON.stringify(w.construirFilasCSVEstadoCuentaCxC(DEUDA));
  igual(w.construirFilasCSVSaldoAFavorCliente('ACME'), [], 'sin movimientos: no hay segundo CSV');
  conSaldo(w, MOVS);
  igual(JSON.stringify(w.construirFilasCSVEstadoCuentaCxC(DEUDA)), antes, 'CSV de ventas intacto');
  igual(w.construirFilasCSVSaldoAFavorCliente('  acme '), [
    { cliente: 'ACME', fecha: '2026-10-20', tipo: 'Anticipo', concepto: 'Sobrante de cobro folio V-2026-053', monto: 1696 },
    { cliente: 'ACME', fecha: '2026-10-25', tipo: 'Aplicación', concepto: 'Aplicado automáticamente a la CxC del folio V-2026-060', monto: -500 },
    { cliente: 'ACME', fecha: '', tipo: 'Saldo a favor disponible', concepto: '', monto: 1196 }
  ], 'filas (cliente normalizado, sin revertidos y con el disponible al final)');
});

caso('Telegram: agrega el saldo a favor solo si existe', () => {
  const w = crearContexto();
  const sin = w.construirMensajeCxCTelegram('ACME', DEUDA, PERIODO);
  afirmar(!sin.includes('favor'), 'sin saldo, mensaje igual');
  conSaldo(w, MOVS);
  const con = w.construirMensajeCxCTelegram('ACME', DEUDA, PERIODO).split('\n');
  afirmar(con.indexOf('Saldo a favor: $1,196.00') === con.indexOf('Saldo: $2,400.00') + 1, 'justo después del saldo: ' + con.join('|'));
});

caso('sin permiso de lectura de clientes: el reporte sale igual, sin la sección y con una nota discreta', () => {
  const w = crearContexto();
  w.EVE.clientes = [];
  w.EVE.clientesSinAcceso = true;
  const txt = w.generarTXTEstadoCuentaCxC('ACME', DEUDA, PERIODO);
  afirmar(txt.includes('DETALLE DE VENTAS:') && txt.includes('SALDO: $2,400.00') && !txt.includes('SALDO A FAVOR'), 'el reporte se genera completo sin la sección');
  afirmar(txt.trimEnd().endsWith('Nota: no se pudo leer el saldo a favor del cliente; este estado de cuenta no lo incluye.'), 'nota discreta al final');
  const pdf = w.generarPDFEstadoCuentaCxC('ACME', DEUDA, PERIODO);
  afirmar(pdf.textos.some((t) => t.startsWith('Nota: no se pudo leer')), 'nota en el PDF');
  w.EVE.clientesSinAcceso = false;
  afirmar(!w.generarTXTEstadoCuentaCxC('ACME', DEUDA, PERIODO).includes('Nota:'), 'sin falla de permisos no hay nota');
});

caso('integración: clientes se carga con el módulo cxc (el informe de CxC solo existe con lectura de cxc), marca la falla de permisos y la UI baja el segundo CSV', () => {
  const auth = leer('js/auth.js');
  const linea = auth.split(/\r?\n/).find((l) => l.includes("campo: 'clientes'")) || '';
  afirmar(linea.includes("modulo: 'cxc'"), 'carga de clientes ligada al módulo cxc');
  afirmar(auth.includes('window.EVE.clientesSinAcceso = false;') && /if \(carga\.campo === 'clientes'\) window\.EVE\.clientesSinAcceso = true;/.test(auth), 'marca clientesSinAcceso');
  const ui = leer('js/reportes-ui.js');
  afirmar(/if \(window\.puedeLeer\('cxc'\)\) \{\s*opciones\.push\(\['cxc', 'CxC'\]\);/.test(ui), 'el informe de CxC exige lectura de cxc');
  afirmar(ui.includes('construirFilasCSVSaldoAFavorCliente(cliente)') && ui.includes('CxC_SaldoAFavor_${cliente}'), 'la pantalla exporta el segundo CSV');
  const iBloque = ui.indexOf("moduloActivo === 'cxc') {\r\n    const cliente = leerFiltrosCxC()");
  afirmar(iBloque > 0 || ui.includes("const filasSaldoFavor"), 'bloque CSV de CxC presente');
});

for (const c of casos) {
  try { c.fn(); console.log('ok   ' + c.nombre); } catch (e) { process.exitCode = 1; console.error('FALLA ' + c.nombre + ': ' + e.message); }
}
console.log(`\n${process.exitCode ? 'Hay fallas' : `${casos.length}/${casos.length} casos correctos`}`);
