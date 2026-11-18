// Case 46 — unsupported assertion APIs (adversarial, Phase 1d).
//
// Node `assert.equal` and chai-style `expect(x).to.equal(y)` are both outside
// the supported assertion forms. The `assert` namespace is in
// UNSUPPORTED_ASSERTION_NAMESPACES (support.ts:57) and the chai chain fails
// classifyForm (support.ts:364) — BOTH are recorded as unclassified constructs
// with a reason (collector.ts:710-731). A zero here is never a measurement of
// the declared scope: coverage PARTIAL, completeness INCOMPLETE, INDETERMINATE.
import { expect, it } from '@jest/globals';

it('mixes unsupported assertion APIs', () => {
  assert.equal(1, 1);
  expect(1).to.equal(1);
});
