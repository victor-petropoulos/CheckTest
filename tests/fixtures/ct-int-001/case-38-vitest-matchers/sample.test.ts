// Case 38 — vitest gap: vitest-only matchers (toHaveLength, toBeCloseTo, toBeGreaterThan, toBeCalledWith).
import { expect, it } from '@jest/globals';

it('vitest matchers', () => {
  expect([1, 2]).toHaveLength(2);
  expect(1.0).toBeCloseTo(1.0);
  expect(2).toBeGreaterThan(1);
});
