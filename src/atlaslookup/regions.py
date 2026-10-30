"""Regions for the 3D view's "Regions" window: every labelled region of every
atlas (per hemisphere where the atlas is bilateral), a combined mask of the
chosen ones on the MNI 1 mm grid (value k for the k-th region), and a smooth
surface mesh per region for drawing it as a solid shape.

Atlases come on different grids (FSL 2 mm, Destrieux's own 2 mm grid, the
resampled Talairach maps at 1 mm), so each chosen region is painted onto one
shared 1 mm grid: every atlas voxel fills the 1 mm voxels it covers.
"""
from __future__ import annotations

import gzip
from functools import lru_cache

import nibabel as nib
import numpy as np
from scipy import sparse

from .atlas import MNI_1MM_AFFINE, MNI_1MM_SHAPE, Atlas
from .quiz import display_name

SIDES = {"L": "Left", "R": "Right", "B": ""}
MAX_REGIONS = 255  # uint8 mask


def _side_mask(shape, affine, side):
    if side == "B":
        return None
    x = np.arange(shape[0]) * affine[0, 0] + affine[0, 3]
    return (x < 0 if side == "L" else x > 0)[:, None, None]


@lru_cache(maxsize=32)
def regions(atlas: Atlas) -> tuple[dict, ...]:
    """Regions present in the atlas, as {value, side, name}."""
    data, affine = atlas.mni_labels
    out = []
    sides = ["L", "R"] if atlas.manifest.lateralize else ["B"]
    for side in sides:
        m = _side_mask(data.shape, affine, side)
        vals = data if m is None else np.where(m, data, 0)
        counts = np.bincount(vals.ravel(), minlength=max(atlas.labels, default=0) + 1)
        for value, name in sorted(atlas.labels.items()):
            if value < len(counts) and counts[value]:
                label = f"{SIDES[side]} {display_name(name)}".strip()
                out.append({"value": value, "side": side, "name": label})
    return tuple(out)


def _paint(out: np.ndarray, atlas: Atlas, value: int, side: str, k: int) -> None:
    data, affine = atlas.mni_labels
    mask = data == value
    m = _side_mask(data.shape, affine, side)
    if m is not None:
        mask &= m
    ijk = np.argwhere(mask)
    if not len(ijk):
        return
    centres = ijk @ affine[:3, :3].T + affine[:3, 3]
    # Offsets (mm) covering one atlas voxel with 1 mm steps: (0) for 1 mm, (-0.5, 0.5) for 2 mm, ...
    size = np.abs(np.diag(affine)[:3])
    axes = [np.arange(round(s)) - (round(s) - 1) / 2 for s in size]
    offsets = np.stack(np.meshgrid(*axes, indexing="ij"), -1).reshape(-1, 3)
    pts = (centres[:, None, :] + offsets[None, :, :]).reshape(-1, 3)
    # Sub-samples sit exactly between 1 mm centres (e.g. +-0.5 mm for a 2 mm voxel), so
    # rounding would send ties to the same voxel; floor maps them to the distinct
    # voxels covered. The small epsilon keeps exact 1 mm centres from flooring down.
    idx = np.c_[pts, np.ones(len(pts))] @ np.linalg.inv(MNI_1MM_AFFINE).T
    vox = np.floor(idx[:, :3] + 1e-3).astype(int)
    ok = np.all((vox >= 0) & (vox < MNI_1MM_SHAPE), axis=1)
    out[tuple(vox[ok].T)] = k


def _region_1mm(atlas: Atlas, value: int, side: str) -> np.ndarray:
    out = np.zeros(MNI_1MM_SHAPE, np.uint8)
    _paint(out, atlas, value, side, 1)
    return out


def surface(mask: np.ndarray, affine: np.ndarray, smooth: int = 12) -> tuple[np.ndarray, np.ndarray]:
    """Closed surface around a binary mask: the voxel faces between inside and
    outside (two triangles each, wound outwards), then Taubin smoothing so the
    staircase becomes a rounded shape without shrinking it. Returns (vertices in mm,
    triangles). Exported for tests."""
    m = np.pad(mask.astype(bool), 1)
    lo = np.argwhere(m).min(0) - 1
    hi = np.argwhere(m).max(0) + 2
    m = m[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
    shape = np.array(m.shape) + 1  # voxel-corner lattice
    corner_id = lambda c: (c[:, 0] * shape[1] + c[:, 1]) * shape[2] + c[:, 2]
    quads = []
    for axis in range(3):
        a, b = [ax for ax in range(3) if ax != axis]
        diff = m.astype(np.int8)
        step = np.diff(diff, axis=axis)  # +1: outside -> inside, -1: inside -> outside
        for sign in (1, -1):
            p = np.argwhere(step == sign)
            p[:, axis] += 1  # the face lies on the far corner plane of the first voxel
            ea, eb = np.eye(3, dtype=int)[a], np.eye(3, dtype=int)[b]
            q = np.stack([p, p + ea, p + ea + eb, p + eb], 1)
            # This corner order has normal cross(ea, eb), which is +axis for x and z but
            # -axis for y. Wind every face so its normal points from inside to outside:
            # +axis where inside -> outside (sign -1), -axis otherwise.
            plus = np.cross(ea, eb)[axis] > 0
            quads.append(q if plus == (sign == -1) else q[:, ::-1])
    quads = np.concatenate(quads)
    ids, inverse = np.unique(corner_id(quads.reshape(-1, 3)), return_inverse=True)
    quads_i = inverse.reshape(-1, 4)
    tris = np.concatenate([quads_i[:, [0, 1, 2]], quads_i[:, [0, 2, 3]]])
    verts = np.stack([ids // (shape[1] * shape[2]), (ids // shape[2]) % shape[1], ids % shape[2]], 1).astype(float)
    # Taubin smoothing (lambda/mu) over the vertex adjacency.
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    adj = sparse.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(verts),) * 2).tocsr()
    adj = ((adj + adj.T) > 0).astype(float)
    norm = sparse.diags(1 / np.maximum(adj.sum(1).A1, 1)) @ adj
    for _ in range(smooth):
        for f in (0.5, -0.53):
            verts = verts + f * (norm @ verts - verts)
    # Corners sit half a voxel from voxel centres; back to mm via the grid's affine.
    vox = verts - 0.5 + lo - 1  # undo the crop and the padding
    mm = vox @ affine[:3, :3].T + affine[:3, 3]
    return mm.astype(np.float32), tris.astype(np.int32)


@lru_cache(maxsize=64)
def mesh_gifti(atlas: Atlas, value: int, side: str) -> bytes:
    mask = _region_1mm(atlas, value, side)
    if not mask.any():
        raise ValueError("empty region")
    verts, tris = surface(mask, MNI_1MM_AFFINE)
    img = nib.gifti.GiftiImage(darrays=[
        nib.gifti.GiftiDataArray(verts, intent="NIFTI_INTENT_POINTSET", datatype="NIFTI_TYPE_FLOAT32"),
        nib.gifti.GiftiDataArray(tris, intent="NIFTI_INTENT_TRIANGLE", datatype="NIFTI_TYPE_INT32"),
    ])
    return img.to_bytes()


@lru_cache(maxsize=16)
def mask_nifti(atlases: tuple[Atlas, ...], selection: tuple[tuple[str, int, str], ...]) -> bytes:
    """selection: ((atlas_id, value, side), ...); region k (1-based) gets value k.
    Later regions win where two overlap."""
    by_id = {a.id: a for a in atlases}
    out = np.zeros(MNI_1MM_SHAPE, np.uint8)
    for k, (atlas_id, value, side) in enumerate(selection[:MAX_REGIONS], 1):
        _paint(out, by_id[atlas_id], value, side, k)
    img = nib.Nifti1Image(out, MNI_1MM_AFFINE)
    return gzip.compress(img.to_bytes(), compresslevel=3)
