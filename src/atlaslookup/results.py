"""Read-only access to your statistical maps (spmT_*.nii).

The results folder is set per machine, in this order of precedence:
  1. `atlaslookup serve --results DIR`, or
  2. the ATLAS_RESULTS_DIR environment variable, or
  3. `atlaslookup set-results DIR`, saved in ~/.atlaslookup/settings.json
     (outside any repository).

Nothing here writes to the results folder or copies its contents anywhere:
maps are read on demand and only cached in memory.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from functools import lru_cache
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage, stats

from .config import SETTINGS_FILE

MAP_PATTERN = re.compile(r"^spmT_\d+\.nii(\.gz)?$")


# --- settings -------------------------------------------------------------------------

def _settings() -> dict:
    try:
        return json.loads(SETTINGS_FILE.read_text())
    except (OSError, ValueError):
        return {}


def configured_dir() -> Path | None:
    raw = os.environ.get("ATLAS_RESULTS_DIR") or _settings().get("results_dir")
    return Path(raw).expanduser() if raw else None


def save_results_dir(path: str | Path) -> Path:
    p = Path(path).expanduser().resolve()
    if not p.is_dir():
        raise NotADirectoryError(p)
    s = _settings()
    s["results_dir"] = str(p)
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(s, indent=2) + "\n")
    return p


def repo_warning(path: Path) -> str | None:
    """Warn if the results folder sits inside a git repo without being ignored,
    i.e. results could be committed by accident."""
    try:
        inside = subprocess.run(["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"],
                                capture_output=True, text=True, timeout=3).stdout.strip() == "true"
        if not inside:
            return None
        ignored = subprocess.run(["git", "-C", str(path), "check-ignore", "-q", "."],
                                 capture_output=True, timeout=3).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return None
    return None if ignored else f"{path} is inside a git repository and not git-ignored; results could be committed."


# --- maps -----------------------------------------------------------------------------

def _df_and_contrast(img) -> tuple[float | None, str]:
    descrip = img.header["descrip"].tobytes().rstrip(b"\0").decode(errors="replace")
    m = re.search(r"SPM\{T_\[([\d.]+)\]\}", descrip)
    contrast = descrip.split(" - ", 1)[1].strip() if " - " in descrip else descrip
    return (float(m[1]) if m else None), contrast


@lru_cache(maxsize=32)
def _load(path: str, mtime: float):
    img = nib.load(path)
    data = np.asarray(img.dataobj, dtype=np.float32)
    data = np.where(np.isfinite(data), data, 0)  # SPM writes NaN outside the mask
    return data, img.affine, _df_and_contrast(img)


class Results:
    def __init__(self, root: Path | None):
        self.root = root.resolve() if root else None

    @property
    def available(self) -> bool:
        return bool(self.root and self.root.is_dir())

    def resolve(self, rel: str) -> Path:
        """Turn a map id (path relative to the root) into a file path, refusing
        anything outside the results folder or that isn't an SPM T map."""
        if not self.available:
            raise FileNotFoundError("No results folder configured")
        p = (self.root / rel).resolve()
        if not p.is_relative_to(self.root) or not MAP_PATTERN.match(p.name) or not p.is_file():
            raise FileNotFoundError(rel)
        return p

    def load(self, rel: str):
        p = self.resolve(rel)
        return _load(str(p), p.stat().st_mtime)

    def list(self) -> list[dict]:
        if not self.available:
            return []
        files = sorted(p for p in self.root.rglob("spmT_*") if MAP_PATTERN.match(p.name))
        rels = [p.relative_to(self.root) for p in files]
        prefix = os.path.commonpath([str(r.parent) for r in rels]) if len(rels) > 1 else ""
        out = []
        for p, rel in zip(files, rels):
            img = nib.load(str(p))  # header only
            df, contrast = _df_and_contrast(img)
            folder = str(rel.parent)
            short = folder[len(prefix):].lstrip(os.sep) if prefix else folder
            out.append({
                "id": rel.as_posix(),
                "label": f"{short or '.'} · {rel.name}".replace(os.sep, " / "),
                "group": prefix.replace(os.sep, " / "),
                "contrast": contrast, "df": df,
                "shape": list(img.shape[:3]), "voxel_size": [float(z) for z in img.header.get_zooms()[:3]],
            })
        return out

    # --- values ---------------------------------------------------------------------
    def value(self, rel: str, mm) -> dict:
        data, affine, (df, contrast) = self.load(rel)
        ijk = np.rint(np.linalg.inv(affine) @ np.append(np.asarray(mm, float), 1))[:3].astype(int)
        inside = bool(np.all(ijk >= 0) and np.all(ijk < data.shape[:3]))
        t = float(data[tuple(ijk)]) if inside else None
        return {"map": rel, "t": None if t is None else round(t, 3), "df": df,
                "p": p_one_sided(t, df), "voxel": (ijk + 1).tolist(), "in_bounds": inside}

    def clusters(self, rel: str, threshold: float, sign: str = "both", min_voxels: int = 5,
                 limit: int = 50) -> dict:
        """Clusters above |T| >= threshold (18-connectivity, as in SPM), with the
        peak of each, sorted by peak strength."""
        data, affine, (df, contrast) = self.load(rel)
        vox_mm3 = abs(np.linalg.det(affine[:3, :3]))
        conn = ndimage.generate_binary_structure(3, 2)
        found = []
        for s in (["pos", "neg"] if sign == "both" else [sign]):
            mask = data >= threshold if s == "pos" else data <= -threshold
            lab, n = ndimage.label(mask, structure=conn)
            if not n:
                continue
            sizes = np.bincount(lab.ravel())
            for c in range(1, n + 1):
                if sizes[c] < min_voxels:
                    continue
                idx = np.argwhere(lab == c)
                vals = data[tuple(idx.T)]
                k = np.argmax(vals) if s == "pos" else np.argmin(vals)
                peak = affine[:3, :3] @ idx[k] + affine[:3, 3]
                t = float(vals[k])
                found.append({"sign": s, "voxels": int(sizes[c]), "mm3": round(float(sizes[c] * vox_mm3)),
                              "peak_t": round(t, 3), "peak_p": p_one_sided(t, df),
                              "peak_mm": peak.round(1).tolist()})
        found.sort(key=lambda c: -abs(c["peak_t"]))
        return {"map": rel, "contrast": contrast, "df": df, "threshold": threshold,
                "threshold_p": p_one_sided(threshold, df), "sign": sign, "min_voxels": min_voxels,
                "max_abs_t": round(float(np.abs(data).max()), 3), "clusters": found[:limit],
                "n_clusters": len(found)}


def p_one_sided(t: float | None, df: float | None) -> float | None:
    """Uncorrected one-sided p in the direction of t."""
    if t is None or not df or t == 0:
        return None
    return float(stats.t.sf(abs(t), df))
