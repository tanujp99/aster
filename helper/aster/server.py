"""Aster local helper: a localhost-only HTTP service that runs Hugin stitches.

The web app at img.tanujp.com detects it on http://127.0.0.1:7878 and sends
jobs here when full-resolution output is wanted. Photos only travel between
the browser and this process on the same machine.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import __version__
from .pipeline import check_tools, stitch_panorama, stitch_sphere

JOBS_DIR = Path(os.environ.get("ASTER_JOBS", Path.home() / ".aster" / "jobs"))
ORIGINS = [o.strip() for o in os.environ.get(
    "ASTER_ORIGINS", "https://img.tanujp.com,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"
).split(",") if o.strip()]

app = FastAPI(title="Aster helper", version=__version__)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    # Chrome's Private Network Access: a public HTTPS page may call localhost
    # only if the preflight answers with this header.
    resp = await call_next(request)
    if request.headers.get("access-control-request-private-network"):
        resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp


pool = ThreadPoolExecutor(max_workers=1)  # Hugin is memory hungry: one job at a time
jobs: dict[str, dict] = {}
lock = threading.Lock()


def _log(job: dict, msg: str) -> None:
    with lock:
        job["log"].append(f"{time.strftime('%H:%M:%S')} {msg}")
        job["log"] = job["log"][-400:]


def _run(job_id: str) -> None:
    job = jobs[job_id]
    work = Path(job["dir"])
    job["status"] = "running"
    try:
        files = sorted(p for p in work.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".tif", ".tiff", ".png"))
        log = lambda m: _log(job, m)  # noqa: E731
        if job["mode"] == "sphere":
            out = stitch_sphere(work, files, log, job.get("orientations"), job["quality"])
        else:
            out = stitch_panorama(work, files, log, job["quality"])
        job["result"] = str(out)
        job["status"] = "done"
        _log(job, "done")
    except Exception as e:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = str(e)
        _log(job, traceback.format_exc(limit=3))


@app.get("/health")
def health():
    tools = check_tools()
    return {"ok": all(tools.values()), "version": __version__, "tools": tools, "busy": any(
        j["status"] in ("queued", "running") for j in jobs.values())}


@app.post("/jobs")
async def create_job(
    files: list[UploadFile] = File(...),
    mode: str = Form("panorama"),
    quality: int = Form(95),
    orientations: str | None = Form(None),
):
    if mode not in ("panorama", "sphere"):
        raise HTTPException(400, "mode must be panorama or sphere")
    if len(files) < 2:
        raise HTTPException(400, "need at least two photos")
    job_id = uuid.uuid4().hex[:12]
    work = JOBS_DIR / job_id
    work.mkdir(parents=True)
    for k, f in enumerate(files):
        # keep shooting order: prefix with index, keep a safe file name
        safe = "".join(c for c in Path(f.filename or f"img{k}.jpg").name if c.isalnum() or c in "._-")
        with open(work / f"{k:04d}_{safe}", "wb") as out:
            shutil.copyfileobj(f.file, out)
    job = {
        "id": job_id, "mode": mode, "quality": max(70, min(100, quality)), "status": "queued",
        "dir": str(work), "log": [], "created": time.time(),
        "orientations": json.loads(orientations) if orientations else None,
    }
    jobs[job_id] = job
    _log(job, f"received {len(files)} photos ({mode})")
    pool.submit(_run, job_id)
    return {"id": job_id}


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.get(job_id) or _404()
    return {k: job.get(k) for k in ("id", "mode", "status", "error")} | {"log": job["log"][-60:]}


@app.get("/jobs/{job_id}/result")
def job_result(job_id: str):
    job = jobs.get(job_id) or _404()
    if job["status"] != "done":
        raise HTTPException(409, "not finished")
    return FileResponse(job["result"], media_type="image/jpeg", filename="panorama.jpg")


@app.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    job = jobs.pop(job_id, None) or _404()
    shutil.rmtree(job["dir"], ignore_errors=True)
    return JSONResponse({"deleted": job_id})


def _404():
    raise HTTPException(404, "no such job")
