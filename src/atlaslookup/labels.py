"""Read region-label files in the formats papers usually ship them in.

Every reader returns {integer image value: region name}. Value 0 is
treated as background and dropped.

Supported:
  .tsv / .csv   columns "index" and "name" (header optional)
  .txt / .lut   one region per line, either "<int> <name> [...]" (FreeSurfer
                / Schaefer LUT style) or just "<name>" (line n -> value n)
  .xml          FSL atlas XML; <label index="i"> maps to image value i + 1
"""
from __future__ import annotations

import csv
import re
import xml.etree.ElementTree as ET
from pathlib import Path


def read_labels(path: str | Path) -> dict[int, str]:
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in (".tsv", ".csv"):
        labels = _read_table(path, "\t" if suffix == ".tsv" else ",")
    elif suffix == ".xml":
        labels = _read_fsl_xml(path)
    else:
        labels = _read_text(path)
    labels.pop(0, None)
    if not labels:
        raise ValueError(f"No labels found in {path}")
    return labels


def write_labels_tsv(labels: dict[int, str], path: str | Path) -> None:
    with open(path, "w", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(["index", "name"])
        for idx in sorted(labels):
            w.writerow([idx, labels[idx]])


def _read_table(path: Path, delimiter: str) -> dict[int, str]:
    with open(path, newline="") as f:
        rows = [r for r in csv.reader(f, delimiter=delimiter) if r]
    header = [c.strip().lower() for c in rows[0]]
    if "index" in header and "name" in header:
        i_idx, i_name = header.index("index"), header.index("name")
        rows = rows[1:]
    else:
        i_idx, i_name = 0, 1
        if not rows[0][0].strip().lstrip("-").isdigit():
            rows = rows[1:]
    return {int(r[i_idx]): r[i_name].strip() for r in rows}


def _read_text(path: Path) -> dict[int, str]:
    lines = [ln.strip() for ln in path.read_text().splitlines()]
    lines = [ln for ln in lines if ln and not ln.startswith("#")]
    if not all(re.match(r"^\d+\s+\S", ln) for ln in lines):
        return {i + 1: ln for i, ln in enumerate(lines)}
    labels = {}
    for ln in lines:
        if "\t" in ln:
            # Tab-separated LUT: index, name, then optional colour columns.
            idx, name = ln.split("\t")[:2]
        else:
            idx, name = ln.split(None, 1)
            # Drop a trailing R G B [A] colour block, if present.
            name = re.sub(r"(\s+\d{1,3}){3,4}$", "", name)
        labels[int(idx)] = name.strip()
    return labels


def _read_fsl_xml(path: Path) -> dict[int, str]:
    root = ET.parse(path).getroot()
    return {
        int(el.get("index")) + 1: (el.text or "").strip()
        for el in root.iter("label")
    }
