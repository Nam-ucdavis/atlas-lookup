// 3D view, shown in its own tab next to the slices.
//
// A second NiiVue instance on its own canvas, so the slice viewer and its tools are
// untouched. It mirrors whatever is drawn on the slices (atlas overlay, results-folder
// stat map, local NIfTI layers): the same volumes are cloned in, with their display
// settings copied, whenever the slice viewer updates. Two styles:
//   surface  the MNI template rendered as a solid brain, overlays on its surface
//   glass    the template hidden; a see-through cortical mesh (fsaverage5 pial) with
//            the overlays drawn as solid blobs inside it
// The 3D view is for looking: drag to rotate, scroll to zoom. Clicks to look up a point
// stay on the slices; the slice crosshair is shown here too.

const VIEWS = {  // NiiVue azimuth / elevation for each named camera position
  L: [90, 0], R: [270, 0], A: [180, 0], P: [0, 0], S: [0, 90], I: [0, -90],
};
const DEFAULT_VIEW = [90, 15];  // left, slightly from above
const ZOOM = 1.5;  // NiiVue's default leaves the brain small in the wide panel
// NVImage.clone() copies the voxels but not how they are drawn.
const DISPLAY_KEYS = ["colormap", "colormapNegative", "cal_min", "cal_max", "cal_minNeg", "cal_maxNeg",
  "opacity", "colormapType", "isTransparentBelowCalMin", "alphaThreshold"];
const MESH_RGBA = [235, 238, 245, 255];
const W = 2400, H = 800, BAND = 160;  // capture size, matching the slice captures

export function createViewer3D({ Niivue, getNv, store, wrap, canvas, controls, crosshairToggle, setHint }) {
  let nv3 = null, ready = null, mesh = null, active = false;
  let clones = [];  // [{ src, copy }] in slice-viewer order
  let style = store.get("view3dStyle", "surface");
  const glassOpacity = () => +controls.glassOpacity.value;

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
    await nv3.loadVolumes([{ url: "/api/template.nii.gz", colormap: "gray" }]);
    nv3.setSliceType(nv3.sliceTypeRender);
    nv3.setRenderAzimuthElevation(...DEFAULT_VIEW);
    nv3.scene.volScaleMultiplier = ZOOM;
  }

  async function ensureMesh() {
    if (mesh) return mesh;
    await nv3.loadMeshes([{ url: "/api/brain_mesh.gii", rgba255: MESH_RGBA, opacity: glassOpacity() }]);
    mesh = nv3.meshes[nv3.meshes.length - 1];
    nv3.setMeshShader(mesh.id, "Rim");
    return mesh;
  }

  async function applyStyle() {
    const glass = style === "glass";
    controls.glassRow.hidden = !glass;
    for (const b of controls.style.querySelectorAll("button")) b.classList.toggle("on", b.dataset.style === style);
    nv3.setOpacity(0, glass ? 0 : 1);
    if (glass) {
      await ensureMesh();
      nv3.setMeshProperty(mesh.id, "visible", true);
      nv3.setMeshProperty(mesh.id, "opacity", glassOpacity());
    } else if (mesh) {
      nv3.setMeshProperty(mesh.id, "visible", false);
    }
    nv3.drawScene();
  }

  // Copy the slice viewer's overlays. Re-clone only when the set of volumes changed;
  // threshold or colour edits just copy the display settings across.
  function sync() {
    if (!nv3 || !active) return;
    const src = getNv().volumes.slice(1);
    const same = src.length === clones.length && src.every((v, i) => clones[i].src === v);
    if (!same) {
      while (nv3.volumes.length > 1) nv3.removeVolumeByIndex(1);
      clones = src.map((v) => ({ src: v, copy: v.clone() }));
      for (const { copy } of clones) nv3.addVolume(copy);
    }
    for (const { src: v, copy } of clones) {
      for (const k of DISPLAY_KEYS) if (k in v) copy[k] = v[k];
      copy.colormapLabel = v.colormapLabel ?? null;
    }
    nv3.opts.show3Dcrosshair = crosshairToggle.checked;
    nv3.scene.crosshairPos = [...getNv().scene.crosshairPos];  // same template, same fractions
    nv3.updateGLVolume();
  }
  let syncTimer;
  const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 120); };

  // Follow every change on the slice viewer (overlays added, thresholds dragged, ...).
  const nv = getNv();
  const update = nv.updateGLVolume.bind(nv);
  nv.updateGLVolume = (...args) => { const r = update(...args); if (active) scheduleSync(); return r; };

  async function show(on) {
    active = on;
    wrap.hidden = !on;
    controls.bar.hidden = !on;
    if (!on) return;
    if (!ready) ready = init();
    await ready;
    await applyStyle();
    clones = [];  // volumes may have changed while hidden
    sync();
    nv3.resizeListener?.();
    nv3.drawScene();
    setHint("3D: drag to rotate, scroll to zoom. Click on the slices to look up a point.");
  }

  controls.style.addEventListener("click", async (e) => {
    const s = e.target.dataset.style;
    if (!s || s === style) return;
    style = s; store.set("view3dStyle", s);
    await applyStyle();
  });
  controls.glassOpacity.value = store.get("view3dGlass", 0.25);
  controls.glassOpacity.addEventListener("input", () => {
    store.set("view3dGlass", glassOpacity());
    if (mesh) { nv3.setMeshProperty(mesh.id, "opacity", glassOpacity()); nv3.drawScene(); }
  });
  controls.views.addEventListener("click", (e) => {
    const v = VIEWS[e.target.dataset.view];
    if (v && nv3) nv3.setRenderAzimuthElevation(...v);
  });
  crosshairToggle.addEventListener("change", () => active && sync());

  // "scr" while the 3D tab is open: the render plus the colour bars, same size as the
  // slice captures. Copy right after a redraw (the WebGL canvas is not preserved).
  function capture(drawBars) {
    nv3.drawScene();
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
    get active() { return active; },
    get nv() { return nv3; },
    follow: () => active && sync(),
    capture: (drawBars) => (active && nv3 ? capture(drawBars) : null),
  };
}
