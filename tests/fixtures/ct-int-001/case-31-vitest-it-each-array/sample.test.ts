// Case 31 — vitest gap: it.each (array form).
import { expect, it } from '@jest/globals';

it.each([[1, 2]])('adds %i', (a: number, b: number) => {
  expect(a + b).toBe(3);
});
