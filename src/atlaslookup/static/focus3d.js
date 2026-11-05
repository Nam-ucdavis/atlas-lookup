// "Focus" in the 3D tab: the brain as see-through structures with solid outlines, lobe
// by lobe (frontal, insula & operculum, cingulate, parietal, temporal with the medial
// temporal lobe, occipital, subcortical), each switched on or off in the legend, the
// slice viewer's results drawn as blobs or painted onto them. A lobe's structures load
// the first time it is switched on; the camera frames the lobes shown, one lobe (click
// its name) or the Limbic preset's structures.
//
// Its own NiiVue instance on its own canvas, holding meshes only, so the camera frames
// and rotates around the structures rather than the whole template. Structures come
// from the region meshes the server builds (/api/regions/mesh.gii), smoothed here; every
// continuous overlay on the slices (results-folder maps, local NIfTI layers) is
// projected onto them like the mesh brain does, with the overlay's own threshold and
// colours. A legend lists each structure with the peak T inside its whole volume
// (front-most map) and how much of it passes the threshold; click a peak, or a
// structure, to look the point up.

import { NVMesh, NVMeshLayerDefaults, NVMeshUtilities } from "./vendor/niivue-0.69.0.js";
import { volumeSampler, projectToVertices } from "./viewer3d.js";

// Colours: distinct hues, so neighbouring structures (CA / dentate gyrus / subiculum)
// read apart, kept below full saturation: the shader tells painted results (fully
// saturated) from structure tints by saturation.
const C = {
  violet: [170, 120, 240], gold: [235, 205, 110], cyan: [90, 200, 215], green: [120, 210, 120],
  pink: [240, 130, 195], orange: [235, 150, 110], brick: [215, 110, 110], tan: [200, 180, 140], blue: [120, 140, 240],
  lime: [180, 220, 100], silver: [205, 205, 235],
};
// Cuts (see regions.parse_clip): PFC ends at y = +10 mm (premotor cortex behind it, in
// the Motor group), and the superior frontal gyrus is split at |x| = 20 mm into its
// medial and lateral parts.
const PFC = "y>=10", PREMOTOR = "y<10", SFG_MEDIAL = "ax<=20;y>=10", SFG_LATERAL = "ax>20;y>=10";
// Each lobe: a camera view (when zoomed to it) and a list of groups of structures,
// { name, parts: [{ atlas, value, right?, mid?, name, color, clip?, limbic? }] }. Every
// structure is in one lobe only. With `right`, the atlas has one region per hemisphere
// already (value = left, right = right); with `mid`, one region on the midline (shown
// with either hemisphere); otherwise the region is split at the midline. clip cuts the
// region (see regions.parse_clip). limbic: part of the Limbic preset.
const g = (name, ...parts) => ({ name, parts });
const L = (part) => ({ ...part, limbic: true });
const ho = (value, name, color, clip) => ({ atlas: "harvard-oxford-cort", value, name, color, clip });
const ds = (value, name, color, clip) => ({ atlas: "destrieux2009", value, right: value + 75, name, color, clip });
const sub = (value, right, name, color) => ({ atlas: "harvard-oxford-sub", value, right, name, color });
const tal = (value, name, color) => ({ atlas: "talairach-ba", value, name, color });
// The medial temporal lobe, part of the temporal lobe: Juelich subfields (2 mm
// maximum-probability maps, so coarse, and some sit inside others) with the Destrieux
// parahippocampal gyrus and collateral sulcus.
const MTL = [
  g("Hippocampal formation",
    L({ atlas: "juelich", value: 9, name: "Cornu ammonis (CA)", color: C.violet }),
    L({ atlas: "juelich", value: 10, name: "Dentate gyrus", color: C.gold }),
    L({ atlas: "juelich", value: 13, name: "Subiculum", color: C.cyan }),
    L({ atlas: "juelich", value: 12, name: "Hippocampal-amygdaloid transition area", color: C.pink })),
  g("Parahippocampal region",
    L({ atlas: "juelich", value: 11, name: "Entorhinal cortex", color: C.green }),
    L(ds(23, "Parahippocampal gyrus", C.gold)),
    L(ds(62, "Collateral sulcus (perirhinal cortex)", C.blue))),
  g("Amygdala",
    L({ atlas: "juelich", value: 1, name: "Amygdala, centromedial", color: C.orange }),
    L({ atlas: "juelich", value: 2, name: "Amygdala, laterobasal", color: C.brick }),
    L({ atlas: "juelich", value: 3, name: "Amygdala, superficial", color: C.tan })),
];
export const FOCI = {
  pfc: {
    label: "Frontal", view: [150, 15],
    groups: [
      g("Ventromedial PFC", L(ho(25, "Frontal medial cortex", C.violet))),
      g("Dorsomedial PFC", ho(3, "Superior frontal gyrus, medial part", C.orange, SFG_MEDIAL)),
      g("Orbitofrontal (lateral / central)", ho(33, "Frontal orbital cortex", C.brick)),
      g("Dorsolateral PFC",
        ho(4, "Middle frontal gyrus", C.blue, PFC),
        ho(3, "Superior frontal gyrus, lateral part", C.tan, SFG_LATERAL)),
      g("Ventrolateral PFC",
        ho(5, "Inferior frontal gyrus, pars triangularis", C.gold),
        ho(6, "Inferior frontal gyrus, pars opercularis", C.lime)),
      g("Frontopolar", ho(1, "Frontal pole", C.silver)),
      g("Motor & premotor",
        ho(7, "Precentral gyrus", C.cyan),
        ho(26, "Juxtapositional lobule (SMA / pre-SMA)", C.green),
        ho(3, "Superior frontal gyrus, posterior (premotor)", C.pink, PREMOTOR),
        ho(4, "Middle frontal gyrus, posterior (premotor)", C.violet, PREMOTOR)),
    ],
  },
  insula: {
    label: "Insula & operculum", view: [95, 5],
    groups: [
      g("Insula", ho(2, "Insular cortex", C.gold)),
      g("Opercula",
        ho(41, "Frontal operculum", C.pink),
        ho(42, "Central opercular cortex", C.cyan),
        ho(43, "Parietal operculum", C.green)),
    ],
  },
  parietal: {
    label: "Parietal", view: [45, 30],
    groups: [
      g("Superior parietal", ho(18, "Superior parietal lobule", C.blue)),
      g("Inferior parietal",
        ho(19, "Supramarginal gyrus, anterior", C.orange),
        ho(20, "Supramarginal gyrus, posterior", C.gold),
        ho(21, "Angular gyrus", C.green)),
      g("Medial parietal", ho(31, "Precuneus", C.violet)),
      g("Somatosensory", ho(17, "Postcentral gyrus", C.cyan)),
    ],
  },
  cingulate: {
    label: "Cingulate", view: [70, 20],
    groups: [
      g("Anterior cingulate",
        L(ho(29, "Anterior cingulate gyrus", C.cyan)),
        ho(28, "Paracingulate gyrus", C.green),
        L(ho(27, "Subcallosal cortex (subgenual ACC)", C.pink))),
      g("Posterior cingulate",
        L(ho(30, "Posterior cingulate gyrus", C.orange)),
        L(ds(10, "Retrosplenial cortex (cingulate isthmus)", C.violet))),
    ],
  },
  // Lateral, ventral and medial temporal cortex.
  temporal: {
    label: "Temporal", view: [110, 10],
    groups: [
      g("Temporal pole", ho(8, "Temporal pole", C.silver)),
      g("Superior temporal",
        ho(9, "Superior temporal gyrus, anterior", C.lime),
        ho(10, "Superior temporal gyrus, posterior", C.gold),
        ho(44, "Planum polare", C.tan),
        ho(45, "Heschl's gyrus", C.brick),
        ho(46, "Planum temporale", C.pink)),
      g("Middle temporal",
        ho(11, "Middle temporal gyrus, anterior", C.cyan),
        ho(12, "Middle temporal gyrus, posterior", C.blue),
        ho(13, "Middle temporal gyrus, temporo-occipital", C.silver)),
      g("Inferior temporal",
        ho(14, "Inferior temporal gyrus, anterior", C.green),
        ho(15, "Inferior temporal gyrus, posterior", C.lime),
        ho(16, "Inferior temporal gyrus, temporo-occipital", C.tan)),
      g("Ventral temporal (fusiform)",
        ho(37, "Temporal fusiform cortex, anterior", C.pink),
        ho(38, "Temporal fusiform cortex, posterior", C.violet),
        ho(39, "Temporo-occipital fusiform cortex", C.gold)),
      ...MTL,
    ],
  },
  // The temporo-occipital fusiform cortex is in the temporal lobe.
  occipital: {
    label: "Occipital", view: [20, 15],
    groups: [
      g("Medial occipital",
        ho(24, "Intracalcarine cortex", C.violet),
        ho(47, "Supracalcarine cortex", C.pink),
        ho(32, "Cuneus", C.cyan),
        ho(36, "Lingual gyrus", C.gold)),
      g("Lateral occipital",
        ho(22, "Lateral occipital cortex, superior", C.blue),
        ho(23, "Lateral occipital cortex, inferior", C.green)),
      g("Ventral occipital", ho(40, "Occipital fusiform gyrus", C.orange)),
      g("Occipital pole", ho(48, "Occipital pole", C.silver)),
    ],
  },
  // Harvard-Oxford subcortical; the limbic circuit's thalamic nucleus, mammillary bodies and
  // hypothalamus from the Talairach Daemon, the fornix from the JHU white-matter labels.
  subcortical: {
    label: "Subcortical", view: [120, 25],
    groups: [
      g("Basal ganglia",
        sub(5, 16, "Caudate", C.blue),
        sub(6, 17, "Putamen", C.pink),
        sub(7, 18, "Pallidum", C.green),
        sub(11, 21, "Nucleus accumbens", C.gold)),
      g("Thalamus", sub(4, 15, "Thalamus", C.silver)),
      g("Limbic circuit",
        L(tal(52, "Anterior thalamic nucleus", C.violet)),
        L(tal(24, "Mammillary body", C.orange)),
        L(tal(19, "Hypothalamus", C.brick)),
        L({ atlas: "jhu-labels", value: 6, mid: true, name: "Fornix, column and body", color: C.lime }),
        L({ atlas: "jhu-labels", value: 40, right: 39, name: "Fornix, crus (with stria terminalis)", color: C.tan })),
      g("Brainstem", { atlas: "harvard-oxford-sub", value: 8, mid: true, name: "Brainstem", color: C.tan }),
    ],
  },
};
// The lobes in legend order (top to bottom).
export const LOBES = ["pfc", "insula", "cingulate", "parietal", "temporal", "occipital", "subcortical"];

/** The structures of some lobes (a key of FOCI, or a list of them) to draw for a
 * hemisphere ("both" | "L" | "R"), group by group, with the atlas|value|side[|clip] key
 * the region endpoints take, their lobe and the index of their group in it. Midline
 * structures (hemi "M") come with either hemisphere. */
export function focusParts(lobes, hemi) {
  const out = [];
  for (const lobe of [lobes].flat()) {
    FOCI[lobe].groups.forEach((grp, gi) => {
      for (const { atlas, value, right, mid, name, color, clip, limbic } of grp.parts) {
        for (const h of mid ? ["M"] : ["L", "R"]) {
          if (hemi !== "both" && h !== "M" && hemi !== h) continue;
          const v = right && h === "R" ? right : value, s = right || mid ? "B" : h;
          out.push({ atlas, value: v, side: s, name, hemi: h, color, lobe, group: gi, limbic: !!limbic,
            key: `${atlas}|${v}|${s}${clip ? `|${clip}` : ""}` });
        }
      }
    });
  }
  return out;
}

/** Taubin smoothing (shrink, then inflate back), in place: rounds off the 1-2 mm voxel
 * steps of a mask surface without shrinking the structure. */
export function smoothMesh(pts, tris, iters = 60, lambda = 0.5, mu = -0.53) {
  const n = pts.length / 3, nbr = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    nbr[a].add(b).add(c); nbr[b].add(a).add(c); nbr[c].add(a).add(b);
  }
  const adj = nbr.map((s) => [...s]), tmp = new Float32Array(pts.length);
  const step = (f) => {
    for (let v = 0; v < n; v++) {
      const N = adj[v];
      for (let k = 0; k < 3; k++) {
        if (!N.length) { tmp[3 * v + k] = pts[3 * v + k]; continue; }
        let m = 0;
        for (const u of N) m += pts[3 * u + k];
        tmp[3 * v + k] = pts[3 * v + k] + f * (m / N.length - pts[3 * v + k]);
      }
    }
    pts.set(tmp);
  };
  for (let i = 0; i < iters; i++) { step(lambda); step(mu); }
  return pts;
}

// Normals pointing out of a closed surface: flipped if they point towards its centre on average.
function outwardNormals(pts, tris) {
  const n = NVMeshUtilities.generateNormals(pts, tris), c = [0, 0, 0], nv = pts.length / 3;
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) c[k] += pts[3 * i + k] / nv;
  let dot = 0;
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) dot += (pts[3 * i + k] - c[k]) * n[3 * i + k];
  if (dot < 0) for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return n;
}

/** Per structure (mask value k = structure k), the strongest positive and negative value
 * of `sample` inside it, where, the size (mm³) and how much passes posThr / negThr
 * (null = that sign not shown). The mask is the 1 mm MNI grid from /api/regions/mask. */
export function structurePeaks(mask, sample, posThr, negThr) {
  const { img, dims: [nx, ny, nz], affine: a } = mask, out = {};
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const lab = img[i + nx * (j + ny * k)];
    if (!lab) continue;
    const x = a[0][0] * i + a[0][3], y = a[1][1] * j + a[1][3], z = a[2][2] * k + a[2][3];
    const t = sample(x, y, z);
    const o = out[lab] ??= { pos: 0, posAt: null, neg: 0, negAt: null, n: 0, above: 0 };
    o.n++;
    if (t > o.pos) { o.pos = t; o.posAt = [x, y, z]; }
    if (t < o.neg) { o.neg = t; o.negAt = [x, y, z]; }
    if ((posThr != null && t >= posThr) || (negThr != null && t <= negThr)) o.above++;
  }
  return out;
}

// The faces of voxel k (corner offsets 0/1 along x, y, z), each wound counter-clockwise
// seen from outside, with the neighbour across it.
const FACES = [
  [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]], [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
];

/** The surface of the "on" voxels of a grid (a Uint8Array, x fastest; affine diagonal, as
 * the region mask is): every voxel face against an off voxel, two triangles each, sharing
 * corners. In mm. */
export function voxelSurface(on, dims, affine) {
  const [nx, ny, nz] = dims, a = affine;
  const flip = Math.sign(a[0][0] * a[1][1] * a[2][2]) < 0;  // a mirrored grid turns the winding
  const isOn = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && on[i + nx * (j + ny * k)];
  const corner = new Map(), pts = [], tris = [];
  const vert = (i, j, k) => {
    const key = i + (nx + 1) * (j + (ny + 1) * k);
    let v = corner.get(key);
    if (v === undefined) {
      v = pts.length / 3;
      corner.set(key, v);
      pts.push(a[0][0] * (i - 0.5) + a[0][3], a[1][1] * (j - 0.5) + a[1][3], a[2][2] * (k - 0.5) + a[2][3]);
    }
    return v;
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!on[i + nx * (j + ny * k)]) continue;
    for (const [[di, dj, dk], cs] of FACES) {
      if (isOn(i + di, j + dj, k + dk)) continue;
      const [p, q, r, s] = cs.map(([ci, cj, ck]) => vert(i + ci, j + cj, k + ck));
      if (flip) tris.push(p, s, r, p, r, q); else tris.push(p, q, r, p, r, s);
    }
  }
  return { pts: new Float32Array(pts), tris: new Uint32Array(tris) };
}

// Each structure a faint tint (opacity = the Fill slider) with a solid outline in its own
// hue where the surface turns away from the viewer; painted results stay fully opaque.
// Blobs use it too (opacity 1), so their results shade like those painted on surfaces.
const OUTLINE = "MTL outline";
const OUTLINE_FRAG = `#version 300 es
precision highp int;
precision highp float;
uniform float opacity;
in vec4 vClr;
in vec3 vN;
out vec4 color;
void main() {
  vec3 n = normalize(vN);
  float facing = abs(n.z);
  float rim = smoothstep(0.32, 0.08, facing);
  float sat = max(max(vClr.r, vClr.g), vClr.b) - min(min(vClr.r, vClr.g), vClr.b);
  float result = smoothstep(0.62, 0.78, sat);  // structure hues stay below ~0.6
  vec3 tint = vClr.rgb * (1.0 + 0.2 * facing);
  vec3 edge = min(vClr.rgb * 1.2, vec3(1.0));
  vec3 c = mix(tint, edge, rim);
  float a = mix(opacity, 1.0, rim);
  c = mix(c, vClr.rgb * (0.75 + 0.35 * facing), result);
  a = mix(a, 1.0, result);
  color = vec4(c, a);
}`;
const DEPTHS = [0, 1, 2, 3];  // mm inside each structure sampled for its surface colour
const PICK_PX = 6;  // how close (CSS px) a click must be to a structure point
// "Gray": every structure in one neutral grey, so only the painted results carry colour.
const GRAY = [185, 185, 190];
// Results as blobs: the suprathreshold voxels' surface, smoothed, in a base colour (the
// map's own colours are painted on, from the strongest value up to 3 mm inside).
const BLOB = { pos: [235, 90, 40], neg: [60, 120, 235] }, BLOB_SMOOTH = 60;

const samplerOf = (vol) => volumeSampler({
  img: vol.img, dims: vol.hdr.dims.slice(1, 4), affine: vol.hdr.affine,
  slope: vol.hdr.scl_slope || 1, inter: vol.hdr.scl_inter || 0,
});

// The quiz's copy of the view: every structure grey and shown, no maps; the quiz colours
// the target (and what was picked) with highlight().
const QUIZ_FILL = 0.22;
// Downloaded meshes and masks, by selection, shared by both views (the quiz moves between
// foci a lot).
const fetched = new Map();
const fetchBuffer = (url) => {
  if (!fetched.has(url)) fetched.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
  return fetched.get(url).then((b) => (b ? b.slice(0) : null));  // NiiVue may keep or alter what it is given
};

export function createFocusView({ Niivue, NVImage, canvas, legend, controls, store, esc, onPick, setHint, quiz = false }) {
  let nv = null, ready = null, active = false, drawNow = null;
  let focus = null;  // quiz: the lobe shown
  // Lobes switched on; the quiz shows one lobe at a time.
  const lobesOn = new Set(quiz ? [] : store.get("focusLobes", LOBES).filter((id) => FOCI[id]));
  // What the camera frames: "all" (what is loaded), "limbic", or a lobe, shown on its own
  // (the others stay ticked, back when it is clicked again).
  let frame = "all";
  const solo = () => frame !== "all" && frame !== "limbic";
  const isShown = (p) => !hidden.has(p.key) && (!solo() || p.lobe === frame);
  let loaded = false;
  // Hemispheres, fill, colours and hidden structures are shared by every focus.
  // (0.19.0 kept the MTL's under mtl* keys.)
  let hemi = quiz ? "both" : store.get("focusHemi", store.get("mtlHemi", "both"));
  let fill = quiz ? QUIZ_FILL : store.get("focusFill", store.get("mtlFill", 0.18));
  let gray = quiz || store.get("focusGray", false);
  let tint = new Map();  // structure key -> colour drawn instead of its own (highlight)
  const colorOf = (part) => tint.get(part.key) ?? (gray ? GRAY : part.color);
  const hidden = new Set(quiz ? [] : store.get("focusHidden", store.get("mtlHidden", [])));
  let meshes = [], mask = null, parts = [], token = 0;
  let sources = [], sourceKey = null;  // continuous slice overlays, back to front
  // Results drawn as "blobs" (the front map, inside the shown structures) or on the
  // structures' "surface" (every map).
  let results = quiz ? "surface" : store.get("focusResults", "blobs");
  let blobs = [], blobsKey = null;  // blob meshes

  async function init() {
    nv = new Niivue({ backColor: [0, 0, 0, 1], isOrientCube: true, show3Dcrosshair: false, dragAndDropEnabled: false });
    await nv.attachToCanvas(canvas);
    nv.setCustomMeshShader(OUTLINE_FRAG, OUTLINE);
    nv.setSliceType(nv.sliceTypeRender);
    // NiiVue centres the camera on every mesh it holds (hidden ones too); frame what is
    // chosen instead. It runs on every 3D draw.
    const pivot = nv.setPivot3D.bind(nv);
    nv.setPivot3D = () => {
      pivot();
      const b = frameBox();
      if (b) { nv.pivot3D = b.c; nv.furthestFromPivot = b.r; }
    };
    drawNow = nv.drawScene.bind(nv);
    let pending = 0;  // one draw per animation frame (see viewer3d)
    nv.drawScene = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; drawNow(); }); };
  }

  // Built structures, by key, kept when their lobe is switched off (hidden, not removed).
  const cache = new Map();  // key -> Promise<{ part, mesh, normals, values, box, added }>
  const build = (part) => {
    if (!cache.has(part.key)) cache.set(part.key, (async () => {
      const buf = await fetchBuffer(`/api/regions/mesh.gii?sel=${encodeURIComponent(part.key)}`);
      if (!buf) return null;
      const mesh = await NVMesh.readMesh(buf, `${part.key}.gii`, nv.gl, fill, new Uint8Array([...colorOf(part), 255]), true);
      smoothMesh(mesh.pts, mesh.tris);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < mesh.pts.length; v += 3) for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], mesh.pts[v + k]); hi[k] = Math.max(hi[k], mesh.pts[v + k]);
      }
      return { part, mesh, normals: outwardNormals(mesh.pts, mesh.tris), values: null, box: { lo, hi }, added: false };
    })());
    return cache.get(part.key);
  };
  // Every built structure (for colour changes that reach the hidden ones too).
  const allBuilt = async () => (await Promise.all(cache.values())).filter(Boolean);
  // The camera's centre and reach: the bounds of what `frame` names.
  function frameBox() {
    const xs = meshes.filter((x) => frame === "all" ? true : frame === "limbic"
      ? x.part.limbic && !hidden.has(x.part.key) : x.part.lobe === frame);
    if (!xs.length) return null;
    const lo = [0, 1, 2].map((k) => Math.min(...xs.map((x) => x.box.lo[k])));
    const hi = [0, 1, 2].map((k) => Math.max(...xs.map((x) => x.box.hi[k])));
    const c = lo.map((v, k) => (v + hi[k]) / 2);
    return { c, r: Math.max(10, Math.hypot(...hi.map((v, k) => v - c[k]))) };
  }

  let building = false;
  async function loadStructures() {
    const mine = ++token;
    const list = focusParts(LOBES.filter((id) => lobesOn.has(id)), hemi);
    building = list.some((p) => !cache.has(p.key));
    if (building) renderLegend(false);
    const [built, m] = await Promise.all([
      Promise.all(list.map(build)),
      // One mask for the per-structure peaks: structure k has value k.
      !list.length ? null : fetchBuffer(`/api/regions/mask.nii.gz?sel=${encodeURIComponent(list.map((p) => p.key).join(","))}`)
        .then(async (buf) => {
          const url = URL.createObjectURL(new Blob([buf]));
          try { return await NVImage.loadFromUrl({ url, name: "focus.nii.gz" }); } finally { URL.revokeObjectURL(url); }
        }),
    ]);
    if (mine !== token) return;
    building = false;
    meshes = built.filter(Boolean);
    parts = list;
    mask = m && { img: m.img, dims: m.hdr.dims.slice(1, 4), affine: m.hdr.affine };
    const now = new Set(meshes);
    for (const x of await allBuilt()) if (!now.has(x)) nv.setMeshProperty(x.mesh.id, "visible", false);
    if (mine !== token) return;
    for (const x of meshes) {
      if (x.added) continue;
      x.added = true;
      x.mesh.updateMesh(nv.gl); nv.addMesh(x.mesh); nv.setMeshShader(x.mesh.id, OUTLINE);
    }
    paint();
  }

  // The slice overlays this view paints: continuous maps only (an atlas overlay would
  // just repaint the structures' own labels).
  function setSources(vols) {
    const next = vols.filter((v) => !v.colormapLabel && !v.skip3d);
    const key = next.map((v) => v.id ?? v.name).join("|");
    sources = next;
    sourceKey = key;
    if (active && nv && meshes.length) paint();
  }

  function paint() {
    for (const x of meshes) {
      nv.setMeshProperty(x.mesh.id, "visible", isShown(x.part));
      nv.setMeshProperty(x.mesh.id, "opacity", fill);
      if (results !== "surface") { x.mesh.layers = []; x.mesh.updateMesh(nv.gl); continue; }
      if (x.valuesKey !== sourceKey) {  // projected once per set of maps
        x.values = sources.map((v) => projectToVertices(samplerOf(v), x.mesh.pts, x.normals, DEPTHS));
        x.valuesKey = sourceKey;
      }
      x.mesh.layers = sources.map((s, i) => ({
        ...NVMeshLayerDefaults, name: s.name, frame4D: 0, nFrame4D: 1, values: x.values[i],
        colormap: s.colormap, cal_min: s.cal_min, cal_max: s.cal_max, opacity: s.opacity,
        colormapNegative: s.colormapNegative || "", useNegativeCmap: !!s.colormapNegative,
        cal_minNeg: s.cal_minNeg, cal_maxNeg: s.cal_maxNeg, isTransparentBelowCalMin: true,
      }));
      x.mesh.updateMesh(nv.gl);
    }
    renderLegend();
    updateBlobs();
    nv.drawScene();
  }

  // The front map's thresholds, as the slices show it (null = that sign hidden there).
  // NiiVue leaves cal_minNeg NaN when the negative window mirrors the positive one; a sign
  // is hidden on the slices by pushing its window beyond the data (index.html).
  const thresholds = (v) => ({
    posThr: v.cal_min,
    negThr: !v.colormapNegative ? null : Number.isFinite(v.cal_minNeg) ? v.cal_minNeg : -v.cal_min,
  });
  const layerOf = (s, values) => ({
    ...NVMeshLayerDefaults, name: s.name, frame4D: 0, nFrame4D: 1, values,
    colormap: s.colormap, cal_min: s.cal_min, cal_max: s.cal_max, opacity: 1,
    colormapNegative: s.colormapNegative || "", useNegativeCmap: !!s.colormapNegative,
    cal_minNeg: s.cal_minNeg, cal_maxNeg: s.cal_maxNeg, isTransparentBelowCalMin: true,
  });

  // Blobs, rebuilt when the map, its thresholds, the structures or which of them are shown
  // change. Drawn before the structures, so the see-through structures blend over them.
  function updateBlobs() {
    const front = sources[sources.length - 1];
    const shown = parts.map(isShown);
    const key = front && mask ? [results, front.id ?? front.name, front.cal_min, front.cal_minNeg, front.colormapNegative,
      token, shown.join()].join("|") : "";
    if (key === blobsKey) return;
    blobsKey = key;
    for (const m of blobs) nv.removeMesh(m);
    blobs = [];
    if (!key || results !== "blobs") return;
    const { posThr, negThr } = thresholds(front), sample = samplerOf(front);
    const { img, dims, affine: a } = mask, [nx, ny, nz] = dims;
    for (const sign of ["pos", "neg"]) {
      const thr = sign === "pos" ? posThr : negThr;
      if (thr == null) continue;
      const on = new Uint8Array(img.length);
      let any = false;
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const n = i + nx * (j + ny * k), lab = img[n];
        if (!lab || !shown[lab - 1]) continue;
        const t = sample(a[0][0] * i + a[0][3], a[1][1] * j + a[1][3], a[2][2] * k + a[2][3]);
        if (sign === "pos" ? t >= thr : t <= thr) { on[n] = 1; any = true; }
      }
      if (!any) continue;
      const { pts, tris } = voxelSurface(on, dims, a);
      smoothMesh(pts, tris, BLOB_SMOOTH);
      const mesh = new NVMesh(pts, tris, "blob", new Uint8Array([...BLOB[sign], 255]), 1, true, nv.gl);
      mesh.layers = [layerOf(front, projectToVertices(sample, pts, outwardNormals(pts, tris), DEPTHS))];
      mesh.updateMesh(nv.gl);
      nv.addMesh(mesh);
      nv.setMeshShader(mesh.id, OUTLINE);  // the structures' shader, so results look the same in both modes
      blobs.push(mesh);
    }
    const mine = new Set(blobs);
    nv.meshes = [...blobs, ...nv.meshes.filter((m) => !mine.has(m))];
  }

  // Legend: presets, then one header per lobe (tick it to load and show the lobe, ▸ to
  // fold it, its name to zoom to it), one per group (tick it to show or hide the group)
  // and a row per structure, each with its strongest values.
  const collapsed = new Set(store.get("focusCollapsed", []));  // folded groups, lobe:group
  const opened = new Set(store.get("focusLobesOpen", []));  // unfolded lobes
  let peaks = {};
  const merge = (list) => {  // the strongest values and totals over some structures
    let o = null;
    for (const x of list) {
      if (!x) continue;
      o ??= { pos: 0, posAt: null, neg: 0, negAt: null, n: 0, above: 0 };
      if (x.pos > o.pos) { o.pos = x.pos; o.posAt = x.posAt; }
      if (x.neg < o.neg) { o.neg = x.neg; o.negAt = x.negAt; }
      o.n += x.n; o.above += x.above;
    }
    return o;
  };
  // recompute = false reuses the last peaks (folding a group, switching colours).
  function renderLegend(recompute = true) {
    const front = sources[sources.length - 1];  // the map drawn in front on the slices
    if (recompute) peaks = {};
    if (recompute && front && mask) {
      const { posThr, negThr } = thresholds(front);
      peaks = structurePeaks(mask, samplerOf(front), posThr, negThr);
    }
    const at = (v, p, cls) => p ? `<button type="button" class="fc-peak ${cls}" data-mm="${p.join(",")}" title="Look up (${p.join(", ")})">${v.toFixed(2)}</button>` : "–";
    const vals = (o) => o ? `${at(o.pos, o.posAt, "pos")} / ${at(o.neg, o.negAt, "neg")}` : "";
    const sub = (o) => o ? `<span class="fc-sub">${o.above} of ${o.n} mm³ past the threshold</span>` : "";
    const rows = parts.map((p, i) => ({ p, o: peaks[i + 1] }));
    const head = building ? "Building structures…" : front ? `Peak T · ${esc(front.name)}` : "Open a stat map to see peaks";
    const lobes = quiz ? [focus].filter(Boolean) : LOBES;
    legend.innerHTML = `<div class="fc-head">${head}</div>` +
      (quiz ? "" : `<div class="fc-presets"><button type="button" class="btn small" data-preset="all" title="Every lobe and structure, the whole brain in view">Whole brain</button>
        <button type="button" class="btn small" data-preset="limbic" title="Only the limbic system: vmPFC, cingulate, hippocampal formation, parahippocampal region, amygdala, anterior thalamus, mammillary bodies, hypothalamus, fornix">Limbic system</button></div>`) +
      lobes.map((id) => {
        const lobe = FOCI[id], on = lobesOn.has(id), open = quiz || opened.has(id);
        const mine = rows.filter((r) => r.p.lobe === id);
        const groups = !on || !open ? "" : lobe.groups.map((grp, gi) => {
          const gr = mine.filter((r) => r.p.group === gi);
          if (!gr.length) return "";
          const ck = `${id}:${grp.name}`, folded = collapsed.has(ck), o = merge(gr.map((r) => r.o));
          return `<div class="fc-group">
            <div class="fc-row fc-grow"><input type="checkbox" data-group="${id}:${gi}" aria-label="Show ${esc(grp.name)}">
              <button type="button" class="fc-fold" data-fold="${esc(ck)}" aria-expanded="${!folded}" title="${folded ? "Show" : "Hide"} its structures">${folded ? "▸" : "▾"}</button>
              <span class="fc-name">${esc(grp.name)}</span><span class="fc-val">${vals(o)}</span>${sub(o)}</div>
            ${folded ? "" : gr.map(({ p, o: x }) => `<label class="fc-row fc-part"><input type="checkbox" data-key="${esc(p.key)}" ${hidden.has(p.key) ? "" : "checked"}>
              <i style="background:rgb(${colorOf(p).join(",")})"></i><span class="fc-name">${p.hemi === "M" ? "" : `${p.hemi} `}${esc(p.name)}</span>
              <span class="fc-val">${vals(x)}</span>${sub(x)}</label>`).join("")}
          </div>`;
        }).join("");
        if (quiz) return groups;
        const o = on ? merge(mine.filter((r) => !hidden.has(r.p.key)).map((r) => r.o)) : null;
        return `<div class="fc-lobe${on && (!solo() || frame === id) ? "" : " off"}">
          <div class="fc-row fc-lrow"><input type="checkbox" data-lobe="${id}" ${on ? "checked" : ""} aria-label="Show the ${esc(lobe.label)} lobe">
            <button type="button" class="fc-fold" data-lobefold="${id}" aria-expanded="${open}" title="${open ? "Hide" : "Show"} its groups" ${on ? "" : "disabled"}>${open ? "▾" : "▸"}</button>
            <button type="button" class="fc-zoom${frame === id ? " on" : ""}" data-zoom="${id}" title="${frame === id ? "Back to every lobe ticked" : "Zoom to it, on its own"}" ${on ? "" : "disabled"}>${esc(lobe.label)}</button>
            <span class="fc-val">${vals(o)}</span>${sub(o)}</div>
          ${groups}
        </div>`;
      }).join("");
    markGroups();
  }
  // Group boxes: ticked when all its structures show, half-ticked when some do.
  function markGroups() {
    for (const box of legend.querySelectorAll("input[data-group]")) {
      const [id, gi] = box.dataset.group.split(":");
      const keys = parts.filter((p) => p.lobe === id && p.group === +gi).map((p) => p.key);
      const shown = keys.filter((k) => !hidden.has(k)).length;
      box.checked = shown === keys.length;
      box.indeterminate = shown > 0 && shown < keys.length;
    }
  }
  function showHidden() {
    if (!quiz) store.set("focusHidden", [...hidden]);
    for (const x of meshes) nv.setMeshProperty(x.mesh.id, "visible", isShown(x.part));
    renderLegend(false);
    updateBlobs();
    nv.drawScene();
  }
  function setLobes(ids) {
    lobesOn.clear();
    for (const id of ids) lobesOn.add(id);
    store.set("focusLobes", [...lobesOn]);
    if (frame !== "all" && frame !== "limbic" && !lobesOn.has(frame)) frame = "all";
    loadStructures();
  }
  // Presets: the whole brain, or the limbic system alone (its lobes on, the rest of them hidden).
  function preset(name) {
    if (name === "all") {
      hidden.clear();
      frame = "all";
      setLobes(LOBES);
    } else {
      const every = focusParts(LOBES, "both");
      const lobes = LOBES.filter((id) => every.some((p) => p.lobe === id && p.limbic));
      hidden.clear();
      for (const p of every) if (!p.limbic) hidden.add(p.key);
      frame = "limbic";
      setLobes(lobes);
    }
    store.set("focusHidden", [...hidden]);
  }

  legend.addEventListener("change", (e) => {
    const k = e.target.dataset.key, gi = e.target.dataset.group, lobe = e.target.dataset.lobe;
    if (lobe) {
      const ids = new Set(lobesOn);
      e.target.checked ? ids.add(lobe) : ids.delete(lobe);
      setLobes(LOBES.filter((id) => ids.has(id)));
      return;
    }
    if (k) e.target.checked ? hidden.delete(k) : hidden.add(k);
    else if (gi !== undefined) {
      const [id, n] = gi.split(":");
      for (const p of parts) if (p.lobe === id && p.group === +n) e.target.checked ? hidden.delete(p.key) : hidden.add(p.key);
    } else return;
    showHidden();
  });
  legend.addEventListener("click", (e) => {
    const b = e.target.closest(".fc-peak");
    if (b) { e.preventDefault(); onPick?.(b.dataset.mm.split(",").map(Number)); return; }
    const pr = e.target.closest("[data-preset]");
    if (pr) { preset(pr.dataset.preset); return; }
    const z = e.target.closest("[data-zoom]");
    if (z) {
      const id = z.dataset.zoom;
      frame = frame === id ? "all" : id;
      if (frame === id) nv.setRenderAzimuthElevation(...FOCI[id].view);
      showHidden();
      return;
    }
    const lf = e.target.closest("[data-lobefold]");
    if (lf) {
      const id = lf.dataset.lobefold;
      opened.has(id) ? opened.delete(id) : opened.add(id);
      store.set("focusLobesOpen", [...opened]);
      renderLegend(false);
      return;
    }
    const f = e.target.closest(".fc-fold");
    if (f && f.dataset.fold) {
      collapsed.has(f.dataset.fold) ? collapsed.delete(f.dataset.fold) : collapsed.add(f.dataset.fold);
      store.set("focusCollapsed", [...collapsed]);
      renderLegend(false);
    }
  });

  // Controls: hemispheres, colours, results, fill.
  function seg(el, value, pick) {
    const mark = (v) => { for (const b of el.querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === v); };
    mark(value);
    el.addEventListener("click", (e) => { const v = e.target.dataset.v; if (v) { mark(v); pick(v); } });
    return mark;
  }
  seg(controls.hemi, hemi, (v) => { hemi = v; store.set("focusHemi", v); if (nv) loadStructures(); });
  seg(controls.colors, gray ? "gray" : "hue", (v) => {
    gray = v === "gray"; store.set("focusGray", gray);
    if (!nv) return;
    allBuilt().then((xs) => {
      for (const x of xs) nv.setMeshProperty(x.mesh.id, "rgba255", [...colorOf(x.part), 255]);
      renderLegend(false);
      nv.drawScene();
    });
  });
  seg(controls.results, results, (v) => {
    results = v; store.set("focusResults", v);
    if (nv && meshes.length) paint();
  });
  controls.fill.value = fill;
  controls.fill.addEventListener("input", () => {
    fill = +controls.fill.value; store.set("focusFill", fill);
    if (!nv) return;
    for (const x of meshes) nv.setMeshProperty(x.mesh.id, "opacity", fill);
    nv.drawScene();
  });

  // A click (not a drag) on a structure looks up the point clicked: the front-most point
  // of a shown structure (or blob) within a few pixels of the pointer. (NiiVue's own depth
  // pick can land on a structure behind a see-through one.)
  function pick(px, py) {
    const w = nv.gl.canvas.width, h = nv.gl.canvas.height;
    const [m] = nv.calculateMvpMatrix(null, [0, 0, w, h], nv.scene.renderAzimuth, nv.scene.renderElevation);
    const r2 = (PICK_PX * (nv.uiData.dpr || 1)) ** 2;
    let best = null, bestPart = null, bestZ = Infinity;
    for (const x of [...blobs.map((mesh) => ({ mesh })), ...meshes]) {
      if (x.part && !isShown(x.part)) continue;
      const p = x.mesh.pts;
      for (let v = 0; v < p.length; v += 3) {
        const X = p[v], Y = p[v + 1], Z = p[v + 2];
        const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15];
        const sx = ((m[0] * X + m[4] * Y + m[8] * Z + m[12]) / cw + 1) / 2 * w;
        const sy = (1 - (m[1] * X + m[5] * Y + m[9] * Z + m[13]) / cw) / 2 * h;
        if ((sx - px) ** 2 + (sy - py) ** 2 > r2) continue;
        const z = (m[2] * X + m[6] * Y + m[10] * Z + m[14]) / cw;
        if (z < bestZ) { bestZ = z; best = [X, Y, Z]; bestPart = x.part ?? null; }
      }
    }
    return best && { mm: best, part: bestPart };
  }
  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener("pointerup", (e) => {
    const click = down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4;
    down = null;
    if (!click || !nv) return;
    const r = canvas.getBoundingClientRect(), dpr = nv.uiData.dpr || 1;
    const p = pick((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    if (p) onPick?.(p.mm.map(Math.round), p.part);
  });

  // Show (or hide) the view: the lobes switched on, or (quiz) lobe `id` alone.
  const WHOLE_VIEW = [120, 20];  // left, from the front and slightly above
  async function show(on, id) {
    active = on;
    canvas.hidden = !on;
    legend.hidden = !on;
    controls.bar.hidden = !on;
    if (!on) return;
    if (!ready) ready = init();
    await ready;
    nv.resizeListener?.();
    if (quiz) {
      if (id === focus) { paint(); return; }
      focus = id;
      lobesOn.clear(); lobesOn.add(id);
      frame = id;
      nv.setRenderAzimuthElevation(...FOCI[id].view);
      await loadStructures();
      return;
    }
    if (!loaded) {
      loaded = true;
      nv.setRenderAzimuthElevation(...WHOLE_VIEW);
      await loadStructures();
    } else paint();
    setHint("Focus: tick lobes in the list to add them, click a lobe's name to zoom to it; drag to rotate, scroll to zoom, click a structure or a peak to look it up.");
  }

  // The mask voxel (1 mm grid) holding an MNI point, and the structure there.
  const voxelOf = (mm) => {
    const a = mask.affine, [nx, ny, nz] = mask.dims;
    const ijk = [0, 1, 2].map((k) => Math.round((mm[k] - a[k][3]) / a[k][k]));
    return ijk.every((v, k) => v >= 0 && v < [nx, ny, nz][k]) ? ijk : null;
  };
  function structureAt(mm) {
    const v = mask && voxelOf(mm);
    const lab = v ? mask.img[v[0] + mask.dims[0] * (v[1] + mask.dims[1] * v[2])] : 0;
    return lab ? parts[lab - 1] : null;
  }
  // mm from a point to the nearest voxel of structure `key` (Infinity beyond `within`).
  function distanceTo(mm, key, within = 5) {
    const k = parts.findIndex((p) => p.key === key) + 1, v = mask && voxelOf(mm);
    if (!k || !v) return Infinity;
    const [nx, ny, nz] = mask.dims, r = Math.ceil(within);
    let best = Infinity;
    for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const i = v[0] + dx, j = v[1] + dy, l = v[2] + dz, d = Math.hypot(dx, dy, dz);
      if (d > within || d >= best || i < 0 || j < 0 || l < 0 || i >= nx || j >= ny || l >= nz) continue;
      if (mask.img[i + nx * (j + ny * l)] === k) best = d;
    }
    return best;
  }
  // A point inside structure `key`: its voxel nearest the structure's centre.
  function insidePoint(key) {
    const k = parts.findIndex((p) => p.key === key) + 1;
    if (!k || !mask) return null;
    const { img, dims: [nx, ny, nz], affine: a } = mask, vox = [], c = [0, 0, 0];
    for (let l = 0; l < nz; l++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (img[i + nx * (j + ny * l)] !== k) continue;
      vox.push([i, j, l]); c[0] += i; c[1] += j; c[2] += l;
    }
    if (!vox.length) return null;
    c.forEach((x, n) => (c[n] = x / vox.length));
    let best = vox[0], bd = Infinity;
    for (const v of vox) { const d = (v[0] - c[0]) ** 2 + (v[1] - c[1]) ** 2 + (v[2] - c[2]) ** 2; if (d < bd) { bd = d; best = v; } }
    return best.map((v, n) => a[n][n] * v + a[n][3]);
  }
  // Colour some structures ({ key: [r, g, b] }); the rest go back to their own colour.
  // Fully saturated colours draw solid (see the shader).
  function highlight(colors = {}) {
    tint = new Map(Object.entries(colors));
    if (!nv) return;
    for (const x of meshes) nv.setMeshProperty(x.mesh.id, "rgba255", [...colorOf(x.part), 255]);
    nv.drawScene();
  }

  return {
    show,
    label: (id) => FOCI[id]?.label,
    setSources,
    setView: (az, el) => nv?.setRenderAzimuthElevation(az, el),
    get active() { return active; },
    get canvas() { return canvas; },
    get parts() { return parts; },
    structureAt, distanceTo, insidePoint, highlight,
    redraw: () => drawNow?.(),
  };
}
