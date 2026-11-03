// El reporte de Ventas es una función compartida (js/reportes.js): el módulo Ventas y Finanzas > Reportes > Ventas deben producir
// EXACTAMENTE el mismo contenido (TXT, PDF y CSV) para el mismo periodo.
//
// Parte 1 (navegador, Playwright): se renderizan las dos pantallas con los js/ reales, se pulsan sus botones TXT / PDF / CSV en cada
// periodo y se comparan el texto, las llamadas al PDF (texto y tablas) y las filas del CSV. También se comprueba que Reportes
// ofrece la opción «Ventas» y que respeta el permiso de lectura.
// Parte 2 (estática): los botones de ambas pantallas llaman a las mismas funciones y el reporte ya no vive en ventas.js.
//
// Los datos no incluyen ventas con fecha futura: en Esta Semana y Este Mes la tabla de Ventas no tiene tope superior (se conserva así),
// mientras que Reportes llega hasta hoy.
//
// Uso: node scripts/verificar-reporte-ventas-compartido.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8').replace(/\r\n/g, '\n');
const HOY = '2026-11-04'; // miércoles; la semana arranca el lunes 2
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };

const L = (material, cantidad, unidad, precioUnitario) => {
  const t = Math.round(cantidad * precioUnitario * 100) / 100;
  return { material, cantidad, unidad, precioUnitario, subtotal: t, ivaTrasladado: 0, ivaRetenido: 0, totalLinea: t };
};
const V = (n, cliente, fecha, lineas) => ({ id: 'v' + n, folio: 'V-2026-' + String(n).padStart(3, '0'), cliente, fecha, lineas, totalVenta: Math.round(lineas.reduce((s, l) => s + l.totalLinea, 0) * 100) / 100 });
const VENTAS = [
  V(1, 'ACME', HOY, [L('PET', 1000, 'KG', 12.5), L('TAPA', 300, 'PZ', 1.2)]),
  V(2, 'BETA', HOY, [L('HDPE', 500, 'KG', 8.04)]),
  V(3, 'ACME', '2026-11-03', [L('PP', 2000, 'KG', 7.1)]),
  V(4, 'GAMA', '2026-11-01', [L('PET', 800, 'KG', 12.75), L('PP', 100, 'KG', 7)]),
  V(5, 'BETA', '2026-10-20', [L('PET', 400, 'KG', 12)]),
  V(6, 'ACME', '2026-09-01', [L('HDPE', 250, 'KG', 8)])
];
const copia = JSON.stringify(VENTAS);

const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/vista-captura.js', 'js/reportes.js', 'js/cxc.js', 'js/ventas.js', 'js/reportes-ui.js'];

async function montar(browser, modulo, puedeLeerVentas) {
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ ventas, hoy, leerVentas }) => {
    window.obtenerFechaMexico = () => hoy;
    window.puedeEscribir = () => false;
    window.puedeLeer = (m) => (m === 'ventas' ? leerVentas : true);
    window.tienePermisoExtra = () => false;
    window.showError = (e) => { (window.__errores = window.__errores || []).push(e); };
    window.showSuccess = () => {};
    window.EVE_HISTORIAL = { registrar: () => {} };
    window.EVE = {
      currentUser: { username: 'prueba', permisosResueltos: { ventas: 'escritura', reportes: 'escritura' } },
      ventas, registrosVentas: [], registrosDestaraje: [], registrosPagos: [], registrosControlProduccion: [], precios: [], composiciones: [],
      recibosPendientes: [], auditorias: [], proveedores: [], clientes: [], cuentasPorPagar: [], cuentasPorCobrar: [], cobros: [], gastos: [],
      flujoMovimientos: [], inventario: [], inventarioInicial: [], metaPiezasDia: {}
    };
    // Capturas: archivo de texto, CSV y PDF (jsPDF falso que registra lo que se dibuja)
    window.__sal = { txt: null, csv: null, pdf: null };
    window.descargarArchivo = (blob, nombre) => blob.text().then((t) => { window.__sal.txt = { texto: t, nombre }; });
    window.exportarCSV = (filas, nombre) => { window.__sal.csv = { filas, nombre }; };
    window.jspdf = {
      jsPDF: function () {
        const reg = [];
        const doc = {
          internal: { pageSize: { getWidth: () => 210 } },
          setFontSize() {}, setFont() {},
          text(t) { reg.push(['text', t]); },
          autoTable(o) { reg.push(['tabla', JSON.parse(JSON.stringify(o))]); doc.lastAutoTable = { finalY: 100 }; },
          save(nombre) { window.__sal.pdf = { reg, nombre }; }
        };
        return doc;
      }
    };
  }, { ventas: VENTAS, hoy: HOY, leerVentas: puedeLeerVentas });
  await page.evaluate((id) => window.EVE_MODULES[id].render(document.getElementById('main-content')), modulo);
  page.erroresPagina = errores;
  return page;
}

// Pulsa TXT / PDF / CSV de la pantalla y devuelve lo exportado
async function exportar(page, contenedorBotones) {
  const salida = {};
  for (const formato of ['TXT', 'PDF', 'CSV']) {
    await page.evaluate(() => { window.__sal = { txt: null, csv: null, pdf: null }; });
    await page.locator(`${contenedorBotones} button`, { hasText: new RegExp('^' + formato + '$') }).first().click();
    await page.waitForTimeout(50);
    salida[formato] = await page.evaluate(() => window.__sal);
  }
  return salida;
}

(async () => {
  const browser = await chromium.launch();
  try {
    const periodos = [
      ['Hoy', 'Hoy'], ['Esta Semana', 'Esta Semana'], ['Este Mes', 'Este Mes'], ['Últimos 30 días', 'Últimos 30 días'], ['Todas', 'Personalizado']
    ];
    const vent = await montar(browser, 'ventas', true);
    const rep = await montar(browser, 'reportes', true);

    // Reportes ofrece «Ventas» (con permiso) y la selecciona
    const opciones = await rep.$$eval('#ru-modulo option', (os) => os.map((o) => o.textContent.trim()));
    afirmar(opciones.includes('Ventas'), 'Reportes: el selector trae «Ventas» (' + opciones.join(' | ') + ')');
    await rep.selectOption('#ru-modulo', 'ventas');
    afirmar(await rep.$('#ruf-ven-cliente') !== null && await rep.$('#ruf-ven-material') !== null, 'Reportes: filtros de cliente y material');

    for (const [tabVentas, tabReportes] of periodos) {
      await vent.locator('.destaraje-subtabs .tab', { hasText: new RegExp('^' + tabVentas + '$') }).click();
      await rep.locator('.destaraje-subtabs .tab', { hasText: new RegExp('^' + tabReportes + '$') }).click();
      const a = await exportar(vent, '.destaraje-exportar');
      const b = await exportar(rep, '.destaraje-exportar');
      afirmar(a.TXT.txt && a.TXT.txt.texto.startsWith('REPORTE DE VENTAS'), `${tabVentas}: Ventas genera el TXT`);
      afirmar(a.TXT.txt.texto === b.TXT.txt.texto, `${tabVentas}: TXT idéntico en Ventas y Reportes`);
      afirmar(a.TXT.txt.nombre === b.TXT.txt.nombre, `${tabVentas}: mismo nombre de archivo TXT (${a.TXT.txt.nombre} / ${b.TXT.txt.nombre})`);
      afirmar(JSON.stringify(a.PDF.pdf.reg) === JSON.stringify(b.PDF.pdf.reg) && a.PDF.pdf.reg.length > 0, `${tabVentas}: PDF idéntico (texto y tablas)`);
      afirmar(a.PDF.pdf.nombre === b.PDF.pdf.nombre, `${tabVentas}: mismo nombre de archivo PDF`);
      afirmar(JSON.stringify(a.CSV.csv.filas) === JSON.stringify(b.CSV.csv.filas) && a.CSV.csv.filas.length > 0, `${tabVentas}: CSV idéntico`);
      afirmar(a.CSV.csv.nombre === b.CSV.csv.nombre, `${tabVentas}: mismo nombre de archivo CSV`);
      // El número de folios del reporte es el esperado para el periodo
      const folios = (a.TXT.txt.texto.match(/^  V-2026-\d{3}  /gm) || []).length;
      const esperado = { Hoy: 2, 'Esta Semana': 3, 'Este Mes': 4, 'Últimos 30 días': 5, Todas: 6 }[tabVentas];
      afirmar(folios === esperado, `${tabVentas}: ${esperado} folios en el reporte (obtenidos ${folios})`);
      // Subtotal solo en folios de varias líneas (001 y 004 tienen 2 líneas; los demás 1), igual en TXT, PDF y CSV de ambas pantallas
      const subTxt = (a.TXT.txt.texto.match(/SUBTOTAL V-2026-\d+/g) || []).length;
      const subPdf = a.PDF.pdf.reg.filter(([k]) => k === 'tabla')
        .reduce((n, [, o]) => n + o.body.filter((f) => f[0] && f[0].colSpan === 6).length, 0);
      const subCsv = a.CSV.csv.filas.filter((f) => f.seccion === 'SUBTOTAL');
      const esperadoSub = { Hoy: 1, 'Esta Semana': 1, 'Este Mes': 2, 'Últimos 30 días': 2, Todas: 2 }[tabVentas];
      afirmar(subTxt === esperadoSub && subPdf === esperadoSub && subCsv.length === esperadoSub, `${tabVentas}: ${esperadoSub} subtotal(es) en TXT/PDF/CSV (TXT ${subTxt}, PDF ${subPdf}, CSV ${subCsv.length})`);
      afirmar(subCsv.every((f) => ['V-2026-001', 'V-2026-004'].includes(f.folio)) && /Precio promedio|PRECIO PROMEDIO/i.test(a.TXT.txt.texto), `${tabVentas}: subtotales solo de folios de varias líneas y «Precio promedio» en el resumen`);
    }

    // Filtros de Reportes: el cliente y el folio acotan lo mismo que en el módulo
    await rep.locator('.destaraje-subtabs .tab', { hasText: /^Personalizado$/ }).click();
    await rep.selectOption('#ruf-ven-cliente', 'ACME').catch(() => {});
    await rep.locator('#ru-modulo').evaluate(() => {});
    const conCliente = await exportar(rep, '.destaraje-exportar');
    const tx = conCliente.TXT.txt.texto;
    afirmar(/SUBTOTAL V-2026-001/.test(tx) && !/SUBTOTAL V-2026-002/.test(tx), 'Reportes: el filtro de cliente deja solo las ventas de ACME');
    afirmar(Math.abs(Number(((tx.match(/TOTAL VENTAS: \$([\d,.]+)/) || [])[1] || '0').replace(/,/g, '')) - (VENTAS[0].totalVenta + VENTAS[2].totalVenta + VENTAS[5].totalVenta)) < 0.005, 'Reportes: TOTAL VENTAS de ACME');

    // Sin permiso de lectura de Ventas la opción no aparece
    const sinPermiso = await montar(browser, 'reportes', false);
    const opcionesSin = await sinPermiso.$$eval('#ru-modulo option', (os) => os.map((o) => o.textContent.trim()));
    afirmar(!opcionesSin.includes('Ventas'), 'Reportes: sin permiso de lectura de Ventas no aparece la opción');

    afirmar(vent.erroresPagina.length === 0 && rep.erroresPagina.length === 0, 'sin errores de JavaScript: ' + [...vent.erroresPagina, ...rep.erroresPagina].join(' / '));
    const intactas = await vent.evaluate(() => JSON.stringify(window.EVE.ventas));
    afirmar(intactas === copia, 'las ventas no se modifican');
  } finally {
    await browser.close();
  }

  // ── Parte 2: estática ──
  const ventasJs = leer('js/ventas.js');
  const reportesJs = leer('js/reportes.js');
  const ui = leer('js/reportes-ui.js');
  afirmar(!/function (generarTXTVentas|generarPDFVentas|construirFilasCSVVentas|construirReporteVentas)\(/.test(ventasJs), 'ventas.js ya no define el reporte');
  afirmar(/window\.generarTXTVentas = generarTXTVentas/.test(reportesJs) && /window\.obtenerVentasReporte = obtenerVentasReporte/.test(reportesJs), 'reportes.js publica el reporte compartido');
  afirmar(/window\.generarTXTVentas\(/.test(ventasJs) && /window\.generarPDFVentas\(/.test(ventasJs) && /window\.construirFilasCSVVentas\(/.test(ventasJs), 'Ventas llama a la función compartida');
  afirmar(/window\.generarTXTVentas\(/.test(ui) && /window\.generarPDFVentas\(/.test(ui) && /window\.construirFilasCSVVentas\(/.test(ui), 'Reportes llama a la función compartida');
  console.log(`${ok}/${total} verificaciones correctas`);
})().catch((e) => { console.error('FALLA: ' + e.message); process.exitCode = 1; });
