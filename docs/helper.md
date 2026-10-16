# Local helper setup

The helper is a small Python service that runs Hugin on your computer. The web app uses it automatically for full-resolution panoramas and for seamless Photo Spheres.

## 1. Install Hugin

- **Windows:** install Hugin from <https://hugin.sourceforge.io/download/>. The default location `C:\Program Files\Hugin\bin` is detected automatically.
- **macOS:** `brew install --cask hugin`, or the official app bundle.
- **Linux:** `sudo apt install hugin-tools enblend`.

If Hugin is somewhere else, set `ASTER_HUGIN_BIN` to the folder that contains `nona` and `enblend`.

## 2. Install and run the helper

```powershell
cd helper
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m aster
```

It prints `Aster helper on http://127.0.0.1:7878`. Leave it running, and the pill in the web app turns green.

Check it with: `curl http://127.0.0.1:7878/health`. Every Hugin tool should be listed with a path.

## Command-line stitching (no browser)

```powershell
python -m aster --stitch "C:\MySpace\Library\pictures\PANO\rainier 1"
python -m aster --stitch "D:\trip\sphere_frames" --mode sphere --out sphere.jpg
```

## API

| Method | Path | Body / result |
| --- | --- | --- |
| GET | `/health` | `{ok, version, tools, busy}` |
| POST | `/jobs` | multipart: `files[]`, `mode` (`panorama`, `sphere`), `quality`, `orientations` (JSON) → `{id}` |
| GET | `/jobs/{id}` | `{status, error, log}` |
| GET | `/jobs/{id}/result` | the JPEG |
| DELETE | `/jobs/{id}` | removes the job folder |

## Settings (environment variables)

| Variable | Default |
| --- | --- |
| `ASTER_HUGIN_BIN` | auto-detect |
| `ASTER_JOBS` | `~/.aster/jobs` |
| `ASTER_ORIGINS` | `https://img.tanujp.com,http://localhost:5173,…` |

## Security notes

- It binds to `127.0.0.1` only, so other devices on your network can't reach it.
- CORS is restricted to the Aster origins.
- Uploaded file names are sanitised, and each job runs in its own folder.
