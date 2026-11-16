/**
 * Self-contained finding fields (plan task 6.1).
 *
 * A finding must carry the rule's own documentation (description, rationale,
 * limitations, docsUrl) and the strength of the evidence its verdict rests on
 * (evidenceStrength, D10), so a consumer reading a report never has to resolve
 * the rule registry and never overreads a verdict.
 *
 * Two rules of the copy, both asserted here:
 *   - COPIED, never invented: a key the rule does not declare is OMITTED, and a
 *     record with no strength leaves evidenceStrength ABSENT (never a default).
 *   - The strength belongs to the record the verdict was decided FROM: a
 *     verdict that rests on no record (N/A, applicability) carries none.
 */

import { evaluateRule } from '../../src/core/evaluation';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../src/core/analysis';
import { Availability, CollectionStatus, EvidenceRecord, EvidenceStrength, Provenance } from '../../src/core/evidence';
import { RuleResult } from '../../src/core/result';
import { RuleMetadata } from '../../src/core/rule';

const BASE: RuleMetadata = {
  id: 'CT-TEST-000',
  name: 'engine-test-rule',
  category: 'integrity',
  description: 'Synthetic rule used only to prove the self-contained finding.',
  applies_to: [TestType.UNIT],
  required_evidence: ['assertion_count'],
  analysis_scope: 'test-body',
  minimum_evidence_completeness: CollectionStatus.COMPLETE,
  unknown_evidence_policy: RuleResult.INDETERMINATE,
  conflicting_evidence_policy: RuleResult.INDETERMINATE,
  evaluation: { metric: 'assertion_count', pass_at_least: 1, fail_at_most: 0 },
  severity: 'error',
  status: 'active',
};

/** The same rule, with the three advisory metadata fields filled in. */
const DOCUMENTED: RuleMetadata = {
  ...BASE,
  rationale: 'WHY the rule exists.',
  limitations: 'What the verdict does NOT establish.',
  docsUrl: 'https://example.invalid/rules/CT-TEST-000',
};

function record(strength?: EvidenceStrength): EvidenceRecord {
  return {
    type: 'assertion_count',
    value: 3,
    availability: Availability.KNOWN,
    provenance: Provenance.DIRECT,
    source: 'test-adapter',
    collector_version: '0.0.0',
    scope: 'test-body',
    coverage: {
      status: CollectionStatus.COMPLETE,
      supported_frameworks: ['jest'],
      supported_assertion_forms: ['expect-to-be'],
    },
    ...(strength === undefined ? {} : { evidenceStrength: strength }),
  };
}

function envelope(strength?: EvidenceStrength): AnalysisOutput {
  return {
    subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
    analysis: {
      status: AnalysisStatus.SUCCESS,
      completeness: Completeness.COMPLETE,
      scope: 'test-body',
      test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
    },
    evidence: { assertion_count: record(strength) },
    capabilities: { assertion_count: CapabilityStatus.AVAILABLE },
  };
}

describe('finding carries the rule metadata (6.1)', () => {
  it('copies description/rationale/limitations/docsUrl from the rule metadata', () => {
    const { finding } = evaluateRule(DOCUMENTED, envelope());
    expect(finding?.description).toBe(DOCUMENTED.description);
    expect(finding?.rationale).toBe(DOCUMENTED.rationale);
    expect(finding?.limitations).toBe(DOCUMENTED.limitations);
    expect(finding?.docsUrl).toBe(DOCUMENTED.docsUrl);
  });

  it('omits the metadata keys the rule does not declare (never an empty string)', () => {
    const { finding } = evaluateRule(BASE, envelope());
    expect(finding?.description).toBe(BASE.description);
    expect(finding && 'rationale' in finding).toBe(false);
    expect(finding && 'limitations' in finding).toBe(false);
    expect(finding && 'docsUrl' in finding).toBe(false);
  });
});

describe('finding carries the evidence strength (6.1, D10)', () => {
  it('copies evidenceStrength from the record the verdict rests on', () => {
    const { finding } = evaluateRule(DOCUMENTED, envelope(EvidenceStrength.EXECUTION_ESTABLISHED));
    expect(finding?.evidenceStrength).toBe(EvidenceStrength.EXECUTION_ESTABLISHED);
  });

  it('leaves evidenceStrength absent when the record carries none (never fabricated)', () => {
    const { finding } = evaluateRule(DOCUMENTED, envelope());
    expect(finding && 'evidenceStrength' in finding).toBe(false);
  });

  it('leaves evidenceStrength absent for a verdict that rests on no record (N/A)', () => {
    const inapplicable: RuleMetadata = { ...DOCUMENTED, applies_to: [TestType.COMPONENT] };
    const { finding } = evaluateRule(inapplicable, envelope(EvidenceStrength.EXECUTION_ESTABLISHED));
    expect(finding?.result).toBe(RuleResult.N_A);
    expect(finding && 'evidenceStrength' in finding).toBe(false);
    expect(finding?.description).toBe(DOCUMENTED.description);
  });
});
