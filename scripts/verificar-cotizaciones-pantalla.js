// Prueba en navegador (Chromium de Playwright) de la pantalla de Cotizaciones con un Firestore simulado dentro de la página:
// obligatorios con mensaje y marcado por campo, autocompletar cliente, partidas dinámicas, totales en vivo, guardado con
// folio, edición sin cambiar el folio, texto libre escapado y modo solo lectura. No usa la red ni Firebase real.
//
// Uso: node scripts/verificar-cotizaciones-pantalla.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/cotizaciones.js'];

// Firestore mínimo en la página: documentos por ruta, get/set (merge) y runTransaction.
const FIREBASE_SIMULADO = () => {
  window.firebase = {
    initializeApp() {},
    firestore() { return { enablePersistence() { return Promise.resolve(); } }; },
    auth() { return { onAuthStateChanged() {} }; }
  };
  window.EVE = { currentUser: null, cotizaciones: [], clientesCotizacion: [] };
  window.EVE_MODULES = {};
};

const PREPARAR_DB = () => {
  const docs = new Map();
  let auto = 0;
  const instantanea = (ruta) => { const d = docs.get(ruta); return { exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) }; };
  const escribir = (ruta, datos, opciones) => docs.set(ruta, { ...(opciones && opciones.merge && docs.get(ruta) ? docs.get(ruta) : {}), ...JSON.parse(JSON.stringify(datos)) });
  const ref = (ruta) => ({ ruta, id: ruta.split('/')[1], get: async () => instantanea(ruta), set: async (d, o) => escribir(ruta, d, o) });
  window.__docs = docs;
  window.db = {
    collection: (c) => ({ doc: (id) => ref(`${c}/${id === undefined ? `auto${++auto}` : id}`) }),
    async runTransaction(fn) {
      const escrituras = [];
      const tx = { get: async (r) => instantanea(r.ruta), set: (r, d, o) => escrituras.push([r.ruta, d, o]), delete: (r) => escrituras.push([r.ruta, null, { borrar: true }]) };
      const resultado = await fn(tx);
      escrituras.forEach(([ruta, d, o]) => (o && o.borrar ? docs.delete(ruta) : escribir(ruta, d, o)));
      return resultado;
    }
  };
  docs.set('config/emisor', { razonSocial: 'RIVAL PLASTIC SAPI DE CV', vigenciaDias: 20, condicionesPagoDefault: 'Contado', condicionesEntregaDefault: 'En planta' });
};

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function nuevaPagina(browser, permiso) {
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(FIREBASE_SIMULADO);
  await page.addStyleTag({ path: path.join(RAIZ, 'css/styles.css') });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(PREPARAR_DB);
  await page.evaluate((p) => {
    window.EVE.currentUser = { username: 'ventas1', permisosResueltos: { cotizaciones: p } };
    window.EVE.clientesCotizacion = [{ id: 'ACME-SA', razonSocial: 'ACME SA', contacto: 'Rosa Díaz', telefono: '5551112222', direccion: 'Calle Falsa 123' }];
    window.EVE_MODULES.cotizaciones.render(document.getElementById('main-content'));
  }, permiso);
  page.erroresPagina = errores;
  return page;
}

const textos = (page, selector) => page.$$eval(selector, (nodos) => nodos.map((n) => n.textContent.trim()));

caso('obligatorios: no guarda y marca cada campo de cliente con su mensaje', async (browser) => {
  const page = await nuevaPagina(browser, 'escritura');
  await page.click('text=+ Nueva cotización');
  await page.click('button[type="submit"]');
  const mensajes = await page.$$eval('[data-error^="cliente."]', (n) => n.map((x) => x.textContent));
  igual(mensajes, ['La Razón Social es obligatoria', 'El Contacto es obligatorio', 'El Teléfono es obligatorio', 'La Dirección es obligatoria'], 'mensajes por campo');
  igual(await page.$$eval('.campo-invalido[data-campo^="cliente."]', (n) => n.length), 4, 'campos marcados en rojo');
  afirmar(await page.$eval('.toast-error', (n) => n.textContent.includes('Revisa')), 'falta el aviso general');
  igual(await page.evaluate(() => Array.from(window.__docs.keys()).filter((k) => k.startsWith('cotizaciones/') || k.startsWith('contadores/')).length), 0, 'no debe escribir nada');
  const errPartida = await textos(page, '.cot-partida .cot-error');
  afirmar(errPartida.some((t) => t.includes('cantidad')) && errPartida.some((t) => t.includes('precio')), 'faltan mensajes de la partida');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('autocompletar: elegir un cliente existente rellena contacto, teléfono y dirección; defaults del emisor', async (browser) => {
  const page = await nuevaPagina(browser, 'escritura');
  await page.click('text=+ Nueva cotización');
  igual(await page.$$eval('#cot-clientes-lista option', (o) => o.map((x) => x.value)), ['ACME SA'], 'datalist de clientes');
  await page.fill('[data-campo="cliente.razonSocial"]', 'acme, s.a.');
  await page.dispatchEvent('[data-campo="cliente.razonSocial"]', 'change');
  igual(await page.$$eval('[data-campo="cliente.contacto"],[data-campo="cliente.telefono"],[data-campo="cliente.direccion"]', (n) => n.map((x) => x.value)), ['', '', ''], 'sin coincidencia exacta no rellena');
  await page.fill('[data-campo="cliente.razonSocial"]', 'ACME SA');
  await page.dispatchEvent('[data-campo="cliente.razonSocial"]', 'change');
  igual(await page.$$eval('[data-campo="cliente.contacto"],[data-campo="cliente.telefono"],[data-campo="cliente.direccion"]', (n) => n.map((x) => x.value)), ['Rosa Díaz', '5551112222', 'Calle Falsa 123'], 'campos rellenados');
  igual(await page.$$eval('[data-campo="vigenciaDias"],[data-campo="condicionesPago"],[data-campo="condicionesEntrega"]', (n) => n.map((x) => x.value)), ['20', 'Contado', 'En planta'], 'defaults del emisor');
  afirmar(/^\d{2}\/\d{2}\/\d{4}$/.test(await page.inputValue('[data-campo="fecha"]')), 'la fecha debe verse dd/mm/aaaa');
});

caso('partidas dinámicas y totales en vivo (descuento e IVA)', async (browser) => {
  const page = await nuevaPagina(browser, 'escritura');
  await page.click('text=+ Nueva cotización');
  igual(await page.$eval('.cot-quitar', (b) => b.disabled), true, 'con una sola partida no se puede quitar');
  const opciones = await page.$$eval('.cot-partida select[data-f="producto"] option', (o) => o.map((x) => x.value));
  afirmar(opciones.includes('TAMBO') && opciones.includes('__LIBRE__') && opciones.includes('LECHERO LAVADO'), 'el producto sale del catálogo y hay descripción libre');
  await page.selectOption('.cot-partida select[data-f="producto"]', 'TAMBO');
  igual(await page.inputValue('.cot-partida select[data-f="unidad"]'), 'PZ', 'unidad del catálogo');
  await page.fill('.cot-partida [data-f="cantidad"]', '10');
  await page.fill('.cot-partida [data-f="precioUnitario"]', '100');
  await page.fill('.cot-partida [data-f="descuentoPct"]', '10');
  igual(await page.textContent('.cot-importe'), '$900.00', 'importe con descuento');
  await page.click('text=+ Agregar partida');
  igual(await page.$$eval('.cot-partida', (f) => f.length), 2, 'segunda partida');
  const fila2 = '.cot-partida:nth-child(2)';
  await page.selectOption(`${fila2} select[data-f="producto"]`, '__LIBRE__');
  afirmar(await page.isVisible(`${fila2} [data-f="descripcion"]`), 'descripción libre visible');
  await page.fill(`${fila2} [data-f="descripcion"]`, 'Flete');
  await page.fill(`${fila2} [data-f="cantidad"]`, '3');
  await page.fill(`${fila2} [data-f="precioUnitario"]`, '49.99');
  igual([await page.textContent('[data-total="subtotal"]'), await page.textContent('[data-total="iva"]'), await page.textContent('[data-total="total"]')], ['$1,049.97', '$0.00', '$1,049.97'], 'sin IVA');
  await page.check('[data-campo="aplicaIva"]');
  igual([await page.textContent('[data-total="iva"]'), await page.textContent('[data-total="total"]')], ['$168.00', '$1,217.97'], 'con IVA 16%');
  await page.click(`${fila2} .cot-quitar`);
  igual(await page.$$eval('.cot-partida', (f) => f.length), 1, 'partida quitada');
  igual(await page.textContent('[data-total="total"]'), '$1,044.00', 'total tras quitar');
});

caso('guardar: asigna folio, queda en la lista como Borrador y el cliente se guarda; XSS escapado', async (browser) => {
  const page = await nuevaPagina(browser, 'escritura');
  await page.click('text=+ Nueva cotización');
  const xss = '<img src=x onerror="window.__xss=1">Cliente';
  await page.fill('[data-campo="cliente.razonSocial"]', xss);
  await page.fill('[data-campo="cliente.contacto"]', 'Ana');
  await page.fill('[data-campo="cliente.telefono"]', '811');
  await page.fill('[data-campo="cliente.direccion"]', '<b>Calle</b>');
  await page.selectOption('.cot-partida select[data-f="producto"]', 'TAMBO');
  await page.fill('.cot-partida [data-f="cantidad"]', '2');
  await page.fill('.cot-partida [data-f="precioUnitario"]', '50');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.tabla-destaraje tbody tr td.mono');
  const anio = await page.evaluate(() => window.obtenerFechaMexico().slice(0, 4));
  const fila = await textos(page, '.tabla-destaraje tbody tr:first-child td');
  igual([fila[0], fila[1], fila[3], fila[4]], [`COT-${anio}-0001`, xss, '$100.00', 'Borrador'], 'fila de la lista (el HTML se muestra como texto)');
  afirmar(/^\d{2}\/\d{2}\/\d{4}$/.test(fila[2]), 'fecha dd/mm/aaaa en la lista');
  igual(await page.evaluate(() => window.__xss), undefined, 'el HTML del cliente no debe ejecutarse');
  igual(await page.$$eval('.tabla-destaraje img, .tabla-destaraje b', (n) => n.length), 0, 'no debe crear elementos');
  igual(await page.evaluate(() => window.__docs.get(`contadores/COT-${new Date().getFullYear()}`) !== undefined || Array.from(window.__docs.keys()).some((k) => k.startsWith('contadores/COT-'))), true, 'contador creado');
  igual(await page.evaluate(() => Array.from(window.__docs.keys()).filter((k) => k.startsWith('clientes_cotizacion/'))), ['clientes_cotizacion/IMG-SRC-X-ONERROR-WINDOW-XSS-1-CLIENTE'], 'cliente guardado');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('editar un Borrador conserva el folio y actualiza la lista', async (browser) => {
  const page = await nuevaPagina(browser, 'escritura');
  await page.click('text=+ Nueva cotización');
  await page.fill('[data-campo="cliente.razonSocial"]', 'Cliente Uno');
  await page.fill('[data-campo="cliente.contacto"]', 'Ana');
  await page.fill('[data-campo="cliente.telefono"]', '811');
  await page.fill('[data-campo="cliente.direccion"]', 'Calle 1');
  await page.selectOption('.cot-partida select[data-f="producto"]', 'TAMBO');
  await page.fill('.cot-partida [data-f="cantidad"]', '1');
  await page.fill('.cot-partida [data-f="precioUnitario"]', '10');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Editar');
  await page.click('.tabla-destaraje button:has-text("Editar")');
  const anio = await page.evaluate(() => window.obtenerFechaMexico().slice(0, 4));
  igual(await page.textContent('.cot-form .cot-titulo'), `Editar COT-${anio}-0001`, 'título con el folio');
  await page.fill('.cot-partida [data-f="cantidad"]', '5');
  await page.check('[data-campo="aplicaIva"]');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.cot-form').length === 0);
  const fila = await textos(page, '.tabla-destaraje tbody tr');
  igual(fila.length, 1, 'sigue habiendo una sola cotización');
  afirmar(fila[0].includes(`COT-${anio}-0001`) && fila[0].includes('$58.00'), `lista no actualizada: ${fila[0]}`);
  igual(await page.evaluate(() => window.__docs.get(Array.from(window.__docs.keys()).find((k) => k.startsWith('contadores/'))).ultimo), 1, 'el contador no avanzó al editar');
});

caso('lectura: sin botones de guardar, nueva ni editar; el formulario es solo lectura', async (browser) => {
  const page = await nuevaPagina(browser, 'lectura');
  afirmar(!(await page.isVisible('text=+ Nueva cotización')), 'lectura no debe ver Nueva cotización');
  await page.evaluate(() => {
    window.EVE.cotizaciones.push({ id: 'x1', folio: 'COT-2026-0007', estado: 'Borrador', fecha: '2026-10-01', vigenciaDias: 15, cliente: { razonSocial: 'Solo Lectura SA', contacto: 'a', telefono: '1', direccion: 'd' }, partidas: [{ producto: 'TAMBO', descripcion: '', cantidad: 1, unidad: 'PZ', precioUnitario: 5, descuentoPct: 0, importe: 5 }], totales: { subtotal: 5, aplicaIva: false, iva: 0, total: 5 } });
    window.EVE_MODULES.cotizaciones.render(document.getElementById('main-content'));
  });
  igual(await textos(page, '.tabla-destaraje button'), ['Ver'], 'solo Ver, nunca Editar');
  await page.click('button:has-text("Ver")');
  igual(await page.$$('button[type="submit"]').then((b) => b.length), 0, 'sin botón guardar');
  igual(await page.$$eval('.cot-form input:not([disabled]), .cot-form select:not([disabled]), .cot-form textarea:not([disabled])', (n) => n.length), 0, 'todos los controles deshabilitados');
  igual(await page.isVisible('text=+ Agregar partida'), false, 'sin agregar partida');
});

// ── Eliminar ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Siembra cotizaciones en el Firestore simulado y en la memoria de la pantalla, y vuelve a pintar el módulo.
async function sembrar(page, lista) {
  await page.evaluate((cotizaciones) => {
    cotizaciones.forEach(({ id, folio, estado, razon, total }) => {
      const doc = { folio, estado, fecha: '2026-10-01', vigenciaDias: 15, cliente: { razonSocial: razon, contacto: 'a', telefono: '1', direccion: 'd' }, clienteId: razon.toUpperCase().replace(/[^A-Z0-9]+/g, '-'), partidas: [{ producto: 'TAMBO', descripcion: '', cantidad: 1, unidad: 'PZ', precioUnitario: total, descuentoPct: 0, importe: total }], totales: { subtotal: total, aplicaIva: false, iva: 0, total } };
      window.__docs.set(`cotizaciones/${id}`, doc);
      window.EVE.cotizaciones.push({ id, ...doc });
    });
    window.__docs.set('contadores/COT-2026', { ultimo: cotizaciones.length });
    window.__docs.set('clientes_cotizacion/ACME-SA', { razonSocial: 'ACME SA' });
    window.EVE_MODULES.cotizaciones.render(document.getElementById('main-content'));
  }, lista);
}
const SEMILLA = [
  { id: 'b1', folio: 'COT-2026-0003', estado: 'Borrador', razon: 'ACME SA', total: 100 },
  { id: 'e1', folio: 'COT-2026-0002', estado: 'Enviada', razon: 'Otro SA', total: 50 }
];
const filaDe = (folio) => `.tabla-destaraje tbody tr:has-text("${folio}")`;
const documentosDe = (page, prefijo) => page.evaluate((p) => Array.from(window.__docs.keys()).filter((k) => k.startsWith(p)), prefijo);

caso('eliminar: Borrador con confirmación (folio + Razón Social); cancelar no borra, aceptar borra, avisa y actualiza la lista', async (browser) => {
  const page = await nuevaPagina(browser, 'escritura');
  await sembrar(page, SEMILLA);
  const mensajes = [];
  let aceptar = false;
  page.on('dialog', (d) => { mensajes.push(d.message()); return aceptar ? d.accept() : d.dismiss(); });
  await page.click(`${filaDe('COT-2026-0003')} button:has-text("Eliminar")`);
  afirmar(mensajes[0].includes('¿Eliminar COT-2026-0003 de ACME SA?'), `confirmación sin folio y cliente: ${mensajes[0]}`);
  igual(await documentosDe(page, 'cotizaciones/'), ['cotizaciones/b1', 'cotizaciones/e1'], 'cancelar no debe borrar');
  igual(await documentosDe(page, 'historial_cambios/'), [], 'cancelar no debe registrar');
  aceptar = true;
  await page.click(`${filaDe('COT-2026-0003')} button:has-text("Eliminar")`);
  await page.waitForFunction(() => !document.querySelector('.tabla-destaraje').textContent.includes('COT-2026-0003'));
  afirmar(await page.$eval('.toast-success', (n) => n.textContent.includes('COT-2026-0003 eliminada')), 'falta el aviso de éxito');
  igual(await documentosDe(page, 'cotizaciones/'), ['cotizaciones/e1'], 'solo queda la otra cotización');
  igual(await page.evaluate(() => window.__docs.get('contadores/COT-2026').ultimo), 2, 'el contador no baja');
  igual(await documentosDe(page, 'clientes_cotizacion/'), ['clientes_cotizacion/ACME-SA'], 'el cliente no se borra');
  const historial = await page.evaluate(() => Array.from(window.__docs.entries()).filter(([k]) => k.startsWith('historial_cambios/')).map(([, v]) => v));
  igual(historial.length, 1, 'una entrada de historial');
  igual([historial[0].accion, historial[0].usuario, historial[0].valorAnterior], ['eliminacion', 'ventas1', { folio: 'COT-2026-0003', cliente: 'ACME SA', total: 100, estado: 'Borrador' }], 'historial');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('eliminar: una cotización que no es Borrador muestra el botón deshabilitado con su nota', async (browser) => {
  const page = await nuevaPagina(browser, 'escritura');
  await sembrar(page, SEMILLA);
  const boton = `${filaDe('COT-2026-0002')} button:has-text("Eliminar")`;
  igual(await page.isDisabled(boton), true, 'botón deshabilitado');
  igual(await page.getAttribute(boton, 'title'), 'Solo se puede eliminar un Borrador', 'nota del botón');
  afirmar((await page.textContent(filaDe('COT-2026-0002'))).includes('Solo Borrador'), 'falta la nota visible');
  igual(await page.isDisabled(`${filaDe('COT-2026-0003')} button:has-text("Eliminar")`), false, 'el Borrador sí se puede');
});

caso('eliminar: desde el formulario de edición borra, cierra el formulario y actualiza la lista', async (browser) => {
  const page = await nuevaPagina(browser, 'escritura');
  await sembrar(page, SEMILLA);
  page.on('dialog', (d) => d.accept());
  await page.click(`${filaDe('COT-2026-0003')} button:has-text("Editar")`);
  await page.click('.cot-form button:has-text("Eliminar")');
  await page.waitForFunction(() => document.querySelectorAll('.cot-form').length === 0);
  igual(await page.$$eval('.tabla-destaraje tbody tr', (f) => f.length), 1, 'filas en la lista');
  igual(await documentosDe(page, 'cotizaciones/'), ['cotizaciones/e1'], 'cotizaciones restantes');
  igual((await documentosDe(page, 'historial_cambios/')).length, 1, 'historial registrado');
});

caso('eliminar: si otro usuario ya le cambió el estado, muestra el error, no borra y la lista pasa a deshabilitar', async (browser) => {
  const page = await nuevaPagina(browser, 'escritura');
  await sembrar(page, SEMILLA);
  page.on('dialog', (d) => d.accept());
  await page.evaluate(() => { window.__docs.get('cotizaciones/b1').estado = 'Enviada'; }); // cambio de otro usuario; la memoria aún dice Borrador
  await page.click(`${filaDe('COT-2026-0003')} button:has-text("Eliminar")`);
  await page.waitForSelector('.toast-error');
  afirmar((await page.textContent('.toast-error')).includes('Enviada'), 'el error debe mencionar el estado actual');
  igual(await documentosDe(page, 'cotizaciones/'), ['cotizaciones/b1', 'cotizaciones/e1'], 'no debe borrar');
  igual(await documentosDe(page, 'historial_cambios/'), [], 'no debe registrar');
  igual(await page.isDisabled(`${filaDe('COT-2026-0003')} button:has-text("Eliminar")`), true, 'la lista debe reflejar el estado real');
  igual(await page.evaluate(() => document.querySelectorAll('.toast-success').length), 0, 'no debe avisar éxito');
});

caso('eliminar: usuario de solo lectura no ve el botón en la lista ni en el formulario', async (browser) => {
  const page = await nuevaPagina(browser, 'lectura');
  await sembrar(page, SEMILLA);
  igual(await page.$$eval('button', (b) => b.filter((x) => x.textContent.includes('Eliminar')).length), 0, 'botones Eliminar en la lista');
  await page.click(`${filaDe('COT-2026-0003')} button:has-text("Ver")`);
  igual(await page.$$eval('button', (b) => b.filter((x) => x.textContent.includes('Eliminar')).length), 0, 'botones Eliminar en el formulario');
});

(async () => {
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(browser); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message}`); }
  }
  await browser.close();
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
