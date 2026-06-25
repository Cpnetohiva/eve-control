const { chromium } = require('playwright');
const CREDS = require('./credenciales-phase2.json');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  // Login
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await page.fill('#login-username', CREDS.admin.username);
  await page.fill('#login-password', CREDS.admin.password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell.visible');
  console.log('LOGIN_OK: true');

  // Verificar estado inicial del header
  const textoInicial = await page.locator('#estado-conexion').textContent();
  console.log('HEADER_ONLINE_INICIAL_OK:', textoInicial.includes('🟢'));

  // Verificar que IndexedDB EVEControlOffline existe
  const dbExiste = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open('EVEControlOffline');
      req.onsuccess = () => { req.result.close(); resolve(true); };
      req.onerror = () => resolve(false);
    });
  });
  console.log('INDEXEDDB_EXISTE_OK:', dbExiste);

  // Verificar que window.guardarDatoFirebase existe (la función original de Firebase)
  const tieneFirebase = await page.evaluate(() => typeof window.guardarDatoFirebase === 'function');
  console.log('GUARDAR_DATO_FIREBASE_EXISTE_OK:', tieneFirebase);

  // ── Test offline ──────────────────────────────────────────────────────────
  await context.setOffline(true);
  await page.waitForTimeout(300);

  const textoOffline = await page.locator('#estado-conexion').textContent();
  console.log('HEADER_OFFLINE_OK:', textoOffline.includes('🔴'));

  // Guardar un registro offline vía guardarDato (sin red)
  const idLocal = await page.evaluate(async () => {
    return window.guardarDato('destaraje', {
      ticket: '88887799',
      proveedor: 'PRUEBA_OFFLINE_9',
      material: 'MIXTO',
      kg: 50,
      fechaEntrada: '2099-06-01',
      fechaSalida: '2099-06-05'
    });
  });
  console.log('ID_LOCAL_GENERADO_OK:', String(idLocal).startsWith('offline_'));

  // Verificar que fue a la cola de IndexedDB
  const conteoEnCola = await page.evaluate(async () => {
    const db = await window.EVE_OFFLINE.contarPendientes();
    return db;
  });
  console.log('COLA_TIENE_1_PENDIENTE_OK:', conteoEnCola === 1);

  // Verificar que el header refleja 1 pendiente
  const textoOffline2 = await page.locator('#estado-conexion').textContent();
  console.log('HEADER_OFFLINE_1_PENDIENTE_OK:', textoOffline2.includes('1 pendientes'));

  // Panel de pendientes aparece al hacer clic en el header rojo
  await page.click('#estado-conexion');
  await page.waitForTimeout(200);
  const panelAbierto = await page.locator('#panel-pendientes.open').isVisible();
  console.log('PANEL_PENDIENTES_ABIERTO_OK:', panelAbierto);

  const panelTexto = await page.locator('#pp-lista').textContent();
  console.log('PANEL_MUESTRA_DESTARAJE_OK:', panelTexto.includes('destaraje'));

  // Cerrar panel
  await page.click('#pp-cerrar');
  const panelCerrado = await page.locator('#panel-pendientes.open').isVisible();
  console.log('PANEL_CERRADO_OK:', !panelCerrado);

  // ── Volver Online y verificar sync ───────────────────────────────────────
  await context.setOffline(false);
  await page.waitForTimeout(4000); // espera sync + 3s de "Sincronizado"

  const textoFinal = await page.locator('#estado-conexion').textContent();
  console.log('HEADER_ONLINE_TRAS_SYNC_OK:', textoFinal.includes('🟢') || textoFinal.includes('✅'));

  // Verificar que la cola quedó vacía
  const colaFinal = await page.evaluate(() => window.EVE_OFFLINE.contarPendientes());
  console.log('COLA_VACIA_TRAS_SYNC_OK:', colaFinal === 0);

  // Verificar que el registro llegó a Firestore
  const enFirestore = await page.evaluate(async () => {
    const snap = await window.db.collection('destaraje')
      .where('proveedor', '==', 'PRUEBA_OFFLINE_9')
      .limit(1)
      .get();
    return !snap.empty;
  });
  console.log('REGISTRO_EN_FIRESTORE_OK:', enFirestore);

  // Limpieza: eliminar el registro de prueba de Firestore
  await page.evaluate(async () => {
    const snap = await window.db.collection('destaraje')
      .where('proveedor', '==', 'PRUEBA_OFFLINE_9')
      .limit(1)
      .get();
    if (!snap.empty) await snap.docs[0].ref.delete();
  });

  const eliminado = await page.evaluate(async () => {
    const snap = await window.db.collection('destaraje')
      .where('proveedor', '==', 'PRUEBA_OFFLINE_9')
      .limit(1)
      .get();
    return snap.empty;
  });
  console.log('LIMPIEZA_FIRESTORE_OK:', eliminado);

  // Verificar manifest.json accesible
  const manifestResp = await page.evaluate(async () => {
    const r = await fetch('/manifest.json');
    return r.ok;
  });
  console.log('MANIFEST_ACCESIBLE_OK:', manifestResp);

  // Verificar SW registrado
  const swRegistrado = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.length > 0;
  });
  console.log('SW_REGISTRADO_OK:', swRegistrado);

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
