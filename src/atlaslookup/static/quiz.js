// Quiz mode: learn the structures of each 3D focus (PFC, parietal, cingulate, temporal
// with the MTL subfields, occipital), on the slices and in 3D at once.
//
// The slices and the quiz's own Focus view sit side by side; the 3D view shows the
// question's focus, every structure grey. Two kinds of question, mixed at random:
//   find  - "Find the Left Angular gyrus": click a slice or a structure in 3D, then
//           Submit; graded against the focus's structure mask
//   name  - a structure is coloured in 3D and on the slices, type its name
// Structures you miss come back more often (per-structure history in localStorage).
// The Progress dialog summarises that history by focus, and "Practise" there sticks to
// one focus.

import { FOCI, focusParts } from "./focus3d.js";

const TYPES = [
  { id: "find", label: "Find it (click a slice or the 3D view)" },
  { id: "name", label: "Name the coloured structure (type)" },
];
// Saturated (≥ 0.78), so the Focus view draws them solid.
const COLORS = { target: [250, 200, 40], ok: [20, 220, 70], bad: [245, 50, 40], pick: [40, 140, 255] };
const STATUS = [  // display order in the progress bars
  { id: "mastered", label: "Mastered", hint: "right at least twice, ≥ 75%" },
  { id: "learning", label: "Learning", hint: "50–75%, or right once" },
  { id: "struggling", label: "Needs work", hint: "below 50%" },
  { id: "unseen", label: "Not asked yet", hint: "" },
];
const NEAR_MM = 5;  // a click this close to the structure counts as close

// Common abbreviations people type, expanded before matching.
const ABBREV = {
  ifg: "inferior frontal gyrus", mfg: "middle frontal gyrus", sfg: "superior frontal gyrus",
  stg: "superior temporal gyrus", mtg: "middle temporal gyrus", itg: "inferior temporal gyrus",
  loc: "lateral occipital cortex", smg: "supramarginal gyrus", ag: "angular gyrus",
  ofc: "frontal orbital cortex", pcc: "posterior cingulate gyrus", acc: "anterior cingulate gyrus",
  spl: "superior parietal lobule", rsc: "retrosplenial cortex", ca: "cornu ammonis",
  dg: "dentate gyrus", ec: "entorhinal cortex", erc: "entorhinal cortex", phg: "parahippocampal gyrus",
  hata: "hippocampal amygdaloid transition area", hipp: "hippocampus", amyg: "amygdala",
};

/** Every structure of every focus, once, as quiz items: { key, focus, focusLabel, group,
 * name, label }. A structure in two foci (the ACC, in PFC and Cingulate) is asked in the
 * narrower one. */
const BROAD = ["pfc"];  // foci whose shared structures belong to another
export function quizItems() {
  const seen = new Set(), out = [];
  const order = Object.keys(FOCI).sort((a, b) => BROAD.includes(a) - BROAD.includes(b));
  for (const id of order) {
    const f = FOCI[id];
    for (const p of focusParts(id, "both")) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      out.push({ key: p.key, focus: id, focusLabel: f.label, group: f.groups[p.group].name, name: p.name,
        hemi: p.hemi, label: `${p.hemi === "L" ? "Left" : "Right"} ${p.name}` });
    }
  }
  return out;
}

export function createQuiz(ctx) {
  const $ = (id) => document.getElementById(id);
  const { esc, store, view } = ctx;  // view: the quiz's Focus view (focus3d, quiz: true)
  const S = {
    active: false, q: null, answered: false, token: 0, recent: [], pending: null,
    session: { asked: 0, correct: 0, streak: 0, best: 0 },
  };
  const ALL = quizItems();
  let stats = store.get("quizStats", {});
  const selFoci = () => new Set(store.get("quizFoci", Object.keys(FOCI)));
  const selTypes = () => new Set(store.get("quizTypes", TYPES.map((t) => t.id)));
  const practise = () => store.get("quizPractise", "");  // a focus id, or "" for all chosen

  // --- setup panel ----------------------------------------------------------------
  function renderSetup() {
    const f = selFoci(), t = selTypes();
    $("qFoci").innerHTML = Object.entries(FOCI).map(([id, x]) => `<label class="atlas-toggle"><input type="checkbox" data-qf="${id}" ${f.has(id) ? "checked" : ""}><span>${esc(x.label)}<br><span class="hint" style="margin:0">${ALL.filter((i) => i.focus === id).length} structures</span></span></label>`).join("");
    $("qTypes").innerHTML = TYPES.map((x) => `<label class="atlas-toggle"><input type="checkbox" data-qt="${x.id}" ${t.has(x.id) ? "checked" : ""}><span>${esc(x.label)}</span></label>`).join("");
    const pr = practise();
    $("qFocus").hidden = !pr;
    $("qFocus").innerHTML = pr ? `Practising: <b>${esc(FOCI[pr]?.label ?? pr)}</b> <button type="button" class="linkish" id="qFocusClear">all chosen</button>` : "";
  }
  $("qFocus").addEventListener("click", (e) => {
    if (e.target.id !== "qFocusClear") return;
    store.set("quizPractise", ""); renderSetup(); next();
  });
  $("qFoci").addEventListener("change", (e) => {
    const s = selFoci(); e.target.checked ? s.add(e.target.dataset.qf) : s.delete(e.target.dataset.qf);
    store.set("quizFoci", [...s]);
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
    if (!confirm("Forget which structures you've got right and wrong?")) return;
    stats = {}; store.set("quizStats", stats); renderStats();
  });

  function renderStats() {
    const s = S.session;
    $("qSession").textContent = s.asked ? `${s.correct} / ${s.asked} correct · streak ${s.streak} · best ${s.best}` : "No questions yet";
    $("qScore").textContent = s.asked ? `${s.correct}/${s.asked}` + (s.streak > 1 ? ` · 🔥 ${s.streak}` : "") : "";
    const known = new Set(ALL.map((i) => i.key));
    const weak = Object.entries(stats).filter(([k, r]) => known.has(k) && r.correct < r.seen).map(([, r]) => r)
      .sort((a, b) => a.correct / a.seen - b.correct / b.seen || b.seen - a.seen).slice(0, 6);
    $("qWeak").innerHTML = weak.length
      ? weak.map((r) => `<div class="kv">${esc(r.label)} <span class="hint" style="margin:0">${r.correct}/${r.seen} · ${esc(r.focusLabel ?? "")}</span></div>`).join("")
      : `<span class="hint">Nothing yet. Missed structures show up here and come back more often.</span>`;
  }

  // --- choosing questions -----------------------------------------------------------
  function pool() {
    const pr = practise(), f = selFoci();
    return ALL.filter((i) => (pr ? i.focus === pr : f.has(i.focus)));
  }
  function weight(item) {
    const h = stats[item.key];
    if (!h) return 1.5;                        // unseen
    return 0.4 + 3 * (1 - h.correct / h.seen);  // missed structures come back
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
      showPrompt("Pick at least one focus and one question type", "", "");
      return;
    }
    const item = pick(items);
    S.q = { ...item, type: types[Math.floor(Math.random() * types.length)], point: null };
    S.answered = false;
    S.pending = null;
    S.recent = [...S.recent, item.key].slice(-6);
    $("qFeedback").innerHTML = "";
    $("qNext").hidden = true;
    $("qAtlas").textContent = item.focusLabel;  // the group is shown after the answer
    showPrompt("Loading…", "", "");
    await clearMask();
    view.highlight({});
    await view.show(true, item.focus);
    if (token !== S.token) return;
    S.q.point = view.insidePoint(item.key);
    if (!S.q.point) { S.recent.push(item.key); return next(); }  // not in this template's grid
    ask(S.q);
  }

  async function ask(q) {
    if (q.type === "name") {
      showPrompt("Name the coloured structure", `${FOCI[q.focus].label} · yellow in 3D and on the slices; the crosshair is inside it (side not needed)`, "name");
      const names = [...new Set(view.parts.map((p) => p.name))].sort();
      $("qNames").innerHTML = names.map((n) => `<option value="${esc(n)}">`).join("");
      $("qAnswer").value = "";
      view.highlight({ [q.key]: COLORS.target });
      await showMask(q, COLORS.target);
      ctx.moveCrosshair(q.point);
      $("qAnswer").focus();
    } else {
      showPrompt(`Find the ${q.label}`, `${FOCI[q.focus].label} · click it on a slice or in 3D (drag to rotate), then press Submit (↵)`, "find");
      $("qSubmit").disabled = true;
    }
  }

  function showPrompt(text, hint, type) {
    $("qPrompt").textContent = text;
    $("qHint").textContent = hint;
    $("qForm").hidden = type !== "name";
    $("qSubmit").hidden = type !== "find";
    $("qGiveUp").hidden = !type;
    $("qGiveUp").textContent = type === "find" ? "Show me" : "Don't know";
    ctx.setHint(type === "find" ? "Quiz: click a slice or a 3D structure, then Submit" : "Quiz: explore freely; clicking won't answer");
  }

  // --- answering --------------------------------------------------------------------
  // A click on the slices (mm) or on a structure in 3D (mm and that structure): in a find
  // question it becomes the answer, shown in blue in 3D (without naming it).
  function choose(mm, part) {
    const q = S.q;
    if (!S.active || !q || S.answered || q.type !== "find") return;
    S.pending = { mm, part: part ?? view.structureAt(mm) };
    $("qSubmit").disabled = false;
    view.highlight(S.pending.part ? { [S.pending.part.key]: COLORS.pick } : {});
  }
  function onViewerClick(mm) { choose(mm, null); }
  function on3dClick(mm, part) {
    if (!S.active) return;
    ctx.moveCrosshair(mm);
    choose(mm, part);
  }

  async function submitPoint() {
    const q = S.q, pend = S.pending;
    if (!q || S.answered || q.type !== "find" || !pend) return;
    S.answered = true;
    $("qSubmit").hidden = true;
    const got = pend.part;
    let verdict, msg;
    if (got?.key === q.key) { verdict = "ok"; msg = `Correct: ${esc(q.label)}.`; }
    else if (got && got.name === q.name) { verdict = "close"; msg = `Right structure, wrong hemisphere: that was the <b>${esc(label(got))}</b>.`; }
    else if (view.distanceTo(pend.mm, q.key, NEAR_MM) <= NEAR_MM) {
      verdict = "close"; msg = `Close: within ${NEAR_MM} mm. You clicked <b>${esc(got ? label(got) : await nameAt(pend.mm))}</b>.`;
    } else { verdict = "bad"; msg = `Not quite. You clicked <b>${esc(got ? label(got) : await nameAt(pend.mm))}</b>.`; }
    msg += ` The ${esc(q.label)} is ${verdict === "ok" ? "green" : "red"}${got && got.key !== q.key ? ", your pick blue" : ""}.`;
    record(q, verdict === "ok");
    feedback(verdict, msg);
    reveal(q, verdict === "ok" ? COLORS.ok : COLORS.bad, got && got.key !== q.key ? got : null);
  }
  const label = (p) => `${p.hemi === "L" ? "Left" : "Right"} ${p.name}`;
  // What a click outside the focus's structures hit, from Harvard-Oxford.
  async function nameAt(mm) {
    const r = await fetch(`/api/lookup?x=${mm[0]}&y=${mm[1]}&z=${mm[2]}&radius=0&atlases=harvard-oxford-cort,harvard-oxford-sub`)
      .then((r) => r.json()).catch(() => null);
    const hit = r?.results?.find((x) => x.label);
    return hit ? `${hit.label.name} (not part of this focus)` : "outside any labelled region";
  }

  // After an answer: the target in green or red in both views (and a wrong 3D pick blue).
  async function reveal(q, color, wrong = null) {
    view.highlight({ ...(wrong ? { [wrong.key]: COLORS.pick } : {}), [q.key]: color });
    await showMask(q, color);
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
    reveal(q, v === "ok" ? COLORS.ok : COLORS.bad);
  });

  $("qGiveUp").addEventListener("click", () => {
    const q = S.q;
    if (!q || S.answered || !q.point) return;
    S.answered = true;
    record(q, false);
    feedback("bad", `This is the <b>${esc(q.label)}</b>.`);
    reveal(q, COLORS.bad);
  });

  $("qNext").addEventListener("click", () => next());
  $("qSubmit").addEventListener("click", () => submitPoint());
  document.addEventListener("keydown", (e) => {
    if (!S.active || e.key !== "Enter" || e.target.id === "qAnswer") return;
    if (S.answered && !$("qNext").hidden) { e.preventDefault(); next(); }
    else if (!S.answered && S.q?.type === "find" && S.pending) { e.preventDefault(); submitPoint(); }
  });

  function feedback(verdict, html) {
    $("qAtlas").textContent = `${S.q.focusLabel} · ${S.q.group}`;
    $("qFeedback").innerHTML = `<div class="qfb ${verdict}">${html}</div>`;
    $("qGiveUp").hidden = true;
    $("qSubmit").hidden = true;
    $("qNext").hidden = false;
    $("qNext").focus();
    ctx.setHint("Explore freely, then press Next");
  }

  function record(q, ok) {
    const h = stats[q.key] || { seen: 0, correct: 0 };
    stats[q.key] = { seen: h.seen + 1, correct: h.correct + (ok ? 1 : 0), label: q.label, focusLabel: q.focusLabel };
    store.set("quizStats", stats);
    const s = S.session;
    s.asked++; if (ok) { s.correct++; s.streak++; s.best = Math.max(s.best, s.streak); } else s.streak = 0;
    renderStats();
  }

  // --- slice highlight ----------------------------------------------------------------
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
    const vol = await nv.addVolumeFromUrl({ url: `/api/regions/mask.nii.gz?sel=${encodeURIComponent(q.key)}`, name: "quiz.nii.gz", opacity: 0.7 });
    if (token !== S.token) { nv.removeVolume(vol); return; }
    vol.setColormapLabel({ R: [0, r], G: [0, g], B: [0, b], A: [0, 255], I: [0, 1] });
    nv.updateGLVolume();
  }

  // --- mode switching -----------------------------------------------------------------
  async function enter() {
    S.active = true;
    document.body.classList.add("quiz");
    $("quizToggle").innerHTML = '<span class="mt-ico" aria-hidden="true">↩</span> Back to lookup';
    renderSetup(); renderStats();
    if (!S.q) return next();
    await view.show(true, S.q.focus);
    if (S.answered) reveal(S.q, COLORS.bad);
    else if (S.q.type === "name") { view.highlight({ [S.q.key]: COLORS.target }); showMask(S.q, COLORS.target); }
  }
  async function exit() {
    S.active = false;
    S.token++;
    document.body.classList.remove("quiz");
    $("quizToggle").innerHTML = '<span class="mt-ico" aria-hidden="true">🧠</span> Quiz me!';
    view.show(false);
    await clearMask();
    ctx.restoreLookup();
  }
  $("quizToggle").addEventListener("click", () => (S.active ? exit() : enter()));

  // --- progress by focus --------------------------------------------------------------
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
    const summarise = (list) => {
      const counts = Object.fromEntries(STATUS.map((s) => [s.id, 0]));
      let seen = 0, correct = 0;
      for (const it of list) {
        counts[status(it.key)]++;
        const h = stats[it.key]; if (h) { seen += h.seen; correct += h.correct; }
      }
      return { counts, seen, correct, practised: list.length - counts.unseen };
    };
    const o = summarise(ALL);
    const acc = (x) => (x.seen ? `${Math.round((100 * x.correct) / x.seen)}% correct` : "no answers yet");
    let html = `<div class="prog-overall"><div class="big">${o.counts.mastered} <span>of ${ALL.length} mastered</span></div>
      <div class="hint" style="margin:0">${o.practised} practised · ${acc(o)} over ${o.seen} answer${o.seen === 1 ? "" : "s"}</div>
      ${stack(o.counts, ALL.length)}</div>
      <div class="legend">${STATUS.map((s) => `<span><i class="pseg ${s.id}"></i>${esc(s.label)}${s.hint ? ` <span class="hint" style="margin:0">(${esc(s.hint)})</span>` : ""}</span>`).join("")}</div>`;
    const rank = { struggling: 0, learning: 1, unseen: 2, mastered: 3 };
    for (const [id, f] of Object.entries(FOCI)) {
      const list = ALL.filter((it) => it.focus === id);
      if (!list.length) continue;
      const x = summarise(list);
      const rows = list.map((it) => ({ it, st: status(it.key), h: stats[it.key] }))
        .sort((a, b) => rank[a.st] - rank[b.st] || a.it.label.localeCompare(b.it.label));
      html += `<details class="prog-row"><summary>
          <span class="name">${esc(f.label)}</span>
          ${stack(x.counts, list.length)}
          <span class="nums">${x.counts.mastered}/${list.length} mastered · ${acc(x)}</span>
          <button type="button" class="btn small" data-practise="${id}">Practise</button>
        </summary><div class="prog-list">${rows.map(({ it, st, h }) =>
          `<div class="prog-item"><i class="pseg ${st}"></i><span>${esc(it.label)}</span><span class="hint" style="margin:0">${esc(it.group)}</span><span class="score">${h ? `${h.correct}/${h.seen}` : "–"}</span></div>`).join("")}</div></details>`;
    }
    $("progBody").innerHTML = html;
  }

  function showProgress() {
    stats = store.get("quizStats", {});
    renderProgress();
    $("progress").showModal();
  }
  $("progressBtn").addEventListener("click", showProgress);
  $("progClose").addEventListener("click", () => $("progress").close());
  $("progress").addEventListener("click", (e) => { if (e.target === $("progress")) $("progress").close(); });
  $("progBody").addEventListener("click", async (e) => {
    const id = e.target.dataset?.practise;
    if (!id) return;
    e.preventDefault();  // don't toggle the <details>
    store.set("quizPractise", id);
    $("progress").close();
    if (S.active) { renderSetup(); next(); } else { S.q = null; await enter(); }
  });

  return { get active() { return S.active; }, onViewerClick, on3dClick, enter, showProgress };
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
  // "Cornu ammonis (CA)": the name with or without its bracket, or the bracket alone.
  const inner = name.match(/\(([^)]*)\)/)?.[1];
  const names = [name, ...(inner ? [name.replace(/\s*\([^)]*\)/g, ""), inner] : [])];
  const rank = { ok: 2, close: 1, bad: 0 };
  return names.map((n) => matchOne(answer, n)).reduce((a, b) => (rank[b] > rank[a] ? b : a));
}
function matchOne(answer, name) {
  const a = norm(answer), t = norm(name);
  if (!a) return "bad";
  if (a === t) return "ok";
  const sim = similarity(a, t);
  if (sim >= 0.85) return "ok";
  if (sim >= 0.6 || (a.length >= 4 && ` ${t} `.includes(` ${a} `))) return "close";
  return "bad";
}
