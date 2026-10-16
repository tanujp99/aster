"""Write Google Photo Sphere (GPano) XMP into a JPEG without extra dependencies."""
from __future__ import annotations

from pathlib import Path

XMP_HEADER = b"http://ns.adobe.com/xap/1.0/\x00"


def gpano_xmp(width: int, height: int, full_w: int | None = None, full_h: int | None = None,
              left: int = 0, top: int = 0) -> bytes:
    full_w = full_w or width
    full_h = full_h or full_w // 2
    xml = f"""<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Aster">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"
   GPano:UsePanoramaViewer="True"
   GPano:ProjectionType="equirectangular"
   GPano:CroppedAreaImageWidthPixels="{width}"
   GPano:CroppedAreaImageHeightPixels="{height}"
   GPano:FullPanoWidthPixels="{full_w}"
   GPano:FullPanoHeightPixels="{full_h}"
   GPano:CroppedAreaLeftPixels="{left}"
   GPano:CroppedAreaTopPixels="{top}"
   GPano:PoseHeadingDegrees="0"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""
    return xml.encode("utf-8")


def add_gpano(path: Path, width: int, height: int, **kw) -> None:
    data = path.read_bytes()
    if data[:2] != b"\xff\xd8":
        raise ValueError("not a JPEG")
    payload = XMP_HEADER + gpano_xmp(width, height, **kw)
    seg = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload
    # insert after SOI and any existing APP0/APP1 segments
    i = 2
    while data[i] == 0xFF and data[i + 1] in (0xE0, 0xE1):
        i += 2 + int.from_bytes(data[i + 2:i + 4], "big")
    path.write_bytes(data[:i] + seg + data[i:])
