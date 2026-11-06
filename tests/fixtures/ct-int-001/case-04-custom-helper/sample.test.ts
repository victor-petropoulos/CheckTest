// Case 04 — custom assertion helper (unresolvable in scope).
// Plan §4 row 4: UNIT / SUCCESS / INCOMPLETE / assertion_count UNKNOWN / INDETERMINATE.
//
// A1: the declared scope is `test-body`; cross-file helper resolution is out
// of scope in milestone-1. The call matches the helper-name pattern, so it is
// reported as an unsupported form instead of being silently ignored.
import { it } from '@jest/globals';

function expectValidUser(id: string): boolean {
  return id.length > 0;
}

it('delegates its assertion to a helper', () => {
  expectValidUser('u1');
});
