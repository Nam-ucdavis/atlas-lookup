"""Built-in atlas importers (downloaded via nilearn, or from FSL's package server, on
first run).

Paper atlases don't need code here: add them from files with
`python -m atlaslookup add ...` (see README). Schaefer is imported that way
below, from its raw NIfTI + LUT, to keep that path exercised.
"""
from __future__ import annotations

import hashlib
import tarfile
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import numpy as np

from .atlas import add_atlas
from .config import ATLASES_DIR, DOWNLOADS_DIR, GRIDS_DIR, MESH_FILE, TEMPLATE_FILE
from .destrieux_names import readable
from .grids import grid_from_image, save_grid

FSL_SPACE = "MNI152NLin6Asym"  # FSL's MNI152 template

# Lancaster et al. (2007) Hum Brain Mapp 28:1194-1205, "icbm_spm2tal":
# MNI (ICBM-152, SPM-normalised) mm -> Talairach mm. The Talairach Daemon
# volume is in Talairach space, so queries are mapped through this first.
ICBM_SPM2TAL = [
    [0.9254, 0.0024, -0.0118, -1.0207],
    [-0.0048, 0.9316, -0.0871, -1.7667],
    [0.0152, 0.0883, 0.8924, 4.0926],
    [0.0, 0.0, 0.0, 1.0],
]

HO_CITATION = (
    "Desikan et al. (2006) NeuroImage 31:968-980; Makris et al. (2006) "
    "Schizophr Res 83:155-171; Frazier et al. (2005) Am J Psychiatry "
    "162:1256-1265; Goldstein et al. (2007) Biol Psychiatry 61:935-945. "
    "Distributed with FSL."
)


def _nilearn_labels(labels) -> dict[int, str]:
    # nilearn gives a list with "Background" at index 0.
    return {i: str(n) for i, n in enumerate(labels) if i > 0}


def import_harvard_oxford(overwrite=False):
    from nilearn import datasets

    for part, name, lateralize, order, role in [
        ("cort", "Harvard-Oxford Cortical", True, 10, "Cortical region"),
        ("sub", "Harvard-Oxford Subcortical", False, 11, "Subcortical"),
    ]:
        mp = datasets.fetch_atlas_harvard_oxford(f"{part}-maxprob-thr25-2mm")
        pr = datasets.fetch_atlas_harvard_oxford(f"{part}-prob-2mm")
        add_atlas(
            id=f"harvard-oxford-{part}",
            name=name,
            space=FSL_SPACE,
            labels=_nilearn_labels(mp.labels),
            label_map=mp.maps,
            prob_map=pr.maps,
            kind="anatomical",
            lateralize=lateralize,
            citation=HO_CITATION,
            doi="10.1016/j.neuroimage.2006.01.021",
            url="https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Atlases",
            description="Label = max-probability region (thr 25%); probabilities from the 2 mm probabilistic maps.",
            order=order,
            role=role,
            overwrite=overwrite,
        )
    return mp.maps


def import_juelich(overwrite=False):
    from nilearn import datasets

    mp = datasets.fetch_atlas_juelich("maxprob-thr25-2mm")
    pr = datasets.fetch_atlas_juelich("prob-2mm")
    add_atlas(
        id="juelich",
        name="Juelich Histological",
        space=FSL_SPACE,
        labels=_nilearn_labels(mp.labels),
        label_map=mp.maps,
        prob_map=pr.maps,
        kind="anatomical",
        lateralize=True,
        citation="Eickhoff et al. (2005) NeuroImage 25:1325-1335; Amunts, Zilles et al. cytoarchitectonic maps. Distributed with FSL.",
        doi="10.1016/j.neuroimage.2004.12.034",
        url="https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Atlases",
        description="Cytoarchitectonic probability maps; label = max-probability region (thr 25%).",
        order=20,
        role="Cytoarchitecture",
        overwrite=overwrite,
    )


def import_schaefer(n_rois=400, networks=7, overwrite=False):
    from nilearn import datasets

    d = datasets.fetch_atlas_schaefer_2018(n_rois=n_rois, yeo_networks=networks, resolution_mm=2)
    lut = d.maps.replace(f"_FSLMNI152_2mm.nii.gz", ".txt")
    add_atlas(
        id=f"schaefer2018-{n_rois}-{networks}net",
        name=f"Schaefer 2018 ({n_rois} parcels, {networks} networks)",
        space=FSL_SPACE,
        labels=lut,
        label_map=d.maps,
        kind="functional",
        citation="Schaefer et al. (2018) Cereb Cortex 28:3095-3114.",
        doi="10.1093/cercor/bhx179",
        url="https://github.com/ThomasYeoLab/CBIG/tree/master/stable_projects/brain_parcellation/Schaefer2018_LocalGlobal",
        description="Resting-state parcellation; names read <networks>_<hemisphere>_<network>_<parcel>.",
        order=50,
        role="Network",
        overwrite=overwrite,
    )


# Yeo et al. (2011) 7 networks, as Schaefer names them, with their usual names.
YEO7 = {
    "Vis": "Visual network", "SomMot": "Somatomotor network", "DorsAttn": "Dorsal attention network",
    "SalVentAttn": "Salience / ventral attention network", "Limbic": "Limbic network",
    "Cont": "Frontoparietal control network", "Default": "Default mode network",
}


YEO7_CITATION = (
    "Networks as defined by Yeo et al. (2011) J Neurophysiol 106:1125-1165 (doi:10.1152/jn.00338.2011), "
    "parcels from Schaefer et al. (2018) Cereb Cortex 28:3095-3114 (doi:10.1093/cercor/bhx179). "
    "Default mode network: Raichle et al. (2001) PNAS 98:676-682 (doi:10.1073/pnas.98.2.676); "
    "Buckner, Andrews-Hanna & Schacter (2008) Ann N Y Acad Sci 1124:1-38 (doi:10.1196/annals.1440.011). "
    "Frontoparietal control network: Vincent et al. (2008) J Neurophysiol 100:3328-3342 "
    "(doi:10.1152/jn.90355.2008); Dosenbach et al. (2007) PNAS 104:11073-11078 (doi:10.1073/pnas.0704320104)."
)


def import_schaefer_networks(source_id="schaefer2018-400-7net", overwrite=False, atlases_dir=None):
    """Whole networks from the installed Schaefer parcellation: every parcel is merged
    into its Yeo 7 network (parcel names read <networks>_<hemi>_<network>_...), so
    the default mode or frontoparietal network can be looked up and shown as one
    region per hemisphere. Needs no download."""
    import nibabel as nib

    from .labels import read_labels

    atlases_dir = atlases_dir or ATLASES_DIR
    src = atlases_dir / source_id
    parcels = read_labels(src / "labels.tsv")
    img = nib.load(str(src / "label_map.nii.gz"))
    data = np.asarray(img.dataobj).astype(np.int32)
    order = list(YEO7)
    to_net = np.zeros(max(parcels) + 1, np.int16)
    for value, name in parcels.items():
        net = name.split("_")[2] if name.count("_") >= 2 else ""
        if net in YEO7:
            to_net[value] = order.index(net) + 1
    add_atlas(
        id="yeo2011-7networks",
        name="Yeo 2011 7 networks (from Schaefer 2018)",
        space=FSL_SPACE,
        labels={i + 1: YEO7[k] for i, k in enumerate(order)},
        label_map=nib.Nifti1Image(to_net[np.clip(data, 0, len(to_net) - 1)], img.affine),
        kind="functional", lateralize=True, order=51, role="Network (whole)",
        citation=YEO7_CITATION,
        doi="10.1152/jn.00338.2011",
        url="https://github.com/ThomasYeoLab/CBIG/tree/master/stable_projects/brain_parcellation/Yeo2011_fcMRI_clustering",
        description="The 7 resting-state networks, made by merging the 400 Schaefer parcels into the network "
                    "each belongs to. Default mode = Schaefer 'Default'; frontoparietal control = 'Cont'.",
        atlases_dir=atlases_dir, overwrite=overwrite,
    )


# Ranganath & Ritchey (2012) Nat Rev Neurosci 13:713-726: the anterior temporal (AT)
# and posterior medial (PM) systems, with the hippocampus where they meet. The paper
# gives no atlas, so each component is the closest region of an installed atlas:
# (system, component, [(atlas id, file, values)]). Later rows win where they overlap.
AT_PM = [
    ("AT", "Perirhinal / entorhinal cortex (anterior parahippocampal gyrus)",
     [("harvard-oxford-cort", "label_map.nii.gz", [34])]),
    ("AT", "Temporal pole", [("harvard-oxford-cort", "label_map.nii.gz", [8])]),
    ("AT", "Anterior ventral temporal cortex", [("harvard-oxford-cort", "label_map.nii.gz", [14, 37])]),
    ("AT", "Lateral orbitofrontal cortex", [("harvard-oxford-cort", "label_map.nii.gz", [33])]),
    ("PM", "Parahippocampal cortex", [("harvard-oxford-cort", "label_map.nii.gz", [35])]),
    ("PM", "Posterior cingulate cortex", [("harvard-oxford-cort", "label_map.nii.gz", [30])]),
    ("PM", "Precuneus", [("harvard-oxford-cort", "label_map.nii.gz", [31])]),
    ("PM", "Angular gyrus", [("harvard-oxford-cort", "label_map.nii.gz", [21])]),
    ("PM", "Ventromedial prefrontal cortex", [("harvard-oxford-cort", "label_map.nii.gz", [25])]),
    ("PM", "Retrosplenial cortex (cingulate isthmus)", [("destrieux2009", "label_map.nii.gz", [10, 85])]),
    ("AT", "Amygdala", [("harvard-oxford-sub", "label_map.nii.gz", [10, 20])]),
    ("PM", "Anterior thalamus", [("talairach-ba", "overlay_map_mni.nii.gz", [52])]),
    ("PM", "Mammillary bodies", [("talairach-ba", "overlay_map_mni.nii.gz", [24])]),
    ("Both", "Hippocampus", [("harvard-oxford-sub", "label_map.nii.gz", [9, 19])]),
]
AT_PM_SYSTEMS = {"AT": "Anterior temporal (AT) system", "PM": "Posterior medial (PM) system",
                 "Both": "Hippocampus (meets both systems)"}
AT_PM_SOURCES = sorted({s for _, _, parts in AT_PM for s, _, _ in parts})
AT_PM_CITATION = (
    "Ranganath & Ritchey (2012) Two cortical systems for memory-guided behaviour. Nat Rev Neurosci "
    "13:713-726 (doi:10.1038/nrn3338). See also Ritchey, Libby & Ranganath (2015) Prog Brain Res "
    "219:45-64 (doi:10.1016/bs.pbr.2015.04.001). Regions drawn from Harvard-Oxford (Desikan et al. 2006), "
    "Destrieux et al. (2010) and the Talairach Daemon (Lancaster et al. 2000)."
)


def import_at_pm(overwrite=False, atlases_dir=None):
    """The AT and PM memory systems, as two atlases: whole systems (one region per
    hemisphere) and their components. Built from installed atlases on the 2 mm MNI
    grid (nearest voxel), so it needs no download. Presubiculum is left out: no
    installed atlas has it apart from the hippocampus."""
    import nibabel as nib

    atlases_dir = atlases_dir or ATLASES_DIR
    grid = nib.load(str(atlases_dir / "harvard-oxford-cort" / "label_map.nii.gz"))
    mm = np.argwhere(np.ones(grid.shape[:3], bool)) @ grid.affine[:3, :3].T + grid.affine[:3, 3]
    sampled = {}

    def labels_of(atlas_id, file):  # an installed atlas's labels at every grid voxel
        if (atlas_id, file) not in sampled:
            img = nib.load(str(atlases_dir / atlas_id / file))
            d = np.asarray(img.dataobj).astype(np.int32)
            ijk = np.rint(np.c_[mm, np.ones(len(mm))] @ np.linalg.inv(img.affine)[:3].T).astype(int)
            ok = np.all((ijk >= 0) & (ijk < d.shape[:3]), axis=1)
            out = np.zeros(len(mm), np.int32)
            out[ok] = d[tuple(ijk[ok].T)]
            sampled[atlas_id, file] = out.reshape(grid.shape[:3])
        return sampled[atlas_id, file]

    parts = np.zeros(grid.shape[:3], np.int16)
    for k, (_, _, srcs) in enumerate(AT_PM, 1):
        for atlas_id, file, values in srcs:
            parts[np.isin(labels_of(atlas_id, file), values)] = k
    systems = list(AT_PM_SYSTEMS)
    to_system = np.array([0] + [systems.index(s) + 1 for s, _, _ in AT_PM], np.int16)
    common = dict(space=FSL_SPACE, kind="functional", lateralize=True, citation=AT_PM_CITATION,
                  doi="10.1038/nrn3338", atlases_dir=atlases_dir, overwrite=overwrite)
    add_atlas(
        id="at-pm-systems", name="AT / PM memory systems (Ranganath & Ritchey 2012)",
        labels={i + 1: AT_PM_SYSTEMS[s] for i, s in enumerate(systems)},
        label_map=nib.Nifti1Image(to_system[parts], grid.affine),
        order=52, role="Memory system",
        description="Anterior temporal (perirhinal, temporal pole, anterior ventral temporal, lateral orbitofrontal, "
                    "amygdala) and posterior medial (parahippocampal, retrosplenial, posterior cingulate, precuneus, "
                    "angular, ventromedial prefrontal, anterior thalamus, mammillary bodies) systems, with the "
                    "hippocampus between them. Each part is the closest region of an installed anatomical atlas.",
        **common,
    )
    add_atlas(
        id="at-pm-regions", name="AT / PM system components (Ranganath & Ritchey 2012)",
        labels={k: f"{s} · {name}" if s != "Both" else name for k, (s, name, _) in enumerate(AT_PM, 1)},
        label_map=nib.Nifti1Image(parts, grid.affine),
        order=53, role="Memory system part",
        description="The parts of the AT and PM systems. Approximations: perirhinal/entorhinal = Harvard-Oxford "
                    "anterior parahippocampal gyrus; temporal pole = the whole Harvard-Oxford pole (the paper "
                    "stresses its ventral part); lateral orbitofrontal = Harvard-Oxford orbital cortex, which "
                    "also covers medial orbital cortex; retrosplenial = Destrieux cingulate isthmus; anterior thalamus "
                    "and mammillary bodies from the Talairach Daemon. Presubiculum is not included.",
        **common,
    )


def import_destrieux(overwrite=False):
    from nilearn import datasets

    import warnings

    with warnings.catch_warnings():
        # nilearn notes that the "Medial_wall" labels have no voxels; expected.
        warnings.simplefilter("ignore", UserWarning)
        d = datasets.fetch_atlas_destrieux_2009(lateralized=True)
    labels = {i: readable(str(n)) for i, n in enumerate(d.labels) if i > 0}
    add_atlas(
        id="destrieux2009",
        name="Destrieux 2009 (gyri & sulci)",
        space="MNI152NLin2009aAsym",
        labels=labels,
        label_map=d.maps,
        kind="anatomical",
        citation="Destrieux et al. (2010) NeuroImage 53:1-15; FreeSurfer aparc.a2009s, volumetric MNI version.",
        doi="10.1016/j.neuroimage.2010.06.010",
        url="https://surfer.nmr.mgh.harvard.edu/fswiki/DestrieuxAtlasChanges",
        description="Separates gyri from sulci (74 per hemisphere). Volumetric 2 mm projection of the surface atlas.",
        order=5,
        role="Gyrus / sulcus",
        overwrite=overwrite,
    )


def import_talairach(overwrite=False):
    from nilearn import datasets

    common = dict(
        space="Talairach",
        kind="anatomical",
        lateralize=True,
        mm_transform=ICBM_SPM2TAL,
        citation="Lancaster et al. (2000) Hum Brain Mapp 10:120-131; Talairach & Tournoux (1988). "
                 "MNI->Talairach via icbm_spm2tal, Lancaster et al. (2007) Hum Brain Mapp 28:1194-1205.",
        doi="10.1002/1097-0193(200007)10:3<120::AID-HBM30>3.0.CO;2-8",
        url="https://www.talairach.org",
        overwrite=overwrite,
    )
    for level, id, name, role, order, desc in [
        ("ba", "talairach-ba", "Talairach Daemon: Brodmann areas", "Brodmann area", 6,
         "Brodmann areas traced on the 1988 Talairach atlas (rule-based boundaries). "
         "Coordinates are converted from MNI first."),
        ("gyrus", "talairach-gyrus", "Talairach Daemon: gyri", "Gyrus (Talairach)", 7,
         "Gyrus / nucleus level of the Talairach Daemon. Coordinates are converted from MNI first."),
    ]:
        d = datasets.fetch_atlas_talairach(level)
        add_atlas(id=id, name=name, labels=_nilearn_labels(d.labels), label_map=d.maps,
                  role=role, order=order, description=desc, **common)


# --- white-matter tracts (FSL's atlas packages) --------------------------------------
# nilearn has no JHU or XTRACT fetcher, so these come from FSL's own conda channel,
# pinned to a version and checked against its published sha256.
FSL_CHANNEL = "https://fsl.fmrib.ox.ac.uk/fsldownloads/fslconda/public/noarch"
FSL_PACKAGES = {
    "atlases": ("fsl-data_atlases-2103.0-0.tar.bz2",
                "3ac89f5f67de84054e1e576c9ad5f7ef6f562cef7b2504a3fa992c079cf72f8c"),
    "xtract": ("fsl-data_atlases_xtract-2.0.2-0.conda",
               "b65f25c00527c0c631f962d5e21c267037f4dcdbf3d01b5cbe923b2e7774fef1"),
}
FSL_LICENCE = "FSL atlases: free for non-commercial use (FSL licence)."
# Default core threshold (% of subjects) for drawing a tract and finding its connections.
# JHU's 28-subject maps are thin (most tracts peak at 30-50%), so it gets a lower one.
TRACT_THRESHOLD = {"jhu-tracts": 10, "xtract-hcp": 25}


def _fsl_package(key: str) -> Path:
    name, sha = FSL_PACKAGES[key]
    path = DOWNLOADS_DIR / name
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != sha:
        DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
        print(f"  downloading {name} from FSL ...")
        req = urllib.request.Request(f"{FSL_CHANNEL}/{name}", headers={"User-Agent": "atlaslookup"})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        if hashlib.sha256(data).hexdigest() != sha:
            raise RuntimeError(f"{name}: checksum mismatch; not using it")
        path.write_bytes(data)
    return path


def _extract(package: Path, wanted: list[str], dest: Path) -> None:
    """Extract the members whose paths end with one of `wanted` (a .tar.bz2, or a
    .conda: a zip holding a zstd-compressed tar) into dest, flat."""
    def take(tar):
        for m in tar:
            if m.isfile() and any(m.name.endswith(w) for w in wanted):
                (dest / Path(m.name).name).write_bytes(tar.extractfile(m).read())

    if package.suffix == ".conda":
        import zstandard

        with zipfile.ZipFile(package) as z:
            inner = next(n for n in z.namelist() if n.startswith("pkg-") and n.endswith(".tar.zst"))
            with z.open(inner) as f, zstandard.ZstdDecompressor().stream_reader(f) as zs:
                with tarfile.open(fileobj=zs, mode="r|") as tar:
                    take(tar)
    else:
        with tarfile.open(package, "r:bz2") as tar:
            take(tar)


def _fsl_xml_names(path: Path, offset: int) -> dict[int, str]:
    """FSL atlas XML: probabilistic atlases number images from 1 (offset 1), label
    atlases use the index as the value (offset 0). Names keep FSL's L/R suffix."""
    return {int(el.get("index")) + offset: " ".join((el.text or "").split())
            for el in ET.parse(path).getroot().iter("label")}


def _to_2mm(img):
    """FSL MNI152 1 mm probability maps -> the FSL 2 mm grid (91x109x91), averaging
    each 2 mm voxel's 1 mm neighbourhood. Keeps a 60-tract atlas at ~50 MB in memory
    instead of ~400 MB."""
    import nibabel as nib
    from scipy import ndimage

    data = np.asarray(img.dataobj, dtype=np.float32)
    for axis in range(3):
        data = ndimage.convolve1d(data, [0.25, 0.5, 0.25], axis=axis, mode="constant")
    data = data[::2, ::2, ::2]
    affine = img.affine.copy()
    affine[:3, :3] *= 2  # same origin: 2 mm voxel I sits on 1 mm voxel 2I
    return nib.Nifti1Image(data, affine)


def import_white_matter(overwrite=False):
    import nibabel as nib

    jhu_cite = "Distributed with FSL. " + FSL_LICENCE
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        _extract(_fsl_package("atlases"), [
            "JHU-tracts.xml", "JHU-labels.xml", "JHU-ICBM-tracts-prob-2mm.nii.gz",
            "JHU-ICBM-tracts-maxprob-thr25-2mm.nii.gz", "JHU-ICBM-labels-1mm.nii.gz"], tmp)
        _extract(_fsl_package("xtract"), [
            "atlases/XTRACT.xml", "xtract-tract-atlases-prob-1mm.nii.gz"], tmp)
        add_atlas(
            id="jhu-tracts", name="JHU white-matter tractography", space=FSL_SPACE,
            labels=_fsl_xml_names(tmp / "JHU-tracts.xml", 1),
            label_map=tmp / "JHU-ICBM-tracts-maxprob-thr25-2mm.nii.gz",
            prob_map=tmp / "JHU-ICBM-tracts-prob-2mm.nii.gz",
            kind="white-matter", role="Tract (JHU)", order=30,
            extra={"tract": True, "threshold": TRACT_THRESHOLD["jhu-tracts"]},
            citation="Hua et al. (2008) NeuroImage 39:336-347; Wakana et al. (2007) NeuroImage 36:630-644. " + jhu_cite,
            doi="10.1016/j.neuroimage.2007.07.053",
            url="https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Atlases",
            description="20 tracts from probabilistic tractography of 28 adults; values are the % of "
                        "subjects with the tract there. Label = most likely tract (thr 25%).",
            overwrite=overwrite,
        )
        add_atlas(
            id="jhu-labels", name="JHU ICBM-DTI-81 white-matter labels", space=FSL_SPACE,
            labels=_fsl_xml_names(tmp / "JHU-labels.xml", 0),
            label_map=tmp / "JHU-ICBM-labels-1mm.nii.gz",
            kind="white-matter", role="White matter", order=31,
            citation="Mori et al. (2008) NeuroImage 40:570-582; Oishi et al. (2008) NeuroImage 43:447-457. " + jhu_cite,
            doi="10.1016/j.neuroimage.2007.12.035",
            url="https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Atlases",
            description="48 white-matter regions hand-segmented on an 81-subject DTI average (e.g. fornix, "
                        "internal capsule limbs, corpus callosum parts).",
            overwrite=overwrite,
        )
        prob = _to_2mm(nib.load(str(tmp / "xtract-tract-atlases-prob-1mm.nii.gz")))
        p = np.asarray(prob.dataobj)
        maxprob = np.where(p.max(3) >= 5, p.argmax(3) + 1, 0).astype(np.int16)  # as FSL's maxprob5
        add_atlas(
            id="xtract-hcp", name="XTRACT HCP tracts", space=FSL_SPACE,
            labels=_fsl_xml_names(tmp / "XTRACT.xml", 1),
            label_map=nib.Nifti1Image(maxprob, prob.affine), prob_map=prob,
            kind="white-matter", role="Tract (XTRACT)", order=32,
            extra={"tract": True, "threshold": TRACT_THRESHOLD["xtract-hcp"]},
            citation="Warrington et al. (2020) NeuroImage 217:116923; Assimopoulos et al. (2024) eLife "
                     "(cortico-subcortical tracts). HCP data, WU-Minn Consortium. " + jhu_cite,
            doi="10.1016/j.neuroimage.2020.116923",
            url="https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/XTRACT",
            description="60 tracts (incl. fornix, amygdalofugal, uncinate, arcuate) from 1021 HCP adults; "
                        "values are the % of subjects with the tract there. Resampled to 2 mm.",
            overwrite=overwrite,
        )


def export_template():
    """Save the MNI152 T1 (nilearn's ICBM 2009a, 1 mm) as uint8 for the viewer."""
    import nibabel as nib
    from nilearn import datasets

    t = datasets.load_mni152_template(resolution=1)
    data = np.asarray(t.dataobj, dtype=np.float32)
    data = np.clip(data / np.percentile(data[data > 0], 99.5) * 255, 0, 255).astype(np.uint8)
    TEMPLATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    img = nib.Nifti1Image(data, t.affine)
    img.header.set_xyzt_units("mm")
    img.to_filename(str(TEMPLATE_FILE))


def export_mesh():
    """Both hemispheres of the fsaverage5 pial surface as one GIfTI, for the 3D
    viewer's glass brain. It ships with nilearn, so no download is needed. fsaverage
    is MNI305-based and lines up with MNI152 to within a few mm, which is fine for
    a see-through outline. It covers the cortex only (no cerebellum or brainstem)."""
    import nibabel as nib
    from nilearn import datasets

    fs = datasets.fetch_surf_fsaverage("fsaverage5")
    coords, faces, offset = [], [], 0
    for hemi in ("pial_left", "pial_right"):
        g = nib.load(fs[hemi])
        v, f = g.agg_data("pointset"), g.agg_data("triangle")
        coords.append(v.astype(np.float32))
        faces.append((f + offset).astype(np.int32))
        offset += len(v)
    img = nib.gifti.GiftiImage(darrays=[
        nib.gifti.GiftiDataArray(np.vstack(coords), intent="NIFTI_INTENT_POINTSET", datatype="NIFTI_TYPE_FLOAT32"),
        nib.gifti.GiftiDataArray(np.vstack(faces), intent="NIFTI_INTENT_TRIANGLE", datatype="NIFTI_TYPE_INT32"),
    ])
    MESH_FILE.parent.mkdir(parents=True, exist_ok=True)
    nib.save(img, str(MESH_FILE))
    return MESH_FILE


def bootstrap(overwrite=False):
    """Download and register the built-in atlases. Atlases already installed are
    skipped (unless overwrite), so re-running adds only what a newer version brings."""
    def step(label, ids, fn):
        if not overwrite and all((ATLASES_DIR / i / "atlas.json").exists() for i in ids):
            print(f"{label}: already installed")
            return
        print(f"{label} ...")
        fn()

    step("Harvard-Oxford", ["harvard-oxford-cort", "harvard-oxford-sub"], lambda: import_harvard_oxford(overwrite))
    step("Juelich", ["juelich"], lambda: import_juelich(overwrite))
    step("Schaefer 2018", ["schaefer2018-400-7net"], lambda: import_schaefer(overwrite=overwrite))
    step("Yeo 7 networks (merged from Schaefer)", ["yeo2011-7networks"], lambda: import_schaefer_networks(overwrite=overwrite))
    step("Destrieux 2009", ["destrieux2009"], lambda: import_destrieux(overwrite))
    step("Talairach Daemon", ["talairach-ba", "talairach-gyrus"], lambda: import_talairach(overwrite))
    step("AT / PM memory systems (from the atlases above)", ["at-pm-systems", "at-pm-regions"],
         lambda: import_at_pm(overwrite))
    step("White-matter tracts (JHU, XTRACT; from FSL, ~50 MB)", ["jhu-tracts", "jhu-labels", "xtract-hcp"],
         lambda: import_white_matter(overwrite))
    if overwrite or not TEMPLATE_FILE.exists():
        print("MNI template for the viewer ...")
        export_template()
    if overwrite or not MESH_FILE.exists():
        print("Brain mesh for the 3D view ...")
        export_mesh()
    if overwrite or not (GRIDS_DIR / "mni-2mm-fsl.json").exists():
        from nilearn import datasets

        ho_map = datasets.fetch_atlas_harvard_oxford("cort-maxprob-thr25-2mm").maps  # cached by nilearn
        save_grid(grid_from_image(ho_map, "mni-2mm-fsl", "MNI152 2 mm (FSL, 91x109x91)", FSL_SPACE))
    print("Done.")
