import './style.css';
import { h } from './ui/dom';
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

const pill = h('span', { class: 'pill', title: HELPER_URL }, 'Helper: checking…');
const nav = h('nav', {},
  h('a', { href: '#/panorama' }, 'Panorama'),
  h('a', { href: '#/sphere' }, 'Photo Sphere'),
  h('a', { href: '#/viewer' }, 'Viewer'),
);
const main = h('main', {});
document.querySelector('#app')!.append(
  h('div', { class: 'top' }, h('a', { class: 'brand', href: '#/' }, h('span', { class: 'mark' }), 'Aster'), nav, pill),
  main,
  h('footer', {}, 'Aster · processing happens on this device · nothing is uploaded'),
);

function render() {
  const key = location.hash.replace(/^#\/?/, '').split('?')[0];
  const view = routes[key] ?? homeView;
  main.replaceChildren(view());
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#/${key}`));
  window.scrollTo(0, 0);
}
addEventListener('hashchange', render);
render();

async function poll() {
  const s = await helperHealth();
  pill.textContent = s ? (s.ok ? `Helper ${s.version}${s.busy ? ' · busy' : ''}` : 'Helper: Hugin missing') : 'Helper: off';
  pill.className = `pill ${s?.ok ? 'on' : ''}`;
}
poll();
setInterval(poll, 15000);
