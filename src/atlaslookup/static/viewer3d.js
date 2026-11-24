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
//   inflated fsaverage6, morphed between its pial (0 %) and inflated (100 %) shape, with
//            the hemispheres set apart and shaded by sulcal depth. Overlays and cortical
//            regions are sampled at the pial positions (as in mesh), then drawn wherever
//            the vertex is now. Clicking it looks up the vertex's pial position; the slice
//            crosshair is shown at the nearest vertex. Tracts and region shapes are hidden
//            (they have no place on an inflated surface).
//            This is "Inflated (projection)": every overlay is projected from its volume.
//   inflatedFslr  "Inflated (fsLR)": the user's fsLR 32k surfaces (registered with
//            `add-fslr`), midthickness to inflated. CIFTI maps are painted from their own
//            vertex values, with no projection; volumetric overlays are sampled around the
//            midthickness (2 mm either side), so the two versions of a result can be compared
//            on one brain.
// Projection runs here in the browser, so local overlays still never leave it.
//
// Regions chosen in the Regions window are drawn as solid surfaces in their own
// colours (smooth meshes built by the server from the atlas masks; NiiVue draws flat
// on/off volumes only faintly), are painted onto the mesh brain, and can optionally
// restrict the overlays to inside them. The 3D view is for looking: drag to rotate, scroll to zoom. Clicks to
// look up a point stay on the slices (except on the inflated brain); the slice crosshair is shown here too.

import { NVMesh, NVMeshLayerDefaults, NVMeshUtilities } from "./vendor/niivue-0.69.0.js";
import { BACKGROUNDS, knockOut } from "./viewertools.js";

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
const DEFAULT_TRANSPARENCY = { surface: 0, glass: 75, mesh: 0, inflated: 0, inflatedFslr: 0 };
const PAINTED = new Set(["mesh", "inflated", "inflatedFslr"]);  // styles that paint the overlays onto a surface
const INFLATED = new Set(["inflated", "inflatedFslr"]);  // the two inflated brains
const MID_DEPTHS = [-2, -1, 0, 1, 2];  // mm around the fsLR midthickness sampled for volumetric overlays
const CROSSHAIR_NEAR_MM = 8;  // on the inflated brain, show the crosshair only this close to the cortex
const DEPTHS = [0, 1, 2, 3, 4];  // mm beneath the pial surface sampled for the mesh style
const REGION_SEE_THROUGH = 0.35;
const TRACT_OPACITY = 0.9;  // a touch see-through, so regions behind a tract still show  // region opacity when results are shown only inside them
const W = 2400, H = 800, BAND = 160;  // capture size, matching the slice captures

const FILL = 0.9;  // share of the capture height the brain fills
const AXIS_R = 34, AXIS_GAP = 36;  // axis cross: arm length and gap to the brain (capture px)

/** The part of a black-background render that is not black (padded a little), so a
 *  capture can crop to the brain. The whole canvas if it is all black. */
function contentBox(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      if (d[i] > 10 || d[i + 1] > 10 || d[i + 2] > 10) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  const pad = Math.round(0.03 * Math.max(x1 - x0, y1 - y0));
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** On-screen directions of the anatomical axes for a NiiVue camera: for each axis that
 *  is not pointing (mostly) into the screen, a unit 2D vector (y down) towards its
 *  positive end and the letters of both ends. */
function axisCross(nv) {
  const w = nv.gl.canvas.width, h = nv.gl.canvas.height;
  const [m] = nv.calculateMvpMatrix(null, [0, 0, w, h], nv.scene.renderAzimuth, nv.scene.renderElevation);
  const proj = (X, Y, Z) => {
    const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15];
    return [((m[0] * X + m[4] * Y + m[8] * Z + m[12]) / cw + 1) / 2 * w, (1 - (m[1] * X + m[5] * Y + m[9] * Z + m[13]) / cw) / 2 * h];
  };
  const o = proj(0, 0, 0);
  return axisCrossFrom([[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((d) => {
    const p = proj(...d);
    return [p[0] - o[0], p[1] - o[1]];
  }));
}

/** From the screen vectors of the R, A and S unit axes: the axes to draw. An axis's
 *  on-screen length is compared with that of an axis lying flat in the screen. */
export function axisCrossFrom(vecs) {
  const NAMES = [["R", "L"], ["A", "P"], ["S", "I"]];
  const full = Math.sqrt(vecs.reduce((s, [x, y]) => s + x * x + y * y, 0) / 2) || 1;
  return vecs.map(([x, y], i) => {
    const len = Math.hypot(x, y) / full;
    return len < 0.4 ? null : { dir: [x / Math.hypot(x, y), y / Math.hypot(x, y)], plus: NAMES[i][0], minus: NAMES[i][1] };
  }).filter(Boolean);
}

/** A small cross: one thin line per shown axis, a letter at each end. */
function drawAxisCross(ctx, axes, cx, cy, ink) {
  ctx.save();
  ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2; ctx.lineCap = "round";
  ctx.font = "600 20px system-ui, -apple-system, Helvetica, Arial, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const { dir: [ux, uy], plus, minus } of axes) {
    ctx.beginPath();
    ctx.moveTo(cx - ux * AXIS_R, cy - uy * AXIS_R);
    ctx.lineTo(cx + ux * AXIS_R, cy + uy * AXIS_R);
    ctx.stroke();
    const t = AXIS_R + 16;
    ctx.fillText(plus, cx + ux * t, cy + uy * t);
    ctx.fillText(minus, cx - ux * t, cy - uy * t);
  }
  ctx.restore();
}

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

/** Inflated-brain file (see sources.export_inflated): uint32 nLeft, uint32 n, float32
 * inflated xyz (3n), float32 sulcal grey (n). */
export function parseMorph(buf) {
  const [nLeft, n] = new Uint32Array(buf, 0, 2);
  return { nLeft, n, target: new Float32Array(buf, 8, 3 * n), shade: new Float32Array(buf, 8 + 12 * n, n) };
}

/** Vertex positions t of the way (0-1) from `from` to `to`. */
export function morph(from, to, t, out = new Float32Array(from.length)) {
  for (let i = 0; i < from.length; i++) out[i] = from[i] + t * (to[i] - from[i]);
  return out;
}

/** Index of the vertex nearest to mm among vertices [lo, hi), and its distance. */
export function nearestVertex(pts, mm, lo = 0, hi = pts.length / 3) {
  let best = -1, d2 = Infinity;
  for (let v = lo; v < hi; v++) {
    const dx = pts[3 * v] - mm[0], dy = pts[3 * v + 1] - mm[1], dz = pts[3 * v + 2] - mm[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < d2) { d2 = d; best = v; }
  }
  return { index: best, distance: Math.sqrt(d2) };
}

/** Outward normals for a closed cortical surface: flipped if the left-most vertex's
 * normal points right. */
function outwardNormals(pts, tris) {
  const normals = NVMeshUtilities.generateNormals(pts, tris);
  let lm = 0;
  for (let v = 1; v < pts.length / 3; v++) if (pts[3 * v] < pts[3 * lm]) lm = v;
  if (normals[3 * lm] > 0) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
  return normals;
}

const samplerOf = (vol) => volumeSampler({
  img: vol.img, dims: vol.hdr.dims.slice(1, 4), affine: vol.hdr.affine,
  slope: vol.hdr.scl_slope || 1, inter: vol.hdr.scl_inter || 0,
});

// --- the view ------------------------------------------------------------------------

export function createViewer3D({ Niivue, NVImage, getNv, store, wrap, canvas, controls, crosshairToggle, setHint, onPick, focus }) {
  // Focus swaps this whole-brain scene for focus3d.js's, in the same panel. (Before 0.21.1
  // the store held which focus; any of them now means Focus.)
  let focused = !!store.get("view3dFocus", "") && !!focus;
  let nv3 = null, ready = null, mesh = null, normals = null, active = false;
  // Inflated brains, loaded on first use: { mesh, pial, normals, target, shade, nLeft, allTris }.
  // "fsaverage6" is the usual one; "fslr" (the user's fsLR 32k surfaces) when a CIFTI map
  // is shown. `infl` is the one in use. (For fsLR, "pial" holds the midthickness.)
  const INFL_FILES = {
    fsaverage6: ["/api/inflated_mesh.gii", "/api/inflated_morph.bin"],
    fslr: ["/api/fslr_mesh.gii", "/api/fslr_morph.bin"],
  };
  const inflSets = {}, inflErrors = {};
  let infl = null, inflError = null, inflKind = "fsaverage6";
  const surfaceCache = new Map();  // CIFTI map id -> Float32Array per fsLR vertex (0 = none), or a pending promise
  let inflation = store.get("view3dInflation", 100), hemi = store.get("view3dHemi", "both");
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
  const meshOpacity = () => Math.max(brainOpacity(), PAINTED.has(style) ? 0.002 : 0);

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
    // Sampling goes inwards, so normals must point out of the brain.
    normals = outwardNormals(mesh.pts, mesh.tris);
    return mesh;
  }

  // Each brain loads once, even when several redraws ask for it at the same time.
  const inflLoading = {};
  function loadInflated(kind) {
    if (inflSets[kind] || inflErrors[kind]) return Promise.resolve(inflSets[kind] || null);
    return (inflLoading[kind] ||= fetchInflated(kind).finally(() => { delete inflLoading[kind]; }));
  }
  async function fetchInflated(kind) {
    const [g, b] = await Promise.all(INFL_FILES[kind].map((u) => fetch(u)));
    if (!g.ok || !b.ok) {
      inflErrors[kind] = (await (g.ok ? b : g).json().catch(() => ({}))).detail || "Inflated brain unavailable.";
      return null;
    }
    const m = await NVMesh.readMesh(await g.arrayBuffer(), `${kind}.gii`, nv3.gl, brainOpacity(), new Uint8Array(MESH_RGBA), true);
    const { nLeft, target, shade } = parseMorph(await b.arrayBuffer());
    const pial = Float32Array.from(m.pts);
    const set = { kind, mesh: m, pial, normals: outwardNormals(pial, m.tris), target, shade, nLeft, allTris: Uint32Array.from(m.tris) };
    inflSets[kind] = set;
    m.updateMesh(nv3.gl);
    nv3.addMesh(m);
    nv3.meshes.splice(nv3.meshes.indexOf(m), 1);  // brains first (see ensureMesh)
    nv3.meshes.unshift(m);
    nv3.setMeshProperty(m.id, "visible", false);
    return set;
  }
  // The CIFTI maps among the overlays (their slice volumes carry .cifti = map id).
  const ciftiMaps = () => clones.map(({ src }) => src.cifti).filter(Boolean);
  // Which inflated brain to show: fsLR when a CIFTI map is shown and the surfaces load.
  // The brain for the current style: fsaverage6 (projection) or fsLR.
  async function ensureInflated() {
    const kind = style === "inflatedFslr" ? "fslr" : "fsaverage6";
    const set = await loadInflated(kind);
    for (const k of Object.keys(inflSets)) if (inflSets[k] !== set) nv3.setMeshProperty(inflSets[k].mesh.id, "visible", false);
    if (set !== infl) layersDirty = true;
    infl = set;
    inflKind = set?.kind || kind;
    inflError = set ? null : inflErrors[kind];
    if (infl) { applyHemi(false); applyInflation(false); infl.mesh.updateMesh(nv3.gl); }
    return infl;
  }
  // A CIFTI map's values per fsLR vertex (NaN -> 0, so they are transparent like 0).
  function surfaceValues(id) {
    const c = surfaceCache.get(id);
    if (c instanceof Float32Array) return c;
    if (!c) {
      surfaceCache.set(id, fetch(`/api/results/surface/${id.split("/").map(encodeURIComponent).join("/")}`).then(async (r) => {
        if (!r.ok) {
          surfaceCache.delete(id);
          setHint((await r.json().catch(() => ({}))).detail || "Could not read the map's cortex.");
          return;
        }
        const buf = await r.arrayBuffer();
        const v = Float32Array.from(new Float32Array(buf, 8), (x) => (Number.isFinite(x) ? x : 0));
        surfaceCache.set(id, v);
        layersDirty = true;
        sync();
      }));
    }
    return null;
  }
  // Move every vertex `inflation` % of the way from its pial to its inflated position.
  function applyInflation(redraw = true) {
    morph(infl.pial, infl.target, inflation / 100, infl.mesh.pts);
    if (redraw) { infl.mesh.updateMesh(nv3.gl); placeCrosshair(); nv3.drawScene(); }
  }
  // Keep only one hemisphere's triangles (left vertices come first in the file).
  function applyHemi(redraw = true) {
    const { allTris, nLeft } = infl;
    infl.mesh.tris = hemi === "both" ? allTris : allTris.filter((_, i, t) => {
      const first = t[i - (i % 3)];
      return hemi === "left" ? first < nLeft : first >= nLeft;
    });
    if (redraw) { infl.mesh.updateMesh(nv3.gl); placeCrosshair(); nv3.drawScene(); }
  }
  const hemiRange = () => (hemi === "left" ? [0, infl.nLeft] : hemi === "right" ? [infl.nLeft, infl.pial.length / 3] : [0, infl.pial.length / 3]);
  // The slice crosshair on the inflated brain: at the vertex nearest to it, if any is close.
  function placeCrosshair() {
    if (!INFLATED.has(style) || !infl) return;
    const nv = getNv(), mm = nv.frac2mm(nv.scene.crosshairPos);
    const { index, distance } = nearestVertex(infl.pial, mm, ...hemiRange());
    const near = index >= 0 && distance <= CROSSHAIR_NEAR_MM;
    nv3.opts.show3Dcrosshair = crosshairToggle.checked && near;
    if (near) nv3.scene.crosshairPos = nv3.mm2frac(Array.from(infl.mesh.pts.slice(3 * index, 3 * index + 3)));
  }

  async function applyStyle() {
    showFocusMode();
    showTransparency();
    controls.inflBar.hidden = !INFLATED.has(style);
    nv3.setOpacity(0, style === "surface" ? brainOpacity() : 0);
    if (INFLATED.has(style)) {
      if (mesh) nv3.setMeshProperty(mesh.id, "visible", false);
      await ensureInflated();
      if (!infl) { setHint(inflError); }
      else if (style === "inflated" && ciftiMaps().length) {
        setHint("Projection shows a CIFTI map's voxels only; its cortex is on Inflated (fsLR).");
      }
      if (infl) {
        nv3.setMeshProperty(infl.mesh.id, "visible", true);
        nv3.setMeshShader(infl.mesh.id, MESH_SHADER);
        nv3.setMeshProperty(infl.mesh.id, "opacity", meshOpacity());
        if (regionMeshes.length || tractMeshes.length) {
          setHint("Inflated brain: cortical regions are painted on it; tracts and deep regions are hidden. Click it to look up a point.");
        }
      }
    } else if (style === "surface") {
      if (mesh) nv3.setMeshProperty(mesh.id, "visible", false);
    } else {
      await ensureMesh();
      const glass = style === "glass";
      nv3.setMeshProperty(mesh.id, "visible", true);
      nv3.setMeshShader(mesh.id, glass ? "Rim" : MESH_SHADER);
      nv3.setMeshProperty(mesh.id, "rgba255", glass ? GLASS_RGBA : MESH_RGBA);
      nv3.setMeshProperty(mesh.id, "opacity", meshOpacity());
    }
    if (!INFLATED.has(style)) for (const k of Object.keys(inflSets)) nv3.setMeshProperty(inflSets[k].mesh.id, "visible", false);
    if (!INFLATED.has(style) && ciftiMaps().length) setHint("This CIFTI map shows only its voxels here; its cortex is on Inflated (fsLR).");
    showShapes();
    layersDirty = true;
    sync(true);
  }
  // Region and tract surfaces: hidden on the inflated brain.
  function showShapes() {
    for (const m of [...regionMeshes, ...tractMeshes]) nv3.setMeshProperty(m.id, "visible", !INFLATED.has(style));
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
    // The painted surface (pial positions and normals to sample at), if this style has one.
    const surfaces = [mesh && { m: mesh, pts: mesh.pts, normals, on: style === "mesh" },
      ...Object.values(inflSets).map((I) => ({ m: I.mesh, pts: I.pial, normals: I.normals, on: INFLATED.has(style) && I === infl,
        shade: I.shade, fslr: I.kind === "fslr" }))].filter(Boolean);
    for (const S of surfaces) if (!S.on && S.m.layers.length) { S.m.layers = []; S.m.updateMesh(nv3.gl); }
    const S = surfaces.find((x) => x.on);
    if (!S) return;
    const target = S.m;
    // Sulcal shading: an opaque grey layer under everything else.
    const base = S.shade ? [{ ...NVMeshLayerDefaults, name: "sulcal depth", frame4D: 0, nFrame4D: 1, values: S.shade,
      colormap: "gray", cal_min: 0, cal_max: 1, opacity: 1, isTransparentBelowCalMin: false }] : [];
    const sources = clones.map(({ src, copy }) => ({ src, vol: copy, label: !!src.colormapLabel }));
    if (regionVol) sources.push({ src: regionVol, vol: regionVol, label: true });
    if (layersDirty || target.layers.length !== base.length + sources.length) {
      // A CIFTI map on fsLR: its own vertex values (once fetched); everything else is
      // projected from its volume. (On other surfaces a CIFTI map shows its voxels only.)
      const valuesFor = ({ src, vol, label }) => {
        if (S.fslr && src.cifti) {
          const v = surfaceValues(src.cifti);
          if (v && v.length === S.pts.length / 3) return v;
          if (v) setHint("The CIFTI map's cortex does not match the registered fsLR surfaces.");
          return new Float32Array(S.pts.length / 3);
        }
        // pial surfaces: inwards 0-4 mm; the fsLR midthickness: 2 mm either side.
        return projectToVertices(samplerOf(vol), S.pts, S.normals, label ? [1, 2] : S.fslr ? MID_DEPTHS : DEPTHS, label);
      };
      target.layers = [...base, ...sources.map((x) => ({
        ...NVMeshLayerDefaults, name: x.vol.name, frame4D: 0, nFrame4D: 1, values: valuesFor(x),
      }))];
      layersDirty = false;
    }
    target.layers.slice(base.length).forEach((L, i) => {
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
    target.updateMesh(nv3.gl);
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
    const onMesh = PAINTED.has(style);  // overlays are painted on the surface instead
    for (const { src: v, copy } of clones) {
      for (const k of DISPLAY_KEYS) if (k in v) copy[k] = v[k];
      copy.colormapLabel = v.colormapLabel ?? null;
      if (onMesh) copy.opacity = 0;
    }
    updateLayers();
    nv3.opts.show3Dcrosshair = crosshairToggle.checked;
    nv3.scene.crosshairPos = [...getNv().scene.crosshairPos];  // same template, same fractions
    placeCrosshair();
    nv3.updateGLVolume();
  }
  let syncTimer;
  const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(), 120); };

  // Follow every change on the slice viewer (overlays added, thresholds dragged, ...).
  const nv = getNv();
  const update = nv.updateGLVolume.bind(nv);
  let focusTimer;
  const focusSources = () => focus?.setSources(getNv().volumes.slice(1));
  nv.updateGLVolume = (...args) => {
    const r = update(...args);
    if (active && focused) { clearTimeout(focusTimer); focusTimer = setTimeout(focusSources, 120); }
    else if (active) scheduleSync();
    return r;
  };

  // Focus sits with the styles; picking another style leaves it.
  function showFocusMode() {
    for (const b of controls.style.querySelectorAll("button")) {
      b.classList.toggle("on", focused ? b.dataset.style === "focus" : b.dataset.style === style);
    }
    controls.whole.hidden = focused;
    canvas.hidden = focused;
  }
  async function setFocus(on) {
    focused = on;
    store.set("view3dFocus", on ? "all" : "");
    showFocusMode();
    if (active) { await focus?.show(false); await show(true); }
  }
  showFocusMode();

  // Camera of a saved view (rotation and zoom), applied the first time the view it was
  // taken in (whole brain or focus) is shown.
  let pendingCamera = null;
  function applyCamera(view, isFocus) {
    const c = pendingCamera;
    if (!c || !view || !!c.focus !== isFocus) return;
    pendingCamera = null;
    if (Number.isFinite(c.zoom)) view.scene.volScaleMultiplier = c.zoom;
    if (Number.isFinite(c.az) && Number.isFinite(c.el)) view.setRenderAzimuthElevation(c.az, c.el);
    view.drawScene();
  }
  async function show(on) {
    active = on;
    wrap.hidden = !on;
    controls.bar.hidden = !on;
    if (focus && (!on || focused)) {
      await focus.show(on && focused);
      if (on) { focusSources(); applyCamera(focus.nv, true); return; }
    }
    if (!on) return;
    if (!ready) ready = init().then(() => Promise.all([loadRegions(), loadTracts()]));
    await ready;
    await applyStyle();
    applyCamera(nv3, false);
    nv3.resizeListener?.();
    nv3.drawScene();
    setHint(INFLATED.has(style) && infl ? "3D: drag to rotate, scroll to zoom. Click the inflated brain (or the slices) to look up a point."
      : INFLATED.has(style) ? inflError : "3D: drag to rotate, scroll to zoom. Click on the slices to look up a point.");
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
    showShapes();
    nv3.drawScene();
  }
  async function setTracts(list) {
    tractWanted = list;
    if (nv3) await loadTracts();  // otherwise applied when the 3D view first opens
  }

  // regions: [{ atlas, value, side, color: [r,g,b] }] in display order.
  let wanted = { regions: [], maskResults: false };
  const regionKeyOf = (r) => `${r.atlas}|${r.value}|${r.side}`;
  const labelColormap = (regions) => ({
    R: [0, ...regions.map((r) => r.color[0])], G: [0, ...regions.map((r) => r.color[1])],
    B: [0, ...regions.map((r) => r.color[2])], A: [0, ...regions.map(() => 255)],
    I: [0, ...regions.map((_, i) => i + 1)], labels: ["", ...regions.map((r) => r.name)],
  });
  // Colours only (a swatch edited): repaint the meshes and the label layer, no reload.
  // Uses the latest choice, so a load that finishes later still gets the new colours.
  function recolorRegions() {
    const color = new Map(wanted.regions.map((r) => [regionKeyOf(r), r.color]));
    for (const m of regionMeshes) {
      const c = color.get(m.regionKey);
      if (c && Array.from(m.rgba255.slice(0, 3)).join() !== c.join()) nv3.setMeshProperty(m.id, "rgba255", new Uint8Array([...c, 255]));
    }
    if (regionVol && regionKey === wanted.regions.map(regionKeyOf).join(",")) regionVol.setColormapLabel(labelColormap(wanted.regions));
  }
  async function loadRegions() {
    const { regions } = wanted;
    const key = regions.map(regionKeyOf).join(",");
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
            const m = await NVMesh.readMesh(await res.arrayBuffer(), "region.gii", nv3.gl, 1, new Uint8Array([...r.color, 255]), true);
            m.regionKey = regionKeyOf(r);
            return m;
          })),
        ]);
        if (key !== regionKey) return;  // a newer choice arrived meanwhile
        regionMeshes = meshes.filter(Boolean);
        for (const m of regionMeshes) {
          m.updateMesh(nv3.gl);  // readMesh does not upload the buffers to the GPU
          nv3.addMesh(m);
          nv3.setMeshShader(m.id, "Phong");
        }
        showShapes();
        regionVol = await NVImage.loadFromUrl({ url: "regions.nii.gz", name: "regions.nii.gz", buffer: buf });
        regionVol.setColormapLabel(labelColormap(regions));
      }
    }
    recolorRegions();
    maskResults = wanted.maskResults && !!regionVol;
    // Results inside a region would be hidden by its solid surface: make regions see-through.
    for (const m of regionMeshes) nv3.setMeshProperty(m.id, "opacity", maskResults ? REGION_SEE_THROUGH : 1);
    sync(true);
  }
  async function setRegions(regions, opts = {}) {
    const before = wanted;
    wanted = { regions, maskResults: !!opts.maskResults };
    if (!nv3) return;  // applied when the 3D view first opens
    if (before.maskResults === wanted.maskResults && before.regions.map(regionKeyOf).join() === regions.map(regionKeyOf).join()) {
      recolorRegions();  // same regions, new colours
      sync();
      return;
    }
    await loadRegions();
    if (regions.length && style === "surface") setHint("Regions inside the brain are easiest to see with Glass brain.");
  }

  controls.style.addEventListener("click", async (e) => {
    const s = e.target.closest("button")?.dataset.style;
    if (!s) return;
    if (s === "focus") { if (!focused) await setFocus(true); return; }
    if (s === style && !focused) return;
    style = s; store.set("view3dStyle", s);
    if (focused) { await setFocus(false); return; }
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
    else if (INFLATED.has(style)) { if (infl) nv3.setMeshProperty(infl.mesh.id, "opacity", meshOpacity()); }
    else if (mesh) nv3.setMeshProperty(mesh.id, "opacity", meshOpacity());
    nv3.drawScene();
  });
  showTransparency();
  controls.views.addEventListener("click", (e) => {
    const v = VIEWS[e.target.dataset.view];
    if (v && focused) focus?.setView(...v);
    else if (v && nv3) nv3.setRenderAzimuthElevation(...v);
  });
  crosshairToggle.addEventListener("change", () => active && sync());

  // Inflated brain controls: how inflated, and which hemispheres.
  function showInflControls() {
    controls.inflation.value = inflation;
    controls.inflationOut.textContent = `${inflation}%`;
    for (const b of controls.hemi.querySelectorAll("button")) b.classList.toggle("on", b.dataset.hemi === hemi);
  }
  showInflControls();
  controls.inflation.addEventListener("input", () => {
    inflation = +controls.inflation.value;
    store.set("view3dInflation", inflation);
    showInflControls();
    if (infl) applyInflation();
  });
  controls.hemi.addEventListener("click", (e) => {
    const h = e.target.dataset.hemi;
    if (!h || h === hemi) return;
    hemi = h; store.set("view3dHemi", h);
    showInflControls();
    if (infl) applyHemi();
  });
  // A click (not a drag) on the inflated brain looks up the clicked vertex's pial position.
  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener("pointerup", (e) => {
    const click = down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4;
    down = null;
    if (!click || !INFLATED.has(style) || !infl) return;
    // NiiVue picks a 3D point only on double-click: ask it to pick on this draw (it reads
    // the depth under mousePos) and catch the point it reports.
    let picked = null;
    nv3.onLocationChange = (d) => { picked = Array.from(d.mm.slice(0, 3)); };
    const r = canvas.getBoundingClientRect(), dpr = nv3.uiData.dpr || 1;
    nv3.mousePos = [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
    const before = Array.from(nv3.scene.crosshairPos);
    nv3.uiData.mouseDepthPicker = true;
    drawNow();
    nv3.onLocationChange = () => {};
    // A miss reports the unchanged crosshair.
    if (!picked || Array.from(nv3.scene.crosshairPos).every((v, i) => v === before[i])) return;
    const { index, distance } = nearestVertex(infl.mesh.pts, picked, ...hemiRange());
    if (index < 0 || distance > 3) return;
    onPick?.(Array.from(infl.pial.slice(3 * index, 3 * index + 3), Math.round));
  });

  // The camera button while the 3D tab is open: the render plus the colour bars (unless
  // bars is false), the same size as a three-slice capture. The brain is cropped to fill
  // the height, and NiiVue's orientation cube is replaced by a small axis cross drawn
  // beside the brain. Copy right after a redraw (the WebGL canvas is not preserved). A
  // white or transparent background replaces the black around the brain.
  function capture(drawBars, { background = "black", bars = true } = {}) {
    const bg = BACKGROUNDS[background] || BACKGROUNDS.black;
    const view = focused ? focus.nv : nv3;
    const src = focused ? focus.canvas : nv3.canvas;
    // must be synchronous: the WebGL canvas is copied right after
    const redraw = () => (focused ? focus.redraw() : drawNow());
    const copy = () => {
      const c = document.createElement("canvas");
      c.width = src.width; c.height = src.height;
      c.getContext("2d").drawImage(src, 0, 0);
      return c;
    };
    const { isOrientCube: cube, show3Dcrosshair: cross } = view.opts;
    // The crop comes from a render without the crosshair (its lines reach past the
    // brain); the image itself keeps the crosshair if it is on.
    view.opts.isOrientCube = false;
    view.opts.show3Dcrosshair = false;
    redraw();
    const box = contentBox(copy());
    view.opts.show3Dcrosshair = cross;
    redraw();
    const raw = copy();
    view.opts.isOrientCube = cube;
    view.drawScene();
    const axes = axisCross(view);

    const out = document.createElement("canvas");
    out.width = W; out.height = H + (bars ? BAND : 0);
    const ctx = out.getContext("2d");
    const pic = document.createElement("canvas");
    pic.width = W; pic.height = H;
    const pctx = pic.getContext("2d");
    pctx.fillStyle = "#000"; pctx.fillRect(0, 0, W, H);
    const k = Math.min((W * 0.8) / box.w, (H * FILL) / box.h);
    const dw = box.w * k, dh = box.h * k, dx = (W - dw) / 2, dy = (H - dh) / 2;
    pctx.drawImage(raw, box.x, box.y, box.w, box.h, dx, dy, dw, dh);
    if (background !== "black") knockOut(pic);
    if (bg.fill) { ctx.fillStyle = bg.fill; ctx.fillRect(0, 0, out.width, out.height); }
    ctx.drawImage(pic, 0, 0);
    // The axis cross just left of the brain's lower corner (inside the image if the brain
    // is too wide to leave room).
    const cx = Math.max(AXIS_R + 40, dx - AXIS_GAP - AXIS_R), cy = Math.min(H - AXIS_R - 30, dy + dh - AXIS_R);
    drawAxisCross(ctx, axes, cx, cy, bg.ink);
    if (bars) drawBars(ctx, H, { width: W, height: BAND, ink: bg.ink });
    return new Promise((resolve) => out.toBlob(resolve, "image/png"));
  }

  return {
    show,
    setRegions,
    setTracts,
    get active() { return active; },
    get nv() { return nv3; },
    /** The camera on screen ({az, el, zoom, focus}), or null before the 3D view has opened. */
    camera() {
      const v = focused ? focus?.nv : nv3;
      return v ? { az: v.scene.renderAzimuth, el: v.scene.renderElevation, zoom: v.scene.volScaleMultiplier, focus: focused } : null;
    },
    /** Use this camera the next time the 3D view (whole brain or focus, as saved) opens. */
    setCamera(c) {
      pendingCamera = c || null;
      if (active) applyCamera(focused ? focus?.nv : nv3, focused);
    },
    follow: () => active && sync(),
    capture: (drawBars, opts) => (active && (focused || nv3) ? capture(drawBars, opts) : null),
  };
}
