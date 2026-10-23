"""Atlas registry and coordinate lookup.

Each atlas lives in atlases/<id>/ with:
  atlas.json       manifest (name, space, citation, which maps exist, ...)
  labels.tsv       image value -> region name
  label_map.nii.gz 3D integer parcellation            (optional)
  prob_map.nii.gz  4D probabilities, uint8 percent;   (optional)
                   volume v belongs to label value v + 1 (FSL convention)

At least one of the two maps must exist. Everything is queried in mm, using
each atlas's own affine, so atlases on different grids can sit side by side.
An atlas in a non-MNI space (e.g. Talairach) sets `mm_transform`, a 4x4
matrix taking query (MNI) mm to the atlas's mm before sampling.
"""
from __future__ import annotations

import json
import shutil
from collections import Counter
from dataclasses import asdict, dataclass, field
from functools import cached_property, lru_cache
from pathlib import Path

import nibabel as nib
import numpy as np

from .config import ATLASES_DIR
from .labels import read_labels, write_labels_tsv

LABEL_FILE = "label_map.nii.gz"
PROB_FILE = "prob_map.nii.gz"
# For atlases with an mm_transform: the label map resampled onto an MNI 1 mm
# grid, so it can be drawn on the MNI template and quizzed on.
OVERLAY_FILE = "overlay_map_mni.nii.gz"
MNI_1MM_SHAPE = (197, 233, 189)
MNI_1MM_AFFINE = np.array([[1, 0, 0, -98], [0, 1, 0, -134], [0, 0, 1, -72], [0, 0, 0, 1]], float)


@dataclass
class Manifest:
    id: str
    name: str
    space: str
    kind: str = "anatomical"  # anatomical | functional
    has_label_map: bool = False
    has_prob_map: bool = False
    lateralize: bool = False  # prefix Left/Right from x (for bilateral labels)
    citation: str = ""
    doi: str = ""
    url: str = ""
    description: str = ""
    order: int = 100
    enabled: bool = True
    role: str = ""  # short label for the summary strip, e.g. "Brodmann area"
    mm_transform: list | None = None  # 4x4, query MNI mm -> atlas mm
    extra: dict = field(default_factory=dict)


class Atlas:
    def __init__(self, folder: Path):
        self.folder = folder
        self.manifest = Manifest(**json.loads((folder / "atlas.json").read_text()))
        self.labels = read_labels(folder / "labels.tsv")

    @property
    def id(self) -> str:
        return self.manifest.id

    @cached_property
    def _label_img(self):
        img = nib.load(str(self.folder / LABEL_FILE))
        return np.asarray(img.dataobj).astype(np.int32), img.affine

    @cached_property
    def _prob_img(self):
        img = nib.load(str(self.folder / PROB_FILE))
        return np.asarray(img.dataobj), img.affine

    @cached_property
    def mni_labels(self):
        """(data, affine) of the label map in MNI space, for drawing and sampling."""
        if self.manifest.mm_transform is None:
            return self._label_img
        img = nib.load(str(self.folder / OVERLAY_FILE))
        return np.asarray(img.dataobj).astype(np.int32), img.affine

    def load(self) -> None:
        """Read the maps into memory now instead of on the first query."""
        if self.manifest.has_label_map:
            self._label_img
        if self.manifest.has_prob_map:
            self._prob_img

    def _name(self, value: int, x_mm: float) -> str:
        name = self.labels.get(int(value), f"Unlisted value {value}")
        if self.manifest.lateralize and x_mm != 0:
            name = f"{'Left' if x_mm < 0 else 'Right'} {name}"
        return name

    def lookup(self, xyz, radius_mm: float = 4.0, top_k: int = 5) -> dict:
        m = self.manifest
        out = {"atlas": self.info(), "in_bounds": False}
        xyz = np.asarray(xyz, dtype=float)
        if m.mm_transform is not None:
            xyz = (np.asarray(m.mm_transform) @ np.append(xyz, 1.0))[:3]
            out["atlas_mm"] = xyz.round(1).tolist()

        if m.has_label_map:
            data, affine = self._label_img
            ijk = _mm_to_ijk(affine, xyz)
            out["voxel"] = ijk.tolist()
            if _inside(ijk, data.shape):
                out["in_bounds"] = True
                value = int(data[tuple(ijk)])
                out["label"] = (
                    {"value": value, "name": self._name(value, xyz[0])} if value else None
                )
                out["nearest"] = None if value else self._nearest(data, affine, ijk, radius_mm)
                out["neighborhood"] = self._neighborhood(data, affine, ijk, radius_mm, top_k)

        if m.has_prob_map:
            data, affine = self._prob_img
            ijk = _mm_to_ijk(affine, xyz)
            out.setdefault("voxel", ijk.tolist())
            if _inside(ijk, data.shape[:3]):
                out["in_bounds"] = True
                probs = data[tuple(ijk)].astype(float) / 100.0
                order = np.argsort(probs)[::-1][:top_k]
                out["probabilities"] = [
                    {"value": int(v) + 1, "name": self._name(v + 1, xyz[0]), "p": round(probs[v], 3)}
                    for v in order
                    if probs[v] > 0
                ]
        return out

    def _nearest(self, data, affine, ijk, radius_mm):
        """Closest labelled voxel within radius_mm, for points that land in a gap."""
        idx, dist = _sphere(data.shape, affine, ijk, radius_mm)
        vals = data[tuple(idx.T)]
        hit = vals > 0
        if not hit.any():
            return None
        k = np.argmin(np.where(hit, dist, np.inf))
        hit_xyz = _ijk_to_mm(affine, idx[k])
        return {
            "value": int(vals[k]),
            "name": self._name(vals[k], hit_xyz[0]),
            "distance_mm": round(float(dist[k]), 2),
        }

    def _neighborhood(self, data, affine, ijk, radius_mm, top_k):
        """Share of voxels within radius_mm belonging to each label.

        This is the useful "how sure are we" readout for hard parcellations,
        given smoothing, registration error and template differences.
        """
        if radius_mm <= 0:
            return []
        idx, _ = _sphere(data.shape, affine, ijk, radius_mm)
        vals = data[tuple(idx.T)]
        counts = Counter(vals.tolist())
        n = len(vals)
        rows = []
        for value, c in counts.most_common():
            if value == 0:
                name = "(unlabelled)"
            else:
                # Lateralize from the side most of this label's voxels sit on.
                xs = _ijk_to_mm(affine, idx[vals == value])[:, 0]
                name = self._name(value, float(np.median(xs)))
            rows.append({"value": int(value), "name": name, "fraction": round(c / n, 3)})
        return rows[:top_k]

    def info(self) -> dict:
        d = asdict(self.manifest)
        d["n_regions"] = len(self.labels)
        # Overlays are drawn on the MNI template, so only for MNI-space label maps.
        d["can_overlay"] = self.manifest.has_label_map and (
            self.manifest.mm_transform is None or (self.folder / OVERLAY_FILE).exists())
        return d


# --- geometry helpers ----------------------------------------------------------

def _mm_to_ijk(affine, xyz) -> np.ndarray:
    return np.rint((np.linalg.inv(affine) @ np.append(xyz, 1.0))[:3]).astype(int)


def _ijk_to_mm(affine, ijk) -> np.ndarray:
    return np.asarray(ijk, dtype=float) @ affine[:3, :3].T + affine[:3, 3]


def _inside(ijk, shape) -> bool:
    return bool(np.all(ijk >= 0) and np.all(ijk < np.asarray(shape[:3])))


@lru_cache(maxsize=64)
def _sphere_offsets(affine_key: tuple, radius_mm: float):
    affine = np.asarray(affine_key).reshape(4, 4)
    vox = np.sqrt((affine[:3, :3] ** 2).sum(axis=0))
    r = np.ceil(radius_mm / vox).astype(int)
    grid = np.mgrid[-r[0]:r[0] + 1, -r[1]:r[1] + 1, -r[2]:r[2] + 1].reshape(3, -1).T
    dist = np.linalg.norm(grid @ affine[:3, :3].T, axis=1)
    keep = dist <= radius_mm + 1e-6
    return grid[keep], dist[keep]


def _sphere(shape, affine, ijk, radius_mm):
    """Voxel indices (and mm distances) within radius_mm of ijk, clipped to the volume."""
    offsets, dist = _sphere_offsets(tuple(np.round(affine, 6).ravel()), float(radius_mm))
    idx = offsets + ijk
    ok = np.all((idx >= 0) & (idx < np.asarray(shape[:3])), axis=1)
    return idx[ok], dist[ok]


# --- registry ------------------------------------------------------------------

def load_atlases(atlases_dir: Path = ATLASES_DIR, preload: bool = True) -> dict[str, Atlas]:
    atlases = []
    for f in sorted(atlases_dir.glob("*/atlas.json")):
        a = Atlas(f.parent)
        if a.manifest.enabled:
            if preload:
                a.load()
            atlases.append(a)
    atlases.sort(key=lambda a: (a.manifest.order, a.manifest.name))
    return {a.id: a for a in atlases}


def add_atlas(
    id: str,
    name: str,
    space: str,
    labels,
    label_map=None,
    prob_map=None,
    atlases_dir: Path = ATLASES_DIR,
    overwrite: bool = False,
    **manifest_fields,
) -> Path:
    """Register an atlas from files (or in-memory nibabel images).

    labels: path to a label file (see labels.py) or a {value: name} dict.
    label_map: 3D integer NIfTI. prob_map: 4D NIfTI, volume v <-> label v + 1,
    values either 0-1 or 0-100.
    """
    if label_map is None and prob_map is None:
        raise ValueError("Need a label_map, a prob_map, or both.")
    folder = atlases_dir / id
    if folder.exists():
        if not overwrite:
            raise FileExistsError(f"{folder} exists; pass overwrite=True / --overwrite")
        shutil.rmtree(folder)
    folder.mkdir(parents=True)

    labels = dict(labels) if isinstance(labels, dict) else read_labels(labels)
    labels = {int(k): str(v) for k, v in labels.items() if int(k) != 0}
    warnings = []

    if label_map is not None:
        img = _as_img(label_map)
        data = np.asarray(img.dataobj)
        if data.ndim != 3:
            raise ValueError(f"label_map must be 3D, got shape {data.shape}")
        if not np.allclose(data, np.rint(data)):
            raise ValueError("label_map has non-integer values; is it really a parcellation?")
        data = np.rint(data).astype(np.int16 if data.max() < 32767 else np.int32)
        missing = sorted(set(np.unique(data).tolist()) - set(labels) - {0})
        if missing:
            warnings.append(f"{len(missing)} values in label_map have no name: {missing[:10]}")
        _save(data, img, folder / LABEL_FILE)
        if manifest_fields.get("mm_transform") is not None:
            mni = _resample_to_mni(data, img.affine, np.asarray(manifest_fields["mm_transform"]))
            _save(mni, nib.Nifti1Image(mni, MNI_1MM_AFFINE), folder / OVERLAY_FILE)

    if prob_map is not None:
        img = _as_img(prob_map)
        data = np.asarray(img.dataobj, dtype=np.float32)
        if data.ndim != 4:
            raise ValueError(f"prob_map must be 4D, got shape {data.shape}")
        if data.max() <= 1.0 + 1e-6:
            data = data * 100.0
        data = np.clip(np.rint(data), 0, 100).astype(np.uint8)
        if data.shape[3] > max(labels):
            warnings.append(f"prob_map has {data.shape[3]} volumes but labels stop at {max(labels)}")
        _save(data, img, folder / PROB_FILE)

    write_labels_tsv(labels, folder / "labels.tsv")
    manifest = Manifest(
        id=id,
        name=name,
        space=space,
        has_label_map=label_map is not None,
        has_prob_map=prob_map is not None,
        **manifest_fields,
    )
    if warnings:
        manifest.extra["import_warnings"] = warnings
    (folder / "atlas.json").write_text(json.dumps(asdict(manifest), indent=2) + "\n")
    for w in warnings:
        print(f"  warning [{id}]: {w}")
    return folder


def _resample_to_mni(data, affine, mm_transform):
    """Nearest-neighbour resample of a label map onto the MNI 1 mm grid.

    mm_transform maps MNI mm to the atlas's mm, so each MNI voxel looks up
    the atlas voxel it lands on.
    """
    out = np.zeros(MNI_1MM_SHAPE, dtype=data.dtype)
    to_src = np.linalg.inv(affine) @ mm_transform @ MNI_1MM_AFFINE
    ii, jj = np.meshgrid(np.arange(MNI_1MM_SHAPE[0]), np.arange(MNI_1MM_SHAPE[1]), indexing="ij")
    for k in range(MNI_1MM_SHAPE[2]):
        pts = np.stack([ii.ravel(), jj.ravel(), np.full(ii.size, k), np.ones(ii.size)])
        src = np.rint(to_src @ pts)[:3].astype(int)
        ok = np.all((src >= 0) & (src < np.asarray(data.shape)[:, None]), axis=0)
        sl = np.zeros(ii.size, dtype=data.dtype)
        sl[ok] = data[src[0, ok], src[1, ok], src[2, ok]]
        out[:, :, k] = sl.reshape(ii.shape)
    return out


def _as_img(x):
    return nib.load(str(x)) if isinstance(x, (str, Path)) else x


def _save(data, like, path):
    hdr = like.header.copy()
    hdr.set_data_dtype(data.dtype)
    hdr["scl_slope"], hdr["scl_inter"] = 1, 0
    nib.Nifti1Image(data, like.affine, hdr).to_filename(str(path))
