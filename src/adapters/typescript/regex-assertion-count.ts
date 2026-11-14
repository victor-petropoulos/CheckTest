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
  EvidenceStrength,
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
 * The two facts the AST collector already holds about one collected assertion:
 * the form `classifyForm` recognized (`null` = unclassifiable) and whether the
 * body walk established that it executes (`established`).
 */
export interface StrengthHint {
  form: string | null;
  established: boolean;
}

/**
 * D10 — strength hint for one `assertion_count` record, derived from the
 * findings it aggregates. Language-specific interpretation lives here, in the
 * adapter (roadmap §280); core only names the axis.
 *
 * The WEAKEST finding decides, so a record never claims more than its least
 * established assertion: an unclassifiable form (UNSUPPORTED) outranks a
 * classified-but-unestablished one (SYNTAX_OBSERVED), which outranks a
 * straight-line one (EXECUTION_ESTABLISHED). A scan that found nothing is
 * EXECUTION_ESTABLISHED — its value 0 is definite and no assertion is left
 * unestablished under it.
 *
 * Strength is orthogonal to availability: this never turns an UNKNOWN value
 * into a KNOWN one.
 */
export function classifyFormStrength(findings: readonly StrengthHint[]): EvidenceStrength {
  if (findings.some((finding) => finding.form === null)) {
    return EvidenceStrength.UNSUPPORTED;
  }
  if (findings.some((finding) => !finding.established)) {
    return EvidenceStrength.SYNTAX_OBSERVED;
  }
  return EvidenceStrength.EXECUTION_ESTABLISHED;
}

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
    // D10 — a raw text scan classifies no form at all.
    evidenceStrength: EvidenceStrength.UNSUPPORTED,
  });
}
