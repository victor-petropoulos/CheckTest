// Case 03 — unsupported assertion API (chai-style `assert.equal`).
// Plan §4 row 3: UNIT / SUCCESS / INCOMPLETE / assertion_count UNKNOWN / INDETERMINATE.
//
// `assert` is in UNSUPPORTED_ASSERTION_NAMESPACES (support.ts), so the construct
// is RECORDED with a reason rather than dropped: a zero must never be
// manufactured from evidence the collector could not classify (KickOff:72).
import { it } from '@jest/globals';

it('uses an unsupported assertion API', () => {
  assert.equal(1, 1);
});
