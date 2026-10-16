import { chromium } from 'playwright';
const out = process.argv[2];
const b = await chromium.launch();
for (const [name, w, h, scheme] of [['home', 1280, 820, 'dark'], ['sphere', 390, 844, 'dark'], ['pano-m', 390, 844, 'light']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
  await p.goto(`http://localhost:4173/#/${name === 'home' ? '' : name === 'sphere' ? 'sphere' : 'panorama'}`);
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}
await b.close();
