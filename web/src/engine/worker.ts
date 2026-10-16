/// <reference lib="webworker" />
// Runs the stitching engines off the main thread. Files arrive as File/Blob
// objects (never uploaded) and come back as an encoded JPEG Blob.

import { stitchPanorama, defaultPanoOptions, type RGBAImage, type PanoOptions } from './panorama';
import { renderSphere, type SphereFrame } from './sphere';
import { insertXmp, gpanoXmp } from '../lib/xmp';
import { readExif } from '../lib/exif';

type Req =
  | { kind: 'panorama'; files: File[]; options?: Partial<PanoOptions>; quality: number }
  | { kind: 'sphere'; files: Blob[]; frames: SphereFrame[]; width: number; quality: number };

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
const progress = (stage: string, done: number, total: number) => post({ type: 'progress', stage, done, total });

async function decode(file: Blob, maxSide?: number): Promise<RGBAImage> {
  const probe = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let w = probe.width, h = probe.height;
  let bmp = probe;
  if (maxSide && Math.max(w, h) > maxSide) {
    const k = maxSide / Math.max(w, h);
    w = Math.round(w * k); h = Math.round(h * k);
    bmp = await createImageBitmap(file, {
      imageOrientation: 'from-image', resizeWidth: w, resizeHeight: h, resizeQuality: 'high',
    });
    probe.close();
  }
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const id = g.getImageData(0, 0, w, h);
  return { data: id.data, width: w, height: h };
}

async function encode(img: RGBAImage, quality: number): Promise<Blob> {
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext('2d')!;
  g.putImageData(new ImageData(img.data as any, img.width, img.height), 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality });
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data;
  try {
    if (req.kind === 'panorama') {
      const files = req.files;
      const exif = await readExif(files[0]);
      const r = await stitchPanorama(
        {
          count: files.length,
          name: (i) => files[i].name,
          loadScaled: (i, m) => decode(files[i], m),
          loadFull: (i) => decode(files[i]),
        },
        { ...defaultPanoOptions, focal35: exif.focal35, ...req.options },
        progress,
      );
      progress('Encoding JPEG', 0, 1);
      const blob = await encode(r, req.quality);
      post({ type: 'done', blob, width: r.width, height: r.height, info: r.info });
    } else {
      const r = await renderSphere(
        { count: req.files.length, frame: (i) => req.frames[i], load: (i, m) => decode(req.files[i], m) },
        req.width,
        progress,
      );
      progress('Encoding JPEG', 0, 1);
      const jpeg = await encode(r, req.quality);
      const blob = await insertXmp(jpeg, gpanoXmp(r.width, r.height));
      post({ type: 'done', blob, width: r.width, height: r.height, info: { frames: req.files.length } });
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
