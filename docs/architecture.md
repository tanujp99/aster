# Architecture

Aster's tools live on the web, but its processing stays local. Vercel serves static files only, and no photo is ever sent to it.

```
 ┌──────────────────────┐   app code    ┌──────────────────────────┐   big jobs    ┌──────────────────────────┐
 │ Vercel               │ ────────────▶ │ Your browser             │ ────────────▶ │ Local helper (optional)  │
 │ img.tanujp.com       │               │ web app + OpenCV (WASM)  │  localhost    │ Python + Hugin + enblend │
 │ static files only    │               │ stitches in a worker     │ ◀──────────── │ full resolution          │
 └──────────────────────┘               └────────────┬─────────────┘    result     └──────────────────────────┘
                                                     │ read / save
                                          ┌──────────▼──────────┐
                                          │ Your folders        │
                                          │ photos in, out      │
                                          └─────────────────────┘
```

## Web app (`web/`)

- **Stack:** Vite and TypeScript with no UI framework. Hash routing (`#/panorama`, `#/sphere`, `#/viewer`) keeps hosting fully static.
- **Engine worker** (`src/engine/worker.ts`): every stitch runs in a Web Worker so the page stays responsive. Images are decoded there with `createImageBitmap` and `OffscreenCanvas`.
- **OpenCV.js** (`@techstark/opencv-js`, WASM) is loaded lazily inside the worker, only when a panorama stitch starts. It handles ORB features, matching and RANSAC. The camera model, levelling, rendering and blending are Aster's own code (`src/engine/panorama.ts`, `math.ts`).
- **Files** (`src/lib/files.ts`): input comes through file and folder pickers or drag-and-drop. Output goes through the File System Access API to a folder you choose (Chrome and Edge); other browsers fall back to a normal download.
- **Helper client** (`src/lib/helper.ts`): probes `http://127.0.0.1:7878/health` and, when the helper is present, sends jobs to it. Requests stay on the same machine.
- **Viewer** (`src/views/viewer.ts`): uses Pannellum for spheres (equirectangular, GPano-aware) and a custom pan/zoom view for flat panoramas.

## Local helper (`helper/`)

- FastAPI on `127.0.0.1` only. It never binds to the LAN.
- One job runs at a time, because Hugin is memory hungry. Jobs live in `~/.aster/jobs/<id>/` and are deleted after the result is fetched.
- CORS allows `https://img.tanujp.com` and local dev origins. It also answers Chrome's Private Network Access preflight (`Access-Control-Allow-Private-Network: true`), so the public HTTPS page can reach localhost.
- Pipelines are in `helper/aster/pipeline.py` (see [algorithms](algorithms.md)).

## Data flow

| Step | Where | Network |
| --- | --- | --- |
| Load the app | Vercel → browser | yes (code only) |
| Pick photos | browser | none |
| Browser stitch | Web Worker | none |
| Helper stitch | browser → `127.0.0.1` | loopback only |
| Save result | browser → your folder | none |
