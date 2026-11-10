// Case 15 — mixed-framework file (jest AND vitest runtime imports).
//
// detectFramework reports 'mixed', never first-wins: the file has no single
// runtime framework, so it falls outside SUPPORTED_FRAMEWORKS ['jest', 'vitest'] and the
// collector reports UNSUPPORTED. assertion_count stays RELEVANT (a mixed file
// does have assertions) — a capability gap, so availability is UNKNOWN and no
// value is fabricated (KickOff:72).
//
// INPUT to collectAnalysis — not executed by jest (testPathIgnorePatterns) and
// not typechecked (tsconfig exclude): `vitest` is not a dependency.
import { expect, it } from '@jest/globals';
import { vi } from 'vitest';

it('runs under a single framework', () => {
  expect(1 + 1).toBe(2);
  vi.fn();
});
