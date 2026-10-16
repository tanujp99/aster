# Aster local helper

A localhost-only service that runs Hugin for full-resolution panoramas and Photo Spheres. See [../docs/helper.md](../docs/helper.md).

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m aster                       # server on http://127.0.0.1:7878
python -m aster --stitch "C:\path\to\photos"   # one-off, no browser
```
