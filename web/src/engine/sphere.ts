// Browser Photo Sphere renderer for frames captured with phone orientation.
//
// Each frame carries the camera→world rotation measured by the phone's motion
// sensors at the moment of capture. Frames are projected onto an
// equirectangular (360°×180°) canvas and feather-blended. Sensor orientation is
// only accurate to a few degrees, so frames are first re-aligned from the images
// (sphereAlign.ts); the local helper's Hugin pipeline remains the reference.

import type { RGBAImage } from './panorama';
import { M3, tr } from './math';

export interface SphereFrame {
  /** exposure gain from alignment (1 = untouched) */
  gain?: number;
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
    const gain = fr.gain ?? 1;
    // footprint on the canvas: rows from the frame's border rays, columns too
    // unless the frame covers a pole (then every column is in play)
    const { y0, y1, cols } = footprint(fr.C, f, im.width, im.height, W, H);
    for (let y = y0; y <= y1; y++) {
      const lat = ((y + 0.5) / H) * Math.PI - Math.PI / 2; // −90 (up) … +90 (down)
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (const [xa, xb] of cols) for (let x = xa; x <= xb; x++) {
        const X = cl * sinLon[x], Y = sl, Z = cl * cosLon[x];
        const cz = R[6] * X + R[7] * Y + R[8] * Z;
        if (cz <= 0.05) continue;
        const u = (f * (R[0] * X + R[1] * Y + R[2] * Z)) / cz + cx;
        const v = (f * (R[3] * X + R[4] * Y + R[5] * Z)) / cz + cy;
        if (u < 0 || v < 0 || u >= im.width - 1 || v >= im.height - 1) continue;
        // Seam-style weight: distance to the frame edge, raised to a high
        // power, so the frame whose centre is nearest owns the pixel and
        // neighbours only blend in a narrow band. A plain average of every
        // overlapping frame is what doubles moving people and soft edges.
        const e = Math.min(u, v, im.width - 1 - u, im.height - 1 - v) / half + 1e-3;
        const w = e ** 6;
        const iu = u | 0, iv = v | 0, du = u - iu, dv = v - iv;
        const p = (iv * im.width + iu) * 4, d = im.data, o = y * W + x;
        for (let c = 0; c < 3; c++) {
          const a = d[p + c] * (1 - du) + d[p + 4 + c] * du;
          const b = d[p + im.width * 4 + c] * (1 - du) + d[p + im.width * 4 + 4 + c] * du;
          acc[o * 3 + c] += (a * (1 - dv) + b * dv) * gain * w;
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
      out[o * 4 + 3] = 255;
    } else {
      // uncovered: neutral grey, alpha 0 marks it for cropping
      out[o * 4] = out[o * 4 + 1] = out[o * 4 + 2] = 40;
      out[o * 4 + 3] = 0;
    }
  }
  return { data: out, width: W, height: H };
}

/** Canvas rows/columns a frame can touch (with a small margin). */
function footprint(C: M3, f: number, w: number, h: number, W: number, H: number) {
  let latMin = Infinity, latMax = -Infinity;
  const lons: number[] = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    for (const [u, v] of [[t * w, 0], [t * w, h], [0, t * h], [w, t * h]]) {
      const c: [number, number, number] = [(u - w / 2) / f, (v - h / 2) / f, 1];
      const X = C[0] * c[0] + C[1] * c[1] + C[2] * c[2];
      const Y = C[3] * c[0] + C[4] * c[1] + C[5] * c[2];
      const Z = C[6] * c[0] + C[7] * c[1] + C[8] * c[2];
      const lat = Math.atan2(Y, Math.hypot(X, Z));
      latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat);
      lons.push(Math.atan2(X, Z));
    }
  }
  // a pole inside the frame: the forward axis's angle to vertical beats the frame's half-diagonal
  const half = Math.atan(Math.hypot(w, h) / 2 / f);
  const fy = C[5]; // forward · world-down
  const poleInside = Math.acos(Math.min(1, Math.abs(fy))) < half;
  if (poleInside) { if (fy < 0) latMin = -Math.PI / 2; else latMax = Math.PI / 2; }
  const y0 = Math.max(0, Math.floor(((latMin + Math.PI / 2) / Math.PI) * H) - 2);
  const y1 = Math.min(H - 1, Math.ceil(((latMax + Math.PI / 2) / Math.PI) * H) + 2);
  if (poleInside) return { y0, y1, cols: [[0, W - 1]] as [number, number][] };
  // smallest arc covering all border longitudes (handles the ±180° wrap)
  const s = lons.sort((a, b) => a - b);
  let gap = 0, at = 0;
  for (let k = 0; k < s.length; k++) {
    const g = (k + 1 < s.length ? s[k + 1] : s[0] + 2 * Math.PI) - s[k];
    if (g > gap) { gap = g; at = k; }
  }
  const start = s[(at + 1) % s.length], end = s[at];
  const col = (lon: number) => Math.floor(((lon + Math.PI) / (2 * Math.PI)) * W);
  const a = col(start) - 2, b = col(end) + 2;
  if (start <= end) return { y0, y1, cols: [[Math.max(0, a), Math.min(W - 1, b)]] as [number, number][] };
  return { y0, y1, cols: [[Math.max(0, a), W - 1], [0, Math.min(W - 1, b)]] as [number, number][] };
}

export interface SphereCrop extends RGBAImage {
  fullW: number; fullH: number; left: number; top: number;
  /** degrees the image was turned so the uncovered part sits at the edges */
  headingDeg: number;
  partial: boolean;
}

/**
 * Crop a rendered sphere to what was actually captured, like GCam's partial
 * spheres. Columns are first rolled so the largest uncovered gap of longitudes
 * falls on the left/right edge, then the covered box is cut out. GPano's
 * CroppedArea fields record where the piece sits on the full sphere, so
 * viewers place it correctly and show the rest as empty.
 */
export function cropSphere(img: RGBAImage, margin = 0): SphereCrop {
  const { data, width: W, height: H } = img;
  const colHas = new Uint8Array(W), rowHas = new Uint8Array(H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3]) { colHas[x] = 1; rowHas[y] = 1; }
  // largest circular run of empty columns
  let bestLen = 0, bestEnd = -1, run = 0;
  for (let k = 0; k < 2 * W; k++) {
    if (!colHas[k % W]) { run++; if (run > bestLen && run <= W) { bestLen = run; bestEnd = k % W; } } else run = 0;
  }
  const minGap = Math.round(W * 0.02);
  const full = bestLen < minGap; // covers (almost) every heading
  // roll so the gap ends at column 0's left edge: new col = old col - shift
  const shift = full ? 0 : (bestEnd + 1) % W;
  let x0 = 0, x1 = W - 1;
  if (!full) { x0 = 0; x1 = W - bestLen - 1; }
  let y0 = 0, y1 = H - 1;
  while (y0 < H && !rowHas[y0]) y0++;
  while (y1 > y0 && !rowHas[y1]) y1--;
  if (full && y0 === 0 && y1 === H - 1) {
    for (let o = 3; o < data.length; o += 4) data[o] = 255;
    return { data, width: W, height: H, fullW: W, fullH: H, left: 0, top: 0, headingDeg: 0, partial: false };
  }
  x0 = Math.max(0, x0 - margin); x1 = Math.min(W - 1, x1 + margin);
  y0 = Math.max(0, y0 - margin); y1 = Math.min(H - 1, y1 + margin);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = (x0 + x + shift) % W, sy = y0 + y;
    const si = (sy * W + sx) * 4, di = (y * w + x) * 4;
    out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255;
  }
  // Centre the piece on the full canvas, as GCam does, and turn the recorded
  // heading by the same amount so it still points the right way.
  const left = full ? x0 : Math.floor((W - w) / 2);
  const headingDeg = (((shift + x0 - left) / W) * 360 + 360) % 360;
  return { data: out, width: w, height: h, fullW: W, fullH: H, left, top: y0, headingDeg, partial: true };
}
