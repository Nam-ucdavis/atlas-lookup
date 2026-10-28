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
