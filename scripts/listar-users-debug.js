// Script de verificación temporal: lista todos los docs de users/ con su ID y campos.
// Uso: node scripts/listar-users-debug.js --key <ruta-service-account.json>

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key') { out.key = args[++i]; }
  }
  return out;
}

async function main() {
  const { key } = parseArgs();
  if (!key) {
    console.error('Uso: node scripts/listar-users-debug.js --key <ruta>');
    process.exit(1);
  }
  initializeApp({ credential: cert(require(key)) });
  const snap = await getFirestore().collection('users').get();
  snap.docs.forEach((d) => console.log(d.id, JSON.stringify(d.data())));
  process.exit(0);
}

main();
