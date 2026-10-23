# Using and developing Atlas Lookup with Claude

This repository is set up for [Claude Code](https://code.claude.com/docs), Anthropic's
coding assistant. In the project folder, you can ask Claude in plain English to look up
coordinates, label your clusters, add an atlas from a paper, or change the app itself.
Claude runs the same `atlaslookup` commands you would, and shows you what it did.

What makes this work:

| File | What it does |
|---|---|
| `CLAUDE.md` | Loaded automatically. It tells Claude how the project is built, which commands to run, and the rules it must not break (privacy, correctness, releases). |
| `.claude/skills/` | Ready-made workflows you start with a slash command: `/add-atlas`, `/label-clusters`, `/release`. |
| `.claude/settings.json` | Lets Claude run tests and harmless look-up commands without asking each time, and stops it from running `git push`. |

## 1. Set up (once)

1. **Install Claude Code.** On macOS or Linux:
   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   ```
   On Windows (PowerShell), run `irm https://claude.ai/install.ps1 | iex`. Check it
   worked with `claude --version`. There's also a desktop app and VS Code / JetBrains
   extensions; see the [quickstart](https://code.claude.com/docs/en/quickstart).
2. **Get the code and install it for development:**
   ```bash
   git clone https://github.com/Nam-ucdavis/atlas-lookup && cd atlas-lookup
   python -m venv .venv && .venv/bin/pip install -e ".[test]"
   .venv/bin/atlaslookup setup        # downloads the atlases (~40 MB, one time)
   ```
3. **Start Claude in the folder:**
   ```bash
   claude
   ```
   The first time, it asks you to sign in. Later, `claude -c` continues your last
   conversation.

You don't need to know Python to *use* the app this way. For *developing*, knowing a
little helps you review what Claude changes.

## 2. Before you share research data: privacy

Claude Code runs on your computer, but **whatever Claude reads is sent to the model
provider** so it can answer. That includes file contents and command output, such as a
cluster table. Your files aren't uploaded wholesale, only what ends up in the
conversation.

- Check your lab's or IRB's data policy before pointing Claude at study data.
  Group-level T maps are usually less sensitive than subject-level data, but you decide.
- Claude only runs `atlaslookup clusters` (which reads your T maps) **after asking you**:
  it is deliberately not on the pre-approved list in `.claude/settings.json`.
- Your results folder stays outside the repository, and the project rules tell Claude
  never to copy results or results paths into tracked files.
- Commercial plans (Team, Enterprise, API) aren't used for model training by default;
  for consumer plans it depends on your settings. See Anthropic's
  [data usage page](https://code.claude.com/docs/en/data-usage).

## 3. Using the app through Claude

Type requests like these at the Claude prompt:

**Look up coordinates**
- "What region is MNI −44, 18, 24 in? Give me Harvard-Oxford, Juelich and Brodmann."
- "Label these peaks: (−38, −22, 56), (52, −30, 10), (2, −52, 26)."
- "Voxel 27, 39, 29 on my 3 mm grid: where is that?" (register the grid first; see below)

**Your SPM results**
- `/label-clusters`: Claude lists your maps and asks which one.
- `/label-clusters modelA/spmT_0001.nii 3.5`: picks a map and a threshold.
- "Make a CSV of the clusters at T ≥ 3.2 with k ≥ 10 and save it to ~/Desktop."
- "Do the peaks in model A fall in the same regions as model B?"

Claude reports uncorrected p values as uncorrected, and points out where the atlases
disagree or a peak is only near a region.

**Set things up**
- "Register the grid from /path/to/my/spmT_0001.nii so I can use voxel indices."
  (Claude runs `atlaslookup add-grid`.)
- "Point the app at my results folder /path/to/results." (`atlaslookup set-results`)
- "Start the app." (`atlaslookup`, which opens your browser)

**Add an atlas from a paper**
- `/add-atlas ~/Downloads/Glasser_MMP1/`
- `/add-atlas https://...` with a paper or download page. Claude asks before downloading.

The skill inspects the files first (space, labels, whether they're bilateral), imports
the atlas, then checks it against known landmarks and tells you how it went.

**Learn**
- "Explain the difference between the Harvard-Oxford and Juelich labels at this point."
- "Quiz me on limbic regions." Claude can explain things, but the in-app
  **Quiz mode → Progress → Practise** is the better drill.

## 4. Developing with Claude

Claude follows `CLAUDE.md`: it runs the tests, checks UI changes in a browser, and
won't commit data or push.

**A typical change**
1. Describe what you want and why: "Add an option to export the cluster table as CSV
   from the web app." The why helps Claude get the details right.
2. For anything non-trivial, ask for a plan first: "Plan this before changing code."
3. Let it implement. It should add tests and run `.venv/bin/pytest`.
4. Review the result: ask "show me the diff" or read `git diff` yourself. Ask Claude to
   explain any part you don't follow.
5. Try it: "start the app on port 8770 with a throwaway data folder" lets you click
   around without touching your own setup.
6. Commit when you're happy. Ask Claude to commit with a clear message, or do it
   yourself.

**Good requests**
- Specific about behaviour: "When a peak isn't in any Harvard-Oxford region, show the
  nearest one within 5 mm and its distance."
- With a way to check: "...and add a test using a synthetic map with a known peak."
- Pointing at what's wrong: "In dark mode the progress bars are invisible. Here's a
  screenshot."

**Releasing:** type `/release minor` (or `patch`). Claude bumps the version, writes the
changelog, runs the tests, builds the package, tests the built package in a clean
environment, and tags it after you confirm. It won't push; it prints the command for
you to run.

**Contributing back:** work on a branch (`git switch -c my-feature`), push it, and open
a pull request on GitHub. Mention in the description that Claude helped and what you
checked yourself.

## 5. Customising for yourself

- **Personal instructions:** create `CLAUDE.local.md` in the repo (git-ignored), e.g.
  "My data is in MNI152NLin2009cAsym; my grid is called my-3mm." Claude reads it along
  with `CLAUDE.md`.
- **Personal permissions:** when Claude asks to run something and you choose *Yes, and
  don't ask again*, the rule goes in `.claude/settings.local.json` (git-ignored). Shared
  rules stay in `.claude/settings.json`.
- **Your own skills:** add `.claude/skills/<name>/SKILL.md` in the repo to share a
  workflow with everyone, or put it in `~/.claude/skills/` to keep it to yourself. See
  the [skills docs](https://code.claude.com/docs/en/skills).

## 6. Troubleshooting

| Problem | Try |
|---|---|
| Claude says tests were skipped | Run `.venv/bin/atlaslookup setup`; atlas-dependent tests skip until then. |
| The app shows old pages after a change | Restart the server; the browser re-checks pages on each load. |
| "Port 8765 is used by another program" | `atlaslookup serve --port 8766`, or ask Claude what's using the port. |
| Claude doesn't seem to know the project rules | Make sure you started `claude` inside the repo folder, so `CLAUDE.md` is loaded. |
| `/add-atlas` etc. don't appear | Same: start Claude from the repo root, where `.claude/skills/` lives. |
| Claude keeps asking before running tests | Check that it's running `.venv/bin/pytest` from the repo root; that's the pre-approved form. |
