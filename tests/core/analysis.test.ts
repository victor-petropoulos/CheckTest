import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestScopeResult,
  TestType,
} from '../../src/core/analysis';
import { Availability, CollectionStatus, EvidenceRecord, Provenance } from '../../src/core/evidence';
import { RuleFinding, RuleResult } from '../../src/core/result';
import { RuleMetadata } from '../../src/core/rule';

const assertionCount: EvidenceRecord = {
  type: 'assertion_count',
  value: 2,
  availability: Availability.KNOWN,
  provenance: Provenance.DIRECT,
  source: 'typescript-jest-adapter',
  collector_version: '0.1.0',
  scope: 'test-body',
  coverage: {
    status: CollectionStatus.COMPLETE,
    supported_frameworks: ['jest', 'vitest'],
    supported_assertion_forms: ['expect-to-be'],
  },
};

const output = (over: Partial<AnalysisOutput> = {}): AnalysisOutput => ({
  subject: {
    id: 'discount.calculates_discount',
    name: 'calculates_discount',
    file: 'discount.test.ts',
    language: 'typescript',
    framework: 'jest',
    type: TestType.UNIT,
  },
  analysis: {
    status: AnalysisStatus.SUCCESS,
    completeness: Completeness.COMPLETE,
    scope: 'test-body',
    test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
  },
  evidence: { assertion_count: assertionCount },
  capabilities: { typescript: CapabilityStatus.AVAILABLE },
  ...over,
});

describe('enums', () => {
  it('AnalysisStatus has exactly SUCCESS/UNSUPPORTED/FAILED (SPEC:370-374)', () => {
    expect(Object.values(AnalysisStatus).sort()).toEqual(['FAILED', 'SUCCESS', 'UNSUPPORTED']);
  });

  it('Completeness has exactly COMPLETE/INCOMPLETE/NOT_APPLICABLE (SPEC:376-380)', () => {
    expect(Object.values(Completeness).sort()).toEqual(['COMPLETE', 'INCOMPLETE', 'NOT_APPLICABLE']);
  });

  it('TestType has the 5 concrete types plus UNKNOWN (SPEC:441-448)', () => {
    expect(Object.values(TestType).sort()).toEqual(['COMPONENT', 'CONTRACT', 'E2E', 'INTEGRATION', 'UNIT', 'UNKNOWN']);
  });

  it('ClassificationSource has exactly EXPLICIT/INFERRED/DEFAULT (SPEC:450-458)', () => {
    expect(Object.values(ClassificationSource).sort()).toEqual(['DEFAULT', 'EXPLICIT', 'INFERRED']);
  });

  it('CapabilityStatus has exactly AVAILABLE/PARTIAL/UNAVAILABLE (SPEC:395-399)', () => {
    expect(Object.values(CapabilityStatus).sort()).toEqual(['AVAILABLE', 'PARTIAL', 'UNAVAILABLE']);
  });

  it('RuleResult has 4 values with N_A serialized as "N/A" (SPEC:15-20)', () => {
    expect(Object.values(RuleResult).sort()).toEqual(['FAIL', 'INDETERMINATE', 'N/A', 'PASS']);
    expect(RuleResult.N_A).toBe('N/A');
  });
});

describe('AnalysisOutput envelope', () => {
  it('carries exactly subject/analysis/evidence/capabilities', () => {
    expect(Object.keys(output()).sort()).toEqual(['analysis', 'capabilities', 'evidence', 'subject']);
  });

  it('analysis block carries status, completeness, scope, test_type separately (SPEC:366)', () => {
    const keys = Object.keys(output().analysis).sort();
    expect(keys).toEqual(['completeness', 'scope', 'status', 'test_type']);
  });

  it('a SUCCESS+INCOMPLETE analysis is representable (a successful scan may be incomplete, SPEC:382)', () => {
    const o = output({
      analysis: {
        status: AnalysisStatus.SUCCESS,
        completeness: Completeness.INCOMPLETE,
        scope: 'test-body',
        test_type: { value: TestType.UNIT, source: ClassificationSource.DEFAULT },
      },
    });
    expect(o.analysis.status).toBe(AnalysisStatus.SUCCESS);
    expect(o.analysis.completeness).toBe(Completeness.INCOMPLETE);
  });

  it('FAILED is representable independently of evidence presence', () => {
    const o = output({ analysis: { ...output().analysis, status: AnalysisStatus.FAILED } });
    expect(o.analysis.status).toBe(AnalysisStatus.FAILED);
    expect(Object.keys(o.evidence)).toEqual(['assertion_count']);
  });

  it('evidence is keyed by evidence type id', () => {
    expect(Object.keys(output().evidence)).toEqual(['assertion_count']);
  });
});

describe('TestScopeResult + AnalysisOutput.tests (plan task 1)', () => {
  const scope: TestScopeResult = {
    test: { id: 'discount.test.ts#it@2', name: 'calculates_discount', line: 2, declaration: 'it' },
    analysis: {
      status: AnalysisStatus.SUCCESS,
      completeness: Completeness.COMPLETE,
      scope: 'test-body',
      test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
    },
    evidence: { assertion_count: assertionCount },
    declaration_gap: null,
  };

  it('TestScopeResult carries exactly test/analysis/evidence/declaration_gap', () => {
    expect(Object.keys(scope).sort()).toEqual(['analysis', 'declaration_gap', 'evidence', 'test']);
    expect(Object.keys(scope.test).sort()).toEqual(['declaration', 'id', 'line', 'name']);
  });

  it('declaration_gap distinguishes a gap (string) from a fully scanned test (null)', () => {
    expect(scope.declaration_gap).toBeNull();
    const gapped: TestScopeResult = { ...scope, declaration_gap: "'it.todo' declares no executable test body" };
    expect(typeof gapped.declaration_gap).toBe('string');
  });

  it('tests is OPTIONAL: an envelope without it keeps the original four keys', () => {
    expect(output().tests).toBeUndefined();
    expect(Object.keys(output()).sort()).toEqual(['analysis', 'capabilities', 'evidence', 'subject']);
  });

  it('an envelope WITH per-test records appends tests after the original keys', () => {
    const o = output({ tests: [scope] });
    expect(Object.keys(o)).toEqual(['subject', 'analysis', 'evidence', 'capabilities', 'tests']);
    expect(o.tests).toHaveLength(1);
    expect(o.tests![0].test.id).toBe('discount.test.ts#it@2');
  });
});

describe('RuleFinding + RuleMetadata (M2)', () => {
  const finding: RuleFinding = {
    rule_id: 'CT-INT-001',
    result: RuleResult.INDETERMINATE,
    reason: 'conflicting evidence for assertion_count',
    evidence: ['assertion_count'],
  };

  it('finding carries rule_id, result, reason and consulted evidence', () => {
    expect(Object.keys(finding).sort()).toEqual(['evidence', 'reason', 'result', 'rule_id']);
  });

  it('RuleMetadata is importable from core and shape-checks', () => {
    const meta: RuleMetadata = {
      id: 'CT-INT-001',
      name: 'assertion-required',
      category: 'integrity',
      description: 'A test should contain at least one executable verification.',
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
    expect(meta.id).toBe(finding.rule_id);
    expect(meta.evaluation.pass_at_least).toBeGreaterThan(meta.evaluation.fail_at_most);
  });

  it('applies_to holds concrete types only — UNKNOWN is never a member', () => {
    const meta: RuleMetadata = {
      id: 'X',
      name: 'x',
      category: 'integrity',
      description: 'x',
      applies_to: [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION],
      required_evidence: ['assertion_count'],
      analysis_scope: 'test-body',
      minimum_evidence_completeness: CollectionStatus.COMPLETE,
      unknown_evidence_policy: RuleResult.INDETERMINATE,
      conflicting_evidence_policy: RuleResult.INDETERMINATE,
      evaluation: { metric: 'assertion_count', pass_at_least: 1, fail_at_most: 0 },
      severity: 'warning',
      status: 'draft',
    };
    expect(meta.applies_to).not.toContain(TestType.UNKNOWN);
  });
});
