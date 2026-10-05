import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MODEL = "claude-opus-5-5";
export const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MEDIA_TYPES_BY_EXT = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // API limit per image
const MAX_EXAMPLES = 20;

const client = new Anthropic();

/** Reads an image file and returns it as a base64 image source, with clear errors. */
export function readImage(file) {
  const mediaType = MEDIA_TYPES_BY_EXT[path.extname(file).toLowerCase()];
  if (!mediaType) throw new Error(`${file}: unsupported image type (use .jpg, .png, .webp or .gif)`);
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`${file}: ${(bytes.length / 1048576).toFixed(1)} MB is over the 5 MB limit; resize it to about 1600px on the long side`);
  }
  return { mediaType, data: bytes.toString("base64"), bytes };
}

// Reference photos labelled by a stringer (knowledge/examples/examples.json).
// They are sent with every request, ahead of the player's photo, and cached.
export const EXAMPLES_DIR = path.join(root, "knowledge", "examples");

function loadExamples() {
  const manifest = path.join(EXAMPLES_DIR, "examples.json");
  if (!fs.existsSync(manifest)) return [];
  const list = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (!Array.isArray(list)) throw new Error(`${manifest}: expected a JSON array`);
  if (list.length > MAX_EXAMPLES) {
    throw new Error(`${manifest}: ${list.length} examples; keep it to ${MAX_EXAMPLES} or fewer so requests stay fast`);
  }
  return list.map((entry, i) => {
    if (!entry?.file || !entry?.label) throw new Error(`${manifest}: entry ${i + 1} needs "file" and "label"`);
    return { ...readImage(path.join(EXAMPLES_DIR, entry.file)), file: entry.file, label: entry.label };
  });
}

export const EXAMPLES = loadExamples();

const KNOWLEDGE_BASE = fs.readFileSync(path.join(root, "knowledge", "racket-inspection.md"), "utf8");

const SYSTEM_PROMPT = `You are an experienced tennis racket technician and stringer.
You inspect photos of tennis rackets and tell the player what should be changed,
replaced, or adjusted. Base your inspection and recommendations on the knowledge
base below, combined with what you can see in the photo and the player info provided.
Only report what you can actually see or reasonably infer; say so when the photo does not show enough.
If the image does not contain a tennis racket, set is_tennis_racket to false and explain in summary.
Always fill grommet_check by going round the hoop as described in section 4 of the knowledge base,
even when the grommets look fine; use "not_visible" when the photo does not show them clearly enough.
If grommets need work, also add a "grommets" item to recommendations.
Always fill weave_check the same way using section 7 of the knowledge base: count the pattern,
trace the crosses and check spacing, holes and knots. If the stringing is faulty, also add a
"stringing" item to recommendations.
Be practical and specific. Write for a recreational player.

<knowledge_base>
${KNOWLEDGE_BASE}
</knowledge_base>`;

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_tennis_racket", "summary", "overall_condition", "racket_details", "grommet_check", "weave_check", "recommendations", "photo_tips"],
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
    grommet_check: {
      type: "object",
      additionalProperties: false,
      required: ["condition", "areas", "observations"],
      properties: {
        condition: { type: "string", enum: ["good", "worn", "damaged", "not_visible"] },
        areas: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["location", "status"],
            properties: {
              location: { type: "string", enum: ["top_10_to_2", "sides_3_and_9", "throat", "tie_offs", "whole_hoop"] },
              status: { type: "string", enum: ["good", "worn", "damaged", "not_visible"] },
            },
          },
        },
        observations: { type: "string" },
      },
    },
    weave_check: {
      type: "object",
      additionalProperties: false,
      required: ["condition", "pattern_counted", "checks", "observations"],
      properties: {
        condition: { type: "string", enum: ["good", "minor_issues", "faulty", "not_visible"] },
        pattern_counted: { type: "string" },
        checks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["check", "status"],
            properties: {
              check: {
                type: "string",
                enum: ["weave_alternates", "mains_straight", "crosses_straight", "even_spacing", "holes_correct", "knots_tidy"],
              },
              status: { type: "string", enum: ["ok", "problem", "not_visible"] },
            },
          },
        },
        observations: { type: "string" },
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
            enum: ["strings", "stringing", "grip", "frame", "bumper_guard", "grommets", "dampener", "weight_balance", "setup", "other"],
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

function exampleBlocks() {
  if (!EXAMPLES.length) return [];
  const blocks = [{
    type: "text",
    text: "Reference photos labelled by a stringer. Use them to recognise these conditions in the player's racket photo that follows. They are not the player's racket.",
  }];
  EXAMPLES.forEach((ex, i) => {
    blocks.push({ type: "text", text: `Example ${i + 1}: ${ex.label}` });
    blocks.push({ type: "image", source: { type: "base64", media_type: ex.mediaType, data: ex.data } });
  });
  // The examples are identical on every request, so cache everything up to here.
  blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
  blocks.push({ type: "text", text: "The player's racket:" });
  return blocks;
}

/** An analysis that finished but can't be used; message is safe to show to the player. */
export class AnalysisError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Sends one racket photo to Claude and returns { analysis, usage }.
 * API errors are thrown as Anthropic SDK errors; unusable results as AnalysisError.
 */
export async function analyzeRacket({ image, mediaType, player }) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
    },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          ...exampleBlocks(),
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: buildUserText(player) },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new AnalysisError("The image could not be analyzed. Try a different photo.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new AnalysisError("The analysis was cut off. Please try again.", 502);
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  try {
    return { analysis: JSON.parse(text), usage: response.usage };
  } catch {
    throw new AnalysisError("Got an unreadable analysis. Please try again.", 502);
  }
}
