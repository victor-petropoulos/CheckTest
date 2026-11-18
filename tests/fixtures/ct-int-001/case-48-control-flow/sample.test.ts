// Case 48 — control-flow indirection (adversarial, Phase 1d).
//
// Rule 3 of the straight-line definition (collector.ts:543-556): an assertion
// inside an `if`/`else`, loop, `try`, `switch` or labeled statement may or may
// not run — executability is not establishable statically, so the construct is
// recognized but NOT established (collector.ts:617-621). With zero established
// assertions under PARTIAL coverage the verdict is INDETERMINATE, never FAIL:
// the collector cannot prove the branch did not run (docs/limitations.md §1).
import { expect, it } from '@jest/globals';

it('hides its assertion behind a branch', () => {
  if (Math.random() > 0.5) {
    expect(1 + 1).toBe(2);
  }
});
