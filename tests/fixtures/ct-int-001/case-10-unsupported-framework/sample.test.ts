// Case 10 — unsupported framework (mocha import).
// `mocha` is outside the SUPPORTED_FRAMEWORKS allowlist, so the
// collector reports UNSUPPORTED rather than guessing.
import { expect, it } from 'mocha';

it('runs under mocha', () => {
  expect(1 + 1).toBe(2);
});
