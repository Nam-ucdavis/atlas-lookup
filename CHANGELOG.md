# Changelog

Each release is a git tag `vX.Y.Z`. The live version is shown next to the
title in the app (and at `/api/version`, or `atlaslookup --version`).

## 0.19.10 (2026-11-02)
- Focus blobs are shaded like the results painted on surfaces (same shader), so the
  two modes show results at the same brightness.

## 0.19.9 (2026-11-02)
- **One set of structures per focus**: the level buttons (Structures / Gyri & sulci,
  Visual areas) and the MTL structures / subfields switch are gone. Every focus shows
  its Harvard-Oxford structures; Focus: Temporal's MTL is the Juelich subfields (CA,
  dentate gyrus, subiculum, HATA, entorhinal cortex, amygdala groups) with the Destrieux
  parahippocampal gyrus and collateral sulcus.

## 0.19.8 (2026-11-02)
- **MTL detail of its own in Focus: Temporal**: an **MTL structures / MTL subfields**
  switch (shown only in Temporal) picks the MTL's level separately from the lateral
  cortex's. The second level button is **Gyri & sulci** again (lateral and ventral
  cortex only). Subfields: Juelich CA, dentate gyrus, subiculum, HATA, entorhinal
  cortex, the Destrieux parahippocampal gyrus and collateral sulcus, and three amygdala
  groups.

## 0.19.7 (2026-11-02)
- Removed the peak dots from Focus (the legend's peaks still look the point up); blobs
  are solid again.

## 0.19.6 (2026-11-02)
- **Results inside the focus structures**: Focus now draws the front map's
  suprathreshold voxels inside the shown structures as smoothed 3D blobs at their real
  depth, not only what reaches 3 mm under the surface. **Blobs / Surface** in the focus
  bar switches back to painting every map on the surfaces.
- **Peak dots**: each shown structure's positive and negative peak past the threshold
  is a white dot; click one to look the peak up. Blobs are slightly see-through so the
  dots inside show.

## 0.19.5 (2026-11-02)
- **Focus: Occipital** (Focus ▾): structures (Harvard-Oxford) in medial occipital
  (intra- and supracalcarine cortex, cuneus, lingual gyrus), lateral occipital (LOC
  superior, inferior), ventral occipital (occipital fusiform gyrus) and occipital pole
  groups; or **Visual areas** (Juelich): early visual cortex (V1, V2), ventral visual
  (V3v, V4) and motion (V5 / MT+).

## 0.19.4 (2026-11-02)
- **Focus: MTL is now part of Focus: Temporal**: the temporal focus gains three groups,
  hippocampus (hippocampal formation), parahippocampal region and amygdala, after the
  lateral and ventral temporal ones. Its fine level, **Gyri & subfields**, has the
  Juelich subfields plus the Destrieux parahippocampal gyrus and collateral sulcus
  (perirhinal cortex). Untick or fold the lateral groups to see the MTL alone.
- A saved Focus: MTL opens as Focus: Temporal, at the level it had.

## 0.19.3 (2026-11-02)
- **Focus: Parietal, Cingulate, Temporal** (Focus ▾), like Focus: PFC, each with a
  Harvard-Oxford and a Destrieux level, in groups:
  - Parietal: superior parietal, inferior parietal (supramarginal, angular), medial
    parietal (precuneus), somatosensory (postcentral gyrus, parietal operculum).
  - Cingulate: anterior (ACC, paracingulate, subcallosal), midcingulate (aMCC, pMCC;
    Destrieux only), posterior (PCC, retrosplenial / isthmus), and the pericallosal and
    marginal sulci.
  - Temporal, without the MTL: pole, superior (STG, planum polare, Heschl's gyrus,
    planum temporale, STS), middle, inferior and ventral (fusiform) temporal cortex.

## 0.19.2 (2026-11-01)
- **Focus: PFC** replaces Focus: mPFC: the whole prefrontal cortex in six groups
  (ventromedial, dorsomedial & ACC, orbitofrontal, dorsolateral, ventrolateral,
  frontopolar), at Harvard-Oxford or Destrieux detail. The superior and middle frontal
  gyri stop at y = +10 mm (premotor cortex left out); the superior frontal gyrus is
  split at |x| = 20 mm into medial (dmPFC) and lateral (dlPFC) parts.
- **Groups in every focus**: tick a group to show or hide all its structures, or single
  structures (the group box is half-ticked when only some show); fold a group with ▾.
  Group rows show the group's peaks and mm³ past the threshold. MTL groups:
  hippocampus, amygdala and parahippocampal region (subfields: hippocampal formation,
  entorhinal cortex, amygdala).
- Region cuts are now conditions: `atlas|value|side|ax<=20;y>=10` (`ax` = |x|; a bare
  number still means |x| ≤ that).

## 0.19.1 (2026-11-01)
- **Focus: mPFC** (Focus ▾ → mPFC): the medial and ventromedial prefrontal cortex, like
  Focus: MTL. Structures (Harvard-Oxford): frontal medial cortex (vmPFC), subcallosal
  cortex, anterior cingulate and paracingulate gyri, medial frontal pole and superior
  frontal gyrus (|x| ≤ 20 mm), and the frontal orbital cortex (lateral / central OFC).
  Gyri & sulci (Destrieux): gyrus rectus, medial orbital and suborbital sulci,
  subcallosal gyrus, anterior cingulate gyrus and sulcus, medial transverse frontopolar
  gyri and superior frontal gyrus, and the orbital gyri.
- The second level button is named for each focus (Subfields for the MTL, Gyri & sulci
  for the mPFC); each focus remembers its own level. Hemispheres, Hue / Gray and Fill
  are shared.
- Region endpoints accept `atlas|value|side|xmax` to keep only |x| ≤ xmax mm.

## 0.19.0 (2026-11-01)
- **Focus: MTL** in the 3D view: a **Focus ▾** button next to Inflated opens a menu;
  pick **MTL** to see the medial temporal lobe on its own (the button then reads
  "Focus: MTL").
  - Structures (hippocampus, amygdala, entorhinal cortex, anterior and posterior
    parahippocampal gyrus) or Juelich subfields (CA, dentate gyrus, subiculum,
    entorhinal, HATA, amygdala groups), each in its own hue, drawn as a faint tint
    with a solid outline; results on the slices are painted onto them.
  - Both / Left / Right hemispheres, a Fill slider, and **Hue / Gray**: Gray draws every
    structure in one grey so the effects stand out (applies to every focus).
  - Legend with each structure's peak positive / negative value and the mm³ past the
    threshold; click a peak or a structure to look it up.

## 0.18.0 (2026-10-31)
- **Inflated brain** in the 3D view, next to Surface, Glass brain and Mesh brain:
  fsaverage6 (~41k points per hemisphere), shaded by sulcal depth, with the hemispheres
  set apart. Results and cortical regions are sampled at the folded cortex and drawn on
  the inflated surface, so effects inside sulci show.
  - **Inflation** slider (0–100 %) morphs between the folded and the inflated cortex.
  - **Both / Left / Right** hemispheres (view one from the other side for its medial wall).
  - **Click to look up**: a click on the inflated brain looks up that point's position on
    the folded cortex; the slice crosshair is shown at the nearest surface point.
  - Tracts and region shapes are hidden in this style; chosen cortical regions are painted on.
  - `atlaslookup setup` downloads fsaverage6 once (from OSF through nilearn, ~8 MB).

## 0.17.3 (2026-10-29)
- **AT / PM memory systems** (Ranganath & Ritchey 2012): two new atlases, built from the
  installed ones (no download; `atlaslookup setup` adds them). *AT / PM memory systems*
  has the anterior temporal system, the posterior medial system and the hippocampus
  between them, one region per hemisphere; *AT / PM system components* has each part
  (perirhinal/entorhinal, temporal pole, lateral OFC, amygdala, parahippocampal,
  retrosplenial, posterior cingulate, precuneus, angular, vmPFC, anterior thalamus,
  mammillary bodies, ...). Lookups, Regions search ("pmat", "rsc", "prc", "phc"), 3D and
  Connecting tracts all work with them.
- References on the atlas cards and in the README: Ranganath & Ritchey 2012; Ritchey,
  Libby & Ranganath 2015. The cards also list which atlas region stands in for each part.
- **Chosen regions on the slices**: regions picked in the Regions tab are now painted on
  the 2D slices too, in their 3D colours and half see-through, over the atlas overlay and
  under the stat maps (the 3D view keeps drawing them as surfaces).

## 0.17.2 (2026-10-29)
- **Whole networks**: new atlas *Yeo 2011 7 networks*, made by merging the 400 Schaefer
  parcels into their network (no download; `atlaslookup setup` adds it). The default mode
  and frontoparietal control networks (and the other five) can now be looked up, searched
  in the Regions tab ("default mode", "dmn", "frontoparietal", "fpn"), shown in 3D and
  used with Connecting tracts, one region per hemisphere.
- References for the networks on the atlas card and in the README: Yeo et al. 2011 and
  Schaefer et al. 2018 (parcellation); Raichle et al. 2001 and Buckner et al. 2008
  (default mode); Vincent et al. 2008 and Dosenbach et al. 2007 (frontoparietal control).

## 0.17.1 (2026-10-29)
- **Connecting tracts folds away**: click its header to collapse it to one line docked at
  the bottom of the Regions tab (showing how many tracts are drawn in 3D); click again to
  unfold. The app remembers which.

## 0.17.0 (2026-10-29)
- **White-matter tracts**: three new atlases, downloaded by `atlaslookup setup` from FSL's
  package server (pinned version, checked against FSL's sha256; ~50 MB):
  JHU white-matter tractography (20 tracts), JHU ICBM-DTI-81 white-matter labels (48,
  incl. fornix and internal-capsule limbs) and XTRACT HCP (60 tracts from 1021 HCP
  adults, incl. fornix, amygdalofugal, uncinate, arcuate). Every lookup shows which
  tract a point is in and with what probability.
- **Connecting tracts** in the Regions tab: tracts whose core (>= threshold % of
  subjects) passes within N mm of your chosen regions; with several regions, which pairs
  each tract links. Tick a tract to draw it in 3D. Atlas, threshold and distance are
  adjustable. Atlas-based proximity, not tractography of your data.
- `atlaslookup setup` now skips atlases that are already installed, so existing installs
  just run it again to add the tracts. The app reminds you on start until you do.
- Regions and tracts restored on reload are no longer hidden behind the glass/mesh brain
  (the brain mesh is now always drawn first).
- The Regions tab scrolls as a whole, so the region search, chosen regions and tract
  list all stay usable on smaller screens.
- New dependency: `zstandard` (FSL's XTRACT package is zstd-compressed).

## 0.16.6 (2026-10-29)
- **Mesh brain transparency no longer fades the results**: the Transparency slider now
  applies to the grey brain only. Results (and regions) painted on the mesh stay fully
  opaque, so at high transparency they stand out on a see-through brain, and at 100 %
  only the results remain.

## 0.16.5 (2026-10-29)
- **Brighter results on the mesh brain**: a custom mesh shader keeps plain diffuse
  shading on the grey brain but shades coloured vertices (results, regions) only lightly,
  so they stay bright on surfaces facing away from the light. Still no gloss.

## 0.16.4 (2026-10-29)
- **Mesh brain is no longer glossy**: it used a shiny shader whose highlight washed out
  the warm colours of positive results. It now uses diffuse shading on a mid-grey brain,
  so positive (and negative) results stand out. Surface and Glass brain are unchanged.

## 0.16.3 (2026-10-29)
- **Colour bars in the Stat maps list**: each results-folder map's colour bars (+ and −,
  with editable threshold and maximum) now sit in its own row, under its name. Imported
  maps keep their bars at the bottom of the box.

## 0.16.2 (2026-10-29)
- **Cluster table follows the crosshair**: wherever you click (or type a coordinate), the
  row of the cluster containing that point is highlighted, not just a row you clicked.
  It updates when the threshold, sign or k changes. `/api/lookup` takes optional
  `threshold`, `sign` and `min_voxels` and then returns `stat.cluster` (the row, 0-based).

## 0.16.1 (2026-10-29)
- **t-table** shows one-tailed and two-tailed critical T.
- Above the viewer, the "Stat maps" picker is now a **▦ Open spmT…** button (load a map
  from your results folder), and "Add overlay" is **⤓ Import new map…** (a map from
  anywhere on this computer).

## 0.16.0 (2026-10-29)
- **Several stat maps at once**: maps chosen in the results browser are added to a
  "Stat maps" list under the viewer (like FSLeyes' overlay list). Each has a show/hide
  checkbox, its own opacity slider and ✕ to close it; all shown maps are overlaid
  (top of the list in front), in the same warm/winter colours. Click a map's name to make
  it active: the T-value range controls, the cluster table and the T at the crosshair are
  for the active map. Each map keeps its own threshold, sign and k. The browser's
  "None" is now "Close all". Open maps are restored next time.
- **t-table** in the viewer toolbar: type df to get the critical one-sided T for
  p = .05, .01, .005 and .001 (filled from the active map's df when empty).
- The **MNI (x, y, z)** heading with the T and p at that point moved below the
  T-value range, directly above the cluster table.

## 0.15.2 (2026-10-29)
- **Results browser**: the column you're working in widens to show long folder and file
  names in full (up to most of the panel's width); the other columns stay narrow.

## 0.15.1 (2026-10-29)
- **T-value range in one place**: threshold (T ≥), sign, cluster size (k ≥) and opacity now
  sit in one box directly under the viewer, together with the colour scale. The box appears
  once a stat map is chosen; the row above the viewer keeps just the map and Add overlay.

## 0.15.0 (2026-10-29)
- **Version menu**: the version badge next to the title opens a menu of tagged releases
  and Development (your checkout). Choosing one restarts the app on that version in place
  (same address and terminal) and reloads the page. Releases are checked out as git
  worktrees in `~/.atlaslookup/versions`, never touching your checkout. The switch only
  accepts JSON requests, so other websites can't trigger it.
- **3D toolbar** moved up, directly under Slices / 3D, and tidied into one row: style
  switch, Regions, Transparency, and a joined L R A P S I camera control.

## 0.14.0 (2026-10-29)
- **Left sidebar**: the lookup form, atlas overlay, atlas list and history (or the quiz
  setup) now form a sidebar that stays in view while the page scrolls and hides or shows
  with the sidebar button next to the title. Remembered.
- **Atlas overlay** controls moved into the sidebar, between the lookup form and the atlas
  list.
- **＋ Add overlay…** now sits right next to the Stat map button; the "Local NIfTI" label
  is gone (the button's tooltip explains it).
- Page content keeps clear of the collapsed side panel's tab rail.

## 0.13.0 (2026-10-29)
- **Progress** now lives in quiz mode, next to the way back to lookup.
- The quiz button is now a slightly crooked **🧠 Quiz me!** sticker that wobbles on
  hover (still while "reduce motion" is on); inside the quiz it reads **↩ Back to lookup**.

## 0.12.1 (2026-10-29)
- **Smoother 3D rotation.** NiiVue redrew the whole 3D scene about three times per
  mouse movement, so fast drags queued up frames and the brain lagged behind the
  pointer. Redraws are now coalesced into one per screen refresh (120 rapid moves:
  20 draws instead of 362).

## 0.12.0 (2026-10-29)
- **Brain transparency** slider (0-100 %) in the 3D view for all three styles (surface,
  glass, mesh), replacing the glass-only slider; each style remembers its own value.

## 0.11.1 (2026-10-29)
- Larger Results / Regions tabs on the side panel and its collapsed rail.

## 0.11.0 (2026-10-29)
- **Side panel** instead of pop-up windows: the results browser and the Regions picker
  now open in a panel docked on the right (tabs: Results, Regions), so the viewer is
  never covered. Drag its edge to resize; collapse it to a rail on the right edge (» or
  Esc) and reopen it from there. Open state, tab and width are remembered; the page goes
  to one column, viewer first, when the panel leaves little room. Hidden during the quiz.

## 0.10.1 (2026-10-29)
- **Opacity slider** for the results-folder stat map (next to T and k). It applies live,
  is remembered, and carries over to the 3D view, including the mesh brain.

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
