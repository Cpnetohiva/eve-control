const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

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
  await page.click('#tabs-container .tab:has-text("Destaraje")');
  await page.waitForSelector('.btn-voz');

  await page.evaluate(() => { window.__VOZ_TRANSCRIPT__ = 'Ticket 123 de Juan'; });
  await page.dispatchEvent('.btn-voz', 'mousedown');
  await page.waitForFunction(() => document.querySelectorAll('.toast-error').length > 0);
  console.log('ERROR_TOAST_OK');

  await page.evaluate(() => {
    window.__VOZ_TRANSCRIPT__ = 'Ticket 9260 de Jose Enrique, Mixto, 650, entrada 23 junio, salida 24 junio';
  });
  await page.dispatchEvent('.btn-voz', 'mousedown');
  await page.waitForFunction(() => document.getElementById('df-ticket').value === '9260');
  const compra = await page.evaluate(() => ({
    ticket: document.getElementById('df-ticket').value,
    proveedor: document.getElementById('df-proveedor').value,
    material: document.getElementById('df-material').value,
    kg: document.getElementById('df-kg').value,
    entrada: document.getElementById('df-entrada').value,
    salida: document.getElementById('df-salida').value,
    tipoCompra: document.querySelector('input[name="tipo"][value="compra"]').checked
  }));
  console.log('COMPRA_OK:', JSON.stringify(compra));

  await page.evaluate(() => {
    window.__VOZ_TRANSCRIPT__ = 'Ticket V de Cliente Voz, PET, 200, entrada 24 junio, salida 24 junio';
  });
  await page.dispatchEvent('.btn-voz', 'mousedown');
  await page.waitForFunction(() => document.getElementById('df-proveedor').value === 'Cliente Voz');
  await page.dispatchEvent('.btn-voz', 'mouseup');
  const venta = await page.evaluate(() => ({
    ticket: document.getElementById('df-ticket').value,
    ticketDisabled: document.getElementById('df-ticket').disabled,
    proveedor: document.getElementById('df-proveedor').value,
    material: document.getElementById('df-material').value,
    kg: document.getElementById('df-kg').value,
    tipoVenta: document.querySelector('input[name="tipo"][value="venta"]').checked
  }));
  console.log('VENTA_OK:', JSON.stringify(venta));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
