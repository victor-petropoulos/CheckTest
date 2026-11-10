// Case 02 — no assertion (empty test body).
// Plan §4 row 2: UNIT / SUCCESS / COMPLETE / assertion_count 0 KNOWN / FAIL.
//
// The scan COMPLETED and found nothing — a completed empty scan is a finding,
// not a collection gap (KickOff:72). This is the only fixture where FAIL is
// the correct verdict.
import { expect, it } from '@jest/globals';

it('runs without verifying anything', () => {
  const unused = 1 + 1;
  void unused;
});
