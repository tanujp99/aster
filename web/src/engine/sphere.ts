// Browser Photo Sphere renderer for frames captured with phone orientation.
//
// Each frame carries the camera→world rotation measured by the phone's motion
// sensors at the moment of capture. Frames are projected onto an
// equirectangular (360°×180°) canvas and feather-blended. Sensor orientation is
// only accurate to a degree or two, so this is a fast preview; the local
// helper re-aligns the same frames with Hugin for a seamless result.

import type { RGBAImage } from './panorama';
import { M3, tr } from './math';

export interface SphereFrame {
  /** camera→world rotation; camera axes x right, y down, z forward; world y down. */
  C: M3;
  hfovDeg: number;
}

export interface SphereSource {
  count: number;
  frame(i: number): SphereFrame;
  load(i: number, maxSide: number): Promise<RGBAImage>;
}

export async function renderSphere(
  src: SphereSource,
  width = 6144,
  progress: (stage: string, d: number, t: number) => void = () => {},
): Promise<RGBAImage> {
  const W = width, H = width / 2;
  const acc = new Float32Array(W * H * 3);
  const wsum = new Float32Array(W * H);
  // precompute ray directions per row/col
  const sinLon = new Float32Array(W), cosLon = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const lon = ((x + 0.5) / W) * 2 * Math.PI - Math.PI;
    sinLon[x] = Math.sin(lon); cosLon[x] = Math.cos(lon);
  }
  for (let i = 0; i < src.count; i++) {
    progress('Projecting frames', i, src.count);
    const fr = src.frame(i);
    const im = await src.load(i, 2400);
    const R = tr(fr.C); // world → camera
    const f = im.width / 2 / Math.tan((fr.hfovDeg * Math.PI) / 360);
    const cx = im.width / 2, cy = im.height / 2;
    const half = Math.min(im.width, im.height) / 2;
    for (let y = 0; y < H; y++) {
      const lat = ((y + 0.5) / H) * Math.PI - Math.PI / 2; // −90 (up) … +90 (down)
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < W; x++) {
        const X = cl * sinLon[x], Y = sl, Z = cl * cosLon[x];
        const cz = R[6] * X + R[7] * Y + R[8] * Z;
        if (cz <= 0.05) continue;
        const u = (f * (R[0] * X + R[1] * Y + R[2] * Z)) / cz + cx;
        const v = (f * (R[3] * X + R[4] * Y + R[5] * Z)) / cz + cy;
        if (u < 0 || v < 0 || u >= im.width - 1 || v >= im.height - 1) continue;
        // feather: distance to the nearest frame edge
        const w = Math.min(u, v, im.width - 1 - u, im.height - 1 - v) / half + 1e-3;
        const iu = u | 0, iv = v | 0, du = u - iu, dv = v - iv;
        const p = (iv * im.width + iu) * 4, d = im.data, o = y * W + x;
        for (let c = 0; c < 3; c++) {
          const a = d[p + c] * (1 - du) + d[p + 4 + c] * du;
          const b = d[p + im.width * 4 + c] * (1 - du) + d[p + im.width * 4 + 4 + c] * du;
          acc[o * 3 + c] += (a * (1 - dv) + b * dv) * w;
        }
        wsum[o] += w;
      }
    }
  }
  progress('Blending', 0, 1);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let o = 0; o < W * H; o++) {
    const w = wsum[o];
    if (w > 0) {
      out[o * 4] = acc[o * 3] / w; out[o * 4 + 1] = acc[o * 3 + 1] / w; out[o * 4 + 2] = acc[o * 3 + 2] / w;
    } else {
      // uncovered: neutral grey so gaps are obvious but not jarring
      out[o * 4] = out[o * 4 + 1] = out[o * 4 + 2] = 40;
    }
    out[o * 4 + 3] = 255;
  }
  return { data: out, width: W, height: H };
}
