---
name: release
description: Cut a new Atlas Lookup release, covering version bump, changelog, tests, wheel build, smoke test and git tag.
argument-hint: "[major | minor | patch | X.Y.Z]"
disable-model-invocation: true
---

Prepare release: $ARGUMENTS (default: minor if there are new features, else patch).

1. Check `git status` is clean apart from the intended changes, and read
   `git log <last tag>..HEAD` to see what's in this release.
2. Bump `__version__` in `src/atlaslookup/__init__.py`.
3. Add a dated entry at the top of `CHANGELOG.md`, written for users: what they can do
   now, not internal refactors.
4. Run `.venv/bin/pytest -q` and fix any failures. If `atlaslookup setup` hasn't been
   run, the atlas-dependent tests skip; say so.
5. Build with `.venv/bin/python -m build --outdir /tmp/al-dist` (install `build` if
   needed). Install the wheel into a fresh venv with
   `ATLASLOOKUP_HOME=/tmp/al-home-$RANDOM`, and run `atlaslookup --version`,
   `atlaslookup setup` and `atlaslookup query -44 18 24`.
6. Show the user the changelog entry and test results, then commit and tag
   `vX.Y.Z` (annotated) once they confirm.
7. **Don't push.** Tell the user the command (`git push && git push --tags`).
