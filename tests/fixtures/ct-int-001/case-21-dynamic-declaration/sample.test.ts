// Case 21 — dynamically constructed declaration (`const t = it`).
// Post-WP3.4: the initializer is static in-file evidence, so `t` resolves
// through the verified alias map and `t('dynamic', ...)` is reported as an
// aliased declaration (gap 'aliased'). Per-test record carries no value with
// availability UNKNOWN; the file reports INCOMPLETE / coverage PARTIAL, so
// CT-INT-001 yields INDETERMINATE — never the pre-fix unjustified FAIL.
//
// INPUT to collectAnalysis / the CLI — not executed by jest
// (jest.config.js testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it } from '@jest/globals';

const t = it;
t('dynamic', () => {
  expect(1).toBe(1);
});
