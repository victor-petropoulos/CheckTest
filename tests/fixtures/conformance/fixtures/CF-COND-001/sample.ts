import { it, expect } from 'vitest';
it('conditional assertion', () => {
  const ok = true;
  if (ok) {
    expect(ok).toBe(true);
  }
});
