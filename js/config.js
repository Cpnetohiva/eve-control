/* ==========================================
   EVE CONTROL v2.0 - CONFIGURATION
   Firebase, Telegram, y constantes del sistema
   ========================================== */

// ==========================================
// FIREBASE CONFIGURATION
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyDhEcqZQ-YgjuwVF9EhQTIBWa1PVHhx_1s",
    authDomain: "control-evecontrol.firebaseapp.com",
    projectId: "control-evecontrol",
    storageBucket: "control-evecontrol.firebasestorage.app",
    messagingSenderId: "568399653296",
    appId: "1:568399653296:web:f5af6c9e7b23e4aff72bdf"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ==========================================
// TELEGRAM CONFIGURATION
// ==========================================
const TELEGRAM_BOT_TOKEN = '8180690479:AAH5bq8ZbhKo2ZMt8H4csCgVEuGgJJXjxjI';
const TELEGRAM_CHAT_ID = '8687896128';

// ==========================================
// COLLECTIONS
// ==========================================
const COLLECTIONS = {
    USERS: 'users',
    DESTARAJE: 'destaraje',
    PRODUCCION: 'produccion',
    PAGOS: 'pagos',
    MINISTRACIONES: 'ministraciones'
};

// ==========================================
// MODULES CONFIGURATION
// ==========================================
const MODULES = {
    DESTARAJE: {
        id: 'destaraje',
        name: 'Destaraje y Ventas',
        icon: '📦',
        permission: 'permDestaraje'
    },
    PRODUCCION: {
        id: 'produccion',
        name: 'Producción',
        icon: '🏭',
        permission: 'permProduccion'
    },
    PAGOS: {
        id: 'pagos',
        name: 'Pagos',
        icon: '💰',
        permission: 'permPagos'
    },
    REPORTES: {
        id: 'reportes',
        name: 'Reportes',
        icon: '📊',
        permission: 'permReportes'
    }
};

// ==========================================
// MATERIALES (Autocompletado)
// ==========================================
const MATERIALES_COMUNES = [
    'PET Cristal',
    'PET Color',
    'PET Mixto',
    'PEAD',
    'PP',
    'Bolsa',
    'Film',
    'Rafia',
    'Costal',
    'Garrafón',
    'Tambor',
    'Mezclado'
];

// ==========================================
// PROVEEDORES (Autocompletado)
// ==========================================
const PROVEEDORES_COMUNES = [
    'Francisco',
    'Juan',
    'Pedro',
    'Luis',
    'Carlos',
    'Miguel',
    'José',
    'Antonio'
];

// ==========================================
// CLIENTES (Autocompletado para Destaraje)
// ==========================================
const CLIENTES_COMUNES = [
    'Cliente A',
    'Cliente B',
    'Cliente C',
    'Exportación',
    'Nacional'
];

// ==========================================
// GLOBAL STATE
// ==========================================
window.EVE = {
    currentUser: null,
    registrosDestaraje: [],
    registrosProduccion: [],
    registrosPagos: [],
    registrosMinistraciones: [],
    usuarios: []
};

console.log('✅ EVE Control v2.0 - Config cargado');
