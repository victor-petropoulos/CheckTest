import {
  Availability,
  CollectionStatus,
  EvidenceConflict,
  EvidenceRecord,
  EVIDENCE_SCOPE_TEST_BODY,
  Provenance,
  deriveAvailability,
  makeEvidenceRecord,
} from '../../src/core/evidence';
import { toJson, REPORT_SCHEMA_VERSION } from '../../src/reporters/json';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../src/core/analysis';
import { evaluateRule } from '../../src/core/evaluation';
import { RuleMetadata } from '../../src/core/rule';
import { EvaluationStatus } from '../../src/core/result';

const coverage = (status: CollectionStatus): EvidenceRecord['coverage'] => ({
  status,
  supported_frameworks: ['jest', 'vitest'],
  supported_assertion_forms: ['expect-to-be'],
});

const record = (over: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  type: 'assertion_count',
  value: 1,
  availability: Availability.KNOWN,
  provenance: Provenance.DIRECT,
  source: 'typescript-jest-adapter',
  collector_version: '0.1.0',
  scope: 'test-body',
  coverage: coverage(CollectionStatus.COMPLETE),
  ...over,
});

describe('enums', () => {
  it('Provenance has exactly DIRECT/DERIVED/EXTERNAL (SPEC:306-328)', () => {
    expect(Object.values(Provenance).sort()).toEqual(['DERIVED', 'DIRECT', 'EXTERNAL']);
  });

  it('Availability has exactly KNOWN/UNKNOWN/NOT_APPLICABLE (SPEC:334-360)', () => {
    expect(Object.values(Availability).sort()).toEqual(['KNOWN', 'NOT_APPLICABLE', 'UNKNOWN']);
  });

  it('CollectionStatus has exactly COMPLETE/PARTIAL/UNAVAILABLE (SPEC:421)', () => {
    expect(Object.values(CollectionStatus).sort()).toEqual(['COMPLETE', 'PARTIAL', 'UNAVAILABLE']);
  });
});

describe('deriveAvailability', () => {
  it('COMPLETE -> KNOWN', () => {
    expect(deriveAvailability(CollectionStatus.COMPLETE)).toBe(Availability.KNOWN);
  });

  it('PARTIAL -> UNKNOWN', () => {
    expect(deriveAvailability(CollectionStatus.PARTIAL)).toBe(Availability.UNKNOWN);
  });

  it('UNAVAILABLE -> UNKNOWN', () => {
    expect(deriveAvailability(CollectionStatus.UNAVAILABLE)).toBe(Availability.UNKNOWN);
  });

  it('returns NOT_APPLICABLE only when a justification is supplied', () => {
    expect(deriveAvailability(CollectionStatus.UNAVAILABLE, 'runtime io out of scope')).toBe(
      Availability.NOT_APPLICABLE,
    );
  });

  it('an empty-string justification still counts as justified (explicit, not truthy)', () => {
    expect(deriveAvailability(CollectionStatus.UNAVAILABLE, '')).toBe(Availability.NOT_APPLICABLE);
  });

  it('without justification no status yields NOT_APPLICABLE', () => {
    for (const status of Object.values(CollectionStatus)) {
      expect(deriveAvailability(status)).not.toBe(Availability.NOT_APPLICABLE);
    }
  });

  it('M1: availability follows executability, not the coverage of the whole scan', () => {
    // coverage COMPLETE (scan ran to completion) but this item was not decidable
    // -> the collector must report PARTIAL here, which maps to UNKNOWN.
    const r = record({
      availability: deriveAvailability(CollectionStatus.PARTIAL),
      coverage: coverage(CollectionStatus.PARTIAL),
      reason: 'assertion inside callback, execution not establishable',
    });
    expect(r.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(r.availability).toBe(Availability.UNKNOWN);
  });
});

describe('EvidenceRecord conflict container (A4 OPTION A)', () => {
  const conflict: EvidenceConflict = {
    value: 2,
    source: 'regex-stub-provider',
    provenance: Provenance.DERIVED,
    collector_version: '0.1.0',
  };

  it('preserves the primary value alongside conflicting values', () => {
    const r = record({ value: 1, availability: Availability.UNKNOWN, conflicts: [conflict] });
    expect(r.value).toBe(1);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts?.[0].value).toBe(2);
    expect(r.conflicts?.[0].provenance).toBe(Provenance.DERIVED);
  });

  it('conflict container has exactly value/source/provenance/collector_version', () => {
    expect(Object.keys(conflict).sort()).toEqual(['collector_version', 'provenance', 'source', 'value']);
  });

  it('conflicts stay absent when there is no disagreement', () => {
    expect(record().conflicts).toBeUndefined();
  });

  it('an empty conflicts array is distinguishable from a missing one', () => {
    expect(record({ conflicts: [] }).conflicts).toEqual([]);
  });
});

describe('DPC-4 external provenance fields', () => {
  it('fields are optional and absent by default', () => {
    const r = record();
    expect(r.provider).toBeUndefined();
    expect(r.provider_version).toBeUndefined();
    expect(r.source_revision).toBeUndefined();
  });

  it('DIRECT records do not carry provider fields', () => {
    const r = record({ provenance: Provenance.DIRECT });
    expect(r.provider).toBeUndefined();
    expect(r.provider_version).toBeUndefined();
    expect(r.source_revision).toBeUndefined();
  });

  it('DERIVED records do not carry provider fields', () => {
    const r = record({ provenance: Provenance.DERIVED });
    expect(r.provider).toBeUndefined();
    expect(r.provider_version).toBeUndefined();
    expect(r.source_revision).toBeUndefined();
  });

  it('fields present when set', () => {
    const r = record({
      provenance: Provenance.EXTERNAL,
      provider: 'coverage-tool',
      provider_version: '1.2.3',
      source_revision: 'abc123',
    });
    expect(r.provider).toBe('coverage-tool');
    expect(r.provider_version).toBe('1.2.3');
    expect(r.source_revision).toBe('abc123');
  });

  it('REPORT_SCHEMA_VERSION is 0.4', () => {
    expect(REPORT_SCHEMA_VERSION).toBe('0.4');
  });

  it('reporter emits provider fields when present', () => {
    const rec: EvidenceRecord = {
      type: 'assertion_count',
      value: 1,
      availability: Availability.KNOWN,
      provenance: Provenance.EXTERNAL,
      source: 'coverage-tool',
      collector_version: '1.2.3',
      scope: 'test-body',
      coverage: coverage(CollectionStatus.COMPLETE),
      provider: 'coverage-tool',
      provider_version: '1.2.3',
      source_revision: 'abc123',
    };
    const output: AnalysisOutput = {
      subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
      analysis: {
        status: AnalysisStatus.SUCCESS,
        completeness: Completeness.COMPLETE,
        scope: 'test-body',
        test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
      },
      evidence: { assertion_count: rec },
      capabilities: { assertion_count: CapabilityStatus.AVAILABLE },
    };
    const json = JSON.parse(
      toJson(output, {
        status: EvaluationStatus.FAILED,
        finding: { rule_id: 'r', result: 'INDETERMINATE' as never, reason: 'x', evidence: [] },
      }),
    ) as { schemaVersion: string; evidence: { assertion_count: Record<string, unknown> } };
    expect(json.evidence.assertion_count.provider).toBe('coverage-tool');
    expect(json.evidence.assertion_count.provider_version).toBe('1.2.3');
    expect(json.evidence.assertion_count.source_revision).toBe('abc123');
    expect(json.schemaVersion).toBe('0.4');
  });

  it('reporter omits provider fields when absent', () => {
    const rec: EvidenceRecord = {
      type: 'assertion_count',
      value: 1,
      availability: Availability.KNOWN,
      provenance: Provenance.DIRECT,
      source: 'test-adapter',
      collector_version: '0.0.0',
      scope: 'test-body',
      coverage: coverage(CollectionStatus.COMPLETE),
    };
    const output: AnalysisOutput = {
      subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
      analysis: {
        status: AnalysisStatus.SUCCESS,
        completeness: Completeness.COMPLETE,
        scope: 'test-body',
        test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
      },
      evidence: { assertion_count: rec },
      capabilities: { assertion_count: CapabilityStatus.AVAILABLE },
    };
    const json = JSON.parse(
      toJson(output, {
        status: EvaluationStatus.FAILED,
        finding: { rule_id: 'r', result: 'INDETERMINATE' as never, reason: 'x', evidence: [] },
      }),
    ) as { schemaVersion: string; evidence: { assertion_count: Record<string, unknown> } };
    expect(json.evidence.assertion_count.provider).toBeUndefined();
    expect(json.evidence.assertion_count.provider_version).toBeUndefined();
    expect(json.evidence.assertion_count.source_revision).toBeUndefined();
  });
});

describe('makeEvidenceRecord — provenance discrimination', () => {
  const base = {
    type: 'assertion_count',
    value: 3,
    availability: Availability.KNOWN,
    source: 'typescript-jest-adapter',
    collector_version: '0.1.0',
    coverage: {
      status: CollectionStatus.COMPLETE,
      supported_frameworks: ['jest'],
      supported_assertion_forms: ['expect'],
    },
  };

  it('DIRECT records omit provider keys entirely (not undefined-valued)', () => {
    const record = makeEvidenceRecord({ ...base, provenance: Provenance.DIRECT });
    expect(record).not.toHaveProperty('provider');
    expect(record).not.toHaveProperty('provider_version');
    expect(record).not.toHaveProperty('source_revision');
    expect(record.scope).toBe(EVIDENCE_SCOPE_TEST_BODY);
  });

  it('EXTERNAL records carry provider identity fields', () => {
    const record = makeEvidenceRecord({
      ...base,
      provenance: Provenance.EXTERNAL,
      source: 'istanbul',
      collector_version: '1.0',
      provider: 'istanbul',
      provider_version: '1.0',
      source_revision: 'abc123',
    });
    expect(record.provider).toBe('istanbul');
    expect(record.provider_version).toBe('1.0');
    expect(record.source_revision).toBe('abc123');
  });
});
