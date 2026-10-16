import { h } from '../ui/dom';

export function homeView(): HTMLElement {
  const tool = (href: string, title: string, body: string, glyph: string) =>
    h('a', { class: 'tool', href },
      h('span', { class: 'glyph', 'aria-hidden': 'true' }, glyph),
      h('h2', {}, title),
      h('p', {}, body),
    );
  return h('section', { class: 'view home' },
    h('header', { class: 'hero' },
      h('span', { class: 'chip-accent eyebrow' }, 'img.tanujp.com'),
      h('h1', {}, 'Stitch the whole view.'),
      h('p', { class: 'lead' }, 'Panoramas and Photo Spheres, made on your own device. The tools load from the web; your photos never leave your computer or phone.'),
    ),
    h('div', { class: 'tools' },
      tool('#/panorama', 'Panorama', 'Turn an overlapping sweep into one wide, level, seamless image.', '⟷'),
      tool('#/sphere', 'Photo Sphere', 'Capture a full 360° with guide dots, or stitch frames you shot by hand.', '◯'),
      tool('#/viewer', 'Viewer', 'Look around spheres and pan across wide panoramas.', '⊙'),
    ),
    h('aside', { class: 'note' },
      h('h3', {}, 'Full resolution? Run the local helper'),
      h('p', {}, 'The browser engine is capped by tab memory. The Aster helper runs Hugin on your computer for full-resolution panoramas and seamless spheres. This page finds it automatically.'),
      h('pre', { class: 'mono' }, 'pip install -r requirements.txt\npython -m aster'),
    ),
  );
}
