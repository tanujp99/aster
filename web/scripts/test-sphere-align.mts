// Synthetic test: noisy "sensor" orientations + wrong lens width → alignSphere → compare.
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { alignSphere } from '../src/engine/sphereAlign';
import { renderSphere } from '../src/engine/sphere';
import { M3, tr, mul } from '../src/engine/math';
const dir = process.argv[2], out = process.argv[3];
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const files: string[] = meta.frames.map((f: any) => join(dir, f.file));
const load = async (i: number, m: number) => {
  const { data, info } = await sharp(files[i]).resize(m, m, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
};
const angErr = (A: M3, B: M3) => { const R = mul(tr(A), B); return Math.acos(Math.min(1, (R[0] + R[4] + R[8] - 1) / 2)) * 57.2958; };
const Ct: M3[] = meta.frames.map((f: any) => f.C_true), Cs: M3[] = meta.frames.map((f: any) => f.C);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
console.log('sensor error (deg): mean', mean(Cs.map((c, i) => angErr(c, Ct[i]))).toFixed(2));
const t0 = Date.now();
const al = await alignSphere({ C: Cs, hfovDeg: 52, load, progress: () => {} });
console.log('aligned in', (Date.now() - t0) / 1000, 's; pairs', al.pairs, 'rms', al.rmsDeg.toFixed(3), 'deg; hfov', al.hfovDeg.toFixed(2), '(true', meta.hfov_true, ')');
console.log('after error (deg): mean', mean(al.C.map((c, i) => angErr(c, Ct[i]))).toFixed(2), ' gains', al.gains.map((g) => g.toFixed(3)).join(' '));
for (const [name, C, hf] of [['sensor', Cs, 52], ['aligned', al.C, al.hfovDeg]] as const) {
  const r = await renderSphere({ count: files.length, frame: (i) => ({ C: C[i], hfovDeg: hf }), load }, 4096);
  await sharp(Buffer.from(r.data.buffer), { raw: { width: r.width, height: r.height, channels: 4 } })
    .extract({ left: 1100, top: 500, width: 1900, height: 1100 }).jpeg().toFile(`${out}-${name}.jpg`);
}
