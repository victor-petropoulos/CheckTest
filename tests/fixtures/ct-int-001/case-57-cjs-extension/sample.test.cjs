// Case 57 — .cjs extension characterization (T11 owner ruling 2026-11-22).
//
// Axios corpus reality (docs/open-items.md optional item 11):
//   tests/smoke/cjs/tests/header-buckets.smoke.test.cjs
// CommonJS test file: plain `require`, bare `test(...)` declaration, node
// `assert` calls — no `@jest/globals` import, so the framework is DERIVED
// (bare-global mocha class, support.ts:241) and `assert` is an unsupported
// assertion namespace (support.ts:92). The point of the fixture is that the
// file is ANALYZED at all: pre-T11 the dispatcher returned
// UNSUPPORTED / 'no adapter matched' for .cjs and no collector ever ran.
//
// INPUT to collectAnalysis — never executed by jest (jest.config
// testPathIgnorePatterns excludes tests/fixtures/) and never typechecked
// (tsconfig exclude).
const assert = require('assert');

test('cjs smoke', () => {
  assert.equal(1, 1);
});
