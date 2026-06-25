const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');

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

  await page.click('#tabs-container .tab:has-text("Reportes")');
  await page.waitForSelector('#ru-modulo');

  console.log('FILTROS_GENERAL_OK:', await page.locator('#ruf-proveedor').count() === 1 && await page.locator('#ruf-operador').count() === 0);

  await page.selectOption('#ru-modulo', 'controlProduccion');
  console.log('FILTROS_CP_OK:', await page.locator('#ruf-operador').count() === 1 && await page.locator('#ruf-proveedor').count() === 0);

  await page.click('button:has-text("🔍 Vista Previa")');
  const textoCp = await page.locator('#ru-preview-texto').textContent();
  console.log('PREVIEW_CP_OK:', textoCp.includes('CONTROL DE PRODUCCIÓN'));
  await page.click('#ru-cerrar-preview');
  console.log('CERRAR_PREVIEW_OK:', (await page.locator('#ru-preview-card').isVisible()) === false);

  const [descargaCpTxt] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("TXT")')
  ]);
  console.log('EXPORT_CP_TXT_OK:', !!(await descargaCpTxt.path()));

  const [descargaCpPdf] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("PDF")')
  ]);
  console.log('EXPORT_CP_PDF_OK:', !!(await descargaCpPdf.path()));

  const [descargaCpCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("CSV")')
  ]);
  console.log('EXPORT_CP_CSV_OK:', !!(await descargaCpCsv.path()));

  await page.selectOption('#ru-modulo', 'general');
  await page.waitForSelector('#ruf-proveedor');

  await page.click('button:has-text("🔍 Vista Previa")');
  const textoGeneral = await page.locator('#ru-preview-texto').textContent();
  console.log('PREVIEW_GENERAL_OK:', textoGeneral.includes('DESTARAJE GENERAL'));
  await page.click('#ru-cerrar-preview');

  const opcionesProveedor = await page.locator('#ruf-proveedor option').allTextContents();
  if (opcionesProveedor.length > 1) {
    const primerProveedorReal = opcionesProveedor[1];
    await page.selectOption('#ruf-proveedor', { label: primerProveedorReal });
    await page.click('button:has-text("🔍 Vista Previa")');
    const textoFiltrado = await page.locator('#ru-preview-texto').textContent();
    console.log('FILTRO_PROVEEDOR_OK:', textoFiltrado.includes(primerProveedorReal));
    await page.click('#ru-cerrar-preview');
    await page.selectOption('#ruf-proveedor', { label: opcionesProveedor[0] });
  } else {
    console.log('FILTRO_PROVEEDOR_OMITIDO_SIN_DATOS_REALES');
  }

  const [descargaTxt] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("TXT")')
  ]);
  console.log('EXPORT_GENERAL_TXT_OK:', !!(await descargaTxt.path()));

  const [descargaPdf] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("PDF")')
  ]);
  console.log('EXPORT_GENERAL_PDF_OK:', !!(await descargaPdf.path()));

  const [descargaCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("CSV")')
  ]);
  console.log('EXPORT_GENERAL_CSV_OK:', !!(await descargaCsv.path()));

  // Boton de Telegram: solo confirmar que existe. NUNCA hacer clic aqui --
  // un clic real envia un mensaje real si config/telegram ya esta sembrado.
  console.log('BOTON_TELEGRAM_EXISTE_OK:', await page.locator('button:has-text("📤 Telegram")').count() === 1);

  const tieneConfigTelegram = await page.evaluate(async () => {
    const doc = await window.db.collection('config').doc('telegram').get();
    return doc.exists;
  });
  console.log('CONFIG_TELEGRAM_SEMBRADA:', tieneConfigTelegram);

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
