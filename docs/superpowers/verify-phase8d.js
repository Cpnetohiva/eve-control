const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');

// Seeding uses dates far in the future (2099) to avoid any overlap with real data.
const FECHA_DENTRO_A = '2099-01-15';
const FECHA_DENTRO_B = '2099-01-20';
const FECHA_FUERA = '2099-03-01';
const RANGO_DESDE = '2099-01-01';
const RANGO_HASTA = '2099-01-31';

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

  // Seed 3 test records directly in Firestore — 2 inside the test range, 1 outside.
  // Ticket must be all-digits so clasificarDestaraje() puts them in registrosDestaraje.
  const idsPrueba = await page.evaluate(async (fechas) => {
    const coleccion = window.db.collection('destaraje');
    const base = {
      ticket: '99998801',
      proveedor: 'PRUEBA_GESTION_DATOS_8D',
      material: 'MIXTO',
      kg: 100,
      fechaEntrada: '2099-01-10'
    };
    const docA = await coleccion.add({ ...base, fechaSalida: fechas.dentroA });
    const docB = await coleccion.add({ ...base, fechaSalida: fechas.dentroB });
    const docC = await coleccion.add({ ...base, fechaSalida: fechas.fuera });
    return [docA.id, docB.id, docC.id];
  }, { dentroA: FECHA_DENTRO_A, dentroB: FECHA_DENTRO_B, fuera: FECHA_FUERA });
  console.log('SIEMBRA_OK:', idsPrueba.length === 3);

  // Reload window.EVE to include the seeded records
  await page.evaluate(async () => {
    await window.cargarDatosEnParalelo();
  });

  // Open Admin panel, navigate to Gestión de Datos
  await page.click('#btn-admin');
  await page.waitForSelector('.tab:has-text("Gestión de Datos")');
  await page.click('.tab:has-text("Gestión de Datos")');
  await page.waitForSelector('#ad-selector-modulo');

  // Verify date section is initially visible and checkbox section hidden
  console.log('SECCION_FECHAS_INICIAL_VISIBLE_OK:', await page.locator('#ad-seccion-fechas').isVisible());
  console.log('SECCION_CHECKBOX_INICIAL_OCULTA_OK:', !(await page.locator('#ad-seccion-checkbox').isVisible()));
  console.log('BTN_ELIMINAR_INICIAL_OCULTO_OK:', !(await page.locator('#ad-btn-eliminar').isVisible()));

  // Select Destaraje
  await page.selectOption('#ad-selector-modulo', 'destaraje');
  console.log('SECCION_FECHAS_DESTARAJE_VISIBLE_OK:', await page.locator('#ad-seccion-fechas').isVisible());

  // Set date range covering records A and B but not C
  await page.fill('#ad-fecha-desde', RANGO_DESDE);
  await page.fill('#ad-fecha-hasta', RANGO_HASTA);

  // Click "Ver cuántos"
  await page.click('#ad-btn-ver');
  const textoVistaPrevia = await page.locator('#ad-vista-previa').textContent();
  const conteoPreview = parseInt((textoVistaPrevia.match(/\d+/) || ['0'])[0], 10);
  console.log('PREVIEW_MUESTRA_CONTEO_OK:', /\d+/.test(textoVistaPrevia));
  console.log('PREVIEW_CONTEO_MINIMO_2_OK:', conteoPreview >= 2);

  // Delete button is visible but disabled (no CONFIRMAR yet)
  console.log('BTN_ELIMINAR_VISIBLE_OK:', await page.locator('#ad-btn-eliminar').isVisible());
  console.log('BTN_DESHABILITADO_SIN_CONFIRMAR_OK:', await page.locator('#ad-btn-eliminar').isDisabled());

  // Changing the date invalidates the preview (button hidden again)
  await page.fill('#ad-fecha-hasta', '2099-01-30');
  console.log('BTN_OCULTO_TRAS_CAMBIO_FECHA_OK:', !(await page.locator('#ad-btn-eliminar').isVisible()));

  // Restore the range and re-preview
  await page.fill('#ad-fecha-hasta', RANGO_HASTA);
  await page.click('#ad-btn-ver');
  await page.waitForFunction(() => {
    const prev = document.getElementById('ad-vista-previa');
    return prev && /\d+/.test(prev.textContent);
  }, { timeout: 3000 });

  // Type CONFIRMAR — button becomes enabled
  await page.fill('#ad-confirmar-texto', 'CONFIRMAR');
  console.log('BTN_HABILITADO_TRAS_CONFIRMAR_OK:', !(await page.locator('#ad-btn-eliminar').isDisabled()));

  // Typing wrong text disables the button
  await page.fill('#ad-confirmar-texto', 'confirmar');
  console.log('BTN_DESHABILITADO_CONFIRMAR_INCORRECTO_OK:', await page.locator('#ad-btn-eliminar').isDisabled());

  await page.fill('#ad-confirmar-texto', 'CONFIRMAR');

  // Execute the deletion
  await page.click('#ad-btn-eliminar');
  await page.waitForFunction(() => {
    const btn = document.getElementById('ad-btn-eliminar');
    return !btn || btn.style.display === 'none';
  }, { timeout: 8000 });

  // Verify from Firestore: A and B deleted, C intact
  const resultado = await page.evaluate(async (ids) => {
    const [idA, idB, idC] = ids;
    const [docA, docB, docC] = await Promise.all([
      window.db.collection('destaraje').doc(idA).get(),
      window.db.collection('destaraje').doc(idB).get(),
      window.db.collection('destaraje').doc(idC).get()
    ]);
    return { aExiste: docA.exists, bExiste: docB.exists, cExiste: docC.exists };
  }, idsPrueba);
  console.log('REGISTRO_DENTRO_RANGO_A_BORRADO_OK:', !resultado.aExiste);
  console.log('REGISTRO_DENTRO_RANGO_B_BORRADO_OK:', !resultado.bExiste);
  console.log('REGISTRO_FUERA_RANGO_C_INTACTO_OK:', resultado.cExiste);

  // Verify TODOS los módulos option exists in the selector
  const opciones = await page.locator('#ad-selector-modulo option').allTextContents();
  console.log('OPCION_TODOS_EXISTE_OK:', opciones.some((t) => t.includes('TODOS')));

  // Select TODOS → date section hides, preview and checkbox appear after "Ver cuántos"
  await page.selectOption('#ad-selector-modulo', 'todos');
  console.log('SECCION_FECHAS_OCULTA_TODOS_OK:', !(await page.locator('#ad-seccion-fechas').isVisible()));
  console.log('SECCION_CHECKBOX_OCULTA_ANTES_PREVIEW_OK:', !(await page.locator('#ad-seccion-checkbox').isVisible()));

  await page.click('#ad-btn-ver');
  const textoTodos = await page.locator('#ad-vista-previa').textContent();
  console.log('PREVIEW_TODOS_MUESTRA_DESGLOSE_OK:', textoTodos.includes('Total:'));
  console.log('SECCION_CHECKBOX_VISIBLE_OK:', await page.locator('#ad-seccion-checkbox').isVisible());

  // Button remains disabled (no CONFIRMAR text and no checkbox)
  console.log('BTN_TODOS_DESHABILITADO_SIN_CONFIRMAR_OK:', await page.locator('#ad-btn-eliminar').isDisabled());

  // Type CONFIRMAR but no checkbox — still disabled
  await page.fill('#ad-confirmar-texto', 'CONFIRMAR');
  console.log('BTN_TODOS_DESHABILITADO_SIN_CHECKBOX_OK:', await page.locator('#ad-btn-eliminar').isDisabled());

  // Cleanup: delete remaining test record C directly from Firestore (never execute the TODOS deletion)
  await page.evaluate(async (idC) => {
    await window.db.collection('destaraje').doc(idC).delete();
  }, idsPrueba[2]);

  const docCFinal = await page.evaluate(async (idC) => {
    const doc = await window.db.collection('destaraje').doc(idC).get();
    return doc.exists;
  }, idsPrueba[2]);
  console.log('LIMPIEZA_OK:', !docCFinal);

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
