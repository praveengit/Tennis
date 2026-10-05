// Scores the analyzer against labelled test photos.
//
//   npm run eval                 run every case in evals/cases.json
//   npm run eval -- --dry-run    check the cases and photos without calling the API
//   npm run eval -- --only racket-03.jpg
//   npm run eval -- --concurrency 4
//
// Each case is one API call to Claude, so a full run costs real money.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKS, scoreCase, validateExpected } from "./score.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS_DIR = path.join(here, "photos");
const RESULTS_DIR = path.join(here, "results");

function parseArgs(argv) {
  const args = { dryRun: false, only: null, concurrency: 2 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--only") args.only = argv[++i];
    else if (argv[i] === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]) || 1);
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return args;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function loadCases(readImage, only) {
  const cases = JSON.parse(fs.readFileSync(path.join(here, "cases.json"), "utf8"));
  if (!Array.isArray(cases)) throw new Error("evals/cases.json must be a JSON array");
  const problems = [];
  const loaded = [];
  cases.forEach((c, i) => {
    const where = `case ${i + 1}${c?.file ? ` (${c.file})` : ""}`;
    if (!c?.file) return problems.push(`${where}: needs "file"`);
    if (only && c.file !== only) return;
    for (const p of validateExpected(c.expected)) problems.push(`${where}: ${p}`);
    try {
      loaded.push({ ...c, image: readImage(path.join(PHOTOS_DIR, c.file)) });
    } catch (err) {
      problems.push(`${where}: ${err.code === "ENOENT" ? `photo not found in evals/photos/` : err.message}`);
    }
  });
  if (problems.length) throw new Error(`Problems in evals/cases.json:\n  - ${problems.join("\n  - ")}`);
  if (only && !loaded.length) throw new Error(`No case with file "${only}"`);
  return loaded;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

function printReport(results) {
  const byCheck = {};
  for (const r of results) {
    for (const s of r.scores || []) {
      byCheck[s.check] ??= { pass: 0, total: 0 };
      byCheck[s.check].total++;
      if (s.pass) byCheck[s.check].pass++;
    }
  }

  console.log("\nScore by check");
  for (const check of Object.keys(CHECKS)) {
    const s = byCheck[check];
    if (!s) continue;
    const pct = Math.round((100 * s.pass) / s.total);
    console.log(`  ${check.padEnd(24)} ${String(s.pass).padStart(3)}/${String(s.total).padEnd(3)} ${String(pct).padStart(3)}%`);
  }

  const misses = results.flatMap((r) => (r.scores || []).filter((s) => !s.pass).map((s) => ({ file: r.file, ...s })));
  if (misses.length) {
    console.log("\nMisses");
    for (const m of misses) console.log(`  ${m.file}: ${m.check} expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}`);
  }
  const errors = results.filter((r) => r.error);
  if (errors.length) {
    console.log("\nErrors (not scored)");
    for (const e of errors) console.log(`  ${e.file}: ${e.error}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Imported here so --dry-run works without credentials or network access.
  const { EXAMPLES, MODEL, analyzeRacket, readImage } = await import("../lib/analyze.js");

  const cases = loadCases(readImage, args.only);
  if (!cases.length) {
    console.log("No test cases yet. Add photos to evals/photos/ and their answers to evals/cases.json (see evals/README.md).");
    return;
  }

  // A test photo that is also a reference photo makes the score look better than it is.
  const exampleHashes = new Map(EXAMPLES.map((ex) => [sha256(ex.bytes), ex.file]));
  const overlap = cases.filter((c) => exampleHashes.has(sha256(c.image.bytes)));
  if (overlap.length) {
    throw new Error(`These test photos are also reference photos; remove them from one of the two:\n  - ${overlap
      .map((c) => `${c.file} = knowledge/examples/${exampleHashes.get(sha256(c.image.bytes))}`).join("\n  - ")}`);
  }

  const scored = cases.reduce((n, c) => n + Object.keys(c.expected).length, 0);
  console.log(`${cases.length} cases, ${scored} answers to score, ${EXAMPLES.length} reference photos, model ${MODEL}`);
  if (args.dryRun) {
    console.log("Dry run: cases and photos look fine. Run without --dry-run to call the API.");
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const results = await mapLimit(cases, args.concurrency, async (c, i) => {
    try {
      const { analysis, usage: u } = await analyzeRacket({ image: c.image.data, mediaType: c.image.mediaType, player: c.player });
      usage.input += u.input_tokens ?? 0;
      usage.cacheRead += u.cache_read_input_tokens ?? 0;
      usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
      usage.output += u.output_tokens ?? 0;
      const scores = scoreCase(c.expected, analysis);
      console.log(`  [${i + 1}/${cases.length}] ${c.file}: ${scores.filter((s) => s.pass).length}/${scores.length}`);
      return { file: c.file, scores, analysis };
    } catch (err) {
      console.log(`  [${i + 1}/${cases.length}] ${c.file}: error`);
      return { file: c.file, error: err.message };
    }
  });

  printReport(results);
  console.log(`\nTokens: ${usage.input} input, ${usage.cacheRead} cache read, ${usage.cacheWrite} cache write, ${usage.output} output`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ model: MODEL, examples: EXAMPLES.map((e) => e.file), usage, results }, null, 2));
  console.log(`Full results: ${path.relative(process.cwd(), out)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
