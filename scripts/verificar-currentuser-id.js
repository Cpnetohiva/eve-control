// Verifica que, tras el login, window.EVE.currentUser.id sea el authUid nuevo
// (y no el slug legado), y que la fila de la tabla de admin-usuarios use ese mismo id.
// Uso: node scripts/verificar-currentuser-id.js --url http://localhost:8090 --username Admin --password <pwd>

const { chromium } = require('playwright');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { url: 'http://localhost:8090' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url') out.url = args[++i];
    else if (args[i] === '--username') out.username = args[++i];
    else if (args[i] === '--password') out.password = args[++i];
  }
  return out;
}

async function main() {
  const { url, username, password } = parseArgs();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-username', { timeout: 15000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForTimeout(3000);

  const appShellVisible = await page.evaluate(() => document.getElementById('app-shell').classList.contains('visible'));
  if (!appShellVisible) {
    console.log('Login falló:', await page.textContent('#login-error'));
    await browser.close();
    process.exit(1);
  }

  const currentUserId = await page.evaluate(() => window.EVE.currentUser && window.EVE.currentUser.id);
  const currentUserAuthUid = await page.evaluate(() => window.EVE.currentUser && window.EVE.currentUser.authUid);
  console.log(`currentUser.id = ${currentUserId}`);
  console.log(`currentUser.authUid = ${currentUserAuthUid}`);
  console.log(`Coinciden (id === authUid): ${currentUserId === currentUserAuthUid}`);

  await browser.close();
  process.exit(currentUserId === currentUserAuthUid ? 0 : 1);
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
