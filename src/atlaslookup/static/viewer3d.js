// 3D view, shown in its own tab next to the slices.
//
// A second NiiVue instance on its own canvas, so the slice viewer and its tools are
// untouched. It mirrors whatever is drawn on the slices (atlas overlay, results-folder
// stat map, local NIfTI layers): the same volumes are cloned in, with their display
// settings copied, whenever the slice viewer updates. Three styles:
//   surface  the MNI template rendered as a solid brain, overlays on its surface
//   glass    the template hidden; a see-through cortical mesh (fsaverage5 pial) with
//            the overlays drawn as solid blobs inside it
//   mesh     the same mesh, opaque, with each overlay projected onto it: every vertex
//            takes the strongest value found up to 4 mm beneath it (cortex only)
// Projection runs here in the browser, so local overlays still never leave it.
//
// Regions chosen in the Regions window are drawn as solid surfaces in their own
// colours (smooth meshes built by the server from the atlas masks; NiiVue draws flat
// on/off volumes only faintly), are painted onto the mesh brain, and can optionally
// restrict the overlays to inside them. The 3D view is for looking: drag to rotate, scroll to zoom. Clicks to
// look up a point stay on the slices; the slice crosshair is shown here too.

import { NVMesh, NVMeshLayerDefaults, NVMeshUtilities } from "./vendor/niivue-0.69.0.js";

const VIEWS = {  // NiiVue azimuth / elevation for each named camera position
  L: [90, 0], R: [270, 0], A: [180, 0], P: [0, 0], S: [0, 90], I: [0, -90],
};
const DEFAULT_VIEW = [90, 15];  // left, slightly from above
const ZOOM = 1.5;  // NiiVue's default leaves the brain small in the wide panel
// NVImage.clone() copies the voxels but not how they are drawn.
const DISPLAY_KEYS = ["colormap", "colormapNegative", "cal_min", "cal_max", "cal_minNeg", "cal_maxNeg",
  "opacity", "colormapType", "isTransparentBelowCalMin", "alphaThreshold"];
const GLASS_RGBA = [235, 238, 245, 255];
const MESH_RGBA = [150, 150, 158, 255];  // mid grey, so warm and cool overlay colours both stand out
// Mesh-brain shading, without gloss: glossy shaders (Matcap, Phong) put a white-yellow
// highlight on the surface that hides the warm colours of positive results. The grey
// brain gets plain diffuse shading for its shape; coloured vertices (results, regions)
// are shaded only lightly, so they stay bright even where the surface faces away.
// Transparency applies to the grey brain only: coloured vertices stay opaque, so results
// remain fully visible however see-through the brain is.
const MESH_SHADER = "Results bright";
const MESH_SHADER_FRAG = `#version 300 es
precision highp int;
precision highp float;
uniform float opacity;
in vec4 vClr;
in vec3 vN;
out vec4 color;
void main() {
  float lambert = max(dot(normalize(vN), vec3(0.0, 0.0, -1.0)), 0.0);
  float sat = max(max(vClr.r, vClr.g), vClr.b) - min(min(vClr.r, vClr.g), vClr.b);
  float coloured = smoothstep(0.05, 0.25, sat);
  float shade = mix(1.4 * lambert, 0.8 + 0.3 * lambert, coloured);
  color = vec4(min(vClr.rgb * shade, vec3(1.0)), mix(opacity, 1.0, coloured));
}`;
// Brain transparency (%) per style until the user changes it: glass starts see-through.
const DEFAULT_TRANSPARENCY = { surface: 0, glass: 75, mesh: 0 };
const DEPTHS = [0, 1, 2, 3, 4];  // mm beneath the pial surface sampled for the mesh style
const REGION_SEE_THROUGH = 0.35;
const TRACT_OPACITY = 0.9;  // a touch see-through, so regions behind a tract still show  // region opacity when results are shown only inside them
const W = 2400, H = 800, BAND = 160;  // capture size, matching the slice captures

// --- sampling volumes at mesh vertices (pure, exported for tests) ---------------------

function invert4(m) {
  // General 4x4 inverse (row-major [[...],[...],[...],[...]]), via cofactors.
  const a = m.flat(), inv = new Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  return [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => inv[r * 4 + c] / det));
}

/** A sampler for a volume given as { img, dims: [nx, ny, nz], affine (4x4 rows), slope, inter }:
 * value at mm (nearest voxel), or 0 outside. */
export function volumeSampler({ img, dims, affine, slope = 1, inter = 0 }) {
  const [nx, ny, nz] = dims, inv = invert4(affine);
  return (x, y, z) => {
    const i = Math.round(inv[0][0] * x + inv[0][1] * y + inv[0][2] * z + inv[0][3]);
    const j = Math.round(inv[1][0] * x + inv[1][1] * y + inv[1][2] * z + inv[1][3]);
    const k = Math.round(inv[2][0] * x + inv[2][1] * y + inv[2][2] * z + inv[2][3]);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 0;
    return img[i + nx * (j + ny * k)] * slope + inter;
  };
}

/** Per-vertex values: for each vertex, sample inwards along the normal at `depths` (mm)
 * and keep the value with the largest |v| (continuous maps) or the first non-zero
 * (label maps). */
export function projectToVertices(sample, pts, normals, depths = DEPTHS, label = false) {
  const n = pts.length / 3, out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const px = pts[3 * v], py = pts[3 * v + 1], pz = pts[3 * v + 2];
    const nx = normals[3 * v], ny = normals[3 * v + 1], nz = normals[3 * v + 2];
    let best = 0;
    for (const d of depths) {
      const s = sample(px - nx * d, py - ny * d, pz - nz * d);
      if (label ? (s && !best) : Math.abs(s) > Math.abs(best)) best = s;
    }
    out[v] = best;
  }
  return out;
}

const samplerOf = (vol) => volumeSampler({
  img: vol.img, dims: vol.hdr.dims.slice(1, 4), affine: vol.hdr.affine,
  slope: vol.hdr.scl_slope || 1, inter: vol.hdr.scl_inter || 0,
});

// --- the view ------------------------------------------------------------------------

export function createViewer3D({ Niivue, NVImage, getNv, store, wrap, canvas, controls, crosshairToggle, setHint }) {
  let nv3 = null, ready = null, mesh = null, normals = null, active = false;
  let drawNow = null;  // NiiVue's own, immediate drawScene
  let clones = [];  // [{ src, copy }] in slice-viewer order
  let regionVol = null, regionKey = "", maskResults = false, regionMeshes = [];
  let layersDirty = true;
  let style = store.get("view3dStyle", "surface");
  // One "Brain transparency" slider (0-100 %) for whichever style is showing; each
  // style remembers its own value.
  let transparency = { ...DEFAULT_TRANSPARENCY, ...store.get("view3dTransparency", {}) };
  const brainOpacity = () => 1 - transparency[style] / 100;
  // NiiVue skips a mesh whose opacity is 0; keep the mesh brain drawn (invisibly) so the
  // results painted on it still show at 100 % transparency.
  const meshOpacity = () => Math.max(brainOpacity(), style === "mesh" ? 0.002 : 0);

  async function init() {
    nv3 = new Niivue({
      backColor: [0, 0, 0, 1],
      crosshairColor: [1, 0.25, 0.2, 1],
      show3Dcrosshair: crosshairToggle.checked,
      isColorbar: false,
      isOrientCube: true,
      dragAndDropEnabled: false,
    });
    await nv3.attachToCanvas(canvas);
    nv3.setCustomMeshShader(MESH_SHADER_FRAG, MESH_SHADER);
    // NiiVue redraws synchronously, about three times per mouse-move while rotating; a
    // fast mouse sends far more moves than the screen can show, so frames queue up and
    // the brain lags behind the pointer. Coalesce every request into one draw per
    // animation frame. Captures still draw immediately via drawNow.
    drawNow = nv3.drawScene.bind(nv3);
    let pending = 0;
    nv3.drawScene = () => {
      if (!pending) pending = requestAnimationFrame(() => { pending = 0; drawNow(); });
    };
    await nv3.loadVolumes([{ url: "/api/template.nii.gz", colormap: "gray" }]);
    nv3.setSliceType(nv3.sliceTypeRender);
    nv3.setRenderAzimuthElevation(...DEFAULT_VIEW);
    nv3.scene.volScaleMultiplier = ZOOM;
  }

  async function ensureMesh() {
    if (mesh) return mesh;
    // addMesh, not loadMeshes: loadMeshes would drop the region meshes already shown.
    const buf = await fetch("/api/brain_mesh.gii").then((r) => r.arrayBuffer());
    mesh = await NVMesh.readMesh(buf, "brain.gii", nv3.gl, brainOpacity(), new Uint8Array(GLASS_RGBA), true);
    mesh.updateMesh(nv3.gl);
    nv3.addMesh(mesh);
    // NiiVue draws meshes in list order. The see-through brain must come first, or
    // regions and tracts added before it (e.g. restored on reload) disappear behind it.
    nv3.meshes.splice(nv3.meshes.indexOf(mesh), 1);
    nv3.meshes.unshift(mesh);
    normals = NVMeshUtilities.generateNormals(mesh.pts, mesh.tris);
    // Sampling goes inwards, so normals must point out of the brain: the left-most
    // vertex's normal should point left.
    let lm = 0;
    for (let v = 1; v < mesh.pts.length / 3; v++) if (mesh.pts[3 * v] < mesh.pts[3 * lm]) lm = v;
    if (normals[3 * lm] > 0) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
    return mesh;
  }

  async function applyStyle() {
    for (const b of controls.style.querySelectorAll("button")) b.classList.toggle("on", b.dataset.style === style);
    showTransparency();
    nv3.setOpacity(0, style === "surface" ? brainOpacity() : 0);
    if (style === "surface") {
      if (mesh) nv3.setMeshProperty(mesh.id, "visible", false);
    } else {
      await ensureMesh();
      const glass = style === "glass";
      nv3.setMeshProperty(mesh.id, "visible", true);
      nv3.setMeshShader(mesh.id, glass ? "Rim" : MESH_SHADER);
      nv3.setMeshProperty(mesh.id, "rgba255", glass ? GLASS_RGBA : MESH_RGBA);
      nv3.setMeshProperty(mesh.id, "opacity", meshOpacity());
    }
    layersDirty = true;
    sync(true);
  }

  // Zero the voxels of a cloned overlay that fall outside the chosen regions.
  function maskToRegions(copy) {
    const inRegion = samplerOf(regionVol);
    const [nx, ny, nz] = copy.hdr.dims.slice(1, 4), a = copy.hdr.affine, img = copy.img;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = a[0][0] * i + a[0][1] * j + a[0][2] * k + a[0][3];
      const y = a[1][0] * i + a[1][1] * j + a[1][2] * k + a[1][3];
      const z = a[2][0] * i + a[2][1] * j + a[2][2] * k + a[2][3];
      if (!inRegion(x, y, z)) img[i + nx * (j + ny * k)] = 0;
    }
  }

  // Mesh style: one mesh layer per overlay (and one for the regions), recomputed only
  // when the volumes change; thresholds and colours are copied on every sync.
  function updateLayers() {
    if (!mesh) return;
    if (style !== "mesh") {
      if (mesh.layers.length) { mesh.layers = []; mesh.updateMesh(nv3.gl); }
      return;
    }
    const sources = clones.map(({ src, copy }) => ({ src, vol: copy, label: !!src.colormapLabel }));
    if (regionVol) sources.push({ src: regionVol, vol: regionVol, label: true });
    if (layersDirty || mesh.layers.length !== sources.length) {
      mesh.layers = sources.map(({ vol, label }) => ({
        ...NVMeshLayerDefaults, name: vol.name, frame4D: 0, nFrame4D: 1,
        values: projectToVertices(samplerOf(vol), mesh.pts, normals, label ? [1, 2] : DEPTHS, label),
      }));
      layersDirty = false;
    }
    mesh.layers.forEach((L, i) => {
      const s = sources[i].src;
      if (s.colormapLabel) {
        L.colormapLabel = s.colormapLabel; L.opacity = 1;
      } else {
        Object.assign(L, {
          colormap: s.colormap, cal_min: s.cal_min, cal_max: s.cal_max, opacity: s.opacity,
          colormapNegative: s.colormapNegative || "", useNegativeCmap: !!s.colormapNegative,
          cal_minNeg: s.cal_minNeg, cal_maxNeg: s.cal_maxNeg, isTransparentBelowCalMin: true,
        });
      }
    });
    mesh.updateMesh(nv3.gl);
  }

  // Copy the slice viewer's overlays. Re-clone only when the set of volumes (or the
  // region mask) changed; threshold or colour edits just copy the display settings.
  function sync(force = false) {
    if (!nv3 || !active) return;
    const src = getNv().volumes.slice(1).filter((v) => !v.skip3d);  // e.g. the slices' region layer
    const same = !force && src.length === clones.length && src.every((v, i) => clones[i].src === v);
    if (!same) {
      while (nv3.volumes.length > 1) nv3.removeVolumeByIndex(1);
      clones = src.map((v) => ({ src: v, copy: v.clone() }));
      for (const { copy } of clones) {
        if (maskResults && regionVol) maskToRegions(copy);
        nv3.addVolume(copy);
      }
      layersDirty = true;
    }
    const onMesh = style === "mesh";  // overlays are painted on the mesh instead
    for (const { src: v, copy } of clones) {
      for (const k of DISPLAY_KEYS) if (k in v) copy[k] = v[k];
      copy.colormapLabel = v.colormapLabel ?? null;
      if (onMesh) copy.opacity = 0;
    }
    updateLayers();
    nv3.opts.show3Dcrosshair = crosshairToggle.checked;
    nv3.scene.crosshairPos = [...getNv().scene.crosshairPos];  // same template, same fractions
    nv3.updateGLVolume();
  }
  let syncTimer;
  const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(), 120); };

  // Follow every change on the slice viewer (overlays added, thresholds dragged, ...).
  const nv = getNv();
  const update = nv.updateGLVolume.bind(nv);
  nv.updateGLVolume = (...args) => { const r = update(...args); if (active) scheduleSync(); return r; };

  async function show(on) {
    active = on;
    wrap.hidden = !on;
    controls.bar.hidden = !on;
    if (!on) return;
    if (!ready) ready = init().then(() => Promise.all([loadRegions(), loadTracts()]));
    await ready;
    await applyStyle();
    nv3.resizeListener?.();
    nv3.drawScene();
    setHint("3D: drag to rotate, scroll to zoom. Click on the slices to look up a point.");
  }

  // Tracts from the Regions tab's "Connecting tracts": [{ atlas, value, threshold, color }].
  let tractWanted = [], tractKey = "", tractMeshes = [];
  async function loadTracts() {
    const key = tractWanted.map((t) => `${t.atlas}|${t.value}|${t.threshold}|${t.color.join()}`).join(",");
    if (key === tractKey) return;
    tractKey = key;
    const meshes = await Promise.all(tractWanted.map(async (t) => {
      const res = await fetch(`/api/tracts/mesh.gii?${new URLSearchParams({ atlas: t.atlas, value: t.value, threshold: t.threshold })}`);
      if (!res.ok) return null;
      return NVMesh.readMesh(await res.arrayBuffer(), "tract.gii", nv3.gl, TRACT_OPACITY, new Uint8Array([...t.color, 255]), true);
    }));
    if (key !== tractKey) return;  // a newer choice arrived meanwhile
    for (const m of tractMeshes) nv3.removeMesh(m);
    tractMeshes = meshes.filter(Boolean);
    for (const m of tractMeshes) {
      m.updateMesh(nv3.gl);
      nv3.addMesh(m);
      nv3.setMeshShader(m.id, "Phong");
    }
    nv3.drawScene();
  }
  async function setTracts(list) {
    tractWanted = list;
    if (nv3) await loadTracts();  // otherwise applied when the 3D view first opens
  }

  // regions: [{ atlas, value, side, color: [r,g,b] }] in display order.
  let wanted = { regions: [], maskResults: false };
  async function loadRegions() {
    const { regions } = wanted;
    const key = regions.map((r) => `${r.atlas}|${r.value}|${r.side}`).join(",");
    if (key !== regionKey) {
      regionKey = key;
      regionVol = null;
      for (const m of regionMeshes) nv3.removeMesh(m);
      regionMeshes = [];
      if (key) {
        const [buf, meshes] = await Promise.all([
          fetch(`/api/regions/mask.nii.gz?sel=${encodeURIComponent(key)}`).then((r) => r.arrayBuffer()),
          Promise.all(regions.map(async (r) => {
            const sel = encodeURIComponent(`${r.atlas}|${r.value}|${r.side}`);
            const res = await fetch(`/api/regions/mesh.gii?sel=${sel}`);
            if (!res.ok) return null;
            return NVMesh.readMesh(await res.arrayBuffer(), "region.gii", nv3.gl, 1, new Uint8Array([...r.color, 255]), true);
          })),
        ]);
        if (key !== regionKey) return;  // a newer choice arrived meanwhile
        regionMeshes = meshes.filter(Boolean);
        for (const m of regionMeshes) {
          m.updateMesh(nv3.gl);  // readMesh does not upload the buffers to the GPU
          nv3.addMesh(m);
          nv3.setMeshShader(m.id, "Phong");
        }
        regionVol = await NVImage.loadFromUrl({ url: "regions.nii.gz", name: "regions.nii.gz", buffer: buf });
        regionVol.setColormapLabel({
          R: [0, ...regions.map((r) => r.color[0])], G: [0, ...regions.map((r) => r.color[1])],
          B: [0, ...regions.map((r) => r.color[2])], A: [0, ...regions.map(() => 255)],
          I: [0, ...regions.map((_, i) => i + 1)], labels: ["", ...regions.map((r) => r.name)],
        });
      }
    }
    maskResults = wanted.maskResults && !!regionVol;
    // Results inside a region would be hidden by its solid surface: make regions see-through.
    for (const m of regionMeshes) nv3.setMeshProperty(m.id, "opacity", maskResults ? REGION_SEE_THROUGH : 1);
    sync(true);
  }
  async function setRegions(regions, opts = {}) {
    wanted = { regions, maskResults: !!opts.maskResults };
    if (!nv3) return;  // applied when the 3D view first opens
    await loadRegions();
    if (regions.length && style === "surface") setHint("Regions inside the brain are easiest to see with Glass brain.");
  }

  controls.style.addEventListener("click", async (e) => {
    const s = e.target.dataset.style;
    if (!s || s === style) return;
    style = s; store.set("view3dStyle", s);
    await applyStyle();
  });
  function showTransparency() {
    controls.brainTransparency.value = transparency[style];
    controls.brainOut.textContent = `${transparency[style]}%`;
  }
  controls.brainTransparency.addEventListener("input", () => {
    transparency = { ...transparency, [style]: +controls.brainTransparency.value };
    store.set("view3dTransparency", transparency);
    controls.brainOut.textContent = `${transparency[style]}%`;
    if (!nv3) return;
    if (style === "surface") nv3.setOpacity(0, brainOpacity());
    else if (mesh) nv3.setMeshProperty(mesh.id, "opacity", meshOpacity());
    nv3.drawScene();
  });
  showTransparency();
  controls.views.addEventListener("click", (e) => {
    const v = VIEWS[e.target.dataset.view];
    if (v && nv3) nv3.setRenderAzimuthElevation(...v);
  });
  crosshairToggle.addEventListener("change", () => active && sync());

  // "scr" while the 3D tab is open: the render plus the colour bars, same size as the
  // slice captures. Copy right after a redraw (the WebGL canvas is not preserved).
  function capture(drawBars) {
    drawNow();  // must be synchronous: the WebGL canvas is copied right after
    const src = nv3.canvas, out = document.createElement("canvas");
    out.width = W; out.height = H + BAND;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, out.width, out.height);
    const k = Math.min(W / src.width, H / src.height);
    ctx.drawImage(src, (W - src.width * k) / 2, (H - src.height * k) / 2, src.width * k, src.height * k);
    drawBars(ctx, H);
    return new Promise((resolve) => out.toBlob(resolve, "image/png"));
  }

  return {
    show,
    setRegions,
    setTracts,
    get active() { return active; },
    get nv() { return nv3; },
    follow: () => active && sync(),
    capture: (drawBars) => (active && nv3 ? capture(drawBars) : null),
  };
}
