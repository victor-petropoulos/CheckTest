// Case 27 — K-15 describe-wrapped zero-assertion.
// B4 characterized this shape inline (tests/integration/fixtures.test.ts:430-474):
// a describe-wrapped declared test whose body asserts nothing, scanned COMPLETE,
// must report FAIL — not INDETERMINATE. B8 commits it so a full-file byte-exact
// golden can pin the FAIL report (tests/integration/goldens.test.ts).
//
// INPUT to collectAnalysis — not executed by jest (jest.config.js
// testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it } from '@jest/globals';

describe('x', () => {
  it('y', () => {});
});
