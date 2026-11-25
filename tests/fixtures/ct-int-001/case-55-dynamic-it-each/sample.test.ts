// Case 55 — dynamic it.each tables (T8 RED fixture; stays-UNKNOWN guard for T9).
// FROZEN literal-table semantics (7-researcher-notes.md (a),(d)): a table is
// statically countable ONLY as a literal ArrayExpression (primitives and nested
// arrays, no spread/identifiers/computed/call). `rows` is a const identifier and
// the computed table from computeRows() is a call -> NOT countable -> unsupported-form
// gap stays -> value 0, availability UNKNOWN, coverage PARTIAL, completeness INCOMPLETE,
// CT-INT-001 verdict INDETERMINATE (unknown_evidence_policy). Must PASS today AND
// after T9 (T9 only recognizes literal ArrayExpression tables, never identifiers/calls).
//
// INPUT to collectAnalysis — not executed by jest (jest.config.js
// testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it } from '@jest/globals';

const rows: ReadonlyArray<Array<number>> = [[1, 2], [3, 4]];

it.each(rows)('dynamic adds %i', (a: number, b: number) => {
  expect(a + b).toBeGreaterThan(0);
});

it.each(computeRows())('computed adds %i', (a: number, b: number) => {
  expect(a + b).toBeGreaterThan(0);
});

function computeRows(): Array<Array<number>> {
  return [[1, 2]];
}
