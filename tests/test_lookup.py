from pathlib import Path

import numpy as np
import nibabel as nib
import pytest

from atlaslookup.atlas import Atlas, add_atlas
from atlaslookup.config import ATLASES_DIR
from atlaslookup.destrieux_names import NAMES, readable
from atlaslookup.grids import Grid
from atlaslookup.labels import read_labels
from atlaslookup.query import best_guess, resolve_mm

AFFINE_2MM = np.array([[2, 0, 0, -10], [0, 2, 0, -10], [0, 0, 2, -10], [0, 0, 0, 1]], float)


# --- label files -----------------------------------------------------------------

def test_label_formats(tmp_path):
    (tmp_path / "a.tsv").write_text("index\tname\n0\tBackground\n1\tAlpha\n2\tBeta\n")
    (tmp_path / "b.txt").write_text("1\t7Networks_LH_Vis_1\t120\t18\t131\t0\n2\t7Networks_LH_Vis_2\t120\t18\t132\t0\n")
    (tmp_path / "c.txt").write_text("Alpha\nBeta\n")
    (tmp_path / "d.txt").write_text("1 Area 44 255 0 0 0\n2 Area 45 0 255 0 0\n")
    (tmp_path / "e.xml").write_text('<atlas><data><label index="0" x="1">Alpha</label><label index="1">Beta</label></data></atlas>')
    assert read_labels(tmp_path / "a.tsv") == {1: "Alpha", 2: "Beta"}
    assert read_labels(tmp_path / "b.txt") == {1: "7Networks_LH_Vis_1", 2: "7Networks_LH_Vis_2"}
    assert read_labels(tmp_path / "c.txt") == {1: "Alpha", 2: "Beta"}
    assert read_labels(tmp_path / "d.txt") == {1: "Area 44", 2: "Area 45"}
    assert read_labels(tmp_path / "e.xml") == {1: "Alpha", 2: "Beta"}


# --- grids -----------------------------------------------------------------------

def test_grid_one_based_matches_spm():
    # The lab's 3 mm SPM grid: voxel (1,1,1) in MATLAB is the affine origin.
    g = Grid("g", "g", "MNI152NLin2009cAsym", [53, 65, 56],
             [[3, 0, 0, -78], [0, 3, 0, -114], [0, 0, 3, -78], [0, 0, 0, 1]])
    assert g.voxel_to_mm([1, 1, 1], base=1).tolist() == [-78, -114, -78]
    assert g.voxel_to_mm([0, 0, 0], base=0).tolist() == [-78, -114, -78]
    assert g.mm_to_voxel([0, 0, 6], base=1).tolist() == [27, 39, 29]
    assert g.in_bounds([53, 65, 56], base=1) and not g.in_bounds([53, 65, 56], base=0)
    r = resolve_mm([27, 39, 29], "voxel", g, base=1)
    assert r["mm"] == [0, 0, 6]
    with pytest.raises(ValueError):
        resolve_mm([1.5, 2, 3], "voxel", g)


# --- synthetic atlas -------------------------------------------------------------

@pytest.fixture
def toy_atlas(tmp_path):
    """11^3 grid at 2 mm, origin at voxel (5,5,5). Label 1 fills x<0, label 2 a
    block at x>=4 mm; the x in [0, 2] mm slab is unlabelled."""
    lab = np.zeros((11, 11, 11), np.int16)
    lab[:5] = 1
    lab[7:] = 2
    prob = np.zeros((11, 11, 11, 2), np.float32)
    prob[:5, ..., 0] = 0.8
    prob[:5, ..., 1] = 0.1
    prob[7:, ..., 1] = 0.6
    folder = add_atlas(
        "toy", "Toy", "MNI152NLin6Asym", {1: "Alpha", 2: "Beta"},
        label_map=nib.Nifti1Image(lab, AFFINE_2MM),
        prob_map=nib.Nifti1Image(prob, AFFINE_2MM),
        atlases_dir=tmp_path, lateralize=True,
    )
    return Atlas(folder)


def test_label_and_probability(toy_atlas):
    r = toy_atlas.lookup([-4, 0, 0], radius_mm=0)
    assert r["label"] == {"value": 1, "name": "Left Alpha"}
    assert r["probabilities"][0] == {"value": 1, "name": "Left Alpha", "p": 0.8}
    assert r["probabilities"][1]["p"] == 0.1
    assert best_guess(r) == "Left Alpha (80%)"


def test_gap_reports_nearest(toy_atlas):
    r = toy_atlas.lookup([0, 0, 0], radius_mm=4)
    assert r["label"] is None
    assert r["nearest"]["distance_mm"] == 2.0
    assert best_guess(r).startswith("near Left Alpha")
    names = {n["name"]: n["fraction"] for n in r["neighborhood"]}
    assert "(unlabelled)" in names and "Left Alpha" in names and "Right Beta" in names
    assert abs(sum(names.values()) - 1) < 1e-6


def test_out_of_bounds(toy_atlas):
    r = toy_atlas.lookup([100, 0, 0])
    assert r["in_bounds"] is False and "label" not in r


def test_mm_transform_applied(tmp_path):
    # Shift queries by +4 mm in x: MNI x=-4 should sample atlas x=0 (unlabelled).
    lab = np.zeros((11, 11, 11), np.int16)
    lab[:5] = 1
    shift = [[1, 0, 0, 4], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    a = Atlas(add_atlas("shifted", "S", "Talairach", {1: "Alpha"}, label_map=nib.Nifti1Image(lab, AFFINE_2MM),
                        atlases_dir=tmp_path, mm_transform=shift))
    r = a.lookup([-4, 0, 0], radius_mm=0)
    assert r["atlas_mm"] == [0, 0, 0] and r["label"] is None
    assert a.lookup([-8, 0, 0], radius_mm=0)["label"]["name"] == "Alpha"
    # An MNI-space copy is made for drawing; it must agree with the transformed lookup.
    assert a.info()["can_overlay"] is True
    data, aff = a.mni_labels
    ijk = np.rint(np.linalg.inv(aff) @ [-8, 0, 0, 1])[:3].astype(int)
    assert data[tuple(ijk)] == 1
    ijk = np.rint(np.linalg.inv(aff) @ [-4, 0, 0, 1])[:3].astype(int)
    assert data[tuple(ijk)] == 0


def test_destrieux_readable():
    assert readable("L G_front_inf-Opercular") == "Left inferior frontal gyrus, opercular part"
    assert readable("R S_central") == "Right central sulcus"
    assert len(NAMES) == 75


def test_add_refuses_overwrite(toy_atlas, tmp_path):
    with pytest.raises(FileExistsError):
        add_atlas("toy", "Toy", "x", {1: "a"}, label_map=nib.Nifti1Image(np.ones((2, 2, 2), np.int16), AFFINE_2MM),
                  atlases_dir=tmp_path)


# --- real atlases (after `python -m atlaslookup bootstrap`) ----------------------

bootstrapped = pytest.mark.skipif(not (ATLASES_DIR / "juelich" / "atlas.json").exists(),
                                  reason="run `python -m atlaslookup bootstrap` first")


@bootstrapped
@pytest.mark.parametrize("xyz, atlas_id, expect", [
    ((-22, -4, -18), "harvard-oxford-sub", "Left Amygdala"),
    ((-8, -90, 4), "juelich", "V1"),
    ((-44, 18, 24), "harvard-oxford-cort", "Left Inferior Frontal Gyrus, pars opercularis"),
    ((44, 18, 24), "harvard-oxford-cort", "Right Inferior Frontal Gyrus, pars opercularis"),
    ((2, -52, 26), "harvard-oxford-cort", "Right Cingulate Gyrus, posterior division"),
    ((-8, -90, 4), "talairach-ba", "Brodmann area 17"),
    ((52, -30, 10), "talairach-ba", "Right Brodmann area 41"),
    ((-38, -22, 56), "destrieux2009", "Left precentral gyrus"),
    ((52, -30, 10), "destrieux2009", "Right planum temporale"),
])
def test_known_coordinates(xyz, atlas_id, expect):
    from fastapi.testclient import TestClient
    from atlaslookup.server import app

    res = TestClient(app).get("/api/lookup", params=dict(zip("xyz", xyz), atlases=atlas_id)).json()
    assert expect in res["results"][0]["best_guess"]


@bootstrapped
def test_viewer_endpoints():
    from fastapi.testclient import TestClient
    from atlaslookup.server import app

    c = TestClient(app)
    assert c.get("/api/template.nii.gz").status_code == 200
    assert c.get("/api/atlases/harvard-oxford-cort/label_map.nii.gz").status_code == 200
    cm = c.get("/api/atlases/harvard-oxford-cort/colormap").json()
    assert len(cm["R"]) == len(cm["I"]) == len(cm["labels"]) == 49 and cm["A"][0] == 0
    # Talairach atlases are served as their MNI-resampled copy.
    assert c.get("/api/atlases/talairach-ba/label_map.nii.gz").status_code == 200
    assert c.get("/api/atlases/nope/label_map.nii.gz").status_code == 404


# --- quiz ------------------------------------------------------------------------

@bootstrapped
def test_quiz_points_land_in_their_region():
    """Every quizzable region yields a point whose lookup returns that region,
    on the asked side, so the quiz can never contradict the lookup view."""
    import numpy as np
    from fastapi.testclient import TestClient
    from atlaslookup.server import app

    c = TestClient(app)
    rng = np.random.default_rng(1)
    for atlas in c.get("/api/quiz/regions").json():
        regions = atlas["regions"]
        assert len(regions) > 10, atlas["atlas"]
        for r in [regions[i] for i in rng.choice(len(regions), 8, replace=False)]:
            for side in r["sides"]:
                p = c.get("/api/quiz/point", params=dict(atlas=atlas["atlas"], value=r["value"], side=side)).json()
                x, y, z = p["mm"]
                assert side == "B" or (x < 0) == (side == "L")
                res = c.get("/api/lookup", params=dict(x=x, y=y, z=z, radius=0, atlases=atlas["atlas"])).json()
                assert res["results"][0]["label"]["value"] == r["value"]
                m = c.get(f"/api/quiz/mask/{atlas['atlas']}/{r['value']}/{side}.nii.gz")
                assert m.status_code == 200 and m.content[:2] == b"\x1f\x8b"


@bootstrapped
def test_quiz_excludes_non_regions():
    from fastapi.testclient import TestClient
    from atlaslookup.server import app

    names = {a["atlas"]: [r["name"] for r in a["regions"]]
             for a in TestClient(app).get("/api/quiz/regions").json()}
    assert not any("White Matter" in n or "Ventric" in n for n in names["harvard-oxford-sub"])
    assert not any(n.startswith("WM ") or n.startswith("GM ") for n in names["juelich"])
    assert all(n.startswith("Brodmann area") for n in names["talairach-ba"])


def test_quiz_answer_matching():
    """Runs the browser's matcher (static/quiz.js) under node."""
    import shutil
    import subprocess
    from pathlib import Path

    if not shutil.which("node"):
        pytest.skip("node not installed")
    import atlaslookup

    quiz_js = Path(atlaslookup.__file__).parent / "static" / "quiz.js"
    cases = [
        ("inferior frontal gyrus pars opercularis", "Inferior Frontal Gyrus, pars opercularis", "ok"),
        ("IFG pars opercularis", "Inferior Frontal Gyrus, pars opercularis", "ok"),
        ("inferior frontal gyrus", "Inferior Frontal Gyrus, pars opercularis", "close"),
        ("precentral gyrus", "Postcentral Gyrus", "close"),
        ("amygdala", "Left Amygdala", "ok"),
        ("left amygdla", "Left Amygdala", "ok"),
        ("thalamus", "Left Amygdala", "bad"),
        ("BA 44", "Brodmann area 44", "ok"),
        ("44", "Brodmann area 44", "ok"),
        ("45", "Brodmann area 44", "bad"),
        ("Broca's area BA44", "Broca's area BA44", "ok"),
        ("", "Postcentral Gyrus", "bad"),
    ]
    script = (f"import {{ matchName }} from {str(quiz_js)!r};"
              f"const cases = {[list(c) for c in cases]!r};"
              "const bad = cases.filter(([a, n, want]) => matchName(a, n) !== want)"
              ".map(([a, n, want]) => `${a} vs ${n}: got ${matchName(a, n)}, want ${want}`);"
              "console.log(JSON.stringify(bad));")
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "[]", out.stdout



def test_overlay_t_distribution_matches_scipy():
    """The local-overlay p <-> T conversion (static/overlays.js) agrees with scipy."""
    import json
    import shutil
    import subprocess
    from pathlib import Path

    from scipy import stats

    if not shutil.which("node"):
        pytest.skip("node not installed")
    import atlaslookup

    js = Path(atlaslookup.__file__).parent / "static" / "overlays.js"
    ts = [(0.5, 3), (2.0, 10), (3.17, 24), (5.0, 24), (8.0, 120), (-2.0, 10), (12.0, 7.5)]
    ps = [(0.05, 10), (0.001, 24), (1e-6, 60), (0.01, 3.5)]
    headers = [{"description": "SPM{T_[24.0]} - faces > houses"},
               {"description": "", "intent_code": 3, "intent_p1": 18},
               {"description": "SPM{F_[1.0,24.0]}"}, {}]
    script = (f"import {{ tSf, tFromP, dfFromHeader }} from {str(js)!r};"
              f"console.log(JSON.stringify({{sf: {json.dumps(ts)}.map(([t, d]) => tSf(t, d)),"
              f" inv: {json.dumps(ps)}.map(([p, d]) => tFromP(p, d)),"
              f" df: {json.dumps(headers)}.map(dfFromHeader)}}));")
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    for (t, d), v in zip(ts, got["sf"]):
        assert v == pytest.approx(stats.t.sf(t, d), rel=1e-6, abs=1e-12), (t, d)
    for (p, d), v in zip(ps, got["inv"]):
        assert v == pytest.approx(stats.t.isf(p, d), rel=1e-6), (p, d)
    assert got["df"] == [24, 18, None, None]

@bootstrapped
def test_every_quiz_region_has_a_division():
    from fastapi.testclient import TestClient
    from atlaslookup.quiz import division
    from atlaslookup.server import app

    c = TestClient(app)
    divisions = c.get("/api/quiz/divisions").json()
    for a in c.get("/api/quiz/regions").json():
        for r in a["regions"]:
            assert r["division"] in divisions, (a["atlas"], r["name"], r["division"])
    assert division("Inferior Frontal Gyrus, pars triangularis") == "Frontal lobe"
    assert division("Angular Gyrus") == "Parietal lobe"
    assert division("Temporal Occipital Fusiform Cortex") == "Temporal lobe"
    assert division("Paracingulate Gyrus") == "Limbic system"
    assert division("Brodmann area 44") == "Frontal lobe"
    assert division("Brodmann area 28") == "Limbic system"
    assert division("Left Accumbens") == "Basal ganglia"


# --- stat maps (synthetic results folder; never your real data) ---------------------

@pytest.fixture
def results_dir(tmp_path):
    """Two fake SPM T maps on the lab 3 mm grid: one positive blob, one negative."""
    aff = np.array([[3, 0, 0, -78], [0, 3, 0, -114], [0, 0, 3, -78], [0, 0, 0, 1]], float)
    for name, sign in [("modelA", 1), ("modelB/sub", -1)]:
        d = np.zeros((53, 65, 56), np.float32)
        d[10:14, 30:34, 30:34] = sign * 4.0      # 64-voxel cluster
        d[11, 31, 31] = sign * 6.0               # its peak
        d[40, 40, 40] = 5.0                      # single voxel, below k
        d[0, 0, 0] = np.nan                      # SPM writes NaN outside the mask
        img = nib.Nifti1Image(d, aff)
        img.header["descrip"] = b"SPM{T_[25.0]} - contrast 1: test"
        (tmp_path / name).mkdir(parents=True)
        img.to_filename(str(tmp_path / name / "spmT_0001.nii"))
    (tmp_path / "modelA" / "notes.txt").write_text("not a map")
    return tmp_path


def test_results_list_value_clusters(results_dir):
    from atlaslookup.results import Results

    r = Results(results_dir)
    maps = {m["id"]: m for m in r.list()}
    assert set(maps) == {"modelA/spmT_0001.nii", "modelB/sub/spmT_0001.nii"}
    assert maps["modelA/spmT_0001.nii"]["df"] == 25.0
    assert maps["modelA/spmT_0001.nii"]["contrast"] == "contrast 1: test"

    peak_mm = [3 * 11 - 78, 3 * 31 - 114, 3 * 31 - 78]
    v = r.value("modelA/spmT_0001.nii", peak_mm)
    assert v["t"] == 6.0 and v["voxel"] == [12, 32, 32] and 0 < v["p"] < 1e-5

    c = r.clusters("modelA/spmT_0001.nii", threshold=3.0, sign="both", min_voxels=5)
    assert c["n_clusters"] == 1                      # single voxel dropped by k
    assert c["clusters"][0]["voxels"] == 64 and c["clusters"][0]["peak_mm"] == peak_mm
    assert r.clusters("modelA/spmT_0001.nii", 3.0, "neg")["n_clusters"] == 0
    neg = r.clusters("modelB/sub/spmT_0001.nii", 3.0, "neg")
    assert neg["n_clusters"] == 1 and neg["clusters"][0]["peak_t"] == -6.0
    assert c["max_abs_t"] == 6.0                     # NaN ignored

    # Which cluster (row of the table) a point falls in.
    edge_mm = [3 * 13 - 78, 3 * 33 - 114, 3 * 30 - 78]  # inside the blob, away from the peak
    assert r.cluster_at("modelA/spmT_0001.nii", edge_mm, 3.0, "both", 5) == 0
    assert r.cluster_at("modelA/spmT_0001.nii", [0, 0, 0], 3.0, "both", 5) is None
    single_mm = [3 * 40 - 78, 3 * 40 - 114, 3 * 40 - 78]  # dropped by k, so not a row
    assert r.cluster_at("modelA/spmT_0001.nii", single_mm, 3.0, "both", 5) is None
    assert r.cluster_at("modelA/spmT_0001.nii", single_mm, 3.0, "both", 1) == 1
    assert r.cluster_at("modelA/spmT_0001.nii", edge_mm, 5.0, "both", 1) is None  # below 5


def test_results_refuses_paths_outside_folder(results_dir):
    from atlaslookup.results import Results

    r = Results(results_dir / "modelB")
    for bad in ["../modelA/spmT_0001.nii", "/etc/passwd", "sub/../../modelA/notes.txt", "../modelA/notes.txt"]:
        with pytest.raises(FileNotFoundError):
            r.resolve(bad)
    assert r.resolve("sub/spmT_0001.nii").name == "spmT_0001.nii"


def test_results_api(results_dir, monkeypatch):
    from fastapi.testclient import TestClient
    from atlaslookup import server
    from atlaslookup.results import Results

    monkeypatch.setattr(server, "RESULTS", Results(results_dir))
    c = TestClient(server.app)
    assert len(c.get("/api/results").json()["maps"]) == 2
    assert c.get("/api/results/file/modelA/spmT_0001.nii").status_code == 200
    assert c.get("/api/results/file/modelA/notes.txt").status_code == 404
    assert c.get("/api/results/file/../tests/test_lookup.py").status_code == 404
    cl = c.get("/api/results/clusters", params={"map": "modelA/spmT_0001.nii", "threshold": 3}).json()
    assert cl["n_clusters"] == 1 and set(cl["clusters"][0]["labels"]) <= {
        "harvard-oxford-cort", "harvard-oxford-sub", "juelich", "talairach-ba"}
    x, y, z = cl["clusters"][0]["peak_mm"]
    res = c.get("/api/lookup", params=dict(x=x, y=y, z=z, map="modelA/spmT_0001.nii", atlases="juelich")).json()
    assert res["stat"]["t"] == 6.0
    assert "cluster" not in res["stat"]
    res = c.get("/api/lookup", params=dict(x=x, y=y, z=z, map="modelA/spmT_0001.nii", atlases="juelich",
                                           threshold=3, sign="both", min_voxels=5)).json()
    assert res["stat"]["cluster"] == 0


def test_no_results_folder(monkeypatch):
    from fastapi.testclient import TestClient
    from atlaslookup import server
    from atlaslookup.results import Results

    monkeypatch.setattr(server, "RESULTS", Results(None))
    r = TestClient(server.app).get("/api/results").json()
    assert r == {"folder": None, "available": False, "warning": None, "maps": []}


def test_user_data_lives_outside_the_package(tmp_path):
    """Settings (incl. your results path) and atlases go in the user's data
    folder, never inside the installed package or the repository."""
    import os
    import subprocess
    import sys

    code = ("from atlaslookup import config; "
            "print(config.DATA_DIR); print(config.SETTINGS_FILE); print(config.PACKAGE_DIR)")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                         env={**os.environ, "ATLASLOOKUP_HOME": str(tmp_path)}, check=True).stdout.split()
    data_dir, settings, package = map(Path, out)
    assert data_dir == tmp_path and settings.parent == tmp_path
    assert not settings.is_relative_to(package) and not data_dir.is_relative_to(package)


def test_clusters_cli(results_dir, monkeypatch, capsys):
    """`atlaslookup clusters` gives the same clusters as the API, by id or by path."""
    from atlaslookup.__main__ import main

    monkeypatch.setenv("ATLAS_RESULTS_DIR", str(results_dir))
    main(["clusters", "modelA/spmT_0001.nii", "--csv"])
    lines = capsys.readouterr().out.strip().splitlines()
    assert lines[0].startswith("cluster,sign,voxels,peak_t,p_unc,x,y,z")
    assert len(lines) == 2 and lines[1].startswith("1,pos,64,6.0,")
    main(["clusters", str(results_dir / "modelB" / "sub" / "spmT_0001.nii"), "--sign", "neg"])
    assert "1 clusters" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        main(["clusters", "../outside/spmT_0001.nii"])


# --- viewer captures and slice labels --------------------------------------------

def test_save_png_names_by_time(tmp_path):
    from datetime import datetime

    from atlaslookup.screenshots import PNG_MAGIC, save_png

    t = datetime(2026, 10, 28, 9, 5, 7)
    folder = tmp_path / "image"
    a = save_png(PNG_MAGIC + b"a", folder, now=t)
    b = save_png(PNG_MAGIC + b"b", folder, now=t)
    assert (a.name, b.name) == ("2026-10-28_09-05-07.png", "2026-10-28_09-05-07_2.png")
    assert a.read_bytes() == PNG_MAGIC + b"a"
    with pytest.raises(ValueError):
        save_png(b"GIF89a", folder)


def test_screenshot_route(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from atlaslookup import server
    from atlaslookup.screenshots import PNG_MAGIC

    monkeypatch.setattr(server, "IMAGE_DIR", tmp_path / "image")
    shown = []
    monkeypatch.setattr(server, "reveal", shown.append)  # don't open Finder during tests
    c = TestClient(server.app)
    r = c.post("/api/screenshot", content=PNG_MAGIC + b"x", headers={"Content-Type": "image/png"})
    assert r.status_code == 200, r.text
    assert (tmp_path / "image" / r.json()["file"]).read_bytes() == PNG_MAGIC + b"x"
    assert shown == [tmp_path / "image" / r.json()["file"]]
    # Form-style bodies (what another website could send without a preflight) are refused.
    assert c.post("/api/screenshot", content=PNG_MAGIC, headers={"Content-Type": "text/plain"}).status_code == 415
    assert c.post("/api/screenshot", content=b"nope", headers={"Content-Type": "image/png"}).status_code == 400
    # Oversized uploads are refused from the declared length, before the body is read.
    monkeypatch.setattr(server, "MAX_BYTES", 4)
    assert c.post("/api/screenshot", content=PNG_MAGIC, headers={"Content-Type": "image/png"}).status_code == 413
    assert len(shown) == 1


def test_slice_labels():
    """static/viewertools.js: z/y/x in mm, or the matching voxel index on a grid."""
    import json
    import shutil
    import subprocess
    from pathlib import Path

    if not shutil.which("node"):
        pytest.skip("node not installed")
    import atlaslookup

    js = Path(atlaslookup.__file__).parent / "static" / "viewertools.js"
    # FSL-style 2 mm MNI grid: x is flipped (i runs right to left).
    grid = {"affine": [[-2, 0, 0, 90], [0, 2, 0, -126], [0, 0, 2, -72], [0, 0, 0, 1]]}
    mm = [-44, 18, 24]
    calls = [[0, mm, {}], [1, mm, {}], [2, mm, {}], [2, [12.5, 0, 0], {}],
             [0, mm, {"mode": "voxel", "grid": grid, "base": 1}],
             [1, mm, {"mode": "voxel", "grid": grid, "base": 1}],
             [2, mm, {"mode": "voxel", "grid": grid, "base": 0}],
             [0, mm, {"mode": "voxel", "grid": None}]]
    script = (f"import {{ sliceLabel }} from {str(js)!r};"
              f"console.log(JSON.stringify({json.dumps(calls)}.map(([s, p, o]) => sliceLabel(s, p, o))));")
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    # i = (90 - (-44)) / 2 = 67 (0-based) -> 68; j = (18 + 126) / 2 + 1 = 73; k = (24 + 72) / 2 + 1 = 49
    assert json.loads(out.stdout) == ["z = 24 mm", "y = 18 mm", "x = −44 mm", "x = 12.5 mm",
                                      "k = 49", "j = 73", "i = 67", "z = 24 mm"]


def test_colour_bar_ends():
    """static/viewertools.js: colour bar labels in T, or in p when a layer uses p."""
    import json
    import shutil
    import subprocess
    from pathlib import Path

    from scipy import stats

    if not shutil.which("node"):
        pytest.skip("node not installed")
    import atlaslookup

    js = Path(atlaslookup.__file__).parent / "static" / "viewertools.js"
    entries = [{"sign": "+", "from": 3, "to": 7, "mode": "t", "df": 24},
               {"sign": "−", "from": 3, "to": 4.414, "mode": "t", "df": 24},
               {"sign": "+", "from": 3.4668, "to": 7, "mode": "p", "df": 24},
               {"sign": "−", "from": 3.4668, "to": 7, "mode": "p", "df": 24},
               {"sign": "+", "from": 3, "to": 7, "mode": "p", "df": None}]
    script = (f"import {{ barEnds }} from {str(js)!r};"
              f"const es = {json.dumps(entries)};"
              "console.log(JSON.stringify([...es.map((e) => barEnds(e)), barEnds(es[1], '-')]));")
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert got[0] == {"unit": "T", "lo": "3.00", "hi": "7.00"}
    assert got[1] == {"unit": "T", "lo": "−3.00", "hi": "−4.41"}
    assert got[2]["unit"] == "p" and float(got[2]["lo"]) == pytest.approx(stats.t.sf(3.4668, 24), rel=0.05)
    assert float(got[2]["hi"]) == pytest.approx(stats.t.sf(7, 24), rel=0.05)
    assert got[3] == got[2]  # one-sided p of |T|, same for both signs
    assert got[4]["unit"] == "T"  # no df: falls back to T
    assert got[5]["lo"] == "-3.00"  # ASCII minus for the number inputs


def test_brain_mesh(tmp_path, monkeypatch):
    """The glass-brain mesh is built from nilearn's bundled fsaverage5 on first request,
    spans both hemispheres, and sits where the MNI brain is."""
    from fastapi.testclient import TestClient

    from atlaslookup import server, sources

    mesh = tmp_path / "templates" / "fsaverage5_pial.gii"
    monkeypatch.setattr(server, "MESH_FILE", mesh)
    monkeypatch.setattr(sources, "MESH_FILE", mesh)
    r = TestClient(server.app).get("/api/brain_mesh.gii")
    assert r.status_code == 200 and mesh.exists()
    g = nib.load(str(mesh))
    v, f = g.agg_data("pointset"), g.agg_data("triangle")
    assert len(v) == 2 * 10242 and f.max() == len(v) - 1  # both hemispheres, faces re-indexed
    assert v[:, 0].min() < -60 and v[:, 0].max() > 60       # left and right cortex
    assert -110 < v[:, 1].min() < -95 and 60 < v[:, 1].max() < 80


def test_viewer3d_is_wired():
    """index.html loads the 3D module and gives it the controls it looks up."""
    import re

    import atlaslookup

    static = Path(atlaslookup.__file__).parent / "static"
    html = (static / "index.html").read_text()
    assert 'from "/static/viewer3d.js"' in html
    for el in ["viewTabs", "gl3wrap", "gl3", "v3Bar", "v3Style", "v3Brain", "v3BrainOut", "v3Views",
               "v3Regions", "statList", "statFor", "leftToggle", "leftBar", "overlayPanel", "ovHead", "statRange", "statCtl", "statMsg", "tTable", "tDf"]:
        assert re.search(rf'id="{el}"', html), el
    assert 'from "/static/sidepanel.js"' in html
    # Page-layout rules must not hit the side panel (also an <aside>).
    assert "aside { display: contents" not in html.replace("main > aside { display: contents", "")
    js = (static / "viewer3d.js").read_text()
    assert "/api/brain_mesh.gii" in js and "export function createViewer3D" in js


# --- regions window, region meshes, mesh-brain projection, Finder-style browser ------

def test_region_painting_fills_every_covered_voxel():
    """A 2 mm atlas voxel must fill all eight 1 mm voxels it covers (half-voxel ties
    once dropped 7 of 8, leaving a dotted mask)."""
    from atlaslookup import regions
    from atlaslookup.atlas import MNI_1MM_AFFINE, MNI_1MM_SHAPE

    lab = np.zeros((11, 11, 11), np.int16)
    lab[3:6, 4:6, 5:7] = 7  # 3 x 2 x 2 = 12 voxels of 8 mm3
    aff2 = np.array([[2, 0, 0, -10], [0, 2, 0, -10], [0, 0, 2, -10], [0, 0, 0, 1]], float)

    class Fake:
        mni_labels = (lab, aff2)

    out = np.zeros(MNI_1MM_SHAPE, np.uint8)
    regions._paint(out, Fake(), 7, "B", 3)
    assert (out == 3).sum() == 12 * 8
    ijk = np.argwhere(out == 3)
    mm = ijk @ MNI_1MM_AFFINE[:3, :3].T + MNI_1MM_AFFINE[:3, 3]
    # x from voxel 3..5 of the 2 mm grid: centres -4..0, so 1 mm centres -5..0
    assert mm[:, 0].min() == -5 and mm[:, 0].max() == 0


def test_region_surface_is_closed_and_sized():
    from collections import Counter

    from atlaslookup.regions import surface

    g = np.indices((40, 40, 40)) - 20
    for mask in [(g ** 2).sum(0) <= 100, (np.abs(g) <= 4).all(0)]:
        v, f = surface(mask, np.eye(4))
        edges = Counter(map(tuple, np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]).tolist()))
        assert all(n == 1 and edges.get((b, a)) == 1 for (a, b), n in edges.items())  # closed, consistent
        tri = v[f]
        volume = np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6
        assert volume > 0 and abs(volume - mask.sum()) / mask.sum() < 0.08  # outward, not shrunk


@bootstrapped
def test_regions_api():
    import gzip

    from fastapi.testclient import TestClient
    from atlaslookup.server import app

    c = TestClient(app)
    listing = {a["atlas"]: a["regions"] for a in c.get("/api/regions").json()}
    hippo = [r for r in listing["harvard-oxford-sub"] if r["name"] == "Left Hippocampus"][0]
    ofc = [r for r in listing["harvard-oxford-cort"] if r["name"] == "Right Frontal Orbital Cortex"][0]
    assert ofc["side"] == "R" and hippo["side"] == "B"
    sel = f"harvard-oxford-sub|{hippo['value']}|B,harvard-oxford-cort|{ofc['value']}|R"
    img = nib.Nifti1Image.from_bytes(gzip.decompress(c.get("/api/regions/mask.nii.gz", params={"sel": sel}).content))
    d = np.asarray(img.dataobj)
    xs = np.argwhere(d == 2)[:, 0] * img.affine[0, 0] + img.affine[0, 3]
    assert (d == 1).sum() > 3000 and (d == 2).sum() > 3000 and (xs > 0).all()  # region 2 is right-sided
    mesh = c.get("/api/regions/mesh.gii", params={"sel": f"harvard-oxford-sub|{hippo['value']}|B"})
    v = nib.GiftiImage.from_bytes(mesh.content).agg_data("pointset")
    assert -40 < v[:, 0].min() and v[:, 0].max() < 0 and v[:, 2].min() > -40  # left, medial temporal
    assert c.get("/api/regions/mask.nii.gz", params={"sel": "nope|1|L"}).status_code == 404
    assert c.get("/api/regions/mask.nii.gz", params={"sel": "garbage"}).status_code == 400
    assert c.get("/api/regions/mesh.gii", params={"sel": "harvard-oxford-sub|9999|B"}).status_code == 404


def _node(script):
    import shutil
    import subprocess

    if not shutil.which("node"):
        pytest.skip("node not installed")
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()


def test_js_region_search_browser_tree_and_projection():
    import json

    import atlaslookup

    static = Path(atlaslookup.__file__).parent / "static"
    out = _node(f"""
      import {{ matches }} from {str(static / "regionpicker.js")!r};
      import {{ buildTree, entries }} from {str(static / "browser.js")!r};
      import {{ volumeSampler, projectToVertices }} from {str(static / "viewer3d.js")!r};
      const m = [
        matches("medial orbitofrontal", "Left olfactory sulcus (medial orbital sulcus)"),
        matches("hippocampus", "Left Hippocampus"), matches("ifg", "Left Inferior Temporal Gyrus"),
        matches("ba 44", "Right Brodmann area 44"), matches("amygdala juelich", "Left Amygdala, laterobasal group", "Juelich Histological"),
      ];
      const tree = buildTree([{{ id: "S1/T1/a/spmT_0001.nii" }}, {{ id: "S1/T1/a/spmT_0002.nii" }},
                              {{ id: "S1/T1/b/spmT_0001.nii" }}, {{ id: "S2/spmT_0001.nii" }}]);
      const top = entries(tree).map((e) => e.node?.name ?? e.map.name);
      const t1 = entries(tree.dirs.get("S1").dirs.get("T1")).map((e) => e.kind + ":" + (e.node?.name ?? e.map.name));
      // 3x3x3 volume, 1 mm, origin -1: value 5 at the centre voxel (mm 0,0,0), -7 one voxel to the left.
      const img = new Float32Array(27); img[13] = 5; img[12] = -7;
      const s = volumeSampler({{ img, dims: [3, 3, 3], affine: [[1,0,0,-1],[0,1,0,-1],[0,0,1,-1],[0,0,0,1]] }});
      // A vertex at x=+1 with an outward normal +x sees 5 at depth 1 and -7 at depth 2 -> keeps -7 (largest |v|).
      const proj = projectToVertices(s, new Float32Array([1, 0, 0]), new Float32Array([1, 0, 0]), [0, 1, 2]);
      const lab = projectToVertices(s, new Float32Array([1, 0, 0]), new Float32Array([1, 0, 0]), [0, 1, 2], true);
      console.log(JSON.stringify({{ m, top, t1, proj: Array.from(proj), lab: Array.from(lab), out: s(9, 9, 9) }}));
    """)
    r = json.loads(out)
    assert r["m"] == [True, True, False, True, True]
    assert r["top"] == ["S1", "S2"]
    assert r["t1"] == ["dir:a", "dir:b"]
    assert r["proj"] == [-7] and r["lab"] == [5] and r["out"] == 0


# --- version menu ---------------------------------------------------------------------

def test_versions_listing_and_switch(monkeypatch, tmp_path):
    """Releases are vX.Y.Z tags from 0.6.0 on, newest first; switching prepares a worktree
    for the tag and restarts with PYTHONPATH pointing at it (exec is faked here)."""
    from atlaslookup import versions

    tags = "v0.14.0\nv0.13.0\nv0.5.0\nv1.0.0-rc1\nsomething\nv0.6.0"
    fake_git = {("rev-parse", "--git-dir"): ".git",
                ("tag", "-l", "v*", "--sort=-v:refname"): tags}
    monkeypatch.setattr(versions, "_git", lambda *a: fake_git.get(a, "2026-10-29"))
    assert [r["tag"] for r in versions.releases()] == ["v0.14.0", "v0.13.0", "v0.6.0"]

    made, execs = [], []
    monkeypatch.setattr(versions, "_worktree", lambda tag: made.append(tag) or tmp_path / tag)

    class NowTimer:  # run the "exec" immediately, and record it instead of replacing pytest
        def __init__(self, _delay, fn): self.fn = fn
        def start(self): self.fn()
    monkeypatch.setattr(versions.threading, "Timer", NowTimer)
    monkeypatch.setattr(versions.os, "execve", lambda exe, argv, env: execs.append((argv, env)))

    versions.switch("v0.13.0", "127.0.0.1", 8765, "/data/results")
    argv, env = execs[-1]
    assert made == ["v0.13.0"] and env["PYTHONPATH"] == str(tmp_path / "v0.13.0" / "src")
    assert env["ATLASLOOKUP_RUNNING_TAG"] == "v0.13.0"
    assert argv[-6:] == ["--host", "127.0.0.1", "--port", "8765", "--results", "/data/results"]

    monkeypatch.setenv("PYTHONPATH", "/somewhere")
    versions.switch("dev", "127.0.0.1", 8765, None)
    argv, env = execs[-1]
    assert "PYTHONPATH" not in env and "ATLASLOOKUP_RUNNING_TAG" not in env and "--results" not in argv
    with pytest.raises(ValueError):
        versions.switch("v9.9.9", "127.0.0.1", 8765, None)


def test_version_switch_endpoint_guards(monkeypatch):
    from fastapi.testclient import TestClient
    from atlaslookup import server, versions

    c = TestClient(server.app)
    monkeypatch.delenv("ATLASLOOKUP_SERVE", raising=False)
    # Form posts (what another website could send without a preflight) are refused.
    assert c.post("/api/versions/switch", data={"to": "dev"}).status_code == 415
    # Not started through `atlaslookup serve`: nothing to restart.
    assert c.post("/api/versions/switch", json={"to": "dev"}).status_code == 409
    monkeypatch.setenv("ATLASLOOKUP_SERVE", '{"host": "127.0.0.1", "port": 8765, "results": null}')
    monkeypatch.setattr(versions, "available", lambda: True)
    monkeypatch.setattr(versions, "releases", lambda: [{"tag": "v0.14.0", "date": "2026-10-29"}])
    assert c.post("/api/versions/switch", json={"to": "v0.1.0"}).status_code == 404
    called = []
    monkeypatch.setattr(versions, "switch", lambda *a: called.append(a))
    assert c.post("/api/versions/switch", json={"to": "v0.14.0"}).json() == {"switching_to": "v0.14.0"}
    assert called == [("v0.14.0", "127.0.0.1", 8765, None)]
