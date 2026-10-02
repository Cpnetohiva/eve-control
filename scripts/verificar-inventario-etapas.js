// K18 — Verificación de la etapa de origen al consumir (ORIGEN_POR_PROCESO v6).
//
// Carga en un contexto vm js/config.js, js/utils.js e js/inventario.js y ejecuta casos sintéticos sobre
// window.EVE_INVENTARIO: el consumo de cada input se reparte entre las etapas de origen del proceso, lo que
// falta queda negativo y avisa (calcularAvisosOrigen), y el saldo total no cambia.
//
// Uso: node scripts/verificar-inventario-etapas.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/inventario.js'];

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

const w = crearContexto();
const INV = w.EVE_INVENTARIO;

// ── Helpers de datos ─────────────────────────────────────────────────────

const VACIO = { inventarioInicial: [], registrosDestaraje: [], registrosControlProduccion: [], ventas: [] };
let secuencia = 0;
const compra = (material, kg, fecha) => ({ id: `d${++secuencia}`, ticket: String(100 + secuencia), material, kg, fechaSalida: fecha, fechaEntrada: fecha });
const inicial = (material, etapa, kg) => ({ id: `i${++secuencia}`, material, etapa, kg, fecha: '2026-01-01' });
const inp = (material, kg) => ({ material, kg });
const out = (material, kg, esMerma) => ({ material, kg, esMerma: !!esMerma });
// Los tickets P-### se asignan en orden de creación (el día pesa más; dentro del día, el número).
const proceso = (tipoProceso, inputs, outputs, fecha) => ({ id: `p${++secuencia}`, ticket: `P-${String(secuencia).padStart(3, '0')}`, tipoProceso, inputs, outputs, fecha });
const venta = (material, kg, fecha) => ({ id: `v${++secuencia}`, folio: `V-2026-${String(secuencia).padStart(3, '0')}`, fecha, lineas: [{ material, cantidad: kg }] });

const ledgerDe = (datos) => INV.procesarEventos(INV.construirEventos({ ...VACIO, ...datos }));
const celda = (ledger, material, etapa) => Math.round(((ledger[material] || {})[etapa] || 0) * 100) / 100;
const avisosDe = (datos, registro) => INV.calcularAvisosOrigen({ ...VACIO, ...datos }, registro);
const celdasNegativas = (ledger) => {
  const negativas = [];
  Object.keys(ledger).forEach((m) => Object.keys(ledger[m]).forEach((e) => { if (ledger[m][e] < -1e-6) negativas.push(`${m}/${e}`); }));
  return negativas;
};
const total = (ledger, material) => Math.round(Object.keys(ledger[material] || {}).filter((e) => e !== 'VENDIDO')
  .reduce((suma, e) => suma + ledger[material][e], 0) * 100) / 100;
// Avisos de TODOS los procesos de la lista (cada uno evaluado contra los anteriores).
const avisosCadena = (datos, procesos) => procesos.flatMap((p, i) => avisosDe({ ...datos, registrosControlProduccion: procesos.slice(0, i) }, p));

// ── Mini arnés ───────────────────────────────────────────────────────────

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

// ── Tabla ────────────────────────────────────────────────────────────────

caso('ORIGEN_POR_PROCESO y etapasOrigen siguen la tabla v6', () => {
  igual(INV.ORIGEN_POR_PROCESO.MOLIENDA, ['SELECCIÓN', 'INYECCIÓN', 'SOPLADO'], 'MOLIENDA');
  igual(INV.etapasOrigen('SELECCION', 'LECHERO'), ['RECEPCIÓN'], 'SELECCION de un crudo');
  igual(INV.etapasOrigen('SELECCION', 'P.E. MOLIDO'), [], 'SELECCION de un molido: sin origen');
  igual(INV.etapasOrigen('LAVADO', 'P.E. MOLIDO'), ['MOLIENDA', 'RECEPCIÓN'], 'LAVADO de un molido comprado');
  igual(INV.etapasOrigen('LAVADO', 'P.P.'), ['MOLIENDA'], 'LAVADO de un crudo: sin RECEPCIÓN');
  igual(INV.etapasOrigen('PELETIZADO', 'P.E. MOLIDO'), ['LAVADO', 'MOLIENDA', 'RECEPCIÓN'], 'PELETIZADO de un molido');
  igual(INV.etapasOrigen('PRODUCCION_CAJAS', 'MATERIAL VIRGEN'), ['PELETIZADO', 'RECEPCIÓN'], 'PRODUCCION_CAJAS de MATERIAL VIRGEN');
  igual(INV.etapasOrigen('PRODUCCION_CAJAS', 'LECHERO'), ['PELETIZADO'], 'PRODUCCION_CAJAS de un crudo');
  igual(INV.etapasOrigen('MOLIENDA', 'RECHAZO CAJAS P.E.'), ['SELECCIÓN', 'INYECCIÓN', 'SOPLADO'], 'MOLIENDA nunca agrega RECEPCIÓN');
  igual(INV.etapasOrigen('EMPACADO', 'P.E. MOLIDO'), ['SELECCIÓN'], 'EMPACADO nunca agrega RECEPCIÓN');
});

// ── (a) Selección y Empacado ─────────────────────────────────────────────

const seleccionCristal = () => proceso('SELECCION', [inp('CRISTAL CON ETIQUETA', 1000)],
  [out('PET CRISTAL', 800), out('PET ETIQUETA', 150), out('PET VERDE', 50)], '2026-09-02');

caso('(a) Selección y Empacado de PET CRISTAL: lo demás se queda en SELECCIÓN', () => {
  const c = compra('CRISTAL CON ETIQUETA', 1000, '2026-09-01');
  const sel = seleccionCristal();
  const emp = proceso('EMPACADO', [inp('PET CRISTAL', 800)], [out('PET CRISTAL', 800)], '2026-09-03');
  const l = ledgerDe({ registrosDestaraje: [c], registrosControlProduccion: [sel, emp] });
  igual([celda(l, 'CRISTAL CON ETIQUETA', 'RECEPCIÓN'), celda(l, 'PET ETIQUETA', 'SELECCIÓN'), celda(l, 'PET VERDE', 'SELECCIÓN'), celda(l, 'PET CRISTAL', 'EMPACADO'), celda(l, 'PET CRISTAL', 'SELECCIÓN')], [0, 150, 50, 800, 0], 'celdas con Empacado');
  igual(avisosCadena({ registrosDestaraje: [c] }, [sel, emp]), [], 'sin avisos');
  const sinEmp = ledgerDe({ registrosDestaraje: [c], registrosControlProduccion: [sel] });
  igual(celda(sinEmp, 'PET CRISTAL', 'SELECCIÓN'), 800, 'sin Empacado PET CRISTAL queda en SELECCIÓN');
});

// ── (b) Casos de docs/verificacion_cxp_y_etapas.md ───────────────────────

caso('(b) Selección de 300 kg consume de RECEPCIÓN; la venta de 600 reparte SELECCIÓN y RECEPCIÓN', () => {
  const datos = { inventarioInicial: [inicial('PET CRISTAL', 'RECEPCIÓN', 1000), inicial('PET CRISTAL', 'SELECCIÓN', 500)] };
  const sel = proceso('SELECCION', [inp('PET CRISTAL', 300)], [out('PET CRISTAL', 280), out('BASURA', 20, true)], '2026-09-03');
  const l1 = ledgerDe({ ...datos, registrosControlProduccion: [{ ...sel, outputs: [out('BASURA', 300, true)] }] });
  igual([celda(l1, 'PET CRISTAL', 'RECEPCIÓN'), celda(l1, 'PET CRISTAL', 'SELECCIÓN')], [700, 500], 'selección de 300 kg: consume de RECEPCIÓN');
  const l2 = ledgerDe({ ...datos, ventas: [venta('PET CRISTAL', 600, '2026-09-03')] });
  igual([celda(l2, 'PET CRISTAL', 'SELECCIÓN'), celda(l2, 'PET CRISTAL', 'RECEPCIÓN'), celda(l2, 'PET CRISTAL', 'VENDIDO')], [0, 900, 600], 'venta de 600: reparte');
  igual(celdasNegativas(l2), [], 'sin celdas negativas');
});

// ── (c) Molido comprado sin selección ────────────────────────────────────

caso('(c) Molido comprado: Lavado y Peletizado directos desde RECEPCIÓN sin aviso', () => {
  const c = compra('P.E. MOLIDO', 500, '2026-09-01');
  const lav = proceso('LAVADO', [inp('P.E. MOLIDO', 500)], [out('P.E. MOLIDO', 480), out('LODOS', 20, true)], '2026-09-02');
  const l = ledgerDe({ registrosDestaraje: [c], registrosControlProduccion: [lav] });
  igual([celda(l, 'P.E. MOLIDO', 'RECEPCIÓN'), celda(l, 'P.E. MOLIDO', 'LAVADO')], [0, 480], 'Lavado: RECEPCIÓN 0, LAVADO 480');
  igual(avisosDe({ registrosDestaraje: [c] }, lav), [], 'Lavado sin aviso');
  const pel = proceso('PELETIZADO', [inp('P.E. MOLIDO', 500)], [out('PELLET CAJAS', 480), out('PIEDRAS', 20, true)], '2026-09-02');
  const l2 = ledgerDe({ registrosDestaraje: [c], registrosControlProduccion: [pel] });
  igual(celda(l2, 'P.E. MOLIDO', 'RECEPCIÓN'), 0, 'Peletizado directo consume RECEPCIÓN');
  igual(avisosDe({ registrosDestaraje: [c] }, pel), [], 'Peletizado directo sin aviso');
});

// ── (d) Seleccionar un molido ────────────────────────────────────────────

caso('(d) Seleccionar un molido avisa "no requiere selección"; un crudo no', () => {
  const datos = { registrosDestaraje: [compra('P.E. MOLIDO', 500, '2026-09-01'), compra('LECHERO', 500, '2026-09-01')] };
  const molido = proceso('SELECCION', [inp('P.E. MOLIDO', 100)], [out('P.E. MOLIDO', 100)], '2026-09-02');
  const avisos = avisosDe(datos, molido);
  afirmar(avisos.length === 1 && /no requiere selecci/.test(avisos[0]), `molido: ${JSON.stringify(avisos)}`);
  const crudo = proceso('SELECCION', [inp('LECHERO', 100)], [out('LECHERO', 100)], '2026-09-02');
  igual(avisosDe(datos, crudo), [], 'LECHERO no avisa');
});

// ── (e) Rechazos de producción ───────────────────────────────────────────

[
  ['CAJA CO30', 'RECHAZO CAJAS P.E.', 'P.E. MOLIDO', 'INYECCIÓN', 'PRODUCCION_CAJAS'],
  ['CAJA AGRO20', 'RECHAZO CAJAS P.P.', 'P.P. MOLIDO', 'INYECCIÓN', 'PRODUCCION_CAJAS'],
  ['TAMBO', 'RECHAZO TAMBOS', 'P.E. MOLIDO', 'SOPLADO', 'PRODUCCION_TAMBOS']
].forEach(([producto, rechazo, molido, etapaRechazo, tipo]) => {
  caso(`(e) Rechazo ${rechazo} (${tipo}) → Molienda → Peletizado sin Lavado y sin aviso`, () => {
    const base = { inventarioInicial: [inicial('PELLET CAJAS', 'PELETIZADO', 500), inicial('PELLET TAMBO', 'PELETIZADO', 500)] };
    const pellet = tipo === 'PRODUCCION_TAMBOS' ? 'PELLET TAMBO' : (producto === 'CAJA AGRO20' ? 'PELLET AGRO20' : 'PELLET CAJAS');
    base.inventarioInicial.push(inicial('PELLET AGRO20', 'PELETIZADO', 500));
    const prod = proceso(tipo, [inp(pellet, 470)], [out(producto, 400), out(rechazo, 50)], '2026-09-02');
    const mol = proceso('MOLIENDA', [inp(rechazo, 50)], [out(molido, 49), out('LODOS', 1, true)], '2026-09-03');
    const pel = proceso('PELETIZADO', [inp(molido, 49)], [out('PELLET CAJAS', 48), out('PIEDRAS', 1, true)], '2026-09-04');
    const l1 = ledgerDe({ ...base, registrosControlProduccion: [prod] });
    igual(celda(l1, rechazo, etapaRechazo), 50, `${rechazo} queda en ${etapaRechazo}`);
    const l2 = ledgerDe({ ...base, registrosControlProduccion: [prod, mol] });
    igual([celda(l2, rechazo, etapaRechazo), celda(l2, molido, 'MOLIENDA')], [0, 49], 'Molienda consume el rechazo y produce el molido');
    const l3 = ledgerDe({ ...base, registrosControlProduccion: [prod, mol, pel] });
    igual([celda(l3, molido, 'MOLIENDA'), celda(l3, molido, 'LAVADO')], [0, 0], 'Peletizado consume de MOLIENDA, sin Lavado');
    igual(avisosCadena(base, [prod, mol, pel]), [], 'cadena sin avisos');
  });
});

// ── (f) Empacado solo desde SELECCIÓN ────────────────────────────────────

caso('(f) Empacado de un molido que está en MOLIENDA avisa y el faltante queda negativo en SELECCIÓN', () => {
  const datos = { inventarioInicial: [inicial('P.E. MOLIDO', 'MOLIENDA', 49)] };
  const emp = proceso('EMPACADO', [inp('P.E. MOLIDO', 49)], [out('P.E. MOLIDO', 49)], '2026-09-02');
  const avisos = avisosDe(datos, emp);
  afirmar(avisos.length === 1 && /sin saldo en las etapas de origen/.test(avisos[0]), `avisos: ${JSON.stringify(avisos)}`);
  const l = ledgerDe({ ...datos, registrosControlProduccion: [emp] });
  igual([celda(l, 'P.E. MOLIDO', 'SELECCIÓN'), celda(l, 'P.E. MOLIDO', 'MOLIENDA')], [-49, 49], 'SELECCIÓN negativa, MOLIENDA intacta');
});

// ── (g) Reparto ──────────────────────────────────────────────────────────

caso('(g) Peletizado de 120 kg reparte MOLIENDA (50) y RECEPCIÓN (100)', () => {
  const datos = { inventarioInicial: [inicial('P.E. MOLIDO', 'MOLIENDA', 50), inicial('P.E. MOLIDO', 'RECEPCIÓN', 100)] };
  const pel = proceso('PELETIZADO', [inp('P.E. MOLIDO', 120)], [out('PELLET CAJAS', 120)], '2026-09-02');
  const l = ledgerDe({ ...datos, registrosControlProduccion: [pel] });
  igual([celda(l, 'P.E. MOLIDO', 'MOLIENDA'), celda(l, 'P.E. MOLIDO', 'RECEPCIÓN')], [0, 30], 'MOLIENDA 0 y RECEPCIÓN 30');
  igual(avisosDe(datos, pel), [], 'sin aviso');
});

// ── (h) Faltante ─────────────────────────────────────────────────────────

caso('(h) Molienda de 60 kg de rechazo con 50 en INYECCIÓN: avisa y 10 kg quedan negativos en INYECCIÓN', () => {
  const datos = { inventarioInicial: [inicial('RECHAZO CAJAS P.E.', 'INYECCIÓN', 50)] };
  const mol = proceso('MOLIENDA', [inp('RECHAZO CAJAS P.E.', 60)], [out('P.E. MOLIDO', 58), out('LODOS', 2, true)], '2026-09-02');
  const avisos = avisosDe(datos, mol);
  afirmar(avisos.length === 1 && /faltan 10 kg/.test(avisos[0]), `avisos: ${JSON.stringify(avisos)}`);
  const l = ledgerDe({ ...datos, registrosControlProduccion: [mol] });
  igual([celda(l, 'RECHAZO CAJAS P.E.', 'INYECCIÓN'), celda(l, 'RECHAZO CAJAS P.E.', 'SELECCIÓN')], [-10, 0], 'INYECCIÓN −10');
  const detalle = INV.procesarEventos(INV.construirEventos({ ...VACIO, ...datos, registrosControlProduccion: [mol] }), () => {});
  afirmar(detalle, 'procesarEventos sigue devolviendo el ledger');
});

// ── (i) MATERIAL VIRGEN vs crudo hacia producción ────────────────────────

caso('(i) MATERIAL VIRGEN desde RECEPCIÓN a PRODUCCION_CAJAS no avisa; un crudo sí', () => {
  const datos = { registrosDestaraje: [compra('MATERIAL VIRGEN', 300, '2026-09-01'), compra('LECHERO', 300, '2026-09-01')] };
  const virgen = proceso('PRODUCCION_CAJAS', [inp('MATERIAL VIRGEN', 300)], [out('CAJA CO30', 280), out('RECHAZO CAJAS P.E.', 20)], '2026-09-02');
  igual(avisosDe(datos, virgen), [], 'MATERIAL VIRGEN sin aviso');
  igual(celda(ledgerDe({ ...datos, registrosControlProduccion: [virgen] }), 'MATERIAL VIRGEN', 'RECEPCIÓN'), 0, 'consume RECEPCIÓN');
  const crudo = proceso('PRODUCCION_CAJAS', [inp('LECHERO', 300)], [out('CAJA CO30', 300)], '2026-09-02');
  afirmar(avisosDe(datos, crudo).length === 1, 'LECHERO desde RECEPCIÓN sí avisa');
});

// ── (j) Cadena DURO ──────────────────────────────────────────────────────

const cadenaDuro = () => {
  const datos = { registrosDestaraje: [compra('DURO', 1000, '2026-09-01')] };
  const procesos = [
    proceso('SELECCION', [inp('DURO', 1000)], [out('P.P.', 600), out('P.E.', 350), out('BASURA', 50, true)], '2026-09-02'),
    proceso('MOLIENDA', [inp('P.P.', 600)], [out('P.P. MOLIDO', 590), out('LODOS', 10, true)], '2026-09-03'),
    proceso('MOLIENDA', [inp('P.E.', 350)], [out('P.E. MOLIDO', 345), out('LODOS', 5, true)], '2026-09-03'),
    proceso('LAVADO', [inp('P.P. MOLIDO', 590)], [out('P.P. MOLIDO', 575), out('LODOS', 15, true)], '2026-09-04'),
    proceso('LAVADO', [inp('P.E. MOLIDO', 345)], [out('P.E. MOLIDO', 335), out('LODOS', 10, true)], '2026-09-04'),
    proceso('PELETIZADO', [inp('P.P. MOLIDO', 575), inp('P.E. MOLIDO', 335)], [out('PELLET CAJAS', 890), out('PIEDRAS', 20, true)], '2026-09-05')
  ];
  return { datos, procesos };
};

caso('(j) Cadena DURO completa: todo termina en PELLET CAJAS, sin avisos', () => {
  const { datos, procesos } = cadenaDuro();
  const l = ledgerDe({ ...datos, registrosControlProduccion: procesos });
  igual(['RECEPCIÓN', 'SELECCIÓN', 'MOLIENDA', 'LAVADO'].map((e) => ['DURO', 'P.P.', 'P.E.', 'P.P. MOLIDO', 'P.E. MOLIDO'].map((m) => celda(l, m, e)).reduce((a, b) => a + b, 0)), [0, 0, 0, 0], 'RECEPCIÓN/SELECCIÓN/MOLIENDA/LAVADO en 0');
  igual(celda(l, 'PELLET CAJAS', 'PELETIZADO'), 890, 'PELETIZADO PELLET CAJAS 890');
  igual(celdasNegativas(l), [], 'sin celdas negativas');
  igual(avisosCadena(datos, procesos), [], 'ningún aviso');
});

caso('(j) Variantes: Molienda con DURO y Lavado de P.P. sin molienda avisan', () => {
  const { datos, procesos } = cadenaDuro();
  const hastaSeleccion = { ...datos, registrosControlProduccion: [procesos[0]] };
  const molDuro = proceso('MOLIENDA', [inp('DURO', 100)], [out('P.P. MOLIDO', 100)], '2026-09-03');
  afirmar(avisosDe(hastaSeleccion, molDuro).length === 1, 'Molienda con input DURO avisa (DURO se descompuso en la Selección)');
  const lavPP = proceso('LAVADO', [inp('P.P.', 100)], [out('P.P. MOLIDO', 100)], '2026-09-03');
  afirmar(avisosDe(hastaSeleccion, lavPP).length === 1, 'Lavado con input P.P. sin molienda previa avisa (está en SELECCIÓN)');
});

// ── (k) El saldo total no cambia ─────────────────────────────────────────

caso('(k) El saldo total de cada material es el aritmético (compras + salidas − entradas − ventas)', () => {
  const { datos, procesos } = cadenaDuro();
  const escenarios = [
    { ...datos, registrosControlProduccion: procesos, ventas: [venta('PELLET CAJAS', 300, '2026-09-06')] },
    // Con faltantes: el total se descuenta igual aunque la celda quede negativa.
    { inventarioInicial: [inicial('P.E. MOLIDO', 'MOLIENDA', 49)], registrosControlProduccion: [proceso('EMPACADO', [inp('P.E. MOLIDO', 49)], [out('P.E. MOLIDO', 49)], '2026-09-02')] },
    { inventarioInicial: [inicial('RECHAZO CAJAS P.E.', 'INYECCIÓN', 50)], registrosControlProduccion: [proceso('MOLIENDA', [inp('RECHAZO CAJAS P.E.', 60)], [out('P.E. MOLIDO', 58), out('LODOS', 2, true)], '2026-09-02')] },
    { inventarioInicial: [inicial('P.E. MOLIDO', 'MOLIENDA', 50), inicial('P.E. MOLIDO', 'RECEPCIÓN', 100)], registrosControlProduccion: [proceso('PELETIZADO', [inp('P.E. MOLIDO', 120)], [out('PELLET CAJAS', 120)], '2026-09-02')] }
  ];
  escenarios.forEach((escenario, i) => {
    const datosEscenario = { ...VACIO, ...escenario };
    const l = ledgerDe(datosEscenario);
    const esperado = {};
    const sumar = (m, kg) => { const n = w.normalizarMaterial(m); esperado[n] = (esperado[n] || 0) + kg; };
    datosEscenario.inventarioInicial.forEach((r) => sumar(r.material, r.kg));
    datosEscenario.registrosDestaraje.forEach((r) => sumar(r.material, r.kg));
    datosEscenario.registrosControlProduccion.forEach((r) => {
      r.inputs.forEach((x) => sumar(x.material, -x.kg));
      r.outputs.filter((x) => !x.esMerma).forEach((x) => sumar(x.material, x.kg));
    });
    datosEscenario.ventas.forEach((v) => v.lineas.forEach((x) => sumar(x.material, -x.cantidad)));
    Object.keys(esperado).forEach((material) => {
      igual(total(l, material), Math.round(esperado[material] * 100) / 100, `escenario ${i + 1}, ${material}`);
    });
  });
});

caso('Los registros guardados con el nombre anterior de un material siguen el mismo camino (normalización)', () => {
  const c = compra('p.e. molido', 100, '2026-09-01');
  const lav = proceso('LAVADO', [inp('p.e. molido', 100)], [out('P.E. MOLIDO', 100)], '2026-09-02');
  const l = ledgerDe({ registrosDestaraje: [c], registrosControlProduccion: [lav] });
  igual([celda(l, 'P.E. MOLIDO', 'RECEPCIÓN'), celda(l, 'P.E. MOLIDO', 'LAVADO')], [0, 100], 'normaliza mayúsculas/minúsculas');
});

// ── Ejecución ────────────────────────────────────────────────────────────

let pasaron = 0;
casos.forEach(({ nombre, fn }) => {
  try {
    fn();
    pasaron++;
    console.log(`PASS  ${nombre}`);
  } catch (error) {
    console.log(`FAIL  ${nombre}\n        ${error.message}`);
  }
});
console.log(`\n${pasaron}/${casos.length} casos correctos`);
process.exit(pasaron === casos.length ? 0 : 1);
