// Alerta y bloqueo de ticket repetido en Destaraje (js/destaraje.js: buscarTicketExistenteDestaraje, alta y edición;
// conflicto = mismo ticket con otro proveedor u otra fecha de entrada; mismo proveedor y fecha = trailer multi-material, se permite).
// Sin navegador: js/ reales en vm con un Firestore en memoria y un DOM mínimo.
// Uso: node scripts/verificar-destaraje-ticket-repetido.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/destaraje.js'];

function crearContexto(docs, opciones) {
  const consultas = [];
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem: () => null, setItem() {} },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { registrosDestaraje: [], cuentasPorPagar: [], auditorias: [] };
  sandbox.window.EVE_MODULES = {};
  const dbFalso = {
    collection: (nombre) => ({
      where: (campo, op, valor) => ({
        get: async () => {
          consultas.push({ nombre, campo, op, valor });
          if (opciones && opciones.fallar) throw new Error('sin conexión');
          const lista = docs.filter((d) => d[campo] === valor).map((d) => ({ id: d.id, data: () => { const { id, ...resto } = d; return resto; } }));
          return { forEach: (fn) => lista.forEach(fn) };
        }
      })
    })
  };
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  sandbox.window.db = dbFalso;
  sandbox.consultas = consultas;
  return sandbox.window;
}

const DOCS = [{ id: 'a1', ticket: '2370', proveedor: 'JUANA', material: 'MIXTO', kg: 510, fechaEntrada: '2026-11-09', fechaSalida: '2026-11-09' }];
const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${mensaje}: esperado ${b}, real ${a}`);
}

const BUSCAR = (w, ticket, proveedor, fecha, idExcluir) => w.buscarTicketExistenteDestaraje(ticket, proveedor, fecha, idExcluir === undefined ? null : idExcluir);

caso('mismo ticket + mismo proveedor + misma fecha + otro material: permite (trailer multi-material)', async () => {
  const w = crearContexto(DOCS);
  igual(await BUSCAR(w, '2370', 'juana', '2026-11-09'), null, 'otro material');
  igual(w.consultas, [{ nombre: 'destaraje', campo: 'ticket', op: '==', valor: '2370' }], 'consulta fresca a destaraje');
});
caso('mismo ticket + mismo proveedor + misma fecha + mismo material: permite', async () => {
  igual(await BUSCAR(crearContexto(DOCS), '2370', 'JUANA', '2026-11-09'), null, 'mismo material');
});
caso('mismo ticket + otro proveedor: bloquea', async () => {
  const r = await BUSCAR(crearContexto(DOCS), '2370', 'PEDRO', '2026-11-09');
  igual(r && r.id, 'a1', 'conflicto');
});
caso('mismo ticket + otra fecha: bloquea', async () => {
  const r = await BUSCAR(crearContexto(DOCS), '2370', 'JUANA', '2026-11-10');
  igual(r && r.id, 'a1', 'conflicto');
});
caso('ticket nuevo devuelve null', async () => {
  igual(await BUSCAR(crearContexto(DOCS), '9999', 'JUANA', '2026-11-09'), null, 'null');
});
caso('idExcluir ignora el propio documento', async () => {
  igual(await BUSCAR(crearContexto(DOCS), '2370', 'PEDRO', '2026-11-09', 'a1'), null, 'excluido');
});
caso("'V' y vacío no consultan", async () => {
  const w = crearContexto([{ id: 'v', ticket: 'V', proveedor: 'X', fechaEntrada: '2026-01-01' }]);
  igual(await BUSCAR(w, 'V', 'JUANA', '2026-11-09'), null, 'V');
  igual(await BUSCAR(w, '', 'JUANA', '2026-11-09'), null, 'vacio');
  igual(w.consultas.length, 0, 'sin consultas');
});
caso('mensaje con el formato pedido', async () => {
  const w = crearContexto(DOCS);
  igual(w.mensajeTicketRepetido('2370', DOCS[0]), 'El ticket 2370 ya existe con otro proveedor o fecha: 09/11/2026 - JUANA - MIXTO - 510 kg. Cambia el número de ticket para continuar.', 'mensaje');
});
caso('la consulta fallida lanza y ticketBloqueaGuardado bloquea avisando', async () => {
  const w = crearContexto(DOCS, { fallar: true });
  let msg = null;
  try { await BUSCAR(w, '2370', 'JUANA', '2026-11-09'); } catch (e) { msg = e.message; }
  igual(msg, 'sin conexión', 'error');
  const avisos = [];
  w.showError = (m) => avisos.push(m);
  igual(await w.ticketBloqueaGuardado({ ticket: '2370', proveedor: 'JUANA', fechaEntrada: '2026-11-09' }, null), true, 'bloquea');
  igual(avisos.length === 1 && avisos[0].startsWith('No se pudo verificar'), true, 'aviso');
});
caso('ticketBloqueaGuardado: multi-material permite y conflicto bloquea con un aviso', async () => {
  const w = crearContexto(DOCS);
  const avisos = [];
  w.showError = (m) => avisos.push(m);
  igual(await w.ticketBloqueaGuardado({ ticket: '2370', proveedor: 'JUANA', fechaEntrada: '2026-11-09' }, null), false, 'multi');
  igual(await w.ticketBloqueaGuardado({ ticket: '2370', proveedor: 'PEDRO', fechaEntrada: '2026-11-09' }, null), true, 'conflicto');
  igual(avisos.length, 1, 'un aviso');
});
caso('edición: solo valida si cambió el ticket; alta valida antes de guardar (por texto)', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'js/destaraje.js'), 'utf8');
  const alta = src.indexOf('ticketBloqueaGuardado(registro, null)');
  const guardar = src.indexOf("window.guardarDato('destaraje'");
  const cambio = src.indexOf('ticketCambio && await ticketBloqueaGuardado(registro, editandoId)');
  const escribir = src.indexOf('window.EVE_CXP.validarEdicionBascula(anterior');
  if (!(alta > 0 && alta < guardar)) throw new Error('alta sin validar antes de guardarDato');
  if (!(cambio > 0 && cambio < escribir)) throw new Error('edición sin validar (solo si cambia el ticket) antes de escribir');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`OK   ${nombre}`); } catch (e) { fallos++; console.log(`FALLA ${nombre}\n     ${e.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos`);
  process.exit(fallos ? 1 : 0);
})();
