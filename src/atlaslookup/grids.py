"""Reference voxel grids, used to turn voxel indices into MNI mm.

A grid is just a shape + affine (+ the template space it lives in), saved as
grids/<id>.json. Register one from any NIfTI on that grid (e.g. an spmT map
or a mask from your pipeline) with `python -m atlaslookup add-grid`.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import nibabel as nib
import numpy as np

from .config import GRIDS_DIR


@dataclass
class Grid:
    id: str
    name: str
    space: str
    shape: list[int]
    affine: list[list[float]]
    source: str = ""

    @property
    def voxel_size(self) -> list[float]:
        a = np.asarray(self.affine)[:3, :3]
        return np.sqrt((a**2).sum(axis=0)).round(3).tolist()

    def voxel_to_mm(self, ijk, base: int = 0) -> np.ndarray:
        ijk = np.asarray(ijk, dtype=float) - base
        return (np.asarray(self.affine) @ np.append(ijk, 1.0))[:3]

    def mm_to_voxel(self, xyz, base: int = 0) -> np.ndarray:
        inv = np.linalg.inv(np.asarray(self.affine))
        return np.rint((inv @ np.append(np.asarray(xyz, float), 1.0))[:3]).astype(int) + base

    def in_bounds(self, ijk, base: int = 0) -> bool:
        ijk = np.asarray(ijk) - base
        return bool(np.all(ijk >= 0) and np.all(ijk < np.asarray(self.shape[:3])))

    def to_dict(self) -> dict:
        return {**asdict(self), "voxel_size": self.voxel_size}


def grid_from_image(path, id: str, name: str, space: str) -> Grid:
    """path: a NIfTI filename or an already-loaded nibabel image."""
    img = nib.load(str(path)) if isinstance(path, (str, Path)) else path
    return Grid(
        id=id,
        name=name,
        space=space,
        shape=[int(s) for s in img.shape[:3]],
        affine=np.asarray(img.affine).round(6).tolist(),
        source=Path(path).name if isinstance(path, (str, Path)) else "",
    )


def save_grid(grid: Grid, grids_dir: Path = GRIDS_DIR) -> Path:
    grids_dir.mkdir(parents=True, exist_ok=True)
    out = grids_dir / f"{grid.id}.json"
    d = asdict(grid)
    out.write_text(json.dumps(d, indent=2) + "\n")
    return out


def load_grids(grids_dir: Path = GRIDS_DIR) -> dict[str, Grid]:
    grids = {}
    for f in sorted(grids_dir.glob("*.json")):
        g = Grid(**json.loads(f.read_text()))
        grids[g.id] = g
    return grids
