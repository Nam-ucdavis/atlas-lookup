// Save image: the camera button opens this dialog instead of saving straight away.
//
//  - Views: which of the axial, coronal and sagittal slices go in the image, in the order
//    shown (drag a view, or Alt+arrow on its checkbox, to move it).
//  - Layout: the views in a row, in a column, or in a grid of two per row.
//    In the 3D tab the image is the 3D render, so there is no choice of views or layout.
//  - Include: the tags shown on the slices (dot and name), and the colour bars.
//  - Background: black, white or transparent (the black around the brain is replaced;
//    text and colour-bar labels turn black on white or transparent).
//  - Name: a suggested name from the stat map, the point and the views; type your own.
//  - Folder: the last one used (first time: the app's image folder). Type a path or
//    browse; the results folder is refused, as it stays read-only.
// A preview shows the image as it will be saved. An existing file is never replaced
// without asking. Choices are remembered between saves.

const VIEWS = [{ v: 0, name: "Axial" }, { v: 1, name: "Coronal" }, { v: 2, name: "Sagittal" }];
const BGS = [["black", "Black"], ["white", "White"], ["transparent", "Transparent"]];
const LAYOUTS = [["row", "In a row"], ["column", "In a column"], ["grid", "Grid"]];

export function createShotDialog({ button, capture, is3D, tagMarks = () => [], suggestName, store, esc, setHint }) {
  const dlg = document.createElement("dialog");
  dlg.id = "shotDlg";
  dlg.setAttribute("aria-labelledby", "shotTitle");
  dlg.innerHTML = `<form method="dialog" class="shot" autocomplete="off">
      <div class="shot-head"><h2 id="shotTitle">Save image</h2><span class="grow"></span>
        <button type="button" class="btn small" data-act="close" aria-label="Close">✕</button></div>
      <div class="shot-body">
        <div class="shot-preview"><img alt="Preview of the image to be saved"><span class="shot-size muted"></span></div>
        <div class="shot-form">
          <fieldset class="shot-views"><legend>Views <span class="shot-hint">drag to reorder</span></legend>
            <span class="shot-order"></span>
            <span class="shot-3d muted" hidden>The 3D view, as shown</span>
          </fieldset>
          <fieldset class="shot-layout"><legend>Layout</legend>
            <div class="seg" role="group" aria-label="Layout">
              ${LAYOUTS.map(([k, label]) => `<button type="button" data-layout="${k}">${label}</button>`).join("")}</div>
          </fieldset>
          <fieldset class="shot-incl"><legend>Include</legend>
            <label class="shot-tags"><input type="checkbox" name="tags"> Tags <span class="shot-tagn muted"></span></label>
            <label><input type="checkbox" name="bars"> Colour bars</label>
          </fieldset>
          <fieldset><legend>Background</legend>
            <div class="seg shot-bg" role="group" aria-label="Background">
              ${BGS.map(([k, label]) => `<button type="button" data-bg="${k}">${label}</button>`).join("")}</div>
          </fieldset>
          <label class="shot-field"><span>Name</span>
            <span class="shot-name"><input type="text" name="name" maxlength="120" spellcheck="false" required><i>.png</i></span>
            <button type="button" class="linkish" data-act="suggest" title="Use the suggested name">Suggested name</button></label>
          <div class="shot-field"><span>Folder</span>
            <span class="shot-folder"><input type="text" name="folder" spellcheck="false" aria-label="Folder">
              <button type="button" class="btn small" data-act="browse">Browse…</button></span>
            <button type="button" class="linkish" data-act="default" title="The app's image folder">Default folder</button>
            <div class="shot-pick" hidden>
              <div class="fp-bar"><button type="button" class="btn small" data-act="up" title="Parent folder">↑</button>
                <span class="shot-at muted"></span></div>
              <div class="fp-list" role="listbox" aria-label="Subfolders"></div>
            </div>
          </div>
          <label class="shot-check"><input type="checkbox" name="reveal"> Show in Finder after saving</label>
        </div>
      </div>
      <div class="shot-foot"><span class="shot-msg"></span><span class="grow"></span>
        <button type="button" class="btn small" data-act="close">Cancel</button>
        <button type="submit" class="btn small primary" data-act="save">Save</button></div>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector("form"), img = dlg.querySelector("img"), size = dlg.querySelector(".shot-size");
  const nameIn = form.elements.name, folderIn = form.elements.folder, msg = dlg.querySelector(".shot-msg");
  const pick = dlg.querySelector(".shot-pick"), list = pick.querySelector(".fp-list"), at = pick.querySelector(".shot-at");
  const orderBox = dlg.querySelector(".shot-order");
  form.elements.reveal.checked = store.get("shotReveal", true);

  form.elements.tags.checked = store.get("shotTags", true);
  form.elements.bars.checked = store.get("shotBars", true);
  let views = store.get("shotViews", [0, 1, 2]), background = store.get("shotBg", "black");
  // order: all three views, in the order they are drawn; views: the ticked ones.
  let order = store.get("shotOrder", [0, 1, 2]), layout = store.get("shotLayout", "row");
  if (order.length !== 3 || [0, 1, 2].some((v) => !order.includes(v))) order = [0, 1, 2];
  const chosen = () => order.filter((v) => views.includes(v));
  let defaultFolder = "", named = false, url = null, blob = null, pickAt = null, busy = false;

  const opts = () => ({ views: chosen(), layout, background, tags: form.elements.tags.checked, bars: form.elements.bars.checked });
  const say = (html, bad = false) => { msg.innerHTML = html; msg.classList.toggle("bad", bad); };

  function syncControls() {
    const three = is3D();
    renderOrder();
    orderBox.hidden = three;
    dlg.querySelector(".shot-hint").hidden = three;
    dlg.querySelector(".shot-layout").hidden = three;
    dlg.querySelectorAll("[data-layout]").forEach((b) => b.classList.toggle("on", b.dataset.layout === layout));
    dlg.querySelector(".shot-3d").hidden = !three;
    // Tags: slices only; the count is of tags on the slices as they are now.
    const n = three ? 0 : new Set(tagMarks().filter((m) => views.includes(m.view)).map((m) => m.id)).size;
    dlg.querySelector(".shot-tags").hidden = three;
    form.elements.tags.disabled = !n;
    dlg.querySelector(".shot-tagn").textContent = n ? `(${n} tag${n > 1 ? "s" : ""} on these slices)` : "(none on these slices)";
    dlg.querySelectorAll("[data-bg]").forEach((b) => b.classList.toggle("on", b.dataset.bg === background));
    img.parentElement.classList.toggle("checker", background === "transparent");
  }
  function suggested() {
    const c = chosen(), same = c.join() === "0,1,2" && layout === "row";
    const names = c.map((v) => VIEWS[v].name.toLowerCase()).join("-");
    return suggestName(is3D() ? "3D" : same ? "" : names + (layout === "row" ? "" : "_" + layout));
  }
  // The view chips, in order: a checkbox each, draggable.
  function renderOrder() {
    orderBox.innerHTML = order.map((v) => `<label class="shot-chip" draggable="true" data-v="${v}"
        title="Drag to move; or Alt+←/→ on the checkbox"><span class="grip" aria-hidden="true">⋮⋮</span>
        <input type="checkbox" value="${v}"${views.includes(v) ? " checked" : ""}> ${VIEWS[v].name}</label>`).join("");
  }
  function reordered(next, focusV) {
    order = next;
    if (!named) nameIn.value = suggested();
    renderOrder();
    if (focusV != null) orderBox.querySelector(`input[value="${focusV}"]`)?.focus();
    preview();
  }
  async function preview() {
    const mine = (preview.n = (preview.n || 0) + 1);
    if (!is3D() && !views.length) {
      blob = null; img.removeAttribute("src"); size.textContent = "";
      say("Tick at least one view.", true);
      return;
    }
    let b = null;
    try { b = await capture(opts()); } catch (e) { console.error(e); }
    if (mine !== preview.n) return;  // a newer preview is on its way
    if (!b) say("Could not capture the view.", true);
    blob = b;
    if (url) URL.revokeObjectURL(url);
    url = b ? URL.createObjectURL(b) : null;
    if (url) img.src = url; else { img.removeAttribute("src"); size.textContent = ""; }
    if (b) say("");
  }
  img.addEventListener("load", () => { size.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`; });

  async function open() {
    if (!defaultFolder) {
      const d = await fetch("/api/screenshot/folder").then((r) => r.json()).catch(() => ({}));
      defaultFolder = d.default || "";
    }
    folderIn.value = store.get("shotFolder", "") || defaultFolder;
    named = false;
    nameIn.value = suggested();
    pick.hidden = true;
    syncControls();
    say("");
    dlg.showModal();
    nameIn.focus();
    nameIn.select();
    await preview();
  }

  // --- folder browser (the same /api/folders the results-folder chooser uses) --------
  async function browse(path) {
    const r = await fetch("/api/folders?" + new URLSearchParams(path ? { path } : {})).catch(() => null);
    if (!r?.ok) { say("Can't open that folder.", true); return; }
    pickAt = await r.json();
    folderIn.value = pickAt.path;
    at.textContent = pickAt.path;
    pick.querySelector('[data-act="up"]').disabled = !pickAt.parent;
    list.innerHTML = pickAt.dirs.map((n) => `<div class="finder-item dir" role="option" data-sub="${esc(n)}">
        <span class="finder-ico">▸</span><span class="finder-name">${esc(n)}</span><span class="chev">›</span></div>`).join("")
      || `<div class="finder-empty">No subfolders</div>`;
    say("");
  }
  const join = (dir, name) => {
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    return dir.endsWith(sep) ? dir + name : dir + sep + name;
  };
  list.addEventListener("click", (e) => {
    const item = e.target.closest("[data-sub]");
    if (item && pickAt) browse(join(pickAt.path, item.dataset.sub));
  });

  // --- saving -------------------------------------------------------------------------
  async function save(overwrite = false) {
    if (busy) return;
    const name = nameIn.value.trim().replace(/\.png$/i, ""), folder = folderIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    if (!folder) { folderIn.focus(); return; }
    if (!blob) await preview();
    if (!blob) return;
    busy = true;
    say("Saving…");
    try {
      const q = new URLSearchParams({ name, folder, overwrite: String(overwrite), show: String(form.elements.reveal.checked) });
      const r = await fetch("/api/screenshot?" + q, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) {
        say(`<b>${esc(name)}.png</b> already exists here. <button type="button" class="linkish" data-act="replace">Replace it</button>`, true);
        return;
      }
      if (!r.ok) { say(esc(d.detail || `Not saved (${r.status})`), true); return; }
      store.set("shotFolder", d.folder);
      store.set("shotViews", views);
      store.set("shotOrder", order);
      store.set("shotLayout", layout);
      store.set("shotBg", background);
      store.set("shotTags", form.elements.tags.checked);
      store.set("shotBars", form.elements.bars.checked);
      store.set("shotReveal", form.elements.reveal.checked);
      dlg.close();
      setHint(`Saved ${d.file} in ${d.folder}`);
    } catch (e) {
      say(esc(`Not saved: ${e.message}`), true);
    } finally {
      busy = false;
    }
  }

  // --- events -------------------------------------------------------------------------
  button.addEventListener("click", open);
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  dlg.addEventListener("close", () => {
    if (url) URL.revokeObjectURL(url);
    url = blob = null;
    img.removeAttribute("src");
  });
  dlg.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act, bg = e.target.closest("[data-bg]")?.dataset.bg;
    const lay = e.target.closest("[data-layout]")?.dataset.layout;
    if (lay) {
      layout = lay;
      syncControls();
      if (!named) nameIn.value = suggested();
      preview();
    } else if (bg) {
      background = bg;
      syncControls();
      preview();
    } else if (act === "close") dlg.close();
    else if (act === "suggest") { named = false; nameIn.value = suggested(); nameIn.focus(); }
    else if (act === "default") { folderIn.value = defaultFolder; pick.hidden = true; }
    else if (act === "browse") { pick.hidden = !pick.hidden; if (!pick.hidden) browse(folderIn.value.trim() || defaultFolder); }
    else if (act === "up" && pickAt?.parent) browse(pickAt.parent);
    else if (act === "replace") save(true);
  });
  // Alt+←/→ (or ↑/↓) on a view's checkbox moves it.
  orderBox.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    const v = +e.target.value;
    if (!e.altKey || !step || e.target.type !== "checkbox") return;
    e.preventDefault();
    const i = order.indexOf(v), j = i + step;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    reordered(next, v);
  });
  // Drag a chip onto another to put it there.
  let dragV = null;
  orderBox.addEventListener("dragstart", (e) => {
    const chip = e.target.closest(".shot-chip");
    if (!chip) return;
    dragV = +chip.dataset.v;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", chip.dataset.v);
    chip.classList.add("dragging");
  });
  orderBox.addEventListener("dragover", (e) => {
    if (dragV == null) return;
    e.preventDefault();
    const chip = e.target.closest(".shot-chip");
    orderBox.querySelectorAll(".shot-chip").forEach((c) => c.classList.toggle("over", c === chip && +c.dataset.v !== dragV));
  });
  orderBox.addEventListener("drop", (e) => {
    e.preventDefault();
    const chip = e.target.closest(".shot-chip");
    if (dragV == null || !chip || +chip.dataset.v === dragV) return;
    const next = order.filter((v) => v !== dragV);
    const to = order.indexOf(+chip.dataset.v), from = order.indexOf(dragV);
    // Dropped on a later chip: after it; on an earlier one: before it.
    next.splice(next.indexOf(+chip.dataset.v) + (to > from ? 1 : 0), 0, dragV);
    reordered(next);
  });
  orderBox.addEventListener("dragend", () => {
    dragV = null;
    orderBox.querySelectorAll(".shot-chip").forEach((c) => c.classList.remove("dragging", "over"));
  });
  dlg.querySelector(".shot-views").addEventListener("change", () => {
    views = [...orderBox.querySelectorAll("input")].filter((b) => b.checked).map((b) => +b.value);
    syncControls();
    if (!named) nameIn.value = suggested();
    preview();
  });
  form.elements.tags.addEventListener("change", preview);
  form.elements.bars.addEventListener("change", preview);
  nameIn.addEventListener("input", () => { named = true; });
  folderIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !pick.hidden) { e.preventDefault(); browse(folderIn.value.trim()); }
  });

  return { open };
}
