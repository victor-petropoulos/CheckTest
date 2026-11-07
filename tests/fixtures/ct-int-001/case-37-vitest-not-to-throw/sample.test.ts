// Case 37 — vitest gap: .not.toThrow() matcher negation.
import { expect, it } from '@jest/globals';

it('does not throw', () => {
  expect(() => {}).not.toThrow();
});
