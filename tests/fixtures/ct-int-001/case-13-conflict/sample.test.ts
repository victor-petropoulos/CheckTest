// Case 13 — conflicting evidence (AST count 1 vs regex-stub count 2).
// Plan §4 row 13: UNIT / SUCCESS / COMPLETE / 1 UNKNOWN + conflicts[2 entries] / INDETERMINATE.
//
// Two providers, one subject:
//   - the AST collector is DIRECT and counts only real, established assertions
//     -> 1. It correctly ignores comments.
//   - the regex stub is DERIVED and counts raw occurrence text of the assertion
//     call, comments and strings included -> 2.
// The disagreement is preserved, not resolved by fiat (A4 OPTION A,
// KickOff:132). The integration harness is what attaches the two values as a
// conflict: milestone-1 ships no multi-provider aggregator in production, so no
// src/ code would do it — evaluation.ts only READS the conflict container.
//
// NOTE: keep the literal assertion-call spelling out of these comments. The
// stub provider counts it in raw text, so mentioning it here would inflate the
// stub count above 2 and weaken the fixture.
import { expect, it } from '@jest/globals';

// expect(1).toBe(1) — documented example, never executed
it('counts only real assertions', () => {
  expect(1).toBe(1);
});
