/**
 * M3 OPTION i — shipped regex-based STUB evidence provider.
 *
 * Purpose: fixture 13 (conflicting evidence). The AST collector is DIRECT and
 * ignores comments; this provider is DERIVED and counts raw `expect(` text
 * occurrences, so it disagrees by exactly the assertions written inside
 * comments/strings. That disagreement is the point — the conflict must be
 * preserved with both values and both provenances (A4 OPTION A, KickOff:132).
 *
 * STUB — not a real analyzer. It has no syntax awareness, cannot establish
 * executability, and must never be preferred over the AST collector. It exists
 * only so the conflict path is reachable deterministically in tests.
 */

import {
  CollectionStatus,
  EVIDENCE_SCOPE_TEST_BODY,
  EvidenceRecord,
  Provenance,
  deriveAvailability,
  makeEvidenceRecord,
} from '../../core/evidence';
import {
  ANALYSIS_SCOPE,
  COLLECTOR_VERSION,
  EVIDENCE_ASSERTION_COUNT,
  SUPPORTED_ASSERTION_FORMS,
  SUPPORTED_FRAMEWORKS,
} from './support';

/** Source id for this provider — distinct so a conflict is attributable. */
export const REGEX_STUB_SOURCE = 'typescript-jest-regex-stub';

/**
 * A text scan cannot classify a construct or establish that it executes, so the
 * stub self-reports PARTIAL / UNKNOWN rather than claiming COMPLETE / KNOWN.
 * Over-claiming here would let a naive count pass for authoritative evidence.
 */
const STUB_COVERAGE = CollectionStatus.PARTIAL;

const EXPECT_CALL = /\bexpect\s*\(/g;

/**
 * Count raw `expect(` occurrences in the source text, comments and strings
 * included. Deterministic: no clock, no randomness, pure string scan.
 */
export function regexAssertionCount(sourceText: string): EvidenceRecord {
  const matches = sourceText.match(EXPECT_CALL);
  return makeEvidenceRecord({
    type: EVIDENCE_ASSERTION_COUNT,
    value: matches === null ? 0 : matches.length,
    availability: deriveAvailability(STUB_COVERAGE),
    provenance: Provenance.DERIVED,
    source: REGEX_STUB_SOURCE,
    collector_version: COLLECTOR_VERSION,
    scope: ANALYSIS_SCOPE,
    coverage: {
      status: STUB_COVERAGE,
      supported_frameworks: [...SUPPORTED_FRAMEWORKS],
      supported_assertion_forms: [...SUPPORTED_ASSERTION_FORMS],
    },
    reason: 'stub regex provider: counts expect( text occurrences including comments and strings',
  });
}
