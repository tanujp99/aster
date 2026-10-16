// Local file input/output. Nothing here touches the network.

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
};

let outDir: DirHandle | null = null;

export const canPickFolder = () => 'showDirectoryPicker' in window;

/** Let the user choose photos (files or a whole folder), sorted by name = shooting order. */
export function pickPhotos(opts: { folder?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/heic,.json';
    input.multiple = true;
    if (opts.folder) (input as any).webkitdirectory = true;
    input.onchange = () => resolve(sortByName(Array.from(input.files ?? [])));
    input.click();
  });
}

export function sortByName(files: File[]): File[] {
  return files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function imagesOnly(files: File[]): File[] {
  return files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
}

export async function chooseOutputFolder(): Promise<string | null> {
  if (!canPickFolder()) return null;
  outDir = await (window as any).showDirectoryPicker({ id: 'aster-out', mode: 'readwrite' });
  return outDir!.name;
}

export const outputFolderName = () => outDir?.name ?? null;

/** Save into the chosen folder, or fall back to a normal browser download. */
export async function saveBlob(blob: Blob, name: string): Promise<string> {
  if (outDir) {
    const perm = (await outDir.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (perm === 'granted' || (await outDir.requestPermission?.({ mode: 'readwrite' })) === 'granted') {
      const fh = await outDir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return `${outDir.name}/${name}`;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return `Downloads/${name}`;
}

export type NameScheme = 'pixel' | 'nexus';
const schemeKey = 'aster.names';
export const getScheme = (): NameScheme => {
  try { return localStorage.getItem(schemeKey) === 'nexus' ? 'nexus' : 'pixel'; } catch { return 'pixel'; }
};
export const setScheme = (s: NameScheme) => { try { localStorage.setItem(schemeKey, s); } catch { /* private mode */ } };

/**
 * File names in the Google camera schemes.
 *  Pixel (Google Camera 7.5+): PXL_YYYYMMDD_HHMMSSmmm.<MODE>.jpg, time in UTC,
 *    e.g. PXL_20220227_234037551.PHOTOSPHERE.jpg, PXL_20220806_164904612.PANO.jpg
 *  Nexus (Google Camera 2013–2016): PANO_YYYYMMDD_HHMMSS.jpg, local time, the
 *    same prefix for photo spheres and panoramas, e.g. PANO_20130630_162111.jpg
 */
export function cameraName(kind: 'sphere' | 'pano', ext = 'jpg', d = new Date(), scheme = getScheme()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  if (scheme === 'nexus') {
    return `PANO_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
  }
  const ts = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${p(d.getUTCMilliseconds(), 3)}`;
  return `PXL_${ts}.${kind === 'sphere' ? 'PHOTOSPHERE' : 'PANO'}.${ext}`;
}

/** A small select for the naming scheme, shared by the panorama and sphere views. */
export function schemeSelect(): HTMLSelectElement {
  const s = document.createElement('select');
  s.innerHTML = '<option value="pixel">Pixel (PXL_…)</option><option value="nexus">Nexus (PANO_…)</option>';
  s.value = getScheme();
  s.onchange = () => setScheme(s.value as NameScheme);
  return s;
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
