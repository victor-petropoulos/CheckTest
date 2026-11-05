// Case 07 — assertion after an unconditional return (A7 OPTION A).
// Plan §4 row 7: UNIT / SUCCESS / COMPLETE / assertion_count UNKNOWN / INDETERMINATE.
//
// The assertion is RECOGNIZED (recognition completeness stays COMPLETE) but its
// executability is not: milestone-1 does no control-flow analysis, and mere
// presence does not prove execution (KickOff:108-109). So the value counts only
// ESTABLISHED assertions -> 0, availability is UNKNOWN, and the rule refuses
// to read that zero as FAIL (SPEC:425). CT-INT-004 owns unreachable-assertion
// semantics, not CT-INT-001 (SPEC:614-628).
import { expect, it } from '@jest/globals';

it('returns before asserting', () => {
  return;
  expect(1 + 1).toBe(2);
});
