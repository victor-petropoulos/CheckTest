// Case 34 — vitest gap: it.skip (modifier form).
import { expect, it } from '@jest/globals';

it.skip('skipped', () => {
  expect(1 + 1).toBe(2);
});
