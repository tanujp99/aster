# Roadmap and known limits

## v1 (this demo)

- [x] Browser panorama stitcher (WASM features, own camera model, levelling, exposure, seams, auto-crop)
- [x] Local helper with the Hugin pipeline that produced the Rainier panoramas
- [x] Photo Sphere guided capture on the phone (sensor dots, auto-shoot)
- [x] Sphere stitching: browser preview from sensors, and the helper (Hugin) for both sensor-guided and hand-shot frames
- [x] GPano metadata, plus a viewer for spheres and flat panoramas
- [x] Save to a chosen folder (File System Access), with a download fallback

## Known limits

- **Browser panorama** expects a single-row sweep in name order. For multi-row panoramas, or shuffled photos, use the helper.
- **Browser memory:** the output is capped at 40, 80 or 160 MP and 32,000 px per side. The helper has no such cap.
- **Browser seams** are feathered, not graph-cut, so a person who moves between frames can appear doubled. enblend in the helper picks smarter seams.
- **Sensor accuracy:** phone gyros drift and compasses are noisy, so the browser sphere preview can show small misalignments. The helper re-aligns from the images.
- **Capture** uses video frames, not full still photos, because `ImageCapture.takePhoto` is slow and pauses the stream on many phones.
- **Folder saving** works in Chrome and Edge; Safari and Firefox download instead.

## Next

- [ ] Git repo + GitHub, connected to Vercel
- [ ] Helper installer (Windows `.exe` via PyInstaller) and a system-tray icon
- [ ] Phone → PC handoff by QR code, so you don't have to export a zip
- [ ] Multi-row browser panoramas (global bundle adjustment)
- [ ] Graph-cut or multi-band blending in the browser
- [ ] Little-planet and other projections in the viewer
