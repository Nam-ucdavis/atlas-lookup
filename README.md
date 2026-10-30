# Atlas Lookup

Which brain region is this coordinate in? Type an MNI coordinate (or a voxel
index from your SPM images), or click on the brain, and see the answer from
several atlases at once. You can also load your own SPM T maps and get a
labelled cluster table. A quiz mode helps you learn the regions.

- **Lookup:** Harvard-Oxford (cortical and subcortical), Juelich
  cytoarchitecture, Brodmann areas, gyri **and sulci** (Destrieux),
  resting-state networks (Schaefer 2018) and **white-matter tracts** (JHU,
  XTRACT), side by side. You also get
  probabilities and a "what's within N mm" readout for borderline points.
- **Viewer:** axial, coronal and sagittal slices of the MNI template. Click to
  look up a point, and overlay any atlas (Atlas overlay, in the left sidebar). Each slice shows its coordinate, the
  crosshair can be hidden, and **scr** saves the slices as a PNG.
- **3D:** a second tab renders the brain in 3D (solid surface, see-through
  **glass brain**, or **mesh brain** with your results painted on the cortex),
  showing the same overlays and results as the slices. A **Regions** window
  picks regions to show as solid shapes, optionally showing results only
  inside them, and lists the **white-matter tracts that connect them**, which
  you can draw in 3D.
- **Your stat maps:** point it at a folder of `spmT_*.nii` files to get a
  thresholded overlay, T and p at any point, and a cluster/peak table labelled
  by region. The maps are only read, never copied anywhere.
- **Local overlays:** drop any NIfTI stat map from your computer on the brain.
  Threshold each one by T or p, pick colormaps, and choose which map is in
  front; everything updates as you drag. Files are read in the browser and
  never uploaded.
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

**Windows:** install [Python](https://www.python.org/downloads/) (tick *Add
python.exe to PATH*) and [Git](https://git-scm.com/download/win), then in
PowerShell:

```powershell
py -m pip install --user pipx
py -m pipx ensurepath
```

Open a new PowerShell window and run the `pipx install` line above.

**Let Claude do it:** paste the prompt in [install_prompt.md](install_prompt.md) into
Claude Code. It asks where to install, sets everything up and shows you the app running.

## Start

```bash
atlaslookup
```

`lookup` is a shorter name for the same command (`lookup`, `lookup query -44 18 24`, ...).
Use `--port` to run on another port, e.g. `lookup serve --port 8770 --open`.

The app opens in your browser at http://127.0.0.1:8765. The first run
downloads the atlases (about 40 MB, one time). If the app is already running,
the command just opens the browser. Stop it with Ctrl+C.

Your data lives in `~/.atlaslookup`; set `ATLASLOOKUP_HOME` to use another
folder. It holds the atlases, voxel grids, the viewer template, your
settings and the images saved with **scr** (in `image/`). Nothing is stored inside the installed package. Run `atlaslookup info`
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

  For a stat map's clusters from the terminal: `atlaslookup maps`, then
  `atlaslookup clusters <map> --threshold 3 --k 5` (add `--csv` for a file).

In the viewer, each slice shows its coordinate in the bottom-left corner (z
for axial, y for coronal, x for sagittal; k, j, i in voxel mode). Untick
**Crosshair** to hide the red lines. Each stat overlay gets a colour bar under
the slices, from the threshold to its strongest value, in T or in p (one-sided,
uncorrected) as you thresholded it, with separate + and − bars. Type into the
boxes at either end to set the minimum (the threshold) or the maximum of the
colour range; **auto** resets the maximum to the strongest value in the map. **scr** saves
the three slices and the colour bars as one PNG, always 2400 × 960 px, in
`~/.atlaslookup/image/`, named by the date and time (e.g.
`2026-10-28_09-19-20.png`), and opens that folder in Finder (Explorer on
Windows) with the new image selected.

Each atlas card shows the label at that voxel, the probabilities (for
probabilistic atlases), the share of each region within the chosen radius, and
the nearest label if the point lands in a gap. The URL updates with each
lookup, so a link reproduces the query.

## 3D view

Switch the viewer from **Slices** to **3D**. It shows whatever is on the slices:
the atlas overlay, the stat map from your results folder, and any local NIfTI
layers. Changing a threshold, sign or colour on the slices updates the 3D view
straight away.

- **Surface:** the MNI template rendered as a solid brain, with overlays on its
  surface.
- **Glass brain:** a see-through cortical surface with the overlays drawn as
  solid blobs inside, so deep effects are visible. The surface is fsaverage5 (cortex only, no cerebellum or
  brainstem), which lines up with MNI152 to within a few mm.
- **Mesh brain:** the same cortical surface, opaque, with each overlay
  projected onto it: every point takes the strongest value up to 4 mm beneath
  it, using the overlay's own threshold and colours. Only the cortex is shown,
  so subcortical and cerebellar results don't appear in this style. The
  projection runs in your browser, so local overlays still aren't uploaded.
- **Regions…** opens the side panel's Regions tab to pick regions from any atlas. Search by name
  (common abbreviations like OFC, IFG, ACC work). Each chosen region is drawn
  as a solid shape in its own colour, and in Mesh brain painted onto the
  cortex. Tick **Show results only inside these regions** to hide everything
  else; the regions then turn see-through so you can see the results inside.
  Deep regions (hippocampus, amygdala) are clearest in Glass brain.
- **Connecting tracts** (under the chosen regions, same tab) lists the
  white-matter tracts whose core passes near your regions. With one region
  (say the hippocampus) you get the tracts touching it (cingulum, fornix, ...);
  with several you also see which pairs each tract links (e.g. uncinate:
  amygdala ↔ orbitofrontal cortex). Tick a tract to draw it in 3D. Choose the
  atlas (**XTRACT HCP**, 60 tracts, or **JHU**, 20), the core threshold (% of
  subjects with the tract there; XTRACT 25 %, JHU 10 % by default) and how
  close it must come (mm). With no regions chosen it lists every tract. Click
  the **Connecting tracts** header to fold it down to the bottom of the tab.
  This is atlas-based proximity, not tractography of your own data:
  population tracts often stop short of the cortex (hence the distance), and
  bundles that merely pass nearby are listed too. Two regions that touch each
  other (hippocampus and amygdala) will share most of their nearby tracts.
- **Brain transparency** (0-100 %) fades the brain in whichever style is
  showing, so overlays and regions inside show through: 0 % is solid, 100 %
  invisible. Each style remembers its own setting (Glass starts at 75 %).
- **Camera:** drag to rotate, scroll to zoom. **L R A P S I** jump to the
  left, right, front, back, top and bottom views.
- **Crosshair and capture:** the slice crosshair is shown in 3D too (the
  Crosshair checkbox applies to both). **scr** saves the 3D view with its
  colour bars, at the same size as slice captures.

To look up a point, click on the slices; clicks in 3D only rotate. The app
remembers which tab and style you used last. The quiz always uses the slices.

## Your SPM T maps

```bash
atlaslookup set-results /path/to/your/results
```

The folder is searched recursively for `spmT_*.nii` files. Its path is stored
in `~/.atlaslookup/settings.json`, outside any repository, so it's safe to keep
results out of version control. For one run you can use
`atlaslookup serve --results DIR` instead.

In the app, click **▦ Open spmT…** above the viewer. It opens the side panel's
Results tab, a Finder-style column browser of your results folder: click
through the folders, see a map's contrast, df and grid below, and double-click
(or press **Show**) to display it. Arrow keys and Enter work as in Finder.

Each map you show is added to the **Stat maps** list under the viewer, so you
can overlay several: tick or untick a map to show or hide it, set its own
opacity, or ✕ to close it. Click a map's name to make it active; the T-value
range controls (T ≥, sign, k ≥), the cluster table and the T at the crosshair
follow the active map. The small **t-table** next to Crosshair gives the
critical T, one- and two-tailed, for p = .05, .01, .005 and .001 at the df you type.

**Left sidebar.** The lookup form, atlas overlay, atlas list and history (or
the quiz setup) sit in a sidebar on the left that stays in view as you scroll.
The sidebar button next to the title hides it to give the viewer the full
width, and shows it again; the app remembers which.

**Side panel.** Results and Regions live in a panel docked on the right, like a
code editor's side bar: the page narrows to make room, so the viewer stays
visible and usable. Drag its left edge to resize it; **»** or Esc collapses it
to a slim rail on the right edge, and the rail's buttons bring it back. Its
state, tab and width are remembered. When little room is left beside it, the
page switches to one column with the viewer on top.

- **Overlay:** thresholded at **T ≥** your value; positive orange, negative
  blue, or one sign only. **Opacity** sets how see-through it is (remembered,
  and applied in the 3D view too). The equivalent p is shown, using the df from the SPM
  header.
- **Readout:** T and p at whatever point you click.
- **Clusters:** clusters use 18-connectivity, as in SPM, with a minimum size
  **k**. The table lists each peak with Harvard-Oxford, Juelich and Brodmann
  labels; click a row to jump to it.

### Local overlays

Click **⤓ Import new map…** (right of **Open spmT…**), or drop `.nii` / `.nii.gz`
files on the brain) to overlay any stat map from your computer, inside the
results folder or not. The file is read by your browser and never uploaded,
not even to the local server. It should be in MNI space.

- **Threshold** as **T ≥** or **p <**, with a live slider. p is converted to T
  with the df from the SPM header (`SPM{T_[df]}`) or the NIfTI t-test intent;
  if the file has neither, type the df in.
- **Sign** (both, positive, negative), a **colormap** for each sign, and
  **opacity**. Voxels below threshold are transparent.
- **Order:** the top of the list is drawn in front. Use ⤒ / ▲ / ▼ to change it,
  or untick a layer to hide it.
- Each layer shows its value (and p) at the crosshair.

p values are **uncorrected, one-sided**. Use SPM for FWE/FDR inference; this
is for finding your way around the map. The server only listens on 127.0.0.1,
so your maps aren't reachable from other machines.

## Quiz and progress

Click **🧠 Quiz me!** (top right) to practise Harvard-Oxford, Juelich and Brodmann regions;
**↩ Back to lookup** returns.

- **Find it:** click to move the crosshair, then press Submit (↵).
- **Name it:** type the highlighted region. Suggestions appear as you type,
  typos are tolerated, and IFG/STG-style abbreviations work.

In quiz mode, **Progress** (next to Back to lookup) shows what you've mastered per brain division, and **Practise**
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
licences (see `THIRD_PARTY_NOTICES.md`); Harvard-Oxford, Juelich, JHU and XTRACT
come with FSL and are for non-commercial use.

**Networks.** *Yeo 2011 7 networks* merges the 400 Schaefer parcels into the 7
resting-state networks they belong to, so a whole network can be looked up or
shown in 3D (search "default mode" or "dmn", "frontoparietal" or "fpn"). It is
made from your installed Schaefer atlas, with no extra download. If you report it, cite:

- Network parcellation: Yeo et al. (2011) *J Neurophysiol* 106:1125-1165,
  doi:10.1152/jn.00338.2011; Schaefer et al. (2018) *Cereb Cortex* 28:3095-3114,
  doi:10.1093/cercor/bhx179.
- Default mode network: Raichle et al. (2001) *PNAS* 98:676-682,
  doi:10.1073/pnas.98.2.676; Buckner, Andrews-Hanna & Schacter (2008) *Ann N Y
  Acad Sci* 1124:1-38, doi:10.1196/annals.1440.011.
- Frontoparietal control network: Vincent et al. (2008) *J Neurophysiol*
  100:3328-3342, doi:10.1152/jn.90355.2008; Dosenbach et al. (2007) *PNAS*
  104:11073-11078, doi:10.1073/pnas.0704320104.

**White-matter tracts** need `atlaslookup setup` once (installs from before
0.17 just run it again; atlases you already have are skipped). It downloads
FSL's atlas packages (~50 MB) from `fsl.fmrib.ox.ac.uk`, checks them against
FSL's published checksums, and registers JHU tracts, JHU ICBM-DTI-81 labels and
XTRACT HCP.

## Working with Claude

The repository is set up for [Claude Code](https://code.claude.com/docs). Start `claude`
in the project folder and ask in plain English, e.g. "label the clusters in my modelA map
at T ≥ 3.5", or use `/add-atlas`, `/label-clusters` and `/release`. See
[docs/working-with-claude.md](docs/working-with-claude.md) for setup, privacy notes, and
how to develop the app this way.

## Development

```bash
git clone https://github.com/Nam-ucdavis/atlas-lookup && cd atlas-lookup
python -m venv .venv && .venv/bin/pip install -e ".[test]"
.venv/bin/atlaslookup setup
.venv/bin/pytest
```

Tests that need downloaded atlases skip themselves until `setup` has run; the
answer-matching test needs `node`.

**macOS with iCloud "Desktop & Documents" sync:** if the repository is inside a
synced folder (e.g. `~/Documents`), iCloud marks `.venv` as hidden, and Python 3.12.8+
then ignores the editable install, giving `ModuleNotFoundError: atlaslookup`. Keep the
environment outside the synced folder and link it in:

```bash
python3 -m venv ~/.venvs/atlas-lookup && ln -s ~/.venvs/atlas-lookup .venv
.venv/bin/pip install -e ".[test]"
``` `CHANGELOG.md` lists each version, and
releases are tagged `vX.Y.Z`.

## Switching versions

Click the version badge next to the title for a menu of the tagged releases
(newest first, "latest" marked) and **Development**, your own checkout.
Choosing one restarts the app on that version, on the same address and in the
same terminal, and the page reloads. Your data and settings are shared by every
version.

Each release is checked out once into `~/.atlaslookup/versions/<tag>` as a git
worktree, so your own checkout (branch, files, uncommitted work) is never
touched. This needs a git clone and the app started with `atlaslookup` (or
`atlaslookup serve`). Releases older than 0.15.0 don't have the menu: to come
back from one, stop the app (Ctrl+C) and start it again. To remove the saved
copies: `rm -rf ~/.atlaslookup/versions && git worktree prune`.

## Branches

`main` is an exact copy of [ccn-spark/atlas-lookup](https://github.com/ccn-spark/atlas-lookup);
`dev` is this version, with its own changes on top, and is the default branch. New
work goes on `dev`. See
[BRANCHES.md](BRANCHES.md) for everyday commands, pulling in ccn-spark's updates, and
offering changes back.

## Contributors

Local NIfTI overlays, colour bars, the viewer tools, **scr** capture, the `lookup`
alias and `install_prompt.md` came from the
[ccn-spark fork](https://github.com/ccn-spark/atlas-lookup).

## License

MIT (see `LICENSE`). The bundled NiiVue viewer is BSD-2-Clause; see
`THIRD_PARTY_NOTICES.md`.
