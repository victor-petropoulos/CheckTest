// Case 35 — vitest gap: it.skipIf (conditional modifier form).
import { expect, it } from '@jest/globals';

it.skipIf(true)('skipped', () => {
  expect(1 + 1).toBe(2);
});
