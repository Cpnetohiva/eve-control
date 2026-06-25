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
  PRODUCCION: 'produccion',
  PAGOS: 'pagos',
  MINISTRACIONES: 'ministraciones',
  CONTROL_PRODUCCION: 'control_produccion',
  CONFIG: 'config'
};

window.MATERIALES_COMUNES = [
  'MIXTO', 'MIXTO 2', 'PET', 'PET CRISTAL', 'PET COLOR',
  'MULTICOLOR', 'PELETIZADO', 'LECHERO LAVADO', 'LECHERO MOLIDO',
  'PP MOLIDO', 'PACAS CRISTAL CON ETIQUETA', 'PEAD',
  'TAMBO', 'CAJA CO30'
];

window.MATERIALES_PZ = ['TAMBO', 'CAJA CO30'];

window.PROVEEDORES_COMUNES = [
  'JOSE ENRIQUE', 'JUANA', 'FRANCISCO',
  'FELIX LOZANO', 'ARTURO LARA', 'OLEGARIO', 'JESUS'
];
