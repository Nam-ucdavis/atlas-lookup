# Branches and keeping in sync with ccn-spark

This repository has two branches with different jobs:

| Branch | What it is | Who changes it |
|---|---|---|
| `main` | An **exact copy** of [ccn-spark/atlas-lookup](https://github.com/ccn-spark/atlas-lookup)'s `main`. | Only updates pulled from ccn-spark. Never commit here directly. |
| `dev` | **Your version:** ccn-spark's code plus your own changes. New features go here. | You. |

```
ccn-spark/main ──► main  (mirror: identical, fast-forward only)
                     │
                     └──► dev  (main + your work; merge main in to stay up to date)
```

Because `main` always matches ccn-spark, `git diff main dev` shows exactly what your
version adds. That also makes it easy to offer a change back to them.

## One-time setup on a new computer

```bash
git clone https://github.com/Nam-ucdavis/atlas-lookup && cd atlas-lookup
git remote add ccn-spark https://github.com/ccn-spark/atlas-lookup.git
git switch dev
```

## Everyday work (on `dev`)

```bash
git switch dev                 # make sure you're on dev
# ...edit, test (.venv/bin/pytest)...
git add -A && git commit -m "Describe the change"
git push                       # to GitHub: Nam-ucdavis/atlas-lookup, branch dev
```

For a bigger change, branch off `dev` and merge it back when it works:

```bash
git switch -c my-feature dev
# ...work, commit...
git switch dev && git merge my-feature && git push
```

## Pulling in updates from ccn-spark

1. Update the mirror:
   ```bash
   git switch main
   git pull --ff-only ccn-spark main
   git push origin main
   ```
   `--ff-only` refuses to run if `main` has drifted from ccn-spark. That's the signal
   that someone committed to `main` by mistake; see "Fixing mistakes" below.
2. Bring the updates into your version:
   ```bash
   git switch dev
   git merge main
   ```
   If a file was changed both by ccn-spark and by you, git reports a conflict. Open the
   file, keep the right parts, then `git add <file>` and `git commit`. Claude can do this
   for you: "merge main into dev and resolve the conflicts".
3. Run the tests (`.venv/bin/pytest`) and push: `git push`.

## Offering a change back to ccn-spark

Make the change on a branch that starts from `main`, so it contains only that change
and none of your other `dev` work:

```bash
git switch -c fix-something main
# ...change, test, commit...
git push -u origin fix-something
```

Then open a pull request on GitHub from `Nam-ucdavis/atlas-lookup:fix-something` to
`ccn-spark/atlas-lookup:main`. Once they accept it, it reaches your `main` the next time
you pull, and your `dev` the next time you merge `main` in.

## Installing a particular branch

```bash
pipx install git+https://github.com/Nam-ucdavis/atlas-lookup@dev    # your version
pipx install git+https://github.com/Nam-ucdavis/atlas-lookup        # main = ccn-spark's version
```

Releases of your version are tagged on `dev` (e.g. `v0.8.0`); install one with `@v0.8.0`.

## Fixing mistakes

- **Committed to `main` by accident:** move the commit to `dev`, then put `main` back.
  ```bash
  git switch dev && git cherry-pick main     # copies the last main commit onto dev
  git switch main && git reset --hard ccn-spark/main
  ```
  If that commit was already pushed, finish with `git push --force-with-lease origin main`.
- **Not sure which branch you're on:** `git branch --show-current`, or look at the
  prompt in GitHub Desktop.
- **See what your version adds:** `git log --oneline main..dev` lists the commits, and
  `git diff main dev` shows the changes.
