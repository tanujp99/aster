// Minimal EXIF reader: just the fields the stitcher needs.

export interface ExifInfo { focal35?: number; focalMm?: number; orientation?: number }

export async function readExif(file: Blob): Promise<ExifInfo> {
  const buf = new DataView(await file.slice(0, 128 * 1024).arrayBuffer());
  if (buf.getUint16(0) !== 0xffd8) return {};
  let off = 2;
  while (off + 4 < buf.byteLength) {
    const marker = buf.getUint16(off);
    const len = buf.getUint16(off + 2);
    if (marker === 0xffe1 && buf.getUint32(off + 4) === 0x45786966) return parseTiff(buf, off + 10);
    if ((marker & 0xff00) !== 0xff00) break;
    off += 2 + len;
  }
  return {};
}

function parseTiff(v: DataView, base: number): ExifInfo {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o: number) => v.getUint16(base + o, le);
  const u32 = (o: number) => v.getUint32(base + o, le);
  const out: ExifInfo = {};
  const readIfd = (o: number, onTag: (tag: number, type: number, valOff: number) => void) => {
    if (base + o + 2 > v.byteLength) return;
    const n = u16(o);
    for (let k = 0; k < n; k++) {
      const e = o + 2 + k * 12;
      if (base + e + 12 > v.byteLength) return;
      onTag(u16(e), u16(e + 2), e + 8);
    }
  };
  let exifIfd = 0;
  readIfd(u32(4), (tag, _t, vo) => {
    if (tag === 0x0112) out.orientation = u16(vo);
    if (tag === 0x8769) exifIfd = u32(vo);
  });
  if (exifIfd) readIfd(exifIfd, (tag, _t, vo) => {
    if (tag === 0xa405) out.focal35 = u16(vo) || undefined;
    if (tag === 0x920a) { const p = u32(vo); out.focalMm = u32(p) / (u32(p + 4) || 1); }
  });
  return out;
}

/**
 * A camera-style EXIF APP1 segment (make/model, software, capture time, size).
 * Google Photos and Facebook look at EXIF as well as GPano before treating a
 * file as a camera Photo Sphere; a bare canvas JPEG has none.
 */
export interface Camera { make: string; model: string }

/** This phone's make/model as the browser reports it (Chrome on Android gives the model). */
export async function deviceCamera(): Promise<Camera> {
  try {
    const ua: any = (navigator as any).userAgentData;
    const hv = ua?.getHighEntropyValues ? await ua.getHighEntropyValues(['model']) : null;
    let model: string = hv?.model || '';
    if (!model) {
      const m = navigator.userAgent.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
      model = m ? m[1].trim() : '';
    }
    if (model && model !== 'K') {
      const make = /^Pixel|^Nexus/i.test(model) ? 'Google' : model.split(/\s+/)[0];
      return { make, model };
    }
    if (/iPhone/.test(navigator.userAgent)) return { make: 'Apple', model: 'iPhone' };
  } catch { /* fall through */ }
  return { make: 'Aster', model: 'Photo Sphere' };
}

export function exifSegment(width: number, height: number, date = new Date(), cam: Camera = { make: 'Aster', model: 'Photo Sphere' }): Uint8Array {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const dt = `${date.getFullYear()}:${p2(date.getMonth() + 1)}:${p2(date.getDate())} ${p2(date.getHours())}:${p2(date.getMinutes())}:${p2(date.getSeconds())}`;
  type E = { tag: number; type: 2 | 3 | 4 | 5 | 7; count: number; bytes: Uint8Array };
  const ascii = (tag: number, t: string): E => { const b = new TextEncoder().encode(t + '\0'); return { tag, type: 2, count: b.length, bytes: b }; };
  const short = (tag: number, v: number): E => ({ tag, type: 3, count: 1, bytes: new Uint8Array([v >> 8, v & 255, 0, 0]) });
  const long = (tag: number, v: number): E => ({ tag, type: 4, count: 1, bytes: new Uint8Array([v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]) });
  const rational = (tag: number, n: number, d: number): E => {
    const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, n); dv.setUint32(4, d);
    return { tag, type: 5, count: 1, bytes: b };
  };
  const undef = (tag: number, b: number[]): E => ({ tag, type: 7, count: b.length, bytes: new Uint8Array(b) });

  const ifd0: E[] = [
    ascii(0x010f, cam.make), ascii(0x0110, cam.model), short(0x0112, 1),
    rational(0x011a, 72, 1), rational(0x011b, 72, 1), short(0x0128, 2),
    ascii(0x0131, 'Aster (img.tanujp.com)'), ascii(0x0132, dt), short(0x0213, 1),
  ];
  const exif: E[] = [
    undef(0x9000, [0x30, 0x32, 0x33, 0x32]), ascii(0x9003, dt), ascii(0x9004, dt),
    undef(0x9101, [1, 2, 3, 0]), undef(0xa000, [0x30, 0x31, 0x30, 0x30]),
    short(0xa001, 1), long(0xa002, width), long(0xa003, height),
  ];
  const ifdSize = (k: number) => 2 + 12 * k + 4;
  const ifd0Off = 8, exifOff = ifd0Off + ifdSize(ifd0.length + 1);
  let dataOff = exifOff + ifdSize(exif.length);
  const tiff = new Uint8Array(2048);
  const v = new DataView(tiff.buffer);
  tiff.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]); // big-endian TIFF, IFD0 at 8
  const write = (at: number, entries: E[]) => {
    entries.sort((a, b) => a.tag - b.tag);
    v.setUint16(at, entries.length);
    entries.forEach((e, k) => {
      const o = at + 2 + 12 * k;
      v.setUint16(o, e.tag); v.setUint16(o + 2, e.type); v.setUint32(o + 4, e.count);
      if (e.bytes.length <= 4) tiff.set(e.bytes, o + 8);
      else { v.setUint32(o + 8, dataOff); tiff.set(e.bytes, dataOff); dataOff += e.bytes.length + (e.bytes.length & 1); }
    });
    v.setUint32(at + 2 + 12 * entries.length, 0);
  };
  write(ifd0Off, [...ifd0, long(0x8769, exifOff)]);
  write(exifOff, exif);
  const body = tiff.subarray(0, dataOff);
  const len = body.length + 8;
  const seg = new Uint8Array(10 + body.length);
  seg.set([0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  seg.set(body, 10);
  return seg;
}
