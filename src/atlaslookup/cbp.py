"""Oxford connectivity-based parcellations (Rushworth lab) as one Brodmann-area atlas.

`atlaslookup add-cbp ZIP [ZIP ...]` takes the FSL-format atlases as downloaded (a zip, or
its unzipped folder, holding NAME.xml and NAME/*_thr25_2mm.nii.gz) and merges them into
one atlas, "oxford-cbp": each voxel gets the area with the highest probability (each map
is already thresholded at 25%). Known sources:

  NeubertCingulateOrbitoFrontalParcellation  Neubert et al. 2015 PNAS (cingulate, orbital, medial frontal; both hemispheres)
  NeubertVentralFrontalParcellation          Neubert et al. 2014 Neuron (ventral frontal; both hemispheres)
  SalletDorsalFrontalParcellation            Sallet et al. 2013 J Neurosci (dorsal frontal; right hemisphere)
  MarsParietalParcellation                   Mars et al. 2011 J Neurosci (parietal; right hemisphere)
  MarsTPJParcellation                        Mars et al. 2012 Cereb Cortex (TPJ; right hemisphere)

Zips are read in memory (nothing is extracted); only the files the XML names are read.
The area names follow the papers (Brodmann / Petrides-Pandya areas such as 24, 32d, 11m,
9/46D, and named zones such as RCZa): these are tractography-based areas, not
cytoarchitecture.
"""
from __future__ import annotations

import gzip
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path, PurePosixPath

import nibabel as nib
import numpy as np

from .atlas import add_atlas

ATLAS_ID = "oxford-cbp"
SOURCES = {  # XML name -> (short, citation, doi), in merge order
    "NeubertCingulateOrbitoFrontalParcellation": (
        "Neubert", "Neubert, Mars, Sallet & Rushworth (2015) PNAS 112:E2695-E2704", "10.1073/pnas.1410767112"),
    "NeubertVentralFrontalParcellation": (
        "Neubert", "Neubert, Mars, Thomas, Sallet & Rushworth (2014) Neuron 81:700-713", "10.1016/j.neuron.2013.11.012"),
    "SalletDorsalFrontalParcellation": (
        "Sallet", "Sallet et al. (2013) J Neurosci 33:12255-12274", "10.1523/JNEUROSCI.5108-12.2013"),
    "MarsParietalParcellation": (
        "Mars", "Mars et al. (2011) J Neurosci 31:4087-4100", "10.1523/JNEUROSCI.5102-10.2011"),
    "MarsTPJParcellation": (
        "Mars", "Mars et al. (2012) Cereb Cortex 22:1894-1903", "10.1093/cercor/bhr268"),
}
# Abbreviations spelled out once in the area names.
SPELLED = {
    "CCZ": "CCZ (caudal cingulate zone)", "RCZa": "RCZa (rostral cingulate zone, anterior)",
    "RCZp": "RCZp (rostral cingulate zone, posterior)", "FPl": "FPl (frontal pole, lateral)",
    "FPm": "FPm (frontal pole, medial)", "M1": "M1 (primary motor cortex)", "SMA": "SMA",
    "Pre-SMA": "Pre-SMA", "PreSMA": "Pre-SMA", "Ant PMd": "Anterior PMd (dorsal premotor cortex)",
    "TPJa": "TPJa (TPJ, anterior)", "TPJp": "TPJp (TPJ, posterior)",
}


def area_name(raw: str, right: bool) -> str:
    """'Right 8m' -> 'Right Area 8m'; 'Cluster3 (Area 9)' -> 'Right Area 9'; 'SPLA' -> 'Right SPL A'."""
    text = raw.strip()
    side = "Right" if right else "Left"
    m = re.match(r"(Left|Right)\s+(.*)", text)
    if m:
        side, text = m.group(1), m.group(2)
    m = re.match(r"Cluster\s*\d+\s*\((.*)\)$", text)
    if m:
        text = m.group(1).strip()
    if re.match(r"(?i)area\s", text):
        text = "Area " + text[5:].strip()
    elif re.match(r"\d", text):
        text = "Area " + text
    elif re.fullmatch(r"(SPL|IPL)[A-E]", text):
        text = f"{text[:3]} {text[3]}"
    text = SPELLED.get(text, text)
    return f"{side} {text}"


def _reader(path: Path):
    """(xml names, read(name) -> bytes) for a zip, a folder or an XML file."""
    path = Path(path).expanduser()
    if path.is_file() and zipfile.is_zipfile(path):
        z = zipfile.ZipFile(path)
        names = {PurePosixPath(n).as_posix(): n for n in z.namelist()
                 if not n.startswith("__MACOSX/") and not PurePosixPath(n).name.startswith("._")}
        return names, lambda n: z.read(names[n])
    root = path.parent if path.is_file() else path
    names = {p.relative_to(root).as_posix(): p for p in root.rglob("*") if p.is_file()}
    return names, lambda n: names[n].read_bytes()


def read_source(path: Path) -> list[dict]:
    """Every known parcellation in a zip / folder: {key, labels, centres, prob (x,y,z,n), affine}."""
    names, read = _reader(path)
    out = []
    for n in sorted(names):
        key = PurePosixPath(n).stem
        if not n.endswith(".xml") or key not in SOURCES:
            continue
        tree = ET.fromstring(read(n))
        files = [e.text.strip().lstrip("/") for e in tree.iter("imagefile")]
        two = next((f for f in files if f.endswith("_2mm")), None)
        if not two:
            raise ValueError(f"{key}: no 2 mm image in its XML")
        base = (PurePosixPath(n).parent / two).as_posix()  # image paths are relative to the XML's folder
        member = next((m for m in (base + ".nii.gz", base + ".nii") if m in names), None)
        if not member:
            raise ValueError(f"{key}: {two}.nii.gz is missing")
        raw = read(member)
        img = nib.Nifti1Image.from_bytes(gzip.decompress(raw) if member.endswith(".gz") else raw)
        labels = [(int(e.get("index")), e.text or "", float(e.get("x"))) for e in tree.iter("label")]
        out.append({"key": key, "labels": labels, "prob": np.clip(np.rint(np.asarray(img.dataobj, dtype=np.float32)), 0, 100).astype(np.uint8),
                    "affine": img.affine})
    return out


def build(paths, atlases_dir=None, overwrite=True) -> dict:
    """Merge the known parcellations found in `paths` into the oxford-cbp atlas."""
    found = {}
    for p in paths:
        for s in read_source(Path(p)):
            found[s["key"]] = s
    if not found:
        raise ValueError("No known Oxford parcellation found (expected e.g. NeubertCingulateOrbitoFrontalParcellation.xml)")
    order = [k for k in SOURCES if k in found]
    affine, shape = found[order[0]]["affine"], found[order[0]]["prob"].shape[:3]
    vols, names, used = [], {}, set()
    for k in order:
        s = found[k]
        if s["prob"].shape[:3] != shape or not np.allclose(s["affine"], affine):
            raise ValueError(f"{k} is not on the same 2 mm grid as {order[0]}")
        short = SOURCES[k][0]
        for index, raw, x in sorted(s["labels"]):
            # The XML gives each area's centre in voxels; FSL's 2 mm grid runs right to left.
            right = (affine[0, 0] * x + affine[0, 3]) > 0
            name = area_name(raw, right)
            if name in used:  # the same area in two sources (SMA in Neubert and Sallet)
                name = f"{name} ({short})"
            used.add(name)
            vols.append(s["prob"][..., index])
            names[len(vols)] = name
    prob = np.stack(vols, axis=-1)
    best = prob.max(axis=-1)
    label = np.where(best >= 25, prob.argmax(axis=-1) + 1, 0).astype(np.int16)
    del best
    cites = list(dict.fromkeys(SOURCES[k][1] for k in order))
    kw = {} if atlases_dir is None else {"atlases_dir": atlases_dir}
    add_atlas(
        id=ATLAS_ID, name="Oxford connectivity-based areas (Neubert, Sallet, Mars)", space="MNI152NLin6Asym",
        labels=names, label_map=nib.Nifti1Image(label, affine), prob_map=nib.Nifti1Image(prob, affine),
        kind="anatomical", lateralize=False, role="Brodmann area", order=6,
        citation="; ".join(cites) + ". Rushworth lab connectivity-based parcellations (also distributed with FSL).",
        doi=SOURCES[order[0]][2], url="https://www.rushworthlab.co.uk",
        description="Areas from diffusion-tractography parcellations, named after Brodmann / Petrides-Pandya "
                    "areas: " + ", ".join(f"{SOURCES[k][0]} ({k.replace('Parcellation', '')})" for k in order)
                    + ". Sallet and Mars cover the right hemisphere only. Label = highest-probability area (each map thr 25%).",
        extra={"sources": order}, overwrite=overwrite, **kw,
    )
    _retitle_talairach(atlases_dir)
    return {"sources": order, "areas": len(names)}


def _retitle_talairach(atlases_dir=None) -> None:
    """These areas take over "Brodmann area"; the Talairach Daemon's (still used for the
    limbic nuclei in Focus) is relabelled so the two can be told apart."""
    import json

    from .config import ATLASES_DIR

    f = Path(atlases_dir or ATLASES_DIR) / "talairach-ba" / "atlas.json"
    if not f.exists():
        return
    m = json.loads(f.read_text())
    if m.get("role") != "Brodmann area (Talairach)":
        m["role"] = "Brodmann area (Talairach)"
        f.write_text(json.dumps(m, indent=2) + "\n")
