"""Hugin-based stitching pipeline used by the Aster local helper.

Panorama flow (the one that produced the Rainier panoramas):
  pto_gen -> neighbour-only SIFT control points (OpenCV) -> autooptimiser
  (positions first, then lens + photometrics) -> sanity check -> horizon
  levelling by whole-pano roll -> cylindrical canvas + auto crop -> nona/enblend.

Sphere flow:
  pto_gen -> optional initial yaw/pitch/roll from phone sensors -> cpfind
  (multirow, celeste) + cpclean -> autooptimiser -> equirectangular 360x180
  -> nona/enblend -> GPano XMP so viewers treat it as a Photo Sphere.
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from .xmp import add_gpano

Log = Callable[[str], None]

HUGIN_DIRS = [
    r"C:\Program Files\Hugin\bin",
    r"C:\Program Files (x86)\Hugin\bin",
    "/Applications/Hugin/PTBatcherGUI.app/Contents/MacOS",
    "/Applications/Hugin/Hugin.app/Contents/MacOS",
    "/usr/bin",
    "/usr/local/bin",
    "/opt/homebrew/bin",
]


def find_tool(name: str) -> str | None:
    env = os.environ.get("ASTER_HUGIN_BIN")
    dirs = ([env] if env else []) + HUGIN_DIRS
    for d in dirs:
        for cand in (name, name + ".exe"):
            p = Path(d) / cand
            if p.exists():
                return str(p)
    return shutil.which(name)


SPHERE_MAX_WIDTH = int(os.environ.get("ASTER_SPHERE_MAX", "16384"))

TOOLS = ["pto_gen", "cpfind", "cpclean", "autooptimiser", "pano_modify", "hugin_executor", "nona", "enblend"]


def check_tools() -> dict[str, str | None]:
    return {t: find_tool(t) for t in TOOLS}


def run(tool: str, args: list[str], cwd: Path, log: Log) -> str:
    exe = find_tool(tool)
    if not exe:
        raise RuntimeError(f"Hugin tool '{tool}' not found. Install Hugin or set ASTER_HUGIN_BIN.")
    log(f"$ {tool} {' '.join(args)}")
    p = subprocess.run([exe, *args], cwd=cwd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"{tool} failed:\n{p.stderr[-2000:] or p.stdout[-2000:]}")
    return p.stdout


# --------------------------------------------------------------------------- pto helpers

def read_images(pto: Path) -> list[dict]:
    imgs = []
    for line in pto.read_text().splitlines():
        if line.startswith("i "):
            d = {k: float(v) for k, v in re.findall(r" ([yprv])(-?[0-9.e+-]+)", line)}
            d["n"] = re.search(r'n"([^"]+)"', line).group(1)
            imgs.append(d)
    return imgs


def set_image_vars(pto: Path, out: Path, values: list[dict[str, float]]) -> None:
    lines, k = [], 0
    for line in pto.read_text().splitlines():
        if line.startswith("i "):
            for var, val in values[k].items():
                line = re.sub(rf" {var}[^ ]+", f" {var}{val}", line, count=1)
            k += 1
        lines.append(line)
    out.write_text("\n".join(lines) + "\n")


def neighbour_control_points(pto_in: Path, pto_out: Path, log: Log, scale: float = 0.5) -> int:
    """SIFT + ratio test + RANSAC homography on (i, i+1) and (i, i+2) pairs only.

    Restricting matches to shooting-order neighbours avoids the false matches
    between repeated ridgelines that scrambled Hugin's own cpfind on long sweeps.
    """
    lines = pto_in.read_text().splitlines()
    files = [re.search(r'n"([^"]+)"', l).group(1) for l in lines if l.startswith("i ")]
    base = pto_in.parent
    sift = cv2.SIFT_create(nfeatures=8000)
    feats = []
    for k, f in enumerate(files):
        im = cv2.imread(str(base / f), cv2.IMREAD_GRAYSCALE)
        im = cv2.resize(im, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        feats.append(sift.detectAndCompute(im, None))
        log(f"features {k + 1}/{len(files)}")
    bf = cv2.BFMatcher()
    cps: list[str] = []
    for i in range(len(files)):
        for j in (i + 1, i + 2):
            if j >= len(files):
                continue
            (k1, d1), (k2, d2) = feats[i], feats[j]
            if d1 is None or d2 is None:
                continue
            m = [a for a, b in bf.knnMatch(d1, d2, k=2) if a.distance < 0.7 * b.distance]
            if len(m) < 12:
                if j == i + 1:
                    log(f"warning: weak overlap between {files[i]} and {files[j]} ({len(m)} matches)")
                continue
            p1 = np.float32([k1[a.queryIdx].pt for a in m])
            p2 = np.float32([k2[a.trainIdx].pt for a in m])
            H, mask = cv2.findHomography(p1, p2, cv2.RANSAC, 3.0)
            if H is None:
                continue
            inl = [(a, b) for a, b, ok in zip(p1, p2, mask.ravel()) if ok]
            if len(inl) < 12:
                continue
            idx = np.linspace(0, len(inl) - 1, min(60, len(inl))).astype(int)
            for q in idx:
                a, b = inl[q]
                cps.append(f"c n{i} N{j} x{a[0] / scale:.2f} y{a[1] / scale:.2f} X{b[0] / scale:.2f} Y{b[1] / scale:.2f} t0")
    out = [l for l in lines if not l.startswith("c ")]
    pto_out.write_text("\n".join(out + cps) + "\n")
    return len(cps)


def _dir(y: float, p: float) -> np.ndarray:
    y, p = math.radians(y), math.radians(p)
    return np.array([math.cos(p) * math.sin(y), math.sin(p), math.cos(p) * math.cos(y)])


def best_roll(imgs: list[dict]) -> float:
    """Whole-pano roll (degrees) that makes image centres lie on one level line."""
    dirs = [_dir(d["y"], d["p"]) for d in imgs]
    best, best_var = 0.0, float("inf")
    for r10 in range(-150, 151):
        r = math.radians(r10 / 10)
        # rotation about the forward (z) axis
        R = np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])
        pitches = [math.asin(max(-1, min(1, (R @ v)[1]))) for v in dirs]
        var = float(np.var(pitches))
        if var < best_var:
            best, best_var = r10 / 10, var
    return best


def sane_sweep(imgs: list[dict]) -> bool:
    ps = [d["p"] for d in imgs]
    if max(ps) - min(ps) > 35:
        return False
    ys = np.unwrap(np.radians([d["y"] for d in imgs]))
    steps = np.diff(ys)
    return bool(np.all(steps > 0) or np.all(steps < 0))


# --------------------------------------------------------------------------- jobs

def stitch_panorama(work: Path, files: list[Path], log: Log, quality: int = 95) -> Path:
    names = [f.name for f in files]
    run("pto_gen", ["-p", "1", "-o", "a.pto", *names], work, log)
    ncp = neighbour_control_points(work / "a.pto", work / "b.pto", log)
    log(f"{ncp} control points")
    if ncp < 12 * (len(files) - 1):
        log("few neighbour matches; falling back to cpfind")
        run("cpfind", ["--celeste", "--linearmatch", "--linearmatchlen", "3", "-o", "b.pto", "a.pto"], work, log)
    run("cpclean", ["-o", "c.pto", "b.pto"], work, log)
    # positions first from a neutral start, then everything
    zero = [{"y": 0, "p": 0, "r": 0} for _ in files]
    set_image_vars(work / "c.pto", work / "c0.pto", zero)
    run("autooptimiser", ["-p", "-l", "-o", "d0.pto", "c0.pto"], work, log)
    run("autooptimiser", ["-a", "-m", "-l", "-s", "-o", "d1.pto", "d0.pto"], work, log)
    imgs = read_images(work / "d1.pto")
    if not sane_sweep(imgs):
        log("full optimisation drifted; keeping the positions-only solution")
        run("autooptimiser", ["-m", "-l", "-s", "-o", "d1.pto", "d0.pto"], work, log)
        imgs = read_images(work / "d1.pto")
    roll = best_roll(imgs)
    log(f"levelling horizon: roll {roll:+.1f} deg")
    run("pano_modify", [f"--rotate=0,0,{roll}", "-o", "d2.pto", "d1.pto"], work, log)
    run("pano_modify", ["--projection=1", "--canvas=AUTO", "--crop=AUTO", "--ldr-file=JPG",
                        f"--ldr-compression={quality}", "-o", "e.pto", "d2.pto"], work, log)
    _render(work, log)
    return work / "pano.jpg"


def stitch_sphere(work: Path, files: list[Path], log: Log, orientations: list[dict] | None,
                  quality: int = 95) -> Path:
    names = [f.name for f in files]
    run("pto_gen", ["-p", "2", "-o", "a.pto", *names], work, log)
    src = "a.pto"
    if orientations and len(orientations) == len(files):
        set_image_vars(work / "a.pto", work / "a1.pto",
                       [{"y": o["yaw"], "p": o["pitch"], "r": o["roll"]} for o in orientations])
        if orientations[0].get("hfov"):
            txt = (work / "a1.pto").read_text()
            txt = re.sub(r"( v)[0-9.]+", rf"\g<1>{orientations[0]['hfov']}", txt, count=1)
            (work / "a1.pto").write_text(txt)
        src = "a1.pto"
        log("using phone sensor orientations as the starting layout")
    # with a sensor layout, prealigned matching only compares overlapping frames
    cp_args = ["--celeste", "-o", "b.pto", src]
    cp_args[1:1] = ["--prealigned"] if src == "a1.pto" else ["--multirow"]
    run("cpfind", cp_args, work, log)
    run("cpclean", ["-o", "c.pto", "b.pto"], work, log)
    run("autooptimiser", ["-a", "-m", "-l", "-o", "d.pto", "c.pto"], work, log)
    run("pano_modify", ["--projection=2", "--fov=360x180", "--canvas=AUTO", "-o", "e0.pto", "d.pto"], work, log)
    # Native resolution of a telephoto sphere can exceed 80,000 px; cap it.
    m = re.search(r"^p .*? w(\d+)", (work / "e0.pto").read_text(), re.M)
    native = int(m.group(1)) if m else SPHERE_MAX_WIDTH
    w = min(native, SPHERE_MAX_WIDTH) // 2 * 2
    log(f"sphere canvas {w} x {w // 2} (native {native})")
    # full 360x180 canvas, no crop, so it is a true sphere even with gaps
    run("pano_modify", [f"--canvas={w}x{w // 2}", "--crop=0,{0},0,{1}".format(w, w // 2), "--ldr-file=JPG",
                        f"--ldr-compression={quality}", "-o", "e.pto", "e0.pto"], work, log)
    _render(work, log)
    out = work / "pano.jpg"
    from PIL import Image  # noqa: WPS433
    with Image.open(out) as im:
        w, h = im.size
    add_gpano(out, w, h)
    return out


def _render(work: Path, log: Log) -> None:
    for f in work.glob("pano*.tif"):
        f.unlink()
    run("hugin_executor", ["--stitching", "--prefix=pano", "e.pto"], work, log)
    if not (work / "pano.jpg").exists():
        raise RuntimeError("Hugin finished without producing pano.jpg")


def write_meta(work: Path, data: dict) -> None:
    (work / "job.json").write_text(json.dumps(data, indent=2))
