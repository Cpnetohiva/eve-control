const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const [url192, url512] = await page.evaluate(() => {
    function generarIcono(size) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#001D3D';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#FFC300';
      const fontSize = Math.round(size * 0.38);
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('EVE', size / 2, size / 2);
      return canvas.toDataURL('image/png');
    }
    return [generarIcono(192), generarIcono(512)];
  });
  function saveDataUrl(dataUrl, filePath) {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  }
  fs.mkdirSync('icons', { recursive: true });
  saveDataUrl(url192, path.join('icons', 'icon-192.png'));
  saveDataUrl(url512, path.join('icons', 'icon-512.png'));
  console.log('OK: icons/icon-192.png e icons/icon-512.png generados');
  await browser.close();
})();
