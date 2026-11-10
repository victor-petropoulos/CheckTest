import { evaluateRule } from '../../src/core/evaluation';
import { getRule, registerRule } from '../../src/rules/registry';
import { CT_MUT_001, MUTATION_THRESHOLD } from '../../src/rules/ct-mut-001';
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
  reason?: string;
}

function analysis(o: Overrides = {}): AnalysisOutput {
  const coverage = o.coverage ?? CollectionStatus.COMPLETE;
  const value = o.value;
  const record: EvidenceRecord = {
    type: 'mutation_score',
    value,
    availability: o.availability ?? (value === undefined ? Availability.UNKNOWN : Availability.KNOWN),
    provenance: Provenance.EXTERNAL,
    source: 'stryker',
    collector_version: '1.0.0',
    scope: 'test-body',
    coverage: {
      status: coverage,
      supported_frameworks: [],
      supported_assertion_forms: [],
    },
    provider: 'stryker',
    provider_version: '1.0.0',
    source_revision: 'rev',
    reason: o.reason,
  };
  return {
    subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
    analysis: {
      status: o.status ?? AnalysisStatus.SUCCESS,
      completeness: Completeness.COMPLETE,
      scope: 'test-body',
      test_type: { value: o.testType ?? TestType.UNIT, source: ClassificationSource.EXPLICIT },
    },
    evidence: { mutation_score: record },
    capabilities: { mutation_score: CapabilityStatus.AVAILABLE },
  };
}

function mutationScore(score: number): Record<string, unknown> {
  return {
    score,
    detected: Math.round(score * 10),
    valid: 10,
    killed: Math.round(score * 10),
    survived: 10 - Math.round(score * 10),
    timeout: 0,
    noCoverage: 0,
    compileError: 0,
    runtimeError: 0,
    ignored: 0,
    pending: 0,
  };
}

function resultOf(overrides: Overrides): RuleResult | null {
  const { finding } = evaluateRule(CT_MUT_001, analysis(overrides));
  return finding === null ? null : finding.result;
}

describe('CT-MUT-001 metadata', () => {
  it('requires mutation_score, test-body scope, COMPLETE minimum, INDETERMINATE policies', () => {
    expect(CT_MUT_001.required_evidence).toEqual(['mutation_score']);
    expect(CT_MUT_001.analysis_scope).toBe('test-body');
    expect(CT_MUT_001.minimum_evidence_completeness).toBe(CollectionStatus.COMPLETE);
    expect(CT_MUT_001.unknown_evidence_policy).toBe(RuleResult.INDETERMINATE);
    expect(CT_MUT_001.conflicting_evidence_policy).toBe(RuleResult.INDETERMINATE);
  });

  it('uses numeric thresholds pass > fail (inert, local decision owns step 7)', () => {
    expect(CT_MUT_001.evaluation.metric).toBe('mutation_score');
    expect(CT_MUT_001.evaluation.pass_at_least).toBeGreaterThan(CT_MUT_001.evaluation.fail_at_most);
  });

  it('severity warning, status active', () => {
    expect(CT_MUT_001.severity).toBe('warning');
    expect(CT_MUT_001.status).toBe('active');
  });

  it('fixed mutation threshold constant is 0.5', () => {
    expect(MUTATION_THRESHOLD).toBe(0.5);
  });

  it('rationale/limitations are non-empty and mention file-level + no report != zero mutants', () => {
    expect(typeof CT_MUT_001.rationale).toBe('string');
    expect((CT_MUT_001.rationale ?? '').trim()).not.toBe('');
    expect(typeof CT_MUT_001.limitations).toBe('string');
    expect((CT_MUT_001.limitations ?? '').trim()).not.toBe('');
    const blob = `${CT_MUT_001.rationale}\n${CT_MUT_001.limitations}`;
    expect(blob).toMatch(/file-level/i);
    expect(blob).toMatch(/no report/i);
    expect(blob).toMatch(/0\.5/);
  });

  it('docsUrl points at the mutation contract doc', () => {
    expect(CT_MUT_001.docsUrl).toBe('docs/rules/ct-mut-001-contract.md');
  });
});

describe('CT-MUT-001 verdicts (active: file-level mutation score, threshold 0.5)', () => {
  it('active: score 1 -> PASS', () => {
    expect(resultOf({ value: mutationScore(1) })).toBe(RuleResult.PASS);
  });

  it('active: score 0.4 -> FAIL', () => {
    expect(resultOf({ value: mutationScore(0.4) })).toBe(RuleResult.FAIL);
  });

  it('active: score exactly 0.5 -> PASS', () => {
    expect(resultOf({ value: mutationScore(0.5) })).toBe(RuleResult.PASS);
  });

  it('active: UNKNOWN availability (provider missing report) -> INDETERMINATE', () => {
    expect(
      resultOf({
        availability: Availability.UNKNOWN,
        value: undefined,
        coverage: CollectionStatus.UNAVAILABLE,
        reason: 'unable to read mutation report: ENOENT',
      }),
    ).toBe(RuleResult.INDETERMINATE);
  });

  it('active: zero-valid-mutants provider record -> INDETERMINATE', () => {
    expect(
      resultOf({
        availability: Availability.UNKNOWN,
        value: undefined,
        coverage: CollectionStatus.UNAVAILABLE,
        reason: 'no valid mutants (ignored/pending/error only); mutation score not computable',
      }),
    ).toBe(RuleResult.INDETERMINATE);
  });

  it('active: missing mutation_score evidence record -> INDETERMINATE', () => {
    const a = analysis({});
    delete (a.evidence as any).mutation_score;
    const { finding, status } = evaluateRule(CT_MUT_001, a);
    expect(status).toBe(EvaluationStatus.EVALUATED);
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason ?? '').toContain('absent');
  });

  it('active: PARTIAL coverage -> INDETERMINATE', () => {
    expect(resultOf({ coverage: CollectionStatus.PARTIAL, value: mutationScore(1) })).toBe(RuleResult.INDETERMINATE);
    expect(resultOf({ coverage: CollectionStatus.PARTIAL, value: mutationScore(0.4) })).toBe(RuleResult.INDETERMINATE);
  });

  it('active: FAILED abort -> no finding', () => {
    expect(resultOf({ status: AnalysisStatus.FAILED, value: mutationScore(0) })).toBeNull();
  });

  it('active: complete FAIL-worthy score (0, COMPLETE) -> FAIL finding', () => {
    const evaluation = evaluateRule(CT_MUT_001, analysis({ value: mutationScore(0) }));
    expect(evaluation.status).toBe(EvaluationStatus.EVALUATED);
    expect(evaluation.finding?.result).toBe(RuleResult.FAIL);
  });

  it('active: score below threshold provider KNOWN COMPLETE -> FAIL', () => {
    expect(resultOf({ value: mutationScore(0.3) })).toBe(RuleResult.FAIL);
  });
});

describe('registry', () => {
  it('registers and returns CT-MUT-001', () => {
    registerRule(CT_MUT_001);
    expect(getRule(CT_MUT_001.id)).toBe(CT_MUT_001);
  });
});

describe('no report != zero mutants (engine guard preserved)', () => {
  it('absent mutation_score never yields FAIL via numeric path', () => {
    const a = analysis({});
    delete (a.evidence as any).mutation_score;
    const { finding } = evaluateRule(CT_MUT_001, a);
    expect(finding?.result).not.toBe(RuleResult.FAIL);
  });
});
