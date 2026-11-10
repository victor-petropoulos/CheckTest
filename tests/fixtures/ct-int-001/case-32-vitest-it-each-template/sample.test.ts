// Case 32 — vitest gap: it.each (tagged template form).
import { expect, it } from '@jest/globals';

it.each`a | b
1 | 2`('adds', ({ a, b }: { a: number; b: number }) => {
  expect(a + b).toBe(3);
});
