// Does the shell content actually scroll? Wheel (desktop) and touch swipe (phone).
import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 700 } }], ['phone', { viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true }]]) {
  const p = await b.newPage(opts);
  await p.goto('http://localhost:4173/#/');
  await p.waitForTimeout(800);
  const m = await p.evaluate(() => { const h = document.querySelector('.scroll-host'); return { sh: h.scrollHeight, ch: h.clientHeight, oy: getComputedStyle(h).overflowY, top: h.scrollTop }; });
  await p.mouse.move(640 > opts.viewport.width ? 200 : 640, 400);
  if (label === 'desktop') await p.mouse.wheel(0, 600);
  else {
    const c = await p.context().newCDPSession(p);
    await c.send('Input.synthesizeScrollGesture', { x: 200, y: 500, yDistance: -400, gestureSourceType: 'touch' });
  }
  await p.waitForTimeout(600);
  const after = await p.evaluate(() => document.querySelector('.scroll-host').scrollTop);
  console.log(label, m, 'scrollTop after:', after);
}
await b.close();
