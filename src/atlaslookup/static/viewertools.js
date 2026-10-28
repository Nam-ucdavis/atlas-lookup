// Viewer extras: a crosshair on/off switch, the slice coordinate in the bottom-left
// corner of each slice, and "scr", which saves the three slices as one PNG.
//
// The labels follow the input mode: MNI mm (x, y, z), or voxel indices (i, j, k) on the
// chosen reference grid, with the same 0/1 base as the form. Every capture is the same
// size (three square tiles) whatever the window size or slice layout, so images line up.

const AXES = [  // NiiVue's axCorSag -> the world axis that slice is cut along
  { name: "Axial", axis: 2 },
  { name: "Coronal", axis: 1 },
  { name: "Sagittal", axis: 0 },
];
const TILE = 800;  // px per slice in a capture

function invertAffine(a) {
  // 4x4 affine inverse: invert the 3x3 part, then the translation.
  const [[a0, a1, a2], [b0, b1, b2], [c0, c1, c2]] = a;
  const det = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0);
  const m = [
    [(b1 * c2 - b2 * c1) / det, (a2 * c1 - a1 * c2) / det, (a1 * b2 - a2 * b1) / det],
    [(b2 * c0 - b0 * c2) / det, (a0 * c2 - a2 * c0) / det, (a2 * b0 - a0 * b2) / det],
    [(b0 * c1 - b1 * c0) / det, (a1 * c0 - a0 * c1) / det, (a0 * b1 - a1 * b0) / det],
  ];
  const t = [a[0][3], a[1][3], a[2][3]];
  return m.map((row) => [...row, -(row[0] * t[0] + row[1] * t[1] + row[2] * t[2])]);
}

const num = (v) => String(+(+v).toFixed(1)).replace("-", "−");

/**
 * Label for one slice: "z = 24 mm" in mm mode; in voxel mode the index whose grid axis
 * runs along that slice's world axis, e.g. "k = 49" (grids may be flipped or permuted).
 */
export function sliceLabel(axCorSag, mm, { mode = "mm", grid = null, base = 1 } = {}) {
  const { axis } = AXES[axCorSag];
  if (mode !== "voxel" || !grid) return `${"xyz"[axis]} = ${num(mm[axis])} mm`;
  const col = [0, 1, 2].reduce((best, c) => (Math.abs(grid.affine[axis][c]) > Math.abs(grid.affine[axis][best]) ? c : best), 0);
  const inv = invertAffine(grid.affine);
  const v = inv[col][0] * mm[0] + inv[col][1] * mm[1] + inv[col][2] * mm[2] + inv[col][3];
  return `${"ijk"[col]} = ${Math.round(v) + base}`;
}

export function createViewerTools({ getNv, getCoords, isQuiz, store, wrap, toggle, button, setHint }) {
  const nv = getNv();
  const box = document.createElement("div");
  box.className = "slice-labels";
  wrap.append(box);
  toggle.checked = store.get("crosshair", true);

  // Hook drawScene so labels and the crosshair setting follow every redraw (clicks,
  // resizes, layout changes). The quiz always needs the crosshair.
  const draw = nv.drawScene.bind(nv);
  nv.drawScene = () => {
    nv.opts.crosshairWidth = toggle.checked || isQuiz() ? 1 : 0;
    const r = draw();
    labels();
    return r;
  };
  toggle.addEventListener("change", () => { store.set("crosshair", toggle.checked); nv.drawScene(); });

  const mm = () => Array.from(nv.frac2mm(nv.scene.crosshairPos)).slice(0, 3);
  const slices = () => nv.screenSlices.filter((s) => s.axCorSag in AXES);

  function labels() {
    const c = nv.canvas, scale = c.width / (c.clientWidth || c.width);
    const opts = getCoords(), p = mm();
    const html = slices().map(({ axCorSag, leftTopWidthHeight: [l, t, , h] }) =>
      `<span style="left:${l / scale + 6}px;top:${(t + h) / scale - 6}px">${sliceLabel(axCorSag, p, opts)}</span>`).join("");
    if (box.innerHTML !== html) box.innerHTML = html;
  }

  // The canvas is WebGL without preserveDrawingBuffer, so copy it right after a redraw,
  // in the same task, before the browser clears it.
  function capture() {
    nv.drawScene();
    const src = nv.canvas, out = document.createElement("canvas");
    out.width = TILE * 3; out.height = TILE;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, out.width, out.height);
    const opts = getCoords(), p = mm();
    ctx.font = `${Math.round(TILE * 0.035)}px -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = "#fff"; ctx.textBaseline = "bottom";
    for (const { axCorSag, leftTopWidthHeight: [l, t, w, h] } of slices()) {
      const k = Math.min(TILE / w, TILE / h), x0 = axCorSag * TILE;
      ctx.drawImage(src, l, t, w, h, x0 + (TILE - w * k) / 2, (TILE - h * k) / 2, w * k, h * k);
      ctx.fillText(sliceLabel(axCorSag, p, opts), x0 + TILE * 0.03, TILE * 0.97);
    }
    return new Promise((resolve) => out.toBlob(resolve, "image/png"));
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const r = await fetch("/api/screenshot", { method: "POST", headers: { "Content-Type": "image/png" }, body: await capture() });
      const d = await r.json();
      setHint(r.ok ? `Saved ${d.file} in ${d.folder}` : `Could not save: ${d.detail}`);
    } catch (e) {
      setHint(`Could not save: ${e.message}`);
    } finally {
      button.disabled = false;
    }
  });

  nv.drawScene();
  return { capture, labels };
}
