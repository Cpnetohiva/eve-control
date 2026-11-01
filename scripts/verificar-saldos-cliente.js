// Verifica la capa de datos de saldos_cliente (js/saldos-cliente.js) con un Firestore simulado en memoria.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
let ok = 0, total = 0;
function afirmar(c, m) { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; }
async function caso(nombre, fn) {
  try { await fn(); console.log('ok   ' + nombre); } catch (e) { total++; process.exitCode = 1; console.error('FALLA ' + nombre + ': ' + e.message); }
}
async function rechaza(promesa, texto, m) {
  try { await promesa; afirmar(false, m + ' (no lanzó error)'); } catch (e) { afirmar(e.message.includes(texto), `${m}: "${e.message}"`); }
}

function crearEntorno() {
  const store = new Map(); // id -> datos
  let contador = 0;
  const historial = [];
  const copia = (o) => JSON.parse(JSON.stringify(o));
  const ref = (id) => ({ id });
  const db = {
    collection: () => ({
      doc: (id) => ref(id),
      where: (campo, _op, valor) => ({
        get: async () => ({ docs: [...store.entries()].filter(([, d]) => d[campo] === valor).map(([id, d]) => ({ id, data: () => copia(d) })) })
      })
    }),
    runTransaction: async (fn) => {
      const tx = {
        get: async (r) => ({ exists: store.has(r.id), data: () => copia(store.get(r.id)) }),
        update: (r, cambios) => { store.set(r.id, { ...store.get(r.id), ...copia(cambios) }); }
      };
      return fn(tx);
    }
  };
  const window = {
    COLECCIONES: { SALDOS_CLIENTE: 'saldos_cliente' },
    EVE: { saldosCliente: [], currentUser: { username: 'tester' } },
    EVE_HISTORIAL: { registrar: async (e) => { historial.push(e); } },
    db,
    obtenerFechaMexico: () => '2026-11-01',
    guardarDato: async (_c, datos) => { const id = 's' + (++contador); store.set(id, copia(datos)); return id; }
  };
  const ctx = { window, console, JSON, Date, Math, Number, Array, Map, Error };
  vm.createContext(ctx);
  vm.runInContext(leer('js/saldos-cliente.js'), ctx);
  return { S: window.EVE_SALDOS_CLIENTE, window, store, historial };
}

(async () => {
  await caso('crear, disponible y agrupación por cliente (normalizador de Ventas)', async () => {
    const { S, window, store, historial } = crearEntorno();
    const id1 = await S.crearSaldoCliente({ cliente: '  acme  sa ', monto: 1696, origen: 'cobro_sobrante', folio: 'V-2026-053', grupoPagoId: 'g1' });
    const id2 = await S.crearSaldoCliente({ cliente: 'ACME SA', monto: 100.5, fecha: '2026-10-01', nota: 'ajuste' });
    afirmar(store.get(id1).cliente === 'ACME SA' && store.get(id1).revertido === false, 'cliente normalizado y revertido=false');
    afirmar(window.EVE.saldosCliente.length === 2, 'queda en window.EVE.saldosCliente');
    afirmar(historial.filter((h) => h.accion === 'alta').length === 2, 'altas en historial');
    const filas = S.saldoPorCliente(window.EVE.saldosCliente);
    afirmar(filas.length === 1 && filas[0].disponible === 1796.5, 'un cliente con 1796.50');
    afirmar(filas[0].fechaMasAntigua === '2026-10-01', 'fecha más antigua');
    await rechaza(S.crearSaldoCliente({ cliente: 'X', monto: 0 }), 'mayor a 0', 'monto 0');
    await rechaza(S.crearSaldoCliente({ cliente: '', monto: 5 }), 'cliente', 'sin cliente');
    await rechaza(S.crearSaldoCliente({ cliente: 'X', monto: 5, origen: 'otro' }), 'Origen', 'origen inválido');
    afirmar(id2 !== id1, 'ids distintos');
  });

  await caso('aplicar: lectura fresca, rechaza exceso y revertidos', async () => {
    const { S, window, store, historial } = crearEntorno();
    const id = await S.crearSaldoCliente({ cliente: 'ACME', monto: 1000 });
    // Otra sesión aplicó 700 en Firestore sin que la memoria lo sepa.
    store.set(id, { ...store.get(id), aplicaciones: [{ aplicacionId: 'x', monto: 700, fecha: '2026-11-01', cobroId: 'c0', folio: 'V-1' }] });
    await rechaza(S.aplicarSaldoCliente(id, 400, 'c1', 'V-2'), 'mayor al saldo', 'valida contra Firestore, no memoria');
    const ap = await S.aplicarSaldoCliente(id, 300, 'c1', 'V-2');
    afirmar(ap.monto === 300 && ap.cobroId === 'c1' && ap.folio === 'V-2' && ap.aplicacionId, 'aplicación completa');
    afirmar(store.get(id).aplicaciones.length === 2 && S.saldoDisponible(store.get(id)) === 0, 'disponible 0');
    afirmar(historial.some((h) => h.accion === 'aplicacion'), 'historial de aplicación');
    await rechaza(S.aplicarSaldoCliente(id, 0, 'c2', 'V-3'), 'mayor a 0', 'monto 0');
    const id2 = await S.crearSaldoCliente({ cliente: 'ACME', monto: 50 });
    store.set(id2, { ...store.get(id2), revertido: true });
    await rechaza(S.aplicarSaldoCliente(id2, 10, 'c3', 'V-4'), 'revertido', 'saldo revertido');
    await rechaza(S.aplicarSaldoCliente('no-existe', 10, 'c3', 'V-4'), 'no existe', 'inexistente');
    afirmar(S.saldoDisponible(store.get(id2)) === 0, 'revertido = 0 disponible');
  });

  await caso('quitarAplicacion devuelve el monto al saldo', async () => {
    const { S, window, store, historial } = crearEntorno();
    const id = await S.crearSaldoCliente({ cliente: 'ACME', monto: 500 });
    await S.aplicarSaldoCliente(id, 200, 'c1', 'V-1');
    await S.aplicarSaldoCliente(id, 100, 'c2', 'V-2');
    await S.quitarAplicacion(id, 'c1');
    afirmar(S.saldoDisponible(store.get(id)) === 400, 'disponible 400');
    afirmar(window.EVE.saldosCliente[0].aplicaciones.length === 1, 'memoria actualizada');
    afirmar(historial.some((h) => h.accion === 'quitar_aplicacion'), 'historial');
    await rechaza(S.quitarAplicacion(id, 'c1'), 'aplicación', 'ya no existe la aplicación');
  });

  await caso('revertirSaldoPorGrupo: revierte sin aplicaciones y bloquea con ellas', async () => {
    const { S, store, historial } = crearEntorno();
    const libre = await S.crearSaldoCliente({ cliente: 'A', monto: 100, origen: 'cobro_sobrante', grupoPagoId: 'g1' });
    const r1 = await S.revertirSaldoPorGrupo('g1', 'Cobro corregido');
    afirmar(r1.ok === true && r1.revertidos === 1 && store.get(libre).revertido === true, 'revierte sin aplicaciones');
    afirmar(historial.some((h) => h.accion === 'reversion'), 'historial de reversión');
    afirmar(store.has(libre), 'no se borra el documento');
    const usado = await S.crearSaldoCliente({ cliente: 'A', monto: 100, origen: 'cobro_sobrante', grupoPagoId: 'g2' });
    await S.aplicarSaldoCliente(usado, 40, 'c9', 'V-9');
    const r2 = await S.revertirSaldoPorGrupo('g2', 'x');
    afirmar(r2.ok === false && r2.error === 'Este saldo ya se aplicó a una venta; revierte primero esa aplicación.', 'mensaje exacto de bloqueo: ' + r2.error);
    afirmar(store.get(usado).revertido === false, 'no revierte si tiene aplicaciones');
    const r3 = await S.revertirSaldoPorGrupo('sin-saldo', 'x');
    afirmar(r3.ok === true && r3.revertidos === 0, 'grupo sin saldo: no hace nada');
  });

  await caso('integración: colección, carga solo CxC/Flujo, reglas, index y APP_SHELL', async () => {
    afirmar(/SALDOS_CLIENTE: 'saldos_cliente'/.test(leer('js/config.js')), 'COLECCIONES.SALDOS_CLIENTE');
    const auth = leer('js/auth.js');
    const linea = auth.split(/\r?\n/).find((l) => l.includes("campo: 'saldosCliente'")) || '';
    afirmar(linea.includes("modulo: 'cxc'") && linea.includes("tambienLeen: ['flujo']"), 'CARGAS_MODULO solo cxc y flujo');
    afirmar(auth.includes('window.EVE.saldosCliente = datos.saldosCliente;') && auth.includes('window.EVE.saldosCliente = [];'), 'carga y limpieza en window.EVE');
    const bloque = (leer('firestore.rules').match(/match \/saldos_cliente\/\{docId\} \{([^}]*)\}/) || [])[1] || '';
    afirmar(bloque.includes("allow read: if puedeLeer('cxc') || puedeLeer('flujo');") && bloque.includes("allow write: if puedeEscribir('cxc');"), 'bloque de reglas');
    afirmar(leer('index.html').includes('<script src="js/saldos-cliente.js"></script>'), 'index.html');
    afirmar(leer('service-worker.js').includes("'js/saldos-cliente.js'"), 'APP_SHELL');
    afirmar(!/saldos_cliente/.test(leer('rules-test/firestore.rules')), 'rules-test/firestore.rules intacto');
  });

  console.log(`${ok}/${total} verificaciones`);
})();
