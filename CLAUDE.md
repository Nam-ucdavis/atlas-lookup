# Atlas Lookup: notes for Claude

A local web app and CLI that answers "which brain region is this MNI coordinate in?"
across several atlases, shows a three-plane viewer, labels clusters in a user's SPM T
maps, and quizzes users on regions. Python (FastAPI + nibabel/nilearn) backend,
vanilla-JS front end, NiiVue for the viewer. Human-facing docs: `README.md`,
`docs/working-with-claude.md`.

## Branches

- `main` is an exact mirror of `ccn-spark/main`. **Never commit to `main`.** It only moves
  by `git pull --ff-only ccn-spark main`.
- `dev` is where all work happens: check `git branch --show-current` before committing,
  and switch to `dev` (or a feature branch made from it) if needed.
- To bring in ccn-spark updates, fast-forward `main` first, then merge `main` into `dev`.
  To offer a change upstream, branch from `main`, not `dev`. Details: `BRANCHES.md`.

## Commands

```bash
python -m venv .venv && .venv/bin/pip install -e ".[test]"   # dev install
.venv/bin/atlaslookup setup          # download atlases into the data folder (needed by ~half the tests)
.venv/bin/pytest -q                  # all tests; atlas-dependent ones skip without setup
.venv/bin/atlaslookup serve --port 8770           # run without touching the user's 8765
ATLASLOOKUP_HOME=/tmp/al-test .venv/bin/atlaslookup serve --port 8770   # throwaway data folder
.venv/bin/atlaslookup query -44 18 24             # quick sanity check from the terminal
.venv/bin/atlaslookup maps                        # the user's spmT maps (reads their results folder)
.venv/bin/atlaslookup clusters <map> --threshold 3 --k 5 [--csv]   # labelled peak table
```

Shared workflows live in `.claude/skills/` (`/add-atlas`, `/label-clusters`, `/release`).
`maps` and `clusters` read the user's research results, so they are deliberately not
pre-approved in `.claude/settings.json`; let the user approve them.

The answer-matching test runs `static/quiz.js` under `node`; it skips if node is missing.

If `import atlaslookup` fails right after `pip install -e .` on macOS, the repo is
probably in an iCloud-synced folder: iCloud hides `.venv`, and Python 3.12.8+ skips hidden
`.pth` files. Put the venv in `~/.venvs/atlas-lookup` and symlink it to `.venv` (see the
README's Development section).

## Layout

```
src/atlaslookup/
  config.py       all paths: PACKAGE_DIR/STATIC_DIR (code) vs DATA_DIR (~/.atlaslookup or $ATLASLOOKUP_HOME)
  atlas.py        Atlas: lookup() -> label / probabilities / nearest / neighbourhood; add_atlas(); MNI resampling
  sources.py      built-in atlas importers (nilearn) + `setup` (skips atlases already installed);
                  JHU + XTRACT tracts come from FSL's conda channel, pinned by version + sha256
                  (FSL_PACKAGES), XTRACT resampled to 2 mm to keep memory down
  labels.py       label-file readers (tsv/csv, LUT txt, FSL xml)
  grids.py        voxel grids (voxel index <-> mm)
  query.py        input resolution (mm / voxel, 1-based default) + best_guess()
  results.py      read-only access to the user's spmT maps: list, value, clusters, cluster_at
                  (which cluster-table row a point falls in; clusters are cached per map +
                  threshold/sign/k in _clusters, keyed by file mtime)
  quiz.py         quiz regions, interior points, masks, brain-division mapping
  server.py       FastAPI routes (docstring lists them all)
  __main__.py     CLI (`atlaslookup ...`)
  version.py      version + git commit badge
  versions.py     version menu: lists vX.Y.Z tags (>= 0.6.0), checks them out as git worktrees under
                  ~/.atlaslookup/versions, and restarts the server in place (os.execve) with
                  PYTHONPATH=<worktree>/src. Never touch the user's checkout from here.
  static/index.html   the whole lookup UI (inline module script). Several results-folder maps can be
                      open at once (state.stats, front first, each with its own visible/opacity/
                      threshold/sign/k/max, saved as "statMaps"); one is active (state.stat) and
                      drives the T-value range controls, the cluster table, and the T and cluster
                      highlight at the crosshair (/api/lookup gets its threshold/sign/min_voxels).
                      Each map's colour bars live in its row (viewertools barHost)
  static/quiz.js      quiz + progress UI; exports matchName() for tests
  screenshots.py  saves "scr" captures as DATA_DIR/image/<date_time>.png
  static/viewertools.js  crosshair toggle, slice coordinate labels, "scr" capture; exports sliceLabel() for tests
  static/overlays.js  local NIfTI overlays read in the browser (never uploaded); exports tSf/tFromP/dfFromHeader for tests
  static/viewer3d.js  3D tab: a second NiiVue instance that mirrors the slice viewer's overlays
                      (clones volumes + copies display settings); surface or glass-brain mesh
                      (/api/brain_mesh.gii, fsaverage5 pial built by sources.export_mesh);
                      mesh style projects overlays onto the mesh in the browser; chosen regions
                      are drawn as server-built meshes (/api/regions/mesh.gii). nv3.drawScene is
                      coalesced to one draw per animation frame; use drawNow() when a synchronous
                      draw is needed (e.g. before copying the canvas)
  static/regionpicker.js  the Regions tab (search all atlases, colours, "results only inside")
  static/browser.js   Finder-style column browser for the results folder's stat maps (side panel, Results tab)
  static/sidepanel.js docked, resizable, collapsible right-hand panel hosting Results and Regions;
                      the page narrows (body.sp-open), one column when cramped (body.sp-narrow).
                      Note: it is an <aside>, so page-layout rules must target `main > aside`
  regions.py      region listing, 1 mm region masks, smooth region surface meshes
  tracts.py       tract atlases (manifest extra.tract): which tracts' cores (>= threshold %) come
                  within N mm of chosen regions ("Connecting tracts"), and tract surface meshes.
                  Atlas-based proximity, not tractography; say so in any UI/docs you touch
  static/tracts.js    "Connecting tracts" list under the Regions tab; ticked tracts drawn in 3D
  static/vendor/niivue-0.69.0.js   vendored NiiVue bundle; do not edit
tests/test_lookup.py
```

## Rules that must hold

**Privacy and data**
- Nothing user-specific lives in the package or the repo. Atlases, grids, the template and
  `settings.json` go in `config.DATA_DIR`. Never add data files, example results, or
  machine paths to tracked files, including docs (write `/path/to/your/results`).
- Results are read-only. All access to the results folder goes through
  `Results.resolve()`, which refuses paths outside the folder and non-`spmT_*` files.
  Don't add routes that open files another way, and don't cache maps to disk.
- The server binds to 127.0.0.1 by default. Don't change that default.
- Tests use synthetic data (`tmp_path`, fixtures such as `results_dir`) and never a real
  user folder.
- Atlas files are never bundled (FSL atlases are non-commercial; others have their own
  terms). They're downloaded by `setup` via nilearn, and each keeps its citation in its
  manifest.

**Neuroimaging correctness**
- Internally everything is MNI mm. Each atlas samples with its own affine. Voxel input is
  converted through a registered grid and is 1-based by default (SPM/MATLAB).
- Talairach atlases use `mm_transform` (Lancaster icbm_spm2tal). Their MNI-resampled copy
  (`overlay_map_mni.nii.gz`) must agree with the transformed lookup; a test checks this.
- The quiz never contradicts lookup: `quiz.point()` returns only points whose
  `Atlas.lookup()` gives the asked region. Keep that check if you change sampling.
- Every quizzable region must map to a brain division (`quiz.DIVISIONS` /
  `BRODMANN_DIVISION`); a test enforces it. Watch regex substrings ("tri-angular-is"
  once matched `angular`); use `\b` where needed.
- Stat-map p values are uncorrected, one-sided, using the df parsed from the SPM header.
  Say so in any UI or docs you touch.

## Conventions

- Match the surrounding code: small functions, sparse comments that explain *why*,
  type hints in Python, no new dependencies without a good reason.
- Front end: plain ES modules, no build step, no frameworks. Colours are CSS variables on
  `:root` with a dark-mode block. The app is used in desktop browsers only (no phone
  layout needed); keep new elements working in light and dark mode. Class names are global, so check for clashes (`.seg` is the segmented
  control; progress bars use `.pseg`).
- Browser caching: `/` and `/static/*` are sent with `Cache-Control: no-cache` so a
  restart shows new UI. Keep it.
- New API routes: add them to the docstring at the top of `server.py` and to the README's
  API list.

## Verifying changes

- Run `pytest` and add tests for new behaviour, with synthetic data.
- For UI changes, run the app on a spare port with a throwaway `ATLASLOOKUP_HOME` (after
  `setup`) and check it in a desktop browser, light and dark, with no console errors. Exercise lookup, the viewer click, quiz mode (both question types), Progress,
  and a stat map if your change touches them.

## Releasing

1. Bump `__version__` in `src/atlaslookup/__init__.py` (semver; the badge reads it).
2. Add a dated entry at the top of `CHANGELOG.md`, written for users.
3. Run `pytest`, build (`python -m build`), and smoke-test the wheel in a fresh venv.
4. Commit, then `git tag -a vX.Y.Z -m "Atlas Lookup X.Y.Z"`. Push only when the maintainer asks.

## Updating NiiVue

The vendored file is an esbuild bundle of `@niivue/niivue` (bare imports resolved). To
update: `npm install @niivue/niivue@X esbuild` in a scratch folder, bundle
`export * from '@niivue/niivue'` with `esbuild --bundle --format=esm --minify`, replace the
file (keep the version in its name and update the import in `index.html`), and refresh
`THIRD_PARTY_NOTICES.md` with the licences of NiiVue and its dependencies.
