// Viewer extras: a crosshair on/off switch, the slice coordinate in the bottom-left
// corner of each slice, colour bars for the stat overlays, and "scr", which saves the
// three slices and the colour bars as one PNG.
//
// The labels follow the input mode: MNI mm (x, y, z), or voxel indices (i, j, k) on the
// chosen reference grid, with the same 0/1 base as the form. Colour bars run from the
// threshold to the strongest value, labelled in T or p as each layer is thresholded, with
// one bar per shown sign. Every capture is the same size (three square tiles and a band
// for the colour bars) whatever the window size or slice layout, so images line up.

import { tSf } from "./overlays.js";

const AXES = [  // NiiVue's axCorSag -> the world axis that slice is cut along
  { name: "Axial", axis: 2 },
  { name: "Coronal", axis: 1 },
  { name: "Sagittal", axis: 0 },
];
const TILE = 800;  // px per slice in a capture
const BAND = 160;  // px below the slices for colour bars
const BARS_PER_ROW = 4;

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

function fmtP(p) {
  return p < 0.001 ? p.toExponential(1) : p.toFixed(3);
}

/**
 * End labels of a colour bar: { unit, lo, hi }, lo at the threshold end. Entries are
 * { sign: "+"|"−", from, to, mode: "t"|"p", df }, with from/to as |T|. p is one-sided
 * and uncorrected, so the − bar shows the same p as the + bar for the same |T|.
 */
export function barEnds({ sign, from, to, mode, df }) {
  if (mode === "p" && df) return { unit: "p", lo: fmtP(tSf(from, df)), hi: fmtP(tSf(to, df)) };
  const s = sign === "−" ? "−" : "";
  return { unit: "T", lo: s + from.toFixed(2), hi: s + to.toFixed(2) };
}

export function createViewerTools({ getNv, getCoords, getLegend, isQuiz, store, wrap, toggle, button, setHint }) {
  const nv = getNv();
  const box = document.createElement("div");
  box.className = "slice-labels";
  wrap.append(box);
  const bars = document.createElement("div");
  bars.className = "cbars lookup-only";
  wrap.after(bars);
  toggle.checked = store.get("crosshair", true);

  // Hook drawScene so labels and the crosshair setting follow every redraw (clicks,
  // resizes, layout changes). The quiz always needs the crosshair.
  const draw = nv.drawScene.bind(nv);
  nv.drawScene = () => {
    nv.opts.crosshairWidth = toggle.checked || isQuiz() ? 1 : 0;
    const r = draw();
    labels();
    legend();
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

  // 256 RGB entries of a NiiVue colormap; sampled for CSS gradients and the capture.
  const lut = (name) => {
    const t = nv.colormap(name);
    return Array.from({ length: 256 }, (_, i) => [t[i * 4], t[i * 4 + 1], t[i * 4 + 2]]);
  };
  const gradient = (name, n = 12) => {
    const c = lut(name);
    return Array.from({ length: n }, (_, i) => `rgb(${c[Math.round(i * 255 / (n - 1))].join(",")})`).join(",");
  };

  function legend() {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const html = getLegend().map((e) => {
      const { unit, lo, hi } = barEnds(e);
      return `<div class="cbar" title="${esc(e.name)} (${e.sign})${unit === "p" ? " · p one-sided, uncorrected" : ""}">
        <span class="cbar-name">${esc(e.name)} <b>${e.sign}</b></span>
        <span class="cbar-row"><span>${unit} ${lo}</span><i style="background:linear-gradient(to right,${gradient(e.cmap)})"></i><span>${hi}</span></span></div>`;
    }).join("");
    if (bars.innerHTML !== html) bars.innerHTML = html;
  }

  function drawBars(ctx, y0) {
    const list = getLegend();
    if (!list.length) return;
    const cols = Math.min(list.length, BARS_PER_ROW), rows = Math.ceil(list.length / BARS_PER_ROW);
    const cw = (TILE * 3) / cols, ch = BAND / rows, pad = cw * 0.06;
    const font = Math.round(Math.min(ch * 0.2, 28));
    ctx.font = `${font}px -apple-system, "Segoe UI", sans-serif`;
    list.forEach((e, n) => {
      const x = (n % cols) * cw + pad, y = y0 + Math.floor(n / cols) * ch, w = cw - 2 * pad;
      const { unit, lo, hi } = barEnds(e);
      let name = `${e.name} (${e.sign})`;
      while (name.length > 4 && ctx.measureText(name).width > w) name = name.slice(0, -2) + "…";
      ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(name, x, y + ch * 0.08);
      const by = y + ch * 0.08 + font * 1.25, bh = ch * 0.2;
      lut(e.cmap).forEach((c, i) => {
        ctx.fillStyle = `rgb(${c.join(",")})`;
        ctx.fillRect(x + (w * i) / 256, by, w / 256 + 1, bh);
      });
      ctx.fillStyle = "#fff";
      ctx.fillText(`${unit} ${lo}`, x, by + bh + font * 0.25);
      ctx.textAlign = "right";
      ctx.fillText(hi, x + w, by + bh + font * 0.25);
    });
    ctx.textAlign = "left";
  }

  // The canvas is WebGL without preserveDrawingBuffer, so copy it right after a redraw,
  // in the same task, before the browser clears it.
  function capture() {
    nv.drawScene();
    const src = nv.canvas, out = document.createElement("canvas");
    out.width = TILE * 3; out.height = TILE + BAND;
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
    drawBars(ctx, TILE);
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
  return { capture, labels, legend };
}
