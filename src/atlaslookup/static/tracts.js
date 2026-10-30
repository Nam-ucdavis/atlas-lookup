// "Connecting tracts" in the Regions tab: white-matter tracts (JHU or XTRACT) whose core
// passes near the chosen regions, with the regions each one links. Tick a tract to draw
// it in the 3D view. With no regions chosen, every tract of the atlas is listed.
//
// The section folds down to its header, docked at the bottom of the tab (remembered);
// folded, it shows how many tracts are drawn and skips looking up connections.
//
// Atlas-based proximity, not tractography of your data: a tract counts as touching a
// region when its core (>= threshold % of subjects) comes within the distance of it.

const PALETTE = [  // softer than the region colours, so tracts and regions read apart
  [255, 179, 102], [128, 210, 255], [190, 160, 255], [140, 230, 160], [255, 150, 190],
  [240, 220, 120], [120, 220, 210], [230, 140, 120], [170, 200, 120], [200, 170, 220],
];

export function createTractPanel({ host, store, esc, onChange }) {
  let atlases = null;  // from /api/tracts
  let regions = [];    // chosen regions, as the region picker has them
  let settings = { atlas: "xtract-hcp", threshold: null, distance: 3, ...store.get("tractSettings", {}) };
  let shown = store.get("tracts3d", []);  // [{ atlas, value, name, color, threshold }]
  let token = 0;
  let collapsed = store.get("tractsCollapsed", false);

  host.classList.add("tr-panel");
  host.innerHTML = `
    <button type="button" class="tr-toggle" aria-expanded="true" title="Show or hide the tract list">
      <span class="tr-chev" aria-hidden="true">▾</span><span class="section-title">Connecting tracts</span>
      <span class="tr-count"></span></button>
    <div class="tr-opts">
      <select data-k="atlas" aria-label="Tract atlas"></select>
      <label title="A tract's core: voxels where at least this % of subjects had the tract">core ≥ <input type="number" data-k="threshold" min="1" max="100" step="1">%</label>
      <label title="How close the core must come to a region to count as touching it">within <input type="number" data-k="distance" min="0" max="15" step="1"> mm</label>
    </div>
    <div class="tr-list"></div>
    <p class="hint tr-note"></p>`;
  const list = host.querySelector(".tr-list"), note = host.querySelector(".tr-note");
  const input = (k) => host.querySelector(`[data-k=${k}]`);

  const atlasInfo = () => atlases?.find((a) => a.atlas === settings.atlas);
  const threshold = () => settings.threshold ?? atlasInfo()?.threshold ?? 25;
  const keyOf = (t) => `${t.atlas}|${t.value}`;
  const isShown = (t) => shown.some((s) => keyOf(s) === keyOf(t));

  function emit() {
    store.set("tracts3d", shown);
    onChange(shown);
    showCollapsed();
  }
  function showCollapsed() {
    host.classList.toggle("collapsed", collapsed);
    const toggle = host.querySelector(".tr-toggle");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    host.querySelector(".tr-chev").textContent = collapsed ? "▸" : "▾";
    host.querySelector(".tr-count").textContent = collapsed && shown.length ? `${shown.length} shown in 3D` : "";
  }
  host.querySelector(".tr-toggle").addEventListener("click", () => {
    collapsed = !collapsed;
    store.set("tractsCollapsed", collapsed);
    showCollapsed();
    if (!collapsed) render();
  });
  showCollapsed();
  function nextColor() {
    const used = new Set(shown.map((s) => s.color.join()));
    return PALETTE.find((c) => !used.has(c.join())) || PALETTE[shown.length % PALETTE.length];
  }

  async function load() {
    if (atlases) return;
    atlases = await fetch("/api/tracts").then((r) => r.json()).catch(() => []);
    if (!atlases.length) {
      host.querySelector(".tr-opts").hidden = true;
      list.innerHTML = `<div class="hint">No tract atlases installed. Run <code>atlaslookup setup</code> to add JHU and XTRACT.</div>`;
      return;
    }
    if (!atlasInfo()) settings.atlas = atlases[0].atlas;
    input("atlas").innerHTML = atlases.map((a) => `<option value="${esc(a.atlas)}">${esc(a.atlas_name)}</option>`).join("");
    shown = shown.filter((s) => atlases.some((a) => a.atlas === s.atlas));
    emit();
  }

  async function render() {
    await load();
    if (collapsed) return;  // refreshed when unfolded
    if (!atlases.length) return;
    input("atlas").value = settings.atlas;
    input("threshold").value = threshold();
    input("distance").value = settings.distance;
    const mine = ++token;
    const row = (t, detail) => `<label class="tr-row"><input type="checkbox" data-value="${t.value}" ${isShown({ atlas: settings.atlas, value: t.value }) ? "checked" : ""}>
        <i style="background:${swatch(t)}"></i><span>${esc(t.name)}${detail ? `<br><span class="muted">${detail}</span>` : ""}</span></label>`;
    if (!regions.length) {
      list.innerHTML = atlasInfo().tracts.map((t) => row(t, "")).join("");
      note.textContent = "Choose regions above to see which tracts pass near them. Tick a tract to draw it in 3D.";
      return;
    }
    list.innerHTML = `<div class="hint">Finding tracts…</div>`;
    const p = new URLSearchParams({
      atlas: settings.atlas, threshold: threshold(), distance: settings.distance,
      sel: regions.map((r) => `${r.atlas}|${r.value}|${r.side}`).join(","),
    });
    const r = await fetch("/api/tracts/connections?" + p);
    const d = await r.json();
    if (mine !== token) return;  // settings changed meanwhile
    if (!r.ok) { list.innerHTML = `<div class="hint err">${esc(d.detail)}</div>`; return; }
    const names = d.regions;
    const linking = d.tracts.filter((t) => t.links.length), near = d.tracts.filter((t) => !t.links.length);
    const linkText = (t) => "links " + t.links.map(([a, b]) => `${esc(names[a])} ↔ ${esc(names[b])}`).join(" · ");
    const nearText = (t) => t.touches.map((k) => `${esc(names[k])} (${t.contacts[k]} mm³)`).join(", ");
    list.innerHTML =
      (regions.length > 1 ? `<div class="tr-group">Linking chosen regions</div>` +
        (linking.length ? linking.map((t) => row(t, linkText(t))).join("") : `<div class="hint">None at these settings.</div>`) : "") +
      `<div class="tr-group">${regions.length > 1 ? "Near one region" : `Near ${esc(names[0])}`}</div>` +
      (near.length ? near.map((t) => row(t, regions.length > 1 ? nearText(t) : `${t.contacts[0]} mm³ of core within ${d.distance_mm} mm`)).join("")
        : `<div class="hint">None at these settings.</div>`);
    note.textContent = `Atlas-based: a tract counts when its core (≥ ${d.threshold}% of subjects) comes within ` +
      `${d.distance_mm} mm of a region; mm³ is how much of it does. Population tracts often stop short of ` +
      `the cortex, and nearby bundles can show up too. Not tractography of your data.`;
  }
  const swatch = (t) => {
    const s = shown.find((x) => keyOf(x) === keyOf({ atlas: settings.atlas, value: t.value }));
    return s ? `rgb(${s.color.join(",")})` : "transparent";
  };

  list.addEventListener("change", (e) => {
    const value = +e.target.dataset.value;
    if (!value) return;
    const t = atlasInfo().tracts.find((x) => x.value === value);
    if (e.target.checked) shown = [...shown, { atlas: settings.atlas, value, name: t.name, color: nextColor(), threshold: threshold() }];
    else shown = shown.filter((s) => keyOf(s) !== keyOf({ atlas: settings.atlas, value }));
    e.target.nextElementSibling.style.background = swatch(t);
    emit();
  });
  host.querySelector(".tr-opts").addEventListener("change", (e) => {
    const k = e.target.dataset.k;
    if (k === "atlas") { settings.atlas = e.target.value; settings.threshold = null; }
    else if (k === "threshold" && +e.target.value > 0) settings.threshold = Math.min(100, +e.target.value);
    else if (k === "distance" && e.target.value !== "") settings.distance = Math.max(0, Math.min(15, +e.target.value));
    else return;
    store.set("tractSettings", settings);
    if (k === "threshold") {  // this atlas's shown tracts are redrawn at the new threshold
      shown = shown.map((s) => (s.atlas === settings.atlas ? { ...s, threshold: threshold() } : s));
      emit();
    }
    render();
  });

  return {
    setRegions(list) { regions = list; if (host.isConnected && !host.closest("[hidden]")) render(); },
    render,
    get shown() { return shown; },
  };
}
