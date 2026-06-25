const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');
const path = require('path');
const fs = require('fs');
const os = require('os');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await page.fill('#login-username', CREDENCIALES.admin.username);
  await page.fill('#login-password', CREDENCIALES.admin.password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell.visible');

  await page.click('#btn-admin');
  await page.waitForSelector('.tab:has-text("Importar Datos")');
  await page.click('.tab:has-text("Importar Datos")');
  await page.waitForSelector('#ai-descargar-plantilla');

  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#ai-descargar-plantilla')
  ]);
  const rutaPlantilla = await descarga.path();
  console.log('PLANTILLA_DESCARGADA_OK:', !!rutaPlantilla);

  const ticketPrueba = `IMP${Date.now()}`.slice(-8);
  const archivoPrueba = path.join(os.tmpdir(), `prueba-importacion-${Date.now()}.xlsx`);
  await page.evaluate((args) => {
    const libro = XLSX.utils.book_new();
    const destaraje = XLSX.utils.aoa_to_sheet([
      ['Ticket', 'Proveedor', 'Material', 'Kg', 'Fecha Entrada', 'Fecha Salida'],
      [args.ticketPrueba, 'PROVEEDOR PRUEBA 8B', 'MIXTO', 100, '24-06-2026', '25-06-2026'],
      ['', '', '', '', '', '']
    ]);
    const produccion = XLSX.utils.aoa_to_sheet([
      ['Ticket', 'Cliente', 'Material', 'Kg', 'Fecha Entrada', 'Fecha Salida']
    ]);
    const pagos = XLSX.utils.aoa_to_sheet([
      ['Ticket', 'Proveedor', 'Material', 'Kg', 'Precio/Kg', 'Total', 'Pagado', 'Fecha'],
      [args.ticketPrueba, 'PROVEEDOR PRUEBA 8B', 'MIXTO', 100, 5, 999, 50, '2026-06-24']
    ]);
    XLSX.utils.book_append_sheet(libro, destaraje, 'Destaraje');
    XLSX.utils.book_append_sheet(libro, produccion, 'Produccion');
    XLSX.utils.book_append_sheet(libro, pagos, 'Pagos');
    window.__archivoPrueba = XLSX.write(libro, { type: 'base64' });
  }, { ticketPrueba });

  const base64Archivo = await page.evaluate(() => window.__archivoPrueba);
  fs.writeFileSync(archivoPrueba, Buffer.from(base64Archivo, 'base64'));

  await page.setInputFiles('#ai-archivo', archivoPrueba);
  await page.waitForSelector('#ai-vista-previa table');

  const textoResumen = await page.locator('#ai-vista-previa').textContent();
  console.log('PREVIEW_DESTARAJE_1_VALIDA_OK:', textoResumen.includes('Destaraje: 1 válidas, 0 con error'));
  console.log('PREVIEW_PRODUCCION_0_FILAS_OK:', textoResumen.includes('Producción: 0 válidas, 0 con error'));
  console.log('PREVIEW_PAGOS_1_INVALIDA_OK:', textoResumen.includes('Pagos: 0 válidas, 1 con error'));
  console.log('PREVIEW_MOTIVO_FECHA_OK:', textoResumen.includes('Fecha debe tener el formato DD-MM-AAAA'));

  console.log('BOTON_HABILITADO_AGREGAR_OK:', !(await page.locator('#ai-confirmar-importacion').isDisabled()));

  await page.click('#ai-confirmar-importacion');
  await page.waitForTimeout(800);

  const destarajeImportado = await page.evaluate(async (ticket) => {
    const registros = await window.cargarDatos(window.COLECCIONES.DESTARAJE);
    return registros.find((r) => r.ticket === ticket);
  }, ticketPrueba);
  console.log('IMPORTACION_AGREGAR_OK:', !!destarajeImportado && destarajeImportado.proveedor === 'PROVEEDOR PRUEBA 8B');

  const pagosImportados = await page.evaluate(async (ticket) => {
    const registros = await window.cargarDatos(window.COLECCIONES.PAGOS);
    return registros.filter((r) => r.ticket === ticket);
  }, ticketPrueba);
  console.log('FILA_INVALIDA_OMITIDA_OK:', pagosImportados.length === 0);

  await page.click('#ai-modo-reemplazar');
  console.log('BOTON_DESHABILITADO_SIN_CONFIRMAR_OK:', await page.locator('#ai-confirmar-importacion').isDisabled());

  await page.setInputFiles('#ai-archivo', archivoPrueba);
  await page.waitForSelector('#ai-vista-previa table');
  await page.fill('#ai-confirmar-texto', 'CONFIRMAR');
  console.log('BOTON_HABILITADO_TRAS_CONFIRMAR_OK:', !(await page.locator('#ai-confirmar-importacion').isDisabled()));

  await page.click('#ai-confirmar-importacion');
  await page.waitForTimeout(800);

  const destarajeFinal = await page.evaluate(async () => window.cargarDatos(window.COLECCIONES.DESTARAJE));
  console.log('REEMPLAZAR_DEJO_UN_SOLO_REGISTRO_OK:', destarajeFinal.filter((r) => r.proveedor === 'PROVEEDOR PRUEBA 8B').length === 1);

  const produccionFinal = await page.evaluate(async () => window.cargarDatos(window.COLECCIONES.PRODUCCION));
  console.log('PRODUCCION_NO_VACIADA_OK:', produccionFinal.length > 0);

  // Limpieza: borrar los registros de prueba directamente (no hay borrado en la UI de esta fase)
  await page.evaluate(async () => {
    const registros = await window.cargarDatos(window.COLECCIONES.DESTARAJE);
    const propios = registros.filter((r) => r.proveedor === 'PROVEEDOR PRUEBA 8B');
    for (const registro of propios) {
      await window.eliminarDato(window.COLECCIONES.DESTARAJE, registro.id);
    }
  });
  fs.unlinkSync(archivoPrueba);

  const destarajeLimpio = await page.evaluate(async () => window.cargarDatos(window.COLECCIONES.DESTARAJE));
  console.log('LIMPIEZA_OK:', !destarajeLimpio.some((r) => r.proveedor === 'PROVEEDOR PRUEBA 8B'));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
