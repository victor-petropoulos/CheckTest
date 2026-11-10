// Case 23 — compound callee, binary && form: `(flag && it.skip)(name, fn)`.
// WP3.4 remediation: one operand resolves to a test root, so the site is
// REPORTED with the conditional gap (not silently dropped).
//
// INPUT to collectAnalysis / the CLI — not executed by jest
// (jest.config.js testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it } from '@jest/globals';

(flag && it.skip)('maybe', () => {
  expect(1).toBe(1);
});
