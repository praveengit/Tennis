const MAX_SIDE = 1568; // larger images are downscaled by the API anyway
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

const form = document.getElementById("form");
const fileInput = document.getElementById("file");
const drop = document.getElementById("drop");
const preview = document.getElementById("preview");
const dropText = document.getElementById("dropText");
const submitBtn = document.getElementById("submit");
const statusEl = document.getElementById("status");
const results = document.getElementById("results");

let imageData = null; // { data: base64, mediaType }

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
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
    setStatus("Please choose an image file.", true);
    return;
  }
  try {
    const img = await loadImage(file);
    imageData = { data: img.data, mediaType: img.mediaType };
    preview.src = img.dataUrl;
    preview.hidden = false;
    dropText.innerHTML = "<small>Tap to choose a different photo</small>";
    submitBtn.disabled = false;
    setStatus("");
  } catch (err) {
    setStatus(err.message, true);
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
  results.hidden = true;
  setStatus("Inspecting your racket… this can take up to a minute.");

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
    setStatus(err.message, true);
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

function renderResults(a) {
  results.replaceChildren();

  const summary = el("div", { class: "card" },
    el("div", { class: "summary-head" },
      el("h2", {}, a.is_tennis_racket ? "Overall condition" : "No racket found"),
      el("span", { class: `pill ${a.overall_condition}` }, a.overall_condition)),
    el("p", {}, a.summary));

  if (a.is_tennis_racket && a.racket_details) {
    const d = a.racket_details;
    const dl = el("dl", { class: "details" },
      el("dt", {}, "Racket"), el("dd", {}, d.brand_model_guess || "Unknown"),
      el("dt", {}, "String pattern"), el("dd", {}, d.string_pattern || "Unknown"));
    if (d.visible_accessories?.length) {
      dl.append(el("dt", {}, "Accessories"), el("dd", {}, d.visible_accessories.join(", ")));
    }
    summary.append(dl);
  }
  results.append(summary);

  const recs = [...(a.recommendations || [])].sort(
    (x, y) => (PRIORITY_ORDER[x.priority] ?? 3) - (PRIORITY_ORDER[y.priority] ?? 3));

  if (recs.length) {
    results.append(el("h2", {}, "What to change"));
    for (const r of recs) {
      results.append(el("div", { class: `card rec ${r.priority}` },
        el("h3", {}, label(r.component), el("span", { class: `pill ${r.priority}` }, r.priority)),
        el("p", { class: "issue" }, r.issue),
        el("p", {}, r.suggestion)));
    }
  } else if (a.is_tennis_racket) {
    results.append(el("div", { class: "card" }, el("p", {}, "Nothing needs changing right now.")));
  }

  if (a.photo_tips) {
    results.append(el("p", { class: "tip" }, `Photo tip: ${a.photo_tips}`));
  }

  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}
