```text
Please install the Atlas Lookup app on this computer, or update it if it is already installed, show me it running, and tell me how to launch it later.

Repository (the only source to install or update from): https://github.com/Nam-ucdavis/atlas-lookup
(A local web app for looking up brain regions by MNI coordinate. Python 3.10+, FastAPI, runs at http://127.0.0.1. The command is `atlaslookup`, with the short alias `lookup`.)

Work through these steps and report each one briefly. If something fails, show me the actual error and what you'll try next.

1. Find out what is already installed. Detect my OS first, then check all of these:
   - pipx: `pipx list` (look for atlas-lookup).
   - The command on PATH: `which -a atlaslookup lookup` (Windows: `where atlaslookup`). Note which Python environment each one belongs to.
   - pip in the active Python: `python -m pip show atlas-lookup`.
   - A git clone: if any install points into a folder with a `.git` directory, note its path and run `git -C <folder> remote -v`.
   - A running app: `curl -s http://127.0.0.1:8765/api/version` (and ports 8766-8775). It returns the running version and commit.
   - The latest release: `git ls-remote --tags https://github.com/Nam-ucdavis/atlas-lookup` (highest vX.Y.Z).
   Tell me what you found: each install's method, location, version and source URL, and the latest version. If you find more than one install, ask me which one to keep before changing anything.

2. Check prerequisites only if something must be installed: Python 3.10 or newer, and git.
   - If either is missing, tell me what you will install and how, and ask before installing.
   - macOS: Homebrew if present, otherwise the python.org installer and Xcode Command Line Tools for git.
   - Windows: winget (`winget install Python.Python.3.12` / `winget install Git.Git`).
   - Linux: the system package manager.
   - Never use sudo or change system settings without asking.

3. Stop the running app before updating. If step 1 found one, tell me the port and process, and ask before stopping it. While an old server is running, starting the app only prints "already running" and keeps serving the old version.

4. Update or install, matching what I already have:
   - pipx install: `pipx install --force git+https://github.com/Nam-ucdavis/atlas-lookup`
   - pip in a virtual environment: activate it (or use its own python), then `python -m pip install --upgrade git+https://github.com/Nam-ucdavis/atlas-lookup`
   - git clone:
     - If its origin is Nam-ucdavis/atlas-lookup: run `git status`. If there are uncommitted changes, stop and ask me. Otherwise run `git pull --ff-only`, then `pip install -e .` with that clone's own venv.
     - If its origin is another repository (e.g. ccn-spark/atlas-lookup), tell me. Ask whether to add Nam-ucdavis/atlas-lookup as a remote and merge it, or to make a fresh clone instead.
   - Nothing installed: ask me where to put it, suggesting ~/atlas-lookup (Windows: %USERPROFILE%\atlas-lookup), and wait for my answer. Then run `git clone https://github.com/Nam-ucdavis/atlas-lookup <folder>`, create `<folder>/.venv`, and run `pip install -e .` inside it.
   - On macOS, if `import atlaslookup` fails right after `pip install -e .`, the folder is probably synced by iCloud, which hides `.venv`. Put the venv in ~/.venvs/atlas-lookup and symlink it to `<folder>/.venv`.

5. Download data: run `atlaslookup setup` with the updated install. It skips atlases that are already there, and new versions add data (about 100 MB on a first run). It writes only to ~/.atlaslookup (or $ATLASLOOKUP_HOME). Keep my settings, including the results folder set with `atlaslookup set-results`. Never delete or overwrite ~/.atlaslookup/settings.json.

6. Results folder (optional): run `atlaslookup info`. If no results folder is set, ask me whether I have a folder of SPM results (`spmT_*.nii` or other `.nii` maps) to connect. If yes, run `atlaslookup set-results <path>`. The app only reads those files and never copies them. Skip this if one is already set or I say no.

7. Verify and show me:
   - `atlaslookup --version` matches the latest release from step 1. Run it from the updated install, using its full path if PATH finds another copy first.
   - Start it with `atlaslookup serve --port 8765` in the background (use the next free port if 8765 is busy with something else).
   - Confirm http://127.0.0.1:<port>/api/version shows the new version, and run `atlaslookup query -44 18 24` to show region labels.
   - Open http://127.0.0.1:<port> in my browser. If you have a browser tool, take a screenshot.
   - Keep the server bound to 127.0.0.1 (the default). Don't expose it to the network.

8. Finish with a short "How to launch" section for my OS:
   - The exact command to start it again (`atlaslookup` or `lookup`, or the full path if they're not on PATH). It opens the browser at http://127.0.0.1:8765.
   - `--port 8770` to use another port.
   - Ctrl+C to stop it. Stop the old server before starting a new one.
   - How to update next time: rerun this prompt, or the one update command for my install method from step 4, then `atlaslookup setup`.
```
