"""Resolve a user coordinate (mm, or voxel on a reference grid) and query atlases."""
from __future__ import annotations

import numpy as np

from .atlas import Atlas
from .grids import Grid


def resolve_mm(coord, mode: str = "mm", grid: Grid | None = None, base: int = 1) -> dict:
    """Return {"mm": [x,y,z], "voxel": ..., "grid": ...} for the input coordinate."""
    coord = np.asarray(coord, dtype=float)
    if mode == "mm":
        out = {"mm": coord.round(2).tolist(), "input": "mm"}
        if grid is not None:
            ijk = grid.mm_to_voxel(coord, base)
            out |= {"grid": grid.id, "voxel": ijk.tolist(), "base": base,
                    "voxel_in_bounds": grid.in_bounds(ijk, base)}
        return out
    if grid is None:
        raise ValueError("Voxel input needs a reference grid.")
    if not np.allclose(coord, np.rint(coord)):
        raise ValueError("Voxel indices must be integers.")
    return {
        "mm": grid.voxel_to_mm(coord, base).round(2).tolist(),
        "input": "voxel",
        "grid": grid.id,
        "voxel": coord.astype(int).tolist(),
        "base": base,
        "voxel_in_bounds": grid.in_bounds(coord, base),
    }


def query(atlases: dict[str, Atlas], mm, radius_mm=4.0, top_k=5, only=None) -> list[dict]:
    ids = only or list(atlases)
    return [atlases[i].lookup(mm, radius_mm=radius_mm, top_k=top_k) for i in ids if i in atlases]


MIN_HEADLINE_P = 0.10


def best_guess(result: dict) -> str | None:
    """One-line answer: the voxel's label (with its probability if known), else a
    probabilistic hit of at least MIN_HEADLINE_P, else the nearest label."""
    probs = {p["value"]: p for p in result.get("probabilities") or []}
    label = result.get("label")
    if label:
        p = probs.get(label["value"])
        return f"{label['name']} ({p['p']:.0%})" if p else label["name"]
    top = next(iter(result.get("probabilities") or []), None)
    if top and top["p"] >= MIN_HEADLINE_P:
        return f"{top['name']} ({top['p']:.0%})"
    if result.get("nearest"):
        n = result["nearest"]
        return f"near {n['name']} ({n['distance_mm']} mm)"
    return None
