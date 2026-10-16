// First-start capture: fake camera + fake motion sensors; dots must show on the first try.
import { chromium } from 'playwright';
const shot = process.argv[2];
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'], hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://localhost:4173/#/sphere');
await p.click('text=Start capture');
// phone held upright facing the first target: alpha 0, beta 90, gamma 0
await p.evaluate(() => { setInterval(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 10, beta: 88, gamma: 0 })), 50); });
await p.waitForTimeout(2500);
console.log('info:', await p.textContent('.cap-info'));
await p.screenshot({ path: shot });
await b.close();
