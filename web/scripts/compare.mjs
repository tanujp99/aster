// Screenshot the portfolio and Aster side by side (desktop + phone, both themes).
import { chromium } from 'playwright';
const out = process.argv[2];
const b = await chromium.launch();
for (const [name, url] of [['portfolio', 'http://localhost:3100/'], ['aster', 'http://localhost:4173/#/sphere']]) {
  for (const [vp, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
    for (const scheme of ['light', 'dark']) {
      const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
      await p.goto(url);
      await p.evaluate((s) => { try { localStorage.setItem('theme', s); } catch {} }, scheme);
      await p.reload();
      await p.waitForTimeout(3500);
      await p.screenshot({ path: `${out}/cmp-${name}-${vp}-${scheme}.png` });
      await p.close();
    }
  }
}
await b.close();
