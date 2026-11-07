// Case 11 — collector failure (malformed TypeScript, parse diagnostics).
// Plan §4 row 11: UNIT / FAILED / INCOMPLETE / no value / NO RULE RESULT.
//
// This file is deliberately unparseable. Two consequences, both intentional:
//   - it cannot be typechecked, which is why tests/fixtures is excluded from
//     tsconfig.json (same reason tests/adapters/collector.test.ts writes its
//     malformed input to a tmpdir instead of the repo);
//   - the engine reports EvaluationStatus.FAILED and produces NO RuleFinding, so
//     there is no ruleResults entry at all (SPEC:374,404,405). An aborted scan is
//     reported through analysis.status and evaluationStatus, never through a verdict.
//
// Parse diagnostics are preserved in the evidence `reason`, never stderr-only.
import { expect, it } from '@jest/globals';

it('never parses', () => {
  const x = ;
});
