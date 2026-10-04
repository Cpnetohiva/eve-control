// Verificación de la resolución de cuentas al ejecutar un recibo pendiente (Pagos > Recibos Pendientes).
//
// Un mismo ticket puede tener varias cuentas por pagar (una por material y proveedor). Antes se buscaba la cuenta por
// proveedor + ticket y se tomaba la primera, así que el ticket 0907 de JOSE ENRIQUE caía en la cuenta liquidada de
// CRISTAL CON ETIQUETA ("esperado 5850, actual 0.00") en lugar de la de MIXTO. Carga js/config.js, js/utils.js y
// js/pagos.js en un contexto vm y prueba resolverCuentasDelRecibo / revalidarYObtenerCuentasFrescas con casos sintéticos
// (incluido el escenario real del ticket 0907) y que cxp.js guarde cuentaId en cada ticket del recibo.
//
// Uso: node scripts/verificar-pago-recibo-cuenta.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/pagos.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {};
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  return sandbox.window;
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  afirmar(a === b, `${mensaje}: esperado ${b}, obtenido ${a}`);
}

const w = crearContexto();
const resolver = (cuentas, recibo) => w.EVE_PAGOS.resolverCuentasDelRecibo(cuentas, recibo);
const ids = (resultado) => (resultado.cuentas || []).map((c) => c.id);

// Escenario real del ticket 0907: tres cuentas con el mismo ticket. La liquidada de JOSE ENRIQUE va PRIMERA, que es el
// orden en que el código viejo se equivocaba.
const cuenta = (id, proveedor, material, saldo, extra) => Object.assign({ id, proveedor, ticket: '0907', material, saldo, total: 5850, estado: saldo > 0 ? 'pendiente' : 'liquidada' }, extra);
const ETIQUETA = cuenta('b1', 'JOSE ENRIQUE', 'CRISTAL CON ETIQUETA', 0);
const MIXTO = cuenta('c1', 'JOSE ENRIQUE', 'MIXTO', 5850);
const LECHERO = cuenta('a1', 'FRANCISCO', 'CRISTAL CON LECHERO', 0);
const CUENTAS_0907 = () => [ETIQUETA, MIXTO, LECHERO].map((c) => ({ ...c }));

const renglon = (material, saldo, extra) => Object.assign({ ticket: '0907', material, saldo, montoAsignado: saldo }, extra);
const recibo = (proveedor, tickets) => ({ id: 'r1', proveedor, tickets, montoTotal: 0, estado: 'pendiente_pago' });

caso('Escenario 0907: la lógica vieja (proveedor + ticket, la primera) caía en la cuenta liquidada', () => {
  const cuentas = CUENTAS_0907();
  const vieja = cuentas.find((c) => c.proveedor === 'JOSE ENRIQUE' && String(c.ticket) === '0907');
  igual(vieja.id, 'b1', 'el código viejo tomaba la liquidada (saldo 0)');
  igual(vieja.saldo, 0, 'de ahí "actual 0.00"');
});

caso('Escenario 0907: recibo viejo (sin cuentaId) de JOSE ENRIQUE / MIXTO 5850 resuelve a la cuenta de MIXTO', () => {
  const r = resolver(CUENTAS_0907(), recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850)]));
  afirmar(!r.error, `sin error: ${r.error}`);
  igual(ids(r), ['c1'], 'cuenta de MIXTO, no la liquidada de ETIQUETA ni la de FRANCISCO');
  igual(r.cuentas[0].saldo, 5850, 'saldo 5850');
});

caso('Escenario 0907: recibo nuevo con cuentaId resuelve por id', () => {
  const r = resolver(CUENTAS_0907(), recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850, { cuentaId: 'c1' })]));
  igual(ids(r), ['c1'], 'por cuentaId');
});

caso('Nunca toma una cuenta de otro proveedor con el mismo ticket', () => {
  const cuentas = CUENTAS_0907();
  const sinMixtoJose = cuentas.filter((c) => c.id !== 'c1');
  const r = resolver(sinMixtoJose, recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850)]));
  afirmar(r.error && !r.cuentas, 'sin cuenta de MIXTO de JOSE ENRIQUE: error');
  const f = resolver(CUENTAS_0907(), recibo('FRANCISCO', [renglon('MIXTO', 5850)]));
  afirmar(f.error && !f.cuentas, 'FRANCISCO no tiene MIXTO: no se le asigna la de JOSE ENRIQUE');
});

caso('cuentaId que apunta a una cuenta de otro proveedor, otro material o inexistente: error y sin cuentas', () => {
  const deOtro = resolver(CUENTAS_0907(), recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850, { cuentaId: 'a1' })]));
  afirmar(deOtro.error && !deOtro.cuentas, 'cuenta de FRANCISCO');
  const otroMaterial = resolver(CUENTAS_0907(), recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850, { cuentaId: 'b1' })]));
  afirmar(otroMaterial.error && !otroMaterial.cuentas, 'cuenta de ETIQUETA para un renglón de MIXTO');
  const inexistente = resolver(CUENTAS_0907(), recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850, { cuentaId: 'zzz' })]));
  afirmar(inexistente.error && !inexistente.cuentas, 'id inexistente');
});

caso('Dos renglones del mismo ticket en un recibo se aplican a cuentas DISTINTAS (con y sin cuentaId)', () => {
  const sinId = resolver(CUENTAS_0907(), recibo('JOSE ENRIQUE', [renglon('CRISTAL CON ETIQUETA', 0), renglon('MIXTO', 5850)]));
  igual(ids(sinId), ['b1', 'c1'], 'sin cuentaId, por material');
  const conId = resolver(CUENTAS_0907(), recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850, { cuentaId: 'c1' }), renglon('CRISTAL CON ETIQUETA', 0, { cuentaId: 'b1' })]));
  igual(ids(conId), ['c1', 'b1'], 'con cuentaId, respeta el orden del recibo');
  const repetida = resolver(CUENTAS_0907(), recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850, { cuentaId: 'c1' }), renglon('MIXTO', 5850, { cuentaId: 'c1' })]));
  afirmar(repetida.error && !repetida.cuentas, 'el mismo cuentaId dos veces: error');
});

caso('Mismo proveedor + ticket + material en dos cuentas: desempata solo si exactamente una tiene saldo pendiente', () => {
  const liquidada = cuenta('d1', 'JOSE ENRIQUE', 'MIXTO', 0);
  const pendiente = cuenta('d2', 'JOSE ENRIQUE', 'MIXTO', 5850);
  const r = resolver([liquidada, pendiente], recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850)]));
  afirmar(!r.error, `sin error: ${r.error}`);
  igual(ids(r), ['d2'], 'la pendiente');
  const r2 = resolver([pendiente, liquidada], recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850)]));
  igual(ids(r2), ['d2'], 'sin depender del orden');
});

caso('Sigue ambiguo (dos pendientes o ninguna pendiente): error de ambigüedad y no se resuelve', () => {
  const dosPendientes = resolver([cuenta('d1', 'JOSE ENRIQUE', 'MIXTO', 100), cuenta('d2', 'JOSE ENRIQUE', 'MIXTO', 200)], recibo('JOSE ENRIQUE', [renglon('MIXTO', 100)]));
  afirmar(dosPendientes.error && !dosPendientes.cuentas, 'dos pendientes');
  afirmar(/no se puede saber cuál pagar/.test(dosPendientes.error), `mensaje claro: ${dosPendientes.error}`);
  afirmar(/No se ejecutó el pago/.test(dosPendientes.error), 'dice que no se ejecutó el pago');
  const ningunaPendiente = resolver([cuenta('d1', 'JOSE ENRIQUE', 'MIXTO', 0), cuenta('d2', 'JOSE ENRIQUE', 'MIXTO', 0)], recibo('JOSE ENRIQUE', [renglon('MIXTO', 0)]));
  afirmar(ningunaPendiente.error && /no se puede saber/.test(ningunaPendiente.error), 'ninguna pendiente');
});

caso('Dos renglones idénticos y dos cuentas idénticas sin cuentaId: ambiguo (no se adivina); con cuentaId: distintas', () => {
  const gemelas = [cuenta('e1', 'JOSE ENRIQUE', 'MIXTO', 100), cuenta('e2', 'JOSE ENRIQUE', 'MIXTO', 100)];
  const sinId = resolver(gemelas, recibo('JOSE ENRIQUE', [renglon('MIXTO', 100), renglon('MIXTO', 100)]));
  afirmar(sinId.error && !sinId.cuentas, 'sin cuentaId: error');
  const conId = resolver(gemelas, recibo('JOSE ENRIQUE', [renglon('MIXTO', 100, { cuentaId: 'e1' }), renglon('MIXTO', 100, { cuentaId: 'e2' })]));
  igual(ids(conId), ['e1', 'e2'], 'con cuentaId: una cada renglón');
});

caso('Alias y mayúsculas: J.ENRIQUE en el recibo o en la cuenta resuelve igual; el material se compara normalizado', () => {
  const r = resolver(CUENTAS_0907(), recibo('J.ENRIQUE', [renglon('MIXTO', 5850)]));
  igual(ids(r), ['c1'], 'recibo con alias');
  const conAliasEnCuenta = CUENTAS_0907().map((c) => (c.id === 'c1' ? { ...c, proveedor: 'J.ENRIQUE' } : c));
  igual(ids(resolver(conAliasEnCuenta, recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850)]))), ['c1'], 'cuenta con alias crudo');
  const alias = resolver(CUENTAS_0907(), recibo('JOSE ENRIQUE', [renglon('cristal con etiq', 0)]));
  igual(ids(alias), ['b1'], 'material con alias (CRISTAL CON ETIQ) y en minúsculas');
});

caso('cuentaCoincideConRenglon exige proveedor, ticket y material', () => {
  const coincide = (c, prov, t) => w.EVE_PAGOS.cuentaCoincideConRenglon(c, prov, t);
  afirmar(coincide(MIXTO, 'JOSE ENRIQUE', renglon('MIXTO', 1)), 'coincide');
  afirmar(!coincide(MIXTO, 'FRANCISCO', renglon('MIXTO', 1)), 'otro proveedor');
  afirmar(!coincide(MIXTO, 'JOSE ENRIQUE', { ...renglon('MIXTO', 1), ticket: '0908' }), 'otro ticket');
  afirmar(!coincide(MIXTO, 'JOSE ENRIQUE', renglon('CRISTAL CON ETIQUETA', 1)), 'otro material');
  afirmar(coincide(MIXTO, 'J. ENRIQUE', { ...renglon('MIXTO', 1), ticket: 907 }) === false, 'ticket 907 ≠ "0907" (comparación exacta, como en el resto del sistema)');
});

// ===== revalidarYObtenerCuentasFrescas con Firestore simulado =====
function conFirestore(docs, fn) {
  const lecturas = [];
  w.db = { collection: (nombre) => ({ doc: (id) => ({ get: async () => { lecturas.push(`${nombre}/${id}`); const d = docs[id]; return { exists: !!d, data: () => ({ ...d }) }; } }) }) };
  return fn(lecturas);
}

caso('revalidar: escenario 0907 lee y devuelve solo la cuenta de MIXTO, con el proveedor canónico', async () => {
  w.EVE.cuentasPorPagar = CUENTAS_0907();
  const docs = { b1: { ...ETIQUETA, proveedor: 'J.ENRIQUE' }, c1: { ...MIXTO, proveedor: 'J.ENRIQUE' }, a1: { ...LECHERO } };
  await conFirestore(docs, async (lecturas) => {
    const frescas = await w.EVE_PAGOS.revalidarYObtenerCuentasFrescas(recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850, { cuentaId: 'c1' })]));
    igual(frescas.map((c) => c.id), ['c1'], 'cuenta de MIXTO');
    igual(lecturas, ['cuentas_por_pagar/c1'], 'solo lee esa cuenta');
    igual(frescas[0].proveedor, 'JOSE ENRIQUE', 'el proveedor crudo del doc fresco se normaliza');
  });
});

caso('revalidar: recibo viejo del 0907 (sin cuentaId) ya no falla con "actual 0.00"', async () => {
  w.EVE.cuentasPorPagar = CUENTAS_0907();
  const docs = { b1: { ...ETIQUETA }, c1: { ...MIXTO }, a1: { ...LECHERO } };
  await conFirestore(docs, async () => {
    const frescas = await w.EVE_PAGOS.revalidarYObtenerCuentasFrescas(recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850)]));
    igual(frescas.map((c) => c.id), ['c1'], 'MIXTO');
  });
});

caso('revalidar: si el saldo cambió de verdad sigue avisando y no devuelve cuentas', async () => {
  w.EVE.cuentasPorPagar = CUENTAS_0907();
  const docs = { c1: { ...MIXTO, saldo: 1000 } };
  await conFirestore(docs, async () => {
    let error = null;
    try { await w.EVE_PAGOS.revalidarYObtenerCuentasFrescas(recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850, { cuentaId: 'c1' })])); } catch (e) { error = e; }
    afirmar(error && /cambió de saldo/.test(error.message), `error de saldo: ${error && error.message}`);
  });
});

caso('revalidar: ambigüedad corta ANTES de leer Firestore (no se escribe ni se lee nada)', async () => {
  w.EVE.cuentasPorPagar = [cuenta('d1', 'JOSE ENRIQUE', 'MIXTO', 100), cuenta('d2', 'JOSE ENRIQUE', 'MIXTO', 200)];
  await conFirestore({}, async (lecturas) => {
    let error = null;
    try { await w.EVE_PAGOS.revalidarYObtenerCuentasFrescas(recibo('JOSE ENRIQUE', [renglon('MIXTO', 100)])); } catch (e) { error = e; }
    afirmar(error && /no se puede saber cuál pagar/.test(error.message), `mensaje: ${error && error.message}`);
    igual(lecturas, [], 'cero lecturas a Firestore');
  });
});

caso('revalidar: si el doc fresco cambió de material o proveedor, no se paga', async () => {
  w.EVE.cuentasPorPagar = CUENTAS_0907();
  await conFirestore({ c1: { ...MIXTO, material: 'CRISTAL CON ETIQUETA' } }, async () => {
    let error = null;
    try { await w.EVE_PAGOS.revalidarYObtenerCuentasFrescas(recibo('JOSE ENRIQUE', [renglon('MIXTO', 5850, { cuentaId: 'c1' })])); } catch (e) { error = e; }
    afirmar(error && /cambió de proveedor, ticket o material/.test(error.message), `mensaje: ${error && error.message}`);
  });
});

caso('revalidar: dos renglones del mismo ticket devuelven dos cuentas distintas en el orden del recibo', async () => {
  w.EVE.cuentasPorPagar = CUENTAS_0907().map((c) => (c.id === 'b1' ? { ...c, saldo: 300 } : c));
  const docs = { b1: { ...ETIQUETA, saldo: 300 }, c1: { ...MIXTO } };
  await conFirestore(docs, async (lecturas) => {
    const frescas = await w.EVE_PAGOS.revalidarYObtenerCuentasFrescas(recibo('JOSE ENRIQUE', [
      renglon('MIXTO', 5850, { cuentaId: 'c1' }), renglon('CRISTAL CON ETIQUETA', 300, { cuentaId: 'b1' })
    ]));
    igual(frescas.map((c) => c.id), ['c1', 'b1'], 'cuentas distintas, mismo orden');
    igual(lecturas, ['cuentas_por_pagar/c1', 'cuentas_por_pagar/b1'], 'una lectura por cuenta');
  });
});

caso('cxp.js guarda cuentaId en cada ticket del recibo y pagos.js ya no empareja por ticket solo', () => {
  const cxp = fs.readFileSync(path.join(RAIZ, 'js/cxp.js'), 'utf8');
  afirmar(/cuentasSeleccionadas\.map\(\(c\) => \(\{[\s\S]{0,260}cuentaId: c\.id/.test(cxp), 'cxp.js: tickets del recibo llevan cuentaId: c.id');
  const pagos = fs.readFileSync(path.join(RAIZ, 'js/pagos.js'), 'utf8');
  afirmar(!/cuentasFrescas\.find\(\(c\) => String\(c\.ticket\) === String\(t\.ticket\)\)/.test(pagos), 'pagos.js: sin cuentasFrescas.find por ticket solo');
  afirmar(/cuentasFrescas\[i\]/.test(pagos), 'pagos.js: empareja por posición');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try {
      await fn();
      console.log(`PASS  ${nombre}`);
    } catch (error) {
      fallos += 1;
      console.log(`FAIL  ${nombre}\n      ${error.message}`);
    }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos > 0 ? 1 : 0);
})();
