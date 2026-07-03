import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = 'https://testflight.apple.com/join/SrKx7g7W';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setContent('<!doctype html><html><head></head><body></body></html>');
await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js' });

const svg = await page.evaluate((url) => {
  const qr = qrcode(0, 'H');          // auto version, High error-correction (logo-friendly, robust)
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const q = 4;                         // quiet zone (modules)
  const size = n + q * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) path += `M${c + q} ${r + q}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`
       + `<rect width="${size}" height="${size}" fill="#ffffff"/>`
       + `<path d="${path}" fill="#1B4332"/></svg>`;
}, URL);

writeFileSync(join(__dirname, 'screenshots', 'testflight-qr.svg'), svg);
await browser.close();
console.log('QR modules svg bytes:', svg.length, '-> screenshots/testflight-qr.svg');
