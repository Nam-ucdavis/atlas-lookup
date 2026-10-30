// Side panel docked on the right, like a code/context pane: the page narrows to make
// room instead of being covered. Tabs (Results, Regions) share it. Drag its left edge
// to resize; collapse it to a slim rail of tab buttons on the right edge (Esc, or the
// » button), and click a rail button to bring it back on that tab. Open state, tab and
// width are remembered.

const MIN_W = 300;
const NARROW_PAGE = 900;  // page width (beside the panel) below which it goes to one column
const maxW = () => Math.max(MIN_W, Math.min(900, Math.round(window.innerWidth * 0.6)));

export function createSidePanel({ store, tabs, onLayout = () => {} }) {
  const saved = store.get("sidePanel", {});
  let width = Math.min(maxW(), Math.max(MIN_W, saved.width || 440));
  let current = tabs.some((t) => t.id === saved.tab) ? saved.tab : tabs[0].id;
  let isOpen = false;
  const showHooks = {};

  const panel = document.createElement("aside");
  panel.className = "sidepanel lookup-only";
  panel.setAttribute("aria-label", "Side panel");
  panel.hidden = true;
  panel.innerHTML = `
    <div class="sp-resize" role="separator" aria-orientation="vertical" aria-label="Resize side panel" title="Drag to resize" tabindex="0"></div>
    <div class="sp-head">
      <div class="seg sp-tabs" role="tablist">${tabs.map((t) =>
        `<button type="button" role="tab" data-tab="${t.id}">${t.label}</button>`).join("")}</div>
      <span class="grow"></span>
      <button type="button" class="btn small sp-close" title="Collapse the panel (Esc)" aria-label="Collapse side panel">»</button>
    </div>
    <div class="sp-body">${tabs.map((t) => `<section class="sp-section" data-tab="${t.id}" role="tabpanel" hidden></section>`).join("")}</div>`;
  const rail = document.createElement("nav");
  rail.className = "sp-rail lookup-only";
  rail.setAttribute("aria-label", "Open side panel");
  rail.innerHTML = tabs.map((t) => `<button type="button" data-tab="${t.id}" title="Open ${t.label}">${t.label}</button>`).join("");
  document.body.append(panel, rail);

  const section = (id) => panel.querySelector(`.sp-section[data-tab="${id}"]`);
  const remember = () => store.set("sidePanel", { open: isOpen, tab: current, width });

  function layout() {
    document.documentElement.style.setProperty("--sp-w", `${width}px`);
    document.body.classList.toggle("sp-open", isOpen);
    document.body.classList.toggle("sp-narrow", isOpen && window.innerWidth - width < NARROW_PAGE);
    panel.hidden = !isOpen;
    onLayout();
  }

  function select(id) {
    current = id;
    for (const b of panel.querySelectorAll(".sp-tabs button")) {
      b.classList.toggle("on", b.dataset.tab === id);
      b.setAttribute("aria-selected", b.dataset.tab === id);
    }
    for (const s of panel.querySelectorAll(".sp-section")) s.hidden = s.dataset.tab !== id;
    showHooks[id]?.();
  }

  function open(id = current) {
    isOpen = true;
    layout();
    select(id);
    remember();
  }
  function close() {
    isOpen = false;
    layout();
    remember();
  }

  panel.querySelector(".sp-tabs").addEventListener("click", (e) => e.target.dataset.tab && open(e.target.dataset.tab));
  panel.querySelector(".sp-close").addEventListener("click", close);
  rail.addEventListener("click", (e) => e.target.dataset.tab && open(e.target.dataset.tab));
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); close(); }
  });

  // Drag the left edge to resize; arrow keys on the handle nudge it.
  const handle = panel.querySelector(".sp-resize");
  let frame = 0;
  const setWidth = (w) => {
    width = Math.min(maxW(), Math.max(MIN_W, Math.round(w)));
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  };
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("sp-resizing");
    const move = (ev) => setWidth(window.innerWidth - ev.clientX);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      document.body.classList.remove("sp-resizing");
      remember();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
  });
  handle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setWidth(width + (e.key === "ArrowLeft" ? 40 : -40));
      remember();
    }
  });
  window.addEventListener("resize", () => (width > maxW() ? setWidth(maxW()) : layout()));

  return {
    section,
    open,
    close,
    get isOpen() { return isOpen; },
    get tab() { return current; },
    onShow(id, fn) { showHooks[id] = fn; },
    restore() { if (saved.open) open(current); else layout(); },
  };
}
