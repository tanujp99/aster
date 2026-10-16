// Main-thread wrapper around the stitching worker.
import type { PanoOptions } from './panorama';
import type { SphereFrame } from './sphere';

export interface EngineResult { blob: Blob; width: number; height: number; info: any }

function call(msg: unknown, onProgress: (stage: string, frac: number) => void): Promise<EngineResult> {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'progress') onProgress(`${m.stage} ${m.total > 1 ? `${m.done + 1}/${m.total}` : ''}`.trim(), (m.done + 1) / m.total);
      else if (m.type === 'done') { w.terminate(); resolve(m); }
      else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Worker crashed (out of memory?)')); };
    w.postMessage(msg);
  });
}

export const browserPanorama = (files: File[], options: Partial<PanoOptions>, quality: number, onProgress: (s: string, f: number) => void) =>
  call({ kind: 'panorama', files, options, quality }, onProgress);

export const browserSphere = (files: Blob[], frames: SphereFrame[], width: number, quality: number, onProgress: (s: string, f: number) => void) =>
  call({ kind: 'sphere', files, frames, width, quality }, onProgress);
