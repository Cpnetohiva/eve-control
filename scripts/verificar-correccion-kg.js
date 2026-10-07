// Corrección de kg entre Báscula (Destaraje) y CxP (js/cxp.js, js/destaraje.js).
//
// Cubre: recálculo con precio/comisión congelados (ticket 1160: 1380 -> 1350 kg, total 8775.00), bloqueo con abonos
// (incluido el saldo a favor aplicado, que se guarda como abono) y con saldo inicial, concurrencia (verificarSinPagosFrescos),
// permiso cxp, escritura atómica CxP + Báscula, y las advertencias de Control Producción y auditoría OCR.
//
// Uso: node scripts/verificar-correccion-kg.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js'];

// Firestore mínimo: colecciones en memoria, get por id, where('campo','==',v).get() y batch().update().commit().
function crearDb(colecciones) {
  const almacen = JSON.parse(JSON.stringify(colecciones));
  const estado = { fallarCommit: false };
  const instantanea = (coleccion, id) => {
    const dato = (almacen[coleccion] || {})[id];
    return { exists: !!dato, id, data: () => (dato ? JSON.parse(JSON.stringify(dato)) : undefined) };
  };
  return {
    almacen,
    estado,
    collection: (coleccion) => ({
      doc: (id) => ({ coleccion, id, get: async () => instantanea(coleccion, id) }),
      where: (campo, op, valor) => ({
        get: async () => ({ docs: Object.keys(almacen[coleccion] || {}).filter((id) => almacen[coleccion][id][campo] === valor).map((id) => instantanea(coleccion, id)) })
      })
    }),
    batch: () => {
      const pendientes = [];
      return {
        update: (ref, datos) => pendientes.push([ref, datos]),
        commit: async () => {
          if (estado.fallarCommit) throw new Error('commit falló');
          pendientes.forEach(([ref, datos]) => Object.assign(almacen[ref.coleccion][ref.id], JSON.parse(JSON.stringify(datos))));
        }
      };
    }
  };
}

function crearContexto({ permisos, colecciones, eve }) {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    navigator: { onLine: true },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorPagar: [], registrosDestaraje: [], registrosDestarajeRaw: [], registrosControlProduccion: [], auditorias: [], proveedores: [], ...eve };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  const w = sandbox.window;
  w.db = crearDb(colecciones);
  w.puedeEscribir = (modulo) => permisos[modulo] === 'escritura';
  w.puedeLeer = (modulo) => permisos[modulo] === 'escritura' || permisos[modulo] === 'lectura';
  w.historial = [];
  w.EVE_HISTORIAL = { registrar: (entrada) => w.historial.push(entrada) };
  w.showError = () => {};
  return w;
}

const TODOS = { cxp: 'escritura', destaraje: 'escritura' };

// Ticket 1160: 1380 kg a 6.00 + 0.50 de comisión = 6.50 por kg (total 8970.00). Con 1350 kg: 8775.00.
function cuenta1160(extra) {
  return {
    ticket: '1160', proveedor: 'JOSE PEREZ', material: 'P.P.', kg: 1380, fechaTicket: '2026-10-01',
    precioAplicado: 6, comisionPorKg: 0.5, precioEfectivo: 6.5, montoMaterial: 8280, montoComision: 690, total: 8970,
    pagado: 0, saldo: 8970, iva: 0, estado: 'pendiente', aprobacion: { tipo: 'foto' }, abonos: [], precioNegociado: null, ...extra
  };
}
const bascula1160 = (extra) => ({ ticket: '1160', proveedor: 'JOSE PEREZ', material: 'P.P.', kg: 1380, fechaEntrada: '2026-10-01', fechaSalida: '2026-10-01', ...extra });

// cuentas / basculas: { id: documento }. La memoria (window.EVE) se arma con los mismos documentos.
function escenario({ cuentas, basculas, permisos, eve }) {
  const colecciones = { cuentas_por_pagar: cuentas || {}, destaraje: basculas || {} };
  const conId = (mapa) => Object.keys(mapa).map((id) => ({ id, ...JSON.parse(JSON.stringify(mapa[id])) }));
  const memoria = {
    cuentasPorPagar: conId(colecciones.cuentas_por_pagar),
    registrosDestaraje: conId(colecciones.destaraje),
    registrosDestarajeRaw: conId(colecciones.destaraje)
  };
  return crearContexto({ permisos: permisos || TODOS, colecciones, eve: { ...memoria, ...eve } });
}
const simple = (cxp, bascula, extra) => escenario({ cuentas: cxp ? { cxp1: cxp } : {}, basculas: bascula ? { bas1: bascula } : {}, ...extra });

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const rechaza = async (promesa, texto, mensaje) => {
  try { await promesa; } catch (error) { afirmar(error.message.includes(texto), `${mensaje}: el error "${error.message}" no contiene "${texto}"`); return; }
  throw new Error(`${mensaje}: debía rechazar con "${texto}"`);
};

caso('calcularCorreccionKgCxP: ticket 1160, 1380 -> 1350 kg da total 8775.00 con precio/comisión congelados', () => {
  const w = simple();
  const c = w.EVE_CXP.calcularCorreccionKgCxP(cuenta1160(), 1350, 'Corrección de peso en Báscula');
  igual([c.kg, c.kgAnterior, c.montoMaterial, c.montoComision, c.total, c.saldo, c.estado], [1350, 1380, 8100, 675, 8775, 8775, 'pendiente'], 'montos');
  igual(c.motivoAjusteKg, 'Corrección de peso en Báscula', 'motivo');
});

caso('calcularCorreccionKgCxP: usa el precio negociado y conserva el IVA', () => {
  const w = simple();
  const c = w.EVE_CXP.calcularCorreccionKgCxP(cuenta1160({ precioNegociado: 7, iva: 100 }), 1000, 'x');
  igual([c.montoMaterial, c.montoComision, c.total, c.saldo, c.precioEfectivo], [7000, 500, 7600, 7600, 7.5], 'con negociado + IVA');
});

caso('calcularCorreccionKgCxP: kg 0, negativo o vacío se rechazan', () => {
  const w = simple();
  ['', 0, -5, 'abc', null].forEach((kg) => {
    let error = null;
    try { w.EVE_CXP.calcularCorreccionKgCxP(cuenta1160(), kg, 'x'); } catch (e) { error = e; }
    afirmar(error && error.message.includes('mayor a 0'), `kg ${JSON.stringify(kg)} debe rechazarse`);
  });
});

caso('Parte 1: sin CxP del ticket devuelve null (Báscula guarda normal)', async () => {
  const w = simple(null, bascula1160());
  igual(await w.EVE_CXP.prepararCorreccionKgDesdeBascula(bascula1160({ id: 'bas1' }), 1350), null, 'sin CxP');
});

caso('Parte 1: con CxP sin abonos recalcula y el lote deja CxP y Báscula con el mismo kg', async () => {
  const w = simple(cuenta1160(), bascula1160());
  const plan = await w.EVE_CXP.prepararCorreccionKgDesdeBascula(bascula1160({ id: 'bas1' }), 1350);
  igual(plan.cambios.total, 8775, 'total del plan');
  await w.EVE_CXP.guardarCorreccionKg({ cxp: plan.cxp, cambiosCxP: plan.cambios, basculaId: 'bas1', cambiosBascula: { ...bascula1160(), kg: 1350 } });
  const cxp = w.db.almacen.cuentas_por_pagar.cxp1;
  igual([cxp.kg, cxp.kgAnterior, cxp.total, cxp.saldo, cxp.estado, cxp.motivoAjusteKg], [1350, 1380, 8775, 8775, 'pendiente', 'Corrección de peso en Báscula'], 'CxP en Firestore');
  igual(w.db.almacen.destaraje.bas1.kg, 1350, 'Báscula en Firestore');
  igual(w.EVE.cuentasPorPagar[0].total, 8775, 'CxP en memoria');
  igual(w.historial.map((h) => h.coleccion), ['cuentas_por_pagar'], 'historial de la CxP');
});

caso('Parte 1: la CxP de otro proveedor con el mismo ticket no se toca', async () => {
  const w = simple(cuenta1160({ proveedor: 'OTRO' }), bascula1160());
  igual(await w.EVE_CXP.prepararCorreccionKgDesdeBascula(bascula1160({ id: 'bas1' }), 1350), null, 'otro proveedor');
});

caso('Ticket con varias CxP: elige la del material (y luego la del kg) del renglón editado', async () => {
  const w = escenario({
    cuentas: { c1: cuenta1160({ material: 'BIDON', kg: 200 }), c2: cuenta1160({ material: 'P.P.', kg: 1380 }) },
    basculas: { b1: bascula1160(), b2: bascula1160({ material: 'BIDON', kg: 200 }) }
  });
  const plan = await w.EVE_CXP.prepararCorreccionKgDesdeBascula(bascula1160({ id: 'b1' }), 1350);
  igual([plan.cxp.id, plan.cxp.material], ['c2', 'P.P.'], 'por material');
  const w2 = escenario({ cuentas: { c1: cuenta1160({ kg: 200 }), c2: cuenta1160({ kg: 1380 }) }, basculas: { b1: bascula1160() } });
  const plan2 = await w2.EVE_CXP.prepararCorreccionKgDesdeBascula(bascula1160({ id: 'b1' }), 1350);
  igual(plan2.cxp.id, 'c2', 'por kg anterior cuando el material coincide en ambas');
  const w3 = escenario({ cuentas: { c1: cuenta1160(), c2: cuenta1160() }, basculas: { b1: bascula1160() } });
  await rechaza(w3.EVE_CXP.prepararCorreccionKgDesdeBascula(bascula1160({ id: 'b1' }), 1350), 'varias cuentas por pagar', 'ambigüedad');
});

caso('Regla común: con abonos activos bloquea con "Revierte los abonos de la CxP primero"', async () => {
  const abono = { monto: 100, abonoId: 'a1', referencia: 'Efectivo' };
  const w = simple(cuenta1160({ pagado: 100, saldo: 8870, estado: 'parcial', abonos: [abono] }), bascula1160());
  await rechaza(w.EVE_CXP.prepararCorreccionKgDesdeBascula(bascula1160({ id: 'bas1' }), 1350), 'Revierte los abonos de la CxP primero', 'Báscula');
  await rechaza(w.EVE_CXP.corregirKgCxP('cxp1', 1350, 'peso', 'Admin'), 'Revierte los abonos de la CxP primero', 'CxP');
  igual(w.db.almacen.cuentas_por_pagar.cxp1.kg, 1380, 'la CxP no cambió');
});

caso('Saldo a favor aplicado (se guarda como abono) también bloquea', async () => {
  const w = simple();
  const proveedor = { nombre: 'JOSE PEREZ', saldoAFavor: [{ monto: 500, fecha: '2026-09-30', revertido: false, grupoPagoId: 'pago_x' }] };
  w.obtenerFechaMexico = () => '2026-10-06';
  const aplicada = w.EVE_CXP.aplicarSaldoAFavor(proveedor, cuenta1160());
  igual([aplicada.aplicado, aplicada.docCxP.pagado, aplicada.docCxP.abonos.length], [500, 500, 1], 'aplicarSaldoAFavor guarda un abono');
  const w2 = simple(aplicada.docCxP, bascula1160());
  await rechaza(w2.EVE_CXP.corregirKgCxP('cxp1', 1350, 'peso', 'Admin'), 'Revierte los abonos de la CxP primero', 'saldo a favor');
});

caso('Concurrencia: un abono registrado desde otra sesión (solo en Firestore) bloquea y refresca la memoria', async () => {
  const w = simple(cuenta1160({ pagado: 50, saldo: 8920, estado: 'parcial', abonos: [{ monto: 50, abonoId: 'a1' }] }), bascula1160());
  w.EVE.cuentasPorPagar[0] = { id: 'cxp1', ...cuenta1160() }; // memoria desactualizada: sin abonos
  await rechaza(w.EVE_CXP.corregirKgCxP('cxp1', 1350, 'peso', 'Admin'), 'abonos', 'concurrencia');
  igual(w.EVE.cuentasPorPagar[0].pagado, 50, 'memoria refrescada con el dato fresco');
  igual(w.db.almacen.cuentas_por_pagar.cxp1.kg, 1380, 'sin escritura');
});

caso('Saldo inicial no se puede corregir', async () => {
  const w = simple(cuenta1160({ aprobacion: { tipo: 'saldo_inicial' } }), bascula1160());
  await rechaza(w.EVE_CXP.corregirKgCxP('cxp1', 1350, 'peso', 'Admin'), 'saldo inicial', 'saldo inicial');
});

caso('Permisos: sin escritura en cxp bloquea (Báscula y CxP); sin lectura de cxp no puede verificar', async () => {
  const lectura = simple(cuenta1160(), bascula1160(), { permisos: { cxp: 'lectura', destaraje: 'escritura' } });
  await rechaza(lectura.EVE_CXP.prepararCorreccionKgDesdeBascula(bascula1160({ id: 'bas1' }), 1350), 'permiso de escritura en CxP', 'lectura Báscula');
  await rechaza(lectura.EVE_CXP.corregirKgCxP('cxp1', 1350, 'peso', 'Admin'), 'permiso de escritura en CxP', 'lectura CxP');
  const sinCxp = simple(cuenta1160(), bascula1160(), { permisos: { destaraje: 'escritura' } });
  await rechaza(sinCxp.EVE_CXP.prepararCorreccionKgDesdeBascula(bascula1160({ id: 'bas1' }), 1350), 'El kg de un ticket solo se corrige desde CxP. Avisa al responsable de CxP para que use Editar kg.', 'sin lectura');
  const lecturaSinCxp = simple(null, bascula1160(), { permisos: { cxp: 'lectura', destaraje: 'escritura' } });
  igual(await lecturaSinCxp.EVE_CXP.prepararCorreccionKgDesdeBascula(bascula1160({ id: 'bas1' }), 1350), null, 'lectura sin CxP: guarda normal');
});

caso('Parte 2: Editar kg actualiza CxP y Báscula, exige motivo y kg > 0', async () => {
  const w = simple(cuenta1160(), bascula1160());
  await rechaza(w.EVE_CXP.corregirKgCxP('cxp1', 1350, '  ', 'Admin'), 'motivo', 'motivo obligatorio');
  await rechaza(w.EVE_CXP.corregirKgCxP('cxp1', 0, 'peso', 'Admin'), 'mayor a 0', 'kg > 0');
  const r = await w.EVE_CXP.corregirKgCxP('cxp1', 1350, 'Báscula mal capturada', 'Admin');
  igual(r.cancelado, false, 'no cancelado');
  const cxp = w.db.almacen.cuentas_por_pagar.cxp1;
  igual([cxp.kg, cxp.kgAnterior, cxp.total, cxp.motivoAjusteKg], [1350, 1380, 8775, 'Báscula mal capturada'], 'CxP');
  igual(w.db.almacen.destaraje.bas1.kg, 1350, 'Báscula en Firestore');
  igual([w.EVE.registrosDestaraje[0].kg, w.EVE.registrosDestarajeRaw[0].kg], [1350, 1350], 'Báscula en memoria (Inventario, Control Producción)');
  igual(w.historial.map((h) => h.coleccion).sort(), ['cuentas_por_pagar', 'destaraje'], 'historial de ambos');
});

caso('Parte 2: sin permiso de escritura en Báscula no se actualiza nada', async () => {
  const w = simple(cuenta1160(), bascula1160(), { permisos: { cxp: 'escritura', destaraje: 'lectura' } });
  await rechaza(w.EVE_CXP.corregirKgCxP('cxp1', 1350, 'peso', 'Admin'), 'permiso de escritura en Báscula', 'sin escritura Báscula');
  igual(w.db.almacen.cuentas_por_pagar.cxp1.kg, 1380, 'CxP intacta');
});

caso('Parte 2: sin registro de Báscula solo se actualiza la CxP', async () => {
  const w = simple(cuenta1160(), null);
  await w.EVE_CXP.corregirKgCxP('cxp1', 1350, 'peso', 'Admin');
  igual(w.db.almacen.cuentas_por_pagar.cxp1.total, 8775, 'CxP');
});

caso('Si el lote falla no cambia nada (ni Firestore ni memoria)', async () => {
  const w = simple(cuenta1160(), bascula1160());
  w.db.estado.fallarCommit = true;
  await rechaza(w.EVE_CXP.corregirKgCxP('cxp1', 1350, 'peso', 'Admin'), 'commit falló', 'lote');
  igual([w.db.almacen.cuentas_por_pagar.cxp1.kg, w.db.almacen.destaraje.bas1.kg, w.EVE.cuentasPorPagar[0].kg], [1380, 1380, 1380], 'sin cambios');
});

caso('Advertencias: Control Producción (ticketOrigen) y auditoría OCR COINCIDE, sin bloquear', () => {
  const w = simple();
  const datos = {
    registrosControlProduccion: [{ ticket: 'CP-9', inputs: [{ material: 'P.P.', kg: 100, ticketOrigen: '1160' }] }, { ticket: 'CP-8', inputs: [{ ticketOrigen: '999' }] }],
    auditorias: [{ resultados: [{ ticket: '1160', estado: 'COINCIDE' }, { ticket: '1161', estado: 'DIFERENCIA' }] }]
  };
  const a = w.EVE_CXP.advertenciasCorreccionKg('1160', 1350, datos);
  igual(a.length, 2, 'dos advertencias');
  afirmar(a[0].includes('CP-9') && !a[0].includes('CP-8'), 'solo el proceso que usa el ticket');
  afirmar(a[1].includes('COINCIDE') && a[1].includes('1350'), 'aviso OCR con el kg nuevo');
  igual(w.EVE_CXP.advertenciasCorreccionKg('1161', 10, datos).length, 0, 'ticket sin procesos ni COINCIDE');
});

caso('Parte 2 con advertencias: confirmar() puede cancelar sin escribir', async () => {
  const eve = { registrosControlProduccion: [{ ticket: 'CP-9', inputs: [{ ticketOrigen: '1160' }] }] };
  const w = simple(cuenta1160(), bascula1160(), { eve });
  const cancelado = await w.EVE_CXP.corregirKgCxP('cxp1', 1350, 'peso', 'Admin', { confirmar: async () => false });
  igual(cancelado.cancelado, true, 'cancelado');
  igual(w.db.almacen.cuentas_por_pagar.cxp1.kg, 1380, 'sin escritura');
  const aceptado = await w.EVE_CXP.corregirKgCxP('cxp1', 1350, 'peso', 'Admin', { confirmar: async (adv) => adv.length === 1 });
  igual(aceptado.cancelado, false, 'aceptado');
  igual(w.db.almacen.cuentas_por_pagar.cxp1.kg, 1350, 'escribe al confirmar');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FAIL ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
