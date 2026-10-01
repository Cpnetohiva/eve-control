// K6 — Verificación de la META DIARIA DE PIEZAS POR PRODUCTO.
//
// Carga en un contexto vm, con un `window` simulado, js/config.js, js/utils.js, js/rendimientos.js,
// js/control-produccion.js y js/reportes.js, y ejecuta casos sintéticos sobre
// window.EVE_CONTROL_PRODUCCION.calcularCumplimientoDiarioPZ y los reportes que lo consumen.
// Sin dependencias nuevas.
//
// Uso: node scripts/verificar-meta-piezas.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');

function crearContexto(archivos) {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error,
    setTimeout, clearTimeout,
    document: {},
    // config.js inicializa Firebase al cargarse: se simula lo mínimo.
    firebase: {
      initializeApp() {},
      firestore() {
        return { enablePersistence() { return Promise.resolve(); } };
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {
    registrosDestaraje: [], registrosControlProduccion: [], composiciones: [], precios: [],
    ajustesPrecioProveedor: [], comisiones: [], ventas: [], inventarioInicial: [], metaPiezasDia: {}
  };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of archivos) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  return sandbox.window;
}

const w = crearContexto(['js/config.js', 'js/utils.js', 'js/rendimientos.js', 'js/control-produccion.js', 'js/reportes.js']);
const CP = w.EVE_CONTROL_PRODUCCION;

// ── Arnés mínimo ─────────────────────────────────────────────────────────

let fallos = 0;
function igual(real, esperado, mensaje) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    fallos += 1;
    console.log(`  ✗ ${mensaje}\n      esperado: ${JSON.stringify(esperado)}\n      real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`  ✓ ${mensaje}`);
  }
}
function caso(titulo, fn) {
  console.log(titulo);
  try {
    fn();
  } catch (error) {
    fallos += 1;
    console.log(`  ✗ lanzó una excepción: ${error.message}`);
  }
}

// ── Datos sintéticos ─────────────────────────────────────────────────────

let consecutivo = 0;
function registro(tipoProceso, fecha, outputs, extra) {
  consecutivo += 1;
  return {
    id: `r${consecutivo}`, ticket: `P-${String(consecutivo).padStart(3, '0')}`, tipoProceso,
    operador: 'JUAN', turno: 'Matutino', fecha,
    inputs: [{ material: 'P.E.', kg: 100, ticketOrigen: '' }],
    outputs, totalInput: 100, totalOutput: 0, eficiencia: null, porcentajeMerma: 0,
    ...(extra || {})
  };
}
const pz = (material, kg) => ({ material, kg, esMerma: false });

// ── Casos ────────────────────────────────────────────────────────────────

caso('1. Dos registros del mismo día y producto suman (aunque sean de turnos distintos)', () => {
  const regs = [
    registro('PRODUCCION_TAMBOS', '2026-09-14', [pz('TAMBO', 40)]),
    registro('PRODUCCION_TAMBOS', '2026-09-14', [pz('TAMBO', 35)], { turno: 'Vespertino' })
  ];
  igual(CP.calcularCumplimientoDiarioPZ(regs, { TAMBO: 150 }), [
    { fecha: '2026-09-14', producto: 'TAMBO', piezas: 75, meta: 150, cumplimiento: 50 }
  ], 'una sola fila con 75 piezas y 50%');
});

caso('2. Días distintos no se mezclan; productos distintos tampoco', () => {
  const regs = [
    registro('PRODUCCION_TAMBOS', '2026-09-14', [pz('TAMBO', 40)]),
    registro('PRODUCCION_TAMBOS', '2026-09-15', [pz('TAMBO', 60)]),
    registro('PRODUCCION_CAJAS', '2026-09-14', [pz('CAJA CO30', 100)])
  ];
  const r = CP.calcularCumplimientoDiarioPZ(regs, { TAMBO: 100, 'CAJA CO30': 200 });
  igual(r.map((x) => [x.fecha, x.producto, x.piezas, x.cumplimiento]), [
    ['2026-09-14', 'CAJA CO30', 100, 50],
    ['2026-09-14', 'TAMBO', 40, 40],
    ['2026-09-15', 'TAMBO', 60, 60]
  ], 'tres filas independientes, ordenadas por fecha y producto');
});

caso('3. Sin meta: cumplimiento null (nunca 0) y meta null', () => {
  const regs = [registro('PRODUCCION_TAMBOS', '2026-09-14', [pz('TAMBO', 40)])];
  const esperado = [{ fecha: '2026-09-14', producto: 'TAMBO', piezas: 40, meta: null, cumplimiento: null }];
  igual(CP.calcularCumplimientoDiarioPZ(regs, {}), esperado, 'metas vacías ({})');
  igual(CP.calcularCumplimientoDiarioPZ(regs, undefined), esperado, 'metas indefinidas');
  igual(CP.calcularCumplimientoDiarioPZ(regs, { TAMBO: null }), esperado, 'meta null');
  igual(CP.calcularCumplimientoDiarioPZ(regs, { TAMBO: 0 }), esperado, 'meta 0 se trata como sin meta');
  igual(CP.formatearEficiencia(null), 'Sin meta configurada', 'formatearEficiencia(null)');
});

caso('4. Output de pieza + output de rechazo en kg: solo suman las piezas', () => {
  const regs = [registro('PRODUCCION_CAJAS', '2026-09-14', [
    pz('CAJA CO30', 80),
    pz('RECHAZO CAJAS P.E.', 12.5)
  ])];
  igual(CP.calcularCumplimientoDiarioPZ(regs, { 'CAJA CO30': 100 }), [
    { fecha: '2026-09-14', producto: 'CAJA CO30', piezas: 80, meta: 100, cumplimiento: 80 }
  ], 'el rechazo (kg, no es pieza ni merma) no suma ni crea fila');
});

caso('5. La merma de un output de pieza no cuenta', () => {
  const regs = [registro('PRODUCCION_TAMBOS', '2026-09-14', [pz('TAMBO', 50), { material: 'TAMBO', kg: 5, esMerma: true }])];
  igual(CP.calcularCumplimientoDiarioPZ(regs, { TAMBO: 100 })[0].piezas, 50, '50 piezas, sin la merma');
});

caso('6. Registros antiguos (sin `fecha`, con fechaFin con hora) se agrupan por día', () => {
  const regs = [
    registro('PRODUCCION_TAMBOS', undefined, [pz('TAMBO', 30)], { fecha: undefined, fechaFin: '2026-09-10T14:00' }),
    registro('PRODUCCION_TAMBOS', '2026-09-10', [pz('TAMBO', 20)])
  ];
  igual(CP.calcularCumplimientoDiarioPZ(regs, { TAMBO: 100 }).map((x) => [x.fecha, x.piezas]), [['2026-09-10', 50]],
    'fechaFin se recorta al día y se suma con el registro nuevo');
});

caso('7. Procesos de kg no generan filas de cumplimiento', () => {
  const regs = [registro('MOLIENDA', '2026-09-14', [{ material: 'P.E. MOLIDO', kg: 90, esMerma: false }])];
  igual(CP.calcularCumplimientoDiarioPZ(regs, { TAMBO: 100 }), [], 'sin piezas no hay filas');
});

caso('8. Por Operador: las piezas no llevan semáforo ni eficiencia', () => {
  const regs = [
    registro('PRODUCCION_TAMBOS', '2026-09-14', [pz('TAMBO', 40), pz('RECHAZO TAMBOS', 3)], { totalOutput: 3 }),
    registro('MOLIENDA', '2026-09-14', [{ material: 'P.E. MOLIDO', kg: 90, esMerma: false }], { totalOutput: 90 })
  ];
  const [operador] = w.calcularRendimientoOperador(regs, 90);
  const filaPZ = operador.filas.find((f) => f.tipoProceso === 'PRODUCCION_TAMBOS');
  const filaKg = operador.filas.find((f) => f.tipoProceso === 'MOLIENDA');
  igual([filaPZ.piezas, filaPZ.eficiencia, filaPZ.semaforo], [40, null, ''], 'fila de pieza: 40 pz, eficiencia null, sin semáforo');
  igual(filaKg.semaforo, '🟢', 'la fila de kg conserva su semáforo (90/100 = 90% con meta 90)');
  igual(operador.total.eficiencia, filaKg.eficiencia, 'el total promedia solo las filas de kg');
  const soloPZ = w.calcularRendimientoOperador([regs[0]], 90)[0];
  igual([soloPZ.total.eficiencia, soloPZ.total.semaforo], [null, ''], 'operador solo de piezas: total sin eficiencia ni semáforo');
});

caso('9. Por Proceso (pieza): tabla producto x día y resumen del periodo', () => {
  w.EVE.metaPiezasDia = { TAMBO: 100 };
  w.EVE.registrosControlProduccion = [
    registro('PRODUCCION_TAMBOS', '2026-09-14', [pz('TAMBO', 80)]),
    registro('PRODUCCION_TAMBOS', '2026-09-15', [pz('TAMBO', 100)]),
    registro('PRODUCCION_TAMBOS', '2026-09-30', [pz('TAMBO', 999)]) // fuera del periodo
  ];
  const periodo = { desde: '2026-09-14', hasta: '2026-09-15', etiquetaPeriodo: 'Prueba' };
  const resultado = w.calcularRendimientoPorProceso('PRODUCCION_TAMBOS', periodo);
  const seccion = resultado.secciones[0];
  igual(seccion.cumplimientoDiario.map((d) => [d.fecha, d.piezas, d.cumplimiento]),
    [['2026-09-14', 80, 80], ['2026-09-15', 100, 100]], 'dos días dentro del periodo');
  igual(seccion.resumenCumplimiento, [{ producto: 'TAMBO', dias: 2, piezas: 180, promedio: 90 }],
    'promedio de los días con producción = (80 + 100) / 2');
  const txt = w.generarTXTRendimientoPorProceso(resultado, periodo);
  igual(txt.includes('CUMPLIMIENTO DIARIO DE PIEZAS:') && txt.includes('RESUMEN DEL PERIODO:'), true, 'el TXT incluye ambas secciones');
  const csv = w.construirFilasCSVRendimientoPorProceso(resultado);
  igual(csv.filter((f) => f.fecha === 'PROMEDIO PERIODO').map((f) => f.cumplimientoPct), [90], 'el CSV incluye la fila de promedio');
  igual(new Set(csv.map((f) => Object.keys(f).join())).size, 1, 'todas las filas del CSV tienen las mismas columnas');
  const telegram = w.construirMensajeRendimientoTelegram(periodo, null, null, 90, resultado);
  igual(telegram.includes('promedio 90.0%'), true, 'Telegram incluye el promedio del periodo');
});

caso('10. Por Proceso (pieza) sin meta configurada', () => {
  w.EVE.metaPiezasDia = {};
  w.EVE.registrosControlProduccion = [registro('PRODUCCION_TAMBOS', '2026-09-14', [pz('TAMBO', 80)])];
  const periodo = { desde: '2026-09-14', hasta: '2026-09-14', etiquetaPeriodo: 'Prueba' };
  const resultado = w.calcularRendimientoPorProceso('PRODUCCION_TAMBOS', periodo);
  igual(resultado.secciones[0].resumenCumplimiento, [{ producto: 'TAMBO', dias: 1, piezas: 80, promedio: null }], 'promedio null');
  igual(w.generarTXTRendimientoPorProceso(resultado, periodo).includes('Sin meta configurada'), true, 'el TXT dice "Sin meta configurada"');
});

caso('11. Por Proceso (kg) no agrega tabla de cumplimiento', () => {
  w.EVE.registrosControlProduccion = [registro('MOLIENDA', '2026-09-14', [{ material: 'P.E. MOLIDO', kg: 90, esMerma: false }], { totalOutput: 90 })];
  const resultado = w.calcularRendimientoPorProceso('MOLIENDA', { desde: '2026-09-14', hasta: '2026-09-14', etiquetaPeriodo: 'Prueba' });
  igual([resultado.secciones[0].cumplimientoDiario, resultado.secciones[0].resumenCumplimiento], [[], []], 'sin cumplimiento para procesos de kg');
});

console.log(fallos === 0 ? '\nTodos los casos pasaron.' : `\n${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
