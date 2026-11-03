// Verifica el reporte de Ventas (TXT, PDF y CSV): desglose por línea con subtotal por folio, resumen por producto y por cliente.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const src = leer('js/ventas.js');
const srcCxc = leer('js/cxc.js');
let ok = 0, total = 0;
function afirmar(c, m) { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; }
function extraer(fuente, nombre) {
  const i = fuente.indexOf('function ' + nombre + '(');
  const j = fuente.indexOf('\n}\n', i);
  if (i < 0) throw new Error('no se encontró ' + nombre);
  return fuente.slice(i, j + 3);
}
const centavos = (n) => Math.round(n * 100);

// ── Datos: folios V-2026-051 a V-2026-058 ────────────────────────────────
const L = (material, cantidad, unidad, precioUnitario, totalLinea) => ({ material, cantidad, unidad, precioUnitario, subtotal: totalLinea, ivaTrasladado: 0, ivaRetenido: 0, totalLinea });
const crear = (n, cliente, fecha, lineas) => ({
  id: 'id' + n, folio: 'V-2026-0' + n, cliente, fecha, lineas, totalVenta: lineas.reduce((s, l) => s + l.totalLinea, 0)
});
const ventas = [
  crear(51, 'ACME', '2026-10-01', [L('PET', 10000, 'KG', 12.5, 125000), L('HDPE', 5000, 'KG', 8.04, 40200)]),
  crear(52, 'BETA', '2026-10-02', [L('PET', 8000, 'KG', 12.75, 102000)]),
  crear(53, 'ACME', '2026-10-03', [L('PP', 15000, 'KG', 7.1, 106500)]),
  crear(54, 'GAMA', '2026-10-04', [L('PET', 12000, 'KG', 12.6, 151200), L('TAPA', 2500, 'PZ', 1.2, 3000)]),
  crear(55, 'BETA', '2026-10-05', [L('HDPE', 9000, 'KG', 8.1, 72900)]),
  crear(56, 'GAMA', '2026-10-06', [L('PP', 10000, 'KG', 7.2, 72000)]),
  crear(57, 'ACME', '2026-10-07', [L('PET', 5000, 'KG', 12.4, 62000), L('HDPE', 7000, 'KG', 8, 56000)]),
  crear(58, 'BETA', '2026-10-08', [L('PP', 20000, 'KG', 7.5, 150000), L('SCRAP', 4000, 'KG', 9, 36000), L('ETIQUETA', 1, 'PZ', 960.2, 960.2)])
];
const copia = JSON.stringify(ventas);
const TOTAL_ESPERADO = 977760.20;

// ── Entorno ──────────────────────────────────────────────────────────────
const PZ = ['TAPA', 'ETIQUETA'];
const fmtNum = (n) => Number(n).toLocaleString('es-MX');
const llamadas = [];
function JsPDF() {
  const doc = {
    internal: { pageSize: { getWidth: () => 210 } },
    textos: [],
    setFontSize() {}, setFont() {},
    text(t) { doc.textos.push(t); },
    autoTable(opciones) { llamadas.push(opciones); doc.lastAutoTable = { finalY: 100 }; }
  };
  return doc;
}
const ctx = {
  window: {
    jspdf: { jsPDF: JsPDF },
    formatearFecha: (f) => f.split('-').reverse().join('/'),
    formatearMoneda: (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }),
    formatearKg: (v, m) => `${fmtNum(v)} ${PZ.includes(m) ? 'PZ' : 'KG'}`,
    obtenerFechaMexico: () => '2026-10-20'
  }
};
vm.createContext(ctx);
vm.runInContext(extraer(srcCxc, 'construirDocsCxCDesdeVenta') + '\nthis.window.EVE_CXC = { construirDocsCxCDesdeVenta };', ctx);
vm.runInContext(
  ['redondearCentavosVentas', 'compararAlfabeticoVentas', 'textoCantidadPorUnidad', 'construirReporteVentas', 'generarTXTVentas', 'generarPDFVentas', 'construirFilasCSVVentas']
    .map((n) => extraer(src, n)).join('\n') + '\nthis.f = { construirReporteVentas, generarTXTVentas, generarPDFVentas, construirFilasCSVVentas };', ctx);
const periodo = { etiquetaReporte: 'MES', etiquetaPeriodo: '1 AL 8 DE OCTUBRE DE 2026' };

// ── Cálculos ─────────────────────────────────────────────────────────────
const r = ctx.f.construirReporteVentas(ventas);
afirmar(r.grupos.length === 8, '8 folios');
r.grupos.forEach((g, i) => {
  const suma = g.lineas.reduce((s, l) => s + centavos(l.total), 0);
  afirmar(suma === centavos(ventas[i].totalVenta) && suma === centavos(g.subtotal), `${g.folio}: suma de líneas = total del folio`);
});
afirmar(centavos(r.totalVentas) === centavos(TOTAL_ESPERADO), `TOTAL VENTAS de V-2026-051 a 058 = 977760.20 (obtenido ${r.totalVentas})`);
afirmar(centavos(r.porProducto.reduce((s, p) => s + p.total, 0)) === centavos(r.totalVentas), 'suma del resumen por producto = TOTAL VENTAS');
afirmar(centavos(r.porCliente.reduce((s, c) => s + c.total, 0)) === centavos(r.totalVentas), 'suma del resumen por cliente = TOTAL VENTAS');
afirmar(r.totalKg === 10000 + 5000 + 8000 + 15000 + 12000 + 9000 + 10000 + 5000 + 7000 + 20000 + 4000, 'TOTAL KG sin sumar PZ');
afirmar(r.totalPz === 2500 + 1, 'TOTAL PZ separado de KG');
afirmar(JSON.stringify(r.porProducto.map((p) => p.producto)) === JSON.stringify(['ETIQUETA', 'HDPE', 'PET', 'PP', 'SCRAP', 'TAPA']), 'resumen por producto en orden alfabético');
afirmar(JSON.stringify(r.porCliente.map((c) => c.cliente)) === JSON.stringify(['ACME', 'BETA', 'GAMA']), 'resumen por cliente en orden alfabético');
const pet = r.porProducto.find((p) => p.producto === 'PET');
afirmar(pet.cantidad === 35000 && centavos(pet.total) === centavos(440200) && pet.precioPromedio === Math.round(440200 / 35000 * 100) / 100, 'PET: precio promedio ponderado = total / cantidad');
afirmar(r.porCliente.find((c) => c.cliente === 'ACME').numFolios === 3 && r.porCliente.find((c) => c.cliente === 'BETA').numFolios === 3, 'núm. de folios por cliente');
const gama = r.porCliente.find((c) => c.cliente === 'GAMA');
afirmar(gama.kg === 22000 && gama.pz === 2500, 'cantidad del cliente por unidad (KG y PZ separados)');

// ── TXT ──────────────────────────────────────────────────────────────────
const txt = ctx.f.generarTXTVentas(ventas, periodo);
afirmar(txt.startsWith('REPORTE DE VENTAS\nREPORTE: MES\nPERIODO: 1 AL 8 DE OCTUBRE DE 2026\nFECHA DE EMISIÓN: 20/10/2026'), 'TXT: encabezado');
afirmar(txt.includes('TOTAL VENTAS: ' + ctx.window.formatearMoneda(TOTAL_ESPERADO)) && txt.includes('TOTAL KG: ') && txt.includes('TOTAL PZ: 2' + String.fromCharCode(44) + '501') || txt.includes('TOTAL PZ: 2501'), 'TXT: totales de venta, KG y PZ');
afirmar(txt.indexOf('DESGLOSE:') < txt.indexOf('RESUMEN POR PRODUCTO:') && txt.indexOf('RESUMEN POR PRODUCTO:') < txt.indexOf('RESUMEN POR CLIENTE:'), 'TXT: orden de secciones');
afirmar((txt.match(/SUBTOTAL V-2026-0\d\d:/g) || []).length === 8, 'TXT: un subtotal por folio');
afirmar(txt.includes('V-2026-051  ACME  01/10/2026  PET  10,000 KG') , 'TXT: línea con cantidad y unidad');
afirmar((txt.match(/V-2026-051/g) || []).length === 2, 'TXT: folio solo en la primera línea (más el subtotal)');
afirmar(txt.includes('PROMEDIO PONDERADO') && txt.includes('FOLIOS: 3'), 'TXT: resúmenes');

// ── PDF ──────────────────────────────────────────────────────────────────
llamadas.length = 0;
const doc = ctx.f.generarPDFVentas(ventas, periodo);
afirmar(doc.textos.includes('REPORTE DE VENTAS') && doc.textos.some((t) => t.startsWith('FECHA DE EMISIÓN')) && doc.textos.some((t) => t.startsWith('TOTAL PZ')), 'PDF: encabezado y totales');
afirmar(llamadas.length === 3, 'PDF: tabla de desglose y dos resúmenes');
const [desglose, producto, cliente] = llamadas;
afirmar(desglose.head[0].join('|') === 'FOLIO|CLIENTE|FECHA|MATERIAL|CANTIDAD|PRECIO UNITARIO|TOTAL', 'PDF: columnas del desglose');
const lineasTotales = ventas.reduce((s, v) => s + v.lineas.length, 0);
afirmar(desglose.body.length === lineasTotales + 8, `PDF: ${lineasTotales} líneas + 8 subtotales`);
afirmar(desglose.body.filter((f) => f[0] && f[0].colSpan === 6).length === 8, 'PDF: fila de subtotal por folio');
afirmar(desglose.body[1][0] === '' && desglose.body[1][1] === '' && desglose.body[1][2] === '', 'PDF: folio, cliente y fecha solo en la primera fila');
afirmar(desglose.showHead === undefined || desglose.showHead === 'everyPage', 'PDF: encabezado de tabla repetido en cada página');
afirmar(producto.head[0].join('|') === 'PRODUCTO|CANTIDAD|PRECIO PROMEDIO PONDERADO|TOTAL' && producto.body.length === 6, 'PDF: resumen por producto');
afirmar(cliente.head[0].join('|') === 'CLIENTE|NÚM. DE FOLIOS|CANTIDAD|TOTAL' && cliente.body.length === 3, 'PDF: resumen por cliente');

// ── CSV ──────────────────────────────────────────────────────────────────
const csv = ctx.f.construirFilasCSVVentas(ventas);
const sec = (n) => csv.filter((f) => f.seccion === n);
afirmar(sec('TOTALES').length === 1 && centavos(sec('TOTALES')[0].total) === centavos(TOTAL_ESPERADO) && sec('TOTALES')[0].pz === 2501, 'CSV: totales');
afirmar(sec('DESGLOSE').length === lineasTotales && sec('SUBTOTAL').length === 8 && sec('PRODUCTO').length === 6 && sec('CLIENTE').length === 3, 'CSV: filas por sección');
afirmar(centavos(sec('SUBTOTAL').reduce((s, f) => s + f.total, 0)) === centavos(TOTAL_ESPERADO), 'CSV: suma de subtotales = TOTAL VENTAS');
afirmar(centavos(sec('DESGLOSE').reduce((s, f) => s + f.total, 0)) === centavos(TOTAL_ESPERADO), 'CSV: suma de líneas = TOTAL VENTAS');

// ── Sin ventas y sin efectos ─────────────────────────────────────────────
const vacio = ctx.f.generarTXTVentas([], periodo);
afirmar(vacio.includes('Sin ventas en el periodo.') && vacio.includes('TOTAL VENTAS: $0.00'), 'reporte vacío');
afirmar(JSON.stringify(ventas) === copia, 'ventas sin modificar');

console.log(`${ok}/${total} verificaciones correctas`);
