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

  await page.click('#btn-admin');
  await page.waitForSelector('#admin-usuarios-nuevo');
  await page.waitForSelector('#admin-usuarios-tabla-body tr');

  const filasIniciales = await page.locator('#admin-usuarios-tabla-body tr').count();
  console.log('TABLA_CARGA_OK:', filasIniciales > 0);

  const usernamePrueba = `prueba_8a_${Date.now()}`;
  await page.click('#admin-usuarios-nuevo');
  await page.waitForSelector('.modal-overlay.open');
  await page.fill('#au-username', usernamePrueba);
  await page.fill('#au-password', 'clave_prueba_123');
  await page.check('#au-permiso-destaraje');
  await page.check('#au-permiso-reportes');
  await page.click('#admin-usuarios-form button[type="submit"]');
  await page.waitForSelector('#admin-usuarios-modal-overlay.open', { state: 'hidden' });

  const filaPrueba = page.locator(`tr:has-text("${usernamePrueba}")`);
  await filaPrueba.waitFor();
  const textoPermisosCreado = await filaPrueba.locator('td').nth(1).textContent();
  console.log('CREAR_USUARIO_OK:', textoPermisosCreado.includes('Destaraje') && textoPermisosCreado.includes('Reportes'));

  const testUserId = await filaPrueba.getAttribute('data-user-id');

  // Username duplicado: debe bloquear el guardado, sin crear una segunda fila
  await page.click('#admin-usuarios-nuevo');
  await page.waitForSelector('.modal-overlay.open');
  await page.fill('#au-username', usernamePrueba);
  await page.fill('#au-password', 'otra_clave');
  await page.click('#admin-usuarios-form button[type="submit"]');
  await page.waitForTimeout(300);
  const filasConMismoUsername = await page.locator(`tr:has-text("${usernamePrueba}")`).count();
  console.log('USERNAME_DUPLICADO_BLOQUEADO_OK:', filasConMismoUsername === 1);
  await page.click('#au-cancelar');

  // Editar: agregar un permiso, dejar password vacío
  const filaPruebaParaEditar = page.locator(`tr[data-user-id="${testUserId}"]`);
  await filaPruebaParaEditar.locator('button:has-text("Editar")').click();
  await page.waitForSelector('.modal-overlay.open');
  await page.check('#au-permiso-pagos');
  await page.click('#admin-usuarios-form button[type="submit"]');
  await page.waitForSelector('#admin-usuarios-modal-overlay.open', { state: 'hidden' });
  await page.waitForTimeout(300);
  const filaPruebaActualizada = page.locator(`tr[data-user-id="${testUserId}"]`);
  const textoPermisosEditado = await filaPruebaActualizada.locator('td').nth(1).textContent();
  console.log('EDITAR_USUARIO_OK:', textoPermisosEditado.includes('Pagos'));

  // Desactivar
  await filaPruebaActualizada.locator('button:has-text("Desactivar")').click();
  await page.waitForTimeout(300);
  const textoActivoFinal = await filaPruebaActualizada.locator('td').nth(2).textContent();
  console.log('DESACTIVAR_USUARIO_OK:', textoActivoFinal.trim() === '✗');

  // Auto-bloqueo: el propio usuario admin no puede desactivarse ni quitarse su propio permiso Admin/Activo
  const filaAdminActual = page.locator(`tr:has-text("${CREDENCIALES.admin.username}")`);
  const botonToggleAdmin = filaAdminActual.locator('button:has-text("Desactivar"), button:has-text("Activar")');
  console.log('AUTOBLOQUEO_DESACTIVAR_OK:', await botonToggleAdmin.isDisabled());

  await filaAdminActual.locator('button:has-text("Editar")').click();
  await page.waitForSelector('.modal-overlay.open');
  console.log('AUTOBLOQUEO_ADMIN_CHECKBOX_OK:', await page.locator('#au-permiso-admin').isDisabled());
  console.log('AUTOBLOQUEO_ACTIVO_CHECKBOX_OK:', await page.locator('#au-activo').isDisabled());
  await page.click('#au-cancelar');

  // Limpieza: borrar el usuario de prueba directamente en Firestore (no hay borrado permanente en la UI)
  await page.evaluate(async (id) => {
    await window.eliminarDato(window.COLECCIONES.USERS, id);
  }, testUserId);
  const usuariosFinal = await page.evaluate(async () => {
    return await window.cargarDatos(window.COLECCIONES.USERS);
  });
  console.log('LIMPIEZA_OK:', !usuariosFinal.some((u) => u.id === testUserId));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
