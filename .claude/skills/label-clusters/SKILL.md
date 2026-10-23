---
name: label-clusters
description: Produce an atlas-labelled cluster/peak table for an SPM T map (Harvard-Oxford, Juelich, Brodmann), or label a list of MNI coordinates, and summarise where the effects are. Use when someone asks where their activations, clusters, peaks or coordinates are.
argument-hint: "[spmT map id or path, or coordinates] [threshold]"
---

Label: $ARGUMENTS

These are the user's research results. Read only what they point you to, and don't copy
maps or tables into the repository.

**For a T map**
1. If no map is named, run `.venv/bin/atlaslookup maps` and ask which one.
2. Run `.venv/bin/atlaslookup clusters <map> --threshold <T> --k <voxels>` (defaults:
   T = 3, k = 5, both signs). Use `--csv` if they want a file, and ask where to save it;
   suggest a place outside the repository.
3. Summarise: how many clusters, the strongest peaks, and the regions they fall in. Use
   all the atlases: Harvard-Oxford for gross anatomy, Juelich for cytoarchitecture, and
   Brodmann areas via Talairach (rule-based, so treat as approximate). Point out where
   the atlases disagree or a peak is only "near" a region.
4. State plainly that p values are **uncorrected and one-sided**. Recommend FWE/FDR in
   SPM for inference, and don't present an uncorrected peak as significant.

**For coordinates**
Run `.venv/bin/atlaslookup query X Y Z` for each. Use `--voxel --grid <id>` for voxel
indices, which are 1-based by default as in SPM. Then tabulate the results.

**Always mention** if the data's template space differs from the atlases' spaces
(e.g. fMRIPrep's MNI152NLin2009cAsym vs FSL's MNI152NLin6Asym): labels near region
borders can shift by a few mm.
