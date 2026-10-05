// Turns an analysis into the answers we score, and compares them with the
// answers written down for each test photo in evals/cases.json.

const hasRec = (analysis, component, priorities) =>
  (analysis.recommendations || []).some((r) => r.component === component && priorities.includes(r.priority));

// Each check: the values allowed in cases.json, and how to read the answer from an analysis.
export const CHECKS = {
  is_tennis_racket: {
    values: [true, false],
    read: (a) => a.is_tennis_racket,
  },
  overall_condition: {
    values: ["excellent", "good", "fair", "poor"],
    read: (a) => a.overall_condition,
  },
  // A "strings" recommendation marked act now or soon.
  strings_need_replacing: {
    values: [true, false],
    read: (a) => hasRec(a, "strings", ["high", "medium"]),
  },
  // A "frame" recommendation marked act now (a crack or suspected crack).
  frame_damage: {
    values: [true, false],
    read: (a) => hasRec(a, "frame", ["high"]),
  },
  // A "grip" recommendation marked act now or soon.
  overgrip_worn: {
    values: [true, false],
    read: (a) => hasRec(a, "grip", ["high", "medium"]),
  },
  grommets: {
    values: ["good", "worn", "damaged"],
    read: (a) => a.grommet_check?.condition,
  },
  weave: {
    values: ["good", "minor_issues", "faulty"],
    read: (a) => a.weave_check?.condition,
  },
};

/** Returns a list of problems with one case's "expected" answers (empty when valid). */
export function validateExpected(expected) {
  if (!expected || typeof expected !== "object") return ['needs an "expected" object'];
  const problems = [];
  for (const [check, value] of Object.entries(expected)) {
    const spec = CHECKS[check];
    if (!spec) problems.push(`unknown check "${check}" (known: ${Object.keys(CHECKS).join(", ")})`);
    else if (!spec.values.includes(value)) problems.push(`"${check}" must be one of ${JSON.stringify(spec.values)}, got ${JSON.stringify(value)}`);
  }
  if (!Object.keys(expected).length) problems.push('"expected" has no answers to score');
  return problems;
}

/** Scores one analysis against the expected answers; only the checks written down are scored. */
export function scoreCase(expected, analysis) {
  return Object.entries(expected).map(([check, want]) => {
    const got = CHECKS[check].read(analysis);
    return { check, expected: want, got, pass: got === want };
  });
}
