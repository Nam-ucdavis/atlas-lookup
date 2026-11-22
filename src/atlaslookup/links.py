"""Links between a volumetric stat map and its fsLR (CIFTI) version.

The same analysis often exists twice: an SPM volume (spmT_0001.nii) and a surface-based
CIFTI file (x.dscalar.nii). Their names rarely say which goes with which (e.g. which of
two permutation schemes, or which contrast), so pairs are set by the user, never
guessed. suggest() only orders candidates for the picker, by shared name parts.

Stored in DATA_DIR/links.json (never in the results folder): a list of
{"volume": <NIfTI map id>, "surface": <CIFTI map id, x.dscalar.nii/map<k>.nii>}.
A CIFTI map id links its whole file: any map of the file finds the volume.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

from .cifti import CIFTI_PATTERN, split_id


def cifti_file(map_id: str) -> str | None:
    """`a/x.dscalar.nii/map2.nii` -> `a/x.dscalar.nii`; None for a NIfTI map id."""
    sub = split_id(Path(map_id))
    return sub[0].as_posix() if sub else None


class LinkStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    def all(self) -> list[dict]:
        if not self.path.exists():
            return []
        data = json.loads(self.path.read_text())
        if not isinstance(data, list):
            raise ValueError(f"{self.path} is not a list of links")
        return [x for x in data if isinstance(x, dict) and "volume" in x and "surface" in x]

    def _write(self, links: list[dict]):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".links-")
        with os.fdopen(fd, "w") as fh:
            json.dump(links, fh, indent=1)
        os.replace(tmp, self.path)

    def partners(self, map_id: str) -> list[str]:
        """The other side of every link this map is in."""
        f = cifti_file(map_id)
        if f:
            return [x["volume"] for x in self.all() if cifti_file(x["surface"]) == f]
        return [x["surface"] for x in self.all() if x["volume"] == map_id]

    def add(self, volume: str, surface: str) -> dict:
        if cifti_file(volume) or not cifti_file(surface):
            raise ValueError("A link joins a volumetric map (.nii) and a CIFTI map (.dscalar.nii)")
        links = [x for x in self.all() if not (x["volume"] == volume and cifti_file(x["surface"]) == cifti_file(surface))]
        link = {"volume": volume, "surface": surface}
        links.append(link)
        self._write(links)
        return link

    def remove(self, volume: str, surface: str) -> bool:
        links = self.all()
        keep = [x for x in links if not (x["volume"] == volume and cifti_file(x["surface"]) == cifti_file(surface))]
        if len(keep) != len(links):
            self._write(keep)
        return len(keep) != len(links)


_SPLIT = re.compile(r"[/_.\-\s]+")
SKIP_VOLUME = re.compile(r"^(RPV|ResMS|mask|beta_\d+)\.nii(\.gz)?$", re.IGNORECASE)
_NOISE = {"nii", "dscalar", "map", "spmt", "group", "b", "t", "win", "0001", "0002", "map1", "1", "2", "3", "4", "5"}


def _tokens(map_id: str) -> set[str]:
    return {t for t in _SPLIT.split(map_id.lower()) if t and t not in _NOISE}


def suggest(map_id: str, candidates: list[dict], limit: int = 8) -> list[str]:
    """Candidate ids of the other kind, most similar names first. Shared name parts
    count more the rarer they are among the candidates (so a rare word outweighs a common one like "f1"),
    and a part glued into a longer one (e.g. "regx" in "ModelRegXRegY") counts too.
    Only an ordering for the picker: links are always the user's choice."""
    import math

    want_cifti = not cifti_file(map_id)
    pool = []
    for c in candidates:
        cid = c["id"]
        if bool(cifti_file(cid)) != want_cifti:
            continue
        name = cid.rsplit("/", 1)[-1]
        if not want_cifti and SKIP_VOLUME.match(name):  # SPM's side files are never the partner
            continue
        pool.append((c, cid, name, _tokens(cid)))
    if not pool:
        return []
    df: dict[str, int] = {}
    for *_, toks in pool:
        for t in toks:
            df[t] = df.get(t, 0) + 1
    weight = lambda t: math.log((len(pool) + 1) / (df.get(t, 0) + 0.5))
    mine, low = _tokens(map_id), map_id.lower()
    scored = []
    for c, cid, name, theirs in pool:
        score = sum(weight(t) for t in mine & theirs)
        score += 0.5 * sum(weight(t) for t in theirs - mine if len(t) >= 2 and t in low)
        score += 0.5 * sum(weight(t) for t in mine - theirs if len(t) >= 2 and t in cid.lower())
        if want_cifti:
            score += 0.25 if c.get("cifti", {}).get("map") == 1 else 0  # a file's t map before its p maps
        else:
            score += 1.0 if name.lower().startswith("spmt") else -1.0  # T maps first
        scored.append((score, cid))
    scored.sort(key=lambda x: (-x[0], x[1]))
    out, files = [], set()
    for sc, cid in scored:
        f = cifti_file(cid)
        if sc <= 0 or (f and f in files):  # one suggestion per CIFTI file (its best map)
            continue
        files.add(f)
        out.append(cid)
        if len(out) == limit:
            break
    return out


__all__ = ["LinkStore", "suggest", "cifti_file", "CIFTI_PATTERN"]
