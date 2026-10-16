// Small linear-algebra kit for rotation-only camera models.
// Matrices are row-major arrays of length 9.

export type M3 = number[];
export type V3 = [number, number, number];

export const I3 = (): M3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a: M3, b: M3): M3 {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

export function tr(a: M3): M3 {
  return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
}

export function mulv(a: M3, v: V3): V3 {
  return [
    a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
    a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
    a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
  ];
}

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Jacobi eigen-decomposition of a symmetric n×n matrix (row-major). */
export function symEig(A: number[], n: number): { values: number[]; vectors: number[][] } {
  const a = A.slice();
  const v: number[] = Array.from({ length: n * n }, (_, k) => (k % (n + 1) === 0 ? 1 : 0));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-30) continue;
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p], akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k], aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p], vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
  }
  const values = Array.from({ length: n }, (_, i) => a[i * n + i]);
  const vectors = Array.from({ length: n }, (_, j) => Array.from({ length: n }, (_, i) => v[i * n + j]));
  return { values, vectors };
}

/**
 * Best rotation R with b ≈ R a for unit-vector pairs (Horn's quaternion method).
 */
export function kabsch(as: V3[], bs: V3[]): M3 {
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let k = 0; k < as.length; k++) {
    const a = as[k], b = bs[k];
    Sxx += a[0] * b[0]; Sxy += a[0] * b[1]; Sxz += a[0] * b[2];
    Syx += a[1] * b[0]; Syy += a[1] * b[1]; Syz += a[1] * b[2];
    Szx += a[2] * b[0]; Szy += a[2] * b[1]; Szz += a[2] * b[2];
  }
  const N = [
    Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx,
    Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz,
    Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy,
    Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz,
  ];
  const { values, vectors } = symEig(N, 4);
  let best = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i;
  const [w, x, y, z] = vectors[best];
  return quatToMat(w, x, y, z);
}

export function quatToMat(w: number, x: number, y: number, z: number): M3 {
  const l = Math.hypot(w, x, y, z) || 1;
  w /= l; x /= l; y /= l; z /= l;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

export function rotAxis(axis: V3, ang: number): M3 {
  const [x, y, z] = norm(axis);
  const s = Math.sin(ang / 2);
  return quatToMat(Math.cos(ang / 2), x * s, y * s, z * s);
}

/** Ray (camera coords: x right, y down, z forward) for pixel (u,v). */
export function pixRay(u: number, v: number, f: number, cx: number, cy: number): V3 {
  return norm([(u - cx) / f, (v - cy) / f, 1]);
}

/**
 * Horizontal wave correction (after OpenCV's waveCorrect).
 * `C` are camera→world rotations; returns world rotation W so that W·C has
 * a level horizon: world y = down, world z = average view direction.
 */
export function waveCorrect(C: M3[]): M3 {
  const mom = new Array(9).fill(0);
  const ySum: V3 = [0, 0, 0], zSum: V3 = [0, 0, 0];
  for (const c of C) {
    const x: V3 = [c[0], c[3], c[6]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) mom[i * 3 + j] += x[i] * x[j];
    for (let i = 0; i < 3; i++) { ySum[i] += c[i * 3 + 1]; zSum[i] += c[i * 3 + 2]; }
  }
  const { values, vectors } = symEig(mom, 3);
  let small = 0;
  for (let i = 1; i < 3; i++) if (values[i] < values[small]) small = i;
  let rg1 = norm(vectors[small] as V3);
  if (dot(rg1, ySum) < 0) rg1 = [-rg1[0], -rg1[1], -rg1[2]];
  let rg0 = cross(rg1, zSum);
  if (Math.hypot(...rg0) < 1e-9) rg0 = cross(rg1, [1, 0, 0]);
  rg0 = norm(rg0);
  const rg2 = norm(cross(rg0, rg1));
  return [...rg0, ...rg1, ...rg2];
}
