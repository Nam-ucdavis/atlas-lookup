"""Viewer captures from the "scr" button, saved as PNGs named by date and time."""
from __future__ import annotations

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
