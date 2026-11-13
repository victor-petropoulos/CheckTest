// Case 08 — assertion inside a callback, execution uncertain.
// Plan §4 row 8: UNIT / SUCCESS / COMPLETE / assertion_count UNKNOWN / INDETERMINATE.
//
// Whether the timer callback runs is not establishable statically, so the
// assertion is unestablished under A7 OPTION A — the same verdict case 7 gets
// for a different reason.
import { expect, it } from '@jest/globals';

it('asserts inside a callback', (done) => {
  setTimeout(() => {
    expect(1 + 1).toBe(2);
    done();
  }, 1);
});
