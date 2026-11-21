import { it, expect } from 'vitest';
function expectValid(value) { expect(value).toBe(true); }
it('helper assertion', () => {
  const ok = true;
  expectValid(ok);
});
