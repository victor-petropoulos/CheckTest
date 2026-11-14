/**
 * Python/pytest adapter — capability vocabulary (Phase 8 task C4).
 *
 * Mirrors the TypeScript adapter's leaf-module pattern
 * (src/adapters/typescript/capabilities.ts): this file is the ONLY owner of
 * what the python adapter CLAIMS to recognize — the framework allowlist and
 * the recognized assertion-form IDs. It is a LEAF module (zero imports) so
 * the vocabulary can be referenced from `support.ts` (re-export site kept for
 * the existing importers) and from `adapter.ts` (the formal Adapter contract
 * instance) without a require cycle — exactly one definition, wired by
 * reference everywhere else.
 *
 * Data only: no adapter module evaluates rules, and core imports none of this
 * vocabulary.
 */

/** A9 mirror — frameworks the python adapter claims to recognize. */
export const SUPPORTED_FRAMEWORKS: readonly string[] = ['pytest', 'unittest'];

/**
 * A9 mirror — assertion forms the collector detects. `pytest.raises` is an
 * exception-context helper (with-block / call form), included as one form.
 */
export const SUPPORTED_ASSERTION_FORMS: readonly string[] = [
  'assert',
  'pytest.raises',
  'self.assertEqual',
  'self.assertTrue',
  'self.assertFalse',
  'self.assertIsNone',
  'self.assertRaises',
  'self.assertIn',
  'self.assertAlmostEqual',
];
