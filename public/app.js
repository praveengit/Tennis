const MAX_SIDE = 1568; // larger images are downscaled by the API anyway
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const ACTION_LABEL = { high: "Act now", medium: "Soon", low: "When convenient" };
const CONDITION_LEVELS = ["poor", "fair", "good", "excellent"];

// Where each component sits on the racket diagram (viewBox 0 0 200 420).
// Components without a physical spot (setup, weight_balance, other) have no zone.
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
    ["Bumper & grommets", "worn through, split or missing"],
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
    if (!ZONE_ANCHORS[r.component]) return;
    const current = zones[r.component];
    if (!current || PRIORITY_ORDER[r.priority] < PRIORITY_ORDER[current]) zones[r.component] = r.priority;
    markers.push({ n: i + 1, zone: r.component });
  });

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
        el("p", { class: "fix" }, r.suggestion))));
  });
  if (!recs.length) list.append(el("li", { class: "all-clear" }, "Nothing needs changing right now."));

  results.replaceChildren(
    ticketHead(`Inspection ticket · ${ticketNo}`),
    el("h2", {}, `Condition: ${a.overall_condition}`),
    el("p", { class: "verdict" }, a.summary),
    conditionMeter(a.overall_condition),
    specs,
    el("div", { class: "report-grid" },
      map,
      el("div", {}, el("h3", { class: "findings-title" }, "What to do"), list)));

  if (a.photo_tips) results.append(el("p", { class: "photo-tip" }, el("b", {}, "Photo tip"), a.photo_tips));
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

renderEmpty();
