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

  await page.click('#tabs-container .tab:has-text("Destaraje")');
  await page.waitForSelector('#destaraje-form');

  const TICKET_PRUEBA = '88888888';
  // Row-scoped locators everywhere below — never a bare "button:has-text(Eliminar)"
  // across the whole table, since real production rows can coexist with the
  // test row (a prior run's ambiguous selector deleted a real record).
  const filaCompraPrueba = page.locator(`#destaraje-tabla-destaraje tr:has-text("${TICKET_PRUEBA}")`);

  await page.fill('#df-ticket', TICKET_PRUEBA);
  await page.fill('#df-proveedor', 'TEST PROVEEDOR QA');
  await page.fill('#df-material', 'MIXTO');
  await page.fill('#df-kg', '123');
  await page.fill('#df-entrada', '2026-06-24');
  await page.fill('#df-salida', '2026-06-24');
  await page.click('#destaraje-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.toast-success').length > 0);

  console.log('HOY_TIENE_PRUEBA:', await filaCompraPrueba.count() === 1);

  await page.click('.destaraje-subtabs .tab:has-text("Todos")');
  await page.fill('#ft-ticket', TICKET_PRUEBA);
  await page.waitForFunction((ticket) => {
    const filas = document.querySelectorAll('#destaraje-tabla-destaraje tr');
    return filas.length === 1 && filas[0].textContent.includes(ticket);
  }, TICKET_PRUEBA);
  console.log('FILTRO_OK');

  await filaCompraPrueba.locator('button:has-text("Editar")').click();
  await page.waitForSelector('#destaraje-modal-overlay.open');
  await page.fill('#de-kg', '456');
  await page.click('#destaraje-edit-form button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById('destaraje-modal-overlay').classList.contains('open'));
  console.log('EDICION_OK:', await filaCompraPrueba.textContent().then((t) => t.includes('456 KG')));

  await filaCompraPrueba.locator('button:has-text("Eliminar")').click();
  await filaCompraPrueba.waitFor({ state: 'detached' });
  console.log('ELIMINACION_COMPRA_OK:', await filaCompraPrueba.count() === 0);

  await page.fill('#ft-ticket', '');
  await page.click('input[name="tipo"][value="venta"]');
  await page.fill('#df-proveedor', 'TEST CLIENTE QA');
  await page.fill('#df-material', 'PET');
  await page.fill('#df-kg', '50');
  await page.fill('#df-entrada', '2026-06-24');
  await page.fill('#df-salida', '2026-06-24');
  await page.click('#destaraje-form button[type="submit"]');

  const filaVentaPrueba = page.locator('#destaraje-tabla-ventas tr:has-text("TEST CLIENTE QA")');
  await filaVentaPrueba.waitFor({ state: 'visible' });
  console.log('VENTA_CREADA_OK:', await filaVentaPrueba.count() === 1);

  await filaVentaPrueba.locator('button:has-text("Eliminar")').click();
  await page.waitForFunction(() =>
    !document.getElementById('destaraje-tabla-ventas').textContent.includes('TEST CLIENTE QA')
  );
  console.log('VENTA_ELIMINADA_OK:', await filaVentaPrueba.count() === 0);

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
