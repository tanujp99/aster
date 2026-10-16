// opencv.js (WASM) loader. Imported only by the stitching worker, so the
// ~10 MB runtime downloads when a stitch starts, not when the page opens.
//
// Gotcha: the emscripten module object has a `then` method. A dynamic
// `import()` of it, or resolving a Promise with it, makes JavaScript treat it
// as a thenable and wait forever. So: static import, and wrap before resolving.
import cvModule from '@techstark/opencv-js';

let ready: Promise<{ cv: any }> | null = null;

/** Resolves to `{ cv }` — never return `cv` itself from an async function. */
export function loadCV(): Promise<{ cv: any }> {
  if (!ready) {
    ready = new Promise<{ cv: any }>((resolve) => {
      const cv: any = cvModule;
      // the runtime may initialise before or after we look, so poll
      const tick = () => (cv.Mat && cv.ORB ? resolve({ cv }) : setTimeout(tick, 50));
      tick();
    });
  }
  return ready;
}
