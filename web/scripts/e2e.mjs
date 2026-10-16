// End-to-end: open the built site, stitch photos in the browser engine.
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2], shot = process.argv[3];
const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort().map((f) => join(dir, f));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
p.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
await p.goto('http://localhost:4173/#/panorama');
await p.setInputFiles('input[type=file]', files).catch(async () => {
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('text=Choose photos')]);
  await fc.setFiles(files);
});
await p.click('text=Stitch panorama');
const dl = p.waitForEvent('download', { timeout: 600000 });
const d = await dl;
console.log('download:', d.suggestedFilename());
await p.waitForSelector('.result img');
await p.waitForTimeout(1500);
console.log('meta:', await p.textContent('.result .muted'));
await p.screenshot({ path: shot, fullPage: true });
await b.close();
