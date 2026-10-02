// K21c — Verificación de la merma por diferencia y sus avisos (EVE_CP_REGLAS.calcularMermaPorDiferencia y
// evaluarAvisoMerma).
//
// Carga en un contexto vm js/config.js, js/utils.js, js/inventario.js y js/control-produccion-reglas.js. Los umbrales
// (TOLERANCIA_MERMA_PUNTOS, TOLERANCIA_EMPACADO_PCT, UMBRAL_MERMA_PROCESO) viven solo en js/config.js.
//
// Uso: node scripts/verificar-merma-diferencia.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/inventario.js', 'js/control-produccion-reglas.js'];

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
const R = w.EVE_CP_REGLAS;
const inp = (kg) => ({ material: 'X', kg });
const salida = (kg) => ({ material: 'Y', kg, esMerma: false });
const merma = (entrada, salidas, proceso) => R.calcularMermaPorDiferencia([inp(entrada)], salidas.map(salida), proceso);
const historico = (promedio, registros) => ({ promedio, registros });
const composicionConBasura = (pct) => ({
  componentes: [{ subproducto: 'PET CRISTAL', porcentaje: 100 - pct, esMerma: false }, { subproducto: 'BASURA', porcentaje: pct, esMerma: true }]
});

// ── Cálculo ──────────────────────────────────────────────────────────────

caso('1000 kg entran y salen 900: merma 100 kg (10 %) del tipo del proceso', () => {
  const r = merma(1000, [900], 'SELECCION');
  igual([r.kgMerma, r.porcentaje, r.tipo, r.estado], [100, 10, 'BASURA', 'merma'], 'Selección');
  igual(merma(1000, [900], 'MOLIENDA').tipo, 'LODOS', 'Molienda: LODOS');
  igual(merma(1000, [900], 'LAVADO').tipo, 'LODOS', 'Lavado: LODOS');
  igual(merma(1000, [900], 'PELETIZADO').tipo, 'PIEDRAS', 'Peletizado: PIEDRAS');
  igual([r.kgEntrada, r.kgSalida, r.diferencia], [1000, 900, 100], 'entrada, salida y diferencia');
});

caso('Varias entradas y salidas se suman', () => {
  const r = R.calcularMermaPorDiferencia([inp(300), inp(200)], [salida(250), salida(210)], 'PELETIZADO');
  igual([r.kgEntrada, r.kgSalida, r.kgMerma, r.porcentaje], [500, 460, 40, 8], 'mezcla de molidos');
});

caso('Salida igual a la entrada (o dentro de ±0.01): sin merma', () => {
  igual(merma(1000, [1000], 'LAVADO').estado, 'sin_diferencia', 'igual');
  const casi = merma(1000, [999.995], 'LAVADO');
  igual([casi.estado, casi.kgMerma], ['sin_diferencia', 0], 'dentro de la tolerancia');
  igual(merma(1000, [1000.01], 'LAVADO').estado, 'sin_diferencia', '+0.01');
  igual(merma(1000, [999.99], 'LAVADO').kgMerma, 0, '-0.01 no genera fila de merma');
});

caso('Salida mayor que la entrada: salidas_exceden, sin merma negativa', () => {
  const r = merma(1000, [1050], 'SELECCION');
  igual([r.estado, r.kgMerma, r.porcentaje, r.diferencia], ['salidas_exceden', 0, 0, -50], 'resultado');
});

caso('Empacado y procesos de pieza: sin_merma', () => {
  for (const proceso of ['EMPACADO', 'PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES']) {
    const r = merma(1000, [900], proceso);
    igual([r.estado, r.kgMerma, r.tipo], ['sin_merma', 0, null], proceso);
  }
  igual(merma(1000, [900], 'NO_EXISTE').estado, 'sin_merma', 'proceso desconocido');
});

caso('REGLAS_PROCESO.sinMerma manda sobre los tipos de merma: ampliar un tipo a EMPACADO o a una pieza no lo hace calcular merma', () => {
  const w2 = crearContexto();
  w2.TIPOS_MERMA.find((t) => t.nombre === 'LODOS').procesos.push('EMPACADO', 'PRODUCCION_CAJAS');
  const R2 = w2.EVE_CP_REGLAS;
  igual(w2.tiposMermaParaProceso('EMPACADO'), ['LODOS'], 'el catálogo de mermas sí lo lista');
  igual(R2.tipoMermaPorDefecto('EMPACADO'), null, 'EMPACADO sigue sin merma');
  igual(R2.calcularMermaPorDiferencia([inp(1000)], [salida(900)], 'PRODUCCION_CAJAS').estado, 'sin_merma', 'pieza sin merma');
});

caso('Entrada en cero: sin_entrada y sin división entre cero', () => {
  const r = R.calcularMermaPorDiferencia([], [], 'SELECCION');
  igual([r.estado, r.kgMerma, r.porcentaje], ['sin_entrada', 0, 0], 'sin entradas');
});

caso('Los kg se tratan como números y se redondean a 2 decimales', () => {
  const r = R.calcularMermaPorDiferencia([{ kg: '100.005' }, { kg: 50 }], [{ kg: '120.5' }], 'MOLIENDA');
  igual([r.kgEntrada, r.kgSalida], [150.01, 120.5], 'redondeo');
  afirmar(Math.abs(r.kgMerma - 29.51) < 1e-9, `kgMerma ${r.kgMerma}`);
});

// ── Avisos ───────────────────────────────────────────────────────────────

caso('Selección: avisa si la merma real supera la esperada de la composición por más de 5 puntos', () => {
  const composicion = composicionConBasura(5);
  const nivel = (porcentajeReal) => R.evaluarAvisoMerma(merma(1000, [1000 - porcentajeReal * 10], 'SELECCION'), { composicion }).nivel;
  igual(nivel(12), 'aviso', '12 % con 5 % esperado');
  igual(nivel(10), 'ok', 'exactamente en el límite (5 + 5)');
  igual(nivel(9.9), 'ok', 'bajo el límite');
  igual(nivel(10.1), 'aviso', 'sobre el límite');
  const aviso = R.evaluarAvisoMerma(merma(1000, [880], 'SELECCION'), { composicion });
  afirmar(/12/.test(aviso.mensaje) && /5/.test(aviso.mensaje), `el mensaje cita ambos porcentajes: ${aviso.mensaje}`);
});

caso('Selección con composición sin merma esperada: avisa por encima de la tolerancia', () => {
  const composicion = { componentes: [{ subproducto: 'PET CRISTAL', porcentaje: 100, esMerma: false }] };
  igual(R.evaluarAvisoMerma(merma(1000, [940], 'SELECCION'), { composicion }).nivel, 'aviso', '6 % > 0 + 5');
  igual(R.evaluarAvisoMerma(merma(1000, [960], 'SELECCION'), { composicion }).nivel, 'ok', '4 %');
});

caso('Empacado: avisa si entrada y salida difieren más de 1 %', () => {
  const nivel = (entrada, salidaKg) => R.evaluarAvisoMerma(merma(entrada, [salidaKg], 'EMPACADO'), {}).nivel;
  igual(nivel(1000, 990), 'ok', '1 % exacto');
  igual(nivel(1000, 989), 'aviso', '1.1 %');
  igual(nivel(1000, 1011), 'aviso', 'salida mayor que la entrada, más de 1 %');
  igual(nivel(1000, 1000), 'ok', 'igual');
  igual(R.evaluarAvisoMerma(R.calcularMermaPorDiferencia([], [], 'EMPACADO'), {}).nivel, 'ok', 'sin entrada');
});

caso('Salidas mayores que la entrada: aviso fuerte con confirmación y motivo', () => {
  const aviso = R.evaluarAvisoMerma(merma(1000, [1050], 'SELECCION'), {});
  igual(aviso.nivel, 'fuerte', 'nivel');
  afirmar(/confirmaci/.test(aviso.mensaje) && /motivo/.test(aviso.mensaje), `se permite con confirmación y motivo: ${aviso.mensaje}`);
});

caso('Proceso de pieza y merma ausente: sin aviso', () => {
  igual(R.evaluarAvisoMerma(merma(1000, [900], 'PRODUCCION_CAJAS'), {}).nivel, 'ok', 'pieza');
  igual(R.evaluarAvisoMerma(merma(1000, [1000], 'LAVADO'), { historico: historico(1, 20) }).nivel, 'ok', 'sin diferencia');
  igual(R.evaluarAvisoMerma(merma(1000, [900], 'SELECCION'), {}).nivel, 'ok', 'Selección sin composición ni historial: sin umbral');
  igual(R.evaluarAvisoMerma(merma(1000, [900], 'SELECCION')).nivel, 'ok', 'sin contexto');
});

caso('Otros procesos sin umbral fijo: sin aviso con menos de 10 registros aunque la merma sea alta', () => {
  igual(R.evaluarAvisoMerma(merma(1000, [900], 'LAVADO'), {}).nivel, 'ok', 'sin historial: sin umbral');
  for (const proceso of ['MOLIENDA', 'LAVADO', 'PELETIZADO']) {
    igual(R.evaluarAvisoMerma(merma(1000, [500], proceso), { historico: historico(8, 9) }).nivel, 'ok', `${proceso}: 50 % con 9 registros`);
  }
  igual(R.evaluarAvisoMerma(merma(1000, [500], 'LAVADO'), { historico: historico(8, 0) }).nivel, 'ok', 'sin registros');
  igual(R.evaluarAvisoMerma(merma(1000, [500], 'LAVADO'), { historico: 8 }).nivel, 'ok', 'un promedio suelto no trae el conteo: no cuenta');
  igual(R.evaluarAvisoMerma(merma(1000, [500], 'LAVADO'), { historico: { promedio: NaN, registros: 50 } }).nivel, 'ok', 'promedio inválido');
});

caso('Con 10 registros o más: avisa solo si la merma supera el promedio histórico más 5 puntos', () => {
  const nivel = (porcentaje, registros) => R.evaluarAvisoMerma(merma(1000, [1000 - porcentaje * 10], 'LAVADO'), { historico: historico(8, registros) }).nivel;
  igual(nivel(12, 10), 'ok', '12 % con promedio 8 % y 10 registros (dentro de 8 + 5)');
  igual(nivel(13, 10), 'ok', 'exactamente en el límite (8 + 5)');
  igual(nivel(13.1, 10), 'aviso', 'por encima del límite');
  igual(nivel(30, 10), 'aviso', 'muy por encima');
  igual(nivel(13.1, 9), 'ok', 'con 9 registros no avisa');
  igual(nivel(13.1, 250), 'aviso', 'con muchos registros avisa');
  const aviso = R.evaluarAvisoMerma(merma(1000, [860], 'MOLIENDA'), { historico: historico(8, 10) });
  afirmar(/14/.test(aviso.mensaje) && /8/.test(aviso.mensaje) && /10 registros/.test(aviso.mensaje) && /5 puntos/.test(aviso.mensaje), `el mensaje cita merma, promedio, registros y tolerancia: ${aviso.mensaje}`);
});

caso('El umbral fijo por proceso gana sobre el histórico y no pide registros mínimos', () => {
  const w2 = crearContexto();
  w2.UMBRAL_MERMA_PROCESO.MOLIENDA = 4;
  const R2 = w2.EVE_CP_REGLAS;
  const m = R2.calcularMermaPorDiferencia([inp(1000)], [salida(940)], 'MOLIENDA');
  igual(R2.evaluarAvisoMerma(m, { historico: historico(20, 50) }).nivel, 'aviso', 'el fijo (6 % > 4 %) gana sobre el histórico (20 + 5)');
  igual(R2.evaluarAvisoMerma(m, {}).nivel, 'aviso', 'sin historial también avisa');
});

caso('Selección con composición no usa el historial', () => {
  const composicion = composicionConBasura(5);
  igual(R.evaluarAvisoMerma(merma(1000, [880], 'SELECCION'), { composicion, historico: historico(50, 100) }).nivel, 'aviso', '12 % > 5 + 5 aunque el historial sea alto');
});

caso('Los umbrales son configurables en un solo lugar (config.js)', () => {
  igual([w.TOLERANCIA_MERMA_PUNTOS, w.TOLERANCIA_EMPACADO_PCT, w.UMBRAL_MERMA_PROCESO, w.MIN_REGISTROS_MERMA_HISTORICA, w.TOLERANCIA_MERMA_HISTORICA_PUNTOS], [5, 1, {}, 10, 5], 'valores por omisión');
  const w2 = crearContexto();
  w2.TOLERANCIA_EMPACADO_PCT = 5;
  w2.TOLERANCIA_MERMA_PUNTOS = 10;
  w2.MIN_REGISTROS_MERMA_HISTORICA = 3;
  w2.TOLERANCIA_MERMA_HISTORICA_PUNTOS = 1;
  const R2 = w2.EVE_CP_REGLAS;
  const mensajeEmpacado = (salidaKg) => R2.evaluarAvisoMerma(R2.calcularMermaPorDiferencia([inp(1000)], [salida(salidaKg)], 'EMPACADO'), {}).nivel;
  igual(mensajeEmpacado(960), 'ok', 'Empacado con tolerancia 5 %: 4 % no avisa');
  igual(mensajeEmpacado(940), 'aviso', 'Empacado con tolerancia 5 %: 6 % avisa');
  const sel = (salidaKg) => R2.evaluarAvisoMerma(R2.calcularMermaPorDiferencia([inp(1000)], [salida(salidaKg)], 'SELECCION'), { composicion: composicionConBasura(5) }).nivel;
  igual(sel(860), 'ok', 'Selección con 10 puntos: 14 % no avisa');
  igual(sel(840), 'aviso', 'Selección con 10 puntos: 16 % avisa');
  const lav = (salidaKg, registros) => R2.evaluarAvisoMerma(R2.calcularMermaPorDiferencia([inp(1000)], [salida(salidaKg)], 'LAVADO'), { historico: historico(8, registros) }).nivel;
  igual(lav(910, 3), 'ok', 'Lavado con mínimo 3 y tolerancia 1: 9 % no avisa (8 + 1)');
  igual(lav(900, 3), 'aviso', 'Lavado con mínimo 3 y tolerancia 1: 10 % avisa');
  igual(lav(900, 2), 'ok', 'Lavado con mínimo 3: 2 registros no alcanzan');
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/control-produccion-reglas.js'), 'utf8');
  afirmar(!/TOLERANCIA_[A-Z_]+\s*=/.test(fuente) && !/UMBRAL_MERMA_PROCESO\s*=/.test(fuente) && !/MIN_REGISTROS_[A-Z_]+\s*=/.test(fuente), 'el módulo no redefine los umbrales');
});

let fallos = 0;
for (const { nombre, fn } of casos) {
  try {
    fn();
    console.log(`PASS  ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.log(`FAIL  ${nombre}\n      ${error.message}`);
  }
}
console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
