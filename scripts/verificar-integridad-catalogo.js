// K22a2 — Integridad del catálogo de materiales (js/config.js): campos tipo, reglas y compraHabitual.
//
// Comprueba que cada referencia de las reglas (muelePara, pelletUsado, rechazoGenerado) apunte a un material que
// existe, que procesoProduccion sea uno de los tres procesos de pieza, y que no tengan rupturas los tramos
// crudo → molido (muelePara), pieza → pellet que consume (pelletUsado) y pieza → rechazo → molido (rechazoGenerado,
// muelePara, etapaRechazo), listando la ruptura exacta. Incluye pruebas negativas: se rompe una copia del catálogo a
// propósito y se comprueba que la ruptura se detecta.
//
// Las mezclas de pellet NO se modelan en el catálogo (decisión del negocio): una mezcla puede llevar más de seis
// materiales y su fórmula varía según el producto terminado, la dureza o flexibilidad y el color, así que se captura
// solo en Control Producción (Peletizado). Por eso el tramo molido → pellet no existe en el catálogo y no se comprueba
// (K22a3 retiró el campo peletizaComo; si reaparece en una entrada se reporta como campo de reglas desconocido).
//
// Uso: node scripts/verificar-integridad-catalogo.js   (código de salida 1 si algún caso falla)

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
const ETAPA_POR_PROCESO = w.EVE_INVENTARIO.ETAPA_POR_PROCESO;

// Los tres procesos de pieza salen de js/control-produccion.js (PROCESOS_PZ); se leen del código fuente para no cargar
// ese módulo entero y se comparan con la lista esperada.
const PROCESOS_PZ = /const PROCESOS_PZ = \[([^\]]*)\]/.exec(fs.readFileSync(path.join(RAIZ, 'js/control-produccion.js'), 'utf8'))[1]
  .split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
const TIPOS_VALIDOS = ['materia_prima', 'subproducto', 'intermedio', 'rechazo', 'producto_terminado'];
const CAMPOS_REGLAS = ['muelePara', 'pelletUsado', 'rechazoGenerado', 'etapaRechazo', 'procesoProduccion'];
const PIEZAS_SIN_RECHAZO = ['TAPON', 'ORING', 'SELLO'];
const lista = (valor) => (valor === undefined || valor === null ? [] : (Array.isArray(valor) ? valor : [valor]));

// Devuelve la lista de rupturas ([{ material, regla, motivo }]) de un catálogo. No modifica nada.
function rupturasDelCatalogo(catalogo) {
  const rupturas = [];
  const falla = (material, regla, motivo) => rupturas.push({ material, regla, motivo });
  const porNombre = new Map(catalogo.map((m) => [m.nombre, m]));
  const existe = (n) => porNombre.has(n);

  catalogo.forEach((m) => {
    if (!TIPOS_VALIDOS.includes(m.tipo)) falla(m.nombre, 'tipo', `tipo inválido o ausente: ${JSON.stringify(m.tipo)}`);
    if (m.compraHabitual !== undefined && typeof m.compraHabitual !== 'boolean') falla(m.nombre, 'compraHabitual', 'debe ser booleano');
    if (m.compraHabitual === false && !(m.unidad === 'KG' && m.recibible !== false)) {
      falla(m.nombre, 'compraHabitual', 'compraHabitual:false solo tiene sentido en un material recibible (KG)');
    }
    Object.keys(m.reglas || {}).forEach((campo) => {
      if (!CAMPOS_REGLAS.includes(campo)) falla(m.nombre, campo, 'campo de reglas desconocido');
    });
  });

  catalogo.forEach((m) => {
    const r = m.reglas || {};
    lista(r.muelePara).forEach((destino) => {
      if (!existe(destino)) return falla(m.nombre, 'muelePara', `apunta a '${destino}', que no existe`);
      const molido = porNombre.get(destino);
      if (molido.unidad !== 'KG' || molido.seObtieneEnProduccion !== true || molido.requiereSeleccion !== false) {
        falla(m.nombre, 'muelePara', `'${destino}' no es un material KG que sale de proceso y no requiere selección (un molido)`);
      }
    });
    lista(r.pelletUsado).forEach((pellet) => {
      if (!existe(pellet)) return falla(m.nombre, 'pelletUsado', `apunta a '${pellet}', que no existe`);
      const p = porNombre.get(pellet);
      if (p.unidad !== 'KG' || p.requiereSeleccion !== false) falla(m.nombre, 'pelletUsado', `'${pellet}' no es un material KG que se consume directo (pellet o virgen)`);
    });
    if (r.rechazoGenerado !== undefined) {
      if (!existe(r.rechazoGenerado)) falla(m.nombre, 'rechazoGenerado', `apunta a '${r.rechazoGenerado}', que no existe`);
      else if (porNombre.get(r.rechazoGenerado).tipo !== 'rechazo') falla(m.nombre, 'rechazoGenerado', `'${r.rechazoGenerado}' no es de tipo rechazo`);
    }
    if (r.procesoProduccion !== undefined && !PROCESOS_PZ.includes(r.procesoProduccion)) {
      falla(m.nombre, 'procesoProduccion', `'${r.procesoProduccion}' no es uno de los procesos de pieza (${PROCESOS_PZ.join(', ')})`);
    }
  });

  // Toda pieza de producción: procesoProduccion y pelletUsado, y rechazoGenerado salvo tapón, oring y sello.
  catalogo.filter((m) => m.unidad === 'PZ' && m.seObtieneEnProduccion).forEach((pieza) => {
    const r = pieza.reglas || {};
    if (!r.procesoProduccion) falla(pieza.nombre, 'procesoProduccion', 'toda pieza de producción necesita procesoProduccion');
    if (lista(r.pelletUsado).length === 0) falla(pieza.nombre, 'pelletUsado', 'toda pieza de producción necesita pelletUsado');
    if (!PIEZAS_SIN_RECHAZO.includes(pieza.nombre) && !r.rechazoGenerado) falla(pieza.nombre, 'rechazoGenerado', 'falta rechazoGenerado (solo tapón, oring y sello no lo tienen)');
    if (PIEZAS_SIN_RECHAZO.includes(pieza.nombre) && r.rechazoGenerado) falla(pieza.nombre, 'rechazoGenerado', 'tapón, oring y sello no tienen rechazo definido (por confirmar con el negocio)');
    if (pieza.tipo !== 'producto_terminado') falla(pieza.nombre, 'tipo', 'una pieza de producción debe ser producto_terminado');
  });

  // Cadena hacia atrás desde cada pieza: pieza → pelletUsado → (el pellet debe salir de Peletizado) → ...
  catalogo.filter((m) => m.unidad === 'PZ' && m.reglas && m.reglas.pelletUsado).forEach((pieza) => {
    lista(pieza.reglas.pelletUsado).forEach((pellet) => {
      const p = porNombre.get(pellet);
      if (!p) return; // ya reportado arriba
      if (p.tipo === 'intermedio' && p.seObtieneEnProduccion !== true) falla(pieza.nombre, 'pelletUsado', `el pellet '${pellet}' no sale de Peletizado (seObtieneEnProduccion)`);
    });
  });

  // Cadena hacia adelante desde cada rechazo: pieza → rechazoGenerado → muelePara → molido; y etapaRechazo coherente.
  const rechazosGenerados = new Map(); // rechazo → piezas que lo generan
  catalogo.filter((m) => m.reglas && m.reglas.rechazoGenerado).forEach((pieza) => {
    const rechazo = pieza.reglas.rechazoGenerado;
    if (!rechazosGenerados.has(rechazo)) rechazosGenerados.set(rechazo, []);
    rechazosGenerados.get(rechazo).push(pieza);
  });
  catalogo.filter((m) => m.tipo === 'rechazo').forEach((rechazo) => {
    const r = rechazo.reglas || {};
    if (!r.muelePara) falla(rechazo.nombre, 'muelePara', 'un rechazo debe volver a Molienda: falta muelePara');
    const piezas = rechazosGenerados.get(rechazo.nombre) || [];
    if (piezas.length === 0) falla(rechazo.nombre, 'rechazoGenerado', 'ninguna pieza genera este rechazo (huérfano)');
    if (!r.etapaRechazo) falla(rechazo.nombre, 'etapaRechazo', 'falta etapaRechazo');
    piezas.forEach((pieza) => {
      const etapa = ETAPA_POR_PROCESO[pieza.reglas && pieza.reglas.procesoProduccion];
      if (etapa && r.etapaRechazo && etapa !== r.etapaRechazo) {
        falla(rechazo.nombre, 'etapaRechazo', `es '${r.etapaRechazo}' pero '${pieza.nombre}' (${pieza.reglas.procesoProduccion}) deja su producción en '${etapa}'`);
      }
    });
  });
  return rupturas;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const copia = () => JSON.parse(JSON.stringify(w.CATALOGO_MATERIALES));
const entradaDe = (catalogo, nombre) => catalogo.find((m) => m.nombre === nombre);
const textoRupturas = (rupturas) => rupturas.map((r) => `${r.material}.${r.regla}: ${r.motivo}`).join(' | ');

caso('Los procesos de pieza leídos de control-produccion.js son los tres esperados', () => {
  igual(PROCESOS_PZ, ['PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES'], 'PROCESOS_PZ');
});

caso('El catálogo base no tiene rupturas (si falla, lista la ruptura exacta)', () => {
  const rupturas = rupturasDelCatalogo(w.CATALOGO_MATERIALES);
  afirmar(rupturas.length === 0, `${rupturas.length} ruptura(s): ${textoRupturas(rupturas)}`);
});

caso('Las 44 entradas llevan tipo y los tipos esperados por grupo', () => {
  const porTipo = {};
  w.CATALOGO_MATERIALES.forEach((m) => { porTipo[m.tipo] = (porTipo[m.tipo] || 0) + 1; });
  igual(porTipo, { materia_prima: 13, subproducto: 8, intermedio: 13, rechazo: 3, producto_terminado: 7 }, 'conteo por tipo');
  igual(w.CATALOGO_MATERIALES.length, 44, 'entradas');
});

caso('compraHabitual:false está en exactamente los 13 materiales acordados y solo en recibibles', () => {
  const noHabituales = w.CATALOGO_MATERIALES.filter((m) => m.compraHabitual === false).map((m) => m.nombre).sort();
  igual(noHabituales, ['BIDON MOLIDO', 'LECHERO PELETIZADO', 'P.E. PELETIZADO', 'P.P. PELETIZADO', 'PELLET AGRO20', 'PELLET CAJAS', 'PELLET TAMBO',
    'PELLET TAPON', 'PET CRISTAL', 'PET ETIQUETA', 'PET VERDE', 'SUERO MOLIDO', 'SUERO PELETIZADO'], 'no habituales');
  noHabituales.forEach((n) => afirmar(w.MATERIALES_COMUNES.includes(n), `${n} es recibible`));
  afirmar(w.CATALOGO_MATERIALES.every((m) => m.compraHabitual === undefined || m.compraHabitual === false), 'nunca true explícito: el true es la omisión');
});

caso('Las reglas base reproducen lo documentado (molienda, pellet por pieza, rechazo, etapa y proceso)', () => {
  const r = (n) => w.EVE_CATALOGO.reglasDe(n);
  igual(['LECHERO', 'P.E.', 'P.P.', 'BIDON', 'SUERO'].map((n) => r(n).muelePara), ['LECHERO MOLIDO', 'P.E. MOLIDO', 'P.P. MOLIDO', 'BIDON MOLIDO', 'SUERO MOLIDO'], 'crudos que se muelen');
  afirmar(!r('DURO').muelePara && !r('VERDE').muelePara && !r('PET CRISTAL').muelePara, 'DURO, VERDE y los PET/CRISTAL no se muelen (v8)');
  igual(['RECHAZO CAJAS P.E.', 'RECHAZO CAJAS P.P.', 'RECHAZO TAMBOS'].map((n) => [r(n).muelePara, r(n).etapaRechazo]),
    [['P.E. MOLIDO', 'INYECCIÓN'], ['P.P. MOLIDO', 'INYECCIÓN'], ['P.E. MOLIDO', 'SOPLADO']], 'rechazos');
  igual(['CAJA CO30', 'CAJA CH25', 'CAJA AGRO20', 'TAMBO'].map((n) => [r(n).procesoProduccion, r(n).pelletUsado, r(n).rechazoGenerado]), [
    ['PRODUCCION_CAJAS', ['PELLET CAJAS'], 'RECHAZO CAJAS P.E.'], ['PRODUCCION_CAJAS', ['PELLET CAJAS'], 'RECHAZO CAJAS P.E.'],
    ['PRODUCCION_CAJAS', ['PELLET AGRO20'], 'RECHAZO CAJAS P.P.'], ['PRODUCCION_TAMBOS', ['PELLET TAMBO'], 'RECHAZO TAMBOS']], 'piezas con rechazo');
  ['TAPON', 'ORING', 'SELLO'].forEach((n) => {
    igual([r(n).procesoProduccion, r(n).pelletUsado, r(n).rechazoGenerado], ['PRODUCCION_TAPONES', ['PELLET TAPON', 'MATERIAL VIRGEN'], undefined], `${n}: pellet o virgen y sin rechazo`);
  });
});

caso('Las reglas del catálogo solo usan los cinco campos vigentes (las mezclas de pellet no se modelan: sin peletizaComo)', () => {
  const usados = new Set();
  w.CATALOGO_MATERIALES.forEach((m) => Object.keys(m.reglas || {}).forEach((campo) => usados.add(campo)));
  afirmar(!usados.has('peletizaComo'), 'ninguna entrada base define peletizaComo');
  igual(Array.from(usados).sort(), ['etapaRechazo', 'muelePara', 'pelletUsado', 'procesoProduccion', 'rechazoGenerado'], 'campos de reglas en uso');
  igual(CAMPOS_REGLAS, ['muelePara', 'pelletUsado', 'rechazoGenerado', 'etapaRechazo', 'procesoProduccion'], 'campos permitidos');
});

// ── Pruebas negativas: se rompe una copia a propósito y se comprueba que la ruptura se detecta ──────────────────
const rompe = (descripcion, mutar, regla, material) => caso(`Detecta: ${descripcion}`, () => {
  const catalogo = copia();
  mutar(catalogo);
  const rupturas = rupturasDelCatalogo(catalogo);
  afirmar(rupturas.some((r) => r.regla === regla && (!material || r.material === material)), `no se detectó (${regla}${material ? ' en ' + material : ''}); rupturas: ${textoRupturas(rupturas) || 'ninguna'}`);
});

rompe("muelePara a un material que no existe", (c) => { entradaDe(c, 'LECHERO').reglas.muelePara = 'LECHERO MOLIDOO'; }, 'muelePara', 'LECHERO');
rompe('muelePara a algo que no es un molido (un crudo)', (c) => { entradaDe(c, 'P.E.').reglas.muelePara = 'MIXTO'; }, 'muelePara', 'P.E.');
rompe('rechazo que no vuelve a Molienda (sin muelePara)', (c) => { delete entradaDe(c, 'RECHAZO TAMBOS').reglas.muelePara; }, 'muelePara', 'RECHAZO TAMBOS');
rompe('pelletUsado a un pellet que no existe', (c) => { entradaDe(c, 'TAMBO').reglas.pelletUsado = ['PELLET TAMBOS']; }, 'pelletUsado', 'TAMBO');
rompe('pieza sin pelletUsado', (c) => { delete entradaDe(c, 'CAJA CO30').reglas.pelletUsado; }, 'pelletUsado', 'CAJA CO30');
rompe('pieza sin procesoProduccion', (c) => { delete entradaDe(c, 'CAJA CH25').reglas.procesoProduccion; }, 'procesoProduccion', 'CAJA CH25');
rompe('procesoProduccion que no es un proceso de pieza', (c) => { entradaDe(c, 'TAMBO').reglas.procesoProduccion = 'MOLIENDA'; }, 'procesoProduccion', 'TAMBO');
rompe('pieza con rechazo faltante (salvo tapón, oring y sello)', (c) => { delete entradaDe(c, 'CAJA AGRO20').reglas.rechazoGenerado; }, 'rechazoGenerado', 'CAJA AGRO20');
rompe('rechazoGenerado a un material que no es un rechazo', (c) => { entradaDe(c, 'TAMBO').reglas.rechazoGenerado = 'P.E. MOLIDO'; }, 'rechazoGenerado', 'TAMBO');
rompe('tapón con un rechazo definido sin que el negocio lo haya confirmado', (c) => { entradaDe(c, 'TAPON').reglas.rechazoGenerado = 'RECHAZO CAJAS P.E.'; }, 'rechazoGenerado', 'TAPON');
rompe('rechazo huérfano (ninguna pieza lo genera)', (c) => { delete entradaDe(c, 'TAMBO').reglas.rechazoGenerado; }, 'rechazoGenerado', 'RECHAZO TAMBOS');
rompe('etapaRechazo incoherente con el proceso de su pieza', (c) => { entradaDe(c, 'RECHAZO TAMBOS').reglas.etapaRechazo = 'INYECCIÓN'; }, 'etapaRechazo', 'RECHAZO TAMBOS');
rompe('rechazo sin etapaRechazo', (c) => { delete entradaDe(c, 'RECHAZO CAJAS P.P.').reglas.etapaRechazo; }, 'etapaRechazo', 'RECHAZO CAJAS P.P.');
rompe('tipo ausente o inválido', (c) => { entradaDe(c, 'LECHERO').tipo = 'cosa'; }, 'tipo', 'LECHERO');
rompe('compraHabitual:false en un material que no se recibe', (c) => { entradaDe(c, 'CAJA CO30').compraHabitual = false; }, 'compraHabitual', 'CAJA CO30');
rompe('campo de reglas desconocido', (c) => { entradaDe(c, 'LECHERO').reglas.muelePar = 'X'; }, 'muelePar', 'LECHERO');
rompe('peletizaComo ya no es un campo válido (las mezclas de pellet no se modelan en el catálogo)', (c) => { entradaDe(c, 'P.E. MOLIDO').reglas = { peletizaComo: ['PELLET CAJAS'] }; }, 'peletizaComo', 'P.E. MOLIDO');

caso('Un material nuevo (como los que dará de alta K22e) sin reglas no rompe la integridad', () => {
  const catalogo = copia();
  catalogo.push({ nombre: 'PLASTICO NUEVO', unidad: 'KG', seObtieneEnProduccion: true, requiereSeleccion: true, tipo: 'subproducto' });
  igual(rupturasDelCatalogo(catalogo), [], 'sin rupturas');
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
