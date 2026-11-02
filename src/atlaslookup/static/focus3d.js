// "Focus" in the 3D tab: one part of the brain on its own (the prefrontal, parietal,
// cingulate, temporal cortex with the medial temporal lobe, occipital), as see-through
// structures with solid outlines, the slice viewer's results painted onto them.
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
// Cuts (see regions.parse_clip): PFC ends at y = +10 mm (premotor cortex behind it), and
// the superior frontal gyrus is split at |x| = 20 mm into its medial and lateral parts.
const PFC = "y>=10", SFG_MEDIAL = "ax<=20;y>=10", SFG_LATERAL = "ax>20;y>=10";
// Each focus: two levels of detail (coarse, fine), each a list of groups of structures,
// { name, parts: [{ atlas, value, right?, name, color, clip? }] }. With `right`, the atlas
// has one region per hemisphere already (value = left, right = right); otherwise the
// region is split at the midline. clip cuts the region (see regions.parse_clip).
const g = (name, ...parts) => ({ name, parts });
const ho = (value, name, color, clip) => ({ atlas: "harvard-oxford-cort", value, name, color, clip });
const ds = (value, name, color, clip) => ({ atlas: "destrieux2009", value, right: value + 75, name, color, clip });
// The medial temporal lobe, part of the temporal focus: structures, or Juelich subfields
// (2 mm maximum-probability maps, so coarse, and some sit inside others).
const MTL_COARSE = [
  g("Hippocampus", { atlas: "harvard-oxford-sub", value: 9, right: 19, name: "Hippocampus", color: C.violet }),
  g("Amygdala", { atlas: "harvard-oxford-sub", value: 10, right: 20, name: "Amygdala", color: C.orange }),
  g("Parahippocampal region",
    { atlas: "juelich", value: 11, name: "Entorhinal cortex", color: C.green },
    ho(34, "Anterior parahippocampal gyrus", C.gold),
    ho(35, "Posterior parahippocampal gyrus (PHC)", C.cyan)),
];
const MTL_FINE = [
  g("Hippocampal formation",
    { atlas: "juelich", value: 9, name: "Cornu ammonis (CA)", color: C.violet },
    { atlas: "juelich", value: 10, name: "Dentate gyrus", color: C.gold },
    { atlas: "juelich", value: 13, name: "Subiculum", color: C.cyan },
    { atlas: "juelich", value: 12, name: "Hippocampal-amygdaloid transition area", color: C.pink }),
  g("Parahippocampal region",
    { atlas: "juelich", value: 11, name: "Entorhinal cortex", color: C.green },
    ds(23, "Parahippocampal gyrus", C.gold),
    ds(62, "Collateral sulcus (perirhinal cortex)", C.blue)),
  g("Amygdala",
    { atlas: "juelich", value: 1, name: "Amygdala, centromedial", color: C.orange },
    { atlas: "juelich", value: 2, name: "Amygdala, laterobasal", color: C.brick },
    { atlas: "juelich", value: 3, name: "Amygdala, superficial", color: C.tan }),
];
export const FOCI = {
  pfc: {
    label: "PFC", view: [150, 15],
    levels: {
      coarse: { label: "Structures", groups: [
        g("Ventromedial PFC",
          ho(25, "Frontal medial cortex", C.violet),
          ho(27, "Subcallosal cortex (subgenual ACC)", C.pink)),
        g("Dorsomedial PFC & ACC",
          ho(29, "Anterior cingulate gyrus", C.cyan),
          ho(28, "Paracingulate gyrus", C.green),
          ho(3, "Superior frontal gyrus, medial part", C.orange, SFG_MEDIAL)),
        g("Orbitofrontal (lateral / central)",
          ho(33, "Frontal orbital cortex", C.brick)),
        g("Dorsolateral PFC",
          ho(4, "Middle frontal gyrus", C.blue, PFC),
          ho(3, "Superior frontal gyrus, lateral part", C.tan, SFG_LATERAL)),
        g("Ventrolateral PFC",
          ho(5, "Inferior frontal gyrus, pars triangularis", C.gold),
          ho(6, "Inferior frontal gyrus, pars opercularis", C.lime),
          ho(41, "Frontal operculum", C.pink)),
        g("Frontopolar",
          ho(1, "Frontal pole", C.silver)),
      ] },
      fine: { label: "Gyri & sulci", title: "Destrieux gyri and sulci", groups: [
        g("Ventromedial PFC",
          ds(31, "Gyrus rectus", C.violet),
          ds(64, "Medial orbital (olfactory) sulcus", C.blue),
          ds(71, "Suborbital sulcus", C.tan),
          ds(32, "Subcallosal gyrus", C.pink)),
        g("Dorsomedial PFC & ACC",
          ds(6, "Anterior cingulate gyrus and sulcus", C.cyan),
          ds(16, "Superior frontal gyrus, medial part", C.orange, SFG_MEDIAL)),
        g("Orbitofrontal (lateral / central)",
          ds(24, "Orbital gyri", C.brick),
          ds(63, "Lateral orbital sulcus", C.gold),
          ds(65, "H-shaped orbital sulci", C.green)),
        g("Dorsolateral PFC",
          ds(15, "Middle frontal gyrus", C.blue, PFC),
          ds(16, "Superior frontal gyrus, lateral part", C.tan, SFG_LATERAL),
          ds(55, "Superior frontal sulcus", C.lime, PFC),
          ds(54, "Middle frontal sulcus", C.pink, PFC),
          ds(53, "Inferior frontal sulcus", C.green, PFC)),
        g("Ventrolateral PFC",
          ds(14, "Inferior frontal gyrus, triangular part", C.gold),
          ds(12, "Inferior frontal gyrus, opercular part", C.lime),
          ds(13, "Inferior frontal gyrus, orbital part", C.brick)),
        g("Frontopolar",
          ds(5, "Transverse frontopolar gyri and sulci", C.silver),
          ds(1, "Fronto-marginal gyrus and sulcus", C.violet)),
      ] },
    },
  },
  parietal: {
    label: "Parietal", view: [45, 30],
    levels: {
      coarse: { label: "Structures", groups: [
        g("Superior parietal", ho(18, "Superior parietal lobule", C.blue)),
        g("Inferior parietal",
          ho(19, "Supramarginal gyrus, anterior", C.orange),
          ho(20, "Supramarginal gyrus, posterior", C.gold),
          ho(21, "Angular gyrus", C.green)),
        g("Medial parietal", ho(31, "Precuneus", C.violet)),
        g("Somatosensory",
          ho(17, "Postcentral gyrus", C.cyan),
          ho(43, "Parietal operculum", C.pink)),
      ] },
      fine: { label: "Gyri & sulci", title: "Destrieux gyri and sulci", groups: [
        g("Superior parietal",
          ds(27, "Superior parietal lobule", C.blue),
          ds(57, "Intraparietal sulcus", C.lime)),
        g("Inferior parietal",
          ds(26, "Supramarginal gyrus", C.orange),
          ds(56, "Sulcus intermedius primus (Jensen)", C.tan),
          ds(25, "Angular gyrus", C.green)),
        g("Medial parietal",
          ds(30, "Precuneus", C.violet),
          ds(72, "Subparietal sulcus", C.silver),
          ds(47, "Cingulate sulcus, marginal branch", C.brick)),
        g("Somatosensory",
          ds(28, "Postcentral gyrus", C.cyan),
          ds(68, "Postcentral sulcus", C.pink)),
      ] },
    },
  },
  cingulate: {
    label: "Cingulate", view: [70, 20],
    levels: {
      coarse: { label: "Structures", groups: [
        g("Anterior cingulate",
          ho(29, "Anterior cingulate gyrus", C.cyan),
          ho(28, "Paracingulate gyrus", C.green),
          ho(27, "Subcallosal cortex (subgenual ACC)", C.pink)),
        g("Posterior cingulate",
          ho(30, "Posterior cingulate gyrus", C.orange),
          ds(10, "Retrosplenial cortex (cingulate isthmus)", C.violet)),
      ] },
      fine: { label: "Gyri & sulci", title: "Destrieux cingulate divisions", groups: [
        g("Anterior cingulate",
          ds(6, "Anterior cingulate (ACC)", C.cyan),
          ds(32, "Subcallosal gyrus", C.pink)),
        g("Midcingulate",
          ds(7, "Anterior midcingulate (aMCC)", C.lime),
          ds(8, "Posterior midcingulate (pMCC)", C.gold)),
        g("Posterior cingulate",
          ds(9, "Dorsal posterior cingulate (dPCC)", C.orange),
          ds(10, "Ventral posterior cingulate / isthmus (RSC)", C.violet)),
        g("Sulci",
          ds(67, "Pericallosal sulcus", C.silver),
          ds(47, "Cingulate sulcus, marginal branch", C.brick)),
      ] },
    },
  },
  // Lateral, ventral and medial temporal cortex.
  temporal: {
    label: "Temporal", view: [110, 10],
    levels: {
      coarse: { label: "Structures", groups: [
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
        ...MTL_COARSE,
      ] },
      fine: { label: "Gyri & subfields", title: "Destrieux gyri and sulci; Juelich hippocampal subfields and amygdala groups (MTL)", groups: [
        g("Temporal pole", ds(44, "Temporal pole", C.silver)),
        g("Superior temporal",
          ds(34, "Superior temporal gyrus, lateral", C.lime),
          ds(35, "Planum polare", C.tan),
          ds(33, "Heschl's gyrus", C.brick),
          ds(75, "Transverse temporal sulcus", C.silver),
          ds(36, "Planum temporale", C.pink),
          ds(74, "Superior temporal sulcus", C.gold)),
        g("Middle temporal",
          ds(38, "Middle temporal gyrus", C.blue),
          ds(73, "Inferior temporal sulcus", C.cyan)),
        g("Inferior temporal", ds(37, "Inferior temporal gyrus", C.green)),
        g("Ventral temporal (fusiform)",
          ds(21, "Fusiform gyrus", C.lime),
          ds(61, "Lateral occipito-temporal sulcus", C.violet)),
        ...MTL_FINE,
      ] },
    },
  },
  // The temporo-occipital fusiform cortex is in the temporal focus.
  occipital: {
    label: "Occipital", view: [20, 15],
    levels: {
      coarse: { label: "Structures", groups: [
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
      ] },
      fine: { label: "Visual areas", title: "Juelich visual areas (2 mm maximum-probability maps)", groups: [
        g("Early visual cortex",
          { atlas: "juelich", value: 48, name: "V1 (BA17)", color: C.violet },
          { atlas: "juelich", value: 49, name: "V2 (BA18)", color: C.cyan }),
        g("Ventral visual",
          { atlas: "juelich", value: 50, name: "V3v", color: C.gold },
          { atlas: "juelich", value: 51, name: "V4", color: C.orange }),
        g("Motion", { atlas: "juelich", value: 52, name: "V5 / MT+", color: C.green }),
      ] },
    },
  },
};

/** The structures of a focus to draw for a level ("coarse" | "fine") and hemisphere
 * ("both" | "L" | "R"), group by group, with the atlas|value|side[|clip] key the region
 * endpoints take and the index of their group. */
export function focusParts(focus, level, hemi) {
  const out = [];
  FOCI[focus].levels[level].groups.forEach((grp, gi) => {
    for (const { atlas, value, right, name, color, clip } of grp.parts) {
      for (const h of ["L", "R"]) {
        if (hemi !== "both" && hemi !== h) continue;
        const v = right && h === "R" ? right : value, s = right ? "B" : h;
        out.push({ atlas, value: v, side: s, name, hemi: h, color, group: gi,
          key: `${atlas}|${v}|${s}${clip ? `|${clip}` : ""}` });
      }
    }
  });
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

// Each structure a faint tint (opacity = the Fill slider) with a solid outline in its own
// hue where the surface turns away from the viewer; painted results stay fully opaque.
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

const samplerOf = (vol) => volumeSampler({
  img: vol.img, dims: vol.hdr.dims.slice(1, 4), affine: vol.hdr.affine,
  slope: vol.hdr.scl_slope || 1, inter: vol.hdr.scl_inter || 0,
});

export function createFocusView({ Niivue, NVImage, canvas, legend, controls, store, esc, onPick, setHint }) {
  let nv = null, ready = null, active = false, drawNow = null;
  let focus = null;  // which of FOCI is shown
  // Level per focus; hemispheres, fill, colours and hidden structures shared by all.
  // (0.19.0 kept the MTL's under mtl* keys; 0.19.4 merged the MTL into the temporal focus.)
  const levelOf = (f) => store.get(`focusLevel:${f}`, f === "temporal" &&
    (store.get("focusLevel:mtl", "") === "fine" || store.get("mtlLevel", "") === "subfields") ? "fine" : "coarse");
  let level = "coarse", hemi = store.get("focusHemi", store.get("mtlHemi", "both"));
  let fill = store.get("focusFill", store.get("mtlFill", 0.18));
  let gray = store.get("focusGray", false);
  const colorOf = (part) => (gray ? GRAY : part.color);
  const hidden = new Set(store.get("focusHidden", store.get("mtlHidden", [])));
  let meshes = [], mask = null, parts = [], token = 0;
  let sources = [], sourceKey = null;  // continuous slice overlays, back to front

  async function init() {
    nv = new Niivue({ backColor: [0, 0, 0, 1], isOrientCube: true, show3Dcrosshair: false, dragAndDropEnabled: false });
    await nv.attachToCanvas(canvas);
    nv.setCustomMeshShader(OUTLINE_FRAG, OUTLINE);
    nv.setSliceType(nv.sliceTypeRender);
    drawNow = nv.drawScene.bind(nv);
    let pending = 0;  // one draw per animation frame (see viewer3d)
    nv.drawScene = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; drawNow(); }); };
  }

  async function loadStructures() {
    const mine = ++token;
    legend.innerHTML = `<div class="fc-head">Building structures…</div>`;
    const list = focusParts(focus, level, hemi);
    const [built, m] = await Promise.all([
      Promise.all(list.map(async (part) => {
        const r = await fetch(`/api/regions/mesh.gii?sel=${encodeURIComponent(part.key)}`);
        if (!r.ok) return null;
        const mesh = await NVMesh.readMesh(await r.arrayBuffer(), `${part.key}.gii`, nv.gl, fill, new Uint8Array([...colorOf(part), 255]), true);
        smoothMesh(mesh.pts, mesh.tris);
        return { part, mesh, normals: outwardNormals(mesh.pts, mesh.tris), values: null };
      })),
      // One mask for the per-structure peaks: structure k has value k.
      NVImage.loadFromUrl({ url: `/api/regions/mask.nii.gz?sel=${encodeURIComponent(list.map((p) => p.key).join(","))}`, name: "focus.nii.gz" }),
    ]);
    if (mine !== token) return;
    for (const x of meshes) nv.removeMesh(x.mesh);
    meshes = built.filter(Boolean);
    parts = list;
    mask = { img: m.img, dims: m.hdr.dims.slice(1, 4), affine: m.hdr.affine };
    for (const x of meshes) { x.mesh.updateMesh(nv.gl); nv.addMesh(x.mesh); nv.setMeshShader(x.mesh.id, OUTLINE); }
    paint();
  }

  // The slice overlays this view paints: continuous maps only (an atlas overlay would
  // just repaint the structures' own labels).
  function setSources(vols) {
    const next = vols.filter((v) => !v.colormapLabel && !v.skip3d);
    const key = next.map((v) => v.id ?? v.name).join("|");
    sources = next;
    if (key !== sourceKey) { sourceKey = key; for (const x of meshes) x.values = null; }
    if (active && nv && meshes.length) paint();
  }

  function paint() {
    for (const x of meshes) {
      nv.setMeshProperty(x.mesh.id, "visible", !hidden.has(x.part.key));
      nv.setMeshProperty(x.mesh.id, "opacity", fill);
      x.values ??= sources.map((v) => projectToVertices(samplerOf(v), x.mesh.pts, x.normals, DEPTHS));
      x.mesh.layers = sources.map((s, i) => ({
        ...NVMeshLayerDefaults, name: s.name, frame4D: 0, nFrame4D: 1, values: x.values[i],
        colormap: s.colormap, cal_min: s.cal_min, cal_max: s.cal_max, opacity: s.opacity,
        colormapNegative: s.colormapNegative || "", useNegativeCmap: !!s.colormapNegative,
        cal_minNeg: s.cal_minNeg, cal_maxNeg: s.cal_maxNeg, isTransparentBelowCalMin: true,
      }));
      x.mesh.updateMesh(nv.gl);
    }
    renderLegend();
    nv.drawScene();
  }

  // Legend: one header per group (tick it to show or hide the whole group, ▸ to fold it,
  // with the group's strongest values) and a row per structure.
  const collapsed = new Set(store.get("focusCollapsed", []));
  const groupsOf = () => FOCI[focus].levels[level].groups;
  let peaks = {};
  // recompute = false reuses the last peaks (folding a group, switching colours).
  function renderLegend(recompute = true) {
    const front = sources[sources.length - 1];  // the map drawn in front on the slices
    // A sign is hidden on the slices by pushing its window beyond the data (index.html).
    if (recompute) peaks = {};
    if (recompute && front && mask) {
      // NiiVue leaves cal_minNeg NaN when the negative window mirrors the positive one.
      const posThr = front.cal_min;
      const negThr = !front.colormapNegative ? null : Number.isFinite(front.cal_minNeg) ? front.cal_minNeg : -front.cal_min;
      peaks = structurePeaks(mask, samplerOf(front), posThr, negThr);
    }
    const at = (v, p, cls) => p ? `<button type="button" class="fc-peak ${cls}" data-mm="${p.join(",")}" title="Look up (${p.join(", ")})">${v.toFixed(2)}</button>` : "–";
    const vals = (o) => o ? `${at(o.pos, o.posAt, "pos")} / ${at(o.neg, o.negAt, "neg")}` : "";
    const sub = (o) => o ? `<span class="fc-sub">${o.above} of ${o.n} mm³ past the threshold</span>` : "";
    const rows = parts.map((p, i) => ({ p, o: peaks[i + 1] }));
    legend.innerHTML = `<div class="fc-head">${front ? `Peak T · ${esc(front.name)}` : "Open a stat map to see peaks"}</div>` +
      groupsOf().map((grp, gi) => {
        const mine = rows.filter((r) => r.p.group === gi);
        if (!mine.length) return "";
        // The group's strongest values and totals, over its structures.
        let o = null;
        for (const { o: x } of mine) {
          if (!x) continue;
          o ??= { pos: 0, posAt: null, neg: 0, negAt: null, n: 0, above: 0 };
          if (x.pos > o.pos) { o.pos = x.pos; o.posAt = x.posAt; }
          if (x.neg < o.neg) { o.neg = x.neg; o.negAt = x.negAt; }
          o.n += x.n; o.above += x.above;
        }
        const ck = `${focus}:${grp.name}`, folded = collapsed.has(ck);
        return `<div class="fc-group">
          <div class="fc-row fc-grow"><input type="checkbox" data-group="${gi}" aria-label="Show ${esc(grp.name)}">
            <button type="button" class="fc-fold" data-fold="${esc(ck)}" aria-expanded="${!folded}" title="${folded ? "Show" : "Hide"} its structures">${folded ? "▸" : "▾"}</button>
            <span class="fc-name">${esc(grp.name)}</span><span class="fc-val">${vals(o)}</span>${sub(o)}</div>
          ${folded ? "" : mine.map(({ p, o: x }) => `<label class="fc-row fc-part"><input type="checkbox" data-key="${esc(p.key)}" ${hidden.has(p.key) ? "" : "checked"}>
            <i style="background:rgb(${colorOf(p).join(",")})"></i><span class="fc-name">${p.hemi} ${esc(p.name)}</span>
            <span class="fc-val">${vals(x)}</span>${sub(x)}</label>`).join("")}
        </div>`;
      }).join("");
    markGroups();
  }
  // Group boxes: ticked when all its structures show, half-ticked when some do.
  function markGroups() {
    for (const box of legend.querySelectorAll("input[data-group]")) {
      const keys = parts.filter((p) => p.group === +box.dataset.group).map((p) => p.key);
      const shown = keys.filter((k) => !hidden.has(k)).length;
      box.checked = shown === keys.length;
      box.indeterminate = shown > 0 && shown < keys.length;
    }
  }
  function showHidden() {
    store.set("focusHidden", [...hidden]);
    for (const x of meshes) nv.setMeshProperty(x.mesh.id, "visible", !hidden.has(x.part.key));
    for (const box of legend.querySelectorAll("input[data-key]")) box.checked = !hidden.has(box.dataset.key);
    markGroups();
    nv.drawScene();
  }

  legend.addEventListener("change", (e) => {
    const k = e.target.dataset.key, gi = e.target.dataset.group;
    if (k) e.target.checked ? hidden.delete(k) : hidden.add(k);
    else if (gi !== undefined) {
      for (const p of parts) if (p.group === +gi) e.target.checked ? hidden.delete(p.key) : hidden.add(p.key);
    } else return;
    showHidden();
  });
  legend.addEventListener("click", (e) => {
    const b = e.target.closest(".fc-peak");
    if (b) { e.preventDefault(); onPick?.(b.dataset.mm.split(",").map(Number)); return; }
    const f = e.target.closest(".fc-fold");
    if (f) {
      collapsed.has(f.dataset.fold) ? collapsed.delete(f.dataset.fold) : collapsed.add(f.dataset.fold);
      store.set("focusCollapsed", [...collapsed]);
      renderLegend(false);
    }
  });

  // Controls: level of detail, hemispheres, colours, fill.
  function seg(el, value, pick) {
    const mark = (v) => { for (const b of el.querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === v); };
    mark(value);
    el.addEventListener("click", (e) => { const v = e.target.dataset.v; if (v) { mark(v); pick(v); } });
    return mark;
  }
  const markLevel = seg(controls.level, level, (v) => { level = v; store.set(`focusLevel:${focus}`, v); if (nv) loadStructures(); });
  seg(controls.hemi, hemi, (v) => { hemi = v; store.set("focusHemi", v); if (nv) loadStructures(); });
  seg(controls.colors, gray ? "gray" : "hue", (v) => {
    gray = v === "gray"; store.set("focusGray", gray);
    if (!nv) return;
    for (const x of meshes) nv.setMeshProperty(x.mesh.id, "rgba255", [...colorOf(x.part), 255]);
    renderLegend(false);
    nv.drawScene();
  });
  controls.fill.value = fill;
  controls.fill.addEventListener("input", () => {
    fill = +controls.fill.value; store.set("focusFill", fill);
    if (!nv) return;
    for (const x of meshes) nv.setMeshProperty(x.mesh.id, "opacity", fill);
    nv.drawScene();
  });

  // A click (not a drag) on a structure looks up the point clicked: the front-most point
  // of a shown structure within a few pixels of the pointer. (NiiVue's own depth pick
  // can land on a structure behind a see-through one.)
  function pick(px, py) {
    const w = nv.gl.canvas.width, h = nv.gl.canvas.height;
    const [m] = nv.calculateMvpMatrix(null, [0, 0, w, h], nv.scene.renderAzimuth, nv.scene.renderElevation);
    const r2 = (PICK_PX * (nv.uiData.dpr || 1)) ** 2;
    let best = null, bestZ = Infinity;
    for (const x of meshes) {
      if (hidden.has(x.part.key)) continue;
      const p = x.mesh.pts;
      for (let v = 0; v < p.length; v += 3) {
        const X = p[v], Y = p[v + 1], Z = p[v + 2];
        const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15];
        const sx = ((m[0] * X + m[4] * Y + m[8] * Z + m[12]) / cw + 1) / 2 * w;
        const sy = (1 - (m[1] * X + m[5] * Y + m[9] * Z + m[13]) / cw) / 2 * h;
        if ((sx - px) ** 2 + (sy - py) ** 2 > r2) continue;
        const z = (m[2] * X + m[6] * Y + m[10] * Z + m[14]) / cw;
        if (z < bestZ) { bestZ = z; best = [X, Y, Z]; }
      }
    }
    return best;
  }
  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener("pointerup", (e) => {
    const click = down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4;
    down = null;
    if (!click || !nv) return;
    const r = canvas.getBoundingClientRect(), dpr = nv.uiData.dpr || 1;
    const p = pick((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    if (p) onPick?.(p.map(Math.round));
  });

  // Show (or hide) the view, on focus `id` (a key of FOCI).
  async function show(on, id = focus) {
    active = on;
    canvas.hidden = !on;
    legend.hidden = !on;
    controls.bar.hidden = !on;
    if (!on) return;
    if (!ready) ready = init();
    await ready;
    nv.resizeListener?.();
    if (id !== focus) {
      focus = id;
      level = FOCI[id].levels[levelOf(id)] ? levelOf(id) : "coarse";
      for (const b of controls.level.querySelectorAll("button")) {
        const L = FOCI[id].levels[b.dataset.v];
        b.textContent = L.label;
        b.title = L.title ?? "";
      }
      markLevel(level);
      nv.setRenderAzimuthElevation(...FOCI[id].view);
      await loadStructures();
    } else paint();
    setHint(`Focus: ${FOCI[id].label}. Drag to rotate, scroll to zoom; click a structure or a peak to look it up.`);
  }

  return {
    show,
    label: (id) => FOCI[id]?.label,
    setSources,
    setView: (az, el) => nv?.setRenderAzimuthElevation(az, el),
    get active() { return active; },
    get canvas() { return canvas; },
    redraw: () => drawNow?.(),
  };
}
