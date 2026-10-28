// Local overlays: NIfTI stat maps picked from this computer and drawn over the template.
//
// Files are read by the browser (file picker or drag and drop) and handed straight to
// NiiVue; nothing is uploaded to the server or stored, so this works for maps outside
// the results folder without opening another way into the filesystem.
//
// Each layer has its own threshold (as T, or as a p converted to T with the df from
// the header), sign, colormaps and opacity. Voxels below threshold are transparent.
// Every control applies on input, so dragging a slider updates the slices live.
// The list is drawn front to back: the top layer is painted last, over the others.
//
// p values are uncorrected and one-sided (in the direction of each sign), as in the
// rest of the app.

const POS_MAPS = ["warm", "hot", "red", "green", "blue", "violet", "plasma", "viridis", "inferno", "magma", "actc"];
const NEG_MAPS = ["winter", "cool", "blue", "electric_blue", "green", "violet", "viridis"];
const P_SLIDER = { min: -8, max: -1 };  // log10 p range of the slider in p mode

// --- t distribution (pure, exported for tests) --------------------------------------

function lnGamma(x) {
  // Lanczos approximation (g = 7, n = 9); accurate to ~1e-15 for x > 0.
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaCF(a, b, x) {
  // Continued fraction for the incomplete beta (modified Lentz).
  const tiny = 1e-300;
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

// Regularized incomplete beta I_x(a, b).
function incBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? front * betaCF(a, b, x) / a : 1 - front * betaCF(b, a, 1 - x) / b;
}

/** P(T >= t) for Student's t with df degrees of freedom. */
export function tSf(t, df) {
  const tail = 0.5 * incBeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? tail : 1 - tail;
}

/** The t with P(T >= t) = p, for 0 < p < 0.5 (bisection; tSf is monotone). */
export function tFromP(p, df) {
  if (!(p > 0 && p < 0.5) || !(df > 0)) return NaN;
  let lo = 0, hi = 1;
  while (tSf(hi, df) > p && hi < 1e6) { lo = hi; hi *= 2; }
  for (let i = 0; i < 200 && hi - lo > 1e-9 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (tSf(mid, df) > p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** df of a T map: SPM's "SPM{T_[df]}" description, else the NIfTI t-test intent. */
export function dfFromHeader(hdr) {
  const m = /SPM\{T_\[([\d.]+)\]\}/.exec(hdr?.description || "");
  if (m && +m[1] > 0) return +m[1];
  if (hdr?.intent_code === 3 && hdr.intent_p1 > 0) return hdr.intent_p1;  // NIFTI_INTENT_TTEST
  return null;
}

function fmtP(p) {
  if (p == null || !isFinite(p)) return "–";
  return p < 0.001 ? p.toExponential(1) : p.toFixed(3);
}

// --- layers ------------------------------------------------------------------------

// `head` holds the Add button (in the viewer's toolbar); `list` the layer controls, kept
// below the slices so adding layers doesn't push the brain down the page.
export function createOverlays({ NVImage, getNv, esc, head, list }) {
  const layers = [];  // front (index 0) to back
  let nextId = 1, lastMM = null;
  const nv = () => getNv();
  const names = (all) => {
    const have = new Set(nv()?.colormaps() || []);
    return all.filter((c) => have.has(c));
  };

  head.innerHTML = `
    <span>Local NIfTI</span>
    <button type="button" class="btn small primary" data-act="pick">＋ Add overlay…</button>
    <input type="file" accept=".nii,.nii.gz,.gz" multiple hidden>
    <span class="hint" style="margin:0" data-k="count">or drop .nii files on the brain · read in this browser, never uploaded · assumed MNI</span>`;
  const input = head.querySelector("input[type=file]");
  head.querySelector("[data-act=pick]").addEventListener("click", () => input.click());
  input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
  const hint = head.querySelector("[data-k=count]"), hintText = hint.textContent;

  async function addFiles(files) {
    for (const file of files) {
      if (!/\.nii(\.gz)?$/i.test(file.name)) continue;
      try {
        const vol = await NVImage.loadFromFile({ file, name: file.name, colormap: "warm", opacity: 0.9 });
        const df = dfFromHeader(vol.hdr);
        const maxPos = Math.max(+vol.global_max || 0, 0), maxNeg = Math.max(-(+vol.global_min) || 0, 0);
        layers.unshift({
          id: nextId++, name: file.name, vol, df, dfFromFile: df != null, maxPos, maxNeg,
          mode: "t", t: 3, p: 0.001, sign: maxNeg > 0 && maxPos > 0 ? "both" : maxNeg > 0 ? "neg" : "pos",
          cmap: "warm", cmapNeg: "winter", opacity: 0.9, visible: true, error: null,
        });
      } catch (e) {
        layers.unshift({ id: nextId++, name: file.name, error: e.message || String(e) });
      }
    }
    sync();
    render();
  }

  function thresholdT(L) {
    return L.mode === "p" ? tFromP(L.p, L.df) : L.t;
  }

  // Push one layer's settings into its NiiVue volume. Hiding a sign pushes its window
  // beyond the data, as the results-folder stat map does.
  function range(L) {
    const thr = thresholdT(L);
    const ok = isFinite(thr) && thr > 0;
    const top = Math.max(L.maxPos, L.maxNeg, (ok ? thr : 0) + 0.01);
    return { thr, ok, top, showPos: ok && L.sign !== "neg", showNeg: ok && L.sign !== "pos" };
  }

  function apply(L, redraw = true) {
    if (!L.vol) return;
    const { thr, ok, top, showPos, showNeg } = range(L);
    L.vol.colormap = L.cmap;  // the setter recomputes cal_min/max, so set it first
    L.vol.cal_min = showPos ? thr : top + 1;
    L.vol.cal_max = showPos ? top : top + 2;
    L.vol.colormapNegative = showNeg ? L.cmapNeg : "";
    L.vol.cal_minNeg = ok ? -thr : -top - 1;
    L.vol.cal_maxNeg = -top;
    L.vol.opacity = L.opacity;
    if (redraw && nv()?.volumes.includes(L.vol)) nv().updateGLVolume();
    describe(L);
  }

  // Re-add this module's volumes on top of whatever the page has loaded, in list order.
  // Called after the page rebuilds its own overlays (which removes everything but the
  // template) and whenever layers are added, removed, hidden or reordered.
  function sync() {
    const v = nv();
    if (!v?.volumes.length) return;
    for (const L of layers) if (L.vol && v.volumes.includes(L.vol)) v.removeVolume(L.vol);
    for (const L of [...layers].reverse()) {
      if (!L.vol || !L.visible) continue;
      apply(L, false);
      v.addVolume(L.vol);
    }
    v.updateGLVolume();
  }

  function render() {
    const pos = names(POS_MAPS), neg = names(NEG_MAPS);
    const opts = (all, cur) => all.map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("");
    const n = layers.filter((L) => L.vol).length;
    hint.textContent = n ? `${n} loaded · controls below the brain` : hintText;
    list.hidden = !layers.length;
    list.innerHTML =layers.map((L, i) => L.error ? `
      <div class="ov-layer" data-id="${L.id}"><div class="ov-row">
        <span class="ov-name err" title="${esc(L.name)}">${esc(L.name)}: could not read (${esc(L.error)})</span>
        <button type="button" class="btn small" data-act="remove" aria-label="Remove">✕</button></div></div>` : `
      <div class="ov-layer${L.visible ? "" : " off"}" data-id="${L.id}">
        <div class="ov-row">
          <input type="checkbox" data-k="visible" ${L.visible ? "checked" : ""} aria-label="Show ${esc(L.name)}">
          <span class="ov-name" title="${esc(L.name)}">${esc(L.name)}</span>
          ${i === 0 ? `<span class="badge">front</span>` : ""}
          <span class="grow"></span>
          <span class="ov-btns">
            <button type="button" class="btn small" data-act="front" ${i === 0 ? "disabled" : ""} title="Bring to front">⤒</button>
            <button type="button" class="btn small" data-act="up" ${i === 0 ? "disabled" : ""} title="Move forward">▲</button>
            <button type="button" class="btn small" data-act="down" ${i === layers.length - 1 ? "disabled" : ""} title="Move backward">▼</button>
            <button type="button" class="btn small" data-act="remove" title="Remove">✕</button>
          </span>
        </div>
        <div class="ov-row">
          <div class="seg ov-mode"><button type="button" data-mode="t" class="${L.mode === "t" ? "on" : ""}">T ≥</button><button type="button" data-mode="p" class="${L.mode === "p" ? "on" : ""}" ${L.df ? "" : "disabled title=\"Needs df\""}>p &lt;</button></div>
          <input type="number" data-k="value" step="${L.mode === "t" ? 0.1 : 0.0001}" min="${L.mode === "t" ? 0 : 1e-12}" ${L.mode === "p" ? 'max="0.5"' : ""} value="${L.mode === "t" ? L.t : L.p}" aria-label="Threshold">
          <input type="range" data-k="slider" class="grow" aria-label="Threshold slider">
          <select data-k="sign" aria-label="Sign">
            <option value="both" ${L.sign === "both" ? "selected" : ""}>± both</option>
            <option value="pos" ${L.sign === "pos" ? "selected" : ""}>+ positive</option>
            <option value="neg" ${L.sign === "neg" ? "selected" : ""}>− negative</option>
          </select>
        </div>
        <div class="ov-row">
          <label>+ <select data-k="cmap">${opts(pos, L.cmap)}</select></label>
          <label>− <select data-k="cmapNeg">${opts(neg, L.cmapNeg)}</select></label>
          <label class="grow ov-opacity">Opacity <input type="range" data-k="opacity" min="0" max="1" step="0.05" value="${L.opacity}"></label>
          <label title="Degrees of freedom${L.dfFromFile ? " (from the file header)" : ""}">df <input type="number" data-k="df" min="1" step="1" value="${L.df ?? ""}" placeholder="?"></label>
        </div>
        <div class="hint ov-info"></div>
      </div>`).join("");
    for (const L of layers) if (L.vol) { setSlider(L); describe(L); }
  }

  const el = (L, sel) => list.querySelector(`.ov-layer[data-id="${L.id}"] ${sel}`);
  function setSlider(L) {
    const s = el(L, "[data-k=slider]");
    if (!s) return;
    if (L.mode === "t") {
      Object.assign(s, { min: 0, max: Math.max(L.maxPos, L.maxNeg, 1).toFixed(2), step: 0.01 });
      s.value = L.t;
    } else {
      Object.assign(s, { min: P_SLIDER.min, max: P_SLIDER.max, step: 0.01 });
      s.value = Math.log10(L.p);  // slider runs from strict (left) to lenient (right)
    }
  }

  function describe(L) {
    const info = el(L, ".ov-info");
    if (!info) return;
    const thr = thresholdT(L);
    const max = `max ${L.maxPos.toFixed(2)} / min ${L.maxNeg ? "−" + L.maxNeg.toFixed(2) : "0"}`;
    if (!isFinite(thr) || thr <= 0) { info.textContent = `Enter a threshold above 0 · ${max}`; return; }
    const p = L.df ? tSf(thr, L.df) : null;
    info.innerHTML = `T ≥ ${thr.toFixed(2)}` + (L.df ? ` ≈ p < ${fmtP(p)} (df ${+L.df.toFixed(2)}), one-sided, uncorrected` :
      ` · no df in the header: enter df for p values`) + ` · ${max}<span class="ov-here"></span>`;
    here(L);
  }

  // The layer's value at the crosshair.
  function here(L) {
    const span = lastMM && L.vol && el(L, ".ov-here");
    if (!span) return;
    const [x, y, z] = L.vol.mm2vox(lastMM);
    const d = L.vol.hdr.dims;
    const inside = x >= 0 && y >= 0 && z >= 0 && x < d[1] && y < d[2] && z < d[3];
    const t = inside ? L.vol.getValue(x, y, z) : NaN;
    span.textContent = !isFinite(t) ? " · here: outside" :
      ` · here: ${t.toFixed(2)}` + (L.df && Math.abs(t) >= 0.005 ? ` (p = ${fmtP(tSf(Math.abs(t), L.df))})` : "");
  }

  function readout(mm) {
    lastMM = mm;
    for (const L of layers) here(L);
  }

  const layerOf = (e) => layers.find((L) => L.id === +e.target.closest(".ov-layer")?.dataset.id);

  list.addEventListener("click", (e) => {
    const L = layerOf(e);
    if (!L) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    const mode = e.target.closest("[data-mode]")?.dataset.mode;
    if (mode && mode !== L.mode && !e.target.disabled) {
      // Keep the same effective threshold when switching between T and p.
      const thr = thresholdT(L);
      if (mode === "p" && isFinite(thr) && thr > 0) L.p = +tSf(thr, L.df).toPrecision(2);
      if (mode === "t" && isFinite(thr)) L.t = +thr.toFixed(2);
      L.mode = mode; apply(L); render(); return;
    }
    if (!act) return;
    const i = layers.indexOf(L);
    if (act === "remove") { layers.splice(i, 1); if (L.vol && nv()?.volumes.includes(L.vol)) nv().removeVolume(L.vol); }
    else if (act === "front") layers.unshift(...layers.splice(i, 1));
    else if (act === "up" && i > 0) [layers[i - 1], layers[i]] = [layers[i], layers[i - 1]];
    else if (act === "down" && i < layers.length - 1) [layers[i + 1], layers[i]] = [layers[i], layers[i + 1]];
    else return;
    sync(); render();
  });

  // Live updates: number fields and sliders apply on every input event.
  list.addEventListener("input", (e) => {
    const L = layerOf(e), k = e.target.dataset.k;
    if (!L?.vol || !k) return;
    const v = e.target.value;
    if (k === "value" && v !== "" && +v > 0) { L.mode === "t" ? (L.t = +v) : (L.p = Math.min(+v, 0.499)); setSlider(L); }
    else if (k === "slider") {
      L.mode === "t" ? (L.t = +(+v).toFixed(2)) : (L.p = +(10 ** +v).toPrecision(2));
      el(L, "[data-k=value]").value = L.mode === "t" ? L.t : L.p;
    }
    else if (k === "opacity") L.opacity = +v;
    else if (k === "df") { L.df = +v > 0 ? +v : null; if (!L.df && L.mode === "p") { L.mode = "t"; render(); } else el(L, ".ov-mode [data-mode=p]").disabled = !L.df; }
    else return;
    apply(L);
  });
  list.addEventListener("change", (e) => {
    const L = layerOf(e), k = e.target.dataset.k;
    if (!L?.vol || !k) return;
    if (k === "visible") { L.visible = e.target.checked; sync(); render(); }
    else if (["sign", "cmap", "cmapNeg"].includes(k)) { L[k] = e.target.value; apply(L); }
  });

  // Colour bars for the visible layers, front first: one per shown sign.
  function legend() {
    const out = [];
    for (const L of layers) {
      if (!L.vol || !L.visible) continue;
      const { thr, top, showPos, showNeg } = range(L);
      const base = { name: L.name, from: thr, to: top, df: L.df, mode: L.mode };
      if (showPos) out.push({ ...base, sign: "+", cmap: L.cmap });
      if (showNeg) out.push({ ...base, sign: "−", cmap: L.cmapNeg });
    }
    return out;
  }

  return { addFiles, sync, readout, legend, get layers() { return layers; } };
}
