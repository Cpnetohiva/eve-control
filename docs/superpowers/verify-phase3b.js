const fs = require('fs');
const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await page.fill('#login-username', CREDENCIALES.admin.username);
  await page.fill('#login-password', CREDENCIALES.admin.password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell.visible');
  await page.click('#tabs-container .tab:has-text("Destaraje")');
  await page.waitForSelector('.destaraje-exportar');

  await page.click('.destaraje-subtabs .tab:has-text("Todos")');

  const [downloadTxt] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("TXT")')
  ]);
  const txtContenido = fs.readFileSync(await downloadTxt.path(), 'utf-8');
  console.log('TXT_OK:', txtContenido.startsWith('DESTARAJE GENERAL') && txtContenido.includes('REPORTE: TODOS'));

  const [downloadCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("CSV")')
  ]);
  const csvContenido = fs.readFileSync(await downloadCsv.path(), 'utf-8');
  console.log('CSV_OK:', csvContenido.length > 0);

  const [downloadPdf] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("PDF")')
  ]);
  const pdfBuffer = fs.readFileSync(await downloadPdf.path());
  console.log('PDF_OK:', pdfBuffer.slice(0, 4).toString() === '%PDF', 'TAMANO:', pdfBuffer.length);

  await page.click('.destaraje-subtabs .tab:has-text("Hoy")');
  const [downloadTxtHoy] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("TXT")')
  ]);
  const txtHoyContenido = fs.readFileSync(await downloadTxtHoy.path(), 'utf-8');
  console.log('REPORTE_HOY_OK:', txtHoyContenido.includes('REPORTE: HOY'));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
