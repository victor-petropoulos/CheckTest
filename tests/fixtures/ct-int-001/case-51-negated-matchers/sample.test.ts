// Case 51 — council-frozen NEGATED matcher forms (plan task 3, T3 RED).
// All 6 frozen negated forms from the FROZEN FORM SET
// (.opencode/scratch/dogfood-gap-closure/2-researcher-notes.md): sync chains
// only, literal `.not.` — expect-not-to-be, expect-not-to-contain,
// expect-not-to-have-property, expect-not-to-be-null, expect-not-to-throw,
// expect-not-to-have-been-called. Straight-line it() body.
//
// INPUT to collectAnalysis — not executed by jest (jest.config.js
// testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it } from '@jest/globals';

const fn = jest.fn();

it('negated matcher forms', () => {
  expect(1).not.toBe(2);
  expect([1, 2]).not.toContain(3);
  expect({ a: 1 }).not.toHaveProperty('b');
  expect(null).not.toBeNull();
  expect(() => {}).not.toThrow();
  expect(fn).not.toHaveBeenCalled();
});
