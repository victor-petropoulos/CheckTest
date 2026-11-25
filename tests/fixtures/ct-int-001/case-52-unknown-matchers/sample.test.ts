// Case 52 — council-frozen PLAIN unknown matcher forms (plan task 3, T3 RED).
// All 11 frozen plain forms from the FROZEN FORM SET
// (.opencode/scratch/dogfood-gap-closure/2-researcher-notes.md):
// toBeUndefined, toHaveProperty, toBeDefined, toHaveLength, toBeGreaterThan,
// toBeNull, toMatch, toHaveBeenCalled, toHaveBeenCalledWith,
// toMatchInlineSnapshot (BARE zero-arg call — council trap), and
// toBeGreaterThanOrEqual. Straight-line it() body.
//
// INPUT to collectAnalysis — not executed by jest (jest.config.js
// testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it } from '@jest/globals';

const fn = jest.fn();

it('plain unknown matcher forms', () => {
  expect(undefined).toBeUndefined();
  expect({ a: 1 }).toHaveProperty('a');
  expect(1).toBeDefined();
  expect([1, 2]).toHaveLength(2);
  expect(2).toBeGreaterThan(1);
  expect(null).toBeNull();
  expect('abc').toMatch(/a/);
  expect(fn).toHaveBeenCalled();
  expect(fn).toHaveBeenCalledWith(1);
  expect('inline').toMatchInlineSnapshot();
  expect(2).toBeGreaterThanOrEqual(2);
});
