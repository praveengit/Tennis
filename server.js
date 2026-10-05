import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MODEL = "claude-opus-5-5";
const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const client = new Anthropic();
const app = express();

app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(here, "public")));

const SYSTEM_PROMPT = `You are an experienced tennis racket technician and stringer.
You inspect photos of tennis rackets and tell the player what should be changed,
replaced, or adjusted. Look carefully for:
- Strings: fraying, notching, broken or moved mains/crosses, loss of tension, dead/discoloured strings, string pattern.
- Grip / overgrip: wear, dirt, peeling, slipperiness, wrong size hints.
- Frame: cracks, chips, paint damage, bumper guard wear, grommet damage, warping.
- Accessories: vibration dampener, lead tape, butt cap.
- Setup for the player: string type and tension, head size, weight/balance, given the player info provided.
Only report what you can actually see or reasonably infer; say so when the photo does not show enough.
If the image does not contain a tennis racket, set is_tennis_racket to false and explain in summary.
Be practical and specific. Write for a recreational player.`;

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_tennis_racket", "summary", "overall_condition", "racket_details", "recommendations", "photo_tips"],
  properties: {
    is_tennis_racket: { type: "boolean" },
    summary: { type: "string" },
    overall_condition: { type: "string", enum: ["excellent", "good", "fair", "poor", "unknown"] },
    racket_details: {
      type: "object",
      additionalProperties: false,
      required: ["brand_model_guess", "string_pattern", "visible_accessories"],
      properties: {
        brand_model_guess: { type: "string" },
        string_pattern: { type: "string" },
        visible_accessories: { type: "array", items: { type: "string" } },
      },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["component", "issue", "suggestion", "priority"],
        properties: {
          component: {
            type: "string",
            enum: ["strings", "grip", "frame", "bumper_guard", "grommets", "dampener", "weight_balance", "setup", "other"],
          },
          issue: { type: "string" },
          suggestion: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    photo_tips: { type: "string" },
  },
};

function buildUserText(player = {}) {
  const lines = ["Please inspect this tennis racket and tell me what needs to be changed."];
  const info = [];
  if (player.level) info.push(`Playing level: ${player.level}`);
  if (player.style) info.push(`Playing style: ${player.style}`);
  if (player.frequency) info.push(`How often they play: ${player.frequency}`);
  if (player.lastRestrung) info.push(`Last restrung: ${player.lastRestrung}`);
  if (player.notes) info.push(`Player notes: ${player.notes}`);
  if (info.length) lines.push("", "Player info:", ...info.map((l) => `- ${l}`));
  return lines.join("\n");
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
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: buildUserText(player) },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "The image could not be analyzed. Try a different photo." });
    }
    if (response.stop_reason === "max_tokens") {
      return res.status(502).json({ error: "The analysis was cut off. Please try again." });
    }

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    return res.json(JSON.parse(text));
  } catch (err) {
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
    if (err instanceof SyntaxError) {
      console.error("Could not parse model output:", err.message);
      return res.status(502).json({ error: "Got an unreadable analysis. Please try again." });
    }
    console.error(err);
    return res.status(500).json({ error: "Unexpected server error." });
  }
});

app.listen(PORT, () => {
  console.log(`Racket analyzer running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("Warning: ANTHROPIC_API_KEY is not set - analysis requests will fail.");
  }
});
