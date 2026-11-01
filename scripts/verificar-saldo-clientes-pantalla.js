// Tarjeta de saldo a favor por cliente en CxC (js/cxc.js), con la misma presentación que Por Proveedor en CxP.
// Monta el módulo real en un navegador (Playwright) con un Firestore simulado en memoria y comprueba:
//  - render sin saldo, con saldo y deuda, con saldo y sin deuda (cliente con tarjeta aunque su saldo pendiente sea 0);
//  - chip verde, desplegable de movimientos (colapsado por defecto) y historial colapsable cuando el saldo ya se consumió;
//  - línea informativa "Saldo a favor de clientes" que NO se resta de Total por Cobrar General;
//  - permisos: sin escritura en cxc no hay Aplicar, Revertir ni Registrar Pago;
//  - aplicar el saldo a cuentas (abono + movimiento negativo) y revertir un anticipo (con su bloqueo si ya se aplicó).
//
// Uso: node scripts/verificar-saldo-clientes-pantalla.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/ordenar-tabla.js', 'js/cxp.js', 'js/saldo-clientes.js', 'js/cxc.js'];
const MSG_CONSUMIDO = 'Este anticipo ya fue aplicado a otra cuenta. Revierte primero ese abono';

const cuenta = (id, cliente, folio, total, fecha) => ({
  id, ventaId: 'v' + id, cliente, folio, material: 'PET', cantidad: 10, unidad: 'KG', precioUnitario: total / 10, total, pagado: 0, saldo: total,
  estado: 'pendiente', fechaVenta: fecha, abonos: [], abonosRevertidos: []
});
const mov = (monto, fecha, grupoPagoId, motivo, extra) => ({ monto, fecha, grupoPagoId, motivo, revertido: false, ...extra });
const anticipoCobro = (id, cliente, monto, grupoPagoId) => ({ id, cliente, folio: 'V-1', pagado: monto, origen: 'anticipo', cxcId: '', grupoPagoId, fecha: '2026-11-01', revertido: false });

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function nuevaPagina(browser, { cuentas = [], clientes = [], cobros = [], escritura = true } = {}) {
  const page = await browser.newPage();
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ cs, cl, co, escritura }) => {
    window.mensajes = { error: [], exito: [] };
    const guardado = { cuentas_por_cobrar: new Map(), clientes: new Map(), cobros: new Map() };
    cs.forEach((c) => guardado.cuentas_por_cobrar.set(c.id, JSON.parse(JSON.stringify(c))));
    cl.forEach((c) => guardado.clientes.set(c.nombre, JSON.parse(JSON.stringify(c))));
    co.forEach((c) => guardado.cobros.set(c.id, JSON.parse(JSON.stringify(c))));
    window.guardado = guardado;
    const copia = (o) => JSON.parse(JSON.stringify(o));
    const snap = (r) => ({ exists: guardado[r.col].has(r.id), id: r.id, data: () => copia(guardado[r.col].get(r.id)) });
    window.db = {
      collection: (col) => ({ doc: (id) => ({ col, id, get: async function () { return snap(this); } }) }),
      runTransaction: async (fn) => {
        const escrituras = [];
        const tx = {
          get: async (r) => snap(r),
          set: (r, d, op) => escrituras.push(() => guardado[r.col].set(r.id, op && op.merge ? { ...(guardado[r.col].get(r.id) || {}), ...copia(d) } : copia(d))),
          update: (r, d) => escrituras.push(() => guardado[r.col].set(r.id, { ...guardado[r.col].get(r.id), ...copia(d) }))
        };
        const resultado = await fn(tx);
        escrituras.forEach((e) => e());
        return resultado;
      }
    };
    window.actualizarDato = async (col, id, cambios) => { guardado[col].set(id, { ...guardado[col].get(id), ...copia(cambios) }); };
    window.guardarDato = async (col, d) => { const id = col + '_n' + (guardado[col].size + 1); guardado[col].set(id, copia(d)); return id; };
    window.confirmaciones = [];
    window.respuestaConfirm = true;
    window.confirm = (t) => { window.confirmaciones.push(t); return window.respuestaConfirm; };
    window.puedeEscribir = () => escritura;
    window.puedeLeer = () => true;
    window.showError = (m) => window.mensajes.error.push(m);
    window.showSuccess = (m) => window.mensajes.exito.push(m);
    window.EVE_HISTORIAL = { registrar: async () => {} };
    window.obtenerFechaMexico = () => '2026-11-02';
    window.prompt = () => 'motivo de prueba';
    window.EVE = {
      currentUser: { username: 'prueba' }, cuentasPorCobrar: copia(cs), clientes: copia(cl), cobros: copia(co),
      ventas: [], registrosVentas: [], proveedores: []
    };
    window.EVE_MODULES.cxc.render(document.getElementById('main-content'));
  }, { cs: cuentas, cl: clientes, co: cobros, escritura });
  return page;
}

const textoPagina = async (page) => (await page.textContent('#main-content')).replace(/\s+/g, ' ');
const botones = (page) => page.$$eval('#main-content button', (bs) => bs.map((b) => b.textContent.trim()));

caso('sin saldo a favor: no hay chip, ni Ver Movimientos, ni Aplicar, ni línea informativa', async (browser) => {
  const page = await nuevaPagina(browser, { cuentas: [cuenta('c1', 'ACME', 'V-1', 1000, '2026-10-01')] });
  const t = await textoPagina(page);
  afirmar(!t.includes('Saldo a favor'), 'no menciona saldo a favor');
  afirmar(!(await botones(page)).some((b) => b.includes('Movimientos') || b.includes('Aplicar saldo')), 'sin botones de saldo');
  afirmar(t.includes('Total por Cobrar General: $1,000.00'), 'total por cobrar intacto');
  await page.close();
});

caso('con saldo y deuda: chip verde, Ver Movimientos colapsado, Aplicar saldo a favor y línea informativa que no se resta del total', async (browser) => {
  const page = await nuevaPagina(browser, {
    cuentas: [cuenta('c1', 'ACME', 'V-1', 1000, '2026-10-01')],
    clientes: [{ id: 'ACME', nombre: 'ACME', saldoAFavor: [mov(1696, '2026-11-01', 'g1', 'Sobrante de cobro folio V-9'), mov(300, '2026-10-20', 'g0', 'viejo', { revertido: true, revertidoMotivo: 'error' })] }]
  });
  const t = await textoPagina(page);
  afirmar(t.includes('✅ ACME — Saldo a favor: $1,696.00 (se aplicará a la próxima venta)'), 'chip verde: ' + t.slice(0, 300));
  afirmar(await page.$('.chip-ok'), 'usa la clase chip-ok de CxP');
  const bs = await botones(page);
  afirmar(bs.includes('Ver Movimientos (2)'), 'Ver Movimientos (2) (cuenta también el revertido)');
  afirmar(bs.includes('Aplicar saldo a favor') && bs.includes('Registrar Pago'), 'botones Aplicar y Registrar Pago');
  afirmar(!(await page.$('#cxc-tabla-saldo-favor-ACME')), 'la tabla de movimientos está colapsada por defecto');
  afirmar(t.includes('Total por Cobrar General: $1,000.00'), 'Total por Cobrar General no resta el saldo a favor');
  igual((await page.textContent('#cxc-resumen-saldo-favor')).trim(), 'Saldo a favor de clientes: $1,696.00', 'línea informativa (sin contar revertidos)');
  await page.locator('button', { hasText: 'Ver Movimientos' }).click();
  await page.waitForSelector('#cxc-tabla-saldo-favor-ACME');
  const filas = await page.$$eval('#cxc-tabla-saldo-favor-ACME tr', (rs) => rs.map((r) => Array.from(r.cells).map((c) => c.textContent.trim())));
  igual(filas.map((f) => [f[1], f[3]]), [['$1,696.00', 'Activo'], ['$300.00', 'Revertido — error']], 'movimientos, más reciente primero');
  igual(filas[0][4], 'Revertir', 'botón Revertir en el anticipo activo');
  igual(filas[1][4], '', 'sin Revertir en el revertido');
  await page.locator('button', { hasText: 'Ocultar Movimientos' }).click();
  afirmar(!(await page.$('#cxc-tabla-saldo-favor-ACME')), 'se vuelve a colapsar');
  await page.close();
});

caso('con saldo y sin deuda: el cliente aparece con tarjeta y Registrar Pago, tenga o no CxC', async (browser) => {
  const liquidada = { ...cuenta('c1', 'ACME', 'V-1', 500, '2026-10-01'), pagado: 500, saldo: 0, estado: 'liquidado' };
  const page = await nuevaPagina(browser, {
    cuentas: [liquidada],
    clientes: [
      { id: 'ACME', nombre: 'ACME', saldoAFavor: [mov(200, '2026-11-01', 'g1', 'Sobrante')] },
      { id: 'BETA', nombre: 'BETA', saldoAFavor: [mov(300, '2026-11-01', 'g2', 'Sobrante')] },
      { id: 'GAMA', nombre: 'GAMA', saldoAFavor: [mov(0.005, '2026-11-01', 'g3', 'residuo')] }
    ]
  });
  const t = await textoPagina(page);
  afirmar(t.includes('ACME') && t.includes('BETA'), 'ACME (CxC liquidada) y BETA (sin CxC) tienen tarjeta');
  afirmar(!t.includes('GAMA'), 'saldo de 0.005 no cuenta (umbral 0.01)');
  igual((await botones(page)).filter((b) => b === 'Registrar Pago').length, 2, 'Registrar Pago en ambas tarjetas');
  afirmar(t.includes('Total por Cobrar General: $0.00'), 'sin deuda: total por cobrar en 0');
  afirmar(t.includes('Saldo a favor de clientes: $500.00'), 'línea informativa suma ambos');
  afirmar(!t.includes('Sin saldo pendiente'), 'ya no dice Sin saldo pendiente');
  await page.locator('button', { hasText: 'Ver Detalle' }).first().click();
  await page.close();
});

caso('con el saldo ya consumido el historial queda dentro de Ver Detalle, colapsado por defecto', async (browser) => {
  const page = await nuevaPagina(browser, {
    cuentas: [cuenta('c1', 'ACME', 'V-1', 1000, '2026-10-01')],
    clientes: [{ id: 'ACME', nombre: 'ACME', saldoAFavor: [mov(500, '2026-11-01', 'g1', 'Sobrante'), mov(-500, '2026-11-02', 'g2', 'Aplicado')] }]
  });
  const t = await textoPagina(page);
  afirmar(!t.includes('Saldo a favor:') && !(await botones(page)).some((b) => b.includes('Movimientos') || b.includes('Aplicar saldo')), 'sin chip ni botones con saldo 0');
  afirmar(!(await page.$('details.cxc-historial-saldo-favor')), 'el historial no se ve sin abrir el detalle');
  await page.locator('button', { hasText: 'Ver Detalle' }).click();
  await page.waitForSelector('details.cxc-historial-saldo-favor');
  igual(await page.$eval('details.cxc-historial-saldo-favor', (d) => d.open), false, 'cerrado por defecto');
  igual((await page.textContent('details.cxc-historial-saldo-favor > summary')).trim(), 'Historial de movimientos de saldo a favor (2)', 'título');
  await page.locator('details.cxc-historial-saldo-favor > summary').click();
  igual(await page.$$eval('#cxc-tabla-saldo-favor-ACME tr', (rs) => rs.length), 2, 'abre con sus 2 movimientos');
  await page.close();
});

caso('sin escritura en cxc: no se muestran Aplicar, Revertir ni Registrar Pago', async (browser) => {
  const page = await nuevaPagina(browser, {
    cuentas: [cuenta('c1', 'ACME', 'V-1', 1000, '2026-10-01')],
    clientes: [{ id: 'ACME', nombre: 'ACME', saldoAFavor: [mov(400, '2026-11-01', 'g1', 'Sobrante')] }],
    escritura: false
  });
  const bs = await botones(page);
  afirmar(bs.includes('Ver Movimientos (1)'), 'sí puede ver los movimientos');
  afirmar(!bs.includes('Aplicar saldo a favor') && !bs.includes('Registrar Pago'), 'sin Aplicar ni Registrar Pago');
  await page.locator('button', { hasText: 'Ver Movimientos' }).click();
  await page.waitForSelector('#cxc-tabla-saldo-favor-ACME');
  afirmar(!(await botones(page)).includes('Revertir'), 'sin Revertir');
  await page.close();
});

caso('aplicar: el modal sugiere el reparto, escribe abono + movimiento negativo con lectura fresca y actualiza la pantalla', async (browser) => {
  const page = await nuevaPagina(browser, {
    cuentas: [cuenta('c1', 'ACME', 'V-1', 300, '2026-10-01'), cuenta('c2', 'ACME', 'V-2', 400, '2026-10-05')],
    clientes: [{ id: 'ACME', nombre: 'ACME', saldoAFavor: [mov(500, '2026-11-01', 'g1', 'Sobrante')] }],
    cobros: [anticipoCobro('k1', 'ACME', 500, 'g1')]
  });
  await page.locator('button', { hasText: 'Aplicar saldo a favor' }).click();
  await page.waitForSelector('#cxc-aplicar-saldo-overlay');
  const filas = await page.$$eval('#cxc-aplicar-saldo-overlay tbody tr', (rs) => rs.map((r) => [r.cells[1].textContent, r.cells[3].textContent, r.querySelector('input[type=number]').value]));
  igual(filas, [['V-1', '$300.00', '300'], ['V-2', '$400.00', '200']], 'sugerido: la más antigua primero hasta agotar el saldo');
  igual(await page.$eval('#cxc-aplicar-saldo-confirmar', (b) => b.disabled), false, 'Confirmar habilitado');
  await page.fill('#cxc-aplicar-saldo-overlay tbody tr:nth-child(2) input[type=number]', '250');
  afirmar((await page.textContent('#cxc-aplicar-saldo-total')).includes('excede'), 'avisa si excede el saldo');
  igual(await page.$eval('#cxc-aplicar-saldo-confirmar', (b) => b.disabled), true, 'Confirmar deshabilitado si excede');
  await page.fill('#cxc-aplicar-saldo-overlay tbody tr:nth-child(2) input[type=number]', '200');
  // Otra sesión consumió 100 del saldo: la validación usa Firestore, no la memoria.
  await page.evaluate(() => {
    const d = window.guardado.clientes.get('ACME');
    d.saldoAFavor.push({ monto: -100, fecha: '2026-11-02', motivo: 'otra sesión', grupoPagoId: 'gX', revertido: false });
  });
  await page.click('#cxc-aplicar-saldo-confirmar');
  await page.waitForFunction(() => window.mensajes.error.length > 0);
  afirmar((await page.evaluate(() => window.mensajes.error[0])).includes('excede el saldo a favor disponible'), 'rechaza por lectura fresca');
  igual(await page.evaluate(() => window.guardado.cuentas_por_cobrar.get('c1').abonos.length), 0, 'no escribió nada');
  await page.fill('#cxc-aplicar-saldo-overlay tbody tr:nth-child(2) input[type=number]', '100');
  await page.fill('#cxc-aplicar-saldo-overlay tbody tr:nth-child(1) input[type=number]', '300');
  await page.click('#cxc-aplicar-saldo-confirmar');
  await page.waitForFunction(() => window.mensajes.exito.length > 0);
  const r = await page.evaluate(() => ({
    c1: window.guardado.cuentas_por_cobrar.get('c1'), c2: window.guardado.cuentas_por_cobrar.get('c2'),
    movs: window.guardado.clientes.get('ACME').saldoAFavor, cobros: window.guardado.cobros.size
  }));
  igual([r.c1.saldo, r.c1.estado, r.c1.abonos[0].referencia, r.c2.saldo], [0, 'liquidado', 'Saldo a favor aplicado', 300], 'cuentas');
  igual(r.movs.slice(2).map((m) => m.monto), [-300, -100], 'movimientos negativos, uno por cuenta');
  igual([r.movs[2].grupoPagoId === r.c1.abonos[0].grupoPagoId, r.movs[3].grupoPagoId === r.c2.abonos[0].grupoPagoId], [true, true], 'mismo grupoPagoId abono-movimiento');
  igual(r.cobros, 1, 'no se crea cobro (solo el anticipo sembrado)');
  afirmar(!(await page.$('#cxc-aplicar-saldo-overlay')), 'el modal se cierra');
  await page.close();
});

caso('revertir: el anticipo se revierte junto con su cobro; si ya se aplicó se bloquea con el mensaje de CxP', async (browser) => {
  const page = await nuevaPagina(browser, {
    cuentas: [cuenta('c1', 'ACME', 'V-1', 800, '2026-10-01')],
    clientes: [{ id: 'ACME', nombre: 'ACME', saldoAFavor: [mov(500, '2026-11-01', 'g1', 'Sobrante')] }],
    cobros: [anticipoCobro('k1', 'ACME', 500, 'g1')]
  });
  // Consumido: bloquea y no modifica nada.
  await page.evaluate(() => { window.guardado.clientes.get('ACME').saldoAFavor.push({ monto: -200, fecha: '2026-11-02', motivo: 'aplicado', grupoPagoId: 'gA', revertido: false }); });
  await page.locator('button', { hasText: 'Ver Movimientos' }).click();
  await page.waitForSelector('#cxc-tabla-saldo-favor-ACME');
  await page.locator('#cxc-tabla-saldo-favor-ACME button', { hasText: 'Revertir' }).click();
  await page.waitForFunction(() => window.mensajes.error.length > 0);
  afirmar((await page.evaluate(() => window.mensajes.error[0])).includes(MSG_CONSUMIDO), 'mensaje de bloqueo');
  igual(await page.evaluate(() => [window.guardado.clientes.get('ACME').saldoAFavor[0].revertido, window.guardado.cobros.get('k1').revertido]), [false, false], 'nada revertido');
  // Libre: se revierte movimiento y cobro anticipo.
  await page.evaluate(() => { window.guardado.clientes.get('ACME').saldoAFavor.pop(); window.mensajes.error.length = 0; });
  await page.locator('#cxc-tabla-saldo-favor-ACME button', { hasText: 'Revertir' }).click();
  await page.waitForFunction(() => window.mensajes.exito.length > 0);
  igual(await page.evaluate(() => [window.guardado.clientes.get('ACME').saldoAFavor[0].revertido, window.guardado.cobros.get('k1').revertido, window.guardado.cobros.size]), [true, true, 1], 'movimiento y cobro anticipo revertidos, sin borrar');
  afirmar(!(await botones(page)).some((b) => b.includes('Movimientos')), 'el chip desaparece al quedar sin saldo');
  await page.close();
});

const llenarAnticipo = async (page, { cliente, monto, nota = '' }) => {
  await page.click('#cxc-anticipo-abrir');
  await page.waitForSelector('#cxc-anticipo-overlay.open');
  await page.fill('#cxc-anticipo-cliente', cliente);
  await page.fill('#cxc-anticipo-monto', String(monto));
  await page.selectOption('#cxc-anticipo-referencia', 'Transferencia');
  if (nota) await page.fill('#cxc-anticipo-nota', nota);
};

caso('botón Registrar anticipo de cliente: arriba de las pestañas y solo con escritura en cxc', async (browser) => {
  const page = await nuevaPagina(browser, { cuentas: [cuenta('c1', 'ACME', 'V-1', 1000, '2026-10-01')] });
  const orden = await page.evaluate(() => {
    const barra = document.querySelector('#cxc-barra-anticipo');
    const tabs = document.querySelector('#cxc-tabs-principales');
    return { hay: !!document.querySelector('#cxc-anticipo-abrir'), antes: !!(barra.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING), texto: document.querySelector('#cxc-anticipo-abrir').textContent };
  });
  igual(orden, { hay: true, antes: true, texto: 'Registrar anticipo de cliente' }, 'botón arriba de Por Cliente / Todos');
  await page.close();
  const sinPermiso = await nuevaPagina(browser, { cuentas: [cuenta('c1', 'ACME', 'V-1', 1000, '2026-10-01')], escritura: false });
  afirmar(!(await sinPermiso.$('#cxc-anticipo-abrir')), 'sin escritura no hay botón');
  await sinPermiso.close();
});

caso('anticipo a un cliente SIN tarjeta (ABRAHAM): se registra, aparece su tarjeta aunque no tenga deuda y la línea informativa se actualiza', async (browser) => {
  const page = await nuevaPagina(browser, {
    cuentas: [cuenta('c1', 'ACME', 'V-1', 1000, '2026-10-01')],
    clientes: []
  });
  afirmar(!(await textoPagina(page)).includes('ABRAHAM'), 'ABRAHAM no tiene tarjeta al inicio');
  await page.locator('#cxc-tabs-periodo-cliente button', { hasText: 'Hoy' }).click();
  await llenarAnticipo(page, { cliente: ' abraham ', monto: 1696, nota: 'sobrante venta V-2026-053' });
  await page.click('#cxc-anticipo-guardar');
  await page.waitForFunction(() => window.mensajes.exito.length > 0);
  const confirmacion = await page.evaluate(() => window.confirmaciones[0]);
  afirmar(confirmacion.includes('ABRAHAM') && confirmacion.includes('$1,696.00') && confirmacion.includes('saldo a favor'), 'confirmación con cliente y monto: ' + confirmacion);
  afirmar((await page.evaluate(() => window.mensajes.exito[0])).includes('saldo a favor de ABRAHAM'), 'aviso de éxito');
  const t = await textoPagina(page);
  afirmar(t.includes('✅ ABRAHAM — Saldo a favor: $1,696.00 (se aplicará a la próxima venta)'), 'chip verde: ' + t.slice(0, 260));
  const bs = await botones(page);
  afirmar(bs.includes('Ver Movimientos (1)') && bs.includes('Registrar Pago'), 'Ver Movimientos y Registrar Pago');
  igual((await page.textContent('#cxc-resumen-saldo-favor')).trim(), 'Saldo a favor de clientes: $1,696.00', 'línea informativa actualizada');
  igual(await page.$eval('#cxc-tabs-periodo-cliente .tab.active', (b) => b.textContent), 'Todos', 'la vista pasó a Por Cliente → Todos para que se vea la tarjeta');
  const r = await page.evaluate(() => ({
    cobros: [...window.guardado.cobros.values()], cliente: window.guardado.clientes.get('ABRAHAM'), cerrado: !document.querySelector('#cxc-anticipo-overlay.open')
  }));
  igual([r.cobros.length, r.cobros[0].origen, r.cobros[0].cxcId, r.cobros[0].pagado, r.cobros[0].referencia, r.cobros[0].nota], [1, 'anticipo', '', 1696, 'Transferencia', 'sobrante venta V-2026-053'], 'cobro anticipo');
  igual([r.cliente.saldoAFavor[0].monto, r.cliente.saldoAFavor[0].motivo, r.cliente.saldoAFavor[0].grupoPagoId === r.cobros[0].grupoPagoId, r.cerrado], [1696, 'Anticipo de cliente: sobrante venta V-2026-053', true, true], 'movimiento positivo, mismo grupoPagoId y modal cerrado');
  afirmar(t.includes('Total por Cobrar General: $1,000.00'), 'Total por Cobrar General no cambia');
  await page.close();
});

caso('anticipo a un cliente CON deuda: el monto no toca sus cuentas, queda íntegro como saldo a favor', async (browser) => {
  const page = await nuevaPagina(browser, { cuentas: [cuenta('c1', 'ACME', 'V-1', 1000, '2026-10-01')] });
  await llenarAnticipo(page, { cliente: 'acme', monto: 400 });
  await page.click('#cxc-anticipo-guardar');
  await page.waitForFunction(() => window.mensajes.exito.length > 0);
  const r = await page.evaluate(() => ({ c: window.guardado.cuentas_por_cobrar.get('c1'), mem: window.EVE.cuentasPorCobrar[0], cobros: window.guardado.cobros.size }));
  igual([r.c.saldo, r.c.pagado, r.c.abonos.length, r.mem.saldo, r.cobros], [1000, 0, 0, 1000, 1], 'cuenta intacta; solo el documento anticipo');
  const t = await textoPagina(page);
  afirmar(t.includes('✅ ACME — Saldo a favor: $400.00'), 'chip en la tarjeta de ACME');
  afirmar(t.includes('Total por Cobrar General: $1,000.00'), 'el total por cobrar sigue en 1,000');
  const bs = await botones(page);
  afirmar(bs.includes('Aplicar saldo a favor'), 'ya puede aplicarlo a sus cuentas cuando quiera');
  await page.close();
});

caso('confirmación cancelada: no se guarda nada y el formulario sigue abierto', async (browser) => {
  const page = await nuevaPagina(browser, { cuentas: [cuenta('c1', 'ACME', 'V-1', 1000, '2026-10-01')] });
  await page.evaluate(() => { window.respuestaConfirm = false; });
  await llenarAnticipo(page, { cliente: 'ACME', monto: 250 });
  await page.click('#cxc-anticipo-guardar');
  await page.waitForFunction(() => window.confirmaciones.length > 0);
  const r = await page.evaluate(() => ({ cobros: window.guardado.cobros.size, clientes: window.guardado.clientes.size, abierto: !!document.querySelector('#cxc-anticipo-overlay.open'), exito: window.mensajes.exito.length }));
  igual(r, { cobros: 0, clientes: 0, abierto: true, exito: 0 }, 'nada guardado, modal abierto');
  igual(await page.$eval('#cxc-anticipo-guardar', (b) => b.disabled), false, 'Guardar se puede volver a usar');
  // Se puede reintentar y confirmar.
  await page.evaluate(() => { window.respuestaConfirm = true; });
  await page.click('#cxc-anticipo-guardar');
  await page.waitForFunction(() => window.mensajes.exito.length > 0);
  igual(await page.evaluate(() => window.guardado.cobros.size), 1, 'tras confirmar sí se guarda (una sola vez)');
  await page.close();
});

caso('autocompletado: nombres de ventas y CxC normalizados y sin repetir; se puede escribir un cliente nuevo', async (browser) => {
  const page = await nuevaPagina(browser, { cuentas: [cuenta('c1', 'ACME', 'V-1', 1000, '2026-10-01')] });
  await page.evaluate(() => { window.EVE.ventas = [{ cliente: 'acme ' }, { cliente: 'Beta  ' }, { cliente: '' }]; });
  await page.click('#cxc-anticipo-abrir');
  igual(await page.$$eval('#cxc-anticipo-clientes option', (os) => os.map((o) => o.value)), ['ACME', 'BETA'], 'opciones normalizadas, únicas y ordenadas');
  await page.close();
});

caso('revertir el anticipo manual desde Ver Movimientos: se revierte con su cobro y la tarjeta desaparece', async (browser) => {
  const page = await nuevaPagina(browser, {});
  await llenarAnticipo(page, { cliente: 'ABRAHAM', monto: 300 });
  await page.click('#cxc-anticipo-guardar');
  await page.waitForFunction(() => window.mensajes.exito.length > 0);
  await page.locator('button', { hasText: 'Ver Movimientos' }).click();
  await page.waitForSelector('#cxc-tabla-saldo-favor-ABRAHAM');
  await page.evaluate(() => { window.mensajes.exito.length = 0; });
  await page.locator('#cxc-tabla-saldo-favor-ABRAHAM button', { hasText: 'Revertir' }).click();
  await page.waitForFunction(() => window.mensajes.exito.length > 0);
  igual(await page.evaluate(() => [window.guardado.clientes.get('ABRAHAM').saldoAFavor[0].revertido, [...window.guardado.cobros.values()][0].revertido]), [true, true], 'movimiento y cobro anticipo revertidos');
  afirmar(!(await textoPagina(page)).includes('ABRAHAM'), 'sin saldo ni deuda, la tarjeta desaparece');
  afirmar(!(await page.$('#cxc-resumen-saldo-favor')), 'la línea informativa desaparece');
  await page.close();
});

(async () => {
  const browser = await chromium.launch();
  let fallidos = 0;
  for (const c of casos) {
    try { await c.fn(browser); console.log('ok   ' + c.nombre); } catch (e) { fallidos++; console.error('FALLA ' + c.nombre + ': ' + e.message); }
  }
  await browser.close();
  console.log(`\n${casos.length - fallidos}/${casos.length} casos correctos`);
  process.exit(fallidos ? 1 : 0);
})();
