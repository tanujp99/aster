import { chromium } from 'playwright';
const out = process.argv[2];
const b = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
  await p.goto('http://localhost:4173/#/panorama');
  await p.waitForTimeout(1200);
  const el = await p.$('.controls');
  await el.screenshot({ path: `${out}/slider-${scheme}.png` });
  await p.close();
}
await b.close();
