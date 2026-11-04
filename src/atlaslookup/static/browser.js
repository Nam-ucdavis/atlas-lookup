// Finder-style column browser for the results folder's stat maps.
//
// The maps arrive as paths relative to the results folder ("modelA/sub/spmT_0001.nii");
// any .nii / .nii.gz is listed, and those without an SPM T header are marked as such.
// The browser lives in the side panel's Results tab and shows them as Finder's column
// view: one column per folder level, details of the chosen map below, and a path bar.
// Choosing a map sets the (hidden) <select id="statMap"> and fires its change event, so
// the rest of the page works exactly as before; the panel stays open for browsing on.
//
// The column in focus widens to fit its longest name; the others stay narrow.
//
// Keyboard: up/down move within a column, right opens a folder, left goes back up,
// Enter shows the selected map, Esc closes.
//
// "Change folder…" swaps the columns for a folder chooser that can go anywhere above or
// below the current folder. The server lists folder names only, and the chosen folder
// becomes the results folder (saved in settings.json); maps are still read only there.

/** Folder tree from map ids: { name, path, dirs: Map, files: [map] }. Exported for tests. */
export function buildTree(maps) {
  const root = { name: "", path: "", dirs: new Map(), files: [] };
  for (const m of maps) {
    const parts = m.id.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) {
        node.dirs.set(part, { name: part, path: node.path ? `${node.path}/${part}` : part, dirs: new Map(), files: [] });
      }
      node = node.dirs.get(part);
    }
    node.files.push({ ...m, name: parts[parts.length - 1] });
  }
  return root;
}

/** Entries of one folder: subfolders first, then maps, each alphabetical. */
export function entries(node) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return [...dirs.map((d) => ({ kind: "dir", node: d })), ...files.map((f) => ({ kind: "file", map: f }))];
}

export function createResultsBrowser({ select, esc, panel, host, onFolder }) {
  let maps = [], folder = "", tree = null;
  let trail = [];       // folders open, root first
  let picked = null;    // highlighted map in the last column, if any
  let focusCol = 0;     // keyboard focus column

  // Button that stands in for the <select>.
  select.hidden = true;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn finder-btn";
  button.title = "Browse the results folder";
  select.after(button);

  const dlg = host;  // the side panel's Results section
  dlg.classList.add("finder");
  dlg.innerHTML = `
    <div class="finder-head"><span class="finder-root"></span><span class="grow"></span>
      <button type="button" class="btn small" data-act="folder" title="Choose another results folder">Change folder…</button>
      <button type="button" class="btn small" data-act="none" title="Close every open stat map">Close all</button></div>
    <div class="folder-pick" hidden>
      <div class="fp-bar"><button type="button" class="btn small" data-act="up" title="Parent folder">↑</button>
        <input type="text" class="fp-path" spellcheck="false" aria-label="Folder path" title="Type a path and press Enter"></div>
      <div class="fp-list" role="listbox" aria-label="Subfolders"></div>
      <div class="fp-foot"><span class="fp-note muted"></span><span class="grow"></span>
        <button type="button" class="btn small" data-act="cancel">Cancel</button>
        <button type="button" class="btn small primary" data-act="use">Use this folder</button></div>
    </div>
    <div class="finder-body"><div class="finder-cols" tabindex="0" aria-label="Results folder"></div><div class="finder-preview"></div></div>
    <div class="finder-path"></div>`;
  const cols = dlg.querySelector(".finder-cols"), preview = dlg.querySelector(".finder-preview");
  const pick = dlg.querySelector(".folder-pick"), fpPath = pick.querySelector(".fp-path");
  const fpList = pick.querySelector(".fp-list"), fpNote = pick.querySelector(".fp-note");
  let pickAt = null;  // the folder the chooser shows: { path, parent, dirs, maps_here }

  const current = () => maps.find((m) => m.id === select.value) || null;

  // The button opens the browser; the open maps are listed under the viewer.
  function label() {
    button.innerHTML = `<span class="finder-ico">▦</span> Open map…`;
    button.title = "Load a stat map from your results folder";
  }

  // The tree's file entries carry the display name; look maps up there.
  const fileOf = (id) => id && nodeAt(id.split("/").slice(0, -1).join("/"))?.files.find((f) => f.id === id);

  function nodeAt(path) {
    let node = tree;
    for (const part of path ? path.split("/") : []) node = node.dirs.get(part);
    return node;
  }

  function revealCurrent() {
    const m = current();
    trail = [tree];
    picked = null;
    if (m) {
      const parts = m.id.split("/").slice(0, -1);
      for (let i = 1; i <= parts.length; i++) trail.push(nodeAt(parts.slice(0, i).join("/")));
      picked = fileOf(m.id);
    } else {
      // Open single-child folders straight away, like a fresh Finder window would show.
      while (trail.at(-1).dirs.size === 1 && !trail.at(-1).files.length) trail.push([...trail.at(-1).dirs.values()][0]);
    }
    focusCol = trail.length - 1;
  }

  function render() {
    cols.innerHTML = trail.map((node, c) => {
      const next = trail[c + 1];
      return `<div class="finder-col${c === focusCol ? " focus" : ""}" data-col="${c}" role="listbox">` +
        entries(node).map((e) => {
          if (e.kind === "dir") {
            const on = next && next.path === e.node.path;
            return `<div class="finder-item dir${on ? " sel" : ""}" role="option" data-dir="${esc(e.node.path)}">
              <span class="finder-ico">▸</span><span class="finder-name">${esc(e.node.name)}</span><span class="chev">›</span></div>`;
          }
          const on = c === trail.length - 1 && picked?.id === e.map.id;
          return `<div class="finder-item file${on ? " sel" : ""}${e.map.id === select.value ? " current" : ""}" role="option" data-file="${esc(e.map.id)}">
            <span class="finder-ico">◼</span><span class="finder-name">${esc(e.map.name)}</span></div>`;
        }).join("") + `</div>`;
    }).join("");
    preview.innerHTML = picked ? `
      <div class="finder-doc">◼</div>
      <div class="finder-title">${esc(picked.name)}</div>
      <dl><dt>Contrast</dt><dd>${esc(picked.contrast)}</dd>
        <dt>df</dt><dd>${picked.df ?? "– (not an SPM T map: no p values; T ≥ applies to its values)"}</dd>
        <dt>Grid</dt><dd>${picked.shape.join(" × ")} · ${picked.voxel_size.map((v) => +v.toFixed(2)).join(" × ")} mm</dd>
        <dt>Folder</dt><dd class="wrap">${esc(picked.id.split("/").slice(0, -1).join(" / ") || "(top level)")}</dd></dl>
      <button type="button" class="btn primary" data-act="show">${picked.id === select.value ? "Showing" : "Show"}</button>`
      : `<div class="finder-empty">Choose a map to see its details</div>`;
    const path = [folder.split("/").pop() || "results", ...trail.slice(1).map((n) => n.name), ...(picked ? [picked.name] : [])];
    dlg.querySelector(".finder-path").innerHTML = path.map((p, i) =>
      `<button type="button" class="linkish" data-crumb="${i}">${esc(p)}</button>`).join(`<span class="muted"> › </span>`);
    cols.lastElementChild?.scrollIntoView({ inline: "end", block: "nearest" });
    cols.querySelector(".finder-col.focus")?.scrollIntoView({ inline: "nearest", block: "nearest" });  // it may have widened
    dlg.querySelector(".finder-col.focus .sel")?.scrollIntoView({ block: "nearest" });
  }

  // Selecting a folder shows its contents in the next column; focus stays put (as in Finder).
  function openDir(path, col) {
    trail = [...trail.slice(0, col + 1), nodeAt(path)];
    picked = null;
    focusCol = col;
    render();
  }
  function pickFile(id, col) {
    trail = trail.slice(0, col + 1);
    picked = fileOf(id);
    focusCol = col;
    render();
  }
  function choose(id) {
    select.value = id;
    select.dispatchEvent(new Event("change"));
    label();
    render();  // "Showing" and the ● marker follow the choice
  }

  // --- folder chooser -------------------------------------------------------------
  function showPicker(on) {
    pick.hidden = !on;
    dlg.querySelector(".finder-body").hidden = on;
    dlg.querySelector(".finder-path").hidden = on;
    if (on) browseFolder(folder || null);
    else if (tree) render();
  }
  async function browseFolder(path) {
    const r = await fetch("/api/folders?" + new URLSearchParams(path ? { path } : {})).catch(() => null);
    if (!r?.ok) { fpNote.textContent = "Can't open that folder"; return; }
    pickAt = await r.json();
    fpPath.value = pickAt.path;
    pick.querySelector('[data-act="up"]').disabled = !pickAt.parent;
    fpList.innerHTML = pickAt.dirs.map((n) => `<div class="finder-item dir" role="option" data-sub="${esc(n)}">
        <span class="finder-ico">▸</span><span class="finder-name">${esc(n)}</span><span class="chev">›</span></div>`).join("")
      || `<div class="finder-empty">No subfolders</div>`;
    fpNote.textContent = pickAt.maps_here ? `${pickAt.maps_here} NIfTI map${pickAt.maps_here > 1 ? "s" : ""} here` : "";
  }
  // Join with the separator the server's path uses (a backslash on Windows).
  const join = (dir, name) => {
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    return dir.endsWith(sep) ? dir + name : dir + sep + name;
  };
  async function useFolder() {
    if (!pickAt) return;
    fpNote.textContent = "Looking for maps…";
    const r = await fetch("/api/results/folder", { method: "POST", headers: { "Content-Type": "application/json" },
                                                   body: JSON.stringify({ path: pickAt.path }) }).catch(() => null);
    if (!r?.ok) { fpNote.textContent = "Could not use that folder"; return; }
    const d = await r.json();
    pick.hidden = true;
    dlg.querySelector(".finder-body").hidden = dlg.querySelector(".finder-path").hidden = false;
    await onFolder?.(d);
  }
  fpList.addEventListener("click", (e) => {
    const item = e.target.closest("[data-sub]");
    if (item && pickAt) browseFolder(join(pickAt.path, item.dataset.sub));
  });
  fpPath.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); browseFolder(fpPath.value.trim()); }
  });
  pick.addEventListener("click", (e) => {
    const act = e.target.dataset.act;
    if (act === "up" && pickAt?.parent) browseFolder(pickAt.parent);
    else if (act === "cancel") showPicker(false);
    else if (act === "use") useFolder();
  });

  cols.addEventListener("click", (e) => {
    const item = e.target.closest(".finder-item"), col = +e.target.closest(".finder-col")?.dataset.col;
    if (!item) return;
    item.dataset.dir ? openDir(item.dataset.dir, col) : pickFile(item.dataset.file, col);
  });
  cols.addEventListener("dblclick", (e) => {
    const item = e.target.closest(".finder-item.file");
    if (item) choose(item.dataset.file);
  });
  dlg.addEventListener("click", (e) => {
    const act = e.target.dataset.act;
    if (act === "none") choose("");
    else if (act === "folder") showPicker(pick.hidden);
    else if (act === "show" && picked) choose(picked.id);
    else if (e.target.dataset.crumb !== undefined) {
      const i = +e.target.dataset.crumb;
      trail = trail.slice(0, Math.max(1, i + 1)); picked = null; focusCol = trail.length - 1; render();
    }
  });
  cols.addEventListener("keydown", (e) => {
    const list = entries(trail[focusCol]);
    const selectAt = (i) => {
      const x = list[Math.max(0, Math.min(list.length - 1, i))];
      if (x) x.kind === "dir" ? openDir(x.node.path, focusCol) : pickFile(x.map.id, focusCol);
    };
    const sel = list.findIndex((x) => (x.kind === "dir"
      ? x.node.path === trail[focusCol + 1]?.path
      : focusCol === trail.length - 1 && x.map.id === picked?.id));
    if (e.key === "ArrowDown") selectAt(sel + 1);
    else if (e.key === "ArrowUp") selectAt(sel < 0 ? 0 : sel - 1);
    else if (e.key === "ArrowRight" && trail[focusCol + 1]) {
      focusCol += 1;
      const first = entries(trail[focusCol])[0];
      if (first) first.kind === "dir" ? openDir(first.node.path, focusCol) : pickFile(first.map.id, focusCol);
    } else if (e.key === "ArrowLeft" && focusCol > 0) {
      focusCol -= 1; picked = null; trail = trail.slice(0, focusCol + 2); render();
    } else if (e.key === "Enter" && picked) choose(picked.id);
    else return;
    e.preventDefault();
  });

  panel.onShow("results", () => {
    if (!tree) {
      dlg.querySelector(".finder-cols").innerHTML = `<div class="finder-empty">No .nii maps here.<br>Use <b>Change folder…</b> to choose your results folder.</div>`;
      return;
    }
    revealCurrent();
    render();
    cols.focus({ preventScroll: true });
  });
  button.addEventListener("click", () => panel.open("results"));
  label();

  return {
    setMaps(list, root) {
      maps = list; folder = root || ""; tree = buildTree(list);
      dlg.querySelector(".finder-root").textContent = folder;
      label();
      if (panel.isOpen && panel.tab === "results") { revealCurrent(); render(); }
    },
    refresh: label,
  };
}
