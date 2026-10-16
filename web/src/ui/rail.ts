// The portfolio's ScrollRail, without React.
//
// The shell hides its own scrollbar (the rounded corners clipped it) and this
// rail takes over: the nav pill bar in miniature, stood on end — a sunken
// track and a raised, grooved cap, fixed in size, nothing animated but the
// cap's travel. It floats in the page gutter beside the shell, half the
// height of the content, centred. Styles are under the rail section in
// style.css.
import { h } from './dom';

export function scrollRail(target: HTMLElement): HTMLElement {
  const thumb = h('div', { class: 'scroll-rail-thumb' });
  const rail = h('div', { class: 'scroll-rail is-idle', 'aria-hidden': 'true' }, thumb);
  let scrollable = false;

  const measure = () => {
    const room = target.scrollHeight - target.clientHeight;
    scrollable = room > 1;
    rail.classList.toggle('is-idle', !scrollable);
    const progress = scrollable ? target.scrollTop / room : 0;
    thumb.style.top = `calc(100% * ${progress.toFixed(4)} - var(--rail-thumb) / 2)`;
  };

  let frame = 0;
  target.addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; measure(); });
  }, { passive: true });
  const ro = new ResizeObserver(measure);
  ro.observe(target);
  // content swaps (route changes, results appearing) change the height too
  new MutationObserver(() => {
    for (const c of Array.from(target.children)) ro.observe(c);
    measure();
  }).observe(target, { childList: true, subtree: true });

  // the track's ends are where the cap's centre reaches, so it overhangs them like a fader's cap
  const scrollTo = (clientY: number, grab: number) => {
    const b = rail.getBoundingClientRect();
    if (b.height <= 0) return;
    const at = (clientY - b.top - grab) / b.height;
    target.scrollTop = Math.min(Math.max(at, 0), 1) * (target.scrollHeight - target.clientHeight);
  };
  rail.addEventListener('pointerdown', (e) => {
    if (!scrollable) return;
    e.preventDefault();
    const onThumb = e.target === thumb;
    const tb = thumb.getBoundingClientRect();
    // grabbing the cap keeps the point under the pointer; clicking the track takes the cap there
    const grab = onThumb ? e.clientY - (tb.top + tb.height / 2) : 0;
    scrollTo(e.clientY, grab);
    const move = (ev: PointerEvent) => scrollTo(ev.clientY, grab);
    const end = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  });

  measure();
  return rail;
}
