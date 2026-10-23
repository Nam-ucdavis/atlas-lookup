# Changelog

Each release is a git tag `vX.Y.Z`. The live version is shown next to the
title in the app (and at `/api/version`, or `atlaslookup --version`).

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
