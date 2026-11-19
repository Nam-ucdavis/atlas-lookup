"""Viewer captures from the camera button: saved as PNGs, either with the name and folder
chosen in the Save image dialog, or (no name given) as image/<date_time>.png."""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime
from pathlib import Path

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_BYTES = 20 * 1024 * 1024


def save_png(data: bytes, folder: Path, now: datetime | None = None) -> Path:
    """Write data to folder/YYYY-MM-DD_HH-MM-SS.png (a _2, _3 ... suffix if that
    second is taken). The name comes from the clock, never from the request."""
    if not data.startswith(PNG_MAGIC):
        raise ValueError("Not a PNG image")
    folder.mkdir(parents=True, exist_ok=True)
    stamp = (now or datetime.now()).strftime("%Y-%m-%d_%H-%M-%S")
    path, n = folder / f"{stamp}.png", 2
    while path.exists():
        path, n = folder / f"{stamp}_{n}.png", n + 1
    path.write_bytes(data)
    return path


MAX_NAME = 120


class Exists(FileExistsError):
    """The chosen file is already there (the dialog then asks before replacing it)."""


def clean_name(name: str) -> str:
    """A file name from the dialog: no folders, no hidden files, no control characters;
    '.png' is added (or kept)."""
    n = " ".join(str(name or "").split())
    if n.lower().endswith(".png"):
        n = n[:-4].rstrip()
    if not n or n.startswith(".") or any(c in n for c in '/\\:') or any(ord(c) < 32 for c in n) or len(n) > MAX_NAME:
        raise ValueError("Use a plain file name: no slashes or colons, not starting with a dot")
    return n + ".png"


def save_named_png(data: bytes, folder: str, name: str, overwrite: bool = False,
                   keep_out: Path | None = None) -> Path:
    """Write data to folder/name.png. The folder must already exist; `keep_out` (the
    results folder, which stays read-only) and anything inside it are refused."""
    if not data.startswith(PNG_MAGIC):
        raise ValueError("Not a PNG image")
    d = Path(folder).expanduser()
    if not d.is_absolute():
        raise ValueError("Choose a full folder path")
    d = d.resolve()
    if not d.is_dir():
        raise ValueError("That folder does not exist")
    if keep_out is not None and d.is_relative_to(keep_out.resolve()):
        raise ValueError("The results folder stays read-only: choose another folder")
    path = d / clean_name(name)
    if path.exists() and not overwrite:
        raise Exists(path)
    path.write_bytes(data)
    return path


def reveal(path: Path) -> None:
    """Show the saved file in the file manager (the server runs on the user's own
    machine, bound to 127.0.0.1). Best effort: a missing tool is not an error."""
    if sys.platform == "darwin":
        cmd = ["open", "-R", str(path)]  # Finder, with the file selected
    elif sys.platform == "win32":
        cmd = ["explorer", f"/select,{path}"]
    else:
        cmd = ["xdg-open", str(path.parent)]
    try:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        pass
