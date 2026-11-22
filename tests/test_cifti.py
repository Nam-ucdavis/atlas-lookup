"""CIFTI .dscalar.nii maps: listing, the voxel part on its own grid, the cortex per fsLR
vertex, lookups and peaks that reach the cortex, and registering fsLR surfaces.

Everything is synthetic: two small sphere "hemispheres" stand in for the fsLR surfaces,
and a CIFTI file holds a few of their vertices plus a few voxels on the HCP 2 mm grid."""
import numpy as np
import nibabel as nib
import pytest
from scipy.spatial import ConvexHull

from atlaslookup import cifti
from atlaslookup.results import Results

AFF = np.array([[-2, 0, 0, 90], [0, 2, 0, -126], [0, 0, 2, -72], [0, 0, 0, 1]], float)  # HCP 91k grid


def sphere(n, centre, radius, seed):
    rng = np.random.default_rng(seed)
    p = rng.normal(size=(n, 3))
    p /= np.linalg.norm(p, axis=1, keepdims=True)
    tris = ConvexHull(p).simplices.astype(np.int32)
    # Consistent winding (outward), as a real surface has.
    a, b, c = p[tris[:, 0]], p[tris[:, 1]], p[tris[:, 2]]
    flip = np.sum(np.cross(b - a, c - a) * a, axis=1) < 0
    tris[flip] = tris[flip][:, [0, 2, 1]]
    return (p * radius + centre).astype(np.float32), tris


def save_surf(path, pts, tris, structure):
    meta = nib.gifti.GiftiMetaData({"AnatomicalStructurePrimary": structure})
    img = nib.gifti.GiftiImage(darrays=[
        nib.gifti.GiftiDataArray(pts, intent="NIFTI_INTENT_POINTSET", datatype="NIFTI_TYPE_FLOAT32", meta=meta),
        nib.gifti.GiftiDataArray(tris, intent="NIFTI_INTENT_TRIANGLE", datatype="NIFTI_TYPE_INT32"),
    ])
    nib.save(img, str(path))


@pytest.fixture
def fslr(tmp_path, monkeypatch):
    """Registered synthetic fsLR surfaces (60 vertices per hemisphere)."""
    folder = tmp_path / "fslr"
    folder.mkdir()
    surfs = {}
    for side, cx, seed in (("L", -40, 1), ("R", 40, 2)):
        mid, tris = sphere(60, [cx, 0, 10], 30, seed)
        infl = (mid - mid.mean(0)) * 1.3  # inflated: bigger, centred on the origin
        save_surf(folder / f"tpl-fsLR_den-32k_hemi-{side}_midthickness.surf.gii", mid, tris, "CortexLeft")
        save_surf(folder / f"tpl-fsLR_den-32k_hemi-{side}_inflated.surf.gii", infl.astype(np.float32), tris, "CortexLeft")
        surfs[side] = mid
    mesh, morph = tmp_path / "data" / "fslr.gii", tmp_path / "data" / "fslr.bin"
    monkeypatch.setattr(cifti, "FSLR_MESH_FILE", mesh)
    monkeypatch.setattr(cifti, "FSLR_MORPH_FILE", morph)
    cifti.fslr_midthickness.cache_clear()
    yield folder, surfs, mesh, morph
    cifti.fslr_midthickness.cache_clear()


def make_cifti(path, n_vert=60):
    """Maps: 1 = t, 2 = -log10 p. Cortex: vertices 0-49 of each hemisphere (50-59 are
    'medial wall'). Voxels: three, in the right thalamus area."""
    left = nib.cifti2.BrainModelAxis.from_mask(np.r_[np.ones(50), np.zeros(n_vert - 50)].astype(bool), "CortexLeft")
    right = nib.cifti2.BrainModelAxis.from_mask(np.r_[np.ones(50), np.zeros(n_vert - 50)].astype(bool), "CortexRight")
    mask = np.zeros((91, 109, 91), bool)
    vox = [(40, 50, 40), (41, 50, 40), (40, 51, 40)]
    for v in vox:
        mask[v] = True
    sub = nib.cifti2.BrainModelAxis.from_mask(mask, "ThalamusRight", affine=AFF)
    bm = left + right + sub
    n = len(bm)
    t = np.linspace(-2, 2, n).astype(np.float32)
    t[10] = 7.5            # left vertex 10: the strongest
    t[50 + 20] = -6.0      # right vertex 20
    t[100] = 4.0           # first voxel
    t[3] = np.nan          # no value at left vertex 3
    logp = np.abs(t) / 2
    names = nib.cifti2.ScalarAxis(["t (df 25)", "-log10 p unc pos"])
    img = nib.Cifti2Image(np.vstack([t, logp]), header=(names, bm))
    img.nifti_header.set_intent("ConnDenseScalar")
    path.parent.mkdir(parents=True, exist_ok=True)
    nib.save(img, str(path))
    return t, vox


def test_cifti_listing_volume_and_surface(tmp_path, fslr):
    res = tmp_path / "results"
    t, vox = make_cifti(res / "group" / "modelA_contrast1.dscalar.nii")
    r = Results(res)
    maps = r.list()
    ids = [m["id"] for m in maps]
    assert ids == ["group/modelA_contrast1.dscalar.nii/map1.nii", "group/modelA_contrast1.dscalar.nii/map2.nii"]
    m1 = maps[0]
    assert m1["df"] == 25.0 and m1["contrast"] == "t (df 25)" and m1["shape"] == [91, 109, 91]
    assert m1["cifti"]["vertices_used"] == 100 and m1["cifti"]["voxels"] == 3
    assert maps[1]["df"] is None  # a -log10 p map: no T-to-p conversion

    # Voxels: on the CIFTI's own grid, exactly as stored.
    data, affine, (df, contrast) = r.load(ids[0])
    assert data.shape == (91, 109, 91) and np.allclose(affine, AFF) and df == 25.0
    assert data[vox[0]] == pytest.approx(4.0) and np.count_nonzero(data) == 3
    mm = (AFF @ [*vox[0], 1])[:3]
    v = r.value(ids[0], mm)
    assert v["t"] == 4.0 and v["in_bounds"] and "vertex" not in v

    # Surface: per vertex, left first; medial wall and NaN stay NaN.
    vals, n_left = r.surface_values(ids[0])
    assert n_left == 60 and len(vals) == 120
    assert vals[10] == pytest.approx(7.5) and vals[60 + 20] == pytest.approx(-6.0)
    assert np.isnan(vals[3]) and np.isnan(vals[55]) and np.isnan(vals[60 + 55])
    assert r.surface_values("group/modelA_contrast1.dscalar.nii/map2.nii")[0][10] == pytest.approx(3.75)

    # The served NIfTI is the same voxel volume.
    img = nib.Nifti1Image.from_bytes(r.volume_image(ids[0]))
    assert np.allclose(img.affine, AFF) and np.asarray(img.dataobj)[vox[0]] == pytest.approx(4.0)

    # Ids that don't exist, or the bare CIFTI file, are refused.
    for bad in ("group/modelA_contrast1.dscalar.nii", "group/modelA_contrast1.dscalar.nii/map3.nii",
                "group/modelA_contrast1.dscalar.nii/map0.nii", "group/nothere.dscalar.nii/map1.nii"):
        with pytest.raises(FileNotFoundError):
            r.resolve(bad)


def test_cifti_cortex_needs_matching_fslr(tmp_path, fslr):
    folder, surfs, mesh, morph = fslr
    res = tmp_path / "results"
    make_cifti(res / "x.dscalar.nii")
    r, m = Results(res), "x.dscalar.nii/map1.nii"
    # Not registered yet: no vertex readout or vertex peaks, only the voxels.
    assert r.vertex_near(m, surfs["L"][10]) is None
    info = cifti.add_fslr(folder)
    assert info["left"] == 60 and info["right"] == 60
    assert mesh.exists() and morph.exists()
    pts, n_left = cifti.fslr_midthickness()
    assert n_left == 60 and np.allclose(pts[:60], surfs["L"], atol=1e-4)
    assert pts[:60, 0].mean() < 0 < pts[60:, 0].mean()  # left is left

    # A point on the cortex reads the nearest vertex's value.
    v = r.value(m, surfs["L"][10] + [0.5, 0, 0])
    assert v["t"] == 7.5 and v["vertex"]["index"] == 10 and v["vertex"]["distance"] == 0.5 and v["p"] < 1e-6
    # Medial-wall / NaN vertices never answer; far from the cortex nothing does.
    assert r.value(m, surfs["L"][3]).get("vertex", {}).get("index") != 3
    assert r.vertex_near(m, [0, 0, 200]) is None

    # Peaks include the cortex: from beside vertex 10 the vertex wins over the voxels.
    p = r.peak_near(m, surfs["L"][10] + [2, 0, 0], 6)
    assert p["found"] and p["t"] == 7.5 and p["vertex"] == 10 and "voxel" not in p
    neg = r.peak_near(m, surfs["R"][20], 3, sign="neg")
    assert neg["t"] == -6.0 and neg["vertex"] == 80

    # Surfaces with other vertex counts don't match: the cortex is not used.
    small = tmp_path / "small"
    small.mkdir()
    for side, cx in (("L", -40), ("R", 40)):
        mid, tris = sphere(40, [cx, 0, 10], 30, 3)
        save_surf(small / f"tpl-fsLR_den-32k_hemi-{side}_midthickness.surf.gii", mid, tris, "x")
        save_surf(small / f"tpl-fsLR_den-32k_hemi-{side}_inflated.surf.gii", mid * 1.2, tris, "x")
    cifti.add_fslr(small)
    assert r.vertex_near(m, surfs["L"][10]) is None


def test_add_fslr_checks_files(tmp_path, fslr):
    folder, *_ = fslr
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(FileNotFoundError, match="midthickness"):
        cifti.add_fslr(empty)
    # Left and right swapped: refused.
    swapped = tmp_path / "swapped"
    swapped.mkdir()
    for f in folder.iterdir():
        name = f.name.replace("hemi-L", "hemi-X").replace("hemi-R", "hemi-L").replace("hemi-X", "hemi-R")
        (swapped / name).write_bytes(f.read_bytes())
    with pytest.raises(ValueError, match="left"):
        cifti.add_fslr(swapped)


def test_cifti_api_and_tags(tmp_path, fslr, monkeypatch):
    from fastapi.testclient import TestClient

    from atlaslookup import server
    from atlaslookup.tags import TagStore

    folder, surfs, mesh, morph = fslr
    res = tmp_path / "results"
    make_cifti(res / "g" / "a.dscalar.nii")
    monkeypatch.setattr(server, "RESULTS", Results(res))
    monkeypatch.setattr(server, "FSLR_MESH_FILE", mesh)
    monkeypatch.setattr(server, "FSLR_MORPH_FILE", morph)
    monkeypatch.setattr(server, "TAGS", TagStore(tmp_path / "tags.json"))
    c = TestClient(server.app)
    m = "g/a.dscalar.nii/map1.nii"

    j = c.get("/api/results").json()
    assert [x["id"] for x in j["maps"]] == [m, "g/a.dscalar.nii/map2.nii"] and j["fslr"] is None
    assert c.get("/api/fslr_mesh.gii").status_code == 404
    assert "add-fslr" in c.get("/api/fslr_morph.bin").json()["detail"]
    assert c.get(f"/api/results/surface/{m}").status_code == 409  # no surfaces to match yet

    cifti.add_fslr(folder)
    assert c.get("/api/results").json()["fslr"] == {"left": 60, "right": 60}
    assert c.get("/api/fslr_mesh.gii").status_code == 200
    b = c.get(f"/api/results/surface/{m}").content
    n_left, n = np.frombuffer(b[:8], "<u4")
    vals = np.frombuffer(b[8:], "<f4")
    assert (n_left, n) == (60, 120) and vals[10] == pytest.approx(7.5) and np.isnan(vals[55])
    img = nib.Nifti1Image.from_bytes(c.get(f"/api/results/file/{m}").content)
    assert img.shape == (91, 109, 91)
    assert c.get("/api/results/surface/g/a.dscalar.nii/map9.nii").status_code == 404

    cl = c.get("/api/results/clusters", params={"map": m, "threshold": 3, "min_voxels": 1}).json()
    assert cl["voxels_only"] and len(cl["clusters"]) == 1 and cl["clusters"][0]["peak_t"] == 4.0
    assert cl["max_abs_t"] == 7.5  # the colour range covers the cortex too
    look = c.get("/api/lookup", params=dict(zip("xyz", surfs["L"][10].tolist()), map=m, atlases="none")).status_code
    assert look in (200, 400, 404)  # (no atlases in the test install is fine)

    # Tags on map 1 and map 2 of the same file are kept apart.
    t = c.post("/api/tags", json={"label": "peak", "mm": surfs["L"][10].tolist(), "map": m}).json()
    assert t["mine"]
    other = c.get("/api/tags", params={"map": "g/a.dscalar.nii/map2.nii"}).json()["tags"]
    assert [x["mine"] for x in other] == [False]


def test_links_between_volume_and_cifti(tmp_path, monkeypatch):
    """A volumetric map and its fsLR version: linked by the user, found from either side
    (any map of the CIFTI file), suggested by name, kept outside the results folder."""
    from fastapi.testclient import TestClient

    from atlaslookup import server
    from atlaslookup.links import LinkStore, suggest

    res = tmp_path / "results"
    make_cifti(res / "cifti" / "f2" / "permA_RegX.dscalar.nii")
    make_cifti(res / "cifti" / "f2" / "permB_RegX.dscalar.nii")
    make_cifti(res / "cifti" / "f1" / "permA_RegY.dscalar.nii")
    vol_dir = res / "rsa" / "study_f2_RegXRegY_permA1000" / "RegX"
    vol_dir.mkdir(parents=True)
    nib.save(nib.Nifti1Image(np.zeros((4, 4, 4), np.float32), np.eye(4)), str(vol_dir / "spmT_0001.nii"))
    nib.save(nib.Nifti1Image(np.zeros((4, 4, 4), np.float32), np.eye(4)), str(vol_dir / "ResMS.nii"))
    vol = "rsa/study_f2_RegXRegY_permA1000/RegX/spmT_0001.nii"
    surf1, surf4 = "cifti/f2/permA_RegX.dscalar.nii/map1.nii", "cifti/f2/permA_RegX.dscalar.nii/map2.nii"

    maps = Results(res).list()
    s = suggest(vol, maps)
    assert s[0] == surf1 and len(set(x.rsplit("/", 1)[0] for x in s)) == len(s)  # one per file, best first
    assert suggest(surf4, maps)[0] == vol and all("ResMS" not in x for x in suggest(surf4, maps))

    store = LinkStore(tmp_path / "data" / "links.json")
    monkeypatch.setattr(server, "RESULTS", Results(res))
    monkeypatch.setattr(server, "LINKS", store)
    c = TestClient(server.app)
    j = c.get("/api/links", params={"map": vol}).json()
    assert j["kind"] == "volume" and j["partners"] == [] and j["suggestions"][0] == surf1
    assert all(x.endswith(".nii") and ".dscalar.nii/" in x for x in j["candidates"])
    assert c.post("/api/links", json={"volume": vol, "surface": surf1}).status_code == 200
    assert c.get("/api/links", params={"map": vol}).json()["partners"] == [{"id": surf1, "missing": False}]
    # Any map of the CIFTI file leads back to the volume.
    back = c.get("/api/links", params={"map": surf4}).json()
    assert back["kind"] == "surface" and back["partners"] == [{"id": vol, "missing": False}] and back["suggestions"] == []
    # Wrong kinds, unknown maps and non-JSON are refused.
    assert c.post("/api/links", json={"volume": surf1, "surface": vol}).status_code == 400
    assert c.post("/api/links", json={"volume": vol, "surface": "cifti/nope.dscalar.nii/map1.nii"}).status_code == 404
    assert c.post("/api/links", content="volume=x", headers={"content-type": "text/plain"}).status_code == 415
    # Relinking the same pair replaces it; unlinking removes it.
    c.post("/api/links", json={"volume": vol, "surface": surf4})
    assert store.all() == [{"volume": vol, "surface": surf4}]
    assert c.post("/api/links/remove", json={"volume": vol, "surface": surf1}).json() == {"removed": True}
    assert store.all() == [] and c.get("/api/links", params={"map": surf1}).json()["partners"] == []
    assert not any(p.name == "links.json" for p in res.rglob("*"))  # never in the results folder
