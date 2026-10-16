"""Run the helper:  python -m aster  [--port 7878] [--stitch DIR --mode panorama]"""
import argparse
import sys
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser(prog="aster", description="Aster local stitching helper")
    ap.add_argument("--port", type=int, default=7878)
    ap.add_argument("--stitch", type=Path, help="stitch a folder directly from the command line")
    ap.add_argument("--mode", choices=["panorama", "sphere"], default="panorama")
    ap.add_argument("--out", type=Path, help="output JPEG for --stitch")
    a = ap.parse_args()

    if a.stitch:
        import shutil
        import tempfile

        from .pipeline import stitch_panorama, stitch_sphere

        files = sorted(p for p in a.stitch.iterdir() if p.suffix.lower() in (".jpg", ".jpeg"))
        work = Path(tempfile.mkdtemp(prefix="aster-"))
        for k, f in enumerate(files):
            shutil.copy(f, work / f"{k:04d}_{f.name}")
        local = sorted(work.iterdir())
        fn = stitch_sphere if a.mode == "sphere" else stitch_panorama
        out = fn(work, local, print, None) if a.mode == "sphere" else fn(work, local, print)
        dest = a.out or a.stitch / f"{a.stitch.name}_{a.mode}.jpg"
        shutil.copy(out, dest)
        print(f"saved {dest}")
        return

    import uvicorn

    print(f"Aster helper on http://127.0.0.1:{a.port}  (Ctrl+C to stop)")
    uvicorn.run("aster.server:app", host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    sys.exit(main())
