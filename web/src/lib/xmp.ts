// Google Photo Sphere (GPano) XMP, written straight into the JPEG bytes so
// Google Photos, Facebook and other viewers open the image as a sphere.

const XMP_NS = 'http://ns.adobe.com/xap/1.0/\0';

export interface GpanoArea { fullW: number; fullH: number; left: number; top: number; headingDeg?: number }
export interface GpanoCapture { first?: Date; last?: Date; count?: number }

/**
 * GPano block in the form Google's camera writes it (element syntax, the
 * values its Photo Sphere mode uses: CaptureSoftware/StitchingSoftware
 * "Photo Sphere", ISO-8601 capture dates with milliseconds).
 */
export function gpanoXmp(width: number, height: number, area?: GpanoArea, cap: GpanoCapture = {}): string {
  const a = area ?? { fullW: width, fullH: height, left: 0, top: 0, headingDeg: 0 };
  // PoseHeadingDegrees: direction at the centre of the full pano. Rolling the
  // canvas by the crop shift turns that direction by the same angle.
  const heading = (((a.headingDeg ?? 0) % 360) + 360) % 360;
  const first = (cap.first ?? new Date()).toISOString();
  const last = (cap.last ?? cap.first ?? new Date()).toISOString();
  const t = (k: string, v: string | number) => `   <GPano:${k}>${v}</GPano:${k}>`;
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/">
${[
  t('UsePanoramaViewer', 'True'),
  t('CaptureSoftware', 'Photo Sphere'),
  t('StitchingSoftware', 'Photo Sphere'),
  t('ProjectionType', 'equirectangular'),
  t('PoseHeadingDegrees', heading.toFixed(1)),
  t('InitialViewHeadingDegrees', Math.round(heading)),
  t('InitialViewPitchDegrees', 0),
  t('InitialViewRollDegrees', 0),
  t('InitialHorizontalFOVDegrees', '75.0'),
  t('CroppedAreaLeftPixels', a.left),
  t('CroppedAreaTopPixels', a.top),
  t('CroppedAreaImageWidthPixels', width),
  t('CroppedAreaImageHeightPixels', height),
  t('FullPanoWidthPixels', a.fullW),
  t('FullPanoHeightPixels', a.fullH),
  t('FirstPhotoDate', first),
  t('LastPhotoDate', last),
  t('SourcePhotosCount', cap.count ?? 0),
  t('ExposureLockUsed', 'False'),
].join('\n')}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Insert APP1 segments right after the JPEG's SOI/APP0 (JFIF): EXIF first, then
 * XMP — the order cameras use. Any APP1 the encoder wrote is dropped.
 */
export async function insertXmp(jpeg: Blob, xmp: string, exif?: Uint8Array): Promise<Blob> {
  const buf = new Uint8Array(await jpeg.arrayBuffer());
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  const payload = new TextEncoder().encode(XMP_NS + xmp);
  const len = payload.length + 2;
  const seg = new Uint8Array(4 + payload.length);
  seg.set([0xff, 0xe1, len >> 8, len & 0xff]);
  seg.set(payload, 4);
  // keep APP0 (JFIF), skip existing APP1s
  const head: Uint8Array[] = [buf.subarray(0, 2)];
  let i = 2;
  while (buf[i] === 0xff && (buf[i + 1] === 0xe0 || buf[i + 1] === 0xe1)) {
    const l = 2 + ((buf[i + 2] << 8) | buf[i + 3]);
    if (buf[i + 1] === 0xe0) head.push(buf.subarray(i, i + l));
    i += l;
  }
  return new Blob([...head, ...(exif ? [exif] : []), seg, buf.subarray(i)] as BlobPart[], { type: 'image/jpeg' });
}

/** Read GPano dimensions if the JPEG carries them (used by the viewer). */
export async function readGpano(file: Blob): Promise<{ isSphere: boolean; fullW?: number; fullH?: number; w?: number; h?: number; left?: number; top?: number }> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const text = new TextDecoder('latin1').decode(head);
  if (!/GPano:ProjectionType\s*=\s*"equirectangular"|<GPano:ProjectionType>equirectangular/.test(text)) return { isSphere: false };
  const num = (k: string) => {
    const m = text.match(new RegExp(`GPano:${k}\\s*=\\s*"(\\d+)"|<GPano:${k}>(\\d+)<`));
    return m ? Number(m[1] ?? m[2]) : undefined;
  };
  return {
    isSphere: true,
    fullW: num('FullPanoWidthPixels'), fullH: num('FullPanoHeightPixels'),
    w: num('CroppedAreaImageWidthPixels'), h: num('CroppedAreaImageHeightPixels'),
    left: num('CroppedAreaLeftPixels'), top: num('CroppedAreaTopPixels'),
  };
}
