# Branches

This is the [ccn-spark/atlas-lookup](https://github.com/ccn-spark/atlas-lookup) repository.
It has one branch, `main`: `git clone` and `pip install` from here get it.

The app is also developed in [Nam-ucdavis/atlas-lookup](https://github.com/Nam-ucdavis/atlas-lookup),
whose `dev` branch has the newest work. Its updates are merged into `main` here, and
changes made here can be offered back to it.

## One-time setup on a new computer

```bash
git clone https://github.com/ccn-spark/atlas-lookup && cd atlas-lookup
git remote add nam https://github.com/Nam-ucdavis/atlas-lookup.git
```

## Everyday work

```bash
git switch main
# ...edit, test (.venv/bin/pytest)...
git add -A && git commit -m "Describe the change"
git push origin main
```

## Pulling in updates from Nam-ucdavis

```bash
git fetch nam
git switch main
git merge nam/dev
```

Nam's repository points its install and clone commands, and these branch notes, at
itself. When those files conflict, keep this repository's version (ccn-spark URLs, this
file, the Branches section of `CLAUDE.md` and `README.md`) and take everything else from
`nam/dev`. Claude can do this for you: "merge Nam's dev into main and resolve the
conflicts". Then run the tests (`.venv/bin/pytest`) and push.

## Offering a change back to Nam-ucdavis

Make the change on a branch that starts from Nam's `dev`, so it contains only that change:

```bash
git fetch nam
git switch -c fix-something nam/dev
# ...change, test, commit...
git push -u origin fix-something
```

Then open a pull request on GitHub from `ccn-spark/atlas-lookup:fix-something` to
`Nam-ucdavis/atlas-lookup:dev`.

## Installing a particular version

```bash
pipx install git+https://github.com/ccn-spark/atlas-lookup           # newest main
pipx install git+https://github.com/ccn-spark/atlas-lookup@v0.19.10  # one release
```
