"""Atlas Lookup: which brain region is this coordinate in?

  atlaslookup                     start the app and open it in your browser
                                  (first run downloads the atlases)
  setup                           download + register the built-in atlases
  serve [--port 8765] [--open]    run the web app
  info                            version, data folder, atlases, results folder
  query X Y Z [--voxel --grid ID] look up a coordinate from the terminal
  list                            show registered atlases and grids
  add ...                         register an atlas from a paper (NIfTI + labels)
  add-grid ID IMAGE               register a voxel grid from any NIfTI on that grid
  set-results DIR                 where your spmT maps live (saved in your data folder)
  maps                            list the spmT maps in your results folder
  clusters MAP [--threshold 3]    labelled cluster/peak table for one map (--csv for a file)
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
import urllib.request
import webbrowser

from . import __version__
from .atlas import add_atlas, load_atlases
from .config import ATLASES_DIR, DATA_DIR, IMAGE_DIR, TEMPLATE_FILE
from .grids import grid_from_image, load_grids, save_grid
from .query import best_guess, query, resolve_mm


def main(argv=None):
    p = argparse.ArgumentParser(prog="atlaslookup", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--version", action="version", version=f"atlaslookup {__version__}")
    sub = p.add_subparsers(dest="cmd")

    for name in ("setup", "bootstrap"):  # "bootstrap" kept for older docs
        b = sub.add_parser(name, help="download and register built-in atlases" if name == "setup" else argparse.SUPPRESS)
        b.add_argument("--overwrite", action="store_true", help="re-download and replace existing atlases")

    s = sub.add_parser("serve", help="run the web app")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--results", help="folder with spmT maps (overrides set-results for this run)")
    s.add_argument("--open", action="store_true", help="open the app in your browser")

    sub.add_parser("info", help="show version, data folder, atlases and results folder")

    r = sub.add_parser("set-results", help="remember where your spmT maps live")
    r.add_argument("folder")

    sub.add_parser("maps", help="list the spmT maps in your results folder")

    c = sub.add_parser("clusters", help="labelled cluster/peak table for one spmT map")
    c.add_argument("map", help="map id from `atlaslookup maps`, or a path to an spmT file")
    c.add_argument("--threshold", type=float, default=3.0, help="|T| threshold (default 3)")
    c.add_argument("--sign", default="both", choices=["pos", "neg", "both"])
    c.add_argument("--k", type=int, default=5, help="minimum cluster size in voxels (default 5)")
    c.add_argument("--csv", action="store_true", help="print CSV instead of a table")

    q = sub.add_parser("query", help="look up one coordinate")
    q.add_argument("xyz", nargs=3, type=float)
    q.add_argument("--voxel", action="store_true", help="xyz are voxel indices on --grid")
    q.add_argument("--grid", help="reference grid id (see `list`)")
    q.add_argument("--base", type=int, default=1, choices=[0, 1],
                   help="voxel index base: 1 = SPM/MATLAB (default), 0 = Python/FSL")
    q.add_argument("--radius", type=float, default=4.0, help="neighbourhood radius in mm")

    sub.add_parser("list", help="list atlases and grids")

    a = sub.add_parser("add", help="register an atlas from files")
    a.add_argument("--id", required=True, help="short slug, e.g. glasser2016")
    a.add_argument("--name", required=True)
    a.add_argument("--labels", required=True, help=".tsv/.csv/.txt/.xml label file")
    a.add_argument("--map", dest="label_map", help="3D integer parcellation NIfTI")
    a.add_argument("--prob", dest="prob_map", help="4D probabilistic NIfTI (vol v = label v+1)")
    a.add_argument("--space", required=True, help="template space, e.g. MNI152NLin6Asym")
    a.add_argument("--kind", default="functional", choices=["functional", "anatomical"])
    a.add_argument("--lateralize", action="store_true",
                   help="labels are bilateral; prefix Left/Right from x")
    a.add_argument("--citation", default="")
    a.add_argument("--doi", default="")
    a.add_argument("--url", default="")
    a.add_argument("--description", default="")
    a.add_argument("--order", type=int, default=100, help="display order (lower = higher up)")
    a.add_argument("--role", default="", help='summary-strip label, e.g. "Brodmann area"')
    a.add_argument("--overwrite", action="store_true")

    g = sub.add_parser("add-grid", help="register a voxel grid from a NIfTI")
    g.add_argument("id")
    g.add_argument("image")
    g.add_argument("--name", help="display name")
    g.add_argument("--space", default="MNI152NLin2009cAsym")

    args = p.parse_args(argv)
    if args.cmd is None:  # plain `atlaslookup`: start and open the browser
        args = p.parse_args(["serve", "--open", *(argv or [])])

    if args.cmd in ("setup", "bootstrap"):
        from .sources import bootstrap
        print(f"Setting up atlases in {DATA_DIR}")
        bootstrap(overwrite=args.overwrite)

    elif args.cmd == "info":
        from .results import configured_dir
        from .version import version_info
        atl, grids = load_atlases(preload=False), load_grids()
        rd = configured_dir()
        print(f"atlaslookup {version_info()['label']}")
        print(f"  data folder:    {DATA_DIR}")
        print(f"  atlases:        {len(atl)}" + ("" if atl else "  (run `atlaslookup setup`)"))
        print(f"  grids:          {', '.join(grids) or 'none'}")
        print(f"  viewer template: {'yes' if TEMPLATE_FILE.exists() else 'missing (run `atlaslookup setup`)'}")
        print(f"  results folder: {rd or 'not set (atlaslookup set-results DIR)'}")
        print(f"  image folder:   {IMAGE_DIR}")

    elif args.cmd == "set-results":
        from .results import Results, repo_warning, save_results_dir
        p = save_results_dir(args.folder)
        print(f"Results folder: {p}  ({len(Results(p).list())} spmT maps)")
        if w := repo_warning(p):
            print(f"  warning: {w}")

    elif args.cmd == "serve":
        import os

        import uvicorn
        url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '::') else args.host}:{args.port}"
        if _port_in_use(args.host, args.port):
            if _is_atlaslookup(url):
                print(f"Atlas Lookup is already running at {url}")
                if args.open:
                    webbrowser.open(url)
                return
            sys.exit(f"Port {args.port} is used by another program; try --port {args.port + 1}")
        if not _is_set_up():
            from .sources import bootstrap
            print(f"First run: downloading atlases into {DATA_DIR} (one time, about 90 MB).")
            bootstrap()
        elif not (ATLASES_DIR / "xtract-hcp" / "atlas.json").exists():
            print("  new: white-matter tracts (JHU, XTRACT). Run `atlaslookup setup` once to add them (~50 MB from FSL).")
        if args.results:
            os.environ["ATLAS_RESULTS_DIR"] = args.results
        from .results import configured_dir, repo_warning
        if (rd := configured_dir()):
            print(f"Results folder: {rd}")
            if w := repo_warning(rd):
                print(f"  warning: {w}")
        from .version import version_info
        print(f"Atlas lookup {version_info()['label']} at http://{args.host}:{args.port}")
        if args.host not in ("127.0.0.1", "localhost"):
            print("  note: listening beyond this machine; your results are viewable by anyone who can reach it")
        if args.open:
            _open_when_ready(url)
        # Remembered so the version menu can restart this server with the same options.
        os.environ["ATLASLOOKUP_SERVE"] = json.dumps({"host": args.host, "port": args.port, "results": args.results})
        uvicorn.run("atlaslookup.server:app", host=args.host, port=args.port)

    elif args.cmd == "maps":
        from .results import Results, configured_dir
        res = Results(configured_dir())
        if not res.available:
            sys.exit("No results folder set; run `atlaslookup set-results DIR`")
        for m in res.list():
            print(f"  {m['id']}\n      {m['contrast']}  (df {m['df']})")

    elif args.cmd == "clusters":
        _print_clusters(args)

    elif args.cmd == "query":
        grids = load_grids()
        grid = grids.get(args.grid) if args.grid else None
        if args.grid and grid is None:
            sys.exit(f"Unknown grid {args.grid!r}; have {list(grids)}")
        where = resolve_mm(args.xyz, "voxel" if args.voxel else "mm", grid, args.base)
        x, y, z = where["mm"]
        print(f"MNI ({x:g}, {y:g}, {z:g}) mm", end="")
        if "voxel" in where:
            print(f"  |  voxel {tuple(where['voxel'])} on {where['grid']} ({args.base}-based)", end="")
        print()
        for r in query(load_atlases(), where["mm"], radius_mm=args.radius):
            print(f"  {r['atlas']['name']:<42} {best_guess(r) or '—'}")

    elif args.cmd == "list":
        for at in load_atlases(preload=False).values():
            m = at.manifest
            maps = "+".join(k for k, v in [("label", m.has_label_map), ("prob", m.has_prob_map)] if v)
            print(f"  {m.id:<28} {m.name:<44} {m.space:<20} {maps}")
        print("Grids:")
        for gr in load_grids().values():
            print(f"  {gr.id:<28} {gr.name:<44} {gr.space:<20} {gr.shape} @ {gr.voxel_size} mm")

    elif args.cmd == "add":
        fields = {k: getattr(args, k) for k in
                  ["kind", "lateralize", "citation", "doi", "url", "description", "order", "role"]}
        folder = add_atlas(args.id, args.name, args.space, args.labels,
                           label_map=args.label_map, prob_map=args.prob_map,
                           overwrite=args.overwrite, **fields)
        print(f"Registered {args.id} -> {folder}")

    elif args.cmd == "add-grid":
        gr = grid_from_image(args.image, args.id, args.name or args.id, args.space)
        print(f"Registered grid {gr.id}: {gr.shape} @ {gr.voxel_size} mm -> {save_grid(gr)}")


def _print_clusters(args) -> None:
    """Same table as the web app: clusters, peaks, and atlas labels at each peak."""
    import csv
    from pathlib import Path

    from .results import Results, configured_dir

    path = Path(args.map).expanduser()
    if path.is_file():  # a file given directly: read it from its own folder
        res, map_id = Results(path.parent), path.name
    else:
        res, map_id = Results(configured_dir()), args.map
    try:
        table = res.clusters(map_id, args.threshold, args.sign, args.k)
    except FileNotFoundError:
        sys.exit(f"No spmT map {args.map!r}; see `atlaslookup maps`")
    atlases = load_atlases()
    cols = [i for i in ("harvard-oxford-cort", "harvard-oxford-sub", "juelich", "talairach-ba") if i in atlases]
    rows = []
    for n, cl in enumerate(table["clusters"], 1):
        labels = {r["atlas"]["id"]: best_guess(r) or "" for r in query(atlases, cl["peak_mm"], radius_mm=5, only=cols)}
        rows.append([n, cl["sign"], cl["voxels"], cl["peak_t"], f"{cl['peak_p']:.2g}" if cl["peak_p"] else "",
                     *[int(round(v)) for v in cl["peak_mm"]], *[labels.get(i, "") for i in cols]])
    header = ["cluster", "sign", "voxels", "peak_t", "p_unc", "x", "y", "z", *[atlases[i].manifest.role for i in cols]]
    if args.csv:
        w = csv.writer(sys.stdout)
        w.writerow(header)
        w.writerows(rows)
        return
    print(f"{table['contrast']} (df {table['df']}): {table['n_clusters']} clusters at "
          f"|T| >= {args.threshold} ({args.sign}), k >= {args.k}; p uncorrected, one-sided")
    for r in rows:
        print(f"  {r[0]:>2} {'+' if r[1] == 'pos' else '-'} {r[2]:>5} vox  T={r[3]:>6.2f}  p={r[4]:<8} "
              f"({r[5]}, {r[6]}, {r[7]})")
        for role, label in zip(header[8:], r[8:]):
            if label:
                print(f"        {role}: {label}")


def _is_set_up() -> bool:
    return TEMPLATE_FILE.exists() and any(ATLASES_DIR.glob("*/atlas.json"))


def _port_in_use(host: str, port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1" if host in ("0.0.0.0", "::") else host, port)) == 0


def _is_atlaslookup(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/api/version", timeout=2) as r:
            return "version" in json.load(r)
    except (OSError, ValueError):
        return False


def _open_when_ready(url: str) -> None:
    import threading
    import time

    def wait_and_open():
        for _ in range(100):
            if _is_atlaslookup(url):
                webbrowser.open(url)
                return
            time.sleep(0.2)

    threading.Thread(target=wait_and_open, daemon=True).start()


if __name__ == "__main__":
    main()
