import './style.css';
import { h } from './ui/dom';
import { markSvg } from './ui/mark';
import { themeSwitcher } from './ui/theme';
import { scrollRail } from './ui/rail';
import { homeView } from './views/home';
import { panoramaView } from './views/panorama';
import { sphereView } from './views/sphere';
import { viewerView } from './views/viewer';
import { helperHealth, HELPER_URL } from './lib/helper';

const routes: Record<string, () => HTMLElement> = {
  '': homeView,
  panorama: panoramaView,
  sphere: sphereView,
  viewer: viewerView,
};

const pill = h('span', { class: 'pill', title: HELPER_URL }, 'Helper…');
const slider = h('span', { class: 'slider', 'aria-hidden': 'true' });
const nav = h('nav', { class: 'navtrack' },
  slider,
  h('a', { href: '#/panorama' }, 'Panorama'),
  h('a', { href: '#/sphere' }, 'Photo Sphere'),
  h('a', { href: '#/viewer' }, 'Viewer'),
);
const brand = h('a', { class: 'brand', href: '#/', 'aria-label': 'Aster home' });
brand.style.color = 'var(--accent)';
brand.append(markSvg(), h('span', { style: 'color: var(--foreground)' }, 'Aster'));

// page (never scrolls) → shell (sunk panel) → nav + scroll host; the rail sits
// in the page gutter beside the shell, as on the portfolio
const content = h('div', {});
const host = h('div', { class: 'scroll-host' }, content,
  h('footer', {}, 'Aster · processing happens on this device · nothing is uploaded'));
const main = h('main', { class: 'shell' }, h('div', { class: 'shell-nav' }, nav), host);
const anchor = h('div', { class: 'rail-anchor' }, h('div', {}, scrollRail(host)));
document.querySelector('#app')!.append(
  h('div', { class: 'top' }, brand, h('div', { class: 'top-right' }, pill, themeSwitcher())),
  h('div', { class: 'page' }, main, anchor),
);

/** Slide the raised pill under the active tab (the portfolio's navbar). */
function moveSlider() {
  const on = nav.querySelector<HTMLAnchorElement>('a.on');
  if (!on) { slider.style.opacity = '0'; return; }
  slider.style.opacity = '1';
  slider.style.width = `${on.offsetWidth}px`;
  slider.style.transform = `translateX(${on.offsetLeft}px)`;
}

function render() {
  const key = location.hash.replace(/^#\/?/, '').split('?')[0];
  const view = routes[key] ?? homeView;
  const v = view();
  v.classList.add('fade-in');
  content.replaceChildren(v);
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#/${key}`));
  moveSlider();
  host.scrollTo({ top: 0 }); // a new view starts at the top
}
// The page itself never scrolls, so a wheel over the top bar or the gutters
// would do nothing. Hand it to the panel's content instead.
addEventListener('wheel', (e: WheelEvent) => {
  if (host.contains(e.target as Node) || (e.target as Element).closest?.('.capture, .pano360, .flat')) return;
  host.scrollBy({ top: e.deltaY, left: 0 });
}, { passive: true });
addEventListener('hashchange', render);
addEventListener('resize', moveSlider);
document.fonts?.ready.then(moveSlider);
render();

async function poll() {
  const s = await helperHealth();
  pill.textContent = s ? (s.ok ? `Helper ${s.version}${s.busy ? ' · busy' : ''}` : 'Helper: Hugin missing') : 'Helper off';
  pill.className = `pill ${s?.ok ? 'on' : ''}`;
}
poll();
setInterval(poll, 15000);
