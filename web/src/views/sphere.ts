import { h, progressBar, fmtBytes } from '../ui/dom';
import { capturePlan, dirFromYawPitch, startOrientation, yawPitchRoll, col, type OrientationFeed } from '../capture/orientation';
import { M3, dot, mulv, tr } from '../engine/math';
import { browserSphere } from '../engine/run';
import { helperHealth, helperStitch } from '../lib/helper';
import { pickPhotos, imagesOnly, saveBlob, stamp } from '../lib/files';
import { makeZip } from '../lib/zip';
import { openInViewer } from './viewer';

interface Shot { blob: Blob; name: string; C: M3 | null; hfov: number }

const hfovKey = 'aster.hfov';

export function sphereView(): HTMLElement {
  let shots: Shot[] = [];
  const prog = progressBar();
  const status = h('p', { class: 'status' });
  const result = h('div', { class: 'result' });
  const summary = h('p', { class: 'muted' }, 'No frames yet');
  const actions = h('div', { class: 'row' });
  const hfov = h('input', { type: 'number', min: 20, max: 120, step: 1, value: localStorage.getItem(hfovKey) ?? '52', class: 'num' }) as HTMLInputElement;
  hfov.onchange = () => localStorage.setItem(hfovKey, hfov.value);

  const refresh = async () => {
    const withSensors = shots.filter((s) => s.C).length;
    summary.textContent = shots.length
      ? `${shots.length} frames · ${fmtBytes(shots.reduce((a, s) => a + s.blob.size, 0))} · ${withSensors === shots.length ? 'with phone orientation' : 'no orientation data (helper aligns them from the images)'}`
      : 'No frames yet';
    const helper = await helperHealth();
    actions.replaceChildren(
      ...(shots.length ? ([
        withSensors === shots.length
          ? h('button', { class: 'pill-link', onclick: () => stitchHere() }, 'Stitch preview here')
          : null,
        h('button', { class: 'pill-button', disabled: !helper?.ok, title: helper?.ok ? '' : 'Start the Aster helper on this computer', onclick: () => stitchHelper() },
          helper?.ok ? 'Stitch with local helper' : 'Local helper not running'),
        withSensors ? h('button', { class: 'pill-link', onclick: () => exportZip() }, 'Export frames (.zip)') : null,
      ].filter(Boolean) as HTMLElement[]) : []),
    );
  };

  async function finish(blob: Blob) {
    prog.hide();
    const name = `photosphere_${stamp()}.jpg`;
    const where = await saveBlob(blob, name);
    result.replaceChildren(
      h('p', {}, 'Saved to ', h('span', { class: 'mono' }, where), ' with Photo Sphere metadata.'),
      h('button', { class: 'pill-link', onclick: () => openInViewer(blob, name) }, 'Look around'),
    );
  }

  async function stitchHere() {
    status.textContent = ''; result.replaceChildren();
    try {
      const frames = shots.map((s) => ({ C: s.C!, hfovDeg: s.hfov }));
      const r = await browserSphere(shots.map((s) => s.blob), frames, 6144, 0.93, (st, f) => prog.set(st, f));
      await finish(r.blob);
    } catch (e) { fail(e); }
  }

  async function stitchHelper() {
    status.textContent = ''; result.replaceChildren();
    try {
      prog.set('Sending frames to the local helper', 0.02);
      const orient = shots.every((s) => s.C) ? shots.map((s) => ({ ...yawPitchRoll(s.C!), hfov: s.hfov })) : undefined;
      const blob = await helperStitch(shots.map((s) => s.blob), shots.map((s) => s.name), 'sphere', (job) => {
        const last = job.log[job.log.length - 1] ?? job.status;
        prog.set(`Helper: ${last.replace(/^\d\d:\d\d:\d\d /, '')}`, 0.5);
      }, orient);
      await finish(blob);
    } catch (e) { fail(e); }
  }

  async function exportZip() {
    const meta = shots.map((s) => ({ file: s.name, C: s.C, hfov: s.hfov, ...(s.C ? yawPitchRoll(s.C) : {}) }));
    const zip = await makeZip([
      ...shots.map((s) => ({ name: s.name, data: s.blob })),
      { name: 'orientations.json', data: new Blob([JSON.stringify(meta, null, 1)], { type: 'application/json' }) },
    ]);
    const where = await saveBlob(zip, `sphere_frames_${stamp()}.zip`);
    status.textContent = `Exported to ${where}. Unzip on your computer and open the folder under “Stitch photos”.`;
  }

  function fail(e: unknown) {
    prog.hide();
    status.textContent = e instanceof Error ? e.message : String(e);
    status.classList.add('error');
  }

  async function importPhotos(folder: boolean) {
    const all = await pickPhotos({ folder });
    const json = all.find((f) => f.name.toLowerCase() === 'orientations.json');
    let meta: any[] | null = null;
    if (json) { try { meta = JSON.parse(await json.text()); } catch { meta = null; } }
    const imgs = imagesOnly(all);
    shots = imgs.map((f) => {
      const m = meta?.find((x) => x.file === f.name);
      return { blob: f, name: f.name, C: m?.C ?? null, hfov: m?.hfov ?? Number(hfov.value) };
    });
    refresh();
  }

  async function capture() {
    try {
      const got = await captureSession(Number(hfov.value));
      if (got.length) { shots = got; refresh(); }
    } catch (e) { fail(e); }
  }

  refresh();
  const phone = matchMedia('(pointer: coarse)').matches;
  return h('section', { class: 'view' },
    h('header', { class: 'view-head' },
      h('h1', {}, 'Photo Sphere'),
      h('p', { class: 'lead' }, 'A full 360° × 180° image, like the old Nexus and Pixel camera. Capture with guide dots on your phone, or stitch photos you shot by hand.'),
    ),
    h('div', { class: 'cards' },
      h('article', { class: 'card' },
        h('h2', {}, 'Capture'),
        h('p', { class: 'muted' }, phone ? 'Hold the phone upright, turn on the spot, and line the ring up with each dot. It shoots automatically.' : 'Open this page on your phone to capture with guide dots.'),
        h('label', {}, 'Camera width (°) ', hfov),
        h('button', { class: 'pill-button', onclick: capture, disabled: !navigator.mediaDevices?.getUserMedia }, 'Start capture'),
      ),
      h('article', { class: 'card' },
        h('h2', {}, 'Stitch photos'),
        h('p', { class: 'muted' }, 'Shot a sphere manually, or exported frames from the phone? Pick the photos (and orientations.json if you have it).'),
        h('div', { class: 'row' },
          h('button', { class: 'pill-link', onclick: () => importPhotos(false) }, 'Choose photos'),
          h('button', { class: 'pill-link', onclick: () => importPhotos(true) }, 'Choose a folder'),
        ),
      ),
    ),
    summary, actions, prog.el, status, result,
  );
}

/** Full-screen guided capture. Resolves with the captured frames. */
async function captureSession(hfovDeg: number): Promise<Shot[]> {
  const feed: OrientationFeed = await startOrientation();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } },
  });
  const video = h('video', { autoplay: true, playsinline: true, muted: true }) as HTMLVideoElement;
  video.srcObject = stream;
  const canvas = h('canvas', { class: 'overlay' }) as HTMLCanvasElement;
  const info = h('div', { class: 'cap-info' });
  const done = h('button', { class: 'pill-button' }, 'Done');
  const cancel = h('button', { class: 'pill-link' }, 'Cancel');
  const ui = h('div', { class: 'capture' }, video, canvas, info, h('div', { class: 'cap-bar' }, cancel, done));
  document.body.append(ui);
  try { await (ui as any).requestFullscreen?.(); } catch { /* optional */ }
  try { await (screen.orientation as any)?.lock?.('portrait'); } catch { /* optional */ }

  const plan = capturePlan(hfovDeg);
  const taken = new Array(plan.length).fill(false);
  const shots: Shot[] = [];
  let yaw0: number | null = null;
  let hold = 0, last: M3 | null = null, busy = false;

  return new Promise((resolve) => {
    let raf = 0;
    const end = (keep: boolean) => {
      cancelAnimationFrame(raf);
      feed.stop();
      stream.getTracks().forEach((t) => t.stop());
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      ui.remove();
      resolve(keep ? shots : []);
    };
    done.onclick = () => end(true);
    cancel.onclick = () => end(false);

    const grab = async (C: M3) => {
      busy = true;
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d')!.drawImage(video, 0, 0);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95));
      const n = shots.length + 1;
      // "camera width" = horizontal field of view of the saved frame
      shots.push({ blob, name: `sphere_${String(n).padStart(3, '0')}.jpg`, C, hfov: hfovDeg });
      if (navigator.vibrate) navigator.vibrate(30);
      busy = false;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const W = (canvas.width = canvas.clientWidth * devicePixelRatio);
      const H = (canvas.height = canvas.clientHeight * devicePixelRatio);
      const g = canvas.getContext('2d')!;
      g.clearRect(0, 0, W, H);
      const C = feed.C;
      if (!C) { info.textContent = 'Waiting for motion sensors…'; return; }
      if (yaw0 === null) yaw0 = yawPitchRoll(C).yaw;
      const R = tr(C);
      // video is letterboxed (object-fit: contain), so scale to its drawn width
      const vw = Math.min(W, (H * (video.videoWidth || 3)) / (video.videoHeight || 4));
      const f = vw / 2 / Math.tan((hfovDeg * Math.PI) / 360);
      const fwd = col(C, 2);
      // steadiness: angle moved since the previous frame
      const moved = last ? Math.acos(Math.min(1, dot(col(last, 2), fwd))) * 57.3 : 99;
      last = C;
      let nearest = -1, nearAng = 1e9;
      plan.forEach((t, k) => {
        const d = dirFromYawPitch(t.yaw + yaw0!, t.pitch);
        const ang = Math.acos(Math.min(1, dot(d, fwd))) * 57.3;
        if (!taken[k] && ang < nearAng) { nearAng = ang; nearest = k; }
        const c = mulv(R, d);
        if (c[2] <= 0.1) return;
        const x = W / 2 + (f * c[0]) / c[2], y = H / 2 + (f * c[1]) / c[2];
        g.beginPath();
        g.arc(x, y, (taken[k] ? 7 : 12) * devicePixelRatio, 0, Math.PI * 2);
        g.fillStyle = taken[k] ? 'rgba(255,255,255,0.35)' : 'rgba(255,144,232,0.95)';
        g.fill();
      });
      // centre ring
      g.lineWidth = 3 * devicePixelRatio;
      g.strokeStyle = nearAng < 3 ? '#7dffb2' : 'rgba(255,255,255,0.9)';
      g.beginPath(); g.arc(W / 2, H / 2, 26 * devicePixelRatio, 0, Math.PI * 2); g.stroke();
      const left = taken.filter((t) => !t).length;
      info.textContent = left ? `${shots.length} shot · ${left} to go${nearAng < 8 ? ' · hold still' : ''}` : 'All dots captured — tap Done';
      if (nearest >= 0 && nearAng < 3 && moved < 0.25 && !busy) {
        if (++hold > 6) { taken[nearest] = true; hold = 0; grab(C); }
      } else hold = 0;
    };
    video.onloadedmetadata = () => draw();
  });
}
