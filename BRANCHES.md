# Branches

This repository has two branches with different jobs:

| Branch | What it is | Who changes it |
|---|---|---|
| `dev` | **Where all new work goes.** The **default branch** on GitHub, so the repo page, `git clone` and `pip install` all get it. Releases are tagged here (e.g. `v0.17.3`). | You. |
| `main` | **The stable version:** `dev` merged in once it has been tried. Nothing is committed to `main` directly. | Only merges from `dev`. |

```
dev  (new work, tagged releases) ──► main  (stable: merged from dev)
```

`main` used to be an exact copy of [ccn-spark/atlas-lookup](https://github.com/ccn-spark/atlas-lookup).
It no longer follows ccn-spark; ccn-spark is just another remote you can pull from.

## One-time setup on a new computer

```bash
git clone https://github.com/Nam-ucdavis/atlas-lookup && cd atlas-lookup   # checks out dev
git remote add ccn-spark https://github.com/ccn-spark/atlas-lookup.git     # optional
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

## Moving `dev` to `main`

When `dev` has been tried and you want it to be the stable version:

```bash
git switch main
git merge --ff-only dev        # main only ever moves forward to dev
git push origin main
git switch dev
```

`--ff-only` refuses to run if `main` has a commit that `dev` lacks. That means someone
committed to `main` directly; see "Fixing mistakes" below.

## Pulling in updates from ccn-spark (optional)

```bash
git fetch ccn-spark
git switch dev
git merge ccn-spark/main
```

If a file was changed both by ccn-spark and by you, git reports a conflict. Open the
file, keep the right parts, then `git add <file>` and `git commit`. Claude can do this
for you: "merge ccn-spark into dev and resolve the conflicts". Run the tests
(`.venv/bin/pytest`) and push. It reaches `main` the next time `dev` is merged in.

## Offering a change back to ccn-spark

Make the change on a branch that starts from ccn-spark's `main`, so it contains only
that change and none of your other work:

```bash
git fetch ccn-spark
git switch -c fix-something ccn-spark/main
# ...change, test, commit...
git push -u origin fix-something
```

Then open a pull request on GitHub from `Nam-ucdavis/atlas-lookup:fix-something` to
`ccn-spark/atlas-lookup:main`.

## Installing a particular branch

```bash
pipx install git+https://github.com/Nam-ucdavis/atlas-lookup          # dev: newest (default)
pipx install git+https://github.com/Nam-ucdavis/atlas-lookup@main     # stable
pipx install git+https://github.com/Nam-ucdavis/atlas-lookup@v0.17.3  # one release
```

## Fixing mistakes

- **Committed to `main` by accident:** move the commit to `dev`, then put `main` back
  to where GitHub has it (if it wasn't pushed yet).
  ```bash
  git switch dev && git cherry-pick main     # copies the last main commit onto dev
  git switch main && git reset --hard origin/main
  ```
  If it was already pushed, use `git reset --hard main~1` instead, then
  `git push --force-with-lease origin main`.
- **Not sure which branch you're on:** `git branch --show-current`, or look at the
  prompt in GitHub Desktop.
- **See what `dev` has that `main` doesn't yet:** `git log --oneline main..dev`.
