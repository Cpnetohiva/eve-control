// Migra los usuarios existentes (comparados en texto plano contra Firestore) a cuentas
// reales de Firebase Authentication. No borra el campo `password` de Firestore: eso se
// limpia en una fase posterior, una vez confirmado que el login nuevo funciona en producción.
//
// Uso:
//   node scripts/migrar-usuarios-firebase-auth.js --key <ruta-service-account.json> [--dry-run]
//
// --dry-run: no crea ni modifica nada, solo reporta qué haría (usa getUserByEmail, es de solo lectura).
// Passwords: se leen de docs/superpowers/credenciales-phase2.json (gitignored, nunca
// hardcodeadas aquí para no exponerlas al subir este script a git).

const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const DOMINIO_AUTH = '@everplastic.local';
const CREDENCIALES_PATH = path.join(__dirname, '..', 'docs', 'superpowers', 'credenciales-phase2.json');

// test_qa no lleva password aquí: si ya existe en Firebase Auth se enlaza tal cual;
// si no existe, el script lo reporta y no lo crea (evita inventar una contraseña).
function cargarUsuarios() {
  const credenciales = require(CREDENCIALES_PATH);
  return [
    { id: 'admin', username: 'Admin', password: credenciales.admin.password },
    { id: 'matilde', username: 'Matilde', password: credenciales.matilde.password },
    { id: 'christian', username: 'Christian', password: credenciales.christian.password },
    { id: 'test_qa', username: 'test_qa', password: null }
  ];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key') { out.key = args[i + 1]; i++; }
    else if (args[i] === '--dry-run') { out.dryRun = true; }
    else if (args[i] === '--solo') { out.solo = args[i + 1]; i++; }
    else if (args[i] === '--password-solo') { out.passwordSolo = args[i + 1]; i++; }
  }
  return out;
}

function emailDesdeUsername(username) {
  return `${username.trim().toLowerCase()}${DOMINIO_AUTH}`;
}

async function migrarUsuario(auth, firestore, usuario, dryRun) {
  const email = emailDesdeUsername(usuario.username);
  let authUser;
  try {
    authUser = await auth.getUserByEmail(email);
    console.log(`Ya existe en Firebase Auth: ${email} (uid=${authUser.uid})`);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    if (!usuario.password) {
      console.log(`OMITIDO: ${email} no existe en Firebase Auth y no se dio password para crearlo.`);
      return;
    }
    if (dryRun) {
      console.log(`[dry-run] Crearía usuario en Firebase Auth: ${email}`);
      return;
    }
    authUser = await auth.createUser({ email, password: usuario.password, emailVerified: true });
    console.log(`Creado en Firebase Auth: ${email} (uid=${authUser.uid})`);
  }

  if (dryRun) {
    console.log(`[dry-run] Actualizaría Firestore users/${usuario.id} con email=${email}, authUid=${authUser.uid}`);
    return;
  }
  await firestore.collection('users').doc(usuario.id).set({ email, authUid: authUser.uid }, { merge: true });
  console.log(`Firestore: users/${usuario.id} actualizado con email=${email}, authUid=${authUser.uid}`);
}

async function main() {
  const { key, dryRun, solo, passwordSolo } = parseArgs();
  if (!key) {
    console.error('Falta --key <ruta-service-account.json>');
    process.exit(1);
  }

  initializeApp({ credential: cert(require(key)) });
  const auth = getAuth();
  const firestore = getFirestore();

  const todosLosUsuarios = cargarUsuarios();
  let usuarios = todosLosUsuarios;
  if (solo) {
    usuarios = todosLosUsuarios
      .filter((u) => u.username.toLowerCase() === solo.toLowerCase())
      .map((u) => (passwordSolo ? { ...u, password: passwordSolo } : u));
    if (usuarios.length === 0) {
      console.error(`No se encontró "${solo}" en la lista de usuarios a migrar.`);
      process.exit(1);
    }
  }

  for (const usuario of usuarios) {
    await migrarUsuario(auth, firestore, usuario, dryRun);
  }
  console.log(dryRun ? 'Dry-run completo. No se modificó nada.' : 'Migración completa.');
  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
