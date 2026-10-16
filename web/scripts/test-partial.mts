// Partial sphere: render the synthetic frames, crop like GCam, write GPano, check tags.
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderSphere, cropSphere } from '../src/engine/sphere';
import { insertXmp, gpanoXmp } from '../src/lib/xmp';
import { exifSegment } from '../src/lib/exif';
const dir = process.argv[2], out = process.argv[3];
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const files: string[] = meta.frames.map((f: any) => join(dir, f.file));
const load = async (i: number, m: number) => {
  const { data, info } = await sharp(files[i]).resize(m, m, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
};
const r = await renderSphere({ count: files.length, frame: (i) => ({ C: meta.frames[i].C_true, hfovDeg: meta.hfov_true }), load }, 4096);
const c = cropSphere(r);
console.log({ w: c.width, h: c.height, fullW: c.fullW, left: c.left, top: c.top, heading: c.headingDeg.toFixed(1), partial: c.partial });
const jpg = await sharp(Buffer.from(c.data.buffer), { raw: { width: c.width, height: c.height, channels: 4 } }).jpeg({ quality: 90 }).toBuffer();
const b = await insertXmp(new Blob([jpg]), gpanoXmp(c.width, c.height, c, { first: new Date(Date.now() - 60000), last: new Date(), count: files.length }), exifSegment(c.width, c.height, new Date(), { make: "Google", model: "Pixel 9 Pro" }));
writeFileSync(out, Buffer.from(await b.arrayBuffer()));
