import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const browser = await chromium.launch({ channel: 'chrome', headless: true });

const MAX_PX = 16000; // Chromium/Skia max texture ~16384px; stay safely under for a clean one-shot capture

async function measure(htmlFile, width) {
  const page = await browser.newPage({ viewport: { width, height: 1200 }, deviceScaleFactor: 1 });
  await page.goto('file://' + join(__dirname, htmlFile), { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(400);
  const dims = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  await page.close();
  return dims;
}

async function render(htmlFile, base, { width }) {
  const dims = await measure(htmlFile, width);
  // Cap device scale so the output PNG never exceeds the texture limit (else it wraps/duplicates).
  const dsf = Math.min(2, MAX_PX / dims.h);
  const page = await browser.newPage({
    viewport: { width: dims.w, height: dims.h },
    deviceScaleFactor: dsf,
  });
  await page.goto('file://' + join(__dirname, htmlFile), { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(600);
  // viewport == content height, so a single screenshot captures everything (no stitching)
  await page.screenshot({ path: join(__dirname, base + '.png') });
  // Single-page PDF with REAL tappable hyperlinks (links/QR are <a> elements)
  await page.emulateMedia({ media: 'screen' });
  await page.pdf({
    path: join(__dirname, base + '.pdf'),
    printBackground: true,
    width: `${dims.w}px`,
    height: `${dims.h}px`,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
    pageRanges: '1',
  });
  await page.close();
  console.log(`Rendered ${dims.w}x${dims.h} @${dsf.toFixed(2)}x (${Math.round(dims.h*dsf)}px) -> ${base}.png + ${base}.pdf`);
}

// Two ordered poster variants (built from poster.html by build-posters.py)
await render('poster-individual.html', 'poster-individual', { width: 1080 });
await render('poster-captain.html', 'poster-captain', { width: 1080 });
// Standalone shareable beta-invite card (fixed portrait)
await render('beta-card.html', 'beta-invite', { width: 1080 });
// Dedicated QR-only card, large & easy to scan (square)
await render('qr-card.html', 'beta-qr', { width: 1080 });

await browser.close();
