// Real finger-style swipe via raw CDP touch events, on the portfolio and on Aster.
import { chromium } from 'playwright';
const b = await chromium.launch();
async function swipe(c, x, y0, y1) {
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / steps }] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
for (const [label, url] of [['portfolio', 'http://localhost:3100/'], ['aster', 'http://localhost:4173/#/'], ['aster-sphere', 'http://localhost:4173/#/sphere']]) {
  const p = await b.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
  await p.goto(url); await p.waitForTimeout(3500);
  const c = await p.context().newCDPSession(p);
  await swipe(c, 200, 600, 300);
  await p.waitForTimeout(900);
  console.log(label, await p.evaluate(() => { const h = document.querySelector('.scroll-host'); return [h.scrollTop, h.scrollHeight, h.clientHeight, scrollY]; }));
}
await b.close();
