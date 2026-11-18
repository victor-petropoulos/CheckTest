// Case 49 — skipped/modifier declarations (adversarial, Phase 1d).
//
// `it.skip` and `it.only` are modifier forms: the collector recognizes them as
// declarations but does NOT model how often their bodies run, so every
// assertion inside is gated (collector.ts:660-668) and the declaration carries
// an unsupported-form gap (support.ts:768-770). Per-declaration records report
// NO value with availability UNKNOWN (collector.ts:406-413) — a skipped body
// is never read as a proved zero-assertion FAIL (docs/limitations.md §11, §20).
import { expect, it } from '@jest/globals';

it.skip('skipped', () => {
  expect(1 + 1).toBe(2);
});

it.only('only', () => {
  expect(2 + 2).toBe(4);
});
