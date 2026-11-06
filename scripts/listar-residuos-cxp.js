// Lista, en modo SOLO LECTURA, las cuentas de cuentas_por_pagar con residuos de decimales:
//   - saldo mayor a 0 y menor a 0.01 (un ticket "liquidado" que aún trae una fracción de centavo), o
//   - total o saldo que no son múltiplos de centavo (p. ej. 1.2100000000000002 o 2699.973).
// Muestra ticket, proveedor, saldo, total, el estado guardado y el motivo. NO escribe nada en Firestore: solo usa .get().
//
// Uso:
//   node scripts/listar-residuos-cxp.js --key <ruta-service-account.json>
//   node scripts/listar-residuos-cxp.js --key <ruta-service-account.json> --json     (salida en JSON, para guardarla con >)
//   GOOGLE_APPLICATION_CREDENTIALS=<ruta> node scripts/listar-residuos-cxp.js        (alternativa sin --key)
//
// La llave de servicio (Firebase Console > Configuración del proyecto > Cuentas de servicio > Generar nueva clave privada) es de
// uso local: no se guarda en el repo. Código de salida: 0 si terminó (haya o no residuos), 1 si falta la llave o falla la lectura.

const PROYECTO = 'everplastic';

// Estricto a propósito: 1.2100000000000002 también cuenta como residuo (es ruido de punto flotante guardado en el dato).
function esMultiploDeCentavo(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return false;
  return n === Math.round(n * 100) / 100;
}

// Función pura: devuelve [{ id, ticket, proveedor, saldo, total, estado, motivos }] de las cuentas con residuos.
function detectarResiduosCxP(cuentas) {
  const resultado = [];
  for (const c of cuentas || []) {
    const saldo = Number(c.saldo);
    const total = Number(c.total);
    const motivos = [];
    if (Number.isFinite(saldo) && saldo > 0 && saldo < 0.01) motivos.push('saldo entre 0 y 0.01');
    if (c.saldo !== undefined && c.saldo !== null && !esMultiploDeCentavo(saldo)) motivos.push('saldo no es múltiplo de centavo');
    if (c.total !== undefined && c.total !== null && !esMultiploDeCentavo(total)) motivos.push('total no es múltiplo de centavo');
    if (motivos.length > 0) {
      resultado.push({
        id: c.id, ticket: c.ticket, proveedor: c.proveedor, saldo: c.saldo, total: c.total, estado: c.estado, motivos
      });
    }
  }
  return resultado;
}

function leerArgumentos() {
  const args = process.argv.slice(2);
  const salida = { json: false, key: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key') salida.key = args[++i];
    else if (args[i] === '--json') salida.json = true;
  }
  return salida;
}

async function main() {
  const { key, json } = leerArgumentos();
  if (!key && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Falta la llave de servicio de Firebase (solo lectura).');
    console.error('  node scripts/listar-residuos-cxp.js --key <ruta-service-account.json>');
    console.error('  o define GOOGLE_APPLICATION_CREDENTIALS con esa ruta.');
    console.error('No se escribió nada.');
    process.exit(1);
  }
  // firebase-admin se carga aquí para que la detección pueda probarse sin la dependencia ni credenciales.
  const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const path = require('path');
  initializeApp({
    credential: key ? cert(require(path.resolve(key))) : applicationDefault(),
    projectId: PROYECTO
  });
  const snap = await getFirestore().collection('cuentas_por_pagar').get(); // única operación contra Firestore: lectura
  const cuentas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const residuos = detectarResiduosCxP(cuentas);

  if (json) {
    console.log(JSON.stringify({ revisadas: cuentas.length, conResiduos: residuos.length, cuentas: residuos }, null, 2));
  } else {
    console.log(`Cuentas revisadas: ${cuentas.length} · con residuos: ${residuos.length}\n`);
    residuos.forEach((r) => {
      console.log(`ticket ${r.ticket || '(saldo inicial)'} · ${r.proveedor} · saldo ${r.saldo} · total ${r.total} · estado ${r.estado} · id ${r.id}`);
      console.log(`    ${r.motivos.join('; ')}`);
    });
    if (residuos.length === 0) console.log('Sin residuos.');
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => { console.error(`Error al leer cuentas_por_pagar: ${e.message}`); process.exit(1); });
}

module.exports = { detectarResiduosCxP, esMultiploDeCentavo };
