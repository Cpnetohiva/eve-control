/* ==========================================
   EVE CONTROL v2.0 - CONFIGURATION
   Firebase, Telegram, y constantes del sistema
   ========================================== */

// ==========================================
// FIREBASE CONFIGURATION
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyCF_6UdCStIo2eq-BSDH-vHmSu6LvzX7gU",
    authDomain: "everplastic.firebaseapp.com",
    projectId: "everplastic",
    storageBucket: "everplastic.firebasestorage.app",
    messagingSenderId: "804807980304",
    appId: "1:804807980304:web:47466f961871958bef6195"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ==========================================
// TELEGRAM CONFIGURATION
// ==========================================
const TELEGRAM_BOT_TOKEN = '8065891283:AAGQaDZ-vqo0NSRt5a25szX9aiVtpG-l-eo';
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
