// Case 47 — mixed-framework file (adversarial, Phase 1d).
//
// A file importing BOTH jest and vitest at runtime is MIXED_FRAMEWORK — never
// first-wins (docs/limitations.md §4). It falls outside SUPPORTED_FRAMEWORKS,
// so the collector reports UNSUPPORTED / NOT_APPLICABLE: no value is
// fabricated and the assertion the collector cannot see is never read as a
// proved zero-assertion FAIL (KickOff:72).
import { expect, it } from '@jest/globals';
import { expect as vExpect, it as vIt } from 'vitest';

it('runs under jest', () => {
  expect(1 + 1).toBe(2);
});

vIt('runs under vitest', () => {
  vExpect(1 + 1).toBe(2);
});
