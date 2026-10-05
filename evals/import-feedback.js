// Turns feedback sent from the web page (feedback/<id>/) into test cases.
//
//   npm run import-feedback              add new cases to evals/cases.json
//   npm run import-feedback -- --dry-run show what would be added
//
// Only answers a player gave are used. Review the new cases before trusting
// the score: players can be wrong too.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKS } from "./score.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FEEDBACK_DIR = path.join(here, "..", "feedback");
const PHOTOS_DIR = path.join(here, "photos");
const CASES_FILE = path.join(here, "cases.json");

// What a finding marked right or wrong tells us, per component.
// A "right" only counts when the finding's priority would score as true.
const FINDING_CHECKS = {
  strings: { check: "strings_need_replacing", truePriorities: ["high", "medium"] },
  frame: { check: "frame_damage", truePriorities: ["high"] },
  grip: { check: "overgrip_worn", truePriorities: ["high", "medium"] },
};

// Verdicts a player can confirm or correct, and where the analysis keeps them.
const VERDICT_CHECKS = {
  condition: { check: "overall_condition", read: (a) => a.overall_condition },
  grommets: { check: "grommets", read: (a) => a.grommet_check?.condition },
  weave: { check: "weave", read: (a) => a.weave_check?.condition },
};

/** Builds the expected answers from one feedback record; conflicting answers are dropped. */
export function expectedFromFeedback({ analysis, items }) {
  const votes = {};
  const vote = (check, value) => {
    if (!CHECKS[check].values.includes(value)) return;
    (votes[check] ??= new Set()).add(value);
  };

  for (const [key, item] of Object.entries(items)) {
    const verdict = VERDICT_CHECKS[key];
    if (verdict) {
      if (item.verdict === "right") vote(verdict.check, verdict.read(analysis));
      else if (item.correct) vote(verdict.check, item.correct);
      continue;
    }
    const finding = FINDING_CHECKS[item.component];
    if (!key.startsWith("finding-") || !finding) continue;
    if (item.verdict === "wrong") vote(finding.check, false);
    else if (finding.truePriorities.includes(item.priority)) vote(finding.check, true);
  }

  const expected = {};
  const conflicts = [];
  for (const [check, values] of Object.entries(votes)) {
    if (values.size === 1) expected[check] = [...values][0];
    else conflicts.push(check);
  }
  if (Object.keys(expected).length) expected.is_tennis_racket = analysis.is_tennis_racket === true;
  return { expected, conflicts };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!fs.existsSync(FEEDBACK_DIR)) {
    console.log("No feedback yet (no feedback/ folder).");
    return;
  }
  const cases = JSON.parse(fs.readFileSync(CASES_FILE, "utf8"));
  const known = new Set(cases.map((c) => c.file));

  const added = [];
  const skipped = [];
  for (const id of fs.readdirSync(FEEDBACK_DIR).sort()) {
    const file = path.join(FEEDBACK_DIR, id, "feedback.json");
    if (!fs.existsSync(file)) continue;
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const caseFile = `fb-${id}${path.extname(record.photo)}`;
    if (known.has(caseFile)) continue;

    const { expected, conflicts } = expectedFromFeedback(record);
    if (!Object.keys(expected).length) {
      skipped.push(`${id}: no answers that can be scored${record.note ? ` (note: "${record.note}")` : ""}`);
      continue;
    }
    const entry = { file: caseFile, player: record.player, expected, source: "feedback" };
    if (record.note) entry.note = record.note;
    if (conflicts.length) entry.conflicting_answers = conflicts;
    added.push({ entry, photo: path.join(FEEDBACK_DIR, id, record.photo) });
  }

  for (const { entry } of added) {
    console.log(`+ ${entry.file}: ${JSON.stringify(entry.expected)}${entry.note ? `\n    note: ${entry.note}` : ""}`);
  }
  for (const s of skipped) console.log(`- skipped ${s}`);
  if (!added.length) {
    console.log("Nothing new to add.");
    return;
  }
  if (dryRun) {
    console.log(`\nDry run: ${added.length} case(s) would be added.`);
    return;
  }

  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  for (const { entry, photo } of added) fs.copyFileSync(photo, path.join(PHOTOS_DIR, entry.file));
  fs.writeFileSync(CASES_FILE, JSON.stringify([...cases, ...added.map((a) => a.entry)], null, 2) + "\n");
  console.log(`\nAdded ${added.length} case(s) to evals/cases.json. Review them (and any notes) before trusting the score.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
