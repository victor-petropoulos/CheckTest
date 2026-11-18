// Case 45 — helper indirection (adversarial, Phase 1d).
//
// The test delegates its only verification to a custom assertion helper
// (`expectValidUser`) and makes no direct assertion of its own. A1: cross-file
// and in-file helper resolution is out of scope (docs/limitations.md §2) — the
// helper call matches the custom-helper name pattern and is recorded with a
// reason (collector.ts:733-742). Nothing is silently dropped, so a zero from
// this scan is never read as a proved zero-assertion FAIL (KickOff:72):
// coverage PARTIAL, completeness INCOMPLETE, CT-INT-001 INDETERMINATE.
import { it } from '@jest/globals';

function expectValidUser(id: string): boolean {
  return id.length > 0;
}

it('delegates its only verification to a helper', () => {
  expectValidUser('u1');
});
