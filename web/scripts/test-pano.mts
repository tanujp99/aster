// Node test harness: stitch a folder with the browser engine (sharp decodes).
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stitchPanorama, defaultPanoOptions } from '../src/engine/panorama';
import { readExif } from '../src/lib/exif';
import { readFileSync } from 'node:fs';

const dir = process.argv[2]; const out = process.argv[3] ?? 'out.jpg';
const maxMP = Number(process.argv[4] ?? 20);
const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort();
const load = async (i: number, max?: number) => {
  let s = sharp(join(dir, files[i])).rotate();
  if (max) s = s.resize(max, max, { fit: 'inside' });
  const { data, info } = await s.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
};
const exif = await readExif(new Blob([readFileSync(join(dir, files[0]))]));
console.log('exif', exif);
const t0 = Date.now();
const r = await stitchPanorama(
  { count: files.length, name: (i) => files[i], loadScaled: (i, m) => load(i, m), loadFull: (i) => load(i) },
  { ...defaultPanoOptions, maxMegapixels: maxMP, focal35: exif.focal35, noCrop: !!process.env.NOCROP },
  (s, d, t) => process.stdout.write(`\r${s} ${d + 1}/${t}      `),
);
console.log('\n', r.width, 'x', r.height, JSON.stringify({ ...r.info, gains: r.info.gains.map((g) => +g.toFixed(3)) }), (Date.now() - t0) / 1000, 's');
await sharp(Buffer.from(r.data.buffer), { raw: { width: r.width, height: r.height, channels: 4 } }).jpeg({ quality: 90 }).toFile(out);
