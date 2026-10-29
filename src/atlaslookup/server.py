"""Web API + static UI.

GET /api/version                         live version + git commit
GET /api/atlases                         registered atlases
GET /api/grids                           registered voxel grids
GET /api/lookup?x=&y=&z=[&mode=voxel&grid=&base=1&radius=4&atlases=a,b]
GET /api/template.nii.gz                 MNI152 T1 background for the viewer
GET /api/atlases/{id}/label_map.nii.gz   parcellation in MNI space, for the viewer overlay
GET /api/atlases/{id}/colormap           NiiVue label colormap for that overlay
GET /api/quiz/regions?atlases=a,b        quizzable regions per atlas (with brain division)
GET /api/quiz/divisions                  division names, in display order
GET /api/quiz/point?atlas=&value=&side=  a point well inside a region (side L/R/B)
GET /api/quiz/mask/{atlas}/{value}/{side}.nii.gz   that region as a mask
GET /api/results                         your stat maps (from the local results folder)
GET /api/results/file/{id}               one map, for the viewer
GET /api/results/clusters?map=&threshold=&sign=pos|neg|both&min_voxels=
                                         clusters + peaks, labelled by atlas
GET /api/lookup?...&map={id}             adds the T / p value at the point
POST /api/screenshot                     body: a PNG of the viewer; saved as image/<date_time>.png and shown in Finder/Explorer

The lookup endpoint is stateless (one coordinate in, all atlas readouts out);
the viewer in the UI calls it on every click.
"""
from __future__ import annotations

import colorsys

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .atlas import LABEL_FILE, OVERLAY_FILE, load_atlases
from .config import IMAGE_DIR, STATIC_DIR, TEMPLATE_FILE
from .grids import load_grids
from .screenshots import MAX_BYTES, reveal, save_png
from . import quiz
from .results import Results, configured_dir, repo_warning
from .query import best_guess, query, resolve_mm
from .version import version_info

app = FastAPI(title="Atlas lookup")
ATLASES = load_atlases()
GRIDS = load_grids()
RESULTS = Results(configured_dir())
# Atlases used to label cluster peaks, in column order.
PEAK_ATLASES = ["harvard-oxford-cort", "harvard-oxford-sub", "juelich", "talairach-ba"]


@app.middleware("http")
async def no_stale_ui(request, call_next):
    # Make browsers revalidate the page and its scripts, so a restart after
    # an update is enough (they otherwise keep serving a cached old UI).
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/version")
def version():
    return version_info()


@app.get("/api/atlases")
def atlases():
    return [a.info() for a in ATLASES.values()]


@app.get("/api/grids")
def grids():
    return [g.to_dict() for g in GRIDS.values()]


@app.post("/api/screenshot")
async def screenshot(request: Request):
    # Requiring image/png also keeps other websites out: a cross-site request with
    # that type needs a CORS preflight, which this server never grants.
    if request.headers.get("content-type") != "image/png":
        raise HTTPException(415, "Send the image as image/png")
    # Refuse an oversized upload before reading it into memory.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(413, "Image too large")
    data = await request.body()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image too large")
    try:
        path = save_png(data, IMAGE_DIR)
    except ValueError as e:
        raise HTTPException(400, str(e))
    reveal(path)
    return {"file": path.name, "folder": str(path.parent)}


@app.get("/api/lookup")
def lookup(
    x: float, y: float, z: float,
    mode: str = Query("mm", pattern="^(mm|voxel)$"),
    grid: str | None = None,
    base: int = Query(1, ge=0, le=1),
    radius: float = Query(4.0, ge=0, le=20),
    top_k: int = Query(5, ge=1, le=20),
    atlases: str | None = None,
    map: str | None = None,
):
    g = None
    if grid:
        g = GRIDS.get(grid)
        if g is None:
            raise HTTPException(404, f"Unknown grid {grid!r}")
    try:
        where = resolve_mm([x, y, z], mode, g, base)
    except ValueError as e:
        raise HTTPException(400, str(e))
    only = atlases.split(",") if atlases else None
    results = query(ATLASES, where["mm"], radius_mm=radius, top_k=top_k, only=only)
    for r in results:
        r["best_guess"] = best_guess(r)
    out = {"coordinate": where, "results": results}
    if map:
        try:
            out["stat"] = RESULTS.value(map, where["mm"])
        except FileNotFoundError:
            raise HTTPException(404, f"No stat map {map!r}")
    return out


@app.get("/api/template.nii.gz")
def template():
    if not TEMPLATE_FILE.exists():
        raise HTTPException(404, "No template; run `python -m atlaslookup bootstrap`")
    return FileResponse(TEMPLATE_FILE, media_type="application/gzip")


def _overlay_atlas(atlas_id: str):
    a = ATLASES.get(atlas_id)
    if a is None or not a.info()["can_overlay"]:
        raise HTTPException(404, f"No overlay for {atlas_id!r}")
    return a


@app.get("/api/atlases/{atlas_id}/label_map.nii.gz")
def label_map(atlas_id: str):
    a = _overlay_atlas(atlas_id)
    name = LABEL_FILE if a.manifest.mm_transform is None else OVERLAY_FILE
    return FileResponse(a.folder / name, media_type="application/gzip")


@app.get("/api/atlases/{atlas_id}/colormap")
def colormap(atlas_id: str):
    """Distinct, stable colours per label (golden-ratio hue walk)."""
    a = _overlay_atlas(atlas_id)
    idx = [0] + sorted(a.labels)
    R, G, B, A = [0], [0], [0], [0]
    for n, _ in enumerate(idx[1:]):
        r, g, b = colorsys.hls_to_rgb((n * 0.618034) % 1, 0.55, 0.65)
        R.append(round(r * 255)); G.append(round(g * 255)); B.append(round(b * 255)); A.append(255)
    return {"R": R, "G": G, "B": B, "A": A, "I": idx, "labels": [""] + [a.labels[i] for i in idx[1:]]}


def _quiz_atlas(atlas_id: str):
    if atlas_id not in quiz.QUIZ_ATLASES or atlas_id not in ATLASES:
        raise HTTPException(404, f"{atlas_id!r} is not a quiz atlas")
    return ATLASES[atlas_id]


@app.get("/api/quiz/regions")
def quiz_regions(atlases: str | None = None):
    ids = atlases.split(",") if atlases else [i for i in quiz.QUIZ_ATLASES if i in ATLASES]
    out = []
    for i in ids:
        a = _quiz_atlas(i)
        out.append({"atlas": a.id, "atlas_name": a.manifest.name, "role": a.manifest.role,
                    "regions": quiz.regions(a)})
    return out


@app.get("/api/quiz/divisions")
def quiz_divisions():
    return [d for d, _ in quiz.DIVISIONS]


@app.get("/api/quiz/point")
def quiz_point(atlas: str, value: int, side: str = Query("B", pattern="^[LRB]$")):
    p = quiz.point(_quiz_atlas(atlas), value, side)
    if p is None:
        raise HTTPException(404, "No usable point in that region")
    return p


@app.get("/api/quiz/mask/{atlas_id}/{value}/{side}.nii.gz")
def quiz_mask(atlas_id: str, value: int, side: str):
    if side not in ("L", "R", "B"):
        raise HTTPException(400, "side must be L, R or B")
    return Response(quiz.mask_nifti(_quiz_atlas(atlas_id), value, side), media_type="application/gzip")


@app.get("/api/results")
def results_list():
    root = RESULTS.root
    return {"folder": str(root) if root else None, "available": RESULTS.available,
            "warning": repo_warning(root) if RESULTS.available else None,
            "maps": RESULTS.list()}


@app.get("/api/results/file/{rel:path}")
def results_file(rel: str):
    try:
        return FileResponse(RESULTS.resolve(rel), media_type="application/octet-stream")
    except FileNotFoundError:
        raise HTTPException(404, "No such stat map")


@app.get("/api/results/clusters")
def results_clusters(
    map: str,
    threshold: float = Query(3.0, gt=0),
    sign: str = Query("both", pattern="^(pos|neg|both)$"),
    min_voxels: int = Query(5, ge=1),
):
    try:
        res = RESULTS.clusters(map, threshold, sign, min_voxels)
    except FileNotFoundError:
        raise HTTPException(404, f"No stat map {map!r}")
    labelled = [i for i in PEAK_ATLASES if i in ATLASES]
    for c in res["clusters"]:
        c["labels"] = {r["atlas"]["id"]: best_guess(r)
                       for r in query(ATLASES, c["peak_mm"], radius_mm=5, only=labelled)}
    res["label_atlases"] = [{"id": i, "role": ATLASES[i].manifest.role, "name": ATLASES[i].manifest.name}
                            for i in labelled]
    return res


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
