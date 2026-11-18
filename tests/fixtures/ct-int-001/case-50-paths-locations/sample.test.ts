// Case 50 — paths/locations (adversarial, Phase 1d).
//
// The evidence record must attribute its verdict to the exact source position
// it came from: `location {file, line}` is populated from the FIRST finding the
// scan classified (collector.ts:356-359), never fabricated. Here the single
// assertion sits on the declaration body's line; the projected sidecar pins
// that the record carries a location naming this fixture file and the
// assertion's 1-based line (docs/limitations.md "Rule finding locations").
import { expect, it } from '@jest/globals';

it('asserts on a known line', () => {
  expect(1 + 1).toBe(2);
});
