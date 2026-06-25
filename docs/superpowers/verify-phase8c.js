const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');
const fs = require('fs');

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

  // --- Backup ---
  await page.click('.tab:has-text("Backup")');
  await page.waitForSelector('#ab-backup-json');

  const [descargaJson] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#ab-backup-json')
  ]);
  const rutaJson = await descargaJson.path();
  console.log('BACKUP_JSON_OK:', !!rutaJson);
  const contenidoJson = fs.readFileSync(rutaJson, 'utf-8');
  console.log('BACKUP_JSON_SIN_PASSWORD_OK:', !contenidoJson.toLowerCase().includes('password'));
  const backupParseado = JSON.parse(contenidoJson);
  console.log('BACKUP_JSON_5_CLAVES_SIN_USERS_OK:', Object.keys(backupParseado).length === 5 && !('users' in backupParseado));

  const [descargaExcel] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#ab-backup-excel')
  ]);
  console.log('BACKUP_EXCEL_OK:', !!(await descargaExcel.path()));

  console.log('BOTON_TELEGRAM_EXISTE_OK:', await page.locator('#ab-probar-telegram').count() === 1);

  // --- Configuracion: round-trip contra el documento REAL, restaurado de inmediato ---
  await page.click('.tab:has-text("Configuración")');
  await page.waitForSelector('#admin-config-form');

  const configOriginal = await page.evaluate(async () => {
    const doc = await window.db.collection('config').doc('telegram').get();
    return doc.exists ? doc.data() : null;
  });

  await page.fill('#ac-token', 'token_prueba_8c');
  await page.fill('#ac-chatid', 'chatid_prueba_8c');
  await page.fill('#ac-horario', '21:30');
  await page.click('#admin-config-form button[type="submit"]');
  await page.waitForFunction(async () => {
    const doc = await window.db.collection('config').doc('telegram').get();
    return doc.exists && doc.data().token === 'token_prueba_8c';
  }, { timeout: 5000 });

  const configGuardada = await page.evaluate(async () => {
    const doc = await window.db.collection('config').doc('telegram').get();
    return doc.data();
  });
  console.log('CONFIG_GUARDADA_OK:', configGuardada.token === 'token_prueba_8c'
    && configGuardada.chatId === 'chatid_prueba_8c'
    && configGuardada.horaReporte === '21:30');

  // Restaurar INMEDIATAMENTE, antes de cualquier otro paso
  await page.evaluate(async (original) => {
    if (original) {
      await window.db.collection('config').doc('telegram').set(original);
    } else {
      await window.eliminarDato(window.COLECCIONES.CONFIG, 'telegram');
    }
  }, configOriginal);

  const configRestaurada = await page.evaluate(async () => {
    const doc = await window.db.collection('config').doc('telegram').get();
    return doc.exists ? doc.data() : null;
  });
  console.log('CONFIG_RESTAURADA_OK:', JSON.stringify(configRestaurada) === JSON.stringify(configOriginal));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
