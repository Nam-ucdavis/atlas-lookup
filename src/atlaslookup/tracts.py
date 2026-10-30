"""White-matter tracts near chosen regions, for the Regions panel's "Connecting
tracts" list, and tract surfaces for the 3D view.

Tract atlases (JHU, XTRACT; manifest extra["tract"]) are probabilistic: each voxel
holds the % of subjects whose tract passed there. A tract "touches" a region when
its core (probability >= threshold) comes within `distance_mm` of the region, and
the contact is the volume (mm^3) of that overlap. Tracts that touch two or more of
the chosen regions are reported as linking them.

This is atlas-based proximity, not tractography of the user's data: population
tracts often stop short of the cortex, hence the distance tolerance.
"""
from __future__ import annotations

from functools import lru_cache

import nibabel as nib
import numpy as np
from scipy import ndimage

from .atlas import MNI_1MM_AFFINE, Atlas
from .regions import _region_1mm, regions, surface

MIN_CONTACT_MM3 = 8  # ignore a few stray voxels


def is_tract_atlas(atlas: Atlas) -> bool:
    return bool(atlas.manifest.extra.get("tract")) and atlas.manifest.has_prob_map


def default_threshold(atlas: Atlas) -> int:
    return int(atlas.manifest.extra.get("threshold", 25))


def listing(atlas: Atlas) -> dict:
    data, _ = atlas._prob_img
    present = data.reshape(-1, data.shape[3]).max(0)
    return {"atlas": atlas.id, "atlas_name": atlas.manifest.name, "threshold": default_threshold(atlas),
            "tracts": [{"value": v, "name": n} for v, n in sorted(atlas.labels.items())
                       if v <= len(present) and present[v - 1] > 0]}


@lru_cache(maxsize=64)
def _zone(atlas: Atlas, value: int, side: str, distance_mm: float) -> np.ndarray:
    """mm coordinates of the 1 mm voxels in the region or within distance_mm of it."""
    idx = np.argwhere(_region_1mm(atlas, value, side))
    if not len(idx):
        return np.empty((0, 3))
    r = int(np.ceil(distance_mm)) + 1
    lo = idx.min(0) - r
    sub = np.zeros(idx.max(0) - lo + r + 1, bool)
    sub[tuple((idx - lo).T)] = True
    near = ndimage.distance_transform_edt(~sub) <= distance_mm + 1e-6
    vox = np.argwhere(near) + lo
    return vox @ MNI_1MM_AFFINE[:3, :3].T + MNI_1MM_AFFINE[:3, 3]


def _probs_at(atlas: Atlas, mm: np.ndarray) -> np.ndarray:
    """Tract probabilities (N x tracts, %) at mm points; 0 outside the atlas grid."""
    data, affine = atlas._prob_img
    ijk = np.rint(np.c_[mm, np.ones(len(mm))] @ np.linalg.inv(affine)[:3].T).astype(int)
    ok = np.all((ijk >= 0) & (ijk < data.shape[:3]), axis=1)
    out = np.zeros((len(mm), data.shape[3]), data.dtype)
    out[ok] = data[tuple(ijk[ok].T)]
    return out


def connections(tract_atlas: Atlas, chosen: list[tuple[Atlas, int, str]],
                threshold: float, distance_mm: float) -> dict:
    """Tracts touching each chosen region, strongest first; tracts touching more
    regions come first, with the pairs they link."""
    names = []
    contact = np.zeros((len(chosen), len(tract_atlas.labels)), np.int64)
    peak = np.zeros_like(contact)
    for k, (atlas, value, side) in enumerate(chosen):
        names.append(next((r["name"] for r in regions(atlas) if r["value"] == value and r["side"] == side),
                          f"{atlas.id} {value}"))
        p = _probs_at(tract_atlas, _zone(atlas, value, side, float(distance_mm)))
        n = min(p.shape[1], contact.shape[1])
        contact[k, :n] = (p[:, :n] >= threshold).sum(0)
        peak[k, :n] = p[:, :n].max(0) if len(p) else 0
    out = []
    for t, (value, name) in enumerate(sorted(tract_atlas.labels.items())):
        touched = [k for k in range(len(chosen)) if contact[k, t] >= MIN_CONTACT_MM3]
        if not touched:
            continue
        out.append({
            "value": value, "name": name,
            "contacts": [int(contact[k, t]) for k in range(len(chosen))],
            "peak": [int(peak[k, t]) for k in range(len(chosen))],
            "touches": touched,
            "links": [[a, b] for i, a in enumerate(touched) for b in touched[i + 1:]],
        })
    out.sort(key=lambda r: (-len(r["touches"]), -sum(r["contacts"])))
    return {"atlas": tract_atlas.id, "atlas_name": tract_atlas.manifest.name, "threshold": threshold,
            "distance_mm": distance_mm, "regions": names, "tracts": out}


@lru_cache(maxsize=64)
def mesh_gifti(atlas: Atlas, value: int, threshold: float) -> bytes:
    """A tract's core (probability >= threshold) as a smooth surface. The 2 mm map is
    interpolated to 1 mm first so the surface follows the tract, not its voxels."""
    data, affine = atlas._prob_img
    vol = data[..., value - 1].astype(np.float32)
    if not (vol >= threshold).any():
        raise ValueError("empty tract at this threshold")
    nz = np.argwhere(vol > 0)
    lo, hi = np.maximum(nz.min(0) - 1, 0), np.minimum(nz.max(0) + 2, vol.shape)
    crop = vol[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
    fine = ndimage.zoom(crop, 2, order=1, grid_mode=False)
    step = (np.array(crop.shape) - 1) / np.maximum(np.array(fine.shape) - 1, 1)
    fine_aff = affine.copy()
    fine_aff[:3, :3] = affine[:3, :3] * step
    fine_aff[:3, 3] = affine[:3, :3] @ lo + affine[:3, 3]
    verts, tris = surface(fine >= threshold, fine_aff, smooth=8)
    img = nib.gifti.GiftiImage(darrays=[
        nib.gifti.GiftiDataArray(verts, intent="NIFTI_INTENT_POINTSET", datatype="NIFTI_TYPE_FLOAT32"),
        nib.gifti.GiftiDataArray(tris, intent="NIFTI_INTENT_TRIANGLE", datatype="NIFTI_TYPE_INT32"),
    ])
    return img.to_bytes()
