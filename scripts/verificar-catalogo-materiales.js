// K7/K8 — Verificación del catálogo único de materiales (js/config.js).
//
// Carga js/config.js en un contexto vm con un `window` simulado y comprueba el catálogo, las listas
// derivadas, los alias y las banderas. Sin dependencias nuevas.
//
// Uso: node scripts/verificar-catalogo-materiales.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');

function cargarConfig() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error,
    // config.js inicializa Firebase al cargarse: se simula lo mínimo.
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/config.js'), 'utf8'), sandbox, { filename: 'js/config.js' });
  return sandbox.window;
}

const w = cargarConfig();

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

const cat = w.CATALOGO_MATERIALES;
const nombres = cat.map((m) => m.nombre);
const por = (n) => cat.find((m) => m.nombre === n);
// K8 aplicada: el molido de polipropileno se llama 'P.P. MOLIDO' y se suman materiales nuevos al final.
const k8 = nombres.includes('P.P. MOLIDO');
const molidoPP = k8 ? 'P.P. MOLIDO' : 'P.P MOLIDO';

// ── Lista original (antes de K7), sin LLANTA ─────────────────────────────
const COMUNES_ORIGINAL_SIN_LLANTA = [
  'BIDON', 'CRISTAL CON ETIQUETA', 'CRISTAL SIN ETIQUETA', 'CRISTAL CON LECHERO',
  'CRISTAL CON VERDE', 'DURO', 'LECHERO', 'LECHERO MOLIDO', 'MIXTO', 'MIXTO 2',
  'MULTI-COLOR', 'MULTILECHERO', 'P.E.', 'P.E. MOLIDO', 'P.P.', molidoPP,
  'PET', 'SUERO', 'VERDE', 'PELLET TAMBO', 'PELLET CAJAS', 'PELLET AGRO20', 'MATERIAL VIRGEN'
];
const PZ_ORIGINAL = ['TAMBO', 'CAJA CO30', 'CAJA CH25', 'CAJA AGRO20', 'ORING', 'SELLO', 'TAPON'];
const REQUIEREN_SELECCION = [
  'BIDON', 'CRISTAL CON ETIQUETA', 'CRISTAL SIN ETIQUETA', 'CRISTAL CON LECHERO', 'CRISTAL CON VERDE', 'DURO',
  'LECHERO', 'MIXTO', 'MIXTO 2', 'MULTI-COLOR', 'MULTILECHERO', 'P.E.', 'P.P.', 'PET', 'SUERO', 'VERDE'
];

caso('K7. El catálogo conserva las listas actuales (menos LLANTA)', () => {
  if (!k8) {
    igual(cat.length, 30, '30 entradas (23 KG + 7 PZ)');
    igual(w.MATERIALES_COMUNES, COMUNES_ORIGINAL_SIN_LLANTA, 'MATERIALES_COMUNES idéntico (contenido y orden) a la lista original sin LLANTA');
    igual(w.MATERIALES_COMUNES.length, 23, 'MATERIALES_COMUNES tiene 23 materiales');
  } else {
    igual(w.MATERIALES_COMUNES.slice(0, 23), COMUNES_ORIGINAL_SIN_LLANTA, 'los 23 originales conservan contenido y orden (con el renombre de K8) como prefijo');
  }
  igual(w.MATERIALES_PZ, PZ_ORIGINAL, 'MATERIALES_PZ idéntico a la lista original');
  igual(new Set(nombres).size, nombres.length, 'no hay nombres repetidos en el catálogo');
});

caso('K7. LLANTA ya no existe en ningún lado', () => {
  igual(nombres.includes('LLANTA'), false, 'no está en el catálogo');
  igual(w.MATERIALES_COMUNES.includes('LLANTA'), false, 'no está en MATERIALES_COMUNES');
  igual(w.MATERIALES_PZ.includes('LLANTA'), false, 'no está en MATERIALES_PZ');
  igual(w.materialesConStock().includes('LLANTA') || w.materialesProducibles().includes('LLANTA'), false, 'no está en las funciones derivadas');
  const hits = [];
  (function recorrer(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, f.name);
      if (f.isDirectory()) recorrer(ruta);
      else if (f.name.endsWith('.js') && fs.readFileSync(ruta, 'utf8').includes('LLANTA')) hits.push(path.relative(RAIZ, ruta));
    }
  })(path.join(RAIZ, 'js'));
  igual(hits, [], 'ningún archivo de js/ la menciona');
});

caso('K7. requiereSeleccion: exactamente los 16 crudos (19 con los PET* de K8)', () => {
  const esperados = k8 ? REQUIEREN_SELECCION.concat(['PET CRISTAL', 'PET ETIQUETA', 'PET VERDE']) : REQUIEREN_SELECCION;
  igual(w.materialesQueRequierenSeleccion().slice().sort(), esperados.slice().sort(), `materialesQueRequierenSeleccion() devuelve los ${esperados.length} esperados`);
  igual(w.materialesQueRequierenSeleccion().length, esperados.length, `${esperados.length} materiales`);
  const excluidos = ['LECHERO MOLIDO', 'P.E. MOLIDO', molidoPP, 'PELLET TAMBO', 'PELLET CAJAS', 'PELLET AGRO20', 'MATERIAL VIRGEN'];
  igual(excluidos.filter((n) => w.materialesQueRequierenSeleccion().includes(n)), [], 'ningún molido, pellet ni MATERIAL VIRGEN');
  igual(PZ_ORIGINAL.filter((n) => w.materialesQueRequierenSeleccion().includes(n)), [], 'ninguna pieza (unidad PZ)');
});

caso('K7. seObtieneEnProduccion', () => {
  const verdaderos = ['LECHERO', 'SUERO', 'P.E.', 'P.P.', 'LECHERO MOLIDO', 'P.E. MOLIDO', molidoPP, 'PELLET TAMBO', 'PELLET CAJAS', 'PELLET AGRO20', ...PZ_ORIGINAL];
  const producibles = w.materialesProducibles().filter((n) => !k8 || verdaderos.includes(n) || por(n).seObtieneEnProduccion);
  igual(verdaderos.filter((n) => !w.materialesProducibles().includes(n)), [], 'los 17 materiales originales que salen de proceso siguen siéndolo');
  if (!k8) igual(producibles.length, 17, 'materialesProducibles() tiene exactamente 17');
  const falsos = ['CRISTAL CON ETIQUETA', 'CRISTAL SIN ETIQUETA', 'CRISTAL CON LECHERO', 'PET', 'MIXTO', 'MIXTO 2', 'MULTI-COLOR', 'MULTILECHERO', 'VERDE', 'CRISTAL CON VERDE', 'DURO', 'BIDON', 'MATERIAL VIRGEN'];
  igual(falsos.filter((n) => por(n).seObtieneEnProduccion), [], 'los 13 que no salen de proceso quedan en false');
  igual(w.materialesConStock().length, cat.length, 'materialesConStock() devuelve todo el catálogo');
});

caso('K7. unidades y banderas por omisión', () => {
  igual(cat.filter((m) => m.unidad === 'PZ').length, 7, '7 entradas PZ');
  igual(cat.filter((m) => m.recibible === false).map((m) => m.nombre).sort(), k8 ? ['LECHERO LAVADO', 'RECHAZO CAJAS P.E.', 'RECHAZO CAJAS P.P.', 'RECHAZO TAMBOS'] : [], k8 ? 'solo los 3 rechazos y LECHERO LAVADO tienen recibible=false' : 'ninguna entrada de K7 pone recibible=false');
  igual(cat.filter((m) => m.unidad !== 'KG' && m.unidad !== 'PZ').length, 0, 'solo unidades KG o PZ');
});

// ── Alias (K8) ───────────────────────────────────────────────────────────
// Se activan cuando K8 está aplicada: se detecta por el nombre oficial P.P. MOLIDO.
if (k8) {
  caso('K8. Catálogo ampliado', () => {
    igual(cat.length, 44, '44 entradas (30 + 10 recibibles + 3 rechazos + LECHERO LAVADO)');
    igual(w.MATERIALES_COMUNES.length, 33, 'MATERIALES_COMUNES tiene 33');
    igual(w.materialesQueRequierenSeleccion().length, 19, 'materialesQueRequierenSeleccion() devuelve 19');
    igual(nombres.includes('P.P MOLIDO'), false, 'ya no existe "P.P MOLIDO" como nombre oficial');
    const rechazos = ['RECHAZO CAJAS P.E.', 'RECHAZO CAJAS P.P.', 'RECHAZO TAMBOS'];
    igual(rechazos.filter((n) => w.MATERIALES_COMUNES.includes(n)), [], 'los rechazos no están en MATERIALES_COMUNES (Báscula, Precios, Pagos)');
    igual(rechazos.filter((n) => w.materialesConStock().includes(n)).length, 3, 'los rechazos sí están en materialesConStock');
    igual(rechazos.filter((n) => w.materialesProducibles().includes(n)).length, 3, 'los rechazos sí están en materialesProducibles');
    igual(rechazos.filter((n) => w.materialesQueRequierenSeleccion().includes(n)), [], 'los rechazos no requieren selección');
    igual(rechazos.map((n) => [por(n).unidad, por(n).seObtieneEnProduccion, por(n).recibible, por(n).requiereSeleccion]),
      [['KG', true, false, false], ['KG', true, false, false], ['KG', true, false, false]], 'banderas de los rechazos');
    const pet = ['PET CRISTAL', 'PET ETIQUETA', 'PET VERDE'];
    igual(pet.filter((n) => w.materialesQueRequierenSeleccion().includes(n)).length, 3, 'los PET* requieren selección');
    const sinSeleccion = ['BIDON MOLIDO', 'SUERO MOLIDO', 'SUERO PELETIZADO', 'P.P. PELETIZADO', 'P.E. PELETIZADO', 'LECHERO PELETIZADO', 'PELLET TAPON'];
    igual(sinSeleccion.filter((n) => w.materialesQueRequierenSeleccion().includes(n)), [], 'molidos y peletizados nuevos no requieren selección');
    igual(sinSeleccion.concat(pet).every((n) => w.MATERIALES_COMUNES.includes(n) && por(n).seObtieneEnProduccion), true, 'los 10 nuevos son recibibles y salen de proceso');
  });

  caso('K8. Alias y compatibilidad con el nombre anterior', () => {
    igual(w.normalizarMaterial('P.P MOLIDO'), 'P.P. MOLIDO', 'el nombre anterior se normaliza al oficial');
    igual(w.normalizarMaterial(' p.p  molido '), 'P.P. MOLIDO', 'con espacios y minúsculas');
    const esperados = {
      'POLIETILENO': 'P.E.', 'POLIPROPILENO': 'P.P.', 'POLIETILENO MOLIDO': 'P.E. MOLIDO', 'POLIPROPILENO MOLIDO': 'P.P. MOLIDO',
      'POLIETILENO PELETIZADO': 'P.E. PELETIZADO', 'POLIPROPILENO PELETIZADO': 'P.P. PELETIZADO', 'GARRAFA MOLIDA': 'BIDON MOLIDO'
    };
    igual(Object.keys(esperados).map((k) => w.normalizarMaterial(k)), Object.values(esperados), 'alias nuevos');
    igual(w.MATERIALES_ALIAS.PEAD, 'DURO', 'el alias PEAD se conserva sin tocar');
    igual(Object.values(w.MATERIALES_ALIAS).filter((v) => !nombres.includes(v)), [], 'todo alias apunta a un material del catálogo');
  });
} else {
  console.log('(K8 aún no aplicada: se omiten sus casos)');
}

console.log(fallos === 0 ? '\nTodos los casos pasaron.' : `\n${fallos} verificación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
