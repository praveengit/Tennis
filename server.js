import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { ALLOWED_MEDIA_TYPES, AnalysisError, EXAMPLES, analyzeRacket } from "./lib/analyze.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
// Photos and answers players send back; see README "Feedback". Not committed.
const FEEDBACK_DIR = path.join(here, "feedback");
const FEEDBACK_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const FEEDBACK_KEY = /^(condition|grommets|weave|finding-\d{1,2})$/;

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(here, "public")));
// Fonts are self-hosted from the @fontsource packages, so the page makes no third-party requests.
for (const font of ["barlow", "barlow-condensed", "jetbrains-mono"]) {
  app.use(`/fonts/${font}`, express.static(path.join(here, "node_modules", "@fontsource", font)));
}

app.post("/api/analyze", async (req, res) => {
  const { image, mediaType, player } = req.body ?? {};
  if (typeof image !== "string" || !image) {
    return res.status(400).json({ error: "No image provided." });
  }
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    return res.status(400).json({ error: "Unsupported image type. Use JPEG, PNG, WebP or GIF." });
  }

  try {
    const { analysis } = await analyzeRacket({ image, mediaType, player });
    return res.json(analysis);
  } catch (err) {
    if (err instanceof AnalysisError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Authentication failed - check ANTHROPIC_API_KEY.");
      return res.status(500).json({ error: "Server is not configured with a valid API key." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Too many requests right now. Please wait a moment and retry." });
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error(err.message);
      return res.status(400).json({ error: "The image was rejected. Try a smaller JPEG or PNG." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(err);
      return res.status(502).json({ error: "The analysis service failed. Please try again." });
    }
    console.error(err);
    return res.status(500).json({ error: "Unexpected server error." });
  }
});

app.post("/api/feedback", async (req, res) => {
  const { id, image, mediaType, player, analysis, items, note } = req.body ?? {};
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) {
    return res.status(400).json({ error: "Missing or invalid id." });
  }
  if (typeof image !== "string" || !image || !FEEDBACK_EXT[mediaType]) {
    return res.status(400).json({ error: "Missing or unsupported photo." });
  }
  if (!analysis || typeof analysis !== "object" || !items || typeof items !== "object") {
    return res.status(400).json({ error: "Missing analysis or answers." });
  }
  const cleanItems = {};
  for (const [key, value] of Object.entries(items)) {
    if (!FEEDBACK_KEY.test(key) || !["right", "wrong"].includes(value?.verdict)) {
      return res.status(400).json({ error: `Invalid answer for "${key}".` });
    }
    cleanItems[key] = { verdict: value.verdict };
    for (const field of ["correct", "component", "priority"]) {
      if (typeof value[field] === "string") cleanItems[key][field] = value[field].slice(0, 40);
    }
  }

  try {
    const dir = path.join(FEEDBACK_DIR, id);
    await fs.mkdir(dir, { recursive: true });
    const photo = `photo.${FEEDBACK_EXT[mediaType]}`;
    await fs.writeFile(path.join(dir, photo), Buffer.from(image, "base64"));
    await fs.writeFile(path.join(dir, "feedback.json"), JSON.stringify({
      id,
      received_at: new Date().toISOString(),
      photo,
      player: player && typeof player === "object" ? player : {},
      analysis,
      items: cleanItems,
      note: typeof note === "string" ? note.slice(0, 1000) : "",
    }, null, 2));
    return res.json({ ok: true });
  } catch (err) {
    console.error("Could not save feedback:", err);
    return res.status(500).json({ error: "Could not save feedback." });
  }
});

app.listen(PORT, () => {
  console.log(`Racket analyzer running at http://localhost:${PORT}`);
  console.log(`Reference photos loaded: ${EXAMPLES.length}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("Warning: ANTHROPIC_API_KEY is not set - analysis requests will fail.");
  }
});
