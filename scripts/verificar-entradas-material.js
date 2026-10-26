// Verificación del reporte "Entradas de material" (Reportes, opción visible con el permiso extra cxp_reportes).
//
// Carga en un contexto vm los js/ reales (config, utils, reportes) y comprueba que:
//  - filtra cuentas_por_pagar por fechaTicket dentro de desde/hasta (inclusive; misma fecha = un solo día) y por proveedor y material;
//  - el costo es montoMaterial + montoComision, sin IVA;
//  - ordena por fecha descendente y luego por proveedor;
//  - los totales y los resúmenes por material y por proveedor suman lo mismo que el detalle;
//  - el TXT (vista previa), el CSV y el PDF llevan título, periodo, fecha de emisión, totales y la advertencia;
//  - no escribe en Firestore.
// El PDF usa jsPDF y autoTable: aquí se simulan para revisar lo que se les pide dibujar.
//
// Uso: node scripts/verificar-entradas-material.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/reportes.js'];

function crearContexto() {
  const escrituras = [];
  const llamadasPDF = { textos: [], tablas: [] };
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { registrosDestaraje: [], registrosControlProduccion: [], ventas: [], registrosVentas: [], cuentasPorPagar: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  sandbox.window.obtenerFechaMexico = () => '2026-10-26';
  ['guardarDato', 'actualizarDato', 'eliminarDato'].forEach((n) => { sandbox.window[n] = (...args) => { escrituras.push([n, ...args]); }; });
  sandbox.window.jspdf = {
    jsPDF: function () {
      const doc = {
        internal: { pageSize: { getWidth: () => 210 } },
        setFontSize() {}, setFont() {}, setTextColor() {}, setDrawColor() {}, line() {}, addPage() {},
        text(t) { llamadasPDF.textos.push(String(t)); },
        autoTable(opciones) { llamadasPDF.tablas.push(opciones); doc.lastAutoTable = { finalY: 100 }; }
      };
      return doc;
    }
  };
  sandbox.window.__escrituras = escrituras;
  sandbox.window.__pdf = llamadasPDF;
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

const PERIODO = { desde: '2026-10-01', hasta: '2026-10-31', etiquetaReporte: 'MES', etiquetaPeriodo: '1 AL 31 DE OCTUBRE DE 2026' };

function cuenta(ticket, proveedor, fechaTicket, material, kg, montoMaterial, montoComision, iva) {
  return { id: `c${ticket}`, ticket, proveedor, fechaTicket, material, kg, montoMaterial, montoComision, iva: iva || 0, total: montoMaterial + montoComision + (iva || 0) };
}

const CUENTAS = [
  cuenta('101', 'JESÚS', '2026-10-05', 'PET CRISTAL', 1000, 8000, 500, 1360),
  cuenta('102', 'ANA', '2026-10-05', 'PET CRISTAL', 500, 4000, 250),
  cuenta('103', 'JESÚS', '2026-10-20', 'CARTÓN', 2000, 3000, 0),
  cuenta('104', 'ANA', '2026-09-30', 'CARTÓN', 700, 1000, 0),
  cuenta('105', 'ANA', '2026-11-01', 'CARTÓN', 700, 1000, 0)
];

caso('el costo es montoMaterial + montoComision y no incluye el IVA', () => {
  const w = crearContexto();
  const filas = w.filtrarEntradasMaterial(CUENTAS, { desde: '2026-10-05', hasta: '2026-10-05' });
  const jesus = filas.find((f) => f.ticket === '101');
  igual(jesus.costo, 8500, 'costo del ticket 101 (el IVA de 1360 no cuenta)');
});

caso('filtra por rango inclusive y deja fuera lo anterior y lo posterior', () => {
  const w = crearContexto();
  const filas = w.filtrarEntradasMaterial(CUENTAS, PERIODO);
  igual(filas.map((f) => f.ticket).sort(), ['101', '102', '103'], 'tickets dentro de octubre');
});

caso('desde = hasta es un solo día', () => {
  const w = crearContexto();
  const filas = w.filtrarEntradasMaterial(CUENTAS, { desde: '2026-10-20', hasta: '2026-10-20' });
  igual(filas.map((f) => f.ticket), ['103'], 'solo el ticket del 20');
});

caso('ordena por fecha descendente y luego por proveedor', () => {
  const w = crearContexto();
  const filas = w.filtrarEntradasMaterial(CUENTAS, PERIODO);
  igual(filas.map((f) => f.ticket), ['103', '102', '101'], 'orden 20/10 JESÚS, 05/10 ANA, 05/10 JESÚS');
});

caso('filtra por proveedor y por material (material normalizado)', () => {
  const w = crearContexto();
  igual(w.filtrarEntradasMaterial(CUENTAS, { ...PERIODO, proveedor: 'ANA' }).map((f) => f.ticket), ['102'], 'proveedor ANA');
  igual(w.filtrarEntradasMaterial(CUENTAS, { ...PERIODO, material: 'CARTÓN' }).map((f) => f.ticket), ['103'], 'material CARTÓN');
});

caso('totales y resúmenes coinciden con el detalle', () => {
  const w = crearContexto();
  const resumen = w.resumirEntradasMaterial(w.filtrarEntradasMaterial(CUENTAS, PERIODO));
  igual(resumen.totalKg, 3500, 'kg totales');
  igual(resumen.totalCosto, 15750, 'costo total');
  igual(resumen.porMaterial.map((m) => [m.nombre, m.kg, m.costo]), [['CARTÓN', 2000, 3000], ['PET CRISTAL', 1500, 12750]], 'por material');
  igual(resumen.porProveedor.map((p) => [p.nombre, p.kg, p.costo]), [['ANA', 500, 4250], ['JESÚS', 3000, 11500]], 'por proveedor');
});

caso('el TXT trae título, periodo, emisión, totales, detalle, resúmenes y advertencia', () => {
  const w = crearContexto();
  const txt = w.generarTXTEntradasMaterial(w.filtrarEntradasMaterial(CUENTAS, PERIODO), PERIODO);
  ['ENTRADAS DE MATERIAL', 'PERIODO: 1 AL 31 DE OCTUBRE DE 2026', 'FECHA DE EMISIÓN: 26/10/2026', 'TOTAL KG: 3,500', 'TOTAL COSTO:',
    '  TICKET  PROVEEDOR  FECHA  MATERIAL  KG  COSTO', 'RESUMEN POR MATERIAL:', 'RESUMEN POR PROVEEDOR:',
    'solo aparecen tickets con cuenta por pagar generada'].forEach((t) => afirmar(txt.includes(t), `falta "${t}" en el TXT`));
});

caso('el CSV trae una fila por ticket con ticket, proveedor, fecha, material, kg y costo', () => {
  const w = crearContexto();
  const filas = w.construirFilasCSVEntradasMaterial(w.filtrarEntradasMaterial(CUENTAS, PERIODO));
  igual(Object.keys(filas[0]), ['ticket', 'proveedor', 'fechaTicket', 'material', 'kg', 'costo'], 'columnas');
  igual(filas.length, 3, 'filas');
});

caso('el PDF usa encabezado azul marino, columnas TICKET/PROVEEDOR/FECHA/MATERIAL/KG/COSTO y los dos resúmenes', () => {
  const w = crearContexto();
  const doc = w.generarPDFEntradasMaterial(w.filtrarEntradasMaterial(CUENTAS, PERIODO), PERIODO);
  afirmar(doc && typeof doc.autoTable === 'function', 'debe devolver el doc de jsPDF');
  const pdf = w.__pdf;
  afirmar(pdf.textos.includes('ENTRADAS DE MATERIAL'), 'falta el título');
  afirmar(pdf.textos.some((t) => t.includes('solo aparecen tickets con cuenta por pagar generada')), 'falta la advertencia');
  igual(pdf.tablas[0].head, [['TICKET', 'PROVEEDOR', 'FECHA', 'MATERIAL', 'KG', 'COSTO']], 'cabecera del detalle');
  igual(pdf.tablas[0].headStyles.fillColor, [0, 29, 61], 'color del encabezado');
  igual(pdf.tablas.length, 3, 'detalle + resumen por material + resumen por proveedor');
});

caso('no escribe en Firestore', () => {
  const w = crearContexto();
  const filas = w.filtrarEntradasMaterial(CUENTAS, PERIODO);
  w.generarTXTEntradasMaterial(filas, PERIODO);
  w.generarPDFEntradasMaterial(filas, PERIODO);
  w.construirFilasCSVEntradasMaterial(filas);
  igual(w.__escrituras, [], 'escrituras');
});

caso('sin renglones el reporte sigue generándose con totales en cero', () => {
  const w = crearContexto();
  const txt = w.generarTXTEntradasMaterial([], PERIODO);
  afirmar(txt.includes('TOTAL KG: 0'), 'total en cero');
  afirmar(txt.includes('Sin entradas en el periodo'), 'aviso de vacío');
});

let fallos = 0;
for (const { nombre, fn } of casos) {
  try {
    fn();
    console.log(`OK   ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.log(`FALLA ${nombre}\n     ${error.message}`);
  }
}
console.log(`\n${casos.length - fallos} de ${casos.length} casos pasan.`);
process.exit(fallos ? 1 : 0);
