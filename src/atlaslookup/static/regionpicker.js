// Regions tab of the side panel, for the 3D view: search every atlas's regions, tick the
// ones to show, and optionally restrict the overlays to inside them. Each chosen region
// gets its own colour. The choice is remembered and applied live as it changes.

const PALETTE = [  // distinct, readable on black and on the glass brain
  [230, 25, 75], [60, 180, 75], [255, 225, 25], [0, 130, 200], [245, 130, 48], [145, 30, 180],
  [70, 240, 240], [240, 50, 230], [210, 245, 60], [250, 190, 212], [0, 128, 128], [220, 190, 255],
  [170, 110, 40], [255, 250, 200], [128, 0, 0], [170, 255, 195], [128, 128, 0], [255, 215, 180],
];
const MAX_SHOWN = 150;  // search results listed at once

// Words people type for regions whose atlas names differ; each maps to phrases that
// count as a match.
const SYNONYMS = {
  orbitofrontal: ["orbital"], ofc: ["orbital"], mofc: ["orbital", "rectus"], hippo: ["hippocamp"],
  amyg: ["amygdala"], acc: ["cingul"], pcc: ["cingul"], mcc: ["cingul"], dlpfc: ["middle frontal"],
  vmpfc: ["frontal medial", "rectus", "subcallosal"], ifg: ["inferior frontal"], mfg: ["middle frontal"],
  sfg: ["superior frontal"], stg: ["superior temporal"], mtg: ["middle temporal"], itg: ["inferior temporal"],
  ips: ["intraparietal", "intra-parietal"], m1: ["precentral", "primary motor"], s1: ["postcentral", "somatosensory"],
  sma: ["supplementary motor", "juxtapositional"], nacc: ["accumbens"], striatum: ["caudate", "putamen", "accumbens"],
  ba: ["brodmann area"],
};

/** Does `name` (plus its atlas name) match every word of the query? Exported for tests. */
export function matches(query, name, atlasName = "") {
  const hay = `${name} ${atlasName}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean)
    .every((w) => hay.includes(w) || (SYNONYMS[w] || []).some((phrase) => hay.includes(phrase)));
}

export function createRegionPicker({ button, store, esc, onChange, panel, host }) {
  let atlases = null;  // [{ atlas, atlas_name, regions: [...] }]
  let chosen = store.get("regions3d", []);       // [{ atlas, atlasName, value, side, name, color }]
  let maskResults = store.get("regions3dMask", false);
  const showHooks = [];  // run when the tab opens (the tract list refreshes then)

  const dlg = host;  // the side panel's Regions section
  dlg.classList.add("regions-panel");
  dlg.innerHTML = `
    <div class="rg-body">
      <div class="rg-find">
        <div class="rg-search">
          <input type="search" placeholder="Search, e.g. hippocampus, orbitofrontal, BA 44" aria-label="Search regions">
          <select aria-label="Atlas"><option value="">All atlases</option></select>
        </div>
        <div class="rg-results" role="listbox" aria-label="Regions"></div>
      </div>
      <div class="rg-chosen">
        <span class="section-title">Showing <span class="rg-count"></span></span>
        <div class="rg-list"></div>
        <label class="rg-opt"><input type="checkbox" data-opt="mask"> Show results only inside these regions</label>
        <button type="button" class="linkish" data-act="clear">Clear all</button>
      </div>
      <div class="rg-tracts"></div>
    </div>
    <p class="hint rg-note">Shown in the 3D tab, in these colours. Deep regions (hippocampus, amygdala, basal ganglia) are clearest with <b>Glass brain</b>; <b>Mesh brain</b> only shows the cortical surface.</p>`;
  const search = dlg.querySelector("input[type=search]"), atlasSel = dlg.querySelector("select");
  const results = dlg.querySelector(".rg-results"), list = dlg.querySelector(".rg-list");
  const maskBox = dlg.querySelector("[data-opt=mask]");

  const keyOf = (r) => `${r.atlas}|${r.value}|${r.side}`;
  const isChosen = (r) => chosen.some((c) => keyOf(c) === keyOf(r));

  function nextColor() {
    const used = new Set(chosen.map((c) => c.color.join()));
    return PALETTE.find((c) => !used.has(c.join())) || PALETTE[chosen.length % PALETTE.length];
  }

  function emit() {
    store.set("regions3d", chosen);
    store.set("regions3dMask", maskResults);
    button.textContent = chosen.length ? `Regions (${chosen.length})` : "Regions…";
    onChange(chosen, { maskResults });
  }

  function renderResults() {
    const q = search.value.trim(), only = atlasSel.value;
    const rows = [];
    let more = 0;
    for (const a of atlases) {
      if (only && a.atlas !== only) continue;
      for (const r of a.regions) {
        if (q && !matches(q, r.name, a.atlas_name)) continue;
        if (rows.length >= MAX_SHOWN) { more++; continue; }
        rows.push({ ...r, atlas: a.atlas, atlasName: a.atlas_name });
      }
    }
    results.innerHTML = rows.length
      ? rows.map((r) => `<label class="rg-row"><input type="checkbox" data-key="${esc(keyOf(r))}" ${isChosen(r) ? "checked" : ""}>
          <span>${esc(r.name)}</span><span class="muted">${esc(r.atlasName)}</span></label>`).join("") +
        (more ? `<div class="hint">${more} more; type more of the name to narrow it down.</div>` : "")
      : `<div class="hint">No regions match.</div>`;
    results._rows = rows;
  }

  function renderChosen() {
    dlg.querySelector(".rg-count").textContent = chosen.length ? `(${chosen.length})` : "";
    list.innerHTML = chosen.length
      ? chosen.map((c, i) => `<div class="rg-chip"><i style="background:rgb(${c.color.join(",")})"></i>
          <span>${esc(c.name)}<br><span class="muted">${esc(c.atlasName)}</span></span>
          <button type="button" class="btn small" data-remove="${i}" aria-label="Remove ${esc(c.name)}">✕</button></div>`).join("")
      : `<div class="hint">Nothing chosen: the 3D view shows the whole brain. Tick regions above.</div>`;
    maskBox.checked = maskResults;
    maskBox.disabled = !chosen.length;
  }

  results.addEventListener("change", (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    const r = results._rows.find((x) => keyOf(x) === key);
    if (e.target.checked && !isChosen(r)) {
      chosen = [...chosen, { atlas: r.atlas, atlasName: r.atlasName, value: r.value, side: r.side, name: r.name, color: nextColor() }];
    } else if (!e.target.checked) {
      chosen = chosen.filter((c) => keyOf(c) !== key);
    }
    renderChosen(); emit();
  });
  list.addEventListener("click", (e) => {
    if (e.target.dataset.remove === undefined) return;
    chosen = chosen.filter((_, i) => i !== +e.target.dataset.remove);
    renderChosen(); renderResults(); emit();
  });
  maskBox.addEventListener("change", () => { maskResults = maskBox.checked; emit(); });
  search.addEventListener("input", renderResults);
  atlasSel.addEventListener("change", renderResults);
  dlg.addEventListener("click", (e) => {
    if (e.target.dataset.act === "clear") { chosen = []; maskResults = false; renderChosen(); renderResults(); emit(); }
  });

  panel.onShow("regions", async () => {
    if (!atlases) {
      atlases = await fetch("/api/regions").then((r) => r.json());
      atlasSel.innerHTML += atlases.map((a) => `<option value="${esc(a.atlas)}">${esc(a.atlas_name)}</option>`).join("");
      // Drop remembered regions whose atlas is no longer installed.
      const have = new Set(atlases.flatMap((a) => a.regions.map((r) => keyOf({ ...r, atlas: a.atlas }))));
      if (chosen.some((c) => !have.has(keyOf(c)))) { chosen = chosen.filter((c) => have.has(keyOf(c))); emit(); }
    }
    renderResults(); renderChosen();
    for (const fn of showHooks) fn();
    search.focus({ preventScroll: true });
  });
  button.addEventListener("click", () => panel.open("regions"));

  button.textContent = chosen.length ? `Regions (${chosen.length})` : "Regions…";
  return { get chosen() { return chosen; }, get maskResults() { return maskResults; },
           tractHost: dlg.querySelector(".rg-tracts"), onShow: (fn) => showHooks.push(fn) };
}
