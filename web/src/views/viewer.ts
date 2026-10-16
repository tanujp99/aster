import 'pannellum/build/pannellum.css';
import 'pannellum/build/pannellum.js';
import { h, fmtBytes } from '../ui/dom';
import { readGpano } from '../lib/xmp';
import { pickPhotos } from '../lib/files';

declare const pannellum: any;

let pending: { blob: Blob; name: string } | null = null;

export function openInViewer(blob: Blob, name: string) {
  pending = { blob, name };
  location.hash = '#/viewer';
}

const MAX_TEX = 8192; // safe WebGL texture width for phones and laptops

async function shrink(blob: Blob, maxW: number): Promise<{ url: string; w: number; h: number }> {
  const probe = await createImageBitmap(blob);
  const { width: w, height: hh } = probe;
  if (w <= maxW) { probe.close(); return { url: URL.createObjectURL(blob), w, h: hh }; }
  const k = maxW / w;
  const bmp = await createImageBitmap(blob, { resizeWidth: maxW, resizeHeight: Math.round(hh * k), resizeQuality: 'high' });
  probe.close();
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return { url: URL.createObjectURL(out), w, h: hh };
}

export function viewerView(): HTMLElement {
  const stage = h('div', { class: 'viewer-stage' });
  const meta = h('p', { class: 'muted' });
  let viewer: any = null;

  async function show(blob: Blob, name: string) {
    viewer?.destroy?.(); viewer = null;
    stage.replaceChildren();
    const g = await readGpano(blob);
    const probe = await createImageBitmap(blob);
    const w = probe.width, hh = probe.height; probe.close();
    const isSphere = g.isSphere || Math.abs(w / hh - 2) < 0.02;
    meta.textContent = `${name} · ${w.toLocaleString()} × ${hh.toLocaleString()} px · ${fmtBytes(blob.size)} · ${isSphere ? 'Photo Sphere' : 'flat panorama'}`;
    if (isSphere) {
      const { url } = await shrink(blob, MAX_TEX);
      const fullW = g.fullW ?? w, fullH = g.fullH ?? fullW / 2;
      const haov = (360 * (g.w ?? w)) / fullW, vaov = (180 * (g.h ?? hh)) / fullH;
      const box = h('div', { class: 'pano360' });
      stage.append(box);
      viewer = pannellum.viewer(box, {
        type: 'equirectangular', panorama: url, autoLoad: true, showZoomCtrl: true,
        haov, vaov, vOffset: g.top !== undefined ? 90 - ((g.top + (g.h ?? hh) / 2) / fullH) * 180 : 0,
        hfov: 100, compass: false,
      });
    } else {
      stage.append(flatViewer(blob));
    }
  }

  if (pending) { const p = pending; pending = null; queueMicrotask(() => show(p.blob, p.name)); }

  return h('section', { class: 'view' },
    h('header', { class: 'view-head' },
      h('h1', {}, 'Viewer'),
      h('p', { class: 'lead' }, 'Drag to look around a Photo Sphere, or pan and zoom a wide panorama. Files open locally.'),
    ),
    h('div', { class: 'row' },
      h('button', { class: 'pill-link', onclick: async () => { const [f] = await pickPhotos(); if (f) show(f, f.name); } }, 'Open an image'),
    ),
    meta, stage,
  );
}

/** Pan/zoom viewer for flat panoramas (no WebGL size limits). */
function flatViewer(blob: Blob): HTMLElement {
  const img = h('img', { src: URL.createObjectURL(blob), alt: 'Panorama', draggable: false }) as HTMLImageElement;
  const box = h('div', { class: 'flat' }, img);
  let scale = 1, x = 0, y = 0, drag: { x: number; y: number } | null = null;
  const apply = () => (img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`);
  img.onload = () => { scale = box.clientHeight / img.naturalHeight; x = 0; y = 0; apply(); };
  box.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = box.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    x = mx - (mx - x) * k; y = my - (my - y) * k; scale *= k; apply();
  }, { passive: false });
  box.addEventListener('pointerdown', (e) => { drag = { x: e.clientX - x, y: e.clientY - y }; box.setPointerCapture(e.pointerId); });
  box.addEventListener('pointermove', (e) => { if (drag) { x = e.clientX - drag.x; y = e.clientY - drag.y; apply(); } });
  box.addEventListener('pointerup', () => (drag = null));
  return box;
}
