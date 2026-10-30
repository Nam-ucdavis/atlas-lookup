"""Web API + static UI.

GET /api/version                         live version + git commit
GET /api/versions                        tagged releases the app can switch to (git checkouts only)
POST /api/versions/switch  {"to": tag|"dev"}   restart this server on that version (JSON only)
GET /api/atlases                         registered atlases
GET /api/grids                           registered voxel grids
GET /api/lookup?x=&y=&z=[&mode=voxel&grid=&base=1&radius=4&atlases=a,b]
GET /api/template.nii.gz                 MNI152 T1 background for the viewer
GET /api/brain_mesh.gii                  cortical surface (fsaverage5 pial) for the 3D glass/mesh brain
GET /api/regions                         every region of every atlas (per side), for the Regions window
GET /api/regions/mask.nii.gz?sel=atlas|value|side,...   chosen regions as one 1 mm label volume
GET /api/regions/mesh.gii?sel=atlas|value|side          one region as a smooth surface mesh
GET /api/tracts                          tract atlases (JHU, XTRACT) and their tracts
GET /api/tracts/connections?atlas=&sel=atlas|value|side,...&threshold=&distance=
                                         tracts whose core passes near the chosen regions
GET /api/tracts/mesh.gii?atlas=&value=&threshold=   one tract's core as a smooth surface mesh
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
from .config import IMAGE_DIR, MESH_FILE, STATIC_DIR, TEMPLATE_FILE
from .grids import load_grids
from .screenshots import MAX_BYTES, reveal, save_png
from . import quiz, regions, tracts
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


@app.get("/api/versions")
def versions_list():
    from . import versions
    return versions.listing()


@app.post("/api/versions/switch")
async def versions_switch(request: Request):
    # JSON only: a cross-site request with this type needs a CORS preflight, which this
    # server never grants, so other websites cannot switch the version.
    if request.headers.get("content-type", "").split(";")[0] != "application/json":
        raise HTTPException(415, "Send JSON")
    import json
    import os

    from . import versions
    body = await request.json()
    target = str(body.get("to", ""))
    serve = json.loads(os.environ.get("ATLASLOOKUP_SERVE", "{}"))
    if not serve:
        raise HTTPException(409, "Only available when started with `atlaslookup` / `atlaslookup serve`")
    if not versions.available():
        raise HTTPException(409, "Switching versions needs a git checkout")
    try:
        versions.switch(target, serve["host"], serve["port"], serve.get("results"))
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:  # git worktree failed
        raise HTTPException(500, f"Could not prepare {target}: {e}")
    return {"switching_to": target}


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
    threshold: float | None = Query(None, gt=0),
    sign: str = Query("both", pattern="^(pos|neg|both)$"),
    min_voxels: int = Query(5, ge=1),
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
            if threshold:  # which row of the cluster table the point falls in
                out["stat"]["cluster"] = RESULTS.cluster_at(map, where["mm"], threshold, sign, min_voxels)
        except FileNotFoundError:
            raise HTTPException(404, f"No stat map {map!r}")
    return out


@app.get("/api/template.nii.gz")
def template():
    if not TEMPLATE_FILE.exists():
        raise HTTPException(404, "No template; run `python -m atlaslookup bootstrap`")
    return FileResponse(TEMPLATE_FILE, media_type="application/gzip")


@app.get("/api/brain_mesh.gii")
def brain_mesh():
    if not MESH_FILE.exists():  # installs set up before the 3D view existed
        from .sources import export_mesh
        export_mesh()
    return FileResponse(MESH_FILE, media_type="application/octet-stream")


@app.get("/api/regions")
def regions_list():
    # Tracts have their own list (Connecting tracts); their label maps keep only the
    # most likely tract per voxel, which would misdraw overlapping tracts as regions.
    return [{"atlas": a.id, "atlas_name": a.manifest.name, "regions": list(regions.regions(a))}
            for a in ATLASES.values() if a.info()["can_overlay"] and not tracts.is_tract_atlas(a)]


def _parse_regions(sel: str) -> list[tuple[str, int, str]]:
    selection = []
    for item in sel.split(","):
        try:
            atlas_id, value, side = item.split("|")
            value = int(value)
        except ValueError:
            raise HTTPException(400, f"Bad region {item!r}; expected atlas|value|side")
        a = ATLASES.get(atlas_id)
        if a is None or not a.info()["can_overlay"] or side not in regions.SIDES:
            raise HTTPException(404, f"No region {item!r}")
        selection.append((atlas_id, value, side))
    return selection


@app.get("/api/regions/mask.nii.gz")
def regions_mask(sel: str = Query(..., min_length=1)):
    selection = _parse_regions(sel)
    if len(selection) > regions.MAX_REGIONS:
        raise HTTPException(400, f"At most {regions.MAX_REGIONS} regions")
    data = regions.mask_nifti(tuple(ATLASES.values()), tuple(selection))
    return Response(data, media_type="application/gzip")


@app.get("/api/regions/mesh.gii")
def regions_mesh(sel: str):
    try:
        atlas_id, value, side = sel.split("|")
        value = int(value)
    except ValueError:
        raise HTTPException(400, "Expected atlas|value|side")
    a = ATLASES.get(atlas_id)
    if a is None or not a.info()["can_overlay"] or side not in regions.SIDES:
        raise HTTPException(404, f"No region {sel!r}")
    try:
        return Response(regions.mesh_gifti(a, value, side), media_type="application/octet-stream")
    except ValueError:
        raise HTTPException(404, f"Region {sel!r} is empty")


def _tract_atlas(atlas_id: str):
    a = ATLASES.get(atlas_id)
    if a is None or not tracts.is_tract_atlas(a):
        raise HTTPException(404, f"{atlas_id!r} is not a tract atlas")
    return a


@app.get("/api/tracts")
def tracts_list():
    return [tracts.listing(a) for a in ATLASES.values() if tracts.is_tract_atlas(a)]


@app.get("/api/tracts/connections")
def tracts_connections(
    atlas: str,
    sel: str = Query(..., min_length=1),
    threshold: float = Query(25, gt=0, le=100),
    distance: float = Query(3, ge=0, le=15),
):
    t = _tract_atlas(atlas)
    selection = _parse_regions(sel)
    if len(selection) > 20:
        raise HTTPException(400, "At most 20 regions")
    return tracts.connections(t, [(ATLASES[a], v, s) for a, v, s in selection], threshold, distance)


@app.get("/api/tracts/mesh.gii")
def tracts_mesh(atlas: str, value: int, threshold: float = Query(25, gt=0, le=100)):
    t = _tract_atlas(atlas)
    if value not in t.labels:
        raise HTTPException(404, f"No tract {value} in {atlas}")
    try:
        return Response(tracts.mesh_gifti(t, value, threshold), media_type="application/octet-stream")
    except ValueError:
        raise HTTPException(404, "This tract has no voxels at that threshold")


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
