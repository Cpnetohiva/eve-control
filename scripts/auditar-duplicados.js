// Auditoría de posibles duplicados (SOLO LECTURA). Se PEGA en la consola del navegador con la sesión de EVE Control iniciada
// (F12 → Consola → pegar todo este archivo → Enter). No es parte de la app y no se carga desde index.html.
//
// Qué hace: recorre ventas, pagos, cobros, gastos, recibos de dinero y órdenes de compra buscando PARES de registros que cumplan la
// misma regla de la alerta de captura (window.detectarPosibleDuplicado de js/utils.js: 4 o más campos independientes iguales; en pagos,
// también ticket + proveedor + material), aunque tengan folio distinto. Imprime una tabla por colección y deja el resultado completo
// como JSON en la consola, en window.__auditoriaDuplicados y, si existe, con copy().
//
// No escribe ni borra nada: no llama a guardarDato, actualizarDato ni eliminarDato, y solo usa lecturas (.get()) si activas
// LEER_DE_FIRESTORE. Por defecto compara los datos que la app ya cargó en memoria al iniciar sesión (colecciones completas, sin lecturas
// nuevas a Firestore). Solo quita, mientras corre, la ventana de «últimos 30 días» de la alerta (para auditar todo el histórico) y la
// restituye al terminar. Los registros revertidos, eliminados y cancelados se ignoran, igual que en la alerta.
(async function auditarDuplicados() {
  const LEER_DE_FIRESTORE = false; // true = vuelve a leer cada colección de Firestore (cuesta una lectura por documento)

  if (typeof window.detectarPosibleDuplicado !== 'function' || !window.EVE || !window.EVE.currentUser) {
    console.error('Auditoría de duplicados: abre EVE Control, inicia sesión y vuelve a pegar el script.');
    return;
  }

  const MODULOS = [
    { modulo: 'ventas', coleccion: 'ventas', memoria: () => window.EVE.ventas },
    { modulo: 'pagos', coleccion: 'pagos', memoria: () => window.EVE.registrosPagos },
    { modulo: 'cobros', coleccion: 'cobros', memoria: () => window.EVE.cobros },
    { modulo: 'gastos', coleccion: 'gastos', memoria: () => window.EVE.gastos },
    { modulo: 'recibos', coleccion: 'recibos_dinero', memoria: () => window.EVE.recibosDinero },
    { modulo: 'oc', coleccion: 'ordenes_compra', memoria: () => window.EVE.ordenesCompra }
  ];

  const norm = (v) => String(v === undefined || v === null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const nombreDe = (v) => (v && typeof v === 'object' ? v.nombre : v);
  const excluido = (r) => !r || r.revertido === true || r.eliminado === true || /^cancelad/i.test(String(r.estado || ''));

  // Para no comparar todos contra todos (en pagos serían millones de pares) se agrupan los registros por pocos campos «bloque». Un par que
  // coincide en 4 o más de N campos coincide por fuerza en al menos uno de cualquier conjunto de N-3 campos, así que no se pierde ningún par.
  const BLOQUES = {
    ventas: [(r) => r.fecha, (r) => r.cliente],
    pagos: [(r) => r.fecha, (r) => r.proveedor, (r) => r.ticket],
    cobros: [(r) => r.fecha, (r) => r.cliente],
    gastos: [(r) => r.fecha, (r) => r.beneficiario],
    recibos: [(r) => r.fecha, (r) => nombreDe(r.cliente)],
    oc: [(r) => r.fecha]
  };

  // Un cobro de CxC se reparte en un documento por partida (mismo grupoPagoId): se audita cada grupo como UN cobro con la suma.
  function agruparCobros(lista) {
    const grupos = new Map();
    lista.filter((c) => !excluido(c)).forEach((c) => {
      const clave = c.grupoPagoId || c.id;
      if (!grupos.has(clave)) grupos.set(clave, { ...c, id: c.id, grupoPagoId: clave, pagado: 0, _ids: [], _folios: new Set() });
      const g = grupos.get(clave);
      g.pagado += Number(c.pagado) || 0;
      g._ids.push(c.id);
      if (c.folio) g._folios.add(c.folio);
    });
    return Array.from(grupos.values()).map((g) => ({ ...g, folio: g._folios.size === 1 ? Array.from(g._folios)[0] : '' }));
  }

  async function obtenerRegistros({ modulo, coleccion, memoria }) {
    if (LEER_DE_FIRESTORE) {
      const snapshot = await window.db.collection(coleccion).get();
      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    return (memoria() || []).filter((r) => !String(r.id || '').startsWith('offline_'));
  }

  const identificador = (r) => (r._ids && r._ids.length > 1 ? r._ids.join('+') : r.id);
  const folioDe = (r) => r.folio || r.ticket || '';
  const etiquetaFecha = (r) => r.fecha || '';

  const inicioOriginal = window.obtenerInicioUltimos30Dias;
  const resultado = { generadoEn: new Date().toISOString(), fuente: LEER_DE_FIRESTORE ? 'Firestore (lecturas)' : 'memoria de la app (sin lecturas nuevas)', total: 0, colecciones: {} };
  try {
    // Sin la ventana de 30 días la alerta compara todo el histórico (solo mientras corre esta auditoría).
    window.obtenerInicioUltimos30Dias = () => '0000-01-01';

    for (const definicion of MODULOS) {
      const { modulo, coleccion } = definicion;
      let registros = (await obtenerRegistros(definicion)).filter((r) => !excluido(r));
      if (modulo === 'cobros') registros = agruparCobros(registros);

      // Índice de bloques → posiciones
      const indice = new Map();
      registros.forEach((registro, posicion) => {
        BLOQUES[modulo].forEach((extraer, n) => {
          const valor = norm(extraer(registro));
          if (!valor) return;
          const clave = n + '|' + valor;
          if (!indice.has(clave)) indice.set(clave, []);
          indice.get(clave).push(posicion);
        });
      });

      const vistos = new Set();
      const pares = [];
      let comparados = 0;
      let cuenta = 0;
      for (const posiciones of indice.values()) {
        for (let a = 0; a < posiciones.length; a++) {
          for (let b = a + 1; b < posiciones.length; b++) {
            const i = Math.min(posiciones[a], posiciones[b]);
            const j = Math.max(posiciones[a], posiciones[b]);
            const llave = i * registros.length + j;
            if (vistos.has(llave)) continue;
            vistos.add(llave);
            comparados++;
            const A = registros[i];
            const B = registros[j];
            const duplicado = window.detectarPosibleDuplicado(modulo, A, [B]);
            if (duplicado) {
              pares.push({
                modulo,
                coleccion,
                idA: identificador(A), idB: identificador(B),
                folioA: folioDe(A), folioB: folioDe(B),
                fechaA: etiquetaFecha(A), fechaB: etiquetaFecha(B),
                coincidencias: duplicado.coincidencias.join(', '),
                camposCoincidentes: duplicado.coincidencias.length,
                directa: duplicado.directa,
                fechaRegistroA: A.fechaRegistro || '', fechaRegistroB: B.fechaRegistro || '',
                capturoA: A.registradoPor || A.creadoPor || A.usuario || '', capturoB: B.registradoPor || B.creadoPor || B.usuario || ''
              });
            }
            // cede el hilo de vez en cuando para que la página no se congele
            if (++cuenta % 20000 === 0) await new Promise((resolver) => setTimeout(resolver, 0));
          }
        }
      }
      pares.sort((x, y) => (y.camposCoincidentes - x.camposCoincidentes) || String(y.fechaA).localeCompare(String(x.fechaA)));
      resultado.colecciones[modulo] = { coleccion, registrosRevisados: registros.length, paresComparados: comparados, paresEncontrados: pares.length, pares };
      resultado.total += pares.length;

      console.group(`${modulo} (${coleccion}): ${registros.length} registros revisados, ${pares.length} par(es) con posible duplicado`);
      if (pares.length > 0) {
        console.table(pares.map((p) => ({
          modulo: p.modulo, ids: `${p.idA}  ↔  ${p.idB}`, folios: `${p.folioA || '—'}  ↔  ${p.folioB || '—'}`, fechas: `${p.fechaA}  ↔  ${p.fechaB}`,
          coinciden: p.coincidencias + (p.directa ? ' (directa)' : ''), 'fechaRegistro A': p.fechaRegistroA, 'fechaRegistro B': p.fechaRegistroB
        })));
      } else {
        console.log('Sin pares.');
      }
      console.groupEnd();
    }
  } finally {
    window.obtenerInicioUltimos30Dias = inicioOriginal;
  }

  const json = JSON.stringify(resultado, null, 2);
  window.__auditoriaDuplicados = resultado;
  console.log(`Auditoría terminada: ${resultado.total} par(es) con posible duplicado en total. Resultado completo (JSON):`);
  console.log(json);
  if (typeof copy === 'function') {
    try { copy(json); console.log('El JSON se copió al portapapeles (también está en window.__auditoriaDuplicados).'); } catch (error) { /* sin portapapeles */ }
  }
  return resultado;
})();
