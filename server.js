import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { ALLOWED_MEDIA_TYPES, AnalysisError, EXAMPLES, analyzeRacket } from "./lib/analyze.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`Racket analyzer running at http://localhost:${PORT}`);
  console.log(`Reference photos loaded: ${EXAMPLES.length}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("Warning: ANTHROPIC_API_KEY is not set - analysis requests will fail.");
  }
});
