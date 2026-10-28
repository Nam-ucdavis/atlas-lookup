# Install with Claude

Paste the prompt below into [Claude Code](https://code.claude.com/docs) (or another
assistant that can run commands on your computer). It asks where to install, sets up
everything Atlas Lookup needs, shows you the app running, and ends with how to launch it.

```text
Please set up the Atlas Lookup app on this computer, show me it running, and tell me how to launch it later.

Repository: https://github.com/ccn-spark/atlas-lookup
(A local web app for looking up brain regions by MNI coordinate, with a 3-plane viewer and stat-map overlays. Python 3.10+, FastAPI, runs at http://127.0.0.1.)

Steps:

1. Ask me where to put it. Suggest a default, ~/atlas-lookup on macOS/Linux or %USERPROFILE%\atlas-lookup on Windows, and wait for my answer. Don't create or change anything before I answer.

2. Check prerequisites. Detect my OS and check for Python 3.10 or newer and for git.
   - If either is missing, tell me what you will install and how, and ask before installing.
   - macOS: Homebrew if present, otherwise the python.org installer and Xcode Command Line Tools for git.
   - Windows: winget (`winget install Python.Python.3.12` / `winget install Git.Git`).
   - Linux: the system package manager.
   - Never use sudo or change system settings without asking.

3. Download and install, inside the folder I chose:
   - `git clone https://github.com/ccn-spark/atlas-lookup <folder>`
   - Create a virtual environment in `<folder>/.venv`.
   - Run `pip install -e .` inside it.
   - Use the venv's own executables:
     - macOS/Linux: `.venv/bin/...`
     - Windows: `.venv\Scripts\...`

4. Download the atlases with `atlaslookup setup` (about 40 MB, one time, saved in ~/.atlaslookup). If a download fails, show me the error and retry once.

5. Start it and show me it works:
   - Run `atlaslookup serve --port 8765` in the background. If port 8765 is busy, use the next free port.
   - Confirm that http://127.0.0.1:<port>/api/version responds.
   - Run `atlaslookup query -44 18 24` and show me the region labels.
   - Open http://127.0.0.1:<port> in my browser. If you have a browser tool, take a screenshot so I can see the viewer.
   - Keep the server bound to 127.0.0.1 (the default). Don't expose it to the network.

6. Optional: ask me whether I have a folder of SPM results (`spmT_*.nii` files) to connect. If yes, run `atlaslookup set-results <path>`. The app only reads those files and never copies them. Skip this if I say no.

7. Finish with a short "How to launch" section, written for my OS, that covers:
   - the exact command to start it again from my folder, e.g. `<folder>/.venv/bin/atlaslookup` (Windows: `<folder>\.venv\Scripts\atlaslookup.exe`). It opens the browser at http://127.0.0.1:8765.
   - that `lookup` is a shorter name for the same command;
   - `--port 8770` to use another port;
   - Ctrl+C to stop it;
   - how to update: `git pull` in the folder, then `pip install -e .` in the venv;
   - optionally, how to make `lookup` work from any terminal: add the venv's bin/Scripts folder to PATH, or symlink `lookup` into ~/.local/bin on macOS/Linux. Offer this, but ask before changing my PATH or shell profile.

Report each step briefly as you go. If something fails, show me the actual error and what you'll try next.
```
