// Case 12 — missing/unknown classification (no --type passed).
// Plan §4 row 12: UNKNOWN (default) / SUCCESS / COMPLETE / 1 KNOWN / INDETERMINATE.
//
// The evidence here is PERFECT — the collector found one established supported
// assertion. The INDETERMINATE comes purely from the unknown test type: the
// engine cannot decide applicability, so it refuses to guess (A3, SPEC:475-479).
// UNKNOWN is never an applicability mismatch, so N/A does not apply either —
// that is reserved for a mismatch between two CONCRETE types (case 14).
import { expect, it } from '@jest/globals';

it('adds two numbers', () => {
  expect(1 + 1).toBe(2);
});
