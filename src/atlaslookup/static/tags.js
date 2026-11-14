// Tags: named points ("dmFC" at a peak), saved by the server in your data folder
// (DATA_DIR/tags.json, never in the results folder), one set per stat map: a tag belongs
// to the map that was active when it was made (or to no map). The server matches maps by
// path and by contents, so tags survive a moved or renamed results folder.
//
//  - The tag bar under the coordinate: name the point at the crosshair and press Enter;
//    the tags at (or within NEAR_MM of) the point are listed there.
//  - The side panel's Tags tab: the active map's tags (click one to go there, rename,
//    delete), optionally every other map's too (greyed), and a CSV export with the regions
//    at each point.
//  - Markers on the slices: a dot and the name for each tag within SLICE_MM of a slice.

const NEAR_MM = 3;   // a tag this close to the crosshair counts as "here"
const SLICE_MM = 2.5;  // a tag this close to a slice's plane is drawn on it
const AXIS = [2, 1, 0];  // NiiVue axCorSag -> world axis cut across

export function createTags({ store, esc, host, bar, wrap, getNv, getMap, mapName, goTo, onChange = () => {} }) {
  let tags = [], map = null, point = null, showOthers = store.get("tagsShowOthers", false);
  const mine = () => tags.filter((t) => t.mine);
  const shown = () => tags.filter((t) => t.mine || showOthers);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const fmt = (mm) => mm.map((v) => String(+(+v).toFixed(1)).replace("-", "−")).join(", ");

  async function api(method, url, body) {
    const r = await fetch(url, body === undefined ? { method } : {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || `${r.status}`);
    return d;
  }

  async function load() {
    const want = getMap();
    const d = await api("GET", "/api/tags" + (want ? `?map=${encodeURIComponent(want)}` : "")).catch(() => null);
    if (want !== getMap()) return;  // the active map changed meanwhile
    map = want;
    tags = d?.tags || [];
    renderAll();
  }

  // --- tag bar ------------------------------------------------------------------------
  bar.innerHTML = `<form class="tag-form" autocomplete="off">
      <input type="text" maxlength="80" placeholder="Tag this point, e.g. dmFC" aria-label="Tag name for the point at the crosshair">
      <button type="submit" class="btn small">Add tag</button>
    </form><span class="tag-here"></span><span class="tag-msg hint"></span>`;
  const form = bar.querySelector("form"), input = form.querySelector("input");
  const here = bar.querySelector(".tag-here"), msg = bar.querySelector(".tag-msg");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = input.value.trim();
    if (!label || !point) return;
    try {
      const t = await api("POST", "/api/tags", { label, mm: point, map: getMap() });
      tags.push(t);
      input.value = "";
      msg.textContent = `Saved for ${getMap() ? mapName(getMap()) : "no map"}.`;
      setTimeout(() => { if (msg.textContent.startsWith("Saved")) msg.textContent = ""; }, 4000);
      renderAll();
    } catch (err) { msg.textContent = `Not saved: ${err.message}`; }
  });
  function renderBar() {
    const near = point ? shown().filter((t) => dist(t.mm, point) <= NEAR_MM) : [];
    here.innerHTML = near.map((t) => `<button type="button" class="tag-chip${t.mine ? "" : " other"}" data-go="${t.id}"
      title="${esc(t.label)} at (${fmt(t.mm)})${t.mine ? "" : ` · ${esc(t.map ? mapName(t.map) : "no map")}`}">🏷 ${esc(t.label)}</button>`).join("");
  }
  here.addEventListener("click", (e) => {
    const t = tags.find((x) => x.id === e.target.closest("[data-go]")?.dataset.go);
    if (t) goTo(t.mm);
  });

  // --- Tags tab -----------------------------------------------------------------------
  host.innerHTML = `<div class="tags-tab">
      <div class="tags-head"><b class="tags-for"></b></div>
      <div class="tags-list"></div>
      <label class="tags-others"><input type="checkbox"> Show other maps' tags</label>
      <div class="tags-foot"><a class="btn small" href="/api/tags.csv" download>Export all as CSV</a>
        <span class="hint" style="margin:0">with the regions at each point</span></div>
      <p class="hint">Tags are saved in your Atlas Lookup data folder (tags.json), not in the results
        folder, and follow each map even if it is moved or renamed.</p>
    </div>`;
  const list = host.querySelector(".tags-list"), others = host.querySelector(".tags-others input");
  others.checked = showOthers;
  others.addEventListener("change", () => {
    showOthers = others.checked;
    store.set("tagsShowOthers", showOthers);
    renderAll();
  });
  function row(t) {
    return `<div class="tag-row${t.mine ? "" : " other"}" data-id="${t.id}">
      <button type="button" class="tag-go linkish" data-go="${t.id}" title="Go to (${fmt(t.mm)})">${esc(t.label)}</button>
      <span class="tag-mm">${fmt(t.mm)}</span>
      ${t.mine ? `<span class="tag-acts"><button type="button" class="linkish" data-rename="${t.id}" title="Rename">Rename</button>
        <button type="button" class="linkish" data-del="${t.id}" title="Delete">Delete</button></span>` : `<span class="tag-map">${esc(t.map ? mapName(t.map) : "no map")}</span>`}
    </div>`;
  }
  function renderTab() {
    host.querySelector(".tags-for").textContent = map ? `Tags of ${mapName(map)}` : "Tags made with no stat map open";
    const m = mine(), o = showOthers ? tags.filter((t) => !t.mine) : [];
    list.innerHTML = (m.length ? m.map(row).join("") : `<div class="hint">No tags yet. Put the crosshair on a point, type a name under the coordinate and press Enter.</div>`)
      + (o.length ? `<div class="tags-sub">Other maps</div>` + o.map(row).join("") : "");
  }
  list.addEventListener("click", async (e) => {
    const go = e.target.closest("[data-go]"), ren = e.target.closest("[data-rename]"), del = e.target.closest("[data-del]");
    const id = (go || ren || del)?.dataset.go || ren?.dataset.rename || del?.dataset.del;
    const t = tags.find((x) => x.id === id);
    if (!t) return;
    if (go) goTo(t.mm);
    else if (ren) {
      const name = prompt("Rename tag", t.label);
      if (name === null || !name.trim() || name.trim() === t.label) return;
      try { Object.assign(t, await api("PATCH", `/api/tags/${t.id}`, { label: name })); renderAll(); }
      catch (err) { alert(`Not renamed: ${err.message}`); }
    } else if (del) {
      if (!confirm(`Delete the tag "${t.label}" at (${fmt(t.mm)})?`)) return;
      try { await api("DELETE", `/api/tags/${t.id}`); tags = tags.filter((x) => x !== t); renderAll(); }
      catch (err) { alert(`Not deleted: ${err.message}`); }
    }
  });

  // --- markers on the slices ----------------------------------------------------------
  const marks = document.createElement("div");
  marks.className = "tag-marks lookup-only";
  wrap.append(marks);
  function drawMarks() {
    const nv = getNv();
    if (!nv?.volumes?.length || !nv.screenSlices) { marks.innerHTML = ""; return; }
    const c = nv.canvas, scale = c.width / (c.clientWidth || c.width);
    const at = Array.from(nv.frac2mm(nv.scene.crosshairPos)).slice(0, 3);
    let html = "";
    for (const s of nv.screenSlices) {
      if (!(s.axCorSag in AXIS)) continue;
      const ax = AXIS[s.axCorSag], [l, t, w, h] = s.leftTopWidthHeight;
      for (const tag of shown()) {
        if (Math.abs(tag.mm[ax] - at[ax]) > SLICE_MM) continue;
        const p = nv.frac2canvasPosWithTile(nv.mm2frac(tag.mm), s.axCorSag);
        if (!p) continue;
        const [x, y] = p.pos;
        if (x < l || x > l + w || y < t || y > t + h) continue;
        html += `<span class="tag-mark${tag.mine ? "" : " other"}" style="left:${x / scale}px;top:${y / scale}px"><i></i>${esc(tag.label)}</span>`;
      }
    }
    if (marks.innerHTML !== html) marks.innerHTML = html;
  }
  const nv = getNv();
  const draw = nv.drawScene.bind(nv);
  nv.drawScene = (...a) => { const r = draw(...a); drawMarks(); return r; };

  function renderAll() {
    renderBar();
    renderTab();
    drawMarks();
    onChange(mine().length);
  }

  return {
    /** The point at the crosshair (after each lookup). */
    setPoint(mm) { point = mm.slice(0, 3).map(Number); renderBar(); },
    /** The active stat map changed (getMap() has the new one). */
    refresh: load,
    redraw: drawMarks,
  };
}
