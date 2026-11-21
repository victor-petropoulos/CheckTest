import { it, expect } from 'vitest';
it('uses mapped production file', () => {
  expect(runCheckout()).toBe(true);
});
