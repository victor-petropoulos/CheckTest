// Case 53 — near-miss negation (plan task 3; OQ1 ruling in
// .opencode/scratch/dogfood-gap-closure/2-researcher-notes.md).
// These three shapes must STAY UNKNOWN / INDETERMINATE — never become PASS:
//   1. expect(x)[dynamicMatcher]()      — computed matcher (rejected form)
//   2. expect(x).not[dynamic]()         — computed `.not` (A2 tripwire)
//   3. expect(p).rejects.not.toBe(y)    — async negation, deferred milestone-2
//
// INPUT to collectAnalysis — not executed by jest (jest.config.js
// testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it } from '@jest/globals';

it('near-miss dynamic and async negation', () => {
  const matcher = 'toBe';
  const p = Promise.resolve(1);
  expect(1)[matcher](1);
  expect(1).not[matcher](1);
  expect(p).rejects.not.toBe(1);
});
