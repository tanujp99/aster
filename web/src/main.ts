import './style.css';
import { h } from './ui/dom';
import { markSvg } from './ui/mark';
import { themeSwitcher } from './ui/theme';
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

const main = h('main', {});
document.querySelector('#app')!.append(
  h('div', { class: 'top' }, brand, nav, h('div', { class: 'top-right' }, pill, themeSwitcher())),
  main,
  h('footer', {}, 'Aster · processing happens on this device · nothing is uploaded'),
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
  main.replaceChildren(view());
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#/${key}`));
  moveSlider();
  window.scrollTo(0, 0);
}
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
