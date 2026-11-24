// Tags: named points ("dmFC" at a peak), saved by the server in your data folder
// (DATA_DIR/tags.json, never in the results folder), one set per stat map: a tag belongs
// to the map that was active when it was made (or to no map). The server matches maps by
// path and by contents, so tags survive a moved or renamed results folder.
//
//  - The tag bar under the coordinate: name the point at the crosshair and press Enter;
//    the tags at (or within NEAR_MM of) the point are listed there as chips. Click a chip
//    to go to its exact point and edit it there.
//  - The side panel's Tags tab: the active map's tags (click one to go there; Edit opens
//    the same editor), optionally every other map's too (greyed), and a CSV export with
//    the regions at each point.
//  - The editor: name, note, "Move to the crosshair" (click the new spot while it is open,
//    then tick it), Save, Delete. Esc or Cancel closes it.
//  - Markers on the slices: a dot and the name for each tag within SLICE_MM of a slice.
//    "Show on slices" (in the tag bar and the Tags tab) turns them off and on; remembered.

const NEAR_MM = 3;   // a tag this close to the crosshair counts as "here"
const SLICE_MM = 2.5;  // a tag this close to a slice's plane is drawn on it
const AXIS = [2, 1, 0];  // NiiVue axCorSag -> world axis cut across

export function createTags({ store, esc, host, bar, wrap, getNv, getMap, mapName, goTo, onChange = () => {} }) {
  let tags = [], map = null, point = null, showOthers = store.get("tagsShowOthers", false);
  let showMarks = store.get("tagsShowMarks", true);
  let editing = null;  // {id, where: "bar" | "tab"}: the tag whose editor is open
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
    if (editing && !tags.some((t) => t.id === editing.id)) editing = null;
    renderAll();
  }

  // --- tag bar ------------------------------------------------------------------------
  bar.innerHTML = `<form class="tag-form" autocomplete="off">
      <input type="text" maxlength="80" placeholder="Tag this point, e.g. dmFC" aria-label="Tag name for the point at the crosshair">
      <button type="submit" class="btn small">Add tag</button>
    </form><label class="tags-marks-toggle" title="Show the tags' dots and names on the slices">
      <input type="checkbox" data-show-marks> Show on slices</label><span class="tag-here"></span><span class="tag-msg hint"></span><div class="tag-edit-host"></div>`;
  const form = bar.querySelector("form"), input = form.querySelector("input");
  const here = bar.querySelector(".tag-here"), msg = bar.querySelector(".tag-msg");
  const barEdit = bar.querySelector(".tag-edit-host");
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
      title="${esc(t.label)} at (${fmt(t.mm)})${t.mine ? "" : ` · ${esc(t.map ? mapName(t.map) : "no map")}`}${t.note ? `\n${esc(t.note)}` : ""}\nClick to go there and edit">🏷 ${esc(t.label)}</button>`).join("");
  }
  here.addEventListener("click", (e) => {
    const t = tags.find((x) => x.id === e.target.closest("[data-go]")?.dataset.go);
    if (!t) return;
    goTo(t.mm);
    openEditor(t, "bar");
  });

  // --- editor (shared by the tag bar and the Tags tab) ------------------------------------
  const moved = (t) => point && dist(t.mm, point) > 0.05;
  function editorHTML(t) {
    return `<form class="tag-edit" data-edit="${t.id}" autocomplete="off">
      <div class="tag-edit-row">
        <input type="text" name="label" maxlength="80" value="${esc(t.label)}" aria-label="Tag name" required>
        <span class="tag-mm">at ${fmt(t.mm)}${t.mine ? "" : ` · ${esc(t.map ? mapName(t.map) : "no map")}`}</span>
      </div>
      <textarea name="note" rows="2" maxlength="2000" placeholder="Note (optional)" aria-label="Note">${esc(t.note || "")}</textarea>
      <label class="tag-move"><input type="checkbox" name="move"${moved(t) ? "" : " disabled"}>
        <span>${moveText(t)}</span></label>
      <div class="tag-edit-acts">
        <button type="submit" class="btn small primary">Save</button>
        <button type="button" class="btn small" data-cancel>Cancel</button>
        <button type="button" class="btn small danger" data-del="${t.id}">Delete</button>
        <span class="tag-edit-msg hint"></span>
      </div>
    </form>`;
  }
  function moveText(t) {
    return moved(t) ? `Move to the crosshair (${fmt(point)})` : "Move to the crosshair (click a new spot first)";
  }
  // Keep the open editor's "Move" option in step with the crosshair without redrawing it.
  function syncMove() {
    const t = editing && tags.find((x) => x.id === editing.id);
    const f = t && (editing.where === "bar" ? barEdit : list).querySelector(".tag-edit");
    if (!f) return;
    const box = f.elements.move;
    box.disabled = !moved(t);
    if (box.disabled) box.checked = false;
    box.nextElementSibling.textContent = moveText(t);
  }
  function openEditor(t, where) {
    editing = { id: t.id, where };
    renderAll();
    const f = (where === "bar" ? barEdit : list).querySelector(".tag-edit");
    f?.elements.label.focus();
    f?.elements.label.select();
  }
  function closeEditor() { editing = null; renderAll(); }
  async function save(f) {
    const t = tags.find((x) => x.id === f.dataset.edit);
    if (!t) return closeEditor();
    const body = {}, label = f.elements.label.value.trim(), note = f.elements.note.value.trim();
    if (!label) { f.elements.label.focus(); return; }
    if (label !== t.label) body.label = label;
    if (note !== (t.note || "")) body.note = note;
    if (f.elements.move.checked && point) body.mm = point;
    if (!Object.keys(body).length) return closeEditor();
    try {
      Object.assign(t, await api("PATCH", `/api/tags/${t.id}`, body));
      editing = null;
      renderAll();
    } catch (err) { f.querySelector(".tag-edit-msg").textContent = `Not saved: ${err.message}`; }
  }
  async function remove(t, f) {
    if (!confirm(`Delete the tag "${t.label}" at (${fmt(t.mm)})?`)) return;
    try {
      await api("DELETE", `/api/tags/${t.id}`);
      tags = tags.filter((x) => x !== t);
      if (editing?.id === t.id) editing = null;
      renderAll();
    } catch (err) {
      const m = f?.querySelector(".tag-edit-msg");
      if (m) m.textContent = `Not deleted: ${err.message}`; else alert(`Not deleted: ${err.message}`);
    }
  }
  function wireEditor(el) {
    el.addEventListener("submit", (e) => {
      const f = e.target.closest(".tag-edit");
      if (!f) return;
      e.preventDefault();
      save(f);
    });
    el.addEventListener("click", (e) => {
      const f = e.target.closest(".tag-edit");
      if (!f) return;
      if (e.target.closest("[data-cancel]")) closeEditor();
      else if (e.target.closest("[data-del]")) {
        const t = tags.find((x) => x.id === f.dataset.edit);
        if (t) remove(t, f);
      }
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && e.target.closest(".tag-edit")) { e.preventDefault(); closeEditor(); }
    });
  }
  wireEditor(barEdit);
  function renderBarEditor() {
    const t = editing?.where === "bar" && tags.find((x) => x.id === editing.id);
    const id = t ? t.id : "";
    if (barEdit.dataset.for === id) return;  // already showing it: keep what's typed
    barEdit.dataset.for = id;
    barEdit.innerHTML = t ? editorHTML(t) : "";
  }

  // --- Tags tab -----------------------------------------------------------------------
  host.innerHTML = `<div class="tags-tab">
      <div class="tags-head"><b class="tags-for"></b>
        <label class="tags-others"><input type="checkbox" data-show-marks> Show tags on the slices</label>
        <label class="tags-others"><input type="checkbox" data-show-others> Show other maps' tags</label></div>
      <div class="tags-list"></div>
      <div class="tags-foot"><a class="btn small" href="/api/tags.csv" download>Export all as CSV</a>
        <span class="hint" style="margin:0">with the regions at each point</span></div>
      <p class="hint">Tags are saved in your Atlas Lookup data folder (tags.json), not in the results
        folder, and follow each map even if it is moved or renamed.</p>
    </div>`;
  const list = host.querySelector(".tags-list"), others = host.querySelector("[data-show-others]");
  others.checked = showOthers;
  others.addEventListener("change", () => {
    showOthers = others.checked;
    store.set("tagsShowOthers", showOthers);
    renderAll();
  });
  const markBoxes = [bar, host].map((el) => el.querySelector("[data-show-marks]"));
  function setShowMarks(on) {
    showMarks = on;
    store.set("tagsShowMarks", on);
    markBoxes.forEach((b) => { b.checked = on; });
    drawMarks();
  }
  markBoxes.forEach((b) => {
    b.checked = showMarks;
    b.addEventListener("change", () => setShowMarks(b.checked));
  });
  function row(t) {
    if (editing?.where === "tab" && editing.id === t.id)
      return `<div class="tag-row editing${t.mine ? "" : " other"}" data-id="${t.id}">${editorHTML(t)}</div>`;
    return `<div class="tag-row${t.mine ? "" : " other"}" data-id="${t.id}">
      <button type="button" class="tag-go linkish" data-go="${t.id}" title="Go to (${fmt(t.mm)})">${esc(t.label)}</button>
      <span class="tag-mm">${t.mine ? fmt(t.mm) : esc(t.map ? mapName(t.map) : "no map")}</span>
      <span class="tag-acts"><button type="button" class="linkish" data-edit-open="${t.id}" title="Rename, add a note, move">Edit</button>
        <button type="button" class="linkish" data-del="${t.id}" title="Delete">Delete</button></span>
      ${t.note ? `<div class="tag-note">${esc(t.note)}</div>` : ""}
    </div>`;
  }
  function renderTab() {
    host.querySelector(".tags-for").textContent = map ? `Tags of ${mapName(map)}` : "Tags made with no stat map open";
    const m = mine(), o = showOthers ? tags.filter((t) => !t.mine) : [];
    list.innerHTML = (m.length ? m.map(row).join("") : `<div class="hint">No tags yet. Put the crosshair on a point, type a name under the coordinate and press Enter.</div>`)
      + (o.length ? `<div class="tags-sub">Other maps</div>` + o.map(row).join("") : "");
  }
  wireEditor(list);
  list.addEventListener("click", (e) => {
    if (e.target.closest(".tag-edit")) return;  // the editor handles its own buttons
    const go = e.target.closest("[data-go]"), ed = e.target.closest("[data-edit-open]"), del = e.target.closest("[data-del]");
    const t = tags.find((x) => x.id === (go?.dataset.go || ed?.dataset.editOpen || del?.dataset.del));
    if (!t) return;
    if (go) goTo(t.mm);
    else if (ed) openEditor(t, "tab");
    else if (del) remove(t);
  });

  // --- markers on the slices ----------------------------------------------------------
  const marks = document.createElement("div");
  marks.className = "tag-marks lookup-only";
  wrap.append(marks);
  // The tags drawn on the slices now: canvas pixel position, the slice (axCorSag) and label.
  function markList() {
    const nv = getNv();
    if (!showMarks || !nv?.volumes?.length || !nv.screenSlices) return [];
    const at = Array.from(nv.frac2mm(nv.scene.crosshairPos)).slice(0, 3);
    const out = [];
    for (const s of nv.screenSlices) {
      if (!(s.axCorSag in AXIS)) continue;
      const ax = AXIS[s.axCorSag], [l, t, w, h] = s.leftTopWidthHeight;
      for (const tag of shown()) {
        if (Math.abs(tag.mm[ax] - at[ax]) > SLICE_MM) continue;
        const p = nv.frac2canvasPosWithTile(nv.mm2frac(tag.mm), s.axCorSag);
        if (!p) continue;
        const [x, y] = p.pos;
        if (x < l || x > l + w || y < t || y > t + h) continue;
        out.push({ id: tag.id, view: s.axCorSag, x, y, label: tag.label, mine: !!tag.mine });
      }
    }
    return out;
  }
  function drawMarks() {
    const nv = getNv(), list = markList();
    const c = nv?.canvas, scale = c ? c.width / (c.clientWidth || c.width) : 1;
    const html = list.map((m) => `<span class="tag-mark${m.mine ? "" : " other"}" style="left:${m.x / scale}px;top:${m.y / scale}px"><i></i>${esc(m.label)}</span>`).join("");
    if (marks.innerHTML !== html) marks.innerHTML = html;
  }
  const nv = getNv();
  const draw = nv.drawScene.bind(nv);
  nv.drawScene = (...a) => { const r = draw(...a); drawMarks(); return r; };

  function renderAll() {
    renderBar();
    renderBarEditor();
    renderTab();
    drawMarks();
    onChange(mine().length);
  }

  return {
    /** Tags drawn on the slices now (for image captures): {id, view, x, y, label, mine}, canvas px. */
    marks: markList,
    /** The point at the crosshair (after each lookup). */
    setPoint(mm) { point = mm.slice(0, 3).map(Number); renderBar(); syncMove(); },
    /** The active stat map changed (getMap() has the new one). */
    refresh: load,
    redraw: drawMarks,
    /** Turn the markers on the slices on or off (also the "Show on slices" boxes). */
    showMarks: setShowMarks,
  };
}
