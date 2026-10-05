const MAX_SIDE = 1568; // larger images are downscaled by the API anyway
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const ACTION_LABEL = { high: "Act now", medium: "Soon", low: "When convenient" };
const CONDITION_LEVELS = ["poor", "fair", "good", "excellent"];
// Verdict levels for the dedicated checks, mapped to the same colours as findings.
const VERDICTS = {
  good: { label: "Good", priority: "low" },
  ok: { label: "OK", priority: "low" },
  worn: { label: "Worn", priority: "medium" },
  minor_issues: { label: "Minor issues", priority: "medium" },
  damaged: { label: "Damaged", priority: "high" },
  faulty: { label: "Faulty", priority: "high" },
  problem: { label: "Problem", priority: "high" },
  not_visible: { label: "Not visible", priority: "na" },
};
const GROMMET_AREAS = {
  top_10_to_2: "Top, 10 to 2 o'clock",
  sides_3_and_9: "Sides, 3 and 9 o'clock",
  throat: "Throat",
  tie_offs: "Tie-off holes",
  whole_hoop: "Whole hoop",
};
const WEAVE_CHECKS = {
  weave_alternates: "Crosses alternate over/under",
  mains_straight: "Mains straight",
  crosses_straight: "Crosses straight",
  even_spacing: "Even spacing",
  holes_correct: "No skipped or wrong holes",
  knots_tidy: "Knots tidy",
};

// Where each component sits on the racket diagram (viewBox 0 0 200 420).
// Components without a physical spot (setup, weight_balance, other) have no zone.
// Stringing faults (weave, holes, knots) are shown on the string bed.
const ZONE_ALIASES = { stringing: "strings" };
const ZONE_ANCHORS = {
  bumper_guard: [100, 16],
  grommets: [24, 92],
  strings: [100, 125],
  frame: [180, 160],
  dampener: [100, 240],
  grip: [100, 360],
};

const form = document.getElementById("form");
const fileInput = document.getElementById("file");
const drop = document.getElementById("drop");
const preview = document.getElementById("preview");
const dropText = document.getElementById("dropText");
const dropChange = document.getElementById("dropChange");
const submitBtn = document.getElementById("submit");
const statusEl = document.getElementById("status");
const results = document.getElementById("results");

let imageData = null; // { data: base64, mediaType }

// The last analysis and what the player said about it, sent with "Send feedback".
let lastRun = null; // { id, player, analysis }
let feedback = { items: {}, note: "" };

// crypto.randomUUID() needs https or localhost; getRandomValues also works over
// plain http, e.g. when a phone opens the page via the computer's IP address.
function newId() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Values a player can pick when they mark a verdict as wrong.
const CORRECTIONS = {
  condition: [["excellent", "Excellent"], ["good", "Good"], ["fair", "Fair"], ["poor", "Poor"]],
  grommets: [["good", "Good"], ["worn", "Worn"], ["damaged", "Damaged"]],
  weave: [["good", "Good"], ["minor_issues", "Minor issues"], ["faulty", "Faulty"]],
};

function setStatus(msg, { error = false, busy = false } = {}) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", error);
  statusEl.classList.toggle("busy", busy);
}

// Resize to keep uploads small and fast, and normalise to JPEG.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
      resolve({ dataUrl, data: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setStatus("Please choose an image file.", { error: true });
    return;
  }
  try {
    const img = await loadImage(file);
    imageData = { data: img.data, mediaType: img.mediaType };
    preview.src = img.dataUrl;
    preview.hidden = false;
    dropText.hidden = true;
    dropChange.hidden = false;
    submitBtn.disabled = false;
    setStatus("");
  } catch (err) {
    setStatus(err.message, { error: true });
  }
}

fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!imageData) return;

  const fd = new FormData(form);
  const player = Object.fromEntries([...fd.entries()].filter(([, v]) => v));

  submitBtn.disabled = true;
  setStatus("On the bench. This can take up to a minute.", { busy: true });

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageData.data, mediaType: imageData.mediaType, player }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    lastRun = { id: newId(), player, analysis: body };
    feedback = { items: {}, note: "" };
    renderResults(body);
    setStatus("");
  } catch (err) {
    setStatus(err.message, { error: true });
  } finally {
    submitBtn.disabled = false;
  }
});

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
}

function label(value) {
  return String(value).replace(/_/g, " ");
}

function ticketHead(left) {
  const now = new Date();
  const stamp = now.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  return el("div", { class: "ticket-head" }, el("span", {}, left), el("span", {}, stamp));
}

// Racket outline with each zone coloured by its most urgent finding and
// numbered markers matching the findings list.
function racketSvg(zones = {}, markers = []) {
  const cls = (zone) => (zones[zone] ? ` z-${zones[zone]}` : "");
  const mains = [];
  for (let x = 36; x <= 164; x += 8.5) mains.push(`<line x1="${x}" y1="20" x2="${x}" y2="232"/>`);
  const crosses = [];
  for (let y = 32; y <= 222; y += 10) crosses.push(`<line x1="24" y1="${y}" x2="176" y2="${y}"/>`);
  const grommets = [];
  for (let a = -160; a <= 160; a += 16) {
    const t = ((a - 90) * Math.PI) / 180;
    grommets.push(`<circle cx="${(100 + 86 * Math.cos(t)).toFixed(1)}" cy="${(125 + 114 * Math.sin(t)).toFixed(1)}" r="2.4"/>`);
  }
  const wraps = [];
  for (let y = 306; y < 408; y += 12) wraps.push(`<line class="wrap" x1="89" y1="${y + 8}" x2="111" y2="${y}"/>`);
  const placed = {};
  const markerSvg = markers.map(({ n, zone }) => {
    const [x, y] = ZONE_ANCHORS[zone];
    const i = (placed[zone] = (placed[zone] ?? -1) + 1);
    // Zones on the side edges stack markers downwards so they stay in view.
    const [mx, my] = zone === "frame" || zone === "grommets" ? [x, y + i * 22] : [x + i * 22, y];
    return `<g class="marker"><circle cx="${mx}" cy="${my}" r="10"/><text x="${mx}" y="${my}">${n}</text></g>`;
  }).join("");

  return `<svg viewBox="0 0 200 420" role="img" aria-label="Racket diagram showing where each finding is">
    <defs><clipPath id="bed"><ellipse cx="100" cy="125" rx="72" ry="100"/></clipPath></defs>
    <g class="strings${cls("strings")}" clip-path="url(#bed)">${mains.join("")}${crosses.join("")}</g>
    <ellipse class="frame${cls("frame")}" cx="100" cy="125" rx="80" ry="108"/>
    <path class="frame${cls("frame")}" d="M70 225 C 80 255, 90 275, 92 300 M130 225 C 120 255, 110 275, 108 300"/>
    <path class="bumper${cls("bumper_guard")}" d="M52 38.6 A80 108 0 0 1 148 38.6"/>
    <g class="grommets${cls("grommets")}">${grommets.join("")}</g>
    <rect class="dampener${cls("dampener")}" x="92" y="213" width="16" height="9" rx="2"/>
    <rect class="grip${cls("grip")}" x="88" y="298" width="24" height="114" rx="4"/>
    ${wraps.join("")}
    ${markerSvg}
  </svg>`;
}

function conditionMeter(condition) {
  const level = CONDITION_LEVELS.indexOf(condition);
  const bar = el("div", { class: "meter-bar" });
  const labels = el("div", { class: "meter-labels" });
  CONDITION_LEVELS.forEach((name, i) => {
    bar.append(el("span", { class: i <= level ? "on" : "" }));
    labels.append(el("span", { class: i === level ? "on" : "" }, name));
  });
  return el("div", { class: "meter", "aria-label": `Condition: ${condition}` }, bar, labels);
}

function renderEmpty() {
  const map = el("div", { class: "racket-map" });
  map.innerHTML = racketSvg();
  map.append(el("p", { class: "map-caption" }, "Inspection points"));

  const checks = el("ul", { class: "checks" });
  [
    ["Strings", "breaks, notching, fraying, strings out of line, string type"],
    ["Frame", "cracks at the throat, 10 and 2, 3 and 9 o'clock; chips; warping"],
    ["Pattern & weave", "pattern count, over/under weave, straight even strings, knots"],
    ["Bumper & grommets", "cracked, split, flattened, missing or worn through, all round the hoop"],
    ["Grip", "shiny, peeling or worn-out overgrip"],
    ["Setup", "string, tension and timing for how you play"],
  ].forEach(([name, what]) => checks.append(el("li", {}, el("b", {}, name), el("span", {}, what))));

  results.replaceChildren(
    ticketHead("Inspection ticket · awaiting racket"),
    el("h2", {}, "What gets checked"),
    el("p", { class: "verdict" }, "Add a photo and the ticket fills in with what was found, where on the racket it is, and what to do about it."),
    el("div", { class: "report-grid" }, map, checks));
}

function renderResults(a) {
  const ticketNo = `No. ${String(Date.now()).slice(-5)}`;

  if (!a.is_tennis_racket) {
    results.replaceChildren(
      ticketHead(`Inspection ticket · ${ticketNo}`),
      el("h2", {}, "No racket found"),
      el("p", { class: "verdict" }, a.summary));
    if (a.photo_tips) results.append(el("p", { class: "photo-tip" }, el("b", {}, "Photo tip"), a.photo_tips));
    results.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const recs = [...(a.recommendations || [])].sort(
    (x, y) => (PRIORITY_ORDER[x.priority] ?? 3) - (PRIORITY_ORDER[y.priority] ?? 3));

  const zones = {};
  const markers = [];
  recs.forEach((r, i) => {
    const zone = ZONE_ALIASES[r.component] || r.component;
    if (!ZONE_ANCHORS[zone]) return;
    const current = zones[zone];
    if (!current || PRIORITY_ORDER[r.priority] < PRIORITY_ORDER[current]) zones[zone] = r.priority;
    markers.push({ n: i + 1, zone });
  });
  // Check verdicts colour their zone even when nothing needs doing.
  const colourFromVerdict = (zone, condition) => {
    const p = VERDICTS[condition]?.priority;
    if (!zones[zone] && p && p !== "na") zones[zone] = p;
  };
  colourFromVerdict("grommets", a.grommet_check?.condition);
  colourFromVerdict("strings", a.weave_check?.condition);

  const map = el("div", { class: "racket-map" });
  map.innerHTML = racketSvg(zones, markers);
  map.append(el("p", { class: "map-caption" }, "Where it is"));

  const d = a.racket_details || {};
  const specs = el("dl", { class: "specs" });
  const addSpec = (k, v) => specs.append(el("div", {}, el("dt", {}, k), el("dd", {}, v)));
  addSpec("Racket", d.brand_model_guess || "Unknown");
  addSpec("Pattern", d.string_pattern || "Unknown");
  if (d.visible_accessories?.length) addSpec("Fitted", d.visible_accessories.join(", "));

  const list = el("ol", { class: "findings" });
  recs.forEach((r, i) => {
    list.append(el("li", { class: "finding" },
      el("span", { class: "finding-no" }, String(i + 1)),
      el("div", {},
        el("div", { class: "finding-top" },
          el("h4", {}, label(r.component)),
          el("span", { class: `stamp ${r.priority}` }, ACTION_LABEL[r.priority] || r.priority)),
        el("p", { class: "issue" }, r.issue),
        el("p", { class: "fix" }, r.suggestion),
        feedbackControl(`finding-${i}`, null, "Is this problem really there?", { component: r.component, priority: r.priority }))));
  });
  if (!recs.length) list.append(el("li", { class: "all-clear" }, "Nothing needs changing right now."));

  results.replaceChildren(
    ticketHead(`Inspection ticket · ${ticketNo}`),
    el("h2", {}, `Condition: ${a.overall_condition}`),
    el("p", { class: "verdict" }, a.summary),
    conditionMeter(a.overall_condition),
    feedbackControl("condition", CORRECTIONS.condition, "Is the condition right?"),
    specs,
    el("div", { class: "report-grid" },
      map,
      el("div", {}, el("h3", { class: "findings-title" }, "What to do"), list)));

  if (a.weave_check) {
    const w = a.weave_check;
    results.append(checkPanel("Pattern & weave check", w.condition, w.observations,
      [["Pattern counted", null, w.pattern_counted || "Not counted"],
        ...(w.checks || []).map((c) => [WEAVE_CHECKS[c.check] || label(c.check), c.status])],
      feedbackControl("weave", CORRECTIONS.weave, "Is the weave verdict right?")));
  }
  if (a.grommet_check) {
    const g = a.grommet_check;
    results.append(checkPanel("Grommet check", g.condition, g.observations,
      (g.areas || []).map((x) => [GROMMET_AREAS[x.location] || label(x.location), x.status]),
      feedbackControl("grommets", CORRECTIONS.grommets, "Is the grommet verdict right?")));
  }
  if (a.photo_tips) results.append(el("p", { class: "photo-tip" }, el("b", {}, "Photo tip"), a.photo_tips));
  results.append(feedbackBar());
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

// "Right / Wrong" buttons for one finding or verdict. When a verdict is marked
// wrong, `options` lets the player pick the correct value.
// `about` is stored with the answer so it still makes sense without the page.
function feedbackControl(key, options, question, about = {}) {
  const right = el("button", { type: "button", class: "fb-btn", "aria-pressed": "false" }, "Right");
  const wrong = el("button", { type: "button", class: "fb-btn", "aria-pressed": "false" }, "Wrong");
  const box = el("div", { class: "fb" }, el("span", { class: "fb-q" }, question), right, wrong);

  let select = null;
  if (options) {
    select = el("select", { class: "fb-correct", "aria-label": "What it actually is" },
      el("option", { value: "" }, "It's actually…"),
      ...options.map(([value, text]) => el("option", { value }, text)));
    select.hidden = true;
    select.addEventListener("change", () => {
      if (feedback.items[key]) feedback.items[key].correct = select.value || undefined;
    });
    box.append(select);
  }

  const choose = (verdict) => {
    const same = feedback.items[key]?.verdict === verdict;
    if (same) delete feedback.items[key];
    else feedback.items[key] = { verdict, ...about, ...(verdict === "wrong" && select?.value ? { correct: select.value } : {}) };
    right.setAttribute("aria-pressed", String(!same && verdict === "right"));
    wrong.setAttribute("aria-pressed", String(!same && verdict === "wrong"));
    if (select) select.hidden = same || verdict !== "wrong";
    updateFeedbackBar();
  };
  right.addEventListener("click", () => choose("right"));
  wrong.addEventListener("click", () => choose("wrong"));
  return box;
}

function feedbackBar() {
  const note = el("textarea", { rows: "2", maxlength: "1000", placeholder: "Anything it missed or got wrong?" });
  note.addEventListener("input", () => { feedback.note = note.value; updateFeedbackBar(); });
  const send = el("button", { type: "button", class: "fb-send", disabled: "" }, "Send feedback");
  const status = el("p", { class: "fb-status", role: "status" });
  send.addEventListener("click", () => sendFeedback(send, status));
  return el("section", { class: "fb-bar", id: "feedbackBar" },
    el("h3", { class: "panel-title" }, "Was this right?"),
    el("p", { class: "fb-help" }, "Mark the findings above as right or wrong, then send. Your photo and answers are kept to improve the checker."),
    el("label", {}, "Notes", note),
    send,
    status);
}

function updateFeedbackBar() {
  const send = document.querySelector("#feedbackBar .fb-send");
  if (!send) return;
  const count = Object.keys(feedback.items).length;
  send.disabled = !count && !feedback.note.trim();
  send.textContent = count ? `Send feedback (${count} marked)` : "Send feedback";
}

async function sendFeedback(send, status) {
  if (!lastRun || !imageData) return;
  send.disabled = true;
  status.textContent = "Sending…";
  status.classList.remove("error");
  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: lastRun.id,
        image: imageData.data,
        mediaType: imageData.mediaType,
        player: lastRun.player,
        analysis: lastRun.analysis,
        items: feedback.items,
        note: feedback.note.trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    status.textContent = "Thanks, saved. You can change your answers and send again.";
  } catch (err) {
    status.textContent = err.message;
    status.classList.add("error");
  } finally {
    updateFeedbackBar();
  }
}

function verdictStamp(status) {
  const v = VERDICTS[status] || VERDICTS.not_visible;
  return el("span", { class: `stamp ${v.priority}` }, v.label);
}

// rows: [label, status] pairs, or [label, null, text] for a plain value.
function checkPanel(title, condition, observations, rows, control) {
  const panel = el("section", { class: "check-panel" },
    el("div", { class: "finding-top" }, el("h3", { class: "panel-title" }, title), verdictStamp(condition)),
    el("p", { class: "issue" }, observations));
  if (rows.length) {
    const list = el("dl", { class: "specs areas" });
    for (const [name, status, text] of rows) {
      list.append(el("div", {}, el("dt", {}, name), el("dd", {}, status ? verdictStamp(status) : text)));
    }
    panel.append(list);
  }
  if (control) panel.append(control);
  return panel;
}

renderEmpty();
