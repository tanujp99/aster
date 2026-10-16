// Phone motion sensors → camera rotation.
//
// DeviceOrientation gives the device frame (x right, y toward the top of the
// screen, z out of the screen) in an Earth frame (x east, y north, z up):
//   R = Rz(alpha) · Rx(beta) · Ry(gamma).
// The rear camera looks along −z of the device. Aster's world frame is
// x east, y down, z north; camera frame is x right, y down, z forward.

import { M3, V3, mul, norm, cross, dot } from '../engine/math';

const d2r = Math.PI / 180;

function deviceToEarth(alpha: number, beta: number, gamma: number): M3 {
  const a = alpha * d2r, b = beta * d2r, g = gamma * d2r;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  const Rz: M3 = [ca, -sa, 0, sa, ca, 0, 0, 0, 1];
  const Rx: M3 = [1, 0, 0, 0, cb, -sb, 0, sb, cb];
  const Ry: M3 = [cg, 0, sg, 0, 1, 0, -sg, 0, cg];
  return mul(mul(Rz, Rx), Ry);
}

const EARTH_TO_WORLD: M3 = [1, 0, 0, 0, 0, -1, 0, 1, 0];
const CAM_TO_DEVICE: M3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

/** camera→world rotation from a DeviceOrientation reading (portrait hold). */
export function cameraRotation(alpha: number, beta: number, gamma: number): M3 {
  return mul(mul(EARTH_TO_WORLD, deviceToEarth(alpha, beta, gamma)), CAM_TO_DEVICE);
}

export const col = (C: M3, k: number): V3 => [C[k], C[3 + k], C[6 + k]];

/** World direction for yaw (right +) and pitch (up +), degrees. */
export function dirFromYawPitch(yaw: number, pitch: number): V3 {
  const y = yaw * d2r, p = pitch * d2r;
  return [Math.cos(p) * Math.sin(y), -Math.sin(p), Math.cos(p) * Math.cos(y)];
}

/** Hugin-style yaw/pitch/roll (degrees) of a camera→world rotation. */
export function yawPitchRoll(C: M3): { yaw: number; pitch: number; roll: number } {
  const f = col(C, 2), d = col(C, 1);
  const yaw = Math.atan2(f[0], f[2]) / d2r;
  const pitch = Math.asin(Math.max(-1, Math.min(1, -f[1]))) / d2r;
  const down: V3 = [0, 1, 0];
  let d0: V3 = [down[0] - dot(down, f) * f[0], down[1] - dot(down, f) * f[1], down[2] - dot(down, f) * f[2]];
  if (Math.hypot(...d0) < 1e-6) d0 = col(C, 1);
  d0 = norm(d0);
  const roll = Math.atan2(dot(cross(d0, d), f), dot(d0, d)) / d2r;
  return { yaw, pitch, roll };
}

/** Sphere capture plan: rings of targets sized from the camera's field of view. */
export function capturePlan(hfovDeg: number): { yaw: number; pitch: number }[] {
  const step = hfovDeg * 0.68; // ~32% overlap
  const rings = [0, 45, -45];
  const pts: { yaw: number; pitch: number }[] = [];
  for (const p of rings) {
    const n = Math.max(4, Math.ceil((360 * Math.cos(p * d2r)) / step));
    for (let k = 0; k < n; k++) pts.push({ yaw: (k * 360) / n + (p ? 180 / n : 0), pitch: p });
  }
  pts.push({ yaw: 0, pitch: 89.9 }, { yaw: 0, pitch: -89.9 });
  return pts;
}

export interface OrientationFeed { C: M3 | null; stop(): void }

/** Start listening; iOS needs a user gesture for permission. */
export async function startOrientation(): Promise<OrientationFeed> {
  const DOE = (window as any).DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    const res = await DOE.requestPermission();
    if (res !== 'granted') throw new Error('Motion sensor permission was denied.');
  }
  const feed: OrientationFeed = { C: null, stop: () => window.removeEventListener('deviceorientation', on) };
  function on(e: DeviceOrientationEvent) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    feed.C = cameraRotation(e.alpha, e.beta, e.gamma);
  }
  window.addEventListener('deviceorientation', on);
  return feed;
}
