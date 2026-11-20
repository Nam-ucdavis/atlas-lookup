// Viewer extras: a crosshair on/off switch, the slice coordinate in the bottom-left
// corner of each slice, colour bars for the stat overlays, and captures for the camera
// button's Save image dialog (shotdialog.js): any of the three slices side by side with
// the colour bars, on a black, white or transparent background.
//
// The labels follow the input mode: MNI mm (x, y, z), or voxel indices (i, j, k) on the
// chosen reference grid, with the same 0/1 base as the form. Colour bars run from the
// threshold to the strongest value, labelled in T or p as each layer is thresholded, with
// one bar per shown sign. Every capture of the same views is the same size (square tiles
// and a band for the colour bars) whatever the window size or slice layout, so images
// line up.
// `altCapture` lets another view (the 3D tab) supply the image instead; it gets
// drawBars so its capture carries the same colour bars.

import { tSf } from "./overlays.js";

const AXES = [  // NiiVue's axCorSag -> the world axis that slice is cut along
  { name: "Axial", axis: 2 },
  { name: "Coronal", axis: 1 },
  { name: "Sagittal", axis: 0 },
];
const TILE = 800;  // px per slice in a capture
const BAND = 160;  // px below the slices for colour bars
const BARS_PER_ROW = 4;

// Background choices for captures: fill (null = transparent) and the colour for text.
export const BACKGROUNDS = {
  black: { fill: "#000", ink: "#fff" },
  white: { fill: "#fff", ink: "#000" },
  transparent: { fill: null, ink: "#000" },
};

/**
 * Clear the black around the brain (NiiVue draws empty space in its black back colour):
 * every near-black pixel connected to the edge of the canvas becomes transparent. Edges
 * there are smooth fades into black (the brain's outline, the crosshair), so pixels in
 * a thin band next to the cleared area are "un-blended" from black: their brightness
 * becomes opacity, keeping the colour. Black inside the brain is left alone. Draw the
 * result over white (or nothing) for a white (or transparent) background.
 */
const FRINGE_PX = 6, FRINGE_LEVEL = 128;
export function knockOut(canvas) {
  const { width: w, height: h } = canvas, ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, w, h), d = img.data, seen = new Uint8Array(w * h);
  const peak = (i) => Math.max(d[4 * i], d[4 * i + 1], d[4 * i + 2]);
  const near = (i, f) => {
    const x = i % w;
    if (x > 0) f(i - 1);
    if (x < w - 1) f(i + 1);
    if (i >= w) f(i - w);
    if (i < w * (h - 1)) f(i + w);
  };
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  let edge = [];
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    if (peak(i) > 4) { edge.push(i); continue; }
    seen[i] = 1;
    d[4 * i + 3] = 0;
    near(i, (k) => stack.push(k));
  }
  // The fade: up to FRINGE_PX steps in from the cleared area, through pixels darker
  // than FRINGE_LEVEL; opacity = brightness / FRINGE_LEVEL, colour scaled back up.
  for (let step = 0; step < FRINGE_PX && edge.length; step++) {
    const next = [];
    for (const i of edge) {
      if (seen[i]) continue;
      seen[i] = 2;
      const m = peak(i);
      if (m >= FRINGE_LEVEL) continue;
      const a = m / FRINGE_LEVEL;
      for (let c = 0; c < 3; c++) d[4 * i + c] = Math.min(255, Math.round(d[4 * i + c] / a));
      d[4 * i + 3] = Math.round(255 * a);
      near(i, (k) => { if (!seen[k]) next.push(k); });
    }
    edge = next;
  }
  ctx.putImageData(img, 0, 0);
}

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
export function barEnds({ sign, from, to, mode, df }, minus = "−") {
  if (mode === "p" && df) return { unit: "p", lo: fmtP(tSf(from, df)), hi: fmtP(tSf(to, df)) };
  const s = sign === "−" ? minus : "";
  return { unit: "T", lo: s + from.toFixed(2), hi: s + to.toFixed(2) };
}

export function createViewerTools({ getNv, getCoords, getLegend, isQuiz, store, wrap, toggle, altCapture, barsHost, barHost, getMarks = () => [] }) {
  const nv = getNv();
  const box = document.createElement("div");
  box.className = "slice-labels";
  wrap.append(box);
  const bars = document.createElement("div");
  bars.className = "cbars lookup-only";
  if (barsHost) barsHost.append(bars); else wrap.after(bars);
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

  // Colour bars with editable ends: min is the threshold, max the top of the colour
  // range (blank = the data's strongest value). The DOM is rebuilt only when the set of
  // bars changes, so typing in a box is never interrupted by the redraws it causes.
  // barHost(entry) may give a bar its own container (e.g. its row in a layer list);
  // the rest go in the shared one.
  let shown = new Map(), shape = "", els = new Map();
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const id = (e) => e.key + e.sign;

  function legend() {
    const list = getLegend();
    shown = new Map(list.map((e) => [id(e), e]));
    const next = list.map((e) => id(e) + e.cmap).join("|");
    // Also rebuild when a host re-rendered and dropped its bars.
    if (next !== shape || [...els.values()].some((el) => !el.isConnected)) {
      shape = next;
      for (const el of els.values()) el.remove();
      els = new Map();
      for (const e of list) {
        const el = document.createElement("div");
        el.className = "cbar";
        el.dataset.id = id(e);
        el.innerHTML = `<span class="cbar-name">${esc(e.name)}</span>
          <span class="cbar-row"><b class="cbar-sign">${e.sign}</b><span class="cbar-unit"></span>
            <input type="number" step="any" data-end="from" aria-label="Colour bar minimum (threshold)">
            <i style="background:linear-gradient(to right,${gradient(e.cmap)})"></i>
            <input type="number" step="any" data-end="to" aria-label="Colour bar maximum">
            <button type="button" class="linkish" data-end="auto" title="Back to the data maximum">auto</button></span>`;
        el.addEventListener("input", (ev) => edit(ev, false));
        el.addEventListener("change", (ev) => edit(ev, true));
        el.addEventListener("click", (ev) => ev.target.dataset.end === "auto" && edit(ev, true));
        (barHost?.(e) || bars).append(el);
        els.set(id(e), el);
      }
    }
    for (const e of list) {
      const row = els.get(id(e));
      const { unit, lo, hi } = barEnds(e, "-");
      row.title = `${e.name} (${e.sign})${unit === "p" ? " · p one-sided, uncorrected" : ""}`;
      row.querySelector(".cbar-unit").textContent = unit;
      for (const [end, v] of [["from", lo], ["to", hi]]) {
        const input = row.querySelector(`input[data-end=${end}]`);
        if (input !== document.activeElement) input.value = v;
      }
      row.querySelector("[data-end=auto]").hidden = e.auto;
    }
  }

  const edit = (ev, commit) => {
    const end = ev.target.dataset.end, e = shown.get(ev.target.closest(".cbar")?.dataset.id);
    if (!e || !end) return;
    if (end === "auto") return commit && e.setTo(null);
    const raw = ev.target.value.trim();
    if (end === "to" && raw === "") return commit && e.setTo(null);
    const v = +raw;
    if (!raw || !isFinite(v) || v === 0) return;
    end === "from" ? e.setFrom(v) : e.setTo(v);
  };

  // Colour bars per row for a capture `width` px wide (four across three tiles).
  const perRow = (width) => Math.max(1, Math.round((width / (TILE * 3)) * BARS_PER_ROW));
  // Height of the colour-bar band: fixed for a full-width capture (so those always match),
  // otherwise a row per line of bars (none without bars).
  function bandHeight(width) {
    const n = getLegend().length;
    if (width >= TILE * 3) return BAND;
    return n ? BAND * Math.ceil(n / perRow(width)) : 0;
  }

  function drawBars(ctx, y0, { width = TILE * 3, height = BAND, ink = "#fff" } = {}) {
    const list = getLegend();
    if (!list.length || !height) return;
    const per = perRow(width);
    const cols = Math.min(list.length, per), rows = Math.ceil(list.length / per);
    const cw = width / cols, ch = height / rows, pad = cw * 0.06;
    const font = Math.round(Math.min(ch * 0.2, 28));
    ctx.font = `${font}px -apple-system, "Segoe UI", sans-serif`;
    list.forEach((e, n) => {
      const x = (n % cols) * cw + pad, y = y0 + Math.floor(n / cols) * ch, w = cw - 2 * pad;
      const { unit, lo, hi } = barEnds(e);
      let name = `${e.name} (${e.sign})`;
      while (name.length > 4 && ctx.measureText(name).width > w) name = name.slice(0, -2) + "…";
      ctx.fillStyle = ink; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(name, x, y + ch * 0.08);
      const by = y + ch * 0.08 + font * 1.25, bh = ch * 0.2;
      lut(e.cmap).forEach((c, i) => {
        ctx.fillStyle = `rgb(${c.join(",")})`;
        ctx.fillRect(x + (w * i) / 256, by, w / 256 + 1, bh);
      });
      ctx.fillStyle = ink;
      ctx.fillText(`${unit} ${lo}`, x, by + bh + font * 0.25);
      ctx.textAlign = "right";
      ctx.fillText(hi, x + w, by + bh + font * 0.25);
    });
    ctx.textAlign = "left";
  }

  // The canvas is WebGL without preserveDrawingBuffer, so copy it right after a redraw,
  // in the same task, before the browser clears it. views: NiiVue axCorSag numbers
  // (0 axial, 1 coronal, 2 sagittal), drawn left to right in that order.
  // Tag markers as on screen: a yellow dot (grey for other maps' tags) and the name,
  // outlined so it reads on any background. Drawn after the background is cleared.
  function drawMarks(ctx, list, place, ink) {
    const r = TILE * 0.009, font = Math.round(TILE * 0.026);
    ctx.font = `600 ${font}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.lineJoin = "round";
    for (const m of list) {
      const [x, y] = place(m), colour = m.mine ? "#ffe14d" : "#c9c9c9";
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = colour; ctx.fill();
      ctx.lineWidth = r * 0.4; ctx.strokeStyle = "#000"; ctx.stroke();
      // The name goes right of the dot, or left of it if it would run off the tile.
      const tw = ctx.measureText(m.label).width, left = x + r * 1.8 + tw > TILE - r;
      const tx = left ? x - r * 1.8 - tw : x + r * 1.8;
      // On black: the label in the marker colour with a black outline, as on screen.
      // On white/transparent: the text colour, outlined in white.
      ctx.lineWidth = font * 0.22;
      ctx.strokeStyle = ink === "#fff" ? "#000" : "#fff";
      ctx.strokeText(m.label, tx, y);
      ctx.fillStyle = ink === "#fff" ? colour : ink;
      ctx.fillText(m.label, tx, y);
    }
  }

  function capture({ views = [0, 1, 2], background = "black", tags = false, bars = true } = {}) {
    const bg = BACKGROUNDS[background] || BACKGROUNDS.black;
    const order = [0, 1, 2].filter((v) => views.includes(v));
    if (!order.length) return Promise.resolve(null);
    nv.drawScene();
    const src = nv.canvas, out = document.createElement("canvas");
    const width = TILE * order.length, band = bars ? bandHeight(width) : 0;
    out.width = width; out.height = TILE + band;
    const ctx = out.getContext("2d");
    if (bg.fill) { ctx.fillStyle = bg.fill; ctx.fillRect(0, 0, out.width, out.height); }
    const tile = document.createElement("canvas");
    tile.width = tile.height = TILE;
    const tctx = tile.getContext("2d");
    const opts = getCoords(), p = mm(), have = new Map(slices().map((s) => [s.axCorSag, s]));
    const marks = tags ? getMarks() : [];
    for (const [n, v] of order.entries()) {
      const s = have.get(v);
      if (!s) continue;
      const [l, t, w, h] = s.leftTopWidthHeight, k = Math.min(TILE / w, TILE / h);
      const ox = (TILE - w * k) / 2, oy = (TILE - h * k) / 2;
      tctx.fillStyle = "#000"; tctx.fillRect(0, 0, TILE, TILE);
      tctx.drawImage(src, l, t, w, h, ox, oy, w * k, h * k);
      if (background !== "black") knockOut(tile);
      const mine = marks.filter((m) => m.view === v);
      if (mine.length) drawMarks(tctx, mine, (m) => [ox + (m.x - l) * k, oy + (m.y - t) * k], bg.ink);
      ctx.drawImage(tile, n * TILE, 0);
    }
    ctx.font = `${Math.round(TILE * 0.035)}px -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = bg.ink; ctx.textBaseline = "bottom";
    for (const [n, v] of order.entries()) ctx.fillText(sliceLabel(v, p, opts), n * TILE + TILE * 0.03, TILE * 0.97);
    drawBars(ctx, TILE, { width, height: band, ink: bg.ink });
    return new Promise((resolve) => out.toBlob(resolve, "image/png"));
  }

  /** The image for the Save image dialog: the 3D view's render when that tab is open
   * (altCapture), else the chosen slices. */
  const captureView = async (opts = {}) =>
    (await altCapture?.((ctx, y0, o) => drawBars(ctx, y0, o), opts)) || capture(opts);

  nv.drawScene();
  return { capture, captureView, labels, legend, drawBars, refreshLegend: () => { shape = ""; legend(); } };
}
