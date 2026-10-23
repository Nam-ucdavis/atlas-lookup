# Atlas Lookup

Which brain region is this coordinate in? Type an MNI coordinate (or a voxel
index from your SPM images), or click on the brain, and see the answer from
several atlases at once. You can also load your own SPM T maps and get a
labelled cluster table. A quiz mode helps you learn the regions.

- **Lookup:** Harvard-Oxford (cortical and subcortical), Juelich
  cytoarchitecture, Brodmann areas, gyri **and sulci** (Destrieux) and
  resting-state networks (Schaefer 2018), side by side. You also get
  probabilities and a "what's within N mm" readout for borderline points.
- **Viewer:** axial, coronal and sagittal slices of the MNI template. Click to
  look up a point, and overlay any atlas.
- **Your stat maps:** point it at a folder of `spmT_*.nii` files to get a
  thresholded overlay, T and p at any point, and a cluster/peak table labelled
  by region. The maps are only read, never copied anywhere.
- **Quiz:** find regions on the brain or name the highlighted one. Regions you
  miss come back more often, and progress is broken down by brain division.
- **Your own atlases:** add any parcellation from a paper with one command.

## Install

You need Python 3.10 or newer. [pipx](https://pipx.pypa.io) is the easiest
way to install a command-line app:

```bash
pipx install git+https://github.com/Nam-ucdavis/atlas-lookup
```

Or with pip, ideally in a virtual environment:

```bash
pip install git+https://github.com/Nam-ucdavis/atlas-lookup
```

## Start

```bash
atlaslookup
```

The app opens in your browser at http://127.0.0.1:8765. The first run
downloads the atlases (about 40 MB, one time). If the app is already running,
the command just opens the browser. Stop it with Ctrl+C.

Your data lives in `~/.atlaslookup`; set `ATLASLOOKUP_HOME` to use another
folder. It holds the atlases, voxel grids, the viewer template and your
settings. Nothing is stored inside the installed package. Run `atlaslookup info`
to see what's there.

## Looking up coordinates

- **MNI mm:** type x, y, z, or click a slice.
- **Voxel indices:** register the grid your images use once, then choose it
  under *Reference grid*. Indices are **1-based** by default, as in SPM/MATLAB;
  switch to 0-based for FSL/nibabel.

  ```bash
  atlaslookup add-grid my-3mm /path/to/any/image/on/that/grid.nii --name "My 3 mm grid" --space MNI152NLin2009cAsym
  ```

- **From the terminal:**

  ```bash
  atlaslookup query -44 18 24
  atlaslookup query 12 45 35 --voxel --grid my-3mm
  ```

Each atlas card shows the label at that voxel, the probabilities (for
probabilistic atlases), the share of each region within the chosen radius, and
the nearest label if the point lands in a gap. The URL updates with each
lookup, so a link reproduces the query.

## Your SPM T maps

```bash
atlaslookup set-results /path/to/your/results
```

The folder is searched recursively for `spmT_*.nii` files. Its path is stored
in `~/.atlaslookup/settings.json`, outside any repository, so it's safe to keep
results out of version control. For one run you can use
`atlaslookup serve --results DIR` instead.

In the app, choose a map under **Stat map**:

- **Overlay:** thresholded at **T ≥** your value; positive orange, negative
  blue, or one sign only. The equivalent p is shown, using the df from the SPM
  header.
- **Readout:** T and p at whatever point you click.
- **Clusters:** clusters use 18-connectivity, as in SPM, with a minimum size
  **k**. The table lists each peak with Harvard-Oxford, Juelich and Brodmann
  labels; click a row to jump to it.

p values are **uncorrected, one-sided**. Use SPM for FWE/FDR inference; this
is for finding your way around the map. The server only listens on 127.0.0.1,
so your maps aren't reachable from other machines.

## Quiz and progress

Click **Quiz mode** to practise Harvard-Oxford, Juelich and Brodmann regions.

- **Find it:** click to move the crosshair, then press Submit (↵).
- **Name it:** type the highlighted region. Suggestions appear as you type,
  typos are tolerated, and IFG/STG-style abbreviations work.

**Progress** shows what you've mastered per brain division, and **Practise**
focuses the quiz on one division. Quiz history is kept in your browser.

## Adding an atlas from a paper

```bash
atlaslookup add --id glasser2016 --name "HCP-MMP1 (Glasser 2016)" \
    --map MMP_in_MNI.nii.gz --labels MMP_labels.txt \
    --space MNI152NLin2009cAsym --kind functional \
    --citation "Glasser et al. (2016) Nature 536:171-178" --doi 10.1038/nature18933
```

Then restart the app.

- **Maps:** `--map` takes a 3D integer parcellation. `--prob` takes 4D
  probability maps, where volume *v* is label *v*+1 and values are 0-1 or
  0-100.
- **Label files:** `.tsv`/`.csv` (with `index` and `name` columns), `.txt`
  look-up tables (`1<TAB>name<TAB>R G B A`, FreeSurfer/Schaefer style) or one
  name per line, and FSL atlas `.xml`.
- **Other options:** `--lateralize` for bilateral labels; `--role "..."` puts
  the atlas in the summary strip.

## Template spaces

Harvard-Oxford, Juelich and Schaefer are in FSL's MNI152 (MNI152NLin6Asym).
fMRIPrep's default output space is MNI152NLin2009cAsym. The two differ by a
few mm near the cortical surface. The app looks everything up in mm, flags the
mismatch when your grid is in another space, and shows the neighbourhood
readout so you can judge borderline points.

The Talairach Daemon (Brodmann areas) lives in Talairach space. Queries are
converted with Lancaster's `icbm_spm2tal` transform (Lancaster et al. 2007),
and each card shows the converted coordinate.

## Citing

Please cite the atlases you report: each card in the app shows its citation
and DOI. The atlases are downloaded on your machine and keep their own
licences (see `THIRD_PARTY_NOTICES.md`); Harvard-Oxford and Juelich come with
FSL and are for non-commercial use.

## Development

```bash
git clone https://github.com/Nam-ucdavis/atlas-lookup && cd atlas-lookup
python -m venv .venv && .venv/bin/pip install -e ".[test]"
.venv/bin/atlaslookup setup
.venv/bin/pytest
```

Tests that need downloaded atlases skip themselves until `setup` has run; the
answer-matching test needs `node`. `CHANGELOG.md` lists each version, and
releases are tagged `vX.Y.Z`.

## License

MIT (see `LICENSE`). The bundled NiiVue viewer is BSD-2-Clause; see
`THIRD_PARTY_NOTICES.md`.
