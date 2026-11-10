// Case 16 — per-test mixed: one asserted test + one empty body.
// Plan §4 row P2: 1 FAIL + 1 PASS, no leak (D1 regression).
//
// INPUT to collectAnalysis / the CLI — not executed by jest
// (jest.config.js testPathIgnorePatterns) and not typechecked
// (tsconfig.json exclude).
import { expect, it } from '@jest/globals';

it('asserts something', () => {
  expect(1 + 1).toBe(2);
});

it('has no assertions', () => {});
