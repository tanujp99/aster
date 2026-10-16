// In-browser panorama engine.
//
// Model: a camera rotating about its optical centre (handheld sweep), one
// shared focal length, no lens distortion (phone JPEGs are already corrected).
// Steps:
//   1. ORB features on downscaled frames, ratio-test matching of neighbours,
//      RANSAC homography to get clean inliers.
//   2. Focal length found by a 1-D search that minimises the rotation-model
//      reprojection error over every neighbour pair.
//   3. Relative rotations by Horn/Kabsch on the inlier rays, chained.
//   4. Horizon levelling (wave correction) so the sweep is not tilted.
//   5. Exposure gains from overlap brightness, normalised to the median frame.
//   6. Cylindrical render at native resolution (or a memory-capped scale),
//      one frame at a time, with a feathered seam midway between neighbours.
//   7. Auto-crop to the largest rectangle with no empty corners.

import { loadCV } from './cv';
import {
  I3, M3, V3, kabsch, mul, mulv, pixRay, tr, waveCorrect,
} from './math';

export interface RGBAImage { data: Uint8ClampedArray; width: number; height: number }

export interface FrameSource {
  count: number;
  name(i: number): string;
  /** Decoded frame, long side scaled to at most `maxSide` (orientation applied). */
  loadScaled(i: number, maxSide: number): Promise<RGBAImage>;
  /** Full-resolution decoded frame. */
  loadFull(i: number): Promise<RGBAImage>;
}

export interface PanoOptions {
  /** Upper bound on output megapixels (browser memory guard). */
  maxMegapixels: number;
  /** Hard canvas limit per side (Chrome: 32767). */
  maxSide: number;
  matchSide: number;
  exposure: boolean;
  /** 35 mm-equivalent focal length from EXIF, if the camera wrote it. */
  focal35?: number;
  /** Skip auto-crop (debugging). */
  noCrop?: boolean;
}

export const defaultPanoOptions: PanoOptions = {
  maxMegapixels: 80,
  maxSide: 32000,
  matchSide: 1400,
  exposure: true,
};

export type Progress = (stage: string, done: number, total: number) => void;

interface Pair { i: number; j: number; pi: number[][]; pj: number[][]; inliers: number }

export interface PanoResult extends RGBAImage {
  info: {
    frames: number;
    focalPx: number;
    hfovDeg: number;
    sweepDeg: number;
    scale: number;
    gains: number[];
  };
}

export async function stitchPanorama(
  src: FrameSource,
  opts: PanoOptions = defaultPanoOptions,
  progress: Progress = () => {},
): Promise<PanoResult> {
  if (src.count < 2) throw new Error('Need at least two photos.');
  const { cv } = await loadCV();

  // ---- 1. features -------------------------------------------------------
  const orb = new cv.ORB(5000);
  type Feat = { kp: number[][]; des: any; gray: Uint8Array; w: number; h: number };
  const feats: Feat[] = [];
  let mw = 0, mh = 0;
  for (let i = 0; i < src.count; i++) {
    progress('Finding features', i, src.count);
    const im = await src.loadScaled(i, opts.matchSide);
    if (i === 0) { mw = im.width; mh = im.height; }
    else if (im.width !== mw || im.height !== mh)
      throw new Error(`${src.name(i)} has a different size or orientation from the first photo.`);
    const rgba = cv.matFromImageData({ data: im.data, width: im.width, height: im.height });
    const gray = new cv.Mat();
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    const kps = new cv.KeyPointVector();
    const des = new cv.Mat();
    const none = new cv.Mat();
    orb.detectAndCompute(gray, none, kps, des);
    const kp: number[][] = [];
    for (let k = 0; k < kps.size(); k++) { const p = kps.get(k).pt; kp.push([p.x, p.y]); }
    feats.push({ kp, des, gray: new Uint8Array(gray.data), w: im.width, h: im.height });
    rgba.delete(); gray.delete(); kps.delete(); none.delete();
  }
  orb.delete();

  // ---- matching neighbours ------------------------------------------------
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const matchPair = (i: number, j: number): Pair | null => {
    const a = feats[i], b = feats[j];
    if (a.kp.length < 20 || b.kp.length < 20) return null;
    const mv = new cv.DMatchVectorVector();
    bf.knnMatch(a.des, b.des, mv, 2);
    const pi: number[][] = [], pj: number[][] = [];
    for (let k = 0; k < mv.size(); k++) {
      const m = mv.get(k);
      if (m.size() < 2) continue;
      const m0 = m.get(0), m1 = m.get(1);
      if (m0.distance < 0.75 * m1.distance) { pi.push(a.kp[m0.queryIdx]); pj.push(b.kp[m0.trainIdx]); }
    }
    mv.delete();
    if (pi.length < 15) return null;
    const A = cv.matFromArray(pi.length, 1, cv.CV_32FC2, pi.flat());
    const B = cv.matFromArray(pj.length, 1, cv.CV_32FC2, pj.flat());
    const mask = new cv.Mat();
    const H = cv.findHomography(A, B, cv.RANSAC, 3.0, mask);
    const ii: number[][] = [], jj: number[][] = [];
    if (!H.empty()) for (let k = 0; k < pi.length; k++) if (mask.data[k]) { ii.push(pi[k]); jj.push(pj[k]); }
    A.delete(); B.delete(); mask.delete(); H.delete();
    if (ii.length < 15) return null;
    return { i, j, pi: ii, pj: jj, inliers: ii.length };
  };

  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < src.count; i++) {
    progress('Matching neighbours', i, src.count - 1);
    const p = matchPair(i, i + 1);
    if (!p) throw new Error(
      `Couldn't find enough overlap between ${src.name(i)} and ${src.name(i + 1)}. ` +
      'Photos must be in shooting order with roughly 30% overlap.');
    pairs.push(p);
  }
  // Second-neighbour pairs make the chain stiffer (optional, only if found).
  const extra: Pair[] = [];
  for (let i = 0; i + 2 < src.count; i++) { const p = matchPair(i, i + 2); if (p && p.inliers >= 30) extra.push(p); }
  bf.delete();
  feats.forEach((f) => f.des.delete());

  // ---- 2. focal length search --------------------------------------------
  const cx = mw / 2, cy = mh / 2;
  const pairError = (p: Pair, f: number) => {
    const a = p.pi.map(([u, v]) => pixRay(u, v, f, cx, cy));
    const b = p.pj.map(([u, v]) => pixRay(u, v, f, cx, cy));
    const R = kabsch(a, b);
    let e = 0;
    for (let k = 0; k < a.length; k++) {
      const r = mulv(R, a[k]);
      const u = f * r[0] / r[2] + cx, v = f * r[1] / r[2] + cy;
      e += Math.min((u - p.pj[k][0]) ** 2 + (v - p.pj[k][1]) ** 2, 400);
    }
    return { R, e: e / a.length };
  };
  const total = (f: number) => pairs.reduce((s, p) => s + pairError(p, f).e, 0);
  progress('Estimating lens', 0, 1);
  // A narrow lens on a horizontal sweep barely constrains focal length (a
  // shift looks the same at any f), so EXIF wins when the camera reports it.
  const f = opts.focal35
    ? (opts.focal35 * Math.hypot(mw, mh)) / 43.27 // 35 mm equivalent is defined on the diagonal
    : searchFocal(total, Math.max(mw, mh));

  // ---- 3. rotations: chain, then a few rounds of averaging with i+2 pairs --
  // R[i] maps world → camera i.
  const rel = pairs.map((p) => pairError(p, f).R); // camera i → camera i+1
  let R: M3[] = [I3()];
  for (let i = 0; i < rel.length; i++) R.push(mul(rel[i], R[i]));
  if (extra.length) {
    const relX = new Map<string, M3>();
    for (const p of extra) relX.set(`${p.i}`, pairError(p, f).R);
    for (let it = 0; it < 10; it++) {
      const next = R.slice();
      for (let i = 1; i < R.length; i++) {
        const cands: M3[] = [mul(rel[i - 1], R[i - 1])];
        if (i + 1 < R.length) cands.push(mul(tr(rel[i]), R[i + 1]));
        const x2a = relX.get(`${i - 2}`); if (x2a && i >= 2) cands.push(mul(x2a, R[i - 2]));
        const x2b = relX.get(`${i}`); if (x2b && i + 2 < R.length) cands.push(mul(tr(x2b), R[i + 2]));
        next[i] = averageRotations(cands);
      }
      R = next;
    }
  }

  // ---- 4. level the horizon ----------------------------------------------
  const C = R.map(tr); // camera → world
  const W0 = waveCorrect(C);
  // Handheld sweeps often drift in pitch as well; wave correction alone then
  // leaves a slanted horizon. Like the helper, pick the whole-pano roll that
  // puts every frame centre on one level line.
  const fwd0 = C.map((c) => mulv(W0, [c[2], c[5], c[8]]));
  let bestR = 0, bestV = Infinity;
  for (let k = -300; k <= 300; k++) {
    const r = (k / 20) * (Math.PI / 180);
    const cr = Math.cos(r), sr = Math.sin(r);
    const ps = fwd0.map((v) => Math.asin(Math.max(-1, Math.min(1, sr * v[0] + cr * v[1]))));
    const m = ps.reduce((a, b) => a + b, 0) / ps.length;
    const vr = ps.reduce((a, b) => a + (b - m) ** 2, 0);
    if (vr < bestV) { bestV = vr; bestR = r; }
  }
  const Rz: M3 = [Math.cos(bestR), -Math.sin(bestR), 0, Math.sin(bestR), Math.cos(bestR), 0, 0, 0, 1];
  const W = mul(Rz, W0);
  const Rw = C.map((c) => tr(mul(W, c))); // world' → camera

  // ---- 5. exposure gains --------------------------------------------------
  let gains = new Array(src.count).fill(1);
  if (opts.exposure) {
    const obs = [...pairs, ...extra].map((p) => {
      const A = feats[p.i], B = feats[p.j];
      let sa = 0, sb = 0;
      for (let k = 0; k < p.pi.length; k++) {
        sa += sampleBox(A.gray, A.w, A.h, p.pi[k][0], p.pi[k][1]);
        sb += sampleBox(B.gray, B.w, B.h, p.pj[k][0], p.pj[k][1]);
      }
      return { i: p.i, j: p.j, a: sa / p.pi.length, b: sb / p.pi.length, cnt: p.pi.length };
    });
    gains = solveGains(src.count, obs).map((x) => Math.min(1.5, Math.max(0.67, x)));
  }

  // ---- 6. layout ----------------------------------------------------------
  const full0 = await src.loadFull(0);
  const FW = full0.width, FH = full0.height;
  const s = FW / mw; // match → full scale
  const fFull = f * s, fcx = FW / 2, fcy = FH / 2;

  // angular footprint of each frame on the cylinder
  const centres: number[] = [];
  let tMin = Infinity, tMax = -Infinity, hMin = Infinity, hMax = -Infinity;
  const toCyl = (Rc: M3, u: number, v: number): [number, number] => {
    const ray = mulv(tr(Rc), pixRay(u, v, fFull, fcx, fcy));
    return [Math.atan2(ray[0], ray[2]), ray[1] / Math.hypot(ray[0], ray[2])];
  };
  for (const Rc of Rw) {
    const fwd = mulv(tr(Rc), [0, 0, 1]);
    centres.push(Math.atan2(fwd[0], fwd[2]));
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      for (const [u, v] of [[t * FW, 0], [t * FW, FH], [0, t * FH], [FW, t * FH]] as [number, number][]) {
        const [th, h] = toCyl(Rc, u, v);
        tMin = Math.min(tMin, th); tMax = Math.max(tMax, th);
        hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
      }
    }
  }
  const sweep = tMax - tMin;
  if (sweep > 2 * Math.PI * 0.98) throw new Error('This looks like a full 360° set; use Photo Sphere mode.');

  let scale = 1;
  const nativeW = fFull * sweep, nativeH = fFull * (hMax - hMin);
  const mp = (nativeW * nativeH) / 1e6;
  if (mp > opts.maxMegapixels) scale = Math.sqrt(opts.maxMegapixels / mp);
  scale = Math.min(scale, opts.maxSide / nativeW, opts.maxSide / nativeH);
  const fo = fFull * scale;
  const OW = Math.ceil(fo * sweep), OH = Math.ceil(fo * (hMax - hMin));
  const out = new Uint8ClampedArray(OW * OH * 4);

  // render order follows the sweep direction
  const order = centres.map((c, i) => [c, i] as [number, number]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const seamCol = (k: number) => Math.round(((centres[order[k - 1]] + centres[order[k]]) / 2 - tMin) * fo);
  const feather = Math.max(16, Math.round(fo * 0.02));

  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    progress('Rendering', k, order.length);
    const im = i === 0 ? full0 : await src.loadFull(i);
    const Rc = Rw[i], gain = gains[i];
    // column range this frame can touch
    let cMin = Infinity, cMax = -Infinity;
    for (let q = 0; q <= 32; q++) {
      const t = q / 32;
      for (const [u, v] of [[t * FW, 0], [t * FW, FH], [0, t * FH], [FW, t * FH]] as [number, number][]) {
        const [th] = toCyl(Rc, u, v);
        const c = (th - tMin) * fo; cMin = Math.min(cMin, c); cMax = Math.max(cMax, c);
      }
    }
    const c0 = Math.max(0, Math.floor(cMin)), c1 = Math.min(OW - 1, Math.ceil(cMax));
    const seamL = k > 0 ? seamCol(k) : -1e9;
    const seamR = k + 1 < order.length ? seamCol(k + 1) : 1e9;
    renderFrame(im, Rc, fFull, fcx, fcy, gain, out, OW, OH, fo, tMin, hMin, c0, c1, seamL, seamR, feather);
  }

  // ---- 7. crop -------------------------------------------------------------
  progress('Cropping', 0, 1);
  const cropped = opts.noCrop ? { data: out, width: OW, height: OH } : autoCrop(out, OW, OH);
  return {
    ...cropped,
    info: {
      frames: src.count,
      focalPx: fFull,
      hfovDeg: (2 * Math.atan(FW / 2 / fFull) * 180) / Math.PI,
      sweepDeg: (sweep * 180) / Math.PI,
      scale,
      gains,
    },
  };
}

function searchFocal(total: (f: number) => number, side: number): number {
  const L0 = Math.log(side * 0.3), L1 = Math.log(side * 25), n = 40, step = (L1 - L0) / n;
  let bestL = L0, bestE = Infinity;
  for (let k = 0; k <= n; k++) {
    const L = L0 + step * k, e = total(Math.exp(L));
    if (e < bestE) { bestE = e; bestL = L; }
  }
  let lo = bestL - step, hi = bestL + step;
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo);
  let f1 = total(Math.exp(x1)), f2 = total(Math.exp(x2));
  for (let k = 0; k < 40; k++) {
    if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = total(Math.exp(x1)); }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = total(Math.exp(x2)); }
  }
  return Math.exp((lo + hi) / 2);
}

/**
 * Gain compensation (after OpenCV's GainCompensator): minimise
 *   Σ n_ij (g_i·I_ij − g_j·I_ji)² / σN²  +  Σ n_i (1 − g_i)² / σg²
 * so frames agree in their overlaps while staying close to their own exposure.
 */
function solveGains(n: number, obs: { i: number; j: number; a: number; b: number; cnt: number }[]): number[] {
  const sN = 10, sG = 0.1;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const B = new Array(n).fill(0);
  for (const { i, j, a, b, cnt } of obs) {
    A[i][i] += (cnt * a * a) / sN ** 2 + cnt / sG ** 2; B[i] += cnt / sG ** 2;
    A[j][j] += (cnt * b * b) / sN ** 2 + cnt / sG ** 2; B[j] += cnt / sG ** 2;
    A[i][j] -= (cnt * a * b) / sN ** 2; A[j][i] -= (cnt * a * b) / sN ** 2;
  }
  for (let i = 0; i < n; i++) if (A[i][i] === 0) { A[i][i] = 1; B[i] = 1; }
  // Gaussian elimination (system is small and symmetric positive definite)
  for (let c = 0; c < n; c++) {
    for (let r = c + 1; r < n; r++) {
      const k = A[r][c] / A[c][c];
      if (!k) continue;
      for (let q = c; q < n; q++) A[r][q] -= k * A[c][q];
      B[r] -= k * B[c];
    }
  }
  const g = new Array(n).fill(1);
  for (let r = n - 1; r >= 0; r--) {
    let s = B[r];
    for (let q = r + 1; q < n; q++) s -= A[r][q] * g[q];
    g[r] = s / A[r][r];
  }
  return g;
}

function averageRotations(Rs: M3[]): M3 {
  // chordal mean: project the arithmetic mean back onto SO(3) via Kabsch
  const a: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const as: V3[] = [], bs: V3[] = [];
  for (const R of Rs) for (const e of a) { as.push(e); bs.push(mulv(R, e)); }
  return kabsch(as, bs);
}

function sampleBox(g: Uint8Array, w: number, h: number, x: number, y: number) {
  let s = 0, n = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
    if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += g[yy * w + xx]; n++; }
  }
  return n ? s / n : 0;
}

function renderFrame(
  im: RGBAImage, Rc: M3, f: number, cx: number, cy: number, gain: number,
  out: Uint8ClampedArray, OW: number, OH: number, fo: number, tMin: number, hMin: number,
  c0: number, c1: number, seamL: number, seamR: number, feather: number,
) {
  const { data, width: W, height: H } = im;
  const r = Rc;
  const half = feather / 2;
  for (let col = c0; col <= c1; col++) {
    // weight of this frame vs whatever is already there
    if (col < seamL - half || col > seamR + half) continue;
    const wL = col >= seamL + half ? 1 : (col - (seamL - half)) / feather;
    const th = col / fo + tMin;
    const st = Math.sin(th), ct = Math.cos(th);
    for (let row = 0; row < OH; row++) {
      const h = row / fo + hMin;
      // world ray (x right, y down, z forward), unnormalised is fine
      const X = st, Y = h, Z = ct;
      const x = r[0] * X + r[1] * Y + r[2] * Z;
      const y = r[3] * X + r[4] * Y + r[5] * Z;
      const z = r[6] * X + r[7] * Y + r[8] * Z;
      if (z <= 1e-6) continue;
      const u = f * x / z + cx - 0.5, v = f * y / z + cy - 0.5;
      if (u < 0 || v < 0 || u >= W - 1 || v >= H - 1) continue;
      const iu = u | 0, iv = v | 0, du = u - iu, dv = v - iv;
      const p = (iv * W + iu) * 4;
      const o = (row * OW + col) * 4;
      const had = out[o + 3] === 255;
      // right-hand seam: this frame fades out, the next one fades in later
      let w = col > seamR - half ? Math.max(0, 1 - (col - (seamR - half)) / feather) : 1;
      w = Math.min(w, wL);
      if (!had) w = 1;
      else if (w <= 0) continue;
      for (let c = 0; c < 3; c++) {
        const a = data[p + c] * (1 - du) + data[p + 4 + c] * du;
        const b = data[p + W * 4 + c] * (1 - du) + data[p + W * 4 + 4 + c] * du;
        const val = (a * (1 - dv) + b * dv) * gain;
        out[o + c] = had ? out[o + c] * (1 - w) + val * w : val;
      }
      out[o + 3] = 255;
    }
  }
}

/** Largest axis-aligned rectangle of fully covered pixels (fast, column-profile based). */
export function autoCrop(px: Uint8ClampedArray, W: number, H: number): RGBAImage {
  const top = new Int32Array(W).fill(H), bot = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (px[(y * W + x) * 4 + 3]) { top[x] = y; break; }
    for (let y = H - 1; y >= 0; y--) if (px[(y * W + x) * 4 + 3]) { bot[x] = y; break; }
  }
  // choose left/right trimming that maximises area
  const heights = Array.from(top, (t, x) => Math.max(0, bot[x] - t));
  const med = [...heights].sort((a, b) => a - b)[Math.floor(W / 2)];
  let best = { area: 0, x0: 0, x1: W - 1, y0: 0, y1: H - 1 };
  const steps = 60;
  for (let a = 0; a < steps; a++) {
    const x0 = Math.floor((a / steps) * W * 0.25);
    for (let b = 0; b < steps; b++) {
      const x1 = W - 1 - Math.floor((b / steps) * W * 0.25);
      if (heights[x0] < med * 0.3 || heights[x1] < med * 0.3) continue;
      let y0 = 0, y1 = H - 1;
      for (let x = x0; x <= x1; x += 2) { if (top[x] > y0) y0 = top[x]; if (bot[x] < y1) y1 = bot[x]; }
      const area = (x1 - x0) * Math.max(0, y1 - y0);
      if (area > best.area) best = { area, x0, x1, y0: y0 + 1, y1: y1 - 1 };
    }
  }
  const w = best.x1 - best.x0 + 1, h = Math.max(1, best.y1 - best.y0 + 1);
  const outPx = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    outPx.set(px.subarray(((best.y0 + y) * W + best.x0) * 4, ((best.y0 + y) * W + best.x0 + w) * 4), y * w * 4);
  return { data: outPx, width: w, height: h };
}
