// Firestore simulado para las verificaciones de Órdenes de Compra. La función es AUTOCONTENIDA (no usa nada de fuera): se
// importa en Node y también se inyecta como texto en Chromium (verificar-ordenes-compra-pantalla.js).
// Firestore mínimo: documentos por ruta con versión, get/set, consultas where/get y runTransaction con control optimista.
function crearDbSimulada() {
  const docs = new Map();
  const estadisticas = { reintentos: 0, fallarEn: null };
  let autoId = 0;
  const instantanea = (ruta) => {
    const doc = docs.get(ruta);
    return { exists: !!doc, id: ruta.split('/')[1], data: () => (doc ? JSON.parse(JSON.stringify(doc.datos)) : undefined), version: doc ? doc.version : 0 };
  };
  const escribir = (ruta, datos, opciones) => {
    const doc = docs.get(ruta);
    const base = opciones && opciones.merge && doc ? doc.datos : {};
    docs.set(ruta, { datos: { ...base, ...JSON.parse(JSON.stringify(datos)) }, version: (doc ? doc.version : 0) + 1 });
  };
  const ref = (ruta) => ({ ruta, id: ruta.split('/')[1], get: async () => instantanea(ruta), set: async (datos, opciones) => escribir(ruta, datos, opciones) });
  const consulta = (nombre, filtros) => ({
    where: (campo, op, valor) => consulta(nombre, [...filtros, [campo, op, valor]]),
    get: async () => {
      const resultado = Array.from(docs.keys()).filter((ruta) => ruta.startsWith(`${nombre}/`)).map(instantanea)
        .filter((s) => filtros.every(([campo, op, valor]) => (op === '>=' ? s.data()[campo] >= valor : op === '<=' ? s.data()[campo] <= valor : s.data()[campo] === valor)));
      return { docs: resultado, forEach: (fn) => resultado.forEach(fn), size: resultado.length };
    }
  });
  return {
    docs,
    estadisticas,
    collection: (nombre) => ({ doc: (id) => ref(`${nombre}/${id === undefined ? `auto${++autoId}` : id}`), where: (...args) => consulta(nombre, []).where(...args), get: () => consulta(nombre, []).get() }),
    async runTransaction(fn) {
      for (let intento = 0; intento < 5; intento++) {
        const lecturas = new Map();
        const escrituras = [];
        const tx = {
          async get(r) { const s = instantanea(r.ruta); lecturas.set(r.ruta, s.version); await Promise.resolve(); return s; },
          set(r, datos, opciones) { escrituras.push([r.ruta, datos, opciones]); },
          delete(r) { escrituras.push([r.ruta, null, { borrar: true }]); }
        };
        const resultado = await fn(tx);
        const choque = Array.from(lecturas).some(([ruta, version]) => (docs.has(ruta) ? docs.get(ruta).version : 0) !== version);
        if (choque) { estadisticas.reintentos++; continue; }
        // Todo o nada: si una escritura falla al confirmar, no se aplica ninguna.
        if (estadisticas.fallarEn && escrituras.some(([ruta]) => ruta.startsWith(estadisticas.fallarEn))) throw new Error('fallo simulado al confirmar');
        escrituras.forEach(([ruta, datos, opciones]) => (opciones && opciones.borrar ? docs.delete(ruta) : escribir(ruta, datos, opciones)));
        return resultado;
      }
      throw new Error('Transacción abortada por contención');
    }
  };
}

module.exports = { crearDbSimulada };
