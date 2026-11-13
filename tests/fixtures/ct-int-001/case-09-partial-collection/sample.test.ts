// Case 09 — incomplete collection (computed matcher `expect(x)[m]()`).
// Plan §4 row 9: UNIT / SUCCESS / INCOMPLETE (coverage PARTIAL) / UNKNOWN / INDETERMINATE.
//
// The matcher name is computed, so no form ID can be assigned: the construct is
// unclassified -> recognition completeness INCOMPLETE and coverage PARTIAL.
// This is the same shape as case 3/4 (unsupported form) reached a different way.
import { expect, it } from '@jest/globals';

it('uses a computed matcher', () => {
  const matcher = 'toBe';
  expect(1 + 1)[matcher](2);
});
