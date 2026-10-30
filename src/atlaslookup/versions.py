"""Switch the running app between tagged releases (the version menu in the header).

Only available when running from a git checkout. Each release is checked out once
into its own git worktree under ~/.atlaslookup/versions/<tag>, so the user's own
checkout (branch, files, uncommitted work) is never touched. Switching replaces the
running server process in place (same port, same terminal) with the chosen code:

  release      PYTHONPATH=<worktree>/src, ATLASLOOKUP_RUNNING_TAG=<tag>
  development  neither variable, so the editable install (the user's checkout) loads

The data folder (atlases, grids, settings) is shared by every version since 0.6.0,
which is the oldest release offered.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import threading

from .config import DATA_DIR
from .version import REPO_DIR, _git

TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
OLDEST = (0, 6, 0)  # first release with the installable layout and ~/.atlaslookup
MAX_LISTED = 10
VERSIONS_DIR = DATA_DIR / "versions"
DEV = "dev"


def running() -> str:
    return os.environ.get("ATLASLOOKUP_RUNNING_TAG") or DEV


def available() -> bool:
    return bool(_git("rev-parse", "--git-dir"))


def releases() -> list[dict]:
    """Tagged releases, newest first: [{tag, date}]."""
    out = []
    for tag in _git("tag", "-l", "v*", "--sort=-v:refname").splitlines():
        m = TAG.match(tag)
        if m and tuple(map(int, m.groups())) >= OLDEST:
            out.append({"tag": tag, "date": _git("log", "-1", "--format=%cs", tag)})
        if len(out) >= MAX_LISTED:
            break
    return out


def listing() -> dict:
    if not available():
        return {"available": False, "running": running(), "releases": [],
                "note": "Switching versions needs a git checkout of atlas-lookup."}
    return {"available": True, "running": running(), "releases": releases()}


def _worktree(tag: str):
    path = VERSIONS_DIR / tag
    if not (path / "src" / "atlaslookup").exists():
        VERSIONS_DIR.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "-C", str(REPO_DIR), "worktree", "add", "--detach", "--force", str(path), tag],
                       check=True, capture_output=True, text=True, timeout=60)
    return path


def switch(target: str, host: str, port: int, results: str | None) -> None:
    """Prepare the target version, then (shortly after the HTTP reply has gone out)
    replace this process with a server running it. Raises ValueError for unknown targets."""
    env = dict(os.environ)
    if target == DEV:
        env.pop("PYTHONPATH", None)
        env.pop("ATLASLOOKUP_RUNNING_TAG", None)
    else:
        if target not in {r["tag"] for r in releases()}:
            raise ValueError(f"Unknown version {target!r}")
        env["PYTHONPATH"] = str(_worktree(target) / "src")
        env["ATLASLOOKUP_RUNNING_TAG"] = target
    argv = [sys.executable, "-m", "atlaslookup", "serve", "--host", host, "--port", str(port)]
    if results:
        argv += ["--results", results]
    print(f"Switching to {'the development checkout' if target == DEV else target} ...", flush=True)
    # The listening socket is non-inheritable, so exec releases the port for the new server.
    threading.Timer(0.4, lambda: os.execve(sys.executable, argv, env)).start()
