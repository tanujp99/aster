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
