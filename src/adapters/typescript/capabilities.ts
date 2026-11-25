/**
 * TypeScript/Jest adapter — capability vocabulary (task 12, ruling #11).
 *
 * The ONLY owner of what this adapter CLAIMS to recognize: the framework
 * allowlist and the recognized assertion-form IDs. It is a LEAF module (zero
 * imports) so the vocabulary can be referenced from `support.ts` (re-export
 * site kept for the existing importers) and from `adapter.ts` (the formal
 * Adapter contract instance) without a require cycle — and so there is exactly
 * one definition, wired by reference everywhere else (task 12 ruling #2:
 * "wire by reference not duplication").
 *
 * This file contains data only: no adapter module evaluates rules, and the
 * core (src/core) imports none of this vocabulary (ruling #11: core knows zero
 * frameworks).
 */

/** A9 — framework allowlist. Anything else is UNSUPPORTED (plan task 3). */
export const SUPPORTED_FRAMEWORKS: readonly string[] = ['jest', 'vitest', 'mocha'];

/**
 * A9 — the recognized assertion form IDs (KickOff:84-90; expanded to 11 in B3;
 * +17 in the dogfood-gap-closure matcher expansion, council FROZEN FORM SET
 * 2026-11-22: 11 plain + 6 negated = 28; +2 supertest HTTP forms, C2 council
 * 2026-11-22: 30 total).
 */
export const SUPPORTED_ASSERTION_FORMS: readonly string[] = [
  'expect-to-be',
  'expect-to-equal',
  'expect-to-be-truthy',
  'expect-to-be-falsy',
  'expect-to-throw',
  'expect-rejects-to-throw',
  'expect-to-match-snapshot',
  'expect-to-contain',
  'expect-matcher-utils',
  'expect-to-match-object',
  'expect-to-have-been-called-times',
  'expect-to-be-undefined',
  'expect-to-have-property',
  'expect-to-be-defined',
  'expect-to-have-length',
  'expect-to-be-greater-than',
  'expect-to-be-null',
  'expect-to-match',
  'expect-to-have-been-called',
  'expect-to-have-been-called-with',
  'expect-to-match-inline-snapshot',
  'expect-to-be-greater-than-or-equal',
  // Open item #1 — newly recognized matchers (batch 1).
  'expect-to-be-less-than',
  'expect-to-be-less-than-or-equal',
  'expect-to-be-close-to',
  'expect-to-be-instance-of',
  'expect-to-strict-equal',
  'expect-to-be-type-of',
  'expect-to-have-been-last-called-with',
  'expect-to-have-been-nth-called-with',
  'expect-not-to-be-less-than',
  'expect-not-to-be-less-than-or-equal',
  'expect-not-to-be-close-to',
  'expect-not-to-be-instance-of',
  'expect-not-to-strict-equal',
  'expect-not-to-be-type-of',
  'expect-not-to-have-been-called',
  'expect-not-to-be',
  'expect-not-to-contain',
  'expect-not-to-have-property',
  'expect-not-to-be-null',
  'expect-not-to-throw',
  'supertest-expect-status',
  'supertest-expect-body',
];
