"""Built-in atlas importers (downloaded via nilearn on first run).

Paper atlases don't need code here: add them from files with
`python -m atlaslookup add ...` (see README). Schaefer is imported that way
below, from its raw NIfTI + LUT, to keep that path exercised.
"""
from __future__ import annotations

import numpy as np

from .atlas import add_atlas
from .config import TEMPLATE_FILE
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


def bootstrap(overwrite=False):
    print("Harvard-Oxford ...")
    ho_map = import_harvard_oxford(overwrite)
    print("Juelich ...")
    import_juelich(overwrite)
    print("Schaefer 2018 ...")
    import_schaefer(overwrite=overwrite)
    print("Destrieux 2009 ...")
    import_destrieux(overwrite)
    print("Talairach Daemon ...")
    import_talairach(overwrite)
    print("MNI template for the viewer ...")
    export_template()
    save_grid(grid_from_image(ho_map, "mni-2mm-fsl", "MNI152 2 mm (FSL, 91x109x91)", FSL_SPACE))
    print("Done.")
