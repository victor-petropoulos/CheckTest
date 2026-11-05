// Case 01 — standard assertion.
// Plan §4 row 1: UNIT / SUCCESS / COMPLETE / assertion_count 1 KNOWN / PASS.
//
// INPUT to collectAnalysis — not executed by jest (see jest.config.js
// testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it } from '@jest/globals';

it('adds two numbers', () => {
  expect(1 + 1).toBe(2);
});
