// Photo Sphere alignment: the approach GCam's Photo Sphere uses, rebuilt.
//
// The Pixel camera never trusted its gyroscope alone. Sensors give a starting
// layout and the gravity direction; the images then decide the exact
// placement. Here:
//   1. ORB features on every frame (downscaled).
//   2. Candidate pairs come from the sensor layout: only frames whose view
//      directions are close enough to overlap are matched, so look-alike
//      walls and ceilings on opposite sides never get linked.
//   3. Ratio test + RANSAC homography (a pure rotation is a homography).
//   4. Rotation-only bundle adjustment (Levenberg–Marquardt) over every
//      frame's orientation plus one shared focal length, minimising the
//      angle between matched rays. A weak prior ties each frame to its
//      sensor reading, which fixes the overall heading and keeps the horizon
//      level from the accelerometer.
//   5. Gain compensation from the matched overlaps.
// The renderer then uses seam-style weights (one frame dominates each pixel,
// with a narrow blend), so a person who moved between shots isn't doubled.

import { loadCV } from './cv';
import { M3, V3, mul, mulv, rotAxis, norm } from './math';
import type { RGBAImage } from './panorama';
import { solveGains } from './panorama';

export interface AlignInput {
  /** sensor camera→world rotations */
  C: M3[];
  hfovDeg: number;
  load(i: number, maxSide: number): Promise<RGBAImage>;
  progress(stage: string, done: number, total: number): void;
}

export interface AlignResult { C: M3[]; hfovDeg: number; gains: number[]; pairs: number; rmsDeg: number }

const MATCH_SIDE = 1024;

export async function alignSphere(inp: AlignInput): Promise<AlignResult> {
  const { cv } = await loadCV();
  const n = inp.C.length;
  const orb = new cv.ORB(3000);
  const feats: { kp: number[][]; des: any; gray: Uint8Array; w: number; h: number }[] = [];
  for (let i = 0; i < n; i++) {
    inp.progress('Finding features', i, n);
    const im = await inp.load(i, MATCH_SIDE);
    const rgba = cv.matFromImageData({ data: im.data, width: im.width, height: im.height });
    const gray = new cv.Mat(); cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    const kps = new cv.KeyPointVector(), des = new cv.Mat(), none = new cv.Mat();
    orb.detectAndCompute(gray, none, kps, des);
    const kp: number[][] = [];
    for (let k = 0; k < kps.size(); k++) { const p = kps.get(k).pt; kp.push([p.x, p.y]); }
    feats.push({ kp, des, gray: new Uint8Array(gray.data), w: im.width, h: im.height });
    rgba.delete(); gray.delete(); kps.delete(); none.delete();
  }
  orb.delete();
  const W = feats[0].w, H = feats[0].h, cx = W / 2, cy = H / 2;
  let f = W / 2 / Math.tan((inp.hfovDeg * Math.PI) / 360);
  const ray = (u: number, v: number, ff: number): V3 => norm([(u - cx) / ff, (v - cy) / ff, 1]);

  // ---- candidate pairs from the sensor layout -----------------------------
  const diagFov = 2 * Math.atan(Math.hypot(W, H) / 2 / f);
  const fwd = inp.C.map((c) => [c[2], c[5], c[8]] as V3);
  const cand: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const ang = Math.acos(Math.max(-1, Math.min(1, fwd[i][0] * fwd[j][0] + fwd[i][1] * fwd[j][1] + fwd[i][2] * fwd[j][2])));
    if (ang < diagFov * 0.95) cand.push([i, j]);
  }

  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const pix: { i: number; j: number; pi: number[][]; pj: number[][] }[] = [];
  cand.forEach(([i, j], k) => {
    inp.progress('Matching overlaps', k, cand.length);
    const A = feats[i], B = feats[j];
    if (A.kp.length < 20 || B.kp.length < 20) return;
    const mv = new cv.DMatchVectorVector();
    bf.knnMatch(A.des, B.des, mv, 2);
    const pi: number[][] = [], pj: number[][] = [];
    for (let q = 0; q < mv.size(); q++) {
      const m = mv.get(q);
      if (m.size() < 2) continue;
      const m0 = m.get(0), m1 = m.get(1);
      if (m0.distance < 0.75 * m1.distance) { pi.push(A.kp[m0.queryIdx]); pj.push(B.kp[m0.trainIdx]); }
    }
    mv.delete();
    if (pi.length < 20) return;
    const PA = cv.matFromArray(pi.length, 1, cv.CV_32FC2, pi.flat());
    const PB = cv.matFromArray(pj.length, 1, cv.CV_32FC2, pj.flat());
    const mask = new cv.Mat();
    const Hm = cv.findHomography(PA, PB, cv.RANSAC, 4.0, mask);
    const ii: number[][] = [], jj: number[][] = [];
    if (!Hm.empty()) for (let q = 0; q < pi.length; q++) if (mask.data[q]) { ii.push(pi[q]); jj.push(pj[q]); }
    PA.delete(); PB.delete(); mask.delete(); Hm.delete();
    if (ii.length < 16) return;
    // keep at most 50 well-spread points per pair
    const step = Math.max(1, Math.floor(ii.length / 50));
    const si: number[][] = [], sj: number[][] = [];
    for (let q = 0; q < ii.length; q += step) { si.push(ii[q]); sj.push(jj[q]); }
    pix.push({ i, j, pi: si, pj: sj });
  });
  bf.delete();
  feats.forEach((x) => x.des.delete());

  // ---- bundle adjustment ----------------------------------------------------
  // params: ω (3 per frame, small rotation in camera frame), then log f
  const P = 3 * n + 1;
  const x = new Float64Array(P);
  x[3 * n] = Math.log(f);
  const rotOf = (k: number, xs: Float64Array): M3 => {
    const w: V3 = [xs[3 * k], xs[3 * k + 1], xs[3 * k + 2]];
    const a = Math.hypot(...w);
    return a < 1e-12 ? inp.C[k] : mul(inp.C[k], rotAxis(w, a));
  };
  // Objective: Σ log(1 + |r|²/σ²) over matched rays (Cauchy, robust to bad matches)
  //          + Σ (ω/σp)² tying each frame to its sensor reading.
  const sigma = 2 / f;          // ~2 px of mismatch, in radians
  const sigmaP = (3 * Math.PI) / 180; // phone sensors are good to a few degrees

  const corr: { i: number; j: number; u: number[]; v: number[] }[] = [];
  for (const p of pix) for (let q = 0; q < p.pi.length; q++) corr.push({ i: p.i, j: p.j, u: p.pi[q], v: p.pj[q] });

  const resid = (c: (typeof corr)[number], Ri: M3, Rj: M3, ff: number): V3 => {
    const a = mulv(Ri, ray(c.u[0], c.u[1], ff)), b = mulv(Rj, ray(c.v[0], c.v[1], ff));
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  };
  const cost = (xs: Float64Array) => {
    const R = Array.from({ length: n }, (_, k) => rotOf(k, xs));
    const ff = Math.exp(xs[3 * n]);
    let e = 0;
    for (const c of corr) {
      const r = resid(c, R[c.i], R[c.j], ff);
      const s = (r[0] ** 2 + r[1] ** 2 + r[2] ** 2) / sigma ** 2;
      e += Math.log1p(s);
    }
    for (let k = 0; k < 3 * n; k++) e += (xs[k] / sigmaP) ** 2;
    return e;
  };

  let lambda = 1e-3;
  let cur = cost(x);
  const iters = corr.length ? 25 : 0;
  for (let it = 0; it < iters; it++) {
    inp.progress('Aligning (bundle adjustment)', it, iters);
    const R = Array.from({ length: n }, (_, k) => rotOf(k, x));
    const ff = Math.exp(x[3 * n]);
    const JtJ = new Float64Array(P * P), Jtr = new Float64Array(P);
    const eps = 1e-6;
    for (const c of corr) {
      const r0 = resid(c, R[c.i], R[c.j], ff);
      const s = (r0[0] ** 2 + r0[1] ** 2 + r0[2] ** 2) / sigma ** 2;
      const wgt = 1 / (1 + s) / sigma ** 2; // Cauchy IRLS weight, in σ units
      const idx = [3 * c.i, 3 * c.i + 1, 3 * c.i + 2, 3 * c.j, 3 * c.j + 1, 3 * c.j + 2, 3 * n];
      const J: V3[] = idx.map((p) => {
        const save = x[p];
        x[p] = save + eps;
        const Ri = p >= 3 * c.i && p < 3 * c.i + 3 ? rotOf(c.i, x) : R[c.i];
        const Rj = p >= 3 * c.j && p < 3 * c.j + 3 ? rotOf(c.j, x) : R[c.j];
        const r1 = resid(c, Ri, Rj, p === 3 * n ? Math.exp(x[p]) : ff);
        x[p] = save;
        return [(r1[0] - r0[0]) / eps, (r1[1] - r0[1]) / eps, (r1[2] - r0[2]) / eps] as V3;
      });
      for (let a = 0; a < 7; a++) {
        const pa = idx[a];
        Jtr[pa] += wgt * (J[a][0] * r0[0] + J[a][1] * r0[1] + J[a][2] * r0[2]);
        for (let b = 0; b < 7; b++) {
          const pb = idx[b];
          JtJ[pa * P + pb] += wgt * (J[a][0] * J[b][0] + J[a][1] * J[b][1] + J[a][2] * J[b][2]);
        }
      }
    }
    // sensor prior on each ω
    const pw = 1 / sigmaP ** 2;
    for (let k = 0; k < 3 * n; k++) { JtJ[k * P + k] += pw; Jtr[k] += pw * x[k]; }

    let improved = false;
    for (let tries = 0; tries < 6 && !improved; tries++) {
      const A = Float64Array.from(JtJ);
      for (let k = 0; k < P; k++) A[k * P + k] *= 1 + lambda;
      const d = solve(A, Jtr.map((v) => -v), P);
      if (!d) { lambda *= 10; continue; }
      const xn = Float64Array.from(x);
      for (let k = 0; k < P; k++) xn[k] += d[k];
      const c2 = cost(xn);
      if (c2 < cur) { x.set(xn); cur = c2; lambda = Math.max(1e-7, lambda / 3); improved = true; }
      else lambda *= 8;
    }
    if (!improved) break;
  }

  const Cn = Array.from({ length: n }, (_, k) => rotOf(k, x));
  f = Math.exp(x[3 * n]);
  // residual in degrees, for the log
  let se = 0;
  for (const c of corr) { const r = resid(c, Cn[c.i], Cn[c.j], f); se += r[0] ** 2 + r[1] ** 2 + r[2] ** 2; }
  const rmsDeg = corr.length ? (Math.sqrt(se / corr.length) * 180) / Math.PI : 0;

  // ---- exposure -------------------------------------------------------------
  const obs = pix.map((p) => {
    const A = feats[p.i], B = feats[p.j];
    let sa = 0, sb = 0;
    for (let q = 0; q < p.pi.length; q++) { sa += box(A.gray, A.w, A.h, p.pi[q]); sb += box(B.gray, B.w, B.h, p.pj[q]); }
    return { i: p.i, j: p.j, a: sa / p.pi.length, b: sb / p.pi.length, cnt: p.pi.length };
  });
  const gains = solveGains(n, obs).map((g) => Math.min(1.5, Math.max(0.67, g)));
  return { C: Cn, hfovDeg: (2 * Math.atan(W / 2 / f) * 180) / Math.PI, gains, pairs: pix.length, rmsDeg };
}

function box(g: Uint8Array, w: number, h: number, [x, y]: number[]) {
  let s = 0, k = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
    if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += g[yy * w + xx]; k++; }
  }
  return k ? s / k : 0;
}

function solve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = Float64Array.from(A), y = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[piv * n + c])) piv = r;
    if (Math.abs(M[piv * n + c]) < 1e-18) return null;
    if (piv !== c) {
      for (let q = 0; q < n; q++) { const t = M[c * n + q]; M[c * n + q] = M[piv * n + q]; M[piv * n + q] = t; }
      const t = y[c]; y[c] = y[piv]; y[piv] = t;
    }
    for (let r = c + 1; r < n; r++) {
      const k = M[r * n + c] / M[c * n + c];
      if (!k) continue;
      for (let q = c; q < n; q++) M[r * n + q] -= k * M[c * n + q];
      y[r] -= k * y[c];
    }
  }
  const out = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = y[r];
    for (let q = r + 1; q < n; q++) s -= M[r * n + q] * out[q];
    out[r] = s / M[r * n + r];
  }
  return out;
}
