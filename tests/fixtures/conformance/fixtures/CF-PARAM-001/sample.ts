import { it, expect } from 'vitest';
it.each([1, 2])('parameterized %i', (value) => {
  expect(value).toBe(value);
});
