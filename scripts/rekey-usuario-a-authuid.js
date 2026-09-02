// Re-clava (re-key) un doc de users/ para que su ID de documento sea el authUid
// de Firebase Auth, en vez del slug legado (admin/matilde/christian).
// No borra ni modifica ningún campo del doc, solo cambia su ID.
//
// Uso:
//   node scripts/rekey-usuario-a-authuid.js --key <ruta-service-account.json> --solo Matilde [--dry-run]

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const SLUG_POR_USERNAME = {
  admin: 'admin',
  matilde: 'matilde',
  christian: 'christian',
  test_qa: 'test_qa'
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key') { out.key = args[++i]; }
    else if (args[i] === '--dry-run') { out.dryRun = true; }
    else if (args[i] === '--solo') { out.solo = args[++i]; }
  }
  return out;
}

async function main() {
  const { key, solo, dryRun } = parseArgs();
  if (!key || !solo) {
    console.error('Uso: node scripts/rekey-usuario-a-authuid.js --key <ruta> --solo <username> [--dry-run]');
    process.exit(1);
  }

  const oldId = SLUG_POR_USERNAME[solo.toLowerCase()];
  if (!oldId) {
    console.error(`Usuario desconocido: ${solo}. Esperados: admin, matilde, christian.`);
    process.exit(1);
  }

  initializeApp({ credential: cert(require(key)) });
  const firestore = getFirestore();

  const ref = firestore.collection('users').doc(oldId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`No existe users/${oldId}.`);
    process.exit(1);
  }
  const data = snap.data();
  if (!data.authUid) {
    console.error(`users/${oldId} no tiene campo authUid. Corre primero la migración a Firebase Auth.`);
    process.exit(1);
  }
  if (data.authUid === oldId) {
    console.log(`users/${oldId} ya tiene ID=authUid. Nada que hacer.`);
    process.exit(0);
  }

  console.log(`Doc actual users/${oldId}:`, JSON.stringify(data, null, 2));
  console.log(`Nuevo ID de destino: ${data.authUid}`);

  // El doc legado guarda un campo `id` con el slug viejo (ej. "admin"). Si se copiara
  // tal cual, window.cargarDatos ({ id: doc.id, ...doc.data() }) lo usaría para
  // sobrescribir el doc.id real (el authUid), dejando el re-keying sin efecto.
  const { id: _idLegado, ...dataSinIdLegado } = data;
  if (_idLegado !== undefined) {
    console.log(`Campo legado "id": "${_idLegado}" será descartado (no se copia al nuevo doc).`);
  }

  if (dryRun) {
    console.log(`[dry-run] Crearía users/${data.authUid} (sin el campo "id" legado) y borraría users/${oldId}.`);
    process.exit(0);
  }

  const newRef = firestore.collection('users').doc(data.authUid);
  const newSnap = await newRef.get();
  if (newSnap.exists) {
    console.error(`users/${data.authUid} ya existe. Abortando para no sobrescribir.`);
    process.exit(1);
  }

  const batch = firestore.batch();
  batch.set(newRef, dataSinIdLegado);
  batch.delete(ref);
  await batch.commit();

  console.log(`OK: users/${oldId} -> users/${data.authUid}`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
