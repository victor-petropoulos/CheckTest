/**
 * CT-INT-001 + registry tests (plan task 4).
 *
 * CT-INT-001 applies to ALL five concrete test types, so it can never produce
 * N/A — the N/A path is exercised by the CT-DEMO-001 stub against a COMPONENT
 * test (plan A2 OPTION A, fixture case-14).
 */

import { evaluateRule } from '../../src/core/evaluation';
import { getRule, registerRule } from '../../src/rules/registry';
import { CT_INT_001 } from '../../src/rules/ct-int-001';
import { CT_DEMO_001 } from '../../src/rules/ct-demo-001';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../src/core/analysis';
import { Availability, CollectionStatus, EvidenceConflict, EvidenceRecord, Provenance } from '../../src/core/evidence';
import { EvaluationStatus, RuleResult } from '../../src/core/result';

interface Overrides {
  status?: AnalysisStatus;
  testType?: TestType;
  coverage?: CollectionStatus;
  availability?: Availability;
  value?: unknown;
  conflicts?: EvidenceConflict[];
}

function analysis(o: Overrides = {}): AnalysisOutput {
  const coverage = o.coverage ?? CollectionStatus.COMPLETE;
  const record: EvidenceRecord = {
    type: 'assertion_count',
    value: o.value ?? 1,
    availability: o.availability ?? Availability.KNOWN,
    provenance: Provenance.DIRECT,
    source: 'test-adapter',
    collector_version: '0.0.0',
    scope: 'test-body',
    coverage: {
      status: coverage,
      supported_frameworks: ['jest', 'vitest'],
      supported_assertion_forms: ['expect-to-be'],
    },
    conflicts: o.conflicts,
  };
  return {
    subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
    analysis: {
      status: o.status ?? AnalysisStatus.SUCCESS,
      completeness: Completeness.COMPLETE,
      scope: 'test-body',
      test_type: { value: o.testType ?? TestType.UNIT, source: ClassificationSource.EXPLICIT },
    },
    evidence: { assertion_count: record },
    capabilities: { assertion_count: CapabilityStatus.AVAILABLE },
  };
}

function resultOf(overrides: Overrides): RuleResult | null {
  const { finding } = evaluateRule(CT_INT_001, analysis(overrides));
  return finding === null ? null : finding.result;
}

describe('CT-INT-001 metadata', () => {
  it('applies to all five concrete test types and never to UNKNOWN', () => {
    expect([...CT_INT_001.applies_to].sort()).toEqual(
      [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION, TestType.CONTRACT, TestType.E2E].sort(),
    );
    expect(CT_INT_001.applies_to).not.toContain(TestType.UNKNOWN);
  });

  it('requires assertion_count, test-body scope, COMPLETE minimum and INDETERMINATE policies', () => {
    expect(CT_INT_001.required_evidence).toEqual(['assertion_count']);
    expect(CT_INT_001.analysis_scope).toBe('test-body');
    expect(CT_INT_001.minimum_evidence_completeness).toBe(CollectionStatus.COMPLETE);
    expect(CT_INT_001.unknown_evidence_policy).toBe(RuleResult.INDETERMINATE);
    expect(CT_INT_001.conflicting_evidence_policy).toBe(RuleResult.INDETERMINATE);
  });

  it('uses the numeric thresholds pass >= 1 / fail <= 0 (SPEC:509-514)', () => {
    expect(CT_INT_001.evaluation).toEqual({
      metric: 'assertion_count',
      pass_at_least: 1,
      fail_at_most: 0,
    });
  });

  it('severity is error and status is active — see file header for the SPEC mapping', () => {
    expect(CT_INT_001.severity).toBe('error');
    expect(CT_INT_001.status).toBe('active');
  });

  it('is deterministic: identical input → identical finding', () => {
    const input = analysis({ value: 4 });
    expect(evaluateRule(CT_INT_001, input)).toEqual(evaluateRule(CT_INT_001, input));
  });
});

describe('CT-INT-001 verdicts', () => {
  it('PASS: one established assertion', () => {
    expect(resultOf({ value: 1 })).toBe(RuleResult.PASS);
  });

  it('PASS: several established assertions', () => {
    expect(resultOf({ value: 5 })).toBe(RuleResult.PASS);
  });

  it('FAIL: complete collection, zero assertions', () => {
    expect(resultOf({ value: 0 })).toBe(RuleResult.FAIL);
  });

  it('INDETERMINATE: incomplete evidence (coverage PARTIAL) — never FAIL on an unproved zero', () => {
    expect(resultOf({ coverage: CollectionStatus.PARTIAL, value: 0 })).toBe(RuleResult.INDETERMINATE);
  });

  it('INDETERMINATE: unsupported framework (status UNSUPPORTED)', () => {
    expect(resultOf({ status: AnalysisStatus.UNSUPPORTED, value: 0 })).toBe(RuleResult.INDETERMINATE);
  });

  it('INDETERMINATE: unknown availability (unestablished executability)', () => {
    expect(resultOf({ availability: Availability.UNKNOWN, value: 0 })).toBe(RuleResult.INDETERMINATE);
  });

  it('INDETERMINATE: conflicting evidence', () => {
    const conflicts: EvidenceConflict[] = [
      { value: 2, source: 'regex-stub', provenance: Provenance.DERIVED, collector_version: '0.0.0' },
    ];
    expect(resultOf({ conflicts, value: 1 })).toBe(RuleResult.INDETERMINATE);
  });

  it('INDETERMINATE: unknown test type (plan A3 — classification is never inferred)', () => {
    expect(resultOf({ testType: TestType.UNKNOWN, value: 1 })).toBe(RuleResult.INDETERMINATE);
  });

  it('never returns null: FAILED is the only null path and lives in the engine', () => {
    expect(resultOf({ status: AnalysisStatus.FAILED, value: 0 })).toBeNull();
  });

  it('applies — not N/A — to every concrete test type', () => {
    for (const testType of [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION, TestType.CONTRACT, TestType.E2E]) {
      expect(resultOf({ testType, value: 1 })).toBe(RuleResult.PASS);
    }
  });
});

describe('CT-DEMO-001 stub — the N/A path (plan A2 OPTION A)', () => {
  it('applies_to UNIT only', () => {
    expect(CT_DEMO_001.applies_to).toEqual([TestType.UNIT]);
  });

  it('returns N/A against a COMPONENT test', () => {
    const { finding } = evaluateRule(CT_DEMO_001, analysis({ testType: TestType.COMPONENT, value: 1 }));
    expect(finding?.result).toBe(RuleResult.N_A);
    expect(finding?.reason).toContain('applicability');
  });

  it('evaluates normally against a UNIT test', () => {
    const { finding } = evaluateRule(CT_DEMO_001, analysis({ testType: TestType.UNIT, value: 1 }));
    expect(finding?.result).toBe(RuleResult.PASS);
  });

  it('FAILED abort beats N/A: a FAILED analysis never yields a verdict (plan task 4, D2)', () => {
    const evaluation = evaluateRule(CT_DEMO_001, analysis({ testType: TestType.E2E, status: AnalysisStatus.FAILED }));
    // Pre-fix ("applicability is step 1") this returned EVALUATED/N/A. SPEC:374/405:
    // the engine aborts BEFORE rule evaluation, so no applicability verdict may
    // stand in for the abort; the failed scan stays visible on analysisStatus.
    expect(evaluation.finding).toBeNull();
    expect(evaluation.status).toBe(EvaluationStatus.FAILED);
  });
});

describe('registry', () => {
  it('registers and returns rules by id', () => {
    registerRule(CT_INT_001);
    registerRule(CT_DEMO_001);
    expect(getRule(CT_INT_001.id)).toBe(CT_INT_001);
    expect(getRule(CT_DEMO_001.id)).toBe(CT_DEMO_001);
  });

  it('returns undefined for an unregistered id', () => {
    expect(getRule('CT-NOPE-999')).toBeUndefined();
  });

  it('re-registering an id replaces the entry rather than duplicating it', () => {
    registerRule(CT_INT_001);
    const replacement = { ...CT_INT_001, name: 'assertion-required-v2' };
    registerRule(replacement);
    expect(getRule(CT_INT_001.id)?.name).toBe('assertion-required-v2');
  });
});
