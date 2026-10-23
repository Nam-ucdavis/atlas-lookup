// Quiz mode: learn Harvard-Oxford, Juelich and Brodmann regions.
//
// Two kinds of question, mixed at random:
//   find  - "Click on the Left Precentral Gyrus": click around to move through the
//           brain, then Submit; graded by looking up the chosen point
//   name  - a region is highlighted, type its name (autocomplete helps)
// Regions you miss come back more often (per-region history in localStorage).
// The Progress dialog summarises that history by brain division, and
// "Practise" there focuses the quiz on one division.

const QUIZ_ATLASES = [
  { id: "harvard-oxford-cort", short: "Harvard-Oxford cortical" },
  { id: "harvard-oxford-sub", short: "Harvard-Oxford subcortical" },
  { id: "juelich", short: "Juelich (cytoarchitecture)" },
  { id: "talairach-ba", short: "Brodmann areas (Talairach)" },
];
const TYPES = [
  { id: "find", label: "Find it on the brain (click)" },
  { id: "name", label: "Name the highlighted region (type)" },
];
const COLORS = { target: [250, 200, 40], ok: [60, 200, 110], bad: [235, 80, 60] };
const SIDE_WORD = { L: "Left ", R: "Right ", B: "" };
const STATUS = [  // display order in the progress bars
  { id: "mastered", label: "Mastered", hint: "right at least twice, ≥ 75%" },
  { id: "learning", label: "Learning", hint: "50–75%, or right once" },
  { id: "struggling", label: "Needs work", hint: "below 50%" },
  { id: "unseen", label: "Not asked yet", hint: "" },
];

// Common abbreviations people type, expanded before matching.
const ABBREV = {
  ifg: "inferior frontal gyrus", mfg: "middle frontal gyrus", sfg: "superior frontal gyrus",
  stg: "superior temporal gyrus", mtg: "middle temporal gyrus", itg: "inferior temporal gyrus",
  loc: "lateral occipital cortex", smg: "supramarginal gyrus", ag: "angular gyrus",
  ofc: "orbital frontal cortex", pcc: "cingulate gyrus posterior division",
  acc: "cingulate gyrus anterior division", spl: "superior parietal lobule",
  sma: "juxtapositional lobule cortex formerly supplementary motor cortex",
  ba: "brodmann area", hipp: "hippocampus", amyg: "amygdala", thal: "thalamus",
};

export function createQuiz(ctx) {
  const $ = (id) => document.getElementById(id);
  const { esc, store } = ctx;
  const S = {
    active: false, data: null, q: null, answered: false, token: 0, recent: [],
    session: { asked: 0, correct: 0, streak: 0, best: 0 },
  };
  let stats = store.get("quizStats", {});
  const selAtlases = () => new Set(store.get("quizAtlases", QUIZ_ATLASES.map((a) => a.id)));
  const selTypes = () => new Set(store.get("quizTypes", TYPES.map((t) => t.id)));
  const focus = () => store.get("quizFocus", "");

  // --- setup panel ----------------------------------------------------------------
  function renderSetup() {
    const a = selAtlases(), t = selTypes();
    $("qAtlases").innerHTML = QUIZ_ATLASES.map((x) => `<label class="atlas-toggle"><input type="checkbox" data-qa="${x.id}" ${a.has(x.id) ? "checked" : ""}><span>${esc(x.short)}${S.data ? `<br><span class="hint" style="margin:0">${S.data[x.id]?.regions.length ?? 0} regions</span>` : ""}</span></label>`).join("");
    $("qTypes").innerHTML = TYPES.map((x) => `<label class="atlas-toggle"><input type="checkbox" data-qt="${x.id}" ${t.has(x.id) ? "checked" : ""}><span>${esc(x.label)}</span></label>`).join("");
    const f = focus();
    $("qFocus").hidden = !f;
    $("qFocus").innerHTML = f ? `Focus: <b>${esc(f)}</b> <button type="button" class="linkish" id="qFocusClear">show all</button>` : "";
  }
  $("qFocus").addEventListener("click", (e) => {
    if (e.target.id !== "qFocusClear") return;
    store.set("quizFocus", ""); renderSetup(); next();
  });
  $("qAtlases").addEventListener("change", (e) => {
    const s = selAtlases(); e.target.checked ? s.add(e.target.dataset.qa) : s.delete(e.target.dataset.qa);
    store.set("quizAtlases", [...s]);
  });
  $("qTypes").addEventListener("change", (e) => {
    const s = selTypes(); e.target.checked ? s.add(e.target.dataset.qt) : s.delete(e.target.dataset.qt);
    store.set("quizTypes", [...s]);
  });
  $("qStart").addEventListener("click", () => {
    S.session = { asked: 0, correct: 0, streak: 0, best: 0 };
    renderStats(); next();
  });
  $("qReset").addEventListener("click", () => {
    if (!confirm("Forget which regions you've got right and wrong?")) return;
    stats = {}; store.set("quizStats", stats); renderStats();
  });

  function renderStats() {
    const s = S.session;
    $("qSession").textContent = s.asked ? `${s.correct} / ${s.asked} correct · streak ${s.streak} · best ${s.best}` : "No questions yet";
    $("qScore").textContent = s.asked ? `${s.correct}/${s.asked}` + (s.streak > 1 ? ` · 🔥 ${s.streak}` : "") : "";
    const weak = Object.values(stats).filter((r) => r.correct < r.seen)
      .sort((a, b) => a.correct / a.seen - b.correct / b.seen || b.seen - a.seen).slice(0, 6);
    $("qWeak").innerHTML = weak.length
      ? weak.map((r) => `<div class="kv">${esc(r.label)} <span class="hint" style="margin:0">${r.correct}/${r.seen} · ${esc(r.atlasShort)}</span></div>`).join("")
      : `<span class="hint">Nothing yet. Missed regions show up here and come back more often.</span>`;
  }

  // --- choosing questions -----------------------------------------------------------
  function pool() {
    const out = [];
    for (const id of selAtlases()) {
      const d = S.data?.[id];
      if (!d) continue;
      for (const item of items(id)) if (!focus() || item.division === focus()) out.push(item);
    }
    return out;
  }
  // Every (region, side) of one atlas, as quiz items.
  function items(id) {
    const d = S.data[id], short = QUIZ_ATLASES.find((a) => a.id === id).short;
    return d.regions.flatMap((r) => r.sides.map((side) => ({
      atlas: id, atlasName: d.atlas_name, atlasShort: short, division: r.division,
      value: r.value, side, name: r.name, label: SIDE_WORD[side] + r.name, key: `${id}|${r.value}|${side}`,
    })));
  }
  function weight(item) {
    const h = stats[item.key];
    if (!h) return 1.5;                        // unseen
    return 0.4 + 3 * (1 - h.correct / h.seen);  // missed regions come back
  }
  function pick(items) {
    const fresh = items.length > 8 ? items.filter((i) => !S.recent.includes(i.key)) : items;
    const w = fresh.map(weight), total = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < fresh.length; i++) if ((r -= w[i]) <= 0) return fresh[i];
    return fresh[fresh.length - 1];
  }

  async function next() {
    const token = ++S.token;
    const items = pool(), types = [...selTypes()];
    if (!items.length || !types.length) {
      showPrompt(focus() && types.length ? `No ${focus()} regions in the chosen atlases` : "Pick at least one atlas and one question type", "", "");
      return;
    }
    for (let tries = 0; tries < 6; tries++) {
      const item = pick(items);
      const r = await fetch(`/api/quiz/point?atlas=${item.atlas}&value=${item.value}&side=${item.side}`);
      if (token !== S.token) return;
      if (!r.ok) { S.recent.push(item.key); continue; }
      const p = await r.json();
      S.q = { ...item, type: types[Math.floor(Math.random() * types.length)], point: p.mm };
      S.answered = false;
      S.recent = [...S.recent, item.key].slice(-6);
      return ask(S.q);
    }
    showPrompt("Couldn't find a question; try other atlases", "", "");
  }

  async function ask(q) {
    $("qFeedback").innerHTML = "";
    $("qNext").hidden = true;
    $("qAtlas").textContent = q.atlasShort;
    if (q.type === "name") {
      showPrompt("Name the highlighted region", `${q.atlasName} · the crosshair is inside it (side not needed)`, "name");
      const names = [...new Set(S.data[q.atlas].regions.map((r) => r.name))].sort();
      $("qNames").innerHTML = names.map((n) => `<option value="${esc(n)}">`).join("");
      $("qAnswer").value = "";
      await showMask(q, COLORS.target);
      ctx.moveCrosshair(q.point);
      $("qAnswer").focus();
    } else {
      showPrompt(`Find the ${q.label}`, `${q.atlasName} · click slices to move the crosshair, then press Submit (↵)`, "find");
      S.pending = null;
      $("qSubmit").disabled = true;
      await clearMask();
    }
  }

  function showPrompt(text, hint, type) {
    $("qPrompt").textContent = text;
    $("qHint").textContent = hint;
    $("qForm").hidden = type !== "name";
    $("qSubmit").hidden = type !== "find";
    $("qGiveUp").hidden = !type;
    $("qGiveUp").textContent = type === "find" ? "Show me" : "Don't know";
    ctx.setHint(type === "find" ? "Quiz: click to move the crosshair, then Submit" : "Quiz: explore freely; clicking won't answer");
  }

  // --- answering --------------------------------------------------------------------
  function onViewerClick(mm) {
    const q = S.q;
    if (!S.active || !q || S.answered || q.type !== "find") return;
    S.pending = mm;
    $("qSubmit").disabled = false;
  }

  async function submitPoint() {
    const q = S.q, mm = S.pending;
    if (!q || S.answered || q.type !== "find" || !mm) return;
    S.answered = true;
    $("qSubmit").hidden = true;
    const r = await fetch(`/api/lookup?x=${mm[0]}&y=${mm[1]}&z=${mm[2]}&radius=5&atlases=${q.atlas}`).then((r) => r.json());
    const res = r.results[0];
    const sideOk = q.side === "B" || (q.side === "L" ? mm[0] < 0 : mm[0] > 0);
    const hit = res.label?.value === q.value;
    const near = (res.neighborhood || []).some((n) => n.value === q.value) || res.nearest?.value === q.value;
    const clicked = res.best_guess || "no labelled region";
    let verdict, msg;
    if (hit && sideOk) { verdict = "ok"; msg = `Correct: ${esc(q.label)}.`; }
    else if (hit) { verdict = "close"; msg = `Right region, wrong hemisphere. That was the ${esc(res.label.name)}.`; }
    else if (near && sideOk) { verdict = "close"; msg = `Close: within 5 mm. You clicked <b>${esc(clicked)}</b>.`; }
    else { verdict = "bad"; msg = `Not quite. You clicked <b>${esc(clicked)}</b>.`; }
    msg += ` The ${esc(q.label)} is highlighted, with the crosshair inside it.`;
    record(q, verdict === "ok");
    feedback(verdict, msg);
    await showMask(q, verdict === "ok" ? COLORS.ok : COLORS.bad);
    ctx.moveCrosshair(q.point);
  }

  $("qForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = S.q;
    if (!q || S.answered || q.type !== "name" || !$("qAnswer").value.trim()) return;
    S.answered = true;
    const v = matchName($("qAnswer").value, q.name);
    record(q, v === "ok");
    const answer = `<b>${esc(q.label)}</b>`;
    if (v === "ok") feedback("ok", `Correct: ${answer}.`);
    else if (v === "close") feedback("close", `Close. The full name is ${answer}.`);
    else feedback("bad", `Not quite. This is the ${answer}.`);
    showMask(q, v === "ok" ? COLORS.ok : COLORS.bad).then(() => ctx.moveCrosshair(q.point));
  });

  $("qGiveUp").addEventListener("click", async () => {
    const q = S.q;
    if (!q || S.answered) return;
    S.answered = true;
    record(q, false);
    feedback("bad", `This is the <b>${esc(q.label)}</b>.`);
    await showMask(q, COLORS.bad);
    ctx.moveCrosshair(q.point);
  });

  $("qNext").addEventListener("click", () => next());
  $("qSubmit").addEventListener("click", () => submitPoint());
  document.addEventListener("keydown", (e) => {
    if (!S.active || e.key !== "Enter" || e.target.id === "qAnswer") return;
    if (S.answered && !$("qNext").hidden) { e.preventDefault(); next(); }
    else if (!S.answered && S.q?.type === "find" && S.pending) { e.preventDefault(); submitPoint(); }
  });

  function feedback(verdict, html) {
    $("qFeedback").innerHTML = `<div class="qfb ${verdict}">${html}</div>`;
    $("qGiveUp").hidden = true;
    $("qSubmit").hidden = true;
    $("qNext").hidden = false;
    $("qNext").focus();
    ctx.setHint("Explore freely, then press Next");
  }

  function record(q, ok) {
    const h = stats[q.key] || { seen: 0, correct: 0 };
    stats[q.key] = { seen: h.seen + 1, correct: h.correct + (ok ? 1 : 0), label: q.label, atlasShort: q.atlasShort };
    store.set("quizStats", stats);
    const s = S.session;
    s.asked++; if (ok) { s.correct++; s.streak++; s.best = Math.max(s.best, s.streak); } else s.streak = 0;
    renderStats();
  }

  // --- viewer highlight ---------------------------------------------------------------
  async function clearMask() {
    const nv = ctx.getNv();
    if (!nv) return;
    while (nv.volumes.length > 1) nv.removeVolumeByIndex(1);
    nv.updateGLVolume();
  }
  async function showMask(q, [r, g, b]) {
    const nv = ctx.getNv();
    if (!nv) return;
    const token = S.token;
    await clearMask();
    const vol = await nv.addVolumeFromUrl({ url: `/api/quiz/mask/${q.atlas}/${q.value}/${q.side}.nii.gz`, opacity: 0.7 });
    if (token !== S.token) { nv.removeVolume(vol); return; }
    vol.setColormapLabel({ R: [0, r], G: [0, g], B: [0, b], A: [0, 255], I: [0, 1] });
    nv.updateGLVolume();
  }

  // --- mode switching -----------------------------------------------------------------
  async function loadData() {
    if (S.data) return;
    const [d, divisions] = await Promise.all([
      fetch("/api/quiz/regions").then((r) => r.json()),
      fetch("/api/quiz/divisions").then((r) => r.json()),
    ]);
    S.data = Object.fromEntries(d.map((a) => [a.atlas, a]));
    S.divisions = divisions;
  }

  async function enter() {
    S.active = true;
    document.body.classList.add("quiz");
    $("quizToggle").textContent = "Back to lookup";
    if (!S.data) showPrompt("Loading regions…", "", "");
    await loadData();
    renderSetup(); renderStats();
    if (!S.q) next();
    else if (S.q.type === "name" || S.answered) showMask(S.q, S.answered ? COLORS.bad : COLORS.target);
  }
  async function exit() {
    S.active = false;
    S.token++;
    document.body.classList.remove("quiz");
    $("quizToggle").textContent = "Quiz mode";
    await clearMask();
    ctx.restoreLookup();
  }
  $("quizToggle").addEventListener("click", () => (S.active ? exit() : enter()));

  // --- progress by brain division -----------------------------------------------------
  function status(key) {
    const h = stats[key];
    if (!h) return "unseen";
    const acc = h.correct / h.seen;
    if (h.correct >= 2 && acc >= 0.75) return "mastered";
    return acc < 0.5 ? "struggling" : "learning";
  }

  function stack(counts, total) {
    return `<span class="stack" role="img" aria-label="${STATUS.map((s) => `${counts[s.id]} ${s.label.toLowerCase()}`).join(", ")}">` +
      STATUS.map((s) => counts[s.id] ? `<span class="pseg ${s.id}" style="flex:${counts[s.id]}" title="${counts[s.id]} ${esc(s.label.toLowerCase())}"></span>` : "").join("") +
      (total ? "" : `<span class="pseg unseen" style="flex:1"></span>`) + `</span>`;
  }

  function renderProgress() {
    const which = store.get("progressAtlas", "");
    const ids = which ? [which] : QUIZ_ATLASES.map((a) => a.id);
    const all = ids.flatMap(items);
    const summarise = (list) => {
      const counts = Object.fromEntries(STATUS.map((s) => [s.id, 0]));
      let seen = 0, correct = 0;
      for (const it of list) {
        counts[status(it.key)]++;
        const h = stats[it.key]; if (h) { seen += h.seen; correct += h.correct; }
      }
      return { counts, seen, correct, practised: list.length - counts.unseen };
    };
    const o = summarise(all);
    const acc = (x) => (x.seen ? `${Math.round((100 * x.correct) / x.seen)}% correct` : "no answers yet");
    let html = `<div class="prog-overall"><div class="big">${o.counts.mastered} <span>of ${all.length} mastered</span></div>
      <div class="hint" style="margin:0">${o.practised} practised · ${acc(o)} over ${o.seen} answer${o.seen === 1 ? "" : "s"}</div>
      ${stack(o.counts, all.length)}</div>
      <div class="legend">${STATUS.map((s) => `<span><i class="pseg ${s.id}"></i>${esc(s.label)}${s.hint ? ` <span class="hint" style="margin:0">(${esc(s.hint)})</span>` : ""}</span>`).join("")}</div>`;
    const rank = { struggling: 0, learning: 1, unseen: 2, mastered: 3 };
    for (const div of S.divisions) {
      const list = all.filter((it) => it.division === div);
      if (!list.length) continue;
      const x = summarise(list);
      const rows = list.map((it) => ({ it, st: status(it.key), h: stats[it.key] }))
        .sort((a, b) => rank[a.st] - rank[b.st] || a.it.label.localeCompare(b.it.label));
      html += `<details class="prog-row"><summary>
          <span class="name">${esc(div)}</span>
          ${stack(x.counts, list.length)}
          <span class="nums">${x.counts.mastered}/${list.length} mastered · ${acc(x)}</span>
          <button type="button" class="btn small" data-practise="${esc(div)}">Practise</button>
        </summary><div class="prog-list">${rows.map(({ it, st, h }) =>
          `<div class="prog-item"><i class="pseg ${st}"></i><span>${esc(it.label)}</span><span class="hint" style="margin:0">${esc(it.atlasShort)}</span><span class="score">${h ? `${h.correct}/${h.seen}` : "–"}</span></div>`).join("")}</div></details>`;
    }
    $("progBody").innerHTML = html;
  }

  async function showProgress() {
    await loadData();
    $("progAtlas").innerHTML = `<option value="">All quiz atlases</option>` +
      QUIZ_ATLASES.map((a) => `<option value="${a.id}">${esc(a.short)}</option>`).join("");
    $("progAtlas").value = store.get("progressAtlas", "");
    stats = store.get("quizStats", {});
    renderProgress();
    $("progress").showModal();
  }
  $("progressBtn").addEventListener("click", showProgress);
  $("progAtlas").addEventListener("change", (e) => { store.set("progressAtlas", e.target.value); renderProgress(); });
  $("progClose").addEventListener("click", () => $("progress").close());
  $("progress").addEventListener("click", (e) => { if (e.target === $("progress")) $("progress").close(); });
  $("progBody").addEventListener("click", async (e) => {
    const div = e.target.dataset?.practise;
    if (!div) return;
    e.preventDefault();  // don't toggle the <details>
    store.set("quizFocus", div);
    $("progress").close();
    if (S.active) { renderSetup(); next(); } else { S.q = null; await enter(); }
  });

  return { get active() { return S.active; }, onViewerClick, enter, showProgress };
}

// --- answer matching (exported for testing in the console) ---------------------------
function norm(s) {
  return s.toLowerCase()
    .replace(/[_,.'’()\-/]/g, " ")
    .replace(/\b(left|right|gm|l|r)\b/g, " ")
    .split(/\s+/).filter(Boolean).map((w) => ABBREV[w] || w).join(" ")
    .replace(/\s+/g, " ").trim();
}
function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}
export function matchName(answer, name) {
  const ba = name.match(/brodmann area (\d+)/i);
  if (ba) {
    const n = answer.match(/\d+/);
    return n && n[0] === ba[1] ? "ok" : "bad";
  }
  const a = norm(answer), t = norm(name);
  if (!a) return "bad";
  if (a === t) return "ok";
  const sim = similarity(a, t);
  if (sim >= 0.85) return "ok";
  if (sim >= 0.6 || (a.length >= 4 && ` ${t} `.includes(` ${a} `))) return "close";
  return "bad";
}
