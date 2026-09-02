// Verifica que el login real pase por Firebase Authentication (identitytoolkit.googleapis.com)
// y no por una comparación de password en texto plano contra Firestore.
//
// Requiere que el sitio esté sirviéndose en --url (por defecto http://localhost:8080).
//
// Uso:
//   node scripts/test-auth-network.js --username test_qa --password <pwd> [--url http://localhost:8080]

const { chromium } = require('playwright');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { url: 'http://localhost:8080' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username') { out.username = args[i + 1]; i++; }
    else if (args[i] === '--password') { out.password = args[i + 1]; i++; }
    else if (args[i] === '--url') { out.url = args[i + 1]; i++; }
  }
  return out;
}

async function main() {
  const { username, password, url } = parseArgs();
  if (!username || !password) {
    console.error('Uso: node scripts/test-auth-network.js --username <u> --password <p> [--url <url>]');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const peticiones = [];
  page.on('request', (req) => peticiones.push(req.url()));
  page.on('console', (msg) => console.log(`[console:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#login-username', { timeout: 15000 });
    await page.fill('#login-username', username);
    await page.fill('#login-password', password);
    await page.click('#login-form button[type="submit"]');
    await page.waitForTimeout(3000);
  } catch (error) {
    console.log(`[fallo durante interacción] ${error.message}`);
    console.log('display de #login-screen:', await page.evaluate(() => document.getElementById('login-screen')?.style.display).catch(() => 'N/A'));
    console.log('display de #app-shell class:', await page.evaluate(() => document.getElementById('app-shell')?.className).catch(() => 'N/A'));
    console.log('Peticiones capturadas hasta el fallo:');
    peticiones.forEach((u) => console.log(`  - ${u}`));
    await browser.close();
    process.exit(1);
  }

  const golpeaIdentityToolkit = peticiones.some((u) => u.includes('identitytoolkit.googleapis.com'));
  const golpeaFirestoreAntesDeAuth = peticiones
    .slice(0, peticiones.findIndex((u) => u.includes('identitytoolkit.googleapis.com')) === -1
      ? peticiones.length
      : peticiones.findIndex((u) => u.includes('identitytoolkit.googleapis.com')))
    .some((u) => u.includes('firestore.googleapis.com'));
  const errorVisible = (await page.textContent('#login-error')) || '';
  const appShellVisible = await page.evaluate(() => document.getElementById('app-shell').classList.contains('visible'));

  console.log(`Usuario probado: ${username} (${url})`);
  console.log(`Login exitoso (app-shell visible): ${appShellVisible}`);
  console.log(`Error mostrado en pantalla: "${errorVisible.trim()}"`);
  console.log(`Petición a identitytoolkit.googleapis.com detectada: ${golpeaIdentityToolkit}`);
  console.log(`Firestore consultado ANTES de validar credenciales (no debería): ${golpeaFirestoreAntesDeAuth}`);
  console.log('Peticiones de red observadas:');
  peticiones.forEach((u) => console.log(`  - ${u}`));

  await browser.close();

  if (!golpeaIdentityToolkit || !appShellVisible || golpeaFirestoreAntesDeAuth) {
    console.error('FALLO: el login no pasó correctamente por Firebase Auth.');
    process.exit(1);
  }
  console.log('OK: el login pasó por Firebase Authentication.');
  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
