// Case 06 — async assertion (`await expect(p).rejects.toThrow()`).
// Plan §4 row 6: UNIT / SUCCESS / COMPLETE / assertion_count 1 KNOWN / PASS.
//
// The `rejects.toThrow` chain is one of the 7 supported form IDs (A9), so it is
// established in a straight-line body and counts like any other assertion.
import { expect, it } from '@jest/globals';

it('rejects for a missing id', async () => {
  await expect(Promise.reject(new Error('missing id'))).rejects.toThrow('missing id');
});
