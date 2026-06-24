const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('dialog', (dialog) => dialog.accept());

  await page.addInitScript(() => {
    window.__VOZ_TRANSCRIPT__ = '';
    class FakeSpeechRecognition {
      start() {
        setTimeout(() => {
          if (this.onresult) {
            this.onresult({ results: [[{ transcript: window.__VOZ_TRANSCRIPT__ }]] });
          }
        }, 20);
      }
      stop() {}
    }
    window.SpeechRecognition = FakeSpeechRecognition;
    window.webkitSpeechRecognition = FakeSpeechRecognition;
  });

  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await page.fill('#login-username', CREDENCIALES.admin.username);
  await page.fill('#login-password', CREDENCIALES.admin.password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell.visible');
  await page.click('#tabs-container .tab:has-text("Producción")');
  await page.waitForSelector('#produccion-form');

  const CLIENTE_PRUEBA = 'TEST PROD QA';
  const filaPrueba = page.locator(`#produccion-tabla tr:has-text("${CLIENTE_PRUEBA}")`);

  await page.evaluate((cliente) => {
    window.__VOZ_TRANSCRIPT__ = `Ticket P de ${cliente}, PET, 55, entrada 24 junio, salida 24 junio`;
  }, CLIENTE_PRUEBA);
  await page.dispatchEvent('#produccion-form .btn-voz', 'mousedown');
  await page.waitForFunction((cliente) => document.getElementById('prod-cliente').value === cliente, CLIENTE_PRUEBA);
  console.log('VOZ_LLENO_FORMULARIO_OK');

  await page.click('#produccion-form button[type="submit"]');
  await filaPrueba.waitFor({ state: 'visible' });
  console.log('HOY_TIENE_PRUEBA:', await filaPrueba.count() === 1);

  await page.click('.destaraje-subtabs .tab:has-text("Todos")');
  await page.fill('#pft-cliente', CLIENTE_PRUEBA);
  await page.waitForFunction((cliente) => {
    const filas = document.querySelectorAll('#produccion-tabla tr');
    return filas.length === 1 && filas[0].textContent.includes(cliente);
  }, CLIENTE_PRUEBA);
  console.log('FILTRO_OK');

  await filaPrueba.locator('button:has-text("Editar")').click();
  await page.waitForSelector('#produccion-modal-overlay.open');
  await page.fill('#prode-kg', '99');
  await page.click('#produccion-edit-form button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById('produccion-modal-overlay').classList.contains('open'));
  console.log('EDICION_OK:', await filaPrueba.textContent().then((t) => t.includes('99 KG')));

  const [downloadTxt] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("TXT")')
  ]);
  console.log('EXPORT_TXT_OK:', !!(await downloadTxt.path()));

  const [downloadPdf] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("PDF")')
  ]);
  console.log('EXPORT_PDF_OK:', !!(await downloadPdf.path()));

  const [downloadCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("CSV")')
  ]);
  console.log('EXPORT_CSV_OK:', !!(await downloadCsv.path()));

  await filaPrueba.locator('button:has-text("Eliminar")').click();
  await filaPrueba.waitFor({ state: 'detached' });
  console.log('ELIMINACION_OK:', await filaPrueba.count() === 0);

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
