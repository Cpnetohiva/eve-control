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

  const hoy = await page.evaluate(() => window.obtenerFechaMexico());
  const fechaInicio = `${hoy}T08:00`;
  const fechaFin = `${hoy}T14:00`;

  const OPERADOR_PRUEBA = 'TEST CP QA OPERADOR';
  const MATERIAL_PRINCIPAL_PRUEBA = 'TEST CP QA PELLETS';
  const PROVEEDOR_VENTA_PRUEBA = 'TEST CP QA VENTA';

  // ---- Control de Producción: crear registro de prueba ----
  await page.click('#tabs-container .tab:has-text("Control Producción")');
  await page.waitForSelector('#control-produccion-form');

  await page.click('.cp-proceso-boton[data-tipo="PELETIZADO"]');
  await page.fill('#cp-inputs-lista .cp-fila-material', 'TEST CP QA MOLIDO');
  await page.fill('#cp-inputs-lista .cp-fila-kg', '100');
  await page.fill('#cp-inputs-lista .cp-fila-origen', 'TEST-CP-QA-SINORIGEN');

  const filasAntes = await page.locator('#cp-inputs-lista .cp-fila-input').count();
  await page.click('#cp-agregar-material');
  const filasDespues = await page.locator('#cp-inputs-lista .cp-fila-input').count();
  console.log('AGREGAR_MATERIAL_OK:', filasDespues === filasAntes + 1);
  await page.locator('#cp-inputs-lista .cp-fila-input').nth(1).locator('.cp-fila-quitar').click();

  await page.fill('#cp-material-principal', MATERIAL_PRINCIPAL_PRUEBA);
  await page.fill('#cp-kg-principal', '90');
  await page.fill('#cp-kg-merma', '10');
  const textoResumen = await page.locator('#cp-resumen').textContent();
  console.log('RESUMEN_EN_VIVO_OK:', textoResumen.includes('90.00%'));

  await page.fill('#cp-operador', OPERADOR_PRUEBA);
  await page.selectOption('#cp-turno', 'Matutino');
  await page.fill('#cp-fecha-inicio', fechaInicio);
  await page.fill('#cp-fecha-fin', fechaFin);

  const filaPrueba = page.locator(`#control-produccion-tabla tr:has-text("${OPERADOR_PRUEBA}")`);
  await page.click('#control-produccion-form button[type="submit"]');
  await filaPrueba.waitFor({ state: 'visible' });
  console.log('HOY_TIENE_PRUEBA:', await filaPrueba.count() === 1);

  const ticketPrueba = (await filaPrueba.locator('td').first().textContent()).trim();

  // ---- Filtrar en Todos ----
  await page.click('.destaraje-subtabs .tab:has-text("Todos")');
  await page.fill('#cpf-operador', OPERADOR_PRUEBA);
  await page.waitForFunction((operador) => {
    const filas = document.querySelectorAll('#control-produccion-tabla tr');
    return filas.length === 1 && filas[0].textContent.includes(operador);
  }, OPERADOR_PRUEBA);
  console.log('FILTRO_OK');

  // ---- Editar ----
  await filaPrueba.locator('button:has-text("Editar")').click();
  await page.waitForSelector('#control-produccion-modal-overlay.open');
  await page.fill('#cpe-kg-principal', '95');
  await page.click('#control-produccion-edit-form button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById('control-produccion-modal-overlay').classList.contains('open'));
  console.log('EDICION_OK:', await filaPrueba.textContent().then((t) => t.includes('95.00%')));

  // ---- Trazabilidad: antes de vincular una Venta ----
  await page.click('.destaraje-subtabs .tab:has-text("Trazabilidad")');
  await page.fill('#cp-trz-ticket', ticketPrueba);
  await page.click('#cp-trz-buscar');
  const nodoRaiz = page.locator(`.cp-trz-raiz:has-text("${ticketPrueba}")`);
  await nodoRaiz.waitFor({ state: 'visible' });
  console.log('TRAZABILIDAD_RAIZ_OK:', await nodoRaiz.count() === 1);
  console.log('TRAZABILIDAD_ENTRADA_NO_IDENTIFICADA_OK:', await page.locator('.cp-trz-origenes:has-text("no identificada")').count() === 1);
  console.log('TRAZABILIDAD_SIN_VENTA_TODAVIA_OK:', await page.locator('.cp-trz-destinos').count() === 0);

  // ---- Destaraje: crear una Venta que cierre la cadena ----
  await page.click('#tabs-container .tab:has-text("Destaraje")');
  await page.waitForSelector('#destaraje-form');
  await page.click('input[name="tipo"][value="venta"]');
  await page.fill('#df-proveedor', PROVEEDOR_VENTA_PRUEBA);
  await page.fill('#df-material', MATERIAL_PRINCIPAL_PRUEBA);
  await page.fill('#df-kg', '95');
  await page.fill('#df-entrada', hoy);
  await page.fill('#df-salida', hoy);
  await page.fill('#df-ticketorigen', ticketPrueba);
  const filaVentaPrueba = page.locator(`#destaraje-tabla-ventas tr:has-text("${PROVEEDOR_VENTA_PRUEBA}")`);
  await page.click('#destaraje-form button[type="submit"]');
  await filaVentaPrueba.waitFor({ state: 'visible' });
  console.log('VENTA_CREADA_OK:', await filaVentaPrueba.count() === 1);

  // ---- Trazabilidad: después de vincular la Venta ----
  await page.click('#tabs-container .tab:has-text("Control Producción")');
  await page.waitForSelector('#control-produccion-form');
  await page.click('.destaraje-subtabs .tab:has-text("Trazabilidad")');
  await page.fill('#cp-trz-ticket', ticketPrueba);
  await page.click('#cp-trz-buscar');
  console.log('TRAZABILIDAD_VENTA_OK:', await page.locator(`.cp-trz-destinos:has-text("${PROVEEDOR_VENTA_PRUEBA}")`).count() === 1);

  // ---- Limpieza: eliminar la Venta de prueba ----
  await page.click('#tabs-container .tab:has-text("Destaraje")');
  await page.waitForSelector('#destaraje-form');
  await filaVentaPrueba.locator('button:has-text("Eliminar")').click();
  await filaVentaPrueba.waitFor({ state: 'detached' });
  console.log('VENTA_ELIMINADA_OK:', await filaVentaPrueba.count() === 0);

  // ---- Limpieza: eliminar el registro de prueba de Control de Producción ----
  await page.click('#tabs-container .tab:has-text("Control Producción")');
  await page.waitForSelector('#control-produccion-form');
  await page.click('.destaraje-subtabs .tab:has-text("Todos")');
  await page.fill('#cpf-operador', OPERADOR_PRUEBA);
  await filaPrueba.waitFor({ state: 'visible' });
  await filaPrueba.locator('button:has-text("Eliminar")').click();
  await filaPrueba.waitFor({ state: 'detached' });
  console.log('ELIMINACION_OK:', await filaPrueba.count() === 0);

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
