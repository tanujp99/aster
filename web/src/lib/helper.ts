// Client for the Aster local helper (Python + Hugin on http://127.0.0.1:7878).
// Requests go from this browser tab to a program on the same computer.

export const HELPER_URL = (localStorage.getItem('aster.helper') || 'http://127.0.0.1:7878').replace(/\/$/, '');

export interface HelperHealth { ok: boolean; version: string; tools: Record<string, string | null>; busy: boolean }

export async function helperHealth(): Promise<HelperHealth | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${HELPER_URL}/health`, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export interface HelperJob { id: string; status: 'queued' | 'running' | 'done' | 'error'; error?: string; log: string[] }

export async function helperStitch(
  files: Blob[],
  names: string[],
  mode: 'panorama' | 'sphere',
  onLog: (job: HelperJob) => void,
  orientations?: unknown[],
  quality = 95,
): Promise<Blob> {
  const fd = new FormData();
  files.forEach((f, i) => fd.append('files', f, names[i]));
  fd.append('mode', mode);
  fd.append('quality', String(quality));
  if (orientations) fd.append('orientations', JSON.stringify(orientations));
  const r = await fetch(`${HELPER_URL}/jobs`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`Helper refused the job: ${await r.text()}`);
  const { id } = await r.json();
  for (;;) {
    await new Promise((res) => setTimeout(res, 1200));
    const s: HelperJob = await (await fetch(`${HELPER_URL}/jobs/${id}`)).json();
    onLog(s);
    if (s.status === 'error') throw new Error(s.error || 'Helper failed');
    if (s.status === 'done') break;
  }
  const res = await fetch(`${HELPER_URL}/jobs/${id}/result`);
  const blob = await res.blob();
  fetch(`${HELPER_URL}/jobs/${id}`, { method: 'DELETE' }).catch(() => {});
  return blob;
}
