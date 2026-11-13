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

/** A9 — the recognized assertion form IDs (KickOff:84-90; expanded to 11 in B3). */
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
];
