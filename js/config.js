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
  INVENTARIO_INICIAL: 'inventario_inicial'
};

window.MATERIALES_COMUNES = [
  'BIDON', 'CRISTAL CON ETIQUETA', 'CRISTAL SIN ETIQUETA', 'CRISTAL CON LECHERO',
  'CRISTAL CON VERDE', 'DURO', 'LECHERO', 'LECHERO MOLIDO', 'LLANTA', 'MIXTO', 'MIXTO 2',
  'MULTI-COLOR', 'MULTILECHERO', 'P.E.', 'P.E. MOLIDO', 'P.P.', 'P.P MOLIDO',
  'SUERO', 'VERDE'
];

window.MATERIALES_ALIAS = {
  'CRISTAL CON ETIQ': 'CRISTAL CON ETIQUETA',
  'CRISTAL SIN ETIQ': 'CRISTAL SIN ETIQUETA',
  'MULTI-LECHERO': 'MULTILECHERO',
  'MIXTO2': 'MIXTO 2',
  'MULTICOLOR': 'MULTI-COLOR',
  'GARRAFA': 'BIDON',
  'PEAD': 'DURO',
  'P.E..': 'P.E.'
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

window.MATERIALES_PZ = ['TAMBO', 'CAJA CO30', 'CAJA CH25', 'CAJA AGRO20'];

window.PROVEEDORES_COMUNES = [
  'JOSE ENRIQUE', 'JUANA', 'FRANCISCO',
  'FELIX LOZANO', 'ARTURO LARA', 'OLEGARIO', 'JESÚS'
];

window.NOMBRE_PROCESO_UI = {
  SELECCION: 'Selección',
  EMPACADO: 'Empacado',
  MOLIENDA: 'Molienda',
  LAVADO: 'Lavado',
  PELETIZADO: 'Peletizado',
  PRODUCCION_CAJAS: 'Inyección',
  PRODUCCION_TAMBOS: 'Soplado'
};
