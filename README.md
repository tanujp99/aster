# Aster

Panorama and Photo Sphere stitching that runs on your own device, served from **img.tanujp.com**.

The web app is static and hosted on Vercel. All processing happens locally: in the browser tab (WebAssembly + JavaScript), or in the optional **local helper**, which runs Hugin on your computer for full-resolution output. Photos are never uploaded to a server.

| Part | Folder | What it does |
| --- | --- | --- |
| Web app | `web/` | Vite + TypeScript site: panorama stitcher, Photo Sphere capture and stitching, viewer |
| Local helper | `helper/` | Python service on `127.0.0.1:7878` that runs the Hugin pipeline |
| Docs | `docs/` | Architecture, algorithms, deployment, helper setup, roadmap |

## Quick start

```bash
# web app
cd web
npm install
npm run dev            # http://localhost:5173

# local helper (needs Hugin installed)
cd helper
python -m venv .venv && .venv\Scripts\activate      # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python -m aster        # http://127.0.0.1:7878
```

The web app finds the helper automatically. The pill at the top right shows its status.

## Docs

- [Architecture](docs/architecture.md)
- [How the stitching works](docs/algorithms.md)
- [Local helper setup](docs/helper.md)
- [Photo Sphere capture](docs/photo-sphere.md)
- [Deploying to Vercel and img.tanujp.com](docs/deploy.md)
- [Roadmap and known limits](docs/roadmap.md)
