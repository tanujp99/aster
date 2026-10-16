// Sanity check for the browser sphere renderer + sensor conventions.
import sharp from 'sharp';
import { renderSphere } from '../src/engine/sphere';
import { cameraRotation, yawPitchRoll } from '../src/capture/orientation';
const [a, b, out] = process.argv.slice(2);
// phone upright facing north (alpha 0, beta 90), then turned right by 8° (alpha −8)
const C0 = cameraRotation(0, 90, 0), C1 = cameraRotation(-8, 90, 0);
console.log('ypr0', yawPitchRoll(C0), 'ypr1', yawPitchRoll(C1));
const load = async (f: string, m: number) => {
  const { data, info } = await sharp(f).rotate().resize(m, m, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
};
const files = [a, b], Cs = [C0, C1];
const r = await renderSphere({ count: 2, frame: (i) => ({ C: Cs[i], hfovDeg: 11 }), load: (i, m) => load(files[i], m) }, 4096);
await sharp(Buffer.from(r.data.buffer), { raw: { width: r.width, height: r.height, channels: 4 } }).extract({ left: 1800, top: 850, width: 500, height: 400 }).jpeg().toFile(out);
