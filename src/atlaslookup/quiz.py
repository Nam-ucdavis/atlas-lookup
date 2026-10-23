"""Quiz support: which regions can be asked about, a good point inside each,
and a mask of a region for highlighting in the viewer.

Everything is sampled from each atlas's MNI-space label map (for Talairach
atlases, the resampled copy), and every returned point is checked against the
same lookup the rest of the app uses, so the quiz never disagrees with it.
"""
from __future__ import annotations

import gzip
import re
from functools import lru_cache

import nibabel as nib
import numpy as np
from scipy import ndimage

from .atlas import Atlas

# Atlases offered in the quiz, and labels that make poor questions.
QUIZ_ATLASES = {
    "harvard-oxford-cort": {"exclude": []},
    "harvard-oxford-sub": {"exclude": [r"white matter", r"cerebral cortex", r"ventric"]},
    "juelich": {"exclude": [r"^WM "]},
    "talairach-ba": {"include": [r"^Brodmann area"]},
}
MIN_MM3 = 150  # skip regions smaller than this (per hemisphere)

# Broad divisions for the progress summary, in display order. Names are matched
# against these patterns top to bottom (so "Temporal Occipital Fusiform" is
# temporal, "Paracingulate" limbic); Brodmann areas use the table below.
DIVISIONS = [
    ("Frontal lobe", r"frontal|precentral|juxtapositional|broca|motor|central opercular"),
    ("Parietal lobe", r"parietal|postcentral|supramarginal|\bangular|precune|somatosensory"),
    ("Temporal lobe", r"temporal|heschl|planum|auditory"),
    ("Occipital lobe", r"occipital|calcarine|cuneal|lingual|visual"),
    ("Insula", r"insula"),
    ("Limbic system", r"cingul|parahippocamp|subcallosal|hippocamp|amygdala|entorhinal"),
    ("Basal ganglia", r"caudate|putamen|pallidum|accumbens"),
    ("Thalamus & diencephalon", r"thalamus|geniculate|mam+illary"),
    ("Brainstem", r"brain-?stem"),
]
_MATCH_ORDER = ["Limbic system", "Basal ganglia", "Thalamus & diencephalon", "Brainstem", "Insula",
                "Temporal lobe", "Occipital lobe", "Parietal lobe", "Frontal lobe"]
BRODMANN_DIVISION = {
    **dict.fromkeys([4, 6, 8, 9, 10, 11, 43, 44, 45, 46, 47], "Frontal lobe"),
    **dict.fromkeys([1, 2, 3, 5, 7, 39, 40], "Parietal lobe"),
    **dict.fromkeys([20, 21, 22, 37, 38, 41, 42], "Temporal lobe"),
    **dict.fromkeys([17, 18, 19], "Occipital lobe"),
    13: "Insula",
    **dict.fromkeys(range(23, 37), "Limbic system"),
}


def division(name: str) -> str:
    ba = re.match(r"Brodmann area (\d+)", name)
    if ba:
        return BRODMANN_DIVISION.get(int(ba[1]), "Other")
    patterns = dict(DIVISIONS)
    for div in _MATCH_ORDER:
        if re.search(patterns[div], name, re.I):
            return div
    return "Other"


def display_name(name: str) -> str:
    """Tidy atlas names for the quiz: 'GM Amygdala_laterobasal group' ->
    'Amygdala, laterobasal group'."""
    name = re.sub(r"^GM ", "", name)
    return name.replace("_", ", ")


def _wanted(atlas_id: str, name: str) -> bool:
    rules = QUIZ_ATLASES[atlas_id]
    if any(re.search(p, name, re.I) for p in rules.get("exclude", [])):
        return False
    inc = rules.get("include")
    return not inc or any(re.search(p, name, re.I) for p in inc)


def _sides(atlas: Atlas) -> list[str]:
    return ["L", "R"] if atlas.manifest.lateralize else ["B"]


def _side_mask(shape, affine, side: str) -> np.ndarray | None:
    if side == "B":
        return None
    x = np.arange(shape[0]) * affine[0, 0] + affine[0, 3]  # axis-aligned grids
    keep = x < 0 if side == "L" else x > 0
    return keep[:, None, None]


def regions(atlas: Atlas) -> list[dict]:
    data, affine = atlas.mni_labels
    vox_mm3 = abs(np.linalg.det(affine[:3, :3]))
    counts = np.bincount(data.ravel())
    out = []
    for value, name in sorted(atlas.labels.items()):
        if value >= len(counts) or counts[value] == 0 or not _wanted(atlas.id, name):
            continue
        sides = []
        for side in _sides(atlas):
            m = _side_mask(data.shape, affine, side)
            n = counts[value] if m is None else int(((data == value) & m).sum())
            if n * vox_mm3 >= MIN_MM3:
                sides.append(side)
        if sides:
            out.append({"value": value, "name": display_name(name), "sides": sides,
                        "division": division(name)})
    return out


@lru_cache(maxsize=512)
def _interior(atlas: Atlas, value: int, side: str) -> np.ndarray:
    """Voxel indices well inside a region: eroded mask, and for probabilistic
    atlases, at least 50% probability. Falls back to the plain mask."""
    data, affine = atlas.mni_labels
    mask = data == value
    m = _side_mask(data.shape, affine, side)
    if m is not None:
        mask &= m
    candidates = [ndimage.binary_erosion(mask, iterations=1), mask]
    if atlas.manifest.has_prob_map and atlas.manifest.mm_transform is None:
        prob, _ = atlas._prob_img
        if value - 1 < prob.shape[3]:
            confident = prob[..., value - 1] >= 50
            candidates.insert(0, candidates[0] & confident)
    for c in candidates:
        idx = np.argwhere(c)
        if len(idx):
            return idx
    return np.empty((0, 3), int)


def point(atlas: Atlas, value: int, side: str, rng=None) -> dict | None:
    """A random point inside the region whose lookup really returns it."""
    rng = rng or np.random.default_rng()
    idx = _interior(atlas, value, side)
    if not len(idx):
        return None
    _, affine = atlas.mni_labels
    for ijk in idx[rng.permutation(len(idx))[:40]]:
        mm = (affine[:3, :3] @ ijk + affine[:3, 3]).round(1)
        r = atlas.lookup(mm, radius_mm=0)
        if (r.get("label") or {}).get("value") == value:
            return {"mm": mm.tolist(), "name": r["label"]["name"]}
    return None


@lru_cache(maxsize=64)
def mask_nifti(atlas: Atlas, value: int, side: str) -> bytes:
    data, affine = atlas.mni_labels
    mask = data == value
    m = _side_mask(data.shape, affine, side)
    if m is not None:
        mask &= m
    img = nib.Nifti1Image(mask.astype(np.uint8), affine)
    return gzip.compress(img.to_bytes(), compresslevel=3)
