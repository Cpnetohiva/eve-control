// Verifica la fecha del recibo de pago: "DD/MM/AAAA HH:mm" (24 h, zona México) con la hora de registro guardada en
// recibo.timestamp; solo la fecha cuando no hay hora guardada o cuando el pago se capturó con una fecha distinta al día de registro.
// Además comprueba que el PDF final imprime ese texto y que el recibo pendiente (preliminar) sigue con solo la fecha.
//
// Uso: node scripts/verificar-hora-recibo.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById() { return null; } },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { registrosDestaraje: [], cuentasPorPagar: [], auditorias: [] };
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
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    throw new Error(`${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
  }
}

caso('con hora guardada del mismo día: DD/MM/AAAA HH:mm en 24 h, hora de México', () => {
  const w = crearContexto();
  // 20:45 UTC = 14:45 en México (UTC-6)
  igual(w.EVE_CXP.textoFechaRecibo({ fecha: '2026-10-17', timestamp: '2026-10-17T20:45:10.000Z' }), '17/10/2026 14:45', 'tarde');
  igual(w.EVE_CXP.textoFechaRecibo({ fecha: '2026-10-17', timestamp: '2026-10-17T06:05:00.000Z' }), '17/10/2026 00:05', 'medianoche no sale como 24:05');
});

caso('la zona horaria es la de México, no la del UTC: 03:30 UTC del 17 es 21:30 del 16', () => {
  const w = crearContexto();
  igual(w.EVE_CXP.textoFechaRecibo({ fecha: '2026-10-16', timestamp: '2026-10-17T03:30:00.000Z' }), '16/10/2026 21:30', 'hora mexicana');
});

caso('sin hora guardada (recibo anterior o timestamp inválido): solo la fecha, sin inventar hora', () => {
  const w = crearContexto();
  igual(w.EVE_CXP.textoFechaRecibo({ fecha: '2026-10-17' }), '17/10/2026', 'sin timestamp');
  igual(w.EVE_CXP.textoFechaRecibo({ fecha: '2026-10-17', timestamp: 'no es fecha' }), '17/10/2026', 'timestamp inválido');
});

caso('pago con fecha distinta al día de registro: la hora es de otro día, solo la fecha', () => {
  const w = crearContexto();
  igual(w.EVE_CXP.textoFechaRecibo({ fecha: '2026-10-10', timestamp: '2026-10-17T20:45:10.000Z' }), '10/10/2026', 'fecha atrasada');
});

caso('el PDF final imprime la fecha con hora; el preliminar solo la fecha; el resto del contenido no cambia', () => {
  const w = crearContexto();
  const textos = [];
  const doc = new Proxy({}, {
    get: (_, nombre) => {
      if (nombre === 'internal') return { pageSize: { getWidth: () => 210 } };
      if (nombre === 'text') return (t) => { textos.push(String(t)); };
      if (nombre === 'lastAutoTable') return { finalY: 100 };
      return () => {};
    }
  });
  w.jspdf = { jsPDF: function () { return doc; } };
  const base = {
    proveedor: 'JUANA', fecha: '2026-10-17', formaPago: 'transferencia', totalPago: 150, referenciaTransferencia: 'R1',
    tickets: [{ ticket: '1', material: 'PET', kg: 10, precio: 15, monto: 150, saldo: 0 }]
  };
  w.EVE_CXP.generarPDFRecibo({ ...base, timestamp: '2026-10-17T20:45:10.000Z' }, true);
  afirmar(textos.includes('Fecha: 17/10/2026 14:45'), `fecha con hora no encontrada: ${JSON.stringify(textos)}`);
  afirmar(textos.includes('Proveedor: JUANA') && textos.includes('Forma de pago: Transferencia') && textos.includes('TOTAL: $150.00'), 'resto del contenido');
  textos.length = 0;
  w.EVE_CXP.generarPDFRecibo({ ...base, timestamp: undefined }, true);
  afirmar(textos.includes('Fecha: 17/10/2026'), 'recibo final sin hora guardada: solo fecha');
  textos.length = 0;
  w.EVE_CXP.generarPDFRecibo({ ...base, timestamp: '2026-10-17T20:45:10.000Z' });
  afirmar(textos.includes('Fecha: 17/10/2026'), 'preliminar (sin firma ni transferencia final): solo fecha');
});

let fallos = 0;
for (const { nombre, fn } of casos) {
  try { fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message}`); }
}
console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos ? 1 : 0);
