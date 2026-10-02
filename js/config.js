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

// Catálogo único de materiales. Cada entrada: { nombre, unidad, seObtieneEnProduccion } más dos banderas
// opcionales, ambas true por omisión:
//   recibible          — se puede recibir/comprar (Báscula, Precios, Pagos). false: solo existe como salida de proceso.
//   requiereSeleccion  — un material KG crudo que pasa por Selección antes de poder procesarse. false: molidos,
//                        pellets, MATERIAL VIRGEN y piezas (no se reciben ni se seleccionan).
// El ORDEN de las entradas es el orden en que se listan los materiales en toda la app.
const K = 'KG';
const PZ = 'PZ';
window.CATALOGO_MATERIALES = [
  { nombre: 'BIDON', unidad: K, seObtieneEnProduccion: false },
  { nombre: 'CRISTAL CON ETIQUETA', unidad: K, seObtieneEnProduccion: false },
  { nombre: 'CRISTAL SIN ETIQUETA', unidad: K, seObtieneEnProduccion: false },
  { nombre: 'CRISTAL CON LECHERO', unidad: K, seObtieneEnProduccion: false },
  { nombre: 'CRISTAL CON VERDE', unidad: K, seObtieneEnProduccion: false },
  // Crudo polipropileno: se compra, pasa por Selección y se descompone en P.P. y P.E. más BASURA.
  // No sale de proceso y NO se muele como DURO.
  { nombre: 'DURO', unidad: K, seObtieneEnProduccion: false },
  { nombre: 'LECHERO', unidad: K, seObtieneEnProduccion: true },
  { nombre: 'LECHERO MOLIDO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'MIXTO', unidad: K, seObtieneEnProduccion: false },
  { nombre: 'MIXTO 2', unidad: K, seObtieneEnProduccion: false },
  // Se recibe; al seleccionarse produce P.E.
  { nombre: 'MULTI-COLOR', unidad: K, seObtieneEnProduccion: false },
  // Se recibe, con composición propia.
  { nombre: 'MULTILECHERO', unidad: K, seObtieneEnProduccion: false },
  { nombre: 'P.E.', unidad: K, seObtieneEnProduccion: true },
  { nombre: 'P.E. MOLIDO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'P.P.', unidad: K, seObtieneEnProduccion: true },
  { nombre: 'P.P. MOLIDO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'PET', unidad: K, seObtieneEnProduccion: false },
  { nombre: 'SUERO', unidad: K, seObtieneEnProduccion: true },
  { nombre: 'VERDE', unidad: K, seObtieneEnProduccion: false },
  // Salen de PELETIZADO con inputs P.E. MOLIDO, P.P. MOLIDO, BIDON MOLIDO y LECHERO MOLIDO.
  { nombre: 'PELLET TAMBO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'PELLET CAJAS', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'PELLET AGRO20', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  // Ninguno sale de proceso: se compra limpio y se consume directo desde RECEPCION.
  { nombre: 'MATERIAL VIRGEN', unidad: K, seObtieneEnProduccion: false, requiereSeleccion: false },
  // Resultado de seleccionar PET: se reciben (todo material KG es recibible) y siempre pasan por Selección.
  { nombre: 'PET CRISTAL', unidad: K, seObtieneEnProduccion: true },
  { nombre: 'PET ETIQUETA', unidad: K, seObtieneEnProduccion: true },
  { nombre: 'PET VERDE', unidad: K, seObtieneEnProduccion: true },
  // Molidos y peletizados nuevos (salen de MOLIENDA / PELETIZADO; no se reciben ni se seleccionan).
  { nombre: 'BIDON MOLIDO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'SUERO MOLIDO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'SUERO PELETIZADO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'P.P. PELETIZADO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'P.E. PELETIZADO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'LECHERO PELETIZADO', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  // Sale de PELETIZADO. PRODUCCION_TAPONES (TAPON, ORING, SELLO) consume PELLET TAPON o MATERIAL VIRGEN
  // y el operador elige cuál; no tiene rechazo recuperable definido.
  { nombre: 'PELLET TAPON', unidad: K, seObtieneEnProduccion: true, requiereSeleccion: false },
  // Rechazos: merma recuperable que se consume en MOLIENDA. No se compran ni llevan precio
  // (recibible=false: no entran a Báscula, Precios, Pagos ni a sus importadores). El rechazo se DERIVA del
  // producto, no lo elige el operador:
  //   CAJA CO30 y CAJA CH25 (PELLET CAJAS, PE)  -> RECHAZO CAJAS P.E.   (PRODUCCION_CAJAS, etapa INYECCION)
  //   CAJA AGRO20 (PELLET AGRO20, PP)           -> RECHAZO CAJAS P.P.   (PRODUCCION_CAJAS, etapa INYECCION)
  //   TAMBO (PELLET TAMBO, mezcla de HDPE)      -> RECHAZO TAMBOS       (PRODUCCION_TAMBOS, etapa SOPLADO)
  { nombre: 'RECHAZO CAJAS P.E.', unidad: K, seObtieneEnProduccion: true, recibible: false, requiereSeleccion: false },
  { nombre: 'RECHAZO CAJAS P.P.', unidad: K, seObtieneEnProduccion: true, recibible: false, requiereSeleccion: false },
  { nombre: 'RECHAZO TAMBOS', unidad: K, seObtieneEnProduccion: true, recibible: false, requiereSeleccion: false },
  { nombre: 'TAMBO', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'CAJA CO30', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'CAJA CH25', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'CAJA AGRO20', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'ORING', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'SELLO', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false },
  { nombre: 'TAPON', unidad: PZ, seObtieneEnProduccion: true, requiereSeleccion: false }
];

// Listas derivadas del catálogo. MATERIALES_COMUNES = materiales KG que se pueden recibir.
window.MATERIALES_COMUNES = window.CATALOGO_MATERIALES
  .filter((m) => m.unidad === 'KG' && m.recibible !== false)
  .map((m) => m.nombre);

// Materiales recibibles que NO se compran habitualmente (se producen más que se compran): sin precio vigente no
// alarman en Precios, solo se listan como informativos. Todo OTRO material recibible sin precio alarma (los que
// se compran a diario, P.E. MOLIDO y MATERIAL VIRGEN que se reciben de vez en cuando y, por omisión, cualquier
// material nuevo que se agregue al catálogo). Esta lista es EDITABLE: agregar o quitar un nombre mueve ese
// material entre los dos grupos del aviso "Materiales del catálogo sin precio vigente".
window.MATERIALES_SIN_PRECIO_NO_HABITUAL = [
  'PET CRISTAL', 'PET ETIQUETA', 'PET VERDE',
  'PELLET TAMBO', 'PELLET CAJAS', 'PELLET AGRO20', 'PELLET TAPON',
  'BIDON MOLIDO', 'SUERO MOLIDO', 'SUERO PELETIZADO', 'P.P. PELETIZADO', 'P.E. PELETIZADO', 'LECHERO PELETIZADO'
];

// Materiales que salen de un proceso (candidatos a output).
window.materialesProducibles = function () {
  return window.CATALOGO_MATERIALES.filter((m) => m.seObtieneEnProduccion).map((m) => m.nombre);
};

// Todo material que puede tener existencias: lo que se recibe más lo que se produce (KG y PZ).
window.materialesConStock = function () {
  return window.CATALOGO_MATERIALES.map((m) => m.nombre);
};

// Materiales KG crudos que deben pasar por Selección.
window.materialesQueRequierenSeleccion = function () {
  return window.CATALOGO_MATERIALES
    .filter((m) => m.unidad === 'KG' && m.requiereSeleccion !== false)
    .map((m) => m.nombre);
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

window.MATERIALES_PZ = window.CATALOGO_MATERIALES.filter((m) => m.unidad === 'PZ').map((m) => m.nombre);

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
