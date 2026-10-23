---
name: add-atlas
description: Register a brain atlas or parcellation from a paper (NIfTI map + label file) with Atlas Lookup, checking its space, labels and alignment before and after import. Use when someone wants to add, import or include a new atlas, parcellation or set of ROIs.
argument-hint: "[path to the atlas files, or the paper / download page]"
---

Add the atlas described by: $ARGUMENTS

1. **Find the files.** You need a 3D integer parcellation (`--map`), 4D probability
   maps (`--prob`), or both, plus a label file. If only a paper or web page is given,
   find its official download, and ask before downloading anything.
2. **Inspect before importing** (with nibabel, from `.venv/bin/python`):
   - the shape, voxel size and affine, and whether the map is 3D integer or 4D
     probabilities (0-1 or 0-100);
   - the label file format (tsv/csv with `index,name`; a LUT `.txt`; one name per
     line; FSL `.xml`), and whether its values match the values present in the map;
   - the **template space** (MNI152NLin6Asym for FSL-style 91x109x91 2 mm maps;
     MNI152NLin2009cAsym for fMRIPrep / TemplateFlow; Talairach needs an
     `mm_transform`). Get it from the paper or README; if you can't tell, ask rather
     than guess;
   - whether labels are bilateral (needs `--lateralize`) or already say Left/Right.
3. **Choose metadata:** a short `--id` slug (e.g. `glasser2016`), `--name`, `--kind`
   (functional or anatomical), `--citation` and `--doi` from the paper, and a `--role`
   if it should appear in the summary strip.
4. **Import:**
   `.venv/bin/atlaslookup add --id ... --name ... --map ... --labels ... --space ... --citation ... --doi ...`
   Read any import warnings (e.g. unnamed values) and fix the cause rather than ignore it.
5. **Check alignment** with `.venv/bin/atlaslookup query X Y Z` at two or three
   landmarks the atlas should get right (for example V1 near (-8, -90, 4), left
   precentral gyrus near (-38, -22, 56), left amygdala near (-22, -4, -18)). Confirm the
   answers are plausible and left/right is correct.
6. **Report** what was added, the space, the landmark results, and any caveats such as a
   space mismatch with the user's data. Remind them to restart the app.

The atlas lives in the user's data folder (`~/.atlaslookup/atlases/<id>`), not in the
repository. Never commit atlas files.
