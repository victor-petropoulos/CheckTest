// Case 17 — failed multi-test: two tests + a syntax error.
// Plan §4 row F4: FAILED file → every per-test entry is FAILED, none EVALUATED.
//
// INPUT to collectAnalysis / the CLI — deliberately unparseable.
import { expect, it } from '@jest/globals';

it('first test', () => {
  expect(1).toBe(1);
});

it('second test', () => {
  const x = ;
});
