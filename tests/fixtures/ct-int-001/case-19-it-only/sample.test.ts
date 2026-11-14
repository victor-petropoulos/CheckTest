// Case 19 — it.only.
// Plan §4 row: it.only is an unsupported modifier form -> own per-test record,
// value absent, availability UNKNOWN, never FAIL.
//
// INPUT to collectAnalysis / the CLI — not executed by jest
// (jest.config.js testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it } from '@jest/globals';

it.only('focused', () => {
  expect(1 + 1).toBe(2);
});
