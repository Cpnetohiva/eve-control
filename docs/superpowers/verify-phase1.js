// Verificación visual de Fase 1 — no forma parte del deploy de la app.
// Uso: node docs/superpowers/verify-phase1.js
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  const url = 'http://localhost:8765/index.html';
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#login-screen');

  await page.screenshot({ path: path.join(__dirname, 'screenshot-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(__dirname, 'screenshot-mobile.png') });

  console.log('TITLE:', await page.textContent('#login-screen h1'));
  console.log('SUBTITLE:', await page.textContent('#login-screen .subtitulo'));
  console.log('APP_SHELL_HIDDEN:', !(await page.isVisible('#app-shell')));
  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));

  await browser.close();
})();
