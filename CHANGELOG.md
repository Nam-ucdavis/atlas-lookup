# Changelog

Each release is a git tag `vX.Y.Z`. The live version is shown next to the
title in the app (and at `/api/version`, or `atlaslookup --version`).

## 0.10.0 (2026-10-29)
- **Mesh brain**, a third 3D style: an opaque cortical surface with every overlay
  projected onto it (strongest value up to 4 mm beneath each point), using the
  overlay's own threshold and colours. Projection runs in the browser.
- **Regions window** (3D tab): search regions across all atlases and show the chosen
  ones as solid, smoothed shapes in their own colours; painted onto the mesh brain;
  optional "show results only inside these regions" (regions turn see-through).
- **Stat map browser**: the results folder opens as a Finder-style column view with a
  details pane, path bar and keyboard navigation.
- The app targets desktop browsers.

## 0.9.0 (2026-10-29)
- **3D view** in its own tab next to the slices: the brain as a solid surface or a
  see-through **glass brain** (fsaverage5 cortical mesh, adjustable transparency),
  showing the same atlas overlay, stat map and local NIfTI layers as the slices and
  following every threshold or colour change. L/R/A/P/S/I camera buttons, the slice
  crosshair shown in 3D, and **scr** saves the 3D view with colour bars. The app
  remembers the tab and style.
- `atlaslookup setup` also builds the glass-brain mesh; existing installs build it the
  first time the 3D view asks for it (no download needed).

## 0.8.0 (2026-10-29)
Merged from the [ccn-spark fork](https://github.com/ccn-spark/atlas-lookup):
- **Local overlays:** add any NIfTI stat map from your computer (Add NIfTI… or drop
  it on the brain) on top of the template. The file is read in the browser and
  never uploaded. Several maps can be stacked, and you choose which one is in front.
- Each overlay has its own threshold, set as T or as p (converted with the df from
  the SPM header or the NIfTI t-test intent, or a df you type in), a sign filter,
  positive/negative colormaps and opacity. Voxels below threshold are transparent,
  and every control updates the slices as you drag. p values are one-sided and
  uncorrected.
- `lookup` works as a short name for the `atlaslookup` command.
- **Viewer:** a *Crosshair* checkbox hides the red lines (the quiz always shows
  them). Each slice shows its coordinate in the bottom-left corner: z, y or x in
  mm, or k, j or i on the reference grid in voxel mode.
- **Colour bars** under the viewer for every stat overlay, from the threshold to
  the strongest value, labelled in T or p (as the layer is thresholded), with a
  separate bar for + and − when both are shown. Type into either end of a bar to
  set the threshold (min) or the top of the colour range (max); **auto** puts the
  max back to the data's strongest value.
- **scr** saves the three slices and their colour bars as one PNG (always
  2400 × 960 px, black background) in the `image` folder of your data folder,
  named by date and time, and shows it in Finder / Explorer.

- `install_prompt.md`: a prompt you can give Claude to install and launch the app.
- Claude asks before every `git push` (previously never allowed).
- Developer note for macOS with iCloud-synced folders (see the README's Development
  section).

## 0.7.0 (2026-10-23)
- **Working with Claude:** `CLAUDE.md` project notes, shared skills (`/add-atlas`,
  `/label-clusters`, `/release`), safe pre-approved commands in
  `.claude/settings.json`, and a guide in `docs/working-with-claude.md`.
- New CLI commands: `atlaslookup maps` lists your spmT maps;
  `atlaslookup clusters MAP` prints the labelled cluster/peak table (`--csv` too).

## 0.6.0 (2026-10-23)
- **Installable package** (`pip install`), with an `atlaslookup` command: on
  the first run it downloads the atlases, then it opens the app in the browser.
- Per-user data folder `~/.atlaslookup` (or `$ATLASLOOKUP_HOME`) for atlases,
  grids, the viewer template and settings; nothing is stored in the package.
- New `setup` (was `bootstrap`) and `info` commands; `serve --open`.
- MIT licence; licences for the bundled NiiVue viewer in THIRD_PARTY_NOTICES.md.

## 0.5.0 (2026-10-05)
- **Stat maps:** show your SPM T maps from a results folder outside the repo
  (`set-results DIR`). Thresholded
  ± overlay, T and p at the clicked point, and a cluster/peak table labelled
  with Harvard-Oxford, Juelich and Brodmann regions. Read-only; paths outside
  the folder are refused.

## 0.4.0 (2026-09-29)
- **Progress** button: learning summary by brain division (lobes, insula,
  limbic system, basal ganglia, thalamus & diencephalon, brainstem), with
  mastered / learning / needs-work / not-asked counts, per-region detail, and
  an atlas filter.
- **Practise** a single division: focuses the quiz on it ("show all" to clear).

## 0.3.0 (2026-09-29)
- **Quiz mode** (button top right): find regions on the brain or name the
  highlighted one, across Harvard-Oxford cortical/subcortical, Juelich and
  Brodmann (Talairach). Weighted towards regions you miss; per-browser history.
- Talairach atlases get an MNI-resampled copy, so they can be overlaid and
  highlighted (lookup still uses the exact transform; they agree voxel-for-voxel).
- Browsers no longer serve a stale cached UI after an update.

## 0.2.0 (2026-09-29)
- Coordinate lookup (MNI mm or voxel on a reference grid, SPM 1-based default).
- Atlases: Harvard-Oxford cortical/subcortical, Juelich, Schaefer 2018,
  Destrieux 2009 (gyri & sulci), Talairach Daemon Brodmann areas and gyri.
- Three-plane viewer (NiiVue): click to look up, atlas overlays.
- Summary strip; version badge; `start.sh` launcher.
