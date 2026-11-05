import { evaluateRule } from '../../src/core/evaluation';
import { getRule, registerRule } from '../../src/rules/registry';
import { CT_COV_001 } from '../../src/rules/ct-cov-001';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../src/core/analysis';
import { Availability, CollectionStatus, EvidenceRecord, Provenance } from '../../src/core/evidence';
import { EvaluationStatus, RuleResult } from '../../src/core/result';

interface Overrides {
  status?: AnalysisStatus;
  testType?: TestType;
  coverage?: CollectionStatus;
  availability?: Availability;
  value?: unknown;
}

function analysis(o: Overrides = {}): AnalysisOutput {
  const coverage = o.coverage ?? CollectionStatus.COMPLETE;
  const record: EvidenceRecord = {
    type: 'line_coverage',
    value: o.value,
    availability: o.availability ?? (o.value === undefined ? Availability.UNKNOWN : Availability.KNOWN),
    provenance: Provenance.EXTERNAL,
    source: 'coverage',
    collector_version: '1.0.0',
    scope: 'test-body',
    coverage: {
      status: coverage,
      supported_frameworks: [],
      supported_assertion_forms: [],
    },
  };
  return {
    subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
    analysis: {
      status: o.status ?? AnalysisStatus.SUCCESS,
      completeness: Completeness.COMPLETE,
      scope: 'test-body',
      test_type: { value: o.testType ?? TestType.UNIT, source: ClassificationSource.EXPLICIT },
    },
    evidence: { line_coverage: record },
    capabilities: { line_coverage: CapabilityStatus.AVAILABLE },
  };
}

function resultOf(overrides: Overrides): RuleResult | null {
  const { finding } = evaluateRule(CT_COV_001, analysis(overrides));
  return finding === null ? null : finding.result;
}

describe('CT-COV-001 metadata', () => {
  it('requires line_coverage, test-body scope, COMPLETE minimum, INDETERMINATE policies', () => {
    expect(CT_COV_001.required_evidence).toEqual(['line_coverage']);
    expect(CT_COV_001.analysis_scope).toBe('test-body');
    expect(CT_COV_001.minimum_evidence_completeness).toBe(CollectionStatus.COMPLETE);
    expect(CT_COV_001.unknown_evidence_policy).toBe(RuleResult.INDETERMINATE);
    expect(CT_COV_001.conflicting_evidence_policy).toBe(RuleResult.INDETERMINATE);
  });

  it('uses thresholds pass >= 1 / fail <= 0', () => {
    expect(CT_COV_001.evaluation).toEqual({ metric: 'line_coverage', pass_at_least: 1, fail_at_most: 0 });
  });

  it('severity warning, status active', () => {
    expect(CT_COV_001.severity).toBe('warning');
    expect(CT_COV_001.status).toBe('active');
  });
});

describe('CT-COV-001 verdicts', () => {
  it('PASS: line_coverage KNOWN 1', () => {
    expect(resultOf({ value: 1 })).toBe(RuleResult.PASS);
  });

  it('FAIL: line_coverage KNOWN 0 + COMPLETE', () => {
    expect(resultOf({ value: 0 })).toBe(RuleResult.FAIL);
  });

  it('INDETERMINATE: UNKNOWN availability / missing report', () => {
    expect(
      resultOf({ availability: Availability.UNKNOWN, value: undefined, coverage: CollectionStatus.UNAVAILABLE }),
    ).toBe(RuleResult.INDETERMINATE);
  });

  it('INDETERMINATE: PARTIAL coverage', () => {
    expect(resultOf({ coverage: CollectionStatus.PARTIAL, value: 0 })).toBe(RuleResult.INDETERMINATE);
    expect(resultOf({ coverage: CollectionStatus.PARTIAL, value: 1 })).toBe(RuleResult.INDETERMINATE);
  });

  it('INDETERMINATE: missing evidence record', () => {
    const a = analysis({});
    delete (a.evidence as any).line_coverage;
    const { finding } = evaluateRule(CT_COV_001, a);
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
  });

  it('never returns null on FAILED abort', () => {
    expect(resultOf({ status: AnalysisStatus.FAILED, value: 0 })).toBeNull();
  });
});

describe('registry', () => {
  it('registers and returns CT-COV-001', () => {
    registerRule(CT_COV_001);
    expect(getRule(CT_COV_001.id)).toBe(CT_COV_001);
  });
});
