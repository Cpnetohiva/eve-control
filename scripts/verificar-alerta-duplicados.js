// Alerta de posible duplicado en la captura (js/utils.js: detectarPosibleDuplicado, revisarPosibleDuplicado).
//
// Parte 1 (vm, js/utils.js real): la regla de 4 o más campos independientes, por módulo, con el caso V-2026-034 (5 de 5),
//   3 de 5 (no alerta), 4 de 5 (alerta), el mismo ticket con otro material (no alerta), ticket + proveedor + material (alerta directa),
//   los registros revertidos/eliminados/cancelados (no cuentan), la ventana de 30 días y la revisión de la cola offline.
//   CRITERIO CONTRA FALSOS POSITIVOS (compras y ventas recurrentes): la cantidad (kg en Pagos) o el monto (Cobros, Gastos, Recibos) es
//   un campo OBLIGATORIO: sin ella no hay alerta, y con ella hacen falta al menos 3 de los demás campos. V-2026-034 (4,130 kg) contra
//   V-2026-035 (3,350 kg), mismo día, cliente, material y precio, NO alerta; contra su copia exacta sí.
// Parte 2 (Chromium, Playwright): el modal «Posible duplicado» (Cancelar, Es otro registro, Escape, registro pendiente de la cola),
//   el formulario real de Gastos (aviso, cancelar no guarda, confirmar guarda con duplicadoConfirmado: true) y el doble clic.
// Parte 3 (estática): cada módulo llama a la alerta antes de guardar y la cola offline deja en revisión en vez de subir.
//
// Uso: node scripts/verificar-alerta-duplicados.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8').replace(/\r\n/g, '\n');
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const igual = (a, b, m) => afirmar(JSON.stringify(a) === JSON.stringify(b), `${m}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

const HOY = '2026-11-04'; // ventana de 30 días: desde 2026-10-06

function crearVm(cola) {
  const sandbox = { console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout, document: {}, navigator: { onLine: true } };
  sandbox.window = sandbox;
  sandbox.window.EVE = { ventas: [], registrosPagos: [], cobros: [], gastos: [], recibosDinero: [], ordenesCompra: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  vm.runInContext(leer('js/utils.js'), sandbox, { filename: 'js/utils.js' });
  sandbox.window.obtenerFechaMexico = () => HOY;
  if (cola) sandbox.window.EVE_COLA_OFFLINE = { obtenerPendientes: async () => cola };
  return sandbox.window;
}
const w = crearVm();
const detectar = (modulo, nuevo, existentes) => w.detectarPosibleDuplicado(modulo, nuevo, existentes);

(async () => {
  // ══ Ventas: fecha, cliente, material, cantidad y precio unitario (el total no cuenta) ══
  const linea = (material, cantidad, precioUnitario) => ({ material, cantidad, unidad: 'KG', precioUnitario, subtotal: cantidad * precioUnitario, totalLinea: cantidad * precioUnitario });
  const V034 = { id: 'v34', folio: 'V-2026-034', cliente: 'ENVASES PLASTICOS', fecha: '2026-10-12', registradoPor: 'MatildeMontero', fechaRegistro: '2026-10-12T16:30:00.000Z', totalVenta: 55755, lineas: [linea('LECHERO MOLIDO', 4130, 13.5)] };
  const nuevaVenta = (cambios, lineas) => ({ cliente: 'ENVASES PLASTICOS', fecha: '2026-10-12', totalVenta: 55755, lineas: lineas || [linea('LECHERO MOLIDO', 4130, 13.5)], ...(cambios || {}) });

  let d = detectar('ventas', nuevaVenta(), [V034]);
  afirmar(d && d.registro.folio === 'V-2026-034' && d.coincidencias.length === 5, 'V-2026-034 capturada otra vez (5 de 5): alerta');
  igual(d && d.coincidencias, ['fecha', 'cliente', 'material', 'cantidad', 'precioUnitario'], 'coinciden los 5 campos');
  afirmar(detectar('ventas', nuevaVenta({ cliente: 'OTRO CLIENTE' }, [linea('LECHERO MOLIDO', 2065, 27)]), [V034]) === null, '3 de 5 (fecha, material y... cliente distinto, cantidad y precio distintos): no alerta, aunque el TOTAL sea igual');
  afirmar(detectar('ventas', nuevaVenta({}, [linea('LECHERO MOLIDO', 2065, 27)]), [V034]) === null, 'fecha, cliente y material iguales pero cantidad y precio distintos (3 de 5) con el mismo total: no alerta');
  // La cantidad es obligatoria: alerta solo si coincide y además al menos 3 de fecha, cliente, material y precio unitario.
  const V035 = { ...V034, id: 'v35', folio: 'V-2026-035', totalVenta: 45225, lineas: [linea('LECHERO MOLIDO', 3350, 13.5)], fechaRegistro: '2026-10-12T17:10:00.000Z' };
  d = detectar('ventas', V035, [V034]);
  afirmar(d === null, 'V-2026-034 (4,130 kg) contra V-2026-035 (3,350 kg), mismo día, cliente, material y precio: NO alerta (compra recurrente)');
  d = detectar('ventas', { ...V034, id: undefined, folio: 'V-2026-036' }, [V034]);
  afirmar(d && d.coincidencias.length === 5, 'V-2026-034 contra su copia exacta (5 de 5): alerta');
  igual(detectar('ventas', V034, [V035]), null, 'y al revés (035 ya capturada, se vuelve a capturar 034): tampoco alerta');
  d = detectar('ventas', nuevaVenta({ cliente: 'OTRO CLIENTE' }), [V034]);
  afirmar(d && d.coincidencias.length === 4 && d.coincidencias.includes('cantidad'), 'cantidad + fecha, material y precio (cliente distinto): alerta (cantidad + 3 de los otros 4)');
  afirmar(detectar('ventas', nuevaVenta({ cliente: 'OTRO CLIENTE' }, [linea('LECHERO MOLIDO', 4130, 14)]), [V034]) === null, 'cantidad + fecha y material solamente (cliente y precio distintos): 2 de los otros 4, no alerta');
  afirmar(detectar('ventas', nuevaVenta({}, [linea('PET', 3350, 9)]), [V034]) === null, 'fecha y cliente iguales pero cantidad, material y precio distintos: no alerta');
  afirmar(detectar('ventas', nuevaVenta({}, [linea('LECHERO MOLIDO', 3350, 13.5), linea('PET', 4130, 13.5)]), [V034]) !== null, 'con varias líneas se busca la pareja con la MISMA cantidad (la segunda línea, 4,130 kg)');
  d = detectar('ventas', nuevaVenta({}, [linea('LECHERO MOLIDO', 4130, 14)]), [V034]);
  afirmar(d && d.coincidencias.length === 4, '4 de 5 (cambia solo el precio unitario): alerta');
  d = detectar('ventas', nuevaVenta({ fecha: '2026-10-13' }), [V034]);
  afirmar(d && d.coincidencias.length === 4 && !d.coincidencias.includes('fecha'), '4 de 5 (cambia solo la fecha): alerta');
  afirmar(detectar('ventas', nuevaVenta({ totalVenta: 1 }), [V034]) !== null, 'el total no cuenta: aunque difiera, 5 de 5 sigue alertando');
  afirmar(detectar('ventas', nuevaVenta({ folio: 'V-2026-099' }), [V034]) !== null, 'un folio distinto no evita la alerta (la regla compara los datos, no el folio)');
  d = detectar('ventas', nuevaVenta({}, [linea('PET', 10, 5), linea('LECHERO MOLIDO', 4130, 13.5)]), [V034]);
  afirmar(d && d.coincidencias.length === 5, 'con varias líneas se usa la mejor pareja de líneas');
  afirmar(detectar('ventas', nuevaVenta(), [{ ...V034, eliminado: true }]) === null, 'una venta eliminada no cuenta');
  afirmar(detectar('ventas', nuevaVenta({ fecha: HOY }), [{ ...V034, fecha: '2026-09-01' }]) === null, 'ventana de 30 días: una venta de hace más de 30 días no se compara (aunque coincidan 4 campos)');
  afirmar(detectar('ventas', nuevaVenta({ fecha: '2026-09-01' }), [{ ...V034, fecha: '2026-09-01' }]) !== null, 'pero si la nueva tiene esa misma fecha sí se compara');
  afirmar(detectar('ventas', nuevaVenta({ cliente: '' }), [V034]) !== null && detectar('ventas', { ...nuevaVenta(), cliente: '', lineas: [linea('LECHERO MOLIDO', 4130, 13.5)] }, [{ ...V034, cliente: '' }]).coincidencias.length === 4, 'un campo vacío en ambos lados no cuenta como coincidencia');

  // ══ Pagos: fecha, proveedor, material, kg, precio y ticket; ticket + proveedor + material es alerta directa ══
  const P = { id: 'p1', ticket: '1234', proveedor: 'JOSE ENRIQUE', material: 'PET', kg: 100, precioPorKg: 5, pagado: 500, fecha: '2026-10-30', creadoPor: 'Admin', fechaRegistro: '2026-10-30T15:00:00.000Z' };
  const nuevoPago = (c) => ({ ticket: '1234', proveedor: 'JOSE ENRIQUE', material: 'PET', kg: 100, precioPorKg: 5, pagado: 500, fecha: '2026-10-30', ...(c || {}) });
  d = detectar('pagos', nuevoPago(), [P]);
  afirmar(d && d.directa && d.coincidencias.length === 6, 'pago idéntico (6 de 6): alerta directa');
  d = detectar('pagos', nuevoPago({ fecha: '2026-11-02', kg: 80, precioPorKg: 6 }), [P]);
  afirmar(d && d.directa && d.coincidencias.length === 3, 'mismo ticket + proveedor + material: alerta directa aunque solo coincidan 3 campos');
  afirmar(detectar('pagos', nuevoPago({ ticket: '1300', kg: 80 }), [P]) === null, 'Pagos: mismo proveedor, material, precio y día con OTRO ticket y OTROS kg (compra recurrente): NO alerta');
  afirmar(detectar('pagos', nuevoPago({ ticket: '1300' }), [P]) !== null, 'Pagos: con los mismos kg (kg + fecha, proveedor, material, precio) sí alerta aunque el ticket sea otro');
  afirmar(detectar('pagos', nuevoPago({ kg: 80, precioPorKg: 6 }), [P]).directa, 'Pagos: ticket + proveedor + material sigue siendo alerta directa aunque los kg no coincidan');
  afirmar(detectar('pagos', nuevoPago({ material: 'HDPE' }), [P]) === null, 'mismo ticket con DISTINTO material (aunque coincidan fecha, proveedor, kg y precio): no alerta');
  d = detectar('pagos', nuevoPago({ ticket: '9999', precioPorKg: 7 }), [P]);
  afirmar(d && !d.directa && d.coincidencias.length === 4, 'sin el ticket, 4 de 6 (fecha, proveedor, material, kg): alerta');
  afirmar(detectar('pagos', nuevoPago({ ticket: '9999', precioPorKg: 7, kg: 90 }), [P]) === null, '3 de 6: no alerta');
  afirmar(detectar('pagos', nuevoPago(), [{ ...P, revertido: true }]) === null, 'un pago revertido no cuenta');
  afirmar(detectar('pagos', nuevoPago({ ticket: '' }), [{ ...P, ticket: '' }]) === null || detectar('pagos', nuevoPago({ ticket: '' }), [{ ...P, ticket: '' }]).coincidencias.length === 5, 'ticket vacío en ambos lados no cuenta como coincidencia');
  afirmar(detectar('pagos', nuevoPago({ ticket: '1234', proveedor: 'OTRO', material: 'PET' }), [P]) === null || !detectar('pagos', nuevoPago({ ticket: '1234', proveedor: 'OTRO' }), [P]).directa, 'mismo ticket y material pero otro proveedor no es alerta directa');

  // ══ Cobros: fecha, cliente, folio, monto y forma de pago (un cobro reparte su monto en un documento por partida) ══
  const cobro = (id, grupo, pagado, extra) => ({ id, grupoPagoId: grupo, cliente: 'ACME', folio: 'V-2026-010', pagado, fecha: '2026-10-28', referencia: 'Transferencia', ...(extra || {}) });
  const COBROS = [cobro('c1', 'g1', 600), cobro('c2', 'g1', 400), cobro('c3', 'g2', 250, { folio: 'V-2026-011' })];
  d = detectar('cobros', { fecha: '2026-10-28', cliente: 'ACME', folio: 'V-2026-010', pagado: 1000, referencia: 'Transferencia' }, COBROS);
  afirmar(d && d.coincidencias.length === 5, 'cobro de 1,000 repartido en dos partidas (600 + 400): se compara la suma del grupo (5 de 5)');
  d = detectar('cobros', { fecha: '2026-10-28', cliente: 'ACME', folio: '', pagado: 1000, referencia: 'Transferencia' }, COBROS);
  afirmar(d && d.coincidencias.length === 4 && !d.coincidencias.includes('folio'), 'cobro general sin folio: 4 de 5 (fecha, cliente, monto, forma de pago)');
  afirmar(detectar('cobros', { fecha: '2026-10-28', cliente: 'ACME', folio: 'V-2026-010', pagado: 600, referencia: 'Efectivo' }, COBROS) === null, 'una sola de las partidas (600) no suma el monto del grupo: no alerta');
  afirmar(detectar('cobros', { fecha: '2026-10-28', cliente: 'ACME', folio: 'V-2026-010', pagado: 1000, referencia: 'Transferencia' }, COBROS.map((c) => ({ ...c, revertido: true }))) === null, 'cobros revertidos no cuentan');
  afirmar(detectar('cobros', { fecha: '2026-10-28', cliente: 'ACME', folio: 'V-2026-010', pagado: 1000, referencia: 'Transferencia' }, [cobro('c1', 'g1', 600), cobro('c2', 'g1', 400, { revertido: true })]) === null, 'si una partida del grupo se revirtió, el grupo suma solo 600: el monto (obligatorio) ya no coincide y no alerta aunque coincidan los otros 4');
  afirmar(detectar('cobros', { fecha: '2026-10-28', cliente: 'ACME', folio: 'V-2026-010', pagado: 250, referencia: 'Transferencia' }, [cobro('c1', 'g1', 600), cobro('c2', 'g1', 400)]) === null, 'Cobros: dos abonos distintos de la misma factura el mismo día y con la misma forma de pago (fecha, cliente, folio y forma iguales, monto distinto): NO alerta');

  // ══ Gastos: fecha, proveedor (beneficiario), monto, concepto, categoría (tipo de gasto) ══
  const G = { id: 'g1', fecha: '2026-11-01', beneficiario: 'GAS DEL NORTE', montoBase: 1200.5, concepto: 'Diésel', tipoGasto: 'operacion', creadoPor: 'Admin', fechaRegistro: '2026-11-01T18:00:00.000Z' };
  afirmar(detectar('gastos', { ...G, id: undefined }, [G]).coincidencias.length === 5, 'gasto idéntico (5 de 5): alerta');
  afirmar(detectar('gastos', { ...G, fecha: '2026-11-03', concepto: 'Gas LP' }, [G]) === null, 'gasto con 3 de 5 (proveedor, monto y categoría): no alerta');
  d = detectar('gastos', { ...G, concepto: 'Gas LP' }, [G]);
  afirmar(d && d.coincidencias.length === 4, 'gasto con 4 de 5: alerta');
  afirmar(detectar('gastos', { ...G }, [{ ...G, revertido: true }]) === null, 'un gasto revertido no cuenta');

  afirmar(detectar('gastos', { ...G, id: undefined, montoBase: 800 }, [G]) === null, 'Gastos: mismo proveedor, concepto, categoría y día con OTRO monto (dos cargas de diésel): NO alerta');
  afirmar(detectar('gastos', { ...G, id: undefined, montoBase: 800, concepto: 'Gas LP' }, [G]) === null, 'Gastos: sin el monto (obligatorio) no alerta aunque coincidan fecha, proveedor y categoría');

  // ══ Recibos de dinero: fecha, cliente, monto (importe), concepto, categoría (tipo) ══
  const R = { id: 'r1', folio: 'RD-02112026-001', tipo: 'Anticipo', cliente: { nombre: 'Rival Plastic' }, fecha: '2026-11-02', importe: 5000, concepto: 'Anticipo pedido 12', estado: 'Emitido', creadoPor: 'Admin', fechaRegistro: '2026-11-02T17:00:00.000Z' };
  const datosRecibo = { tipo: 'Anticipo', cliente: { nombre: 'RIVAL PLASTIC', rfc: '', domicilio: '' }, fecha: '2026-11-02', importe: '5000', concepto: 'anticipo pedido 12' };
  afirmar(detectar('recibos', datosRecibo, [R]).coincidencias.length === 5, 'recibo con los mismos datos del formulario (sin distinguir mayúsculas): alerta');
  afirmar(detectar('recibos', { ...datosRecibo, importe: '4000', concepto: 'otro' }, [R]) === null, 'recibo con 3 de 5: no alerta');
  afirmar(detectar('recibos', datosRecibo, [{ ...R, estado: 'Cancelado' }]) === null, 'un recibo cancelado no cuenta');
  afirmar(detectar('recibos', { ...datosRecibo, importe: '3000' }, [R]) === null, 'Recibos: mismo cliente, fecha, concepto y tipo con OTRO importe: NO alerta (el monto es obligatorio)');

  // ══ Órdenes de compra: fecha, proveedor, monto y concepto (sin categoría: deben coincidir los 4) ══
  const OC = { id: 'o1', folio: 'OC-2026-0007', proveedor: { nombre: 'Distribuidora Sur' }, fecha: '2026-11-03', totales: { total: 11600 }, partidas: [{ producto: 'Tarimas', descripcion: 'Tarimas de madera' }], estado: 'Emitida', creadoPor: 'Admin', fechaRegistro: '2026-11-03T14:00:00.000Z' };
  const nuevaOC = { proveedor: { nombre: 'DISTRIBUIDORA SUR' }, fecha: '2026-11-03', totales: { total: 11600 }, partidas: [{ producto: 'Tarimas' }] };
  afirmar(detectar('oc', nuevaOC, [OC]).coincidencias.length === 4, 'orden de compra con los 4 campos iguales: alerta');
  afirmar(detectar('oc', { ...nuevaOC, totales: { total: 9000 } }, [OC]) === null, 'orden de compra con 3 de 4: no alerta');
  afirmar(detectar('oc', nuevaOC, [{ ...OC, estado: 'Cancelada' }]) === null, 'una orden cancelada no cuenta');

  // ══ Módulo desconocido / entradas vacías ══
  afirmar(detectar('inventado', {}, [P]) === null && detectar('pagos', null, [P]) === null && detectar('pagos', nuevoPago(), []) === null && detectar('pagos', nuevoPago(), undefined) === null, 'módulo desconocido o sin existentes: null');
  afirmar(JSON.stringify(P) === JSON.stringify({ id: 'p1', ticket: '1234', proveedor: 'JOSE ENRIQUE', material: 'PET', kg: 100, precioPorKg: 5, pagado: 500, fecha: '2026-10-30', creadoPor: 'Admin', fechaRegistro: '2026-10-30T15:00:00.000Z' }), 'la detección no modifica los registros existentes');

  // ══ Cola offline: queda en revisión, no se sube ni se descarta ══
  {
    const wc = crearVm();
    wc.EVE.ventas = [V034, { ...V034, id: 'offline_5', folio: 'V-2026-040' }];
    const itemCola = nuevaVenta({ folio: 'V-2026-035', folioProvisional: true });
    afirmar(wc.revisarItemColaDuplicado('ventas', itemCola, {}) !== null, 'cola: una venta encolada igual a una existente queda marcada para revisión');
    afirmar(wc.revisarItemColaDuplicado('ventas', { ...itemCola, duplicadoConfirmado: true }, {}) === null, 'cola: ya confirmada («Es otro registro») se sube sin volver a revisar');
    wc.EVE.ventas = [{ ...V034, id: 'offline_5' }];
    afirmar(wc.revisarItemColaDuplicado('ventas', itemCola, {}) === null, 'cola: la copia local del propio registro encolado (id offline_…) no cuenta como duplicado');
    wc.EVE.ventas = [];
    afirmar(wc.revisarItemColaDuplicado('ventas', itemCola, { ventas: [nuevaVenta()] }) !== null, 'cola: coincide con otro registro ya subido en la misma sincronización');
    afirmar(wc.revisarItemColaDuplicado('cuentas_por_cobrar', itemCola, {}) === null, 'cola: colecciones sin alerta (CxC) se suben normal');
    igual([wc.moduloDuplicadoDeColeccion('ventas'), wc.moduloDuplicadoDeColeccion('pagos'), wc.moduloDuplicadoDeColeccion('cobros'), wc.moduloDuplicadoDeColeccion('gastos'), wc.moduloDuplicadoDeColeccion('recibos_dinero'), wc.moduloDuplicadoDeColeccion('ordenes_compra'), wc.moduloDuplicadoDeColeccion('x')], ['ventas', 'pagos', 'cobros', 'gastos', 'recibos', 'oc', null], 'colección -> módulo');
  }

  // ══ revisarPosibleDuplicado sin duplicado o con fallo interno: nunca bloquea ══
  {
    const wn = crearVm();
    igual(await wn.revisarPosibleDuplicado('gastos', G), { continuar: true, confirmado: false }, 'sin duplicado: continúa sin aviso');
    wn.EVE.gastos = null;
    igual(await wn.revisarPosibleDuplicado('gastos', G), { continuar: true, confirmado: false }, 'memoria ilegible: continúa sin aviso');
    wn.EVE.registrosPagos = [P];
    wn.detectarPosibleDuplicado = () => { throw new Error('falla interna'); };
    igual(await wn.revisarPosibleDuplicado('pagos', nuevoPago()), { continuar: true, confirmado: false }, 'un fallo interno no bloquea el guardado');
  }

  // ══ Parte 2: navegador ══
  const browser = await chromium.launch();
  try {
    async function pagina(extra) {
      const page = await browser.newPage();
      const errores = [];
      page.on('pageerror', (e) => errores.push(e.message));
      await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
      await page.evaluate(() => {
        window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
        window.EVE_MODULES = {};
      });
      for (const s of ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/vista-captura.js', 'js/reportes.js', 'js/gastos.js']) await page.addScriptTag({ path: path.join(RAIZ, s) });
      await page.evaluate(({ gastos, hoy, cola }) => {
        window.obtenerFechaMexico = () => hoy;
        window.puedeEscribir = () => true;
        window.puedeLeer = () => true;
        window.showError = (e) => { (window.__errores = window.__errores || []).push(e); };
        window.showSuccess = (m) => { (window.__exitos = window.__exitos || []).push(m); };
        window.EVE_HISTORIAL = { registrar: () => {} };
        window.__guardados = [];
        window.guardarDato = async (coleccion, datos) => { window.__guardados.push({ coleccion, datos: JSON.parse(JSON.stringify(datos)) }); return 'nuevo' + window.__guardados.length; };
        window.EVE = { currentUser: { username: 'Admin', permisosResueltos: {} }, gastos, ventas: [], registrosPagos: [], cobros: [], recibosDinero: [], ordenesCompra: [], registrosVentas: [], registrosDestaraje: [], cuentasPorPagar: [], cuentasPorCobrar: [], precios: [], proveedores: [], clientes: [], composiciones: [], recibosPendientes: [], auditorias: [] };
        if (cola) window.EVE_COLA_OFFLINE = { obtenerPendientes: async () => cola };
      }, { gastos: extra.gastos || [], hoy: HOY, cola: extra.cola || null });
      page.erroresPagina = errores;
      return page;
    }

    // — Modal —
    {
      const page = await pagina({ gastos: [G] });
      const lanzar = () => page.evaluate((g) => { window.__resultado = undefined; window.revisarPosibleDuplicado('gastos', g).then((r) => { window.__resultado = r; }); }, { ...G, id: undefined });
      await lanzar();
      afirmar(await page.locator('#modal-posible-duplicado').count() === 1, 'modal: aparece con un posible duplicado');
      const texto = await page.locator('#modal-posible-duplicado').innerText();
      afirmar(/Posible duplicado/.test(texto) && /Fecha: 01\/11\/2026/.test(texto) && /Capturó: Admin/.test(texto) && /Cuándo:/.test(texto) && !/Cuándo: —/.test(texto) && /Coinciden: .*fecha.*proveedor.*monto.*concepto.*categoría/.test(texto), 'modal: muestra fecha, quién y cuándo lo capturó y los campos que coinciden: ' + texto.replace(/\n/g, ' | '));
      afirmar(await page.locator('#modal-posible-duplicado').getByRole('button', { name: 'Es otro registro, guardar' }).count() === 1 && await page.locator('#modal-posible-duplicado').getByRole('button', { name: 'Cancelar' }).count() === 1, 'modal: botones «Es otro registro, guardar» y «Cancelar»');
      await page.locator('#modal-posible-duplicado').getByRole('button', { name: 'Cancelar' }).click();
      igual(await page.evaluate(() => window.__resultado), { continuar: false, confirmado: false }, 'modal: Cancelar -> no continuar');
      afirmar(await page.locator('#modal-posible-duplicado').count() === 0, 'modal: se cierra');
      await lanzar();
      await page.locator('#modal-posible-duplicado').getByRole('button', { name: 'Es otro registro, guardar' }).click();
      igual(await page.evaluate(() => window.__resultado), { continuar: true, confirmado: true }, 'modal: «Es otro registro, guardar» -> continuar y confirmado');
      await lanzar();
      await page.keyboard.press('Escape');
      igual(await page.evaluate(() => window.__resultado), { continuar: false, confirmado: false }, 'modal: Escape cancela');
      afirmar(page.erroresPagina.length === 0, 'modal: sin errores de JavaScript');
      await page.close();
    }

    // — Un registro pendiente en la cola offline también dispara el aviso —
    {
      const pendiente = { coleccion: 'gastos', datos: { ...G, id: undefined, creadoPor: 'Operador', fechaRegistro: '2026-11-04T09:00:00.000Z' } };
      const page = await pagina({ gastos: [], cola: [pendiente, { coleccion: 'pagos', datos: { ...G } }] });
      await page.evaluate((g) => { window.__resultado = undefined; window.revisarPosibleDuplicado('gastos', g).then((r) => { window.__resultado = r; }); }, { ...G, id: undefined });
      const texto = await page.locator('#modal-posible-duplicado').innerText();
      afirmar(/pendiente de sincronizar/.test(texto) && /Capturó: Operador/.test(texto), 'cola offline: el aviso muestra el registro pendiente de sincronizar');
      await page.locator('#modal-posible-duplicado').getByRole('button', { name: 'Cancelar' }).click();
      await page.close();
    }

    // — Formulario real de Gastos —
    {
      const page = await pagina({ gastos: [G] });
      await page.evaluate(() => window.EVE_MODULES.gastos.render(document.getElementById('main-content')));
      const llenar = async (concepto) => {
        await page.fill('#ga-fecha', '2026-11-01');
        await page.fill('#ga-beneficiario', 'GAS DEL NORTE');
        await page.fill('#ga-concepto', concepto);
        await page.fill('#ga-monto-base', '1200.5');
        await page.selectOption('#ga-tipo', 'operacion');
      };
      const enviar = () => page.evaluate(() => document.getElementById('gastos-form').requestSubmit());
      const guardados = () => page.evaluate(() => window.__guardados);

      await llenar('Diésel');
      await enviar();
      afirmar(await page.locator('#modal-posible-duplicado').count() === 1, 'Gastos: un gasto igual al existente muestra el modal');
      afirmar((await guardados()).length === 0, 'Gastos: mientras el modal está abierto no se guarda nada (es aviso, pero espera la decisión)');
      await enviar();
      afirmar(await page.locator('#modal-posible-duplicado').count() === 1, 'Gastos: un segundo envío mientras el modal está abierto no abre otro (doble clic protegido)');
      await page.locator('#modal-posible-duplicado').getByRole('button', { name: 'Cancelar' }).click();
      await page.waitForTimeout(50);
      afirmar((await guardados()).length === 0, 'Gastos: Cancelar no guarda');

      await enviar();
      await page.locator('#modal-posible-duplicado').getByRole('button', { name: 'Es otro registro, guardar' }).click();
      await page.waitForTimeout(100);
      const g1 = await guardados();
      afirmar(g1.length === 1 && g1[0].coleccion === 'gastos' && g1[0].datos.duplicadoConfirmado === true && g1[0].datos.concepto === 'Diésel', 'Gastos: «Es otro registro, guardar» guarda con duplicadoConfirmado: true');

      // Un gasto distinto se guarda sin aviso y sin la marca
      await page.evaluate(() => { window.EVE.gastos = window.EVE.gastos.filter((x) => x.id === 'g1'); });
      await page.waitForTimeout(2700); // el bloqueo de doble registro (ENFRIAMIENTO_DOBLE_REGISTRO_MS = 2500) ya expiró
      await llenar('Refacciones');
      await page.fill('#ga-beneficiario', 'FERRETERIA');
      await page.fill('#ga-monto-base', '300'); // solo coinciden fecha y categoría (2 de 5)
      await enviar();
      await page.waitForTimeout(100);
      afirmar(await page.locator('#modal-posible-duplicado').count() === 0, 'Gastos: un gasto distinto no muestra aviso');
      const g2 = await guardados();
      afirmar(g2.length === 2 && g2[1].datos.concepto === 'Refacciones' && !('duplicadoConfirmado' in g2[1].datos), 'Gastos: un gasto distinto se guarda sin duplicadoConfirmado');
      afirmar(JSON.stringify(await page.evaluate(() => window.EVE.gastos.find((x) => x.id === 'g1'))) === JSON.stringify(G), 'Gastos: el gasto existente no se modificó');
      afirmar(page.erroresPagina.length === 0, 'Gastos: sin errores de JavaScript: ' + page.erroresPagina.join(' / '));
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // ══ Parte 3: estática ══
  const antes = (archivo, llamada, guardado) => {
    const src = leer(archivo);
    const i = src.indexOf(llamada);
    const j = src.indexOf(guardado, i);
    return i > 0 && j > i;
  };
  afirmar(antes('js/ventas.js', "revisarPosibleDuplicado('ventas', venta)", 'guardarVentaNueva(venta)'), 'Ventas: revisa antes de guardar');
  afirmar(antes('js/pagos.js', "revisarPosibleDuplicado('pagos', registro)", "window.guardarDato('pagos', registro)"), 'Pagos: revisa antes de guardar');
  afirmar(antes('js/cxc.js', "revisarPosibleDuplicado('cobros'", 'registrarCobroFactura(modalContexto.cliente'), 'Cobros de CxC: revisa antes de registrar');
  afirmar(antes('js/gastos.js', "revisarPosibleDuplicado('gastos', gasto)", "window.guardarDato('gastos', gasto)"), 'Gastos: revisa antes de guardar');
  afirmar(antes('js/recibosdinero.js', "revisarPosibleDuplicado('recibos', datos)", 'await guardarRecibo(datos)'), 'Recibos de dinero: revisa antes de guardar');
  afirmar(antes('js/ordenescompra.js', "revisarPosibleDuplicado('oc'", 'await guardarOrden(datos, editando'), 'Órdenes de compra: revisa antes de guardar');
  afirmar(leer('js/ventas.js').includes('venta.duplicadoConfirmado = true') && leer('js/pagos.js').includes('registro.duplicadoConfirmado = true') && leer('js/gastos.js').includes('gasto.duplicadoConfirmado = true')
    && leer('js/recibosdinero.js').includes('datos.duplicadoConfirmado ? { duplicadoConfirmado: true }') && leer('js/ordenescompra.js').includes('datos.duplicadoConfirmado ? { duplicadoConfirmado: true }')
    && leer('js/cxc.js').includes('marcaDuplicadoCobro()'), 'cada módulo guarda duplicadoConfirmado: true cuando se confirma');
  afirmar(leer('js/ordenescompra.js').includes('if (!editando) {\n          const revision'), 'Órdenes de compra: solo el alta se revisa, no la edición');
  const offline = leer('js/offline.js');
  const iRev = offline.indexOf('revisarItemColaDuplicado(item.coleccion, item.datos, subidos)');
  afirmar(iRev > 0 && iRev < offline.indexOf('guardarDatoFirebase(item.coleccion, datosASubir)') && /await marcarRevision\(item, posibleDuplicado\);\s*enRevisionAhora\+\+;\s*continue;/.test(offline), 'cola offline: un registro que coincide queda en revisión (continue) antes de subirse');
  afirmar(offline.includes("estado: 'revision'") && !/eliminarDeCola\(item\.id\);\s*enRevisionAhora/.test(offline) && offline.includes('Es otro registro, subir') && offline.includes('Descartar'), 'cola offline: en revisión (no se descarta en silencio) y con botones para decidir');
  afirmar(offline.includes("duplicadoConfirmado: true }) }));") || offline.includes('duplicadoConfirmado: true'), 'cola offline: «Es otro registro, subir» marca duplicadoConfirmado');
  const tocados = ['js/ventas.js', 'js/pagos.js', 'js/cxc.js', 'js/gastos.js', 'js/recibosdinero.js', 'js/ordenescompra.js'];
  afirmar(tocados.every((a) => !/db\.collection\([^)]*\)\.(where|get)\([^)]*\)[^;]*detectarPosibleDuplicado/.test(leer(a))), 'la alerta no agrega lecturas a Firestore (usa memoria y la cola)');
  afirmar(!/db\.collection|\.get\(\)/.test(leer('js/utils.js').slice(leer('js/utils.js').indexOf('Alerta de posible duplicado'))), 'el bloque de duplicados de utils.js no consulta Firestore');

  console.log(`${ok}/${total} verificaciones correctas`);
})().catch((e) => { console.error('FALLA: ' + (e.stack || e.message)); process.exitCode = 1; });
