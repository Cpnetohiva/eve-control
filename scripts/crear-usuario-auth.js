// Script de administración local: crea/actualiza un usuario en Firestore users/{id}.
// La app NO usa Firebase Authentication: el login (js/auth.js) compara username/password
// directamente contra la colección "users". Por eso este script solo escribe en Firestore.
//
// Uso:
//   node scripts/crear-usuario-auth.js --key <ruta-service-account.json> --id <id> --username <nombre-visible> \
//     --password <password> --permisos "clave1,clave2" [--admin]

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { permisos: [], admin: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--admin') { out.admin = true; continue; }
    const valor = args[i + 1];
    if (arg === '--key') { out.key = valor; i++; }
    else if (arg === '--id') { out.id = valor; i++; }
    else if (arg === '--username') { out.username = valor; i++; }
    else if (arg === '--password') { out.password = valor; i++; }
    else if (arg === '--permisos') { out.permisos = valor.split(',').map((p) => p.trim()).filter(Boolean); i++; }
  }
  return out;
}

async function main() {
  const { key, id, username, password, permisos, admin: esAdmin } = parseArgs();
  const faltantes = ['key', 'id', 'username', 'password'].filter((campo) => !{ key, id, username, password }[campo]);
  if (faltantes.length > 0) {
    console.error(`Faltan argumentos: ${faltantes.join(', ')}`);
    process.exit(1);
  }

  initializeApp({ credential: cert(require(key)) });
  const firestore = getFirestore();

  const permissions = {};
  permisos.forEach((clave) => { permissions[clave] = true; });
  permissions.admin = esAdmin === true;

  await firestore.collection('users').doc(id).set({
    id,
    username,
    password,
    active: true,
    permissions
  }, { merge: true });
  console.log(`Firestore: doc users/${id} escrito -> username=${username} permissions=`, permissions);

  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
