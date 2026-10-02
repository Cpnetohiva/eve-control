window.firebaseConfig = {
  apiKey: "AIzaSyCF_6UdCStIo2eq-BSDH-vHmSu6LvzX7gU",
  authDomain: "everplastic.firebaseapp.com",
  projectId: "everplastic",
  storageBucket: "everplastic.firebasestorage.app",
  messagingSenderId: "804807980304",
  appId: "1:804807980304:web:47466f961871b5b0a80c06"
};

firebase.initializeApp(window.firebaseConfig);
window.db = firebase.firestore();

window.db.enablePersistence({ synchronizeTabs: true })
  .catch(function (err) {
    if (err.code === 'failed-precondition') {
      console.warn('EVE: persistencia offline limitada — múltiples tabs activas');
    } else if (err.code === 'unimplemented') {
      console.warn('EVE: persistencia offline no disponible en este navegador');
    }
  });

window.COLECCIONES = {
  USERS: 'users',
  ROLES: 'roles',
  DESTARAJE: 'destaraje',
  PAGOS: 'pagos',
  MINISTRACIONES: 'ministraciones',
  CONTROL_PRODUCCION: 'control_produccion',
  CONFIG: 'config',
  PRECIOS: 'precios',
  AJUSTES_PRECIO_PROVEEDOR: 'ajustes_precio_proveedor',
  CUENTAS_POR_PAGAR: 'cuentas_por_pagar',
  AUDITORIAS: 'auditorias',
  PROVEEDORES: 'proveedores',
  COMISIONES: 'comisiones',
  AUDITORIA_FOTOS: 'auditoria_fotos',
  VENTAS: 'ventas',
  COMPOSICIONES: 'composiciones',
  INVENTARIO: 'inventario',
  INVENTARIO_INICIAL: 'inventario_inicial',
  CUENTAS_POR_COBRAR: 'cuentas_por_cobrar',
  COBROS: 'cobros',
  GASTOS: 'gastos'
};

// Catálogo único de materiales. Cada entrada: { nombre, unidad, seObtieneEnProduccion, tipo } más banderas
// opcionales, todas true por omisión:
//   recibible          — se puede recibir/comprar (Báscula, Precios, Pagos). false: solo existe como salida de proceso.
//   requiereSeleccion  — un material KG crudo que pasa por Selección antes de poder procesarse. false: molidos,
//                        pellets, MATERIAL VIRGEN y piezas (no se reciben ni se seleccionan).
//   compraHabitual     — false: material recibible que NO se compra habitualmente (se produce más de lo que se compra):
//                        sin precio vigente no alarma en Precios, solo se lista como informativo. Cualquier otro
//                        material, incluidos los nuevos, alarma por omisión.
//   activo             — false: archivado (sale de las listas de alta pero sigue resolviendo; lo pone window.EVE_CATALOGO).
// tipo es informativo: 'materia_prima', 'subproducto', 'intermedio', 'rechazo' o 'producto_terminado'.
// reglas (opcional) son las transformaciones del material, para leerlas en lugar de fijarlas en el código:
//   muelePara          — molido que resulta de molerlo (los rechazos también).
//   pelletUsado        — para una pieza, los pellets que consume (lista: los tapones eligen entre PELLET TAPON y MATERIAL VIRGEN).
//   rechazoGenerado    — para una pieza, el rechazo recuperable que produce. TAPON, ORING y SELLO: sin rechazo definido.
//   etapaRechazo       — etapa de inventario donde queda un rechazo (INYECCIÓN o SOPLADO).
//   procesoProduccion  — para una pieza, el proceso donde se produce (PRODUCCION_CAJAS, PRODUCCION_TAMBOS o PRODUCCION_TAPONES).
// Las mezclas de pellet NO se modelan en el catálogo (una mezcla puede llevar más de seis materiales y su fórmula varía
// según el producto, la dureza o flexibilidad y el color): se capturan solo en Control Producción, en Peletizado, con
// varios inputs de molidos y un output de pellet.
// El ORDEN de las entradas es el orden en que se listan los materiales en toda la app.
const K = 'KG';
const PZ = 'PZ';
window.CATALOGO_MATERIALES = [
  { nombre: 'BIDON', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima', reglas: { muelePara: 'BIDON MOLIDO' } },
  { nombre: 'CRISTAL CON ETIQUETA', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima' },
  { nombre: 'CRISTAL SIN ETIQUETA', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima' },
  { nombre: 'CRISTAL CON LECHERO', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima' },
  { nombre: 'CRISTAL CON VERDE', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima' },
  // Crudo polipropileno: se compra, pasa por Selección y se descompone en P.P. y P.E. más BASURA.
  // No sale de proceso y NO se muele como DURO.
  { nombre: 'DURO', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima' },
  { nombre: 'LECHERO', unidad: K, seObtieneEnProduccion: true, tipo: 'subproducto', reglas: { muelePara: 'LECHERO MOLIDO' } },
  { nombre: 'LECHERO MOLIDO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio' },
  { nombre: 'MIXTO', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima' },
  { nombre: 'MIXTO 2', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima' },
  // Se recibe; al seleccionarse produce P.E.
  { nombre: 'MULTI-COLOR', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima' },
  // Se recibe, con composición propia.
  { nombre: 'MULTILECHERO', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima' },
  { nombre: 'P.E.', unidad: K, seObtieneEnProduccion: true, tipo: 'subproducto', reglas: { muelePara: 'P.E. MOLIDO' } },
  { nombre: 'P.E. MOLIDO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio' },
  { nombre: 'P.P.', unidad: K, seObtieneEnProduccion: true, tipo: 'subproducto', reglas: { muelePara: 'P.P. MOLIDO' } },
  { nombre: 'P.P. MOLIDO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio' },
  { nombre: 'PET', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima' },
  { nombre: 'SUERO', unidad: K, seObtieneEnProduccion: true, tipo: 'subproducto', reglas: { muelePara: 'SUERO MOLIDO' } },
  { nombre: 'VERDE', unidad: K, seObtieneEnProduccion: false, tipo: 'materia_prima' },
  // Salen de PELETIZADO con inputs P.E. MOLIDO, P.P. MOLIDO, BIDON MOLIDO y LECHERO MOLIDO.
  { nombre: 'PELLET TAMBO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio', compraHabitual: false },
  { nombre: 'PELLET CAJAS', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio', compraHabitual: false },
  { nombre: 'PELLET AGRO20', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio', compraHabitual: false },
  // Ninguno sale de proceso: se compra limpio y se consume directo desde RECEPCION.
  { nombre: 'MATERIAL VIRGEN', unidad: K, seObtieneEnProduccion: false, requiereSeleccion: false, tipo: 'materia_prima' },
  // Resultado de seleccionar PET: se reciben (todo material KG es recibible) y siempre pasan por Selección.
  { nombre: 'PET CRISTAL', unidad: K, seObtieneEnProduccion: true, tipo: 'subproducto', compraHabitual: false },
  { nombre: 'PET ETIQUETA', unidad: K, seObtieneEnProduccion: true, tipo: 'subproducto', compraHabitual: false },
  { nombre: 'PET VERDE', unidad: K, seObtieneEnProduccion: true, tipo: 'subproducto', compraHabitual: false },
  // Molidos y peletizados nuevos (salen de MOLIENDA / PELETIZADO; no se reciben ni se seleccionan).
  { nombre: 'BIDON MOLIDO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio', compraHabitual: false },
  { nombre: 'SUERO MOLIDO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio', compraHabitual: false },
  { nombre: 'SUERO PELETIZADO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio', compraHabitual: false },
  { nombre: 'P.P. PELETIZADO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio', compraHabitual: false },
  { nombre: 'P.E. PELETIZADO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio', compraHabitual: false },
  { nombre: 'LECHERO PELETIZADO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio', compraHabitual: false },
  // Sale de PELETIZADO. PRODUCCION_TAPONES (TAPON, ORING, SELLO) consume PELLET TAPON o MATERIAL VIRGEN
  // y el operador elige cuál; no tiene rechazo recuperable definido.
  { nombre: 'PELLET TAPON', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio', compraHabitual: false },
  // Rechazos: merma recuperable que se consume en MOLIENDA. No se compran ni llevan precio
  // (recibible=false: no entran a Báscula, Precios, Pagos ni a sus importadores). El rechazo se DERIVA del
  // producto, no lo elige el operador:
  //   CAJA CO30 y CAJA CH25 (PELLET CAJAS, PE)  -> RECHAZO CAJAS P.E.   (PRODUCCION_CAJAS, etapa INYECCION)
  //   CAJA AGRO20 (PELLET AGRO20, PP)           -> RECHAZO CAJAS P.P.   (PRODUCCION_CAJAS, etapa INYECCION)
  //   TAMBO (PELLET TAMBO, mezcla de HDPE)      -> RECHAZO TAMBOS       (PRODUCCION_TAMBOS, etapa SOPLADO)
  { nombre: 'RECHAZO CAJAS P.E.', unidad: K, seObtieneEnProduccion: true, recibible: false, requiereSeleccion: false, tipo: 'rechazo', reglas: { muelePara: 'P.E. MOLIDO', etapaRechazo: 'INYECCIÓN' } },
  { nombre: 'RECHAZO CAJAS P.P.', unidad: K, seObtieneEnProduccion: true, recibible: false, requiereSeleccion: false, tipo: 'rechazo', reglas: { muelePara: 'P.P. MOLIDO', etapaRechazo: 'INYECCIÓN' } },
  { nombre: 'RECHAZO TAMBOS', unidad: K, seObtieneEnProduccion: true, recibible: false, requiereSeleccion: false, tipo: 'rechazo', reglas: { muelePara: 'P.E. MOLIDO', etapaRechazo: 'SOPLADO' } },
  { nombre: 'TAMBO', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'producto_terminado', reglas: { procesoProduccion: 'PRODUCCION_TAMBOS', pelletUsado: ['PELLET TAMBO'], rechazoGenerado: 'RECHAZO TAMBOS' } },
  { nombre: 'CAJA CO30', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'producto_terminado', reglas: { procesoProduccion: 'PRODUCCION_CAJAS', pelletUsado: ['PELLET CAJAS'], rechazoGenerado: 'RECHAZO CAJAS P.E.' } },
  { nombre: 'CAJA CH25', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'producto_terminado', reglas: { procesoProduccion: 'PRODUCCION_CAJAS', pelletUsado: ['PELLET CAJAS'], rechazoGenerado: 'RECHAZO CAJAS P.E.' } },
  { nombre: 'CAJA AGRO20', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'producto_terminado', reglas: { procesoProduccion: 'PRODUCCION_CAJAS', pelletUsado: ['PELLET AGRO20'], rechazoGenerado: 'RECHAZO CAJAS P.P.' } },
  { nombre: 'ORING', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'producto_terminado', reglas: { procesoProduccion: 'PRODUCCION_TAPONES', pelletUsado: ['PELLET TAPON', 'MATERIAL VIRGEN'] } },
  { nombre: 'SELLO', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'producto_terminado', reglas: { procesoProduccion: 'PRODUCCION_TAPONES', pelletUsado: ['PELLET TAPON', 'MATERIAL VIRGEN'] } },
  { nombre: 'TAPON', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'producto_terminado', reglas: { procesoProduccion: 'PRODUCCION_TAPONES', pelletUsado: ['PELLET TAPON', 'MATERIAL VIRGEN'] } }
];

// Listas derivadas del catálogo. MATERIALES_COMUNES = materiales KG que se pueden recibir (sin archivar). Se calculan
// en window.EVE_CATALOGO (al final de este archivo), que las vuelve a calcular cada vez que cambia el catálogo:
// MATERIALES_COMUNES, MATERIALES_PZ y PRODUCTOS_VENTA no son datos fijos. Un material archivado (activo:false) sale
// de las listas de ALTA pero sigue resolviendo (las variantes ...Historicos y MATERIALES_PZ lo incluyen).

// Materiales que salen de un proceso (candidatos a output). Sin archivados; ...Historicos los incluye.
window.materialesProducibles = function () {
  return window.CATALOGO_MATERIALES.filter((m) => m.seObtieneEnProduccion && m.activo !== false).map((m) => m.nombre);
};

window.materialesProduciblesHistoricos = function () {
  return window.CATALOGO_MATERIALES.filter((m) => m.seObtieneEnProduccion).map((m) => m.nombre);
};

// Todo material que puede tener existencias: lo que se recibe más lo que se produce (KG y PZ). Sin archivados;
// ...Historicos los incluye (para leer historial, reportes e inventario con saldo).
window.materialesConStock = function () {
  return window.CATALOGO_MATERIALES.filter((m) => m.activo !== false).map((m) => m.nombre);
};

window.materialesConStockHistoricos = function () {
  return window.CATALOGO_MATERIALES.map((m) => m.nombre);
};

// Materiales KG crudos que deben pasar por Selección (sin archivados).
window.materialesQueRequierenSeleccion = function () {
  return window.CATALOGO_MATERIALES
    .filter((m) => m.unidad === 'KG' && m.requiereSeleccion !== false && m.activo !== false)
    .map((m) => m.nombre);
};

// Variantes históricas (incluyen archivados): para validar y leer lo que ya existe (historial, reportes, composiciones,
// edición de registros), no para ofrecer en altas. K22c.
window.materialesQueRequierenSeleccionHistoricos = function () {
  return window.CATALOGO_MATERIALES
    .filter((m) => m.unidad === 'KG' && m.requiereSeleccion !== false)
    .map((m) => m.nombre);
};

window.materialesRecibiblesHistoricos = function () {
  return window.CATALOGO_MATERIALES
    .filter((m) => m.unidad === 'KG' && m.recibible !== false)
    .map((m) => m.nombre);
};

// Materiales que se miden en piezas. Función (no una copia local): lee la lista vigente del catálogo y por eso
// incluye también los archivados (la unidad de un registro histórico no debe cambiar).
window.materialesPZ = function () {
  return window.MATERIALES_PZ;
};

// Productos que se pueden vender = todo material con existencias (sin archivados). Función, no una captura.
window.productosVenta = function () {
  return window.materialesConStock();
};

window.MATERIALES_ALIAS = {
  'CRISTAL CON ETIQ': 'CRISTAL CON ETIQUETA',
  'CRISTAL SIN ETIQ': 'CRISTAL SIN ETIQUETA',
  'MULTI-LECHERO': 'MULTILECHERO',
  'MIXTO2': 'MIXTO 2',
  'MULTICOLOR': 'MULTI-COLOR',
  'GARRAFA': 'BIDON',
  'PEAD': 'DURO',
  'P.E..': 'P.E.',
  'P.P MOLIDO': 'P.P. MOLIDO',
  'POLIETILENO': 'P.E.',
  'POLIPROPILENO': 'P.P.',
  'POLIETILENO MOLIDO': 'P.E. MOLIDO',
  'POLIPROPILENO MOLIDO': 'P.P. MOLIDO',
  'POLIETILENO PELETIZADO': 'P.E. PELETIZADO',
  'POLIPROPILENO PELETIZADO': 'P.P. PELETIZADO',
  'GARRAFA MOLIDA': 'BIDON MOLIDO'
};

window.PROVEEDORES_ALIAS = {
  'ARTURO': 'ARTURO LARA',
  'JESUS': 'JESÚS',
  'FÉLIX': 'FELIX LOZANO',
  'FELIX': 'FELIX LOZANO'
};

window.normalizarMaterial = function (valor) {
  const limpio = (valor || '').toString().trim().replace(/\s+/g, ' ').toUpperCase();
  return window.MATERIALES_ALIAS[limpio] || limpio;
};

window.normalizarProveedor = function (valor) {
  const limpio = (valor || '').toString().trim().replace(/\s+/g, ' ').toUpperCase();
  return window.PROVEEDORES_ALIAS[limpio] || limpio;
};

// window.MATERIALES_PZ (todas las piezas, también archivadas) lo calcula window.EVE_CATALOGO.

window.PROVEEDORES_COMUNES = [
  'JOSE ENRIQUE', 'JUANA', 'FRANCISCO',
  'FELIX LOZANO', 'ARTURO LARA', 'OLEGARIO', 'JESÚS'
];

// Tipos de merma (desperdicio no recuperable) y los procesos donde se pueden capturar. Ampliable.
// Procesos que NO aparecen aquí no tienen merma: EMPACADO no genera, y en Inyección, Soplado y Tapones
// (PRODUCCION_CAJAS, PRODUCCION_TAMBOS, PRODUCCION_TAPONES) el desperdicio recuperable se captura como un
// material de rechazo (RECHAZO CAJAS P.E., RECHAZO CAJAS P.P. o RECHAZO TAMBOS), no como merma.
window.TIPOS_MERMA = [
  { nombre: 'BASURA', procesos: ['SELECCION'] },
  { nombre: 'LODOS', procesos: ['MOLIENDA', 'LAVADO'] },
  { nombre: 'PIEDRAS', procesos: ['PELETIZADO'] }
];

// Nombres de los tipos de merma que se pueden capturar en un proceso (vacío si no tiene merma).
window.tiposMermaParaProceso = function (tipoProceso) {
  return window.TIPOS_MERMA.filter((t) => t.procesos.includes(tipoProceso)).map((t) => t.nombre);
};

// Todos los nombres de tipos de merma (de cualquier proceso).
window.nombresTiposMerma = function () {
  return window.TIPOS_MERMA.map((t) => t.nombre);
};

// ── Catálogo editable (K22a1, K22b) ───────────────────────────────────────
// window.EVE_CATALOGO fusiona el catálogo BASE (este archivo) con una extensión opcional guardada en
// config/sistema.catalogoExtra. Forma de la extensión:
//   { version, materiales: { NOMBRE: { nombre, unidad, seObtieneEnProduccion, recibible, requiereSeleccion, activo,
//     compraHabitual, tipo, alias: [...], reglas: {...} } }, overrides: { 'NOMBRE BASE': { activo, alias: [...] } },
//     mermas: [{ nombre, procesos }] }
// validarExtension valida POR ENTRADA (no todo o nada): una entrada inválida se omite junto con las que dependen de
// ella y el resto se aplica; solo una extensión que no es un objeto se ignora entera. aplicar es idempotente (siempre
// parte del catálogo base), NUNCA lanza y deja las entradas omitidas en window.EVE_CATALOGO.errores. Sin extensión
// (undefined) deja exactamente el catálogo base.
(function () {
  const CATALOGO_BASE = window.CATALOGO_MATERIALES.map((m) => ({ ...m }));
  const ALIAS_BASE = { ...window.MATERIALES_ALIAS };
  const MERMAS_BASE = window.TIPOS_MERMA.map((t) => ({ nombre: t.nombre, procesos: t.procesos.slice() }));

  // Procesos de pieza (los mismos que PROCESOS_PZ de control-produccion.js: scripts/verificar-catalogo-editable.js
  // comprueba que coincidan), campos permitidos de reglas, banderas booleanas y tope de alias por material (el nombre
  // oficial ocupa uno de los 10 valores que admite un filtro 'in' de Firestore: ver docs/diseno_catalogo_editable.md).
  const PROCESOS_PIEZA = ['PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES'];
  const CAMPOS_REGLAS = ['muelePara', 'pelletUsado', 'rechazoGenerado', 'etapaRechazo', 'procesoProduccion'];
  const BANDERAS = ['seObtieneEnProduccion', 'recibible', 'requiereSeleccion', 'activo', 'compraHabitual'];
  const CAMPOS_OVERRIDE = ['activo', 'alias'];
  const MAX_ALIAS = 9;

  const esObjeto = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const claveNombre = (valor) => String(valor === undefined || valor === null ? '' : valor).trim().replace(/\s+/g, ' ').toUpperCase();
  const lista = (valor) => (valor === undefined || valor === null ? [] : (Array.isArray(valor) ? valor : [valor]));

  function recalcularListasDerivadas() {
    const catalogo = window.CATALOGO_MATERIALES;
    window.MATERIALES_COMUNES = catalogo
      .filter((m) => m.unidad === 'KG' && m.recibible !== false && m.activo !== false)
      .map((m) => m.nombre);
    window.MATERIALES_PZ = catalogo.filter((m) => m.unidad === 'PZ').map((m) => m.nombre);
    window.PRODUCTOS_VENTA = window.materialesConStock();
  }

  // Función pura: no modifica el catálogo ni la extensión. Devuelve { validas, omitidas, ilegible }:
  //   validas   — la extensión sin las entradas omitidas (misma forma que la original).
  //   omitidas  — [{ nombre, tipo, motivo }] con tipo 'extension' | 'material' | 'override' | 'merma'.
  //   ilegible  — true si la extensión completa no es un objeto (se ignora entera).
  function validarExtension(extra) {
    const resultado = { validas: { materiales: {}, overrides: {}, mermas: [] }, omitidas: [], ilegible: false };
    if (extra === undefined) return resultado; // campo ausente: nada que aplicar ni que reportar
    const omitir = (nombre, tipo, motivo) => { resultado.omitidas.push({ nombre, tipo, motivo }); };
    if (!esObjeto(extra)) {
      resultado.ilegible = true;
      omitir('(extension completa)', 'extension', 'no es un objeto: se ignora entera y se usa el catalogo base');
      return resultado;
    }
    if (extra.version !== undefined) resultado.validas.version = extra.version;

    const nombresBase = new Set(CATALOGO_BASE.map((m) => m.nombre));
    const aliasBasePorMaterial = {};
    Object.keys(ALIAS_BASE).forEach((a) => { aliasBasePorMaterial[ALIAS_BASE[a]] = (aliasBasePorMaterial[ALIAS_BASE[a]] || 0) + 1; });
    // Todo nombre o alias ya ocupado -> quién lo ocupa. La entrada BASE siempre gana.
    const ocupados = new Map();
    const colision = (dueno) => (/^el (material|alias) base/.test(dueno) ? ` (la entrada base siempre gana)` : '');
    nombresBase.forEach((n) => ocupados.set(n, `el material base ${n}`));
    Object.keys(ALIAS_BASE).forEach((a) => { if (!ocupados.has(a)) ocupados.set(a, `el alias base de ${ALIAS_BASE[a]}`); });

    const seccion = (nombreSeccion, valor, esperaLista) => {
      if (valor === undefined) return null;
      const valido = esperaLista ? Array.isArray(valor) : esObjeto(valor);
      if (!valido) { omitir(nombreSeccion, 'extension', `no es ${esperaLista ? 'una lista' : 'un objeto'}: se ignora esa parte`); return null; }
      return valor;
    };

    // Revisa los alias de una entrada: devuelve el motivo del primer problema o null y la lista normalizada.
    const revisarAlias = (aliasCrudos, propietario, contarBase) => {
      if (aliasCrudos !== undefined && !Array.isArray(aliasCrudos)) return { motivo: 'alias debe ser una lista' };
      const nuevos = [];
      for (const crudo of lista(aliasCrudos)) {
        if (typeof crudo !== 'string' || !claveNombre(crudo)) return { motivo: 'cada alias debe ser un texto no vacio' };
        const alias = claveNombre(crudo);
        if (ALIAS_BASE[alias] === propietario && contarBase) continue; // ya es un alias de este material base: no cuenta ni colisiona
        if (ocupados.has(alias)) return { motivo: `el alias '${alias}' colisiona con ${ocupados.get(alias)}${colision(ocupados.get(alias))}` };
        if (!nuevos.includes(alias)) nuevos.push(alias);
      }
      const total = (contarBase ? (aliasBasePorMaterial[propietario] || 0) : 0) + nuevos.length;
      if (total > MAX_ALIAS) return { motivo: `tiene ${total} alias (maximo ${MAX_ALIAS}: el nombre oficial ocupa uno de los 10 valores que admite una consulta 'in' de Firestore)` };
      return { alias: nuevos };
    };

    // ── Materiales nuevos ──────────────────────────────────────────────────────────────────────────────
    const materiales = seccion('materiales', extra.materiales, false) || {};
    const candidatos = new Map(); // nombre -> { entrada, referencias }
    const omitidasPorNombre = new Set();
    Object.keys(materiales).forEach((clave) => {
      const entrada = materiales[clave];
      if (!esObjeto(entrada)) { omitir(clave, 'material', 'la entrada no es un objeto'); return; }
      const nombre = claveNombre(entrada.nombre || clave);
      const falla = (motivo) => { omitir(nombre || clave, 'material', motivo); omitidasPorNombre.add(nombre); };
      if (!nombre) return falla('el nombre es obligatorio');
      if (ocupados.has(nombre)) return falla(`colision de nombre con ${ocupados.get(nombre)}${colision(ocupados.get(nombre))}`);
      if (entrada.unidad !== 'KG' && entrada.unidad !== 'PZ') return falla(`unidad invalida: ${JSON.stringify(entrada.unidad)} (solo KG o PZ)`);
      const bandera = BANDERAS.find((c) => entrada[c] !== undefined && typeof entrada[c] !== 'boolean');
      if (bandera) return falla(`la bandera ${bandera} debe ser true o false`);
      let referencias = [];
      if (entrada.reglas !== undefined) {
        if (!esObjeto(entrada.reglas)) return falla('reglas debe ser un objeto');
        const desconocido = Object.keys(entrada.reglas).find((c) => !CAMPOS_REGLAS.includes(c));
        if (desconocido) return falla(`campo de reglas desconocido: ${desconocido}${desconocido === 'peletizaComo' ? ' (ya no existe: las mezclas de pellet no se modelan en el catalogo)' : ''}`);
        const proceso = entrada.reglas.procesoProduccion;
        if (proceso !== undefined && !PROCESOS_PIEZA.includes(proceso)) return falla(`procesoProduccion '${proceso}' no es un proceso de pieza (${PROCESOS_PIEZA.join(', ')})`);
        referencias = [...lista(entrada.reglas.muelePara), ...lista(entrada.reglas.pelletUsado), ...lista(entrada.reglas.rechazoGenerado)].map((r) => claveNombre(r));
      }
      const revision = revisarAlias(entrada.alias, nombre, false);
      if (revision.motivo) return falla(revision.motivo);
      candidatos.set(nombre, { entrada, referencias });
      ocupados.set(nombre, `el material ${nombre} de la extension`);
      revision.alias.forEach((a) => ocupados.set(a, `un alias de ${nombre} en la extension`));
    });

    // Una entrada que apunta a un material inexistente o a otra entrada omitida se omite, y así en cascada.
    let cambio = true;
    while (cambio) {
      cambio = false;
      candidatos.forEach((candidato, nombre) => {
        const faltante = candidato.referencias.find((r) => !nombresBase.has(r) && !candidatos.has(r));
        if (faltante === undefined) return;
        candidatos.delete(nombre);
        omitidasPorNombre.add(nombre);
        omitir(nombre, 'material', omitidasPorNombre.has(faltante) ? `depende de '${faltante}', que se omitio` : `apunta a '${faltante}', que no existe`);
        cambio = true;
      });
    }
    candidatos.forEach((candidato, nombre) => { resultado.validas.materiales[nombre] = candidato.entrada; });

    // ── Overrides sobre materiales base (solo archivar y alias) ────────────────────────────────────────
    const overrides = seccion('overrides', extra.overrides, false) || {};
    Object.keys(overrides).forEach((clave) => {
      const nombre = claveNombre(clave);
      const override = overrides[clave];
      if (!nombresBase.has(nombre)) return omitir(clave, 'override', 'no es un material base: los overrides solo aplican a materiales base');
      if (!esObjeto(override)) return omitir(nombre, 'override', 'la entrada no es un objeto');
      const noPermitido = Object.keys(override).find((c) => !CAMPOS_OVERRIDE.includes(c));
      if (noPermitido) return omitir(nombre, 'override', `campo no permitido en un override: ${noPermitido} (solo ${CAMPOS_OVERRIDE.join(' y ')})`);
      if (override.activo !== undefined && typeof override.activo !== 'boolean') return omitir(nombre, 'override', 'activo debe ser true o false');
      const revision = revisarAlias(override.alias, nombre, true);
      if (revision.motivo) return omitir(nombre, 'override', revision.motivo);
      revision.alias.forEach((a) => ocupados.set(a, `un alias de ${nombre} en la extension`));
      resultado.validas.overrides[nombre] = override;
    });

    // ── Tipos de merma ─────────────────────────────────────────────────────────────────────────────────
    const procesosConocidos = Object.keys(window.NOMBRE_PROCESO_UI || {});
    const vistasEnExtension = new Set();
    (seccion('mermas', extra.mermas, true) || []).forEach((merma, indice) => {
      if (!esObjeto(merma)) return omitir(`mermas[${indice}]`, 'merma', 'la entrada no es un objeto');
      const nombre = claveNombre(merma.nombre);
      if (!nombre) return omitir(`mermas[${indice}]`, 'merma', 'el nombre es obligatorio');
      if (vistasEnExtension.has(nombre)) return omitir(nombre, 'merma', 'nombre repetido en la extension');
      if (!Array.isArray(merma.procesos)) return omitir(nombre, 'merma', 'procesos debe ser una lista');
      const desconocido = merma.procesos.find((proceso) => !procesosConocidos.includes(proceso));
      if (desconocido !== undefined) return omitir(nombre, 'merma', `proceso desconocido: ${JSON.stringify(desconocido)}`);
      vistasEnExtension.add(nombre);
      resultado.validas.mermas.push(merma);
    });
    return resultado;
  }

  // Publica el catálogo fusionado a partir de las entradas YA validadas.
  function publicar(validas) {
    const catalogo = CATALOGO_BASE.map((m) => ({ ...m }));
    const alias = { ...ALIAS_BASE };

    const overrides = esObjeto(validas.overrides) ? validas.overrides : {};
    catalogo.forEach((material) => {
      const override = overrides[material.nombre];
      if (!esObjeto(override)) return;
      if (override.activo === false) material.activo = false;
      (Array.isArray(override.alias) ? override.alias : []).forEach((a) => { alias[claveNombre(a)] = material.nombre; });
    });

    const nuevos = esObjeto(validas.materiales) ? validas.materiales : {};
    Object.keys(nuevos).forEach((clave) => {
      const entrada = nuevos[clave];
      if (!esObjeto(entrada)) return;
      const nombre = claveNombre(entrada.nombre || clave);
      const { alias: aliasEntrada, ...resto } = entrada;
      catalogo.push({ ...resto, nombre });
      (Array.isArray(aliasEntrada) ? aliasEntrada : []).forEach((a) => { alias[claveNombre(a)] = nombre; });
    });

    const mermas = MERMAS_BASE.map((t) => ({ nombre: t.nombre, procesos: t.procesos.slice() }));
    (Array.isArray(validas.mermas) ? validas.mermas : []).forEach((merma) => {
      if (!esObjeto(merma) || !merma.nombre) return;
      const nueva = { nombre: claveNombre(merma.nombre), procesos: Array.isArray(merma.procesos) ? merma.procesos.slice() : [] };
      const indice = mermas.findIndex((t) => t.nombre === nueva.nombre);
      if (indice >= 0) mermas[indice] = nueva; else mermas.push(nueva);
    });

    // Se muta en sitio el arreglo del catálogo (las referencias existentes ven el cambio) y se reasignan las demás.
    window.CATALOGO_MATERIALES.splice(0, window.CATALOGO_MATERIALES.length, ...catalogo);
    window.MATERIALES_ALIAS = alias;
    window.TIPOS_MERMA = mermas;
    recalcularListasDerivadas();
  }

  // Valida y aplica. NUNCA lanza: ante un error inesperado deja el catálogo base y lo reporta en errores.
  function aplicar(extra) {
    try {
      const validacion = validarExtension(extra);
      publicar(validacion.validas);
      window.EVE_CATALOGO.errores = validacion.omitidas;
      if (validacion.omitidas.length > 0) console.warn('[catalogo] Extension del catalogo con errores:', validacion.omitidas);
    } catch (error) {
      try { publicar({}); } catch (errorBase) { console.warn('[catalogo] No se pudo restaurar el catalogo base:', errorBase); }
      window.EVE_CATALOGO.errores = [{ nombre: '(extension completa)', tipo: 'extension', motivo: `error inesperado al aplicar: ${error && error.message}` }];
      console.warn('[catalogo] Error inesperado al aplicar la extension; se usa el catalogo base:', error);
    }
  }

  function buscar(nombre) {
    const clave = window.normalizarMaterial(nombre);
    const entrada = window.CATALOGO_MATERIALES.find((m) => m.nombre === clave);
    return entrada ? { ...entrada } : null;
  }

  function listar(opciones) {
    const incluirArchivados = !!(opciones && opciones.incluirArchivados);
    return window.CATALOGO_MATERIALES
      .filter((m) => incluirArchivados || m.activo !== false)
      .map((m) => ({ ...m }));
  }

  // Reglas de transformación del material (las entradas base las tienen desde K22a2); {} si no tiene.
  function reglasDe(nombre) {
    const entrada = buscar(nombre);
    return entrada && entrada.reglas ? { ...entrada.reglas } : {};
  }

  // 'activo' | 'archivado' | 'inexistente' (por nombre normalizado, con alias). Un archivado existe pero ya no se
  // ofrece en altas: los importadores lo distinguen de un nombre que no está en el catálogo.
  function estadoDe(nombre) {
    const entrada = window.CATALOGO_MATERIALES.find((m) => m.nombre === window.normalizarMaterial(nombre));
    if (!entrada) return 'inexistente';
    return entrada.activo === false ? 'archivado' : 'activo';
  }

  window.EVE_CATALOGO = { aplicar, validarExtension, buscar, listar, reglasDe, estadoDe, errores: [], PROCESOS_PIEZA, MAX_ALIAS };
  recalcularListasDerivadas();
})();

window.NOMBRE_PROCESO_UI = {
  SELECCION: 'Selección',
  EMPACADO: 'Empacado',
  MOLIENDA: 'Molienda',
  LAVADO: 'Lavado',
  PELETIZADO: 'Peletizado',
  PRODUCCION_CAJAS: 'Inyección',
  PRODUCCION_TAMBOS: 'Soplado',
  PRODUCCION_TAPONES: 'Producción de Tapones'
};
