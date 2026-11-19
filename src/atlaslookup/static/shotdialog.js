// Save image: the camera button opens this dialog instead of saving straight away.
//
//  - Views: which of the axial, coronal and sagittal slices go in the image (side by side,
//    in that order). In the 3D tab the image is the 3D render, so there is no choice.
//  - Background: black, white or transparent (the black around the brain is replaced;
//    text and colour-bar labels turn black on white or transparent).
//  - Name: a suggested name from the stat map, the point and the views; type your own.
//  - Folder: the last one used (first time: the app's image folder). Type a path or
//    browse; the results folder is refused, as it stays read-only.
// A preview shows the image as it will be saved. An existing file is never replaced
// without asking. Choices are remembered between saves.

const VIEWS = [{ v: 0, name: "Axial" }, { v: 1, name: "Coronal" }, { v: 2, name: "Sagittal" }];
const BGS = [["black", "Black"], ["white", "White"], ["transparent", "Transparent"]];

export function createShotDialog({ button, capture, is3D, suggestName, store, esc, setHint }) {
  const dlg = document.createElement("dialog");
  dlg.id = "shotDlg";
  dlg.setAttribute("aria-labelledby", "shotTitle");
  dlg.innerHTML = `<form method="dialog" class="shot" autocomplete="off">
      <div class="shot-head"><h2 id="shotTitle">Save image</h2><span class="grow"></span>
        <button type="button" class="btn small" data-act="close" aria-label="Close">✕</button></div>
      <div class="shot-body">
        <div class="shot-preview"><img alt="Preview of the image to be saved"><span class="shot-size muted"></span></div>
        <div class="shot-form">
          <fieldset class="shot-views"><legend>Views</legend>
            ${VIEWS.map(({ v, name }) => `<label><input type="checkbox" value="${v}"> ${name}</label>`).join("")}
            <span class="shot-3d muted" hidden>The 3D view, as shown</span>
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
  const boxes = [...dlg.querySelectorAll(".shot-views input")];
  form.elements.reveal.checked = store.get("shotReveal", true);

  let views = store.get("shotViews", [0, 1, 2]), background = store.get("shotBg", "black");
  let defaultFolder = "", named = false, url = null, blob = null, pickAt = null, busy = false;

  const opts = () => ({ views: [...views], background });
  const say = (html, bad = false) => { msg.innerHTML = html; msg.classList.toggle("bad", bad); };

  function syncControls() {
    const three = is3D();
    boxes.forEach((b) => { b.checked = views.includes(+b.value); b.parentElement.hidden = three; });
    dlg.querySelector(".shot-3d").hidden = !three;
    dlg.querySelectorAll("[data-bg]").forEach((b) => b.classList.toggle("on", b.dataset.bg === background));
    img.parentElement.classList.toggle("checker", background === "transparent");
  }
  function suggested() {
    return suggestName(is3D() ? "3D" : views.length === 3 ? "" : VIEWS.filter((x) => views.includes(x.v)).map((x) => x.name.toLowerCase()).join("-"));
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
      store.set("shotBg", background);
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
    if (bg) {
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
  dlg.querySelector(".shot-views").addEventListener("change", () => {
    views = boxes.filter((b) => b.checked).map((b) => +b.value);
    if (!named) nameIn.value = suggested();
    preview();
  });
  nameIn.addEventListener("input", () => { named = true; });
  folderIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !pick.hidden) { e.preventDefault(); browse(folderIn.value.trim()); }
  });

  return { open };
}
