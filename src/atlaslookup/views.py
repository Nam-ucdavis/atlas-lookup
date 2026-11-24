"""Saved views: the app's settings under a name, opened at http://127.0.0.1:8765/<name>.

A view is what the page keeps in its browser storage (the stat maps open, with their
thresholds, signs and colours; the active map; slices or 3D and the 3D settings; atlases
shown; regions and tracts; tag and image options...), plus the coordinate and the 3D
camera. Opening its link starts the app with those settings; changes made there stay in
that page until you update the view, and never touch your everyday settings.

Stored in DATA_DIR/views.json (never in the results folder):
{"version": 1, "views": {name: {"settings": {...}, "hash": "c=...", "camera": {...},
                                "saved": iso time}}}
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
# Paths the app itself uses: never a view's name.
RESERVED = {"api", "static", "docs", "redoc", "openapi", "index", "favicon"}
MAX_BYTES = 512 * 1024  # one view's JSON
_lock = threading.Lock()


def check_name(name: str) -> str:
    name = str(name or "").strip()
    if not NAME.match(name):
        raise ValueError("A view's name is 1-64 letters, digits, - or _, starting with a letter or digit")
    if name.lower() in RESERVED:
        raise ValueError(f"{name!r} is used by the app itself; choose another name")
    return name


class ViewStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    def _read(self) -> dict:
        try:
            data = json.loads(self.path.read_text())
        except FileNotFoundError:
            return {}
        except (OSError, ValueError):
            raise ValueError(f"{self.path} is not readable JSON; fix or move it")
        views = data.get("views", {})
        return views if isinstance(views, dict) else {}

    def _write(self, views: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".views-", suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump({"version": 1, "views": views}, f, indent=1)
            f.write("\n")
        os.replace(tmp, self.path)  # never a half-written file

    def all(self) -> dict:
        with _lock:
            return self._read()

    def get(self, name: str) -> dict:
        v = self.all().get(name)
        if v is None:
            raise KeyError(name)
        return v

    def save(self, name: str, settings, hash_: str = "", camera=None) -> dict:
        name = check_name(name)
        if not isinstance(settings, dict):
            raise ValueError("settings must be an object")
        view = {"settings": settings, "hash": str(hash_ or "")[:500].lstrip("#"),
                "camera": camera if isinstance(camera, dict) else None,
                "saved": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        if len(json.dumps(view)) > MAX_BYTES:
            raise ValueError("This view is too large to save")
        with _lock:
            views = self._read()
            views[name] = view
            self._write(views)
        return view

    def delete(self, name: str) -> None:
        with _lock:
            views = self._read()
            if name not in views:
                raise KeyError(name)
            del views[name]
            self._write(views)
