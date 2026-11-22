"""Read-only access to your statistical maps (any .nii / .nii.gz; SPM T maps get p values;
CIFTI .dscalar.nii files offer each of their maps, see cifti.py).

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

from . import cifti
from .config import SETTINGS_FILE

# Any NIfTI, renamed ones included (e.g. "Rank5_spmT_0001.nii"); hidden files are skipped.
MAP_PATTERN = re.compile(r"^[^.].*\.nii(\.gz)?$", re.IGNORECASE)


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


def list_folders(path: str | Path | None) -> dict:
    """A folder's subfolders, by name only, for choosing the results folder in the UI.
    Files are never listed; it only says how many maps the folder itself holds."""
    p = Path(path).expanduser().resolve(strict=True) if path else Path.home()
    if not p.is_dir():
        raise NotADirectoryError(p)
    dirs, maps = [], 0
    for c in p.iterdir():
        try:
            if c.name.startswith("."):
                continue
            if c.is_dir():
                dirs.append(c.name)
            elif MAP_PATTERN.match(c.name):
                maps += 1
        except OSError:  # unreadable entries are skipped, not fatal
            continue
    return {"path": str(p), "parent": str(p.parent) if p.parent != p else None,
            "home": str(Path.home()), "dirs": sorted(dirs, key=str.lower), "maps_here": maps}


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

def _df_from_name(name: str) -> float | None:
    """A df written into a CIFTI map name, e.g. "t (df 25)", "T_[25]" or "df=25"."""
    m = re.search(r"T_\[([\d.]+)\]|\bdf\s*[=:]?\s*([\d.]+)", name, re.IGNORECASE)
    return float(m[1] or m[2]) if m else None


def _df_and_contrast(img) -> tuple[float | None, str]:
    descrip = img.header["descrip"].tobytes().rstrip(b"\0").decode(errors="replace")
    m = re.search(r"SPM\{T_\[([\d.]+)\]\}", descrip)
    contrast = descrip.split(" - ", 1)[1].strip() if " - " in descrip else descrip
    return (float(m[1]) if m else None), contrast


@lru_cache(maxsize=32)
def _load(path: str, mtime: float, index: int = -1):
    """(data, affine, (df, contrast)) of a NIfTI map, or (index >= 0) of map `index` of a
    CIFTI file on its own voxel grid."""
    if index >= 0:
        data, affine = cifti.volume(path, mtime, index)
        name = cifti.read(path, mtime)["names"][index]
        return data, affine, (_df_from_name(name), name)
    img = nib.load(path)
    data = np.asarray(img.dataobj, dtype=np.float32)
    if data.ndim > 3:  # a trailing singleton dimension; list() leaves out real 4D files
        data = data.reshape(*data.shape[:3], -1)[..., 0]
    data = np.where(np.isfinite(data), data, 0)  # SPM writes NaN outside the mask
    return data, img.affine, _df_and_contrast(img)


@lru_cache(maxsize=8)
def _clusters(path: str, mtime: float, index: int, threshold: float, sign: str, min_voxels: int):
    """Clusters above |T| >= threshold (18-connectivity, as in SPM), sorted by peak
    strength, each tagged with its (sign, label) in the returned label volumes. For a
    CIFTI map this is its voxels only (the cortex has no voxels)."""
    data, affine, (df, _) = _load(path, mtime, index)
    vox_mm3 = abs(np.linalg.det(affine[:3, :3]))
    conn = ndimage.generate_binary_structure(3, 2)
    found, labs = [], {}
    for s in (["pos", "neg"] if sign == "both" else [sign]):
        mask = data >= threshold if s == "pos" else data <= -threshold
        lab, n = ndimage.label(mask, structure=conn)
        labs[s] = lab
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
                          "peak_mm": peak.round(1).tolist(), "_key": (s, c)})
    found.sort(key=lambda c: -abs(c["peak_t"]))
    return found, labs


class Results:
    def __init__(self, root: Path | None):
        self.root = root.resolve() if root else None

    @property
    def available(self) -> bool:
        return bool(self.root and self.root.is_dir())

    def resolve(self, rel: str) -> Path:
        """Turn a map id (path relative to the root) into a file path, refusing
        anything outside the results folder or that isn't a NIfTI file. A CIFTI map's id
        (`x.dscalar.nii/map3.nii`) gives that virtual path; see source()."""
        return self._checked(rel)

    def _checked(self, rel: str) -> Path:
        if not self.available:
            raise FileNotFoundError("No results folder configured")
        p = (self.root / rel).resolve()
        if not p.is_relative_to(self.root):
            raise FileNotFoundError(rel)
        sub = cifti.split_id(p)
        if sub:
            f, i = sub
            if not f.is_file() or not f.is_relative_to(self.root) or f.name.startswith("."):
                raise FileNotFoundError(rel)
            info = cifti.header_info(f)
            if not info or not 0 <= i < len(info["names"]):
                raise FileNotFoundError(rel)
            return p
        if not MAP_PATTERN.match(p.name) or cifti.CIFTI_PATTERN.search(p.name) or not p.is_file():
            raise FileNotFoundError(rel)
        return p

    def source(self, rel: str) -> tuple[Path, int | None]:
        """The file behind a map id, and the map index for a CIFTI map (else None)."""
        p = self._checked(rel)
        sub = cifti.split_id(p)
        return (sub[0], sub[1]) if sub else (p, None)

    def _key(self, rel: str) -> tuple[str, float, int]:
        f, i = self.source(rel)
        return str(f), f.stat().st_mtime, -1 if i is None else i

    def load(self, rel: str):
        return _load(*self._key(rel))

    def is_cifti(self, rel: str) -> bool:
        return self.source(rel)[1] is not None

    def surface_values(self, rel: str) -> tuple[np.ndarray, int] | None:
        """A CIFTI map's values per fsLR vertex (left then right; NaN where none) and the
        left count, or None (not CIFTI, or no cortex in the file)."""
        f, i = self.source(rel)
        return None if i is None else cifti.surface(str(f), f.stat().st_mtime, i)

    def volume_image(self, rel: str) -> bytes:
        """The map as an uncompressed NIfTI-1 file in memory (a CIFTI map's voxels on
        its own grid), for the viewer. Nothing is written to disk."""
        data, affine, (df, contrast) = self.load(rel)
        img = nib.Nifti1Image(data.astype(np.float32), affine)
        img.header.set_xyzt_units("mm")
        img.header["descrip"] = contrast[:79].encode("ascii", "replace")
        return img.to_bytes()

    def list(self) -> list[dict]:
        if not self.available:
            return []
        found = []
        for p in sorted(self._files()):
            if cifti.CIFTI_PATTERN.search(p.name):
                info = cifti.header_info(p)
                if info:
                    found.append((p, info))
                continue
            try:
                img = nib.load(str(p))  # header only
            except Exception:  # not a readable NIfTI after all
                continue
            if len(img.shape) < 3 or int(np.prod(img.shape[3:])) > 1:  # 2D, or several volumes
                continue
            found.append((p, img))
        rels = [p.relative_to(self.root) for p, _ in found]
        prefix = os.path.commonpath([str(r.parent) for r in rels]) if len(rels) > 1 else ""
        out = []
        for (p, img), rel in zip(found, rels):
            folder = str(rel.parent)
            short = folder[len(prefix):].lstrip(os.sep) if prefix else folder
            if isinstance(img, dict):  # CIFTI: one entry per map
                for k, name in enumerate(img["names"]):
                    out.append({
                        "id": f"{rel.as_posix()}/map{k + 1}.nii",
                        "label": f"{short or '.'} · {rel.name} · map {k + 1}".replace(os.sep, " / "),
                        "group": prefix.replace(os.sep, " / "),
                        "contrast": name or f"map {k + 1}", "df": _df_from_name(name or ""),
                        "shape": img["shape"] or [91, 109, 91], "voxel_size": img["voxel_size"] or [2.0, 2.0, 2.0],
                        "cifti": {"map": k + 1, "maps": len(img["names"]), "vertices": img["vertices"],
                                  "vertices_used": img["n_vertices_used"], "voxels": img["n_voxels"]},
                    })
                continue
            df, contrast = _df_and_contrast(img)
            out.append({
                "id": rel.as_posix(),
                "label": f"{short or '.'} · {rel.name}".replace(os.sep, " / "),
                "group": prefix.replace(os.sep, " / "),
                "contrast": contrast, "df": df,
                "shape": list(img.shape[:3]), "voxel_size": [float(z) for z in img.header.get_zooms()[:3]],
            })
        return out

    def _files(self):
        for d, dirs, files in os.walk(self.root):
            dirs[:] = [x for x in dirs if not x.startswith(".")]
            yield from (Path(d) / f for f in files if MAP_PATTERN.match(f))

    # --- values ---------------------------------------------------------------------
    def value(self, rel: str, mm) -> dict:
        data, affine, (df, contrast) = self.load(rel)
        ijk = np.rint(np.linalg.inv(affine) @ np.append(np.asarray(mm, float), 1))[:3].astype(int)
        inside = bool(np.all(ijk >= 0) and np.all(ijk < data.shape[:3]))
        t = float(data[tuple(ijk)]) if inside else None
        out = {"map": rel, "t": None if t is None else round(t, 3), "df": df,
               "p": p_one_sided(t, df), "voxel": (ijk + 1).tolist(), "in_bounds": inside}
        # CIFTI: a point off the map's voxels but near the cortex reads the nearest vertex.
        if not t:
            v = self.vertex_near(rel, mm)
            if v:
                out.update(t=v["t"], p=p_one_sided(v["t"], df), in_bounds=True, vertex=v)
        return out

    def _surface_points(self, rel: str):
        """(vertex mm, values) for a CIFTI map whose cortex matches the registered fsLR
        surfaces, else None."""
        s = self.surface_values(rel)
        if not s or not cifti.surface_matches(*s):
            return None
        pts, _ = cifti.fslr_midthickness()
        return pts, s[0]

    def vertex_near(self, rel: str, mm, within: float = cifti.SURFACE_NEAR_MM) -> dict | None:
        """The nearest fsLR midthickness vertex with a value, within `within` mm."""
        sp = self._surface_points(rel)
        if not sp:
            return None
        pts, vals = sp
        d = np.linalg.norm(pts - np.asarray(mm, float)[:3], axis=1)
        d[~np.isfinite(vals)] = np.inf
        k = int(np.argmin(d))
        if d[k] > within:
            return None
        return {"index": k, "t": round(float(vals[k]), 3), "distance": round(float(d[k]), 1),
                "mm": pts[k].round(1).tolist()}

    def peak_near(self, rel: str, mm, radius: float, within: str = "sphere", sign: str = "both") -> dict:
        """Searchlight: the strongest voxel within `radius` mm of mm, in a sphere or in
        the slice through mm ("axial", "coronal", "sagittal": a disc in that plane).
        sign "pos" finds the highest T, "neg" the lowest, "both" the largest |T|."""
        data, affine, (df, _) = self.load(rel)
        c = np.asarray(mm, float)[:3]
        inv = np.linalg.inv(affine)
        centre = inv[:3, :3] @ c + inv[:3, 3]
        # Voxel index box that holds the sphere, clipped to the volume.
        reach = radius * np.sqrt((inv[:3, :3] ** 2).sum(axis=1)) + 1
        lo = np.maximum(np.floor(centre - reach), 0).astype(int)
        hi = np.minimum(np.ceil(centre + reach), np.array(data.shape[:3]) - 1).astype(int)
        if np.any(lo > hi):
            return {"found": False}
        grid = np.stack(np.meshgrid(*[np.arange(a, b + 1) for a, b in zip(lo, hi)], indexing="ij"), -1).reshape(-1, 3)
        world = grid @ affine[:3, :3].T + affine[:3, 3]
        keep = np.linalg.norm(world - c, axis=1) <= radius + 1e-6
        if within != "sphere":
            axis = {"sagittal": 0, "coronal": 1, "axial": 2}[within]
            half = np.abs(affine[axis, :3]).max() / 2  # half a voxel along that world axis
            keep &= np.abs(world[:, axis] - c[axis]) <= half + 1e-6
        grid, world = grid[keep], world[keep]
        vals = data[tuple(grid.T)] if len(grid) else np.zeros(0, np.float32)
        kinds = np.zeros(len(vals), int)  # 0 voxel, 1 cortical vertex
        # CIFTI: the cortex's vertices (midthickness positions) are candidates too.
        sp = self._surface_points(rel)
        if sp:
            pts, sv = sp
            near = np.isfinite(sv) & (np.linalg.norm(pts - c, axis=1) <= radius + 1e-6)
            if within != "sphere":
                axis = {"sagittal": 0, "coronal": 1, "axial": 2}[within]
                near &= np.abs(pts[:, axis] - c[axis]) <= np.abs(affine[axis, :3]).max() / 2 + 1e-6
            idx = np.flatnonzero(near)
            world = np.vstack([world, pts[idx]]) if len(world) else pts[idx]
            vals = np.concatenate([vals, sv[idx]])
            kinds = np.concatenate([kinds, np.ones(len(idx), int)])
            grid = np.vstack([grid, np.column_stack([idx, idx, idx])]) if len(grid) else np.column_stack([idx, idx, idx])
        if not len(vals):
            return {"found": False}
        score = vals if sign == "pos" else -vals if sign == "neg" else np.abs(vals)
        k = int(np.argmax(score))
        if score[k] <= 0:
            return {"found": False, "searched": int(len(vals))}
        t = float(vals[k])
        out = {"found": True, "mm": world[k].round(1).tolist(), "t": round(t, 3), "p": p_one_sided(t, df),
               "distance": round(float(np.linalg.norm(world[k] - c)), 1), "searched": int(len(vals))}
        if kinds[k]:
            out["vertex"] = int(grid[k][0])
        else:
            out["voxel"] = (grid[k] + 1).tolist()
        return out

    def _found(self, rel, threshold, sign, min_voxels):
        return _clusters(*self._key(rel), float(threshold), sign, int(min_voxels))

    def clusters(self, rel: str, threshold: float, sign: str = "both", min_voxels: int = 5,
                 limit: int = 50) -> dict:
        """Clusters above |T| >= threshold (18-connectivity, as in SPM), with the
        peak of each, sorted by peak strength."""
        data, affine, (df, contrast) = self.load(rel)
        found, _ = self._found(rel, threshold, sign, min_voxels)
        found = [{k: v for k, v in c.items() if k != "_key"} for c in found]  # copies: callers add labels
        return {"map": rel, "contrast": contrast, "df": df, "threshold": threshold,
                "voxels_only": self.is_cifti(rel),
                "threshold_p": p_one_sided(threshold, df), "sign": sign, "min_voxels": min_voxels,
                "max_abs_t": round(self._max_abs(rel, data), 3), "clusters": found[:limit],
                "n_clusters": len(found)}

    def _max_abs(self, rel: str, data) -> float:
        """Largest |value|: the voxels, and a CIFTI map's cortex too (so the colour range
        covers both)."""
        m = float(np.abs(data).max()) if data.size else 0.0
        s = self.surface_values(rel)
        if s is not None and np.isfinite(s[0]).any():
            m = max(m, float(np.nanmax(np.abs(s[0]))))
        return m

    def cluster_at(self, rel: str, mm, threshold: float, sign: str = "both", min_voxels: int = 5) -> int | None:
        """Rank (0-based, in the order clusters() lists them) of the cluster containing
        the voxel at mm, or None outside every cluster."""
        data, affine, _ = self.load(rel)
        ijk = np.rint(np.linalg.inv(affine) @ np.append(np.asarray(mm, float), 1))[:3].astype(int)
        if not (np.all(ijk >= 0) and np.all(ijk < data.shape[:3])):
            return None
        found, labs = self._found(rel, threshold, sign, min_voxels)
        for s, lab in labs.items():
            c = int(lab[tuple(ijk)])
            if c:
                return next((i for i, f in enumerate(found) if f["_key"] == (s, c)), None)
        return None


def p_one_sided(t: float | None, df: float | None) -> float | None:
    """Uncorrected one-sided p in the direction of t."""
    if t is None or not df or t == 0:
        return None
    return float(stats.t.sf(abs(t), df))
