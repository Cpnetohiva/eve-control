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
  await page.click('#tabs-container .tab:has-text("Pagos")');
  await page.waitForSelector('#pagos-form');

  const TICKET_PRUEBA = 'TESTQA';
  const PROVEEDOR_PRUEBA = 'TEST PAGO QA';
  const filaPrueba = page.locator(`#pagos-tabla tr:has-text("${PROVEEDOR_PRUEBA}")`);

  // Voice fills the form (no real microphone — fake SpeechRecognition above)
  await page.evaluate(({ ticket, proveedor }) => {
    window.__VOZ_TRANSCRIPT__ = `Ticket ${ticket} de ${proveedor}, MIXTO, 100, a 10, pagado 500`;
  }, { ticket: TICKET_PRUEBA, proveedor: PROVEEDOR_PRUEBA });
  await page.dispatchEvent('#pagos-form .btn-voz', 'mousedown');
  await page.waitForFunction((proveedor) => document.getElementById('pg-proveedor').value === proveedor, PROVEEDOR_PRUEBA);
  console.log('VOZ_LLENO_FORMULARIO_OK');

  await page.click('#pagos-form button[type="submit"]');
  await filaPrueba.waitFor({ state: 'visible' });
  console.log('HOY_TIENE_PRUEBA:', await filaPrueba.count() === 1);

  await page.click('.destaraje-subtabs .tab:has-text("Todos")');
  await page.fill('#pgf-proveedor', PROVEEDOR_PRUEBA);
  await page.waitForFunction((proveedor) => {
    const filas = document.querySelectorAll('#pagos-tabla tr');
    return filas.length === 1 && filas[0].textContent.includes(proveedor);
  }, PROVEEDOR_PRUEBA);
  console.log('FILTRO_OK');

  await filaPrueba.locator('button:has-text("Editar")').click();
  await page.waitForSelector('#pagos-modal-overlay.open');
  await page.fill('#pge-kg', '200');
  await page.click('#pagos-edit-form button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById('pagos-modal-overlay').classList.contains('open'));
  console.log('EDICION_OK:', await filaPrueba.textContent().then((t) => t.includes('200 KG')));

  await page.click('.destaraje-subtabs .tab:has-text("Esta Semana")');
  await page.waitForFunction(() => document.getElementById('control-flujo').style.display !== 'none');

  await page.click('#btn-registrar-ministracion');
  await page.waitForSelector('#ministracion-modal-overlay.open');
  await page.fill('#mn-monto', '777');
  await page.click('#ministracion-form button[type="submit"]');
  const itemMinistracion = page.locator('#lista-ministraciones li:has-text("777")');
  await itemMinistracion.waitFor({ state: 'visible' });
  console.log('MINISTRACION_CREADA_OK:', await itemMinistracion.count() === 1);

  const textoMinistrado = await page.locator('#cf-ministrado').textContent();
  const textoPagado = await page.locator('#cf-pagado').textContent();
  console.log('CONTROL_FLUJO_SANO_OK:', !textoMinistrado.includes('NaN') && !textoMinistrado.includes('undefined')
    && !textoPagado.includes('NaN') && !textoPagado.includes('undefined'));

  await itemMinistracion.locator('button').click();
  await itemMinistracion.waitFor({ state: 'detached' });
  console.log('MINISTRACION_ELIMINADA_OK:', await itemMinistracion.count() === 0);

  await page.click('.destaraje-subtabs .tab:has-text("Hoy")');
  await filaPrueba.waitFor({ state: 'visible' });

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
