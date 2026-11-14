"""Tags: named points ("dmFC" at a peak), kept per stat map in DATA_DIR/tags.json.

Your results folder is only ever read, so tags live here, in your data folder, not
beside the maps. A tag remembers its map by the map's path in the results folder and
by a hash of the file's contents, so it stays with the map when the results folder
moves or the map is renamed (and the same map in two places shares its tags). Tags made
with no stat map open belong to no map.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import secrets
import tempfile
import threading
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

MAX_LABEL = 80
MAX_NOTE = 2000
_lock = threading.Lock()


@lru_cache(maxsize=512)
def _sha256(path: str, size: int, mtime: float) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def file_key(path: Path) -> str:
    """The content hash of a map file (cached while the file is unchanged)."""
    st = path.stat()
    return _sha256(str(path), st.st_size, st.st_mtime)


def _clean_label(text) -> str:
    label = " ".join(str(text or "").split())[:MAX_LABEL]
    if not label:
        raise ValueError("A tag needs a name")
    return label


def _clean_mm(mm) -> list[float]:
    try:
        v = [round(float(x), 2) for x in mm]
    except (TypeError, ValueError):
        raise ValueError("mm must be three numbers")
    if len(v) != 3 or any(abs(x) > 1000 for x in v):
        raise ValueError("mm must be three numbers")
    return v


class TagStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    def _read(self) -> list[dict]:
        try:
            data = json.loads(self.path.read_text())
        except FileNotFoundError:
            return []
        except (OSError, ValueError):
            raise ValueError(f"{self.path} is not readable JSON; fix or move it")
        return list(data.get("tags", []))

    def _write(self, tags: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".tags-", suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump({"version": 1, "tags": tags}, f, indent=1)
            f.write("\n")
        os.replace(tmp, self.path)  # never a half-written file

    def all(self) -> list[dict]:
        with _lock:
            return self._read()

    def add(self, label, mm, map_id: str | None = None, map_key: str | None = None, note: str = "") -> dict:
        tag = {
            "id": "t" + secrets.token_hex(6),
            "label": _clean_label(label),
            "mm": _clean_mm(mm),
            "map": map_id or None,
            "map_sha256": map_key or None,
            "note": str(note or "")[:MAX_NOTE],
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        with _lock:
            tags = self._read()
            tags.append(tag)
            self._write(tags)
        return tag

    def update(self, tag_id: str, **changes) -> dict:
        with _lock:
            tags = self._read()
            for t in tags:
                if t["id"] == tag_id:
                    if "label" in changes:
                        t["label"] = _clean_label(changes["label"])
                    if "note" in changes:
                        t["note"] = str(changes["note"] or "")[:MAX_NOTE]
                    if "mm" in changes:
                        t["mm"] = _clean_mm(changes["mm"])
                    self._write(tags)
                    return t
        raise KeyError(tag_id)

    def delete(self, tag_id: str) -> None:
        with _lock:
            tags = self._read()
            keep = [t for t in tags if t["id"] != tag_id]
            if len(keep) == len(tags):
                raise KeyError(tag_id)
            self._write(keep)


def belongs(tag: dict, map_id: str | None, map_key: str | None) -> bool:
    """Whether a tag is one of this map's (same contents, or same path), or, with no map,
    one made with no map open."""
    if not map_id:
        return not tag.get("map")
    return bool((map_key and tag.get("map_sha256") == map_key) or tag.get("map") == map_id)


def to_csv(tags: list[dict], labels=lambda mm: {}) -> str:
    """Tags as CSV; labels(mm) adds columns (e.g. the region at each point)."""
    rows = [(t, labels(t["mm"])) for t in tags]
    extra = list(dict.fromkeys(k for _, lab in rows for k in lab))
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["label", "x", "y", "z", "map", "note", "created", *extra])
    for t, lab in rows:
        w.writerow([t["label"], *t["mm"], t.get("map") or "", t.get("note", ""), t.get("created", ""),
                    *[lab.get(k, "") for k in extra]])
    return out.getvalue()
