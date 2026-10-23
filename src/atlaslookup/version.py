"""What's live: the package version, plus the git commit when running from a
clone of the repository (e.g. `pip install -e .`)."""
from __future__ import annotations

import subprocess
from functools import lru_cache

from . import __version__
from .config import PACKAGE_DIR

# src/atlaslookup -> repository root, only meaningful for a source checkout.
REPO_DIR = PACKAGE_DIR.parent.parent


def _git(*args) -> str:
    if not (REPO_DIR / ".git").exists():
        return ""  # installed from a wheel: no commit to report
    try:
        return subprocess.run(["git", "-C", str(REPO_DIR), *args], capture_output=True,
                              text=True, timeout=3).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


@lru_cache(maxsize=1)
def version_info() -> dict:
    commit = _git("rev-parse", "--short", "HEAD")
    # "modified" = source files differ from that commit (uncommitted edits).
    dirty = bool(commit) and bool(_git("status", "--porcelain", "--untracked-files=no", "--", "src"))
    label = f"v{__version__}" + (f" · {commit}" if commit else "") + (" · modified" if dirty else "")
    return {"version": __version__, "commit": commit, "modified": dirty, "label": label}
