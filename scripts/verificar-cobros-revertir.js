// Botón Revertir directo en la lista de Cobros (js/cobros.js), que ejecuta el mismo flujo que el detalle de abonos de CxC
// (EVE_CXC.revertirAbonoCxC). Monta los módulos reales en un navegador (Playwright) con un Firestore simulado y comprueba:
//  - Revertir en lugar de Eliminar cuando el cobro tiene vínculo activo; Eliminar si no lo tiene; los anticipos conservan su Revertir;
//  - cobro por folio, cobro de un pago general (varias cuentas) y cobro de un grupo con sobrante;
//  - bloqueo cuando el anticipo del grupo ya se aplicó (mensaje de CxP, sin cambios);
//  - cobro sin datos de abono: mensaje claro, sin error técnico;
//  - el cobro revertido desaparece de la lista; permisos (sin escritura en cxc no hay botón).
//
// Uso: node scripts/verificar-cobros-revertir.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/ordenar-tabla.js', 'js/cxp.js', 'js/saldo-clientes.js', 'js/cxc.js', 'js/cobros.js'];
const HOY = '2026-11-02';
const MSG_CONSUMIDO = 'Este anticipo ya fue aplicado a otra cuenta. Revierte primero ese abono';

const abono = (id, monto, grupo) => ({ abonoId: id, monto, fecha: HOY, referencia: 'Efectivo', registradoPor: 'u', fechaRegistro: HOY, grupoPagoId: grupo });
const cuenta = (id, folio, total, abonos) => {
  const pagado = abonos.reduce((s, a) => s + a.monto, 0);
  return { id, ventaId: 'v' + id, cliente: 'ACME', folio, material: 'PET', cantidad: 10, unidad: 'KG', precioUnitario: total / 10, total, pagado, saldo: total - pagado,
    estado: pagado >= total ? 'liquidado' : (pagado > 0 ? 'parcial' : 'pendiente'), fechaVenta: '2026-10-01', abonos, abonosRevertidos: [] };
};
const cobro = (id, c, monto, grupo, extra) => ({ id, cxcId: c.id, ventaId: c.ventaId, folio: c.folio, cliente: 'ACME', material: 'PET', cantidad: 10, pagado: monto, fecha: HOY, referencia: 'Efectivo', origen: 'cxc_cobro_factura', revertido: false, grupoPagoId: grupo, ...extra });
const anticipoCobro = (id, monto, grupo) => ({ id, cxcId: '', folio: 'V-1', cliente: 'ACME', material: '', cantidad: 0, pagado: monto, fecha: HOY, origen: 'anticipo', revertido: false, grupoPagoId: grupo });
const mov = (monto, grupoPagoId, motivo) => ({ monto, fecha: HOY, grupoPagoId, motivo, revertido: false });

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function nuevaPagina(browser, { cuentas, cobros, clientes = [], escritura = true }) {
  const page = await browser.newPage();
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ cs, co, cl, escritura, hoy }) => {
    window.mensajes = { error: [], exito: [] };
    window.prompts = [];
    window.respuestaPrompt = 'error de captura';
    const copia = (o) => JSON.parse(JSON.stringify(o));
    const guardado = { cuentas_por_cobrar: new Map(), clientes: new Map(), cobros: new Map() };
    cs.forEach((c) => guardado.cuentas_por_cobrar.set(c.id, copia(c)));
    cl.forEach((c) => guardado.clientes.set(c.nombre, copia(c)));
    co.forEach((c) => guardado.cobros.set(c.id, copia(c)));
    window.guardado = guardado;
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
    window.eliminarDato = async (col, id) => { guardado[col].delete(id); };
    window.puedeEscribir = () => escritura;
    window.puedeLeer = () => true;
    window.showError = (m) => window.mensajes.error.push(m);
    window.showSuccess = (m) => window.mensajes.exito.push(m);
    window.EVE_HISTORIAL = { registrar: async () => {} };
    window.obtenerFechaMexico = () => hoy;
    window.prompt = (t) => { window.prompts.push(t); return window.respuestaPrompt; };
    window.EVE = { currentUser: { username: 'prueba' }, cuentasPorCobrar: copia(cs), clientes: copia(cl), cobros: copia(co), ventas: [], registrosVentas: [], proveedores: [] };
    window.EVE_MODULES.cobros.render(document.getElementById('main-content'));
  }, { cs: cuentas, co: cobros, cl: clientes, escritura, hoy: HOY });
  return page;
}

const filaDe = (page, folio) => page.locator('#cobros-tabla tr', { hasText: folio });
const botonesDeFila = (page, folio) => filaDe(page, folio).locator('button').allTextContents();
const folios = (page) => page.$$eval('#cobros-tabla tr', (rs) => rs.map((r) => (r.cells[0] ? r.cells[0].textContent.trim() : '')).filter((f) => f && f !== 'Sin registros').sort());

caso('cobro por folio: Revertir en lugar de Eliminar; ejecuta el flujo de CxC y el cobro desaparece de la lista', async (browser) => {
  const c1 = cuenta('c1', 'V-1', 1000, [abono('a1', 1000, 'g1')]);
  const page = await nuevaPagina(browser, { cuentas: [c1], cobros: [cobro('k1', c1, 1000, 'g1')] });
  igual(await botonesDeFila(page, 'V-1'), ['Revertir'], 'solo Revertir (vínculo activo)');
  await filaDe(page, 'V-1').locator('button').click();
  await page.waitForFunction(() => window.mensajes.exito.length > 0 || window.mensajes.error.length > 0);
  igual(await page.evaluate(() => window.mensajes), { error: [], exito: ['Cobro revertido'] }, 'mensaje');
  const prompt = await page.evaluate(() => window.prompts[0]);
  afirmar(prompt.includes('V-1') && prompt.includes('Motivo de la reversión (obligatorio)'), 'pide el motivo obligatorio: ' + prompt);
  const r = await page.evaluate(() => ({ c: window.guardado.cuentas_por_cobrar.get('c1'), k: window.guardado.cobros.get('k1'), mem: window.EVE.cuentasPorCobrar[0] }));
  igual([r.c.saldo, r.c.abonos.length, r.c.abonosRevertidos.length, r.c.abonosRevertidos[0].motivo, r.k.revertido, r.k.revertidoMotivo, r.mem.saldo], [1000, 0, 1, 'error de captura', true, 'error de captura', 1000], 'mismo resultado que el Revertir de CxC');
  igual(await folios(page), [], 'la lista oculta el cobro revertido');
  afirmar((await page.textContent('#cobros-stats')).includes('Registros: 0'), 'el conteo se actualiza');
  await page.close();
});

caso('motivo vacío o cancelado: no se revierte nada (igual que en CxC)', async (browser) => {
  const c1 = cuenta('c1', 'V-1', 1000, [abono('a1', 1000, 'g1')]);
  const page = await nuevaPagina(browser, { cuentas: [c1], cobros: [cobro('k1', c1, 1000, 'g1')] });
  for (const respuesta of [null, '   ']) {
    await page.evaluate((r) => { window.respuestaPrompt = r; }, respuesta);
    await filaDe(page, 'V-1').locator('button').click();
  }
  igual(await page.evaluate(() => [window.guardado.cuentas_por_cobrar.get('c1').abonos.length, window.guardado.cobros.get('k1').revertido, window.mensajes.exito.length]), [1, false, 0], 'nada cambió');
  await page.close();
});

caso('pago general con 2 cuentas: revertir uno no toca el otro y el aviso lo dice', async (browser) => {
  const c1 = cuenta('c1', 'V-1', 600, [abono('a1', 600, 'g1')]);
  const c2 = cuenta('c2', 'V-2', 400, [abono('a2', 400, 'g1')]);
  const page = await nuevaPagina(browser, {
    cuentas: [c1, c2], cobros: [cobro('k1', c1, 600, 'g1', { origen: 'cxc_cobro_general' }), cobro('k2', c2, 400, 'g1', { origen: 'cxc_cobro_general' })]
  });
  await filaDe(page, 'V-1').locator('button').click();
  await page.waitForFunction(() => window.mensajes.exito.length > 0);
  const aviso = await page.evaluate(() => window.prompts[0]);
  afirmar(aviso.includes('1 cobro(s) más a otras cuentas') && aviso.includes('NO se revierten'), 'el aviso advierte del resto del pago: ' + aviso);
  igual(await page.evaluate(() => [window.guardado.cobros.get('k1').revertido, window.guardado.cobros.get('k2').revertido, window.guardado.cuentas_por_cobrar.get('c2').abonos.length, window.guardado.cuentas_por_cobrar.get('c1').saldo]), [true, false, 1, 600], 'solo se revierte el de esa cuenta');
  igual(await folios(page), ['V-2'], 'la lista conserva el otro');
  await page.close();
});

caso('pago general con sobrante: el aviso lo menciona y se revierten el cobro, el anticipo y el saldo a favor del grupo', async (browser) => {
  const c1 = cuenta('c1', 'V-1', 1000, [abono('a1', 1000, 'g1')]);
  const page = await nuevaPagina(browser, {
    cuentas: [c1], cobros: [cobro('k1', c1, 1000, 'g1', { origen: 'cxc_cobro_general' }), anticipoCobro('k2', 250, 'g1')],
    clientes: [{ id: 'ACME', nombre: 'ACME', saldoAFavor: [mov(250, 'g1', 'Sobrante de cobro')] }]
  });
  igual(await botonesDeFila(page, 'V-1'), ['Revertir', 'Revertir'], 'el cobro y su anticipo tienen Revertir');
  await page.locator('#cobros-tabla tr', { hasText: 'PET' }).first().locator('button').click();
  await page.waitForFunction(() => window.mensajes.exito.length > 0 || window.mensajes.error.length > 0);
  const aviso = await page.evaluate(() => window.prompts[0]);
  afirmar(aviso.includes('$250.00') && aviso.includes('saldo a favor de ACME') && aviso.includes('mismo pago'), 'el aviso menciona el sobrante: ' + aviso);
  const r = await page.evaluate(() => ({ k1: window.guardado.cobros.get('k1').revertido, k2: window.guardado.cobros.get('k2').revertido, mov: window.guardado.clientes.get('ACME').saldoAFavor[0].revertido, saldo: window.guardado.cuentas_por_cobrar.get('c1').saldo }));
  igual(r, { k1: true, k2: true, mov: true, saldo: 1000 }, 'reversión conjunta');
  igual(await folios(page), [], 'la lista oculta ambos');
  await page.close();
});

caso('grupo con anticipo ya aplicado: se bloquea con el mensaje de CxP y no cambia nada', async (browser) => {
  const c1 = cuenta('c1', 'V-1', 1000, [abono('a1', 1000, 'g1')]);
  const c2 = cuenta('c2', 'V-2', 500, [abono('a2', 100, 'gA')]);
  const page = await nuevaPagina(browser, {
    cuentas: [c1, c2], cobros: [cobro('k1', c1, 1000, 'g1', { origen: 'cxc_cobro_general' }), anticipoCobro('k2', 250, 'g1')],
    clientes: [{ id: 'ACME', nombre: 'ACME', saldoAFavor: [mov(250, 'g1', 'Sobrante de cobro'), mov(-200, 'gA', 'Aplicado a V-2')] }]
  });
  await page.locator('#cobros-tabla tr', { hasText: 'PET' }).first().locator('button').click();
  await page.waitForFunction(() => window.mensajes.error.length > 0);
  afirmar((await page.evaluate(() => window.mensajes.error[0])).includes(MSG_CONSUMIDO), 'mensaje de bloqueo');
  const r = await page.evaluate(() => ({ k1: window.guardado.cobros.get('k1').revertido, k2: window.guardado.cobros.get('k2').revertido, abonos: window.guardado.cuentas_por_cobrar.get('c1').abonos.length, movs: window.guardado.clientes.get('ACME').saldoAFavor.map((m) => m.revertido) }));
  igual(r, { k1: false, k2: false, abonos: 1, movs: [false, false] }, 'sin cambios');
  igual((await folios(page)).length, 2, 'la lista sigue igual');
  await page.close();
});

caso('cobro sin datos de abono (anterior al fix): mensaje claro, sin error técnico y sin cambios', async (browser) => {
  const c1 = cuenta('c1', 'V-1', 1000, [{ monto: 1000, fecha: HOY, referencia: 'Efectivo', registradoPor: 'u' }]);
  const viejo = cobro('k1', c1, 1000, undefined, {});
  delete viejo.grupoPagoId;
  const conGrupoPeroSinAbonoId = cuenta('c2', 'V-2', 500, [{ monto: 500, fecha: HOY, grupoPagoId: 'g2' }]);
  const page = await nuevaPagina(browser, { cuentas: [c1, conGrupoPeroSinAbonoId], cobros: [viejo, cobro('k2', conGrupoPeroSinAbonoId, 500, 'g2')] });
  igual(await botonesDeFila(page, 'V-1'), ['Eliminar'], 'sin grupoPagoId no hay vínculo: Eliminar como hoy');
  await filaDe(page, 'V-2').locator('button').click();
  await page.waitForFunction(() => window.mensajes.error.length > 0);
  const msg = await page.evaluate(() => window.mensajes.error[0]);
  afirmar(msg.includes('no trae los datos para localizar su abono') && msg.includes('desde CxC'), 'mensaje claro: ' + msg);
  igual(await page.evaluate(() => [window.prompts.length, window.guardado.cobros.get('k2').revertido, window.guardado.cuentas_por_cobrar.get('c2').abonos.length]), [0, false, 1], 'no pidió motivo ni cambió nada');
  await page.close();
});

caso('cobro sin vínculo conserva Eliminar; los anticipos conservan Revertir; sin escritura en cxc no hay botones', async (browser) => {
  const c1 = cuenta('c1', 'V-1', 1000, []);
  const suelto = { id: 'k9', cxcId: '', folio: 'V-9', cliente: 'ZETA', material: 'PET', cantidad: 1, pagado: 10, fecha: HOY, revertido: false };
  const page = await nuevaPagina(browser, {
    cuentas: [c1], cobros: [suelto, anticipoCobro('k2', 250, 'g1')],
    clientes: [{ id: 'ACME', nombre: 'ACME', saldoAFavor: [mov(250, 'g1', 'Anticipo de cliente')] }]
  });
  igual(await botonesDeFila(page, 'V-9'), ['Eliminar'], 'cobro suelto: Eliminar');
  igual(await botonesDeFila(page, 'V-1'), ['Revertir'], 'anticipo: Revertir (no Eliminar)');
  await page.close();
  const sinPermiso = await nuevaPagina(browser, { cuentas: [c1], cobros: [suelto, anticipoCobro('k2', 250, 'g1')], clientes: [{ id: 'ACME', nombre: 'ACME', saldoAFavor: [mov(250, 'g1', 'x')] }], escritura: false });
  igual(await sinPermiso.$$eval('#cobros-tabla button', (b) => b.length), 0, 'sin escritura en cxc no hay botones');
  await sinPermiso.close();
});

caso('revertir desde Cobros y desde el detalle de CxC dan el mismo resultado (misma función)', async (browser) => {
  const arma = () => {
    const c1 = cuenta('c1', 'V-1', 1000, [abono('a1', 1000, 'g1')]);
    return { cuentas: [c1], cobros: [cobro('k1', c1, 1000, 'g1', { origen: 'cxc_cobro_general' }), anticipoCobro('k2', 250, 'g1')], clientes: [{ id: 'ACME', nombre: 'ACME', saldoAFavor: [mov(250, 'g1', 'Sobrante')] }] };
  };
  const estado = (page) => page.evaluate(() => JSON.parse(JSON.stringify({
    c: window.guardado.cuentas_por_cobrar.get('c1'), k: [...window.guardado.cobros.values()].map((x) => [x.id, x.revertido, x.revertidoMotivo]), m: window.guardado.clientes.get('ACME').saldoAFavor.map((x) => [x.revertido, x.revertidoMotivo])
  })));
  const quitaFechas = (e) => JSON.parse(JSON.stringify(e, (k, v) => (k === 'fechaReversion' ? undefined : v)));
  const a = await nuevaPagina(browser, arma());
  await a.locator('#cobros-tabla tr', { hasText: 'PET' }).first().locator('button').click();
  await a.waitForFunction(() => window.mensajes.exito.length > 0);
  const viaCobros = quitaFechas(await estado(a));
  const b = await nuevaPagina(browser, arma());
  await b.evaluate(async () => { await window.EVE_CXC.revertirAbonoCxC('c1', 'a1', 'error de captura', 'prueba'); });
  const viaCxc = quitaFechas(await estado(b));
  igual(viaCobros, viaCxc, 'mismo estado final');
  await a.close();
  await b.close();
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
