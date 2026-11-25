// Case 54 — literal it.each / test.each tables (T8 RED fixture).
// FROZEN literal-table semantics (dogfood-gap-closure 7-researcher-notes.md
// (a)-(c)): an each table that is a literal ArrayExpression (primitives and
// nested arrays only, no spread/identifiers/computed), with a straight-line
// shared callback, is statically countable; xN aggregation = rows x
// straight-line assertion count (it.each 3 rows x 1 = 3; test.each 2 rows x 1
// = 2; file-level aggregate 5). Post-T9 this sidecar must be KNOWN / COMPLETE /
// PASS with value 5; pre-T9 (today) it is INDETERMINATE with the unsupported-form
// gap -> this fixture is RED in T8.
//
// INPUT to collectAnalysis — not executed by jest (jest.config.js
// testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it, test } from '@jest/globals';

it.each([[1, 2], [3, 4], [5, 6]])('adds %i+%i', (a: number, b: number) => {
  expect(a + b).toBeGreaterThanOrEqual(3);
});

test.each([[1, 2], [2, 4]])('doubles %i', (from: number, to: number) => {
  expect(to).toBe(from * 2);
});
