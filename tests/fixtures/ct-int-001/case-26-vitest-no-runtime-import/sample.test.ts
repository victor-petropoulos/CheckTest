// Case 26 — vitest no runtime import (B1).
import type { it } from 'vitest';

it('runs under vitest', () => {
  expect(1 + 1).toBe(2);
});
