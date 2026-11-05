// Case 25 — vitest aliased declaration (B1).
import { expect, it } from 'vitest';

const t = it;
t('aliased', () => {
  expect(1).toBe(1);
});
