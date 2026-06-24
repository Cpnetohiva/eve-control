const { chromium } = require('playwright');

const CREDENCIALES = require('./credenciales-phase2.json');

async function login(page, username, password) {
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('#login-form button[type="submit"]');
}

async function logout(page) {
  await page.click('#btn-salir');
  await page.waitForSelector('#login-screen', { state: 'visible' });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });

  // 1. Wrong password
  await login(page, CREDENCIALES.admin.username, 'contraseña-incorrecta');
  await page.waitForFunction(() => document.getElementById('login-error').textContent.length > 0);
  console.log('WRONG_PASSWORD_MESSAGE:', await page.textContent('#login-error'));

  // 2. Admin login
  await page.fill('#login-username', '');
  await page.fill('#login-password', '');
  await login(page, CREDENCIALES.admin.username, CREDENCIALES.admin.password);
  await page.waitForSelector('#app-shell.visible');
  const tabsAdmin = await page.$$eval('#tabs-container .tab', (els) => els.map((e) => e.textContent));
  const adminBtnVisible = await page.isVisible('#btn-admin');
  console.log('ADMIN_TABS:', JSON.stringify(tabsAdmin), 'ADMIN_BTN_VISIBLE:', adminBtnVisible);
  const eveSnapshot = await page.evaluate(() => ({
    destaraje: window.EVE.registrosDestaraje.length,
    ventas: window.EVE.registrosVentas.length,
    produccion: window.EVE.registrosProduccion.length,
    pagos: window.EVE.registrosPagos.length,
  }));
  console.log('EVE_COUNTS:', JSON.stringify(eveSnapshot));

  // toasts + exportarCSV smoke check (utils.js DOM helpers)
  await page.evaluate(() => { window.showSuccess('ok prueba'); window.showError('error prueba'); });
  const toastCounts = await page.evaluate(() => ({
    success: document.querySelectorAll('.toast-success').length,
    error: document.querySelectorAll('.toast-error').length
  }));
  console.log('TOAST_COUNTS:', JSON.stringify(toastCounts));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.exportarCSV([{ a: 1, b: 2 }], 'prueba.csv'))
  ]);
  console.log('DOWNLOAD_FILENAME:', download.suggestedFilename());

  await logout(page);

  // 3. Matilde login
  await login(page, CREDENCIALES.matilde.username, CREDENCIALES.matilde.password);
  await page.waitForSelector('#app-shell.visible');
  console.log('MATILDE_TABS:', JSON.stringify(await page.$$eval('#tabs-container .tab', (els) => els.map((e) => e.textContent))));
  console.log('MATILDE_ADMIN_BTN_VISIBLE:', await page.isVisible('#btn-admin'));
  await logout(page);

  // 4. Christian login
  await login(page, CREDENCIALES.christian.username, CREDENCIALES.christian.password);
  await page.waitForSelector('#app-shell.visible');
  console.log('CHRISTIAN_TABS:', JSON.stringify(await page.$$eval('#tabs-container .tab', (els) => els.map((e) => e.textContent))));

  // 5. Auto-login on reload
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#app-shell.visible');
  console.log('AUTOLOGIN_TABS:', JSON.stringify(await page.$$eval('#tabs-container .tab', (els) => els.map((e) => e.textContent))));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));

  await browser.close();
})();
