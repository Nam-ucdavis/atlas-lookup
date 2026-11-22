"""CIFTI-2 dense scalar maps (.dscalar.nii) and the fsLR surfaces they live on.

A .dscalar.nii holds several maps (rows) over "grayordinates" (columns). In the HCP
91k layout the columns are:
  - cortex: vertices of the fsLR 32k mesh (CORTEX_LEFT, CORTEX_RIGHT; the medial wall
    is left out). These have no voxel position of their own.
  - everything else: voxels of a volume grid (subcortex, cerebellum, brainstem), with
    the grid's shape and affine in the header.

Each map is offered as its own stat map, with the id `<file>.dscalar.nii/map<k>.nii`
(k from 1). Two views of it:
  - volume: the voxel columns written into the CIFTI's own grid, exactly as stored (no
    resampling; 0 elsewhere). This is what the slices show and what lookups, peaks and
    clusters use.
  - surface: one value per fsLR vertex, left hemisphere first (NaN on the medial wall
    and wherever the map is NaN). The 3D view paints this on the fsLR inflated brain.

fsLR surfaces are not bundled: `atlaslookup add-fslr <folder>` registers the user's
own midthickness and inflated surfaces (e.g. TemplateFlow's tpl-fsLR 32k files, which
are the Conte69 atlas surfaces of Van Essen et al. 2012, Cereb Cortex 22:2241).
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import numpy as np
import nibabel as nib

from .config import FSLR_MESH_FILE, FSLR_MORPH_FILE

CIFTI_PATTERN = re.compile(r"\.dscalar\.nii$", re.IGNORECASE)
MAP_NAME = re.compile(r"^map(\d+)\.nii$")
CORTEX = ("CIFTI_STRUCTURE_CORTEX_LEFT", "CIFTI_STRUCTURE_CORTEX_RIGHT")
SURFACE_NEAR_MM = 3.0  # a point this close to a cortical vertex reads that vertex's value


def split_id(path: Path) -> tuple[Path, int] | None:
    """`.../x.dscalar.nii/map3.nii` -> (`.../x.dscalar.nii`, 2), else None."""
    m = MAP_NAME.match(path.name)
    if m and CIFTI_PATTERN.search(path.parent.name):
        return path.parent, int(m[1]) - 1
    return None


@lru_cache(maxsize=8)
def read(path: str, mtime: float) -> dict:
    """The maps of a .dscalar.nii: names, data (maps x grayordinates, float32) and where
    each column goes (volume voxels, cortex vertices)."""
    img = nib.load(path)
    if not isinstance(img, nib.Cifti2Image):
        raise ValueError("not a CIFTI-2 file")
    names = list(img.header.get_axis(0).name)
    bm = img.header.get_axis(1)
    if not isinstance(bm, nib.cifti2.BrainModelAxis):
        raise ValueError("the second axis is not grayordinates")
    data = np.asarray(img.get_fdata(dtype=np.float32), dtype=np.float32)
    surf = {}
    for name, sl, model in bm.iter_structures():
        if name in CORTEX:
            surf[name] = (np.arange(len(bm))[sl], np.asarray(model.vertex), int(model.nvertices[name]))
    vol_cols = np.flatnonzero(bm.volume_mask)
    out = {"names": names, "data": data, "surface": surf, "volume": None}
    if len(vol_cols):
        out["volume"] = {"shape": tuple(int(s) for s in bm.volume_shape), "affine": np.asarray(bm.affine, float),
                         "cols": vol_cols, "ijk": np.asarray(bm.voxel)[vol_cols]}
    return out


def header_info(path: Path) -> dict | None:
    """Names and layout of a .dscalar.nii without reading the data, for listing."""
    try:
        img = nib.load(str(path))
        names = list(img.header.get_axis(0).name)
        bm = img.header.get_axis(1)
    except Exception:
        return None
    if not isinstance(bm, nib.cifti2.BrainModelAxis):
        return None
    surf = {n: int(bm.nvertices[n]) for n in CORTEX if n in bm.nvertices}
    shape = [int(s) for s in bm.volume_shape] if bm.volume_mask.any() else None
    zooms = [float(abs(z)) for z in np.diag(bm.affine)[:3]] if shape else None
    return {"names": names, "vertices": surf, "n_vertices_used": int(bm.surface_mask.sum()),
            "n_voxels": int(bm.volume_mask.sum()), "shape": shape, "voxel_size": zooms}


def volume(path: str, mtime: float, index: int) -> tuple[np.ndarray, np.ndarray]:
    """Map `index` on the CIFTI's own voxel grid (0 outside its voxels and at NaN)."""
    c = read(path, mtime)
    if not 0 <= index < len(c["names"]):
        raise IndexError(index)
    v = c["volume"]
    if v is None:  # surface-only file: an empty 2 mm MNI grid, so the slices still work
        shape, affine = (91, 109, 91), np.array([[-2, 0, 0, 90], [0, 2, 0, -126], [0, 0, 2, -72], [0, 0, 0, 1]], float)
        return np.zeros(shape, np.float32), affine
    out = np.zeros(v["shape"], np.float32)
    vals = c["data"][index, v["cols"]]
    out[tuple(v["ijk"].T)] = np.where(np.isfinite(vals), vals, 0)
    return out, v["affine"]


def surface(path: str, mtime: float, index: int) -> tuple[np.ndarray, int] | None:
    """Map `index` per fsLR vertex, left then right (NaN where there is no value), and
    the number of left vertices; None if the file has no cortex."""
    c = read(path, mtime)
    if not 0 <= index < len(c["names"]):
        raise IndexError(index)
    if not all(n in c["surface"] for n in CORTEX):
        return None
    parts = []
    for n in CORTEX:
        cols, vert, nv = c["surface"][n]
        h = np.full(nv, np.nan, np.float32)
        h[vert] = c["data"][index, cols]
        parts.append(h)
    return np.concatenate(parts), len(parts[0])


# --- fsLR surfaces (registered by the user) --------------------------------------------

SURF_GLOBS = {  # TemplateFlow names first, then HCP-style names
    ("L", "midthickness"): ["*hemi-L*midthickness*.surf.gii", "*.L.midthickness*.surf.gii", "L.midthickness*.surf.gii"],
    ("R", "midthickness"): ["*hemi-R*midthickness*.surf.gii", "*.R.midthickness*.surf.gii", "R.midthickness*.surf.gii"],
    ("L", "inflated"): ["*hemi-L*_inflated*.surf.gii", "*.L.inflated*.surf.gii", "L.inflated*.surf.gii"],
    ("R", "inflated"): ["*hemi-R*_inflated*.surf.gii", "*.R.inflated*.surf.gii", "R.inflated*.surf.gii"],
}


def find_surfaces(folder: Path) -> dict:
    """The four fsLR surface files in `folder` (32k preferred if several densities)."""
    found = {}
    for key, globs in SURF_GLOBS.items():
        hits = sorted({p for g in globs for p in folder.glob(g) if "veryinflated" not in p.name.lower()})
        if len(hits) > 1:
            hits = [p for p in hits if "32k" in p.name] or hits
        if len(hits) != 1:
            raise FileNotFoundError(f"{key[0]} {key[1]}: found {len(hits)} matching files in {folder}"
                                    + ("" if not hits else ": " + ", ".join(p.name for p in hits)))
        found[key] = hits[0]
    return found


def convexity_shade(mid: np.ndarray, inflated: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """A sulcal-depth stand-in for shading (the fsLR files carry no sulc map): how far each
    vertex moves outwards along the inflated surface's normal when the hemisphere is
    inflated, after scaling the inflated surface to the midthickness one. Deep sulci move
    out the most, as with FreeSurfer's sulc. Standardised; for display only."""
    from .sources import sulcal_shade

    lo, hi = inflated.min(0), inflated.max(0)
    k = np.ptp(mid[:, 1]) / (hi[1] - lo[1])
    infl = (inflated - (lo + hi) / 2) * k + (mid.min(0) + mid.max(0)) / 2
    n = np.zeros_like(infl)
    a, b, c = infl[tris[:, 0]], infl[tris[:, 1]], infl[tris[:, 2]]
    fn = np.cross(b - a, c - a)
    for j in range(3):
        np.add.at(n, tris[:, j], fn)
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    if np.mean(np.sum(n * (infl - infl.mean(0)), axis=1)) < 0:  # make them point outwards
        n = -n
    d = np.sum((infl - mid) * n, axis=1)
    d = (d - np.median(d)) / (d.std() + 1e-6)
    return sulcal_shade(d)


def add_fslr(folder: str | Path) -> dict:
    """Register the user's fsLR midthickness and inflated surfaces for the 3D view. Writes
    the midthickness of both hemispheres as one GIfTI and, in the inflated brain's format
    (see sources.export_inflated), the inflated positions and a shading value per vertex.
    Nothing is downloaded."""
    from .sources import inflated_targets

    folder = Path(folder).expanduser().resolve()
    files = find_surfaces(folder)
    mids, infls, faces, shade, offset, counts = [], [], [], [], 0, []
    for side in ("L", "R"):
        gm, gi = nib.load(str(files[side, "midthickness"])), nib.load(str(files[side, "inflated"]))
        v, f = gm.agg_data("pointset").astype(np.float32), gm.agg_data("triangle").astype(np.int64)
        vi = gi.agg_data("pointset").astype(np.float32)
        if len(v) != len(vi):
            raise ValueError(f"{side}: midthickness has {len(v)} vertices, inflated {len(vi)}")
        counts.append(len(v))
        mids.append(v)
        infls.append(vi)
        shade.append(convexity_shade(v, vi, f))
        faces.append((f + offset).astype(np.int32))
        offset += len(v)
    if np.mean(mids[0][:, 0]) > 0 or np.mean(mids[1][:, 0]) < 0:
        raise ValueError("the left surface is not on the left (x < 0): check the files")
    img = nib.gifti.GiftiImage(darrays=[
        nib.gifti.GiftiDataArray(np.vstack(mids), intent="NIFTI_INTENT_POINTSET", datatype="NIFTI_TYPE_FLOAT32"),
        nib.gifti.GiftiDataArray(np.vstack(faces), intent="NIFTI_INTENT_TRIANGLE", datatype="NIFTI_TYPE_INT32"),
    ])
    FSLR_MESH_FILE.parent.mkdir(parents=True, exist_ok=True)
    nib.save(img, str(FSLR_MESH_FILE))
    targets = np.vstack(inflated_targets(mids, infls))
    with open(FSLR_MORPH_FILE, "wb") as fh:
        fh.write(np.array([counts[0], offset], "<u4").tobytes())
        fh.write(targets.astype("<f4").tobytes())
        fh.write(np.concatenate(shade).astype("<f4").tobytes())
    fslr_midthickness.cache_clear()
    return {"left": counts[0], "right": counts[1], "files": {f"{s} {k}": p.name for (s, k), p in files.items()}}


@lru_cache(maxsize=1)
def fslr_midthickness() -> tuple[np.ndarray, int] | None:
    """Registered fsLR midthickness vertices (left then right, mm) and the left count."""
    if not (FSLR_MESH_FILE.exists() and FSLR_MORPH_FILE.exists()):
        return None
    pts = nib.load(str(FSLR_MESH_FILE)).agg_data("pointset").astype(np.float32)
    n_left = int(np.frombuffer(FSLR_MORPH_FILE.read_bytes()[:4], "<u4")[0])
    return pts, n_left


def surface_matches(values: np.ndarray, n_left: int) -> bool:
    """Whether a map's vertices match the registered fsLR surfaces."""
    m = fslr_midthickness()
    return bool(m and len(m[0]) == len(values) and m[1] == n_left)
