/**
 * Engine tests (plan task 4).
 *
 * Two jobs:
 *   1. each guard in the fixed FAILED-first order fires for its own condition;
 *   2. ORDER — where two guards both apply, the EARLIER one wins. Each order
 *      test builds an analysis that violates two guards at once and asserts
 *      which guard's reason came back.
 *
 * The order is the 7-step FAILED-first one (evaluation.ts module docstring):
 * step 0 FAILED abort → 1 UNKNOWN type → 2 applicability → 3 UNSUPPORTED →
 * 4 completeness → 5 availability → 6 conflicts → 7 numeric. Step 0 comes
 * FIRST (plan task 4, D2): SPEC:374/405 abort before rule evaluation, so no
 * applicability N/A or UNKNOWN-type INDETERMINATE may stand in for a FAILED
 * analysis.
 *
 * Analysis envelopes are hand-built: the engine consumes normalized evidence
 * only, so these tests never touch the adapter or the filesystem.
 */

import { evaluateRule, evaluateTests, requiresCompleteForNegativeVerdict } from '../../src/core/evaluation';
import { registerRule, allRules } from '../../src/rules/registry';
import { CT_INT_001 } from '../../src/rules/ct-int-001';
import { CT_INT_003 } from '../../src/rules/ct-int-003';
import { CT_INT_004 } from '../../src/rules/ct-int-004';
import { CT_COV_001 } from '../../src/rules/ct-cov-001';
import { CT_MUT_001 } from '../../src/rules/ct-mut-001';
import { CT_DEMO_001 } from '../../src/rules/ct-demo-001';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestScopeResult,
  TestType,
} from '../../src/core/analysis';
import {
  Availability,
  CollectionStatus,
  EvidenceConflict,
  EvidenceRecord,
  EvidenceType,
  Provenance,
} from '../../src/core/evidence';
import { EvaluationStatus, RuleFinding, RuleResult } from '../../src/core/result';
import { RuleMetadata, RuleStatus } from '../../src/core/rule';

const RULE: RuleMetadata = {
  id: 'CT-TEST-000',
  name: 'engine-test-rule',
  category: 'integrity',
  description: 'Synthetic rule used only to prove evaluation order.',
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

interface Overrides {
  status?: AnalysisStatus;
  completeness?: Completeness;
  testType?: TestType;
  coverage?: CollectionStatus;
  availability?: Availability;
  value?: unknown;
  conflicts?: EvidenceConflict[];
  /** Drop the evidence entry entirely — required evidence absent from envelope. */
  withoutEvidence?: boolean;
  /** Optional location override for the evidence record. */
  location?: { file: string; line: number; column?: number };
}

function record(o: Overrides): EvidenceRecord {
  const coverage = o.coverage ?? CollectionStatus.COMPLETE;
  // 'value' in o, not o.value ?? 1 — a caller must be able to pass an explicitly
  // undefined value (the collector's "never a fabricated zero" shape).
  const value = 'value' in o ? o.value : 1;
  return {
    type: 'assertion_count',
    value,
    availability: o.availability ?? Availability.KNOWN,
    provenance: Provenance.DIRECT,
    source: 'test-adapter',
    collector_version: '0.0.0',
    scope: 'test-body',
    coverage: {
      status: coverage,
      supported_frameworks: ['jest', 'vitest', 'mocha'],
      supported_assertion_forms: ['expect-to-be'],
    },
    conflicts: o.conflicts,
    location: o.location,
  };
}

function analysis(o: Overrides = {}): AnalysisOutput {
  const testType = o.testType ?? TestType.UNIT;
  return {
    subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
    analysis: {
      status: o.status ?? AnalysisStatus.SUCCESS,
      completeness: o.completeness ?? Completeness.COMPLETE,
      scope: 'test-body',
      test_type: { value: testType, source: ClassificationSource.EXPLICIT },
    },
    evidence: o.withoutEvidence === true ? {} : { assertion_count: record(o) },
    capabilities: { assertion_count: CapabilityStatus.AVAILABLE },
  };
}

function resultOf(finding: RuleFinding | null): RuleResult | null {
  return finding === null ? null : finding.result;
}

describe('evaluateRule — guards', () => {
  it('step 2: concrete type outside applies_to → N/A', () => {
    const { finding } = evaluateRule(RULE, analysis({ testType: TestType.COMPONENT }));
    expect(resultOf(finding)).toBe(RuleResult.N_A);
    expect(finding?.reason).toContain('applicability');
  });

  it('step 1: UNKNOWN test type → INDETERMINATE, never N/A (SPEC:475-479, plan A3)', () => {
    const { finding } = evaluateRule(RULE, analysis({ testType: TestType.UNKNOWN }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('test type is UNKNOWN');
  });

  it('step 0: FAILED analysis → status FAILED, no rule result at all', () => {
    const evaluation = evaluateRule(RULE, analysis({ status: AnalysisStatus.FAILED }));
    expect(evaluation.status).toBe(EvaluationStatus.FAILED);
    expect(evaluation.finding).toBeNull();
  });

  it('step 3: UNSUPPORTED analysis → INDETERMINATE', () => {
    const { finding } = evaluateRule(RULE, analysis({ status: AnalysisStatus.UNSUPPORTED }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('analysis status UNSUPPORTED');
  });

  it('step 4: coverage below minimum → INDETERMINATE', () => {
    const { finding } = evaluateRule(RULE, analysis({ coverage: CollectionStatus.PARTIAL }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('coverage.status PARTIAL');
  });

  it('step 4: required evidence absent from envelope → INDETERMINATE', () => {
    const { finding } = evaluateRule(RULE, analysis({ withoutEvidence: true }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('absent from the analysis envelope');
  });

  it('rule-level sufficiency follows per-record coverage, not analysis.summary.completeness', () => {
    // summary.completeness is INCOMPLETE while the required record's
    // coverage.status is COMPLETE. Step 4 reads the record's coverage
    // (COVERAGE_RANK), not the summary, so an established count still reaches
    // its numeric verdict — summary.completeness never overrides per-record
    // coverage.
    const { finding } = evaluateRule(RULE, analysis({ completeness: Completeness.INCOMPLETE, value: 3 }));
    expect(resultOf(finding)).toBe(RuleResult.PASS);
    expect(finding?.reason).toContain('>= 1');
  });

  it('step 5: availability UNKNOWN → unknown_evidence_policy', () => {
    const { finding } = evaluateRule(RULE, analysis({ availability: Availability.UNKNOWN }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('availability is UNKNOWN');
  });

  it('step 5: availability NOT_APPLICABLE → unknown_evidence_policy (no numeric verdict)', () => {
    const { finding } = evaluateRule(RULE, analysis({ availability: Availability.NOT_APPLICABLE }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('availability is NOT_APPLICABLE');
  });

  it('step 5: unknown_evidence_policy is honoured from metadata, not hard-coded', () => {
    const lenient: RuleMetadata = { ...RULE, unknown_evidence_policy: RuleResult.N_A };
    expect(evaluateRule(lenient, analysis({ availability: Availability.UNKNOWN })).finding?.result).toBe(
      RuleResult.N_A,
    );
  });

  it('step 6: non-empty conflicts → conflicting_evidence_policy', () => {
    const conflicts: EvidenceConflict[] = [
      { value: 2, source: 'regex-stub', provenance: Provenance.DERIVED, collector_version: '0.0.0' },
    ];
    const { finding } = evaluateRule(RULE, analysis({ conflicts }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('conflicting evidence');
  });

  it('step 6: conflicting_evidence_policy is honoured from metadata', () => {
    const lenient: RuleMetadata = { ...RULE, conflicting_evidence_policy: RuleResult.N_A };
    expect(evaluateRule(lenient, analysis({ conflicts: [{ value: 2 } as EvidenceConflict] })).finding?.result).toBe(
      RuleResult.N_A,
    );
  });

  it('step 7: value >= pass_at_least → PASS', () => {
    const { finding } = evaluateRule(RULE, analysis({ value: 3 }));
    expect(resultOf(finding)).toBe(RuleResult.PASS);
    expect(finding?.reason).toContain('>= 1');
  });

  it('step 7: value <= fail_at_most → FAIL', () => {
    const { finding } = evaluateRule(RULE, analysis({ value: 0 }));
    expect(resultOf(finding)).toBe(RuleResult.FAIL);
    expect(finding?.reason).toContain('<= 0');
  });

  it('step 7: value between the thresholds → INDETERMINATE (neither condition holds)', () => {
    const strict: RuleMetadata = {
      ...RULE,
      evaluation: { metric: 'assertion_count', pass_at_least: 3, fail_at_most: 0 },
    };
    const { finding } = evaluateRule(strict, analysis({ value: 1 }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('between the thresholds');
  });

  it('step 7: non-numeric value → INDETERMINATE, never a fabricated count', () => {
    const { finding } = evaluateRule(RULE, analysis({ value: undefined }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('not a number');
  });

  it('step 7: metric absent from the envelope → INDETERMINATE, not a crash', () => {
    const miswired: RuleMetadata = {
      ...RULE,
      evaluation: { metric: 'some_other_metric' as unknown as EvidenceType, pass_at_least: 1, fail_at_most: 0 },
    };
    const { finding } = evaluateRule(miswired, analysis({ value: 1 }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('absent from the analysis envelope');
  });

  it('reports rule id, consulted evidence and a non-empty reason on every finding', () => {
    const { finding } = evaluateRule(RULE, analysis({ value: 2 }));
    expect(finding).not.toBeNull();
    expect(finding?.rule_id).toBe(RULE.id);
    expect(finding?.evidence).toEqual(RULE.required_evidence);
    expect(finding?.reason.length).toBeGreaterThan(0);
  });

  it('is deterministic: same input twice → identical finding', () => {
    const input = analysis({ value: 2, conflicts: [{ value: 9 } as EvidenceConflict] });
    expect(evaluateRule(RULE, input)).toEqual(evaluateRule(RULE, input));
  });
});

describe('evaluateRule — evaluation status (plan task 1, Option2)', () => {
  it('is EVALUATED whenever a verdict was reached, whatever that verdict is', () => {
    for (const overrides of [
      { value: 3 },
      { value: 0 },
      { testType: TestType.COMPONENT },
      { status: AnalysisStatus.UNSUPPORTED },
      { coverage: CollectionStatus.PARTIAL },
    ]) {
      const evaluation = evaluateRule(RULE, analysis(overrides));
      expect(evaluation.status).toBe(EvaluationStatus.EVALUATED);
      expect(evaluation.finding).not.toBeNull();
    }
  });

  it('is FAILED only when analysis FAILED, and then carries no verdict', () => {
    const evaluation = evaluateRule(RULE, analysis({ status: AnalysisStatus.FAILED }));
    expect(evaluation.status).toBe(EvaluationStatus.FAILED);
    expect(evaluation.finding).toBeNull();
  });

  it('FAILED is not reported as a bare INDETERMINATE verdict', () => {
    // SPEC:405 — an abort must not be mistakable for a rule that ran and found
    // insufficient evidence, which is exactly what INDETERMINATE means.
    const evaluation = evaluateRule(RULE, analysis({ status: AnalysisStatus.FAILED }));
    expect(Object.values(EvaluationStatus)).not.toContain(evaluation.finding?.result);
    expect(Object.values(RuleResult)).toContain(RuleResult.INDETERMINATE);
  });

  it('finding is null exactly when status is FAILED — the two never disagree', () => {
    const cases = [
      analysis({ status: AnalysisStatus.FAILED }),
      analysis({ status: AnalysisStatus.UNSUPPORTED }),
      analysis({ status: AnalysisStatus.SUCCESS, value: 1 }),
      analysis({ testType: TestType.UNKNOWN }),
    ];
    for (const input of cases) {
      const evaluation = evaluateRule(RULE, input);
      expect(evaluation.finding === null).toBe(evaluation.status === EvaluationStatus.FAILED);
    }
  });
});

describe('evaluateRule — asymmetric coverage for a rule that admits PARTIAL (decision D)', () => {
  // Both shipped rules declare COMPLETE, so engine step 4 refuses PARTIAL before
  // the numeric step. The PASS-on-PARTIAL branch (evaluation.ts:186-195) and the
  // cannot-prove guard (evaluation.ts:201-207) are only reachable for a rule
  // that LOWERS its minimum — these two tests pin both halves of the asymmetry.
  const PARTIAL_MIN: RuleMetadata = {
    ...RULE,
    minimum_evidence_completeness: CollectionStatus.PARTIAL,
  };

  it('established count >= pass_at_least on PARTIAL -> PASS (an incomplete scan cannot subtract)', () => {
    const { finding } = evaluateRule(PARTIAL_MIN, analysis({ coverage: CollectionStatus.PARTIAL, value: 1 }));
    expect(resultOf(finding)).toBe(RuleResult.PASS);
    expect(finding?.reason).toContain('>= 1');
  });

  it('count <= fail_at_most on PARTIAL -> INDETERMINATE, never FAIL (cannot prove this count)', () => {
    const { finding } = evaluateRule(PARTIAL_MIN, analysis({ coverage: CollectionStatus.PARTIAL, value: 0 }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('an incomplete scan cannot prove this count');
  });

  it('UNAVAILABLE is still below a PARTIAL minimum -> refused at step 4, not at the numeric step', () => {
    const { finding } = evaluateRule(PARTIAL_MIN, analysis({ coverage: CollectionStatus.UNAVAILABLE, value: 0 }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('coverage.status UNAVAILABLE');
    expect(finding?.reason).not.toContain('cannot prove');
  });
});

describe('evaluateRule — ORDER (earlier guard wins)', () => {
  const conflict: EvidenceConflict[] = [
    { value: 2, source: 'regex-stub', provenance: Provenance.DERIVED, collector_version: '0.0.0' },
  ];

  it('step 0 beats steps 1 and 2: FAILED + UNKNOWN declared type → FAILED, no verdict (D2 regression)', () => {
    // Pre-fix this hit applicability FIRST and returned EVALUATED/INDETERMINATE.
    // SPEC:374/405: a FAILED analysis aborts before rule evaluation, so no
    // UNKNOWN-type INDETERMINATE may stand in for the abort (plan task 4, D2).
    const { finding, status } = evaluateRule(
      RULE,
      analysis({ status: AnalysisStatus.FAILED, testType: TestType.UNKNOWN }),
    );
    expect(status).toBe(EvaluationStatus.FAILED);
    expect(finding).toBeNull();
  });

  it('step 0 beats step 2: FAILED + inapplicable concrete type → FAILED, no verdict (D2 regression)', () => {
    // Pre-fix this hit applicability FIRST and returned EVALUATED/N/A.
    // The abort precedes the applicability N/A exactly as it precedes the
    // UNKNOWN-type INDETERMINATE (plan task 4, D2).
    const { finding, status } = evaluateRule(RULE, analysis({ status: AnalysisStatus.FAILED, testType: TestType.E2E }));
    expect(status).toBe(EvaluationStatus.FAILED);
    expect(finding).toBeNull();
  });

  it('step 0: FAILED + applicable concrete type → FAILED, no verdict (unchanged by the D2 reorder)', () => {
    const { finding, status } = evaluateRule(
      RULE,
      analysis({ status: AnalysisStatus.FAILED, testType: TestType.UNIT }),
    );
    expect(status).toBe(EvaluationStatus.FAILED);
    expect(finding).toBeNull();
  });

  it('step 2 beats step 3: UNSUPPORTED + wrong concrete type → N/A, not INDETERMINATE', () => {
    // Still holds after the D2 reorder: the concrete mismatch (step 2) comes
    // before the UNSUPPORTED abort (step 3); only the FAILED abort (step 0)
    // precedes both. An inapplicable concrete type is a decided N/A.
    const { finding } = evaluateRule(RULE, analysis({ status: AnalysisStatus.UNSUPPORTED, testType: TestType.E2E }));
    expect(resultOf(finding)).toBe(RuleResult.N_A);
  });

  it('step 2 beats steps 4-6: wrong type + completeness/availability/conflicts all broken → N/A', () => {
    const { finding } = evaluateRule(
      RULE,
      analysis({
        testType: TestType.E2E,
        coverage: CollectionStatus.PARTIAL,
        availability: Availability.UNKNOWN,
        conflicts: conflict,
      }),
    );
    expect(resultOf(finding)).toBe(RuleResult.N_A);
  });

  it('step 0 beats step 4: FAILED + partial coverage → FAILED, no rule result', () => {
    const { finding, status } = evaluateRule(
      RULE,
      analysis({ status: AnalysisStatus.FAILED, coverage: CollectionStatus.PARTIAL }),
    );
    expect(status).toBe(EvaluationStatus.FAILED);
    expect(finding).toBeNull();
  });

  it('step 3 beats step 5: UNSUPPORTED + unknown availability → status reason', () => {
    const { finding } = evaluateRule(
      RULE,
      analysis({ status: AnalysisStatus.UNSUPPORTED, availability: Availability.UNKNOWN }),
    );
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('analysis status UNSUPPORTED');
    expect(finding?.reason).not.toContain('availability is');
  });

  it('step 0 beats step 5: FAILED + unknown availability → FAILED, no verdict (FAILED beats UNSUPPORTED and the rest)', () => {
    // Step 0 precedes step 3 (UNSUPPORTED) and every later guard; a condition
    // that alone would refuse at step 5 (availability UNKNOWN → INDETERMINATE)
    // may not stand in for the abort — SPEC:374/405, plan task 4, F5.
    const { finding, status } = evaluateRule(
      RULE,
      analysis({ status: AnalysisStatus.FAILED, availability: Availability.UNKNOWN }),
    );
    expect(status).toBe(EvaluationStatus.FAILED);
    expect(finding).toBeNull();
  });

  it('step 0 beats step 7 numeric: FAILED analysis + value 0 → FAILED, never FAIL', () => {
    // A FAILED analysis aborts before the numeric threshold is ever applied, so
    // value 0 (which alone would yield FAIL at step 7) produces no verdict at
    // all — SPEC:374/405, plan task 4, D2.
    const { finding, status } = evaluateRule(RULE, analysis({ status: AnalysisStatus.FAILED, value: 0 }));
    expect(status).toBe(EvaluationStatus.FAILED);
    expect(finding).toBeNull();
  });

  it('completeness beats availability: partial coverage + unknown → completeness reason', () => {
    const { finding } = evaluateRule(
      RULE,
      analysis({ coverage: CollectionStatus.PARTIAL, availability: Availability.UNKNOWN }),
    );
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('coverage.status PARTIAL');
    expect(finding?.reason).not.toContain('availability is');
  });

  it('availability beats conflicts: unknown availability + conflicts → availability reason', () => {
    const { finding } = evaluateRule(RULE, analysis({ availability: Availability.UNKNOWN, conflicts: conflict }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('availability is UNKNOWN');
    expect(finding?.reason).not.toContain('conflicting evidence');
  });

  it('completeness beats numeric: partial coverage + count 0 → INDETERMINATE, not FAIL', () => {
    const { finding } = evaluateRule(RULE, analysis({ coverage: CollectionStatus.PARTIAL, value: 0 }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('coverage.status PARTIAL');
  });

  it('availability beats numeric: unknown availability + count 0 → INDETERMINATE, not FAIL', () => {
    const { finding } = evaluateRule(RULE, analysis({ availability: Availability.UNKNOWN, value: 0 }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('availability is UNKNOWN');
  });

  it('conflicts beat numeric: conflicting evidence + count 0 → INDETERMINATE, not FAIL', () => {
    const { finding } = evaluateRule(RULE, analysis({ conflicts: conflict, value: 0 }));
    expect(resultOf(finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('conflicting evidence');
  });
});

describe('evaluateRule — line_coverage evidence never yields FAIL from incomplete collection', () => {
  // CT-INT-001 requires assertion_count; CT-COV-001 is now active (see ADR-031)
  // and consumes line_coverage. These synthetic active rules still pin the engine
  // contract for any rule that does: incomplete collection cannot produce FAIL.
  // COMPLETE minimum: incomplete evidence is refused at step 4, before the numeric step.
  const COMPLETE_MIN: RuleMetadata = {
    id: 'CT-TEST-COVERAGE',
    name: 'coverage-probe-rule',
    category: 'coverage',
    description: 'synthetic: proves PARTIAL/UNAVAILABLE line_coverage cannot produce FAIL',
    applies_to: [TestType.UNIT],
    required_evidence: ['line_coverage'],
    analysis_scope: 'test-body',
    minimum_evidence_completeness: CollectionStatus.COMPLETE,
    unknown_evidence_policy: RuleResult.INDETERMINATE,
    conflicting_evidence_policy: RuleResult.INDETERMINATE,
    evaluation: { metric: 'line_coverage', pass_at_least: 1, fail_at_most: 0 },
    severity: 'warning',
    status: 'active',
  };
  // PARTIAL minimum: reaches the numeric step; asymmetry — PASS survives, FAIL does not.
  const PARTIAL_MIN: RuleMetadata = { ...COMPLETE_MIN, minimum_evidence_completeness: CollectionStatus.PARTIAL };

  function resultOf(rule: RuleMetadata, finding: RuleFinding | null): RuleResult | null {
    return finding === null ? null : finding.result;
  }

  function coverageAnalysis(
    o: {
      coverage?: CollectionStatus;
      availability?: Availability;
      value?: number;
    } = {},
  ): AnalysisOutput {
    const record: EvidenceRecord = {
      type: 'line_coverage',
      value: 'value' in o ? o.value : 1,
      availability: o.availability ?? Availability.KNOWN,
      provenance: Provenance.EXTERNAL,
      source: 'coverage',
      collector_version: '1.0.0',
      scope: 'test-body',
      coverage: {
        status: o.coverage ?? CollectionStatus.COMPLETE,
        supported_frameworks: [],
        supported_assertion_forms: [],
      },
    };
    return {
      subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
      analysis: {
        status: AnalysisStatus.SUCCESS,
        completeness: Completeness.COMPLETE,
        scope: 'test-body',
        test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
      },
      evidence: { line_coverage: record },
      capabilities: { line_coverage: CapabilityStatus.AVAILABLE },
    };
  }

  it('COMPLETE minimum + COMPLETE coverage + value 0 → FAIL (the probe CAN fail when the scan completed)', () => {
    expect(resultOf(COMPLETE_MIN, evaluateRule(COMPLETE_MIN, coverageAnalysis({ value: 0 })).finding)).toBe(
      RuleResult.FAIL,
    );
  });

  it('COMPLETE minimum + PARTIAL coverage + value 0 → INDETERMINATE at step 4, never FAIL', () => {
    const { finding } = evaluateRule(COMPLETE_MIN, coverageAnalysis({ coverage: CollectionStatus.PARTIAL, value: 0 }));
    expect(resultOf(COMPLETE_MIN, finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('coverage.status PARTIAL');
  });

  it('COMPLETE minimum + UNAVAILABLE coverage + value 0 → INDETERMINATE at step 4, never FAIL', () => {
    const { finding } = evaluateRule(
      COMPLETE_MIN,
      coverageAnalysis({ coverage: CollectionStatus.UNAVAILABLE, value: 0 }),
    );
    expect(resultOf(COMPLETE_MIN, finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('coverage.status UNAVAILABLE');
    expect(finding?.reason).not.toContain('<= 0');
  });

  it('PARTIAL minimum + value 1 → PASS (asymmetric: an incomplete scan cannot subtract)', () => {
    expect(
      resultOf(
        PARTIAL_MIN,
        evaluateRule(PARTIAL_MIN, coverageAnalysis({ coverage: CollectionStatus.PARTIAL, value: 1 })).finding,
      ),
    ).toBe(RuleResult.PASS);
  });

  it('PARTIAL minimum + value 0 → INDETERMINATE "cannot prove this count", never FAIL', () => {
    const { finding } = evaluateRule(PARTIAL_MIN, coverageAnalysis({ coverage: CollectionStatus.PARTIAL, value: 0 }));
    expect(resultOf(PARTIAL_MIN, finding)).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('an incomplete scan cannot prove this count');
  });
});

describe('evaluateTests — per-test entries (plan task 4)', () => {
  const base = analysis();

  /** One declaration's scope: its own identity and its own evidence records. */
  function testScope(line: number, name: string, value: number, status = AnalysisStatus.SUCCESS): TestScopeResult {
    return {
      test: { id: `sample.test.ts#it@${line}`, name, line, declaration: 'it' },
      analysis: { ...base.analysis, status },
      evidence: { assertion_count: record({ value }) },
      declaration_gap: null,
    };
  }

  it('one entry per analysis.tests[] in declaration order: 1-assertion + 1-empty file → FAIL then PASS', () => {
    // Pre-fix (D1): one file-level PASS hid the assertion-less test entirely.
    const results = evaluateTests(RULE, {
      ...base,
      tests: [testScope(2, 'has no assertions', 0), testScope(5, 'asserts once', 1)],
    });
    expect(results.map((r) => r.finding?.result)).toEqual([RuleResult.FAIL, RuleResult.PASS]);
    expect(results.map((r) => r.test?.id)).toEqual(['sample.test.ts#it@2', 'sample.test.ts#it@5']);
    expect(results.every((r) => r.status === EvaluationStatus.EVALUATED)).toBe(true);
  });

  it('a single record is evaluated on its OWN evidence, never the subject aggregate', () => {
    const results = evaluateTests(RULE, {
      ...base,
      tests: [testScope(5, 'asserts once', 1)],
    });
    expect(results).toHaveLength(1);
    expect(results[0].test?.id).toBe('sample.test.ts#it@5');
    expect(results[0].status).toBe(EvaluationStatus.EVALUATED);
    expect(resultOf(results[0].finding)).toBe(RuleResult.PASS);
  });

  it('UNSUPPORTED framework with tests absent → the compat path still decides INDETERMINATE', () => {
    const unsupported = analysis({ status: AnalysisStatus.UNSUPPORTED });
    const results = evaluateTests(RULE, unsupported);
    expect(results).toHaveLength(1);
    expect(results[0].test).toBeNull();
    expect(resultOf(results[0].finding)).toBe(RuleResult.INDETERMINATE);
  });

  it('UNSUPPORTED framework with tests: [] → still ZERO evaluations, no INDETERMINATE', () => {
    const unsupported = analysis({ status: AnalysisStatus.UNSUPPORTED });
    expect(evaluateTests(RULE, { ...unsupported, tests: [] })).toEqual([]);
  });

  it('absent tests[] → exactly one subject-level entry with test null (backward compatibility)', () => {
    const subject = evaluateRule(RULE, base);
    expect(evaluateTests(RULE, base)).toEqual([{ test: null, status: subject.status, finding: subject.finding }]);
  });

  it('empty tests[] → ZERO evaluations and no synthetic finding (WP1.1: absent ≠ empty)', () => {
    // Pre-fix: `tests: []` took the same subject-level fallback as absent, so a
    // SUCCESS file that declares NO test was reported as a zero-assertion FAIL
    // attributed to a `test: null` scope that does not exist.
    const results = evaluateTests(RULE, { ...base, tests: [] });
    expect(results).toEqual([]);
  });

  it('empty tests[] stays empty when the analysis FAILED (no verdict either way)', () => {
    const failed = analysis({ status: AnalysisStatus.FAILED });
    expect(evaluateTests(RULE, { ...failed, tests: [] })).toEqual([]);
  });

  it('FAILED analysis → every per-test entry is FAILED with null finding, never EVALUATED', () => {
    const results = evaluateTests(RULE, {
      ...base,
      tests: [testScope(2, 'a', 1, AnalysisStatus.FAILED), testScope(5, 'b', 1, AnalysisStatus.FAILED)],
    });
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe(EvaluationStatus.FAILED);
      expect(result.finding).toBeNull();
    }
  });

  it('conflict on test A → A INDETERMINATE, test B verdict untouched (per-test isolation — plan A9)', () => {
    // Each declaration's scope carries its own evidence, so a conflict on test
    // A's record poisons only A; test B's verdict is decided from its own
    // record and must not be laundered across the declaration boundary.
    const conflicts: EvidenceConflict[] = [
      { value: 2, source: 'regex-stub', provenance: Provenance.DERIVED, collector_version: '0.0.0' },
    ];
    const results = evaluateTests(RULE, {
      ...base,
      tests: [
        {
          ...testScope(2, 'conflicted', 0),
          evidence: { assertion_count: record({ value: 0, conflicts }) },
        },
        testScope(5, 'clean', 3),
      ],
    });
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe(EvaluationStatus.EVALUATED);
    expect(resultOf(results[0].finding)).toBe(RuleResult.INDETERMINATE);
    expect(results[0].finding?.reason).toContain('conflicting evidence');
    expect(results[1].status).toBe(EvaluationStatus.EVALUATED);
    expect(resultOf(results[1].finding)).toBe(RuleResult.PASS);
    expect(results[1].finding?.reason).toContain('>= 1');
  });

  it('is deterministic: same input twice → deep-equal output', () => {
    const envelope: AnalysisOutput = {
      ...base,
      tests: [testScope(2, 'has no assertions', 0), testScope(5, 'asserts once', 1)],
    };
    expect(evaluateTests(RULE, envelope)).toEqual(evaluateTests(RULE, envelope));
  });
});
describe('evaluateRule — finding location (B7 prerequisite)', () => {
  it('copies the evidence record location onto a PASS finding', () => {
    const location = { file: 'sample.test.ts', line: 7, column: 3 };
    const { finding } = evaluateRule(RULE, analysis({ value: 3, location }));
    expect(finding?.result).toBe(RuleResult.PASS);
    expect(finding?.location).toEqual(location);
  });

  it('copies the evidence record location onto a FAIL finding', () => {
    const location = { file: 'sample.test.ts', line: 9 };
    const { finding } = evaluateRule(RULE, analysis({ value: 0, location }));
    expect(finding?.result).toBe(RuleResult.FAIL);
    expect(finding?.location).toEqual(location);
  });

  it('copies location onto INDETERMINATE from availability/conflict/completeness', () => {
    const location = { file: 'sample.test.ts', line: 11 };
    const { finding: a } = evaluateRule(RULE, analysis({ availability: Availability.UNKNOWN, location }));
    expect(a?.result).toBe(RuleResult.INDETERMINATE);
    expect(a?.location).toEqual(location);

    const conflicts = [{ value: 2, source: 'x', provenance: Provenance.DERIVED, collector_version: '0.0.0' }];
    const { finding: c } = evaluateRule(RULE, analysis({ conflicts, location }));
    expect(c?.result).toBe(RuleResult.INDETERMINATE);
    expect(c?.location).toEqual(location);
  });

  it('leaves location undefined when the evidence record has none (never fabricated)', () => {
    const { finding } = evaluateRule(RULE, analysis({ value: 3 }));
    expect(finding?.result).toBe(RuleResult.PASS);
    expect(finding?.location).toBeUndefined();
  });

  it('per-test scope copies location from that test evidence record', () => {
    const location = { file: 'sample.test.ts', line: 4 };
    const base = analysis();
    const results = evaluateTests(RULE, {
      ...base,
      tests: [
        {
          test: { id: 'sample.test.ts#it@4', name: 't', line: 4, declaration: 'it' },
          analysis: base.analysis,
          evidence: { assertion_count: record({ value: 1, location }) },
          declaration_gap: null,
        },
      ],
    });
    expect(results[0].finding?.location).toEqual(location);
  });
});

// Council 2026-11-06 (Option B): negative-verdict rules (CT-INT-003/004) compute
// their verdicts rule-locally; this shared helper is the ONE place the
// COMPLETE-for-negative-verdict gate lives (guards stay centralized in D4 sense).
describe('requiresCompleteForNegativeVerdict — completeness gate', () => {
  // Gate: COVERAGE_RANK[coverage] >= COVERAGE_RANK[minimum] — a rule may produce
  // a negative (FAIL-worthy) verdict from evidence only when the evidence's
  // collection coverage meets the rule's minimum_evidence_completeness.
  it('COMPLETE × COMPLETE → true', () => {
    expect(requiresCompleteForNegativeVerdict(CollectionStatus.COMPLETE, CollectionStatus.COMPLETE)).toBe(true);
  });
  it('PARTIAL × COMPLETE → false', () => {
    expect(requiresCompleteForNegativeVerdict(CollectionStatus.PARTIAL, CollectionStatus.COMPLETE)).toBe(false);
  });
  it('UNAVAILABLE × COMPLETE → false', () => {
    expect(requiresCompleteForNegativeVerdict(CollectionStatus.UNAVAILABLE, CollectionStatus.COMPLETE)).toBe(false);
  });
  it('COMPLETE × PARTIAL → true', () => {
    expect(requiresCompleteForNegativeVerdict(CollectionStatus.COMPLETE, CollectionStatus.PARTIAL)).toBe(true);
  });
  it('PARTIAL × PARTIAL → true', () => {
    expect(requiresCompleteForNegativeVerdict(CollectionStatus.PARTIAL, CollectionStatus.PARTIAL)).toBe(true);
  });
  it('UNAVAILABLE × PARTIAL → false', () => {
    expect(requiresCompleteForNegativeVerdict(CollectionStatus.UNAVAILABLE, CollectionStatus.PARTIAL)).toBe(false);
  });
  it('COMPLETE × UNAVAILABLE → true', () => {
    expect(requiresCompleteForNegativeVerdict(CollectionStatus.COMPLETE, CollectionStatus.UNAVAILABLE)).toBe(true);
  });
  it('PARTIAL × UNAVAILABLE → true', () => {
    expect(requiresCompleteForNegativeVerdict(CollectionStatus.PARTIAL, CollectionStatus.UNAVAILABLE)).toBe(true);
  });
  it('UNAVAILABLE × UNAVAILABLE → true', () => {
    expect(requiresCompleteForNegativeVerdict(CollectionStatus.UNAVAILABLE, CollectionStatus.UNAVAILABLE)).toBe(true);
  });
});

/**
 * Rule lifecycle (plan task 5.3; D6 draft opt-in, D7 deprecated-until-removal).
 *
 * DRAFT — excluded from evaluation unless the caller named the rule
 *          EXPLICITLY (the CLI's --rule); naming it IS the opt-in.
 * DEPRECATED — evaluated by default, exactly like an ACTIVE rule, and its
 *          deprecation version rides on the evaluation envelope.
 */
describe('rule lifecycle — DRAFT opt-in and DEPRECATED metadata (D6/D7)', () => {
  const DRAFT_RULE: RuleMetadata = { ...RULE, id: 'CT-DRAFT-001', status: RuleStatus.DRAFT };
  const DEPRECATED_RULE: RuleMetadata = {
    ...RULE,
    id: 'CT-DEPRECATED-001',
    status: RuleStatus.DEPRECATED,
    deprecatedSince: '1.11.0',
  };

  it('DRAFT: not named -> no verdict at all (status FAILED, finding null)', () => {
    const result = evaluateRule(DRAFT_RULE, analysis());
    expect(result.status).toBe(EvaluationStatus.FAILED);
    expect(result.finding).toBeNull();
  });

  it('DRAFT: named explicitly -> evaluated like an ACTIVE rule (PASS)', () => {
    const result = evaluateRule(DRAFT_RULE, analysis(), new Set([DRAFT_RULE.id]));
    expect(result.status).toBe(EvaluationStatus.EVALUATED);
    expect(result.finding?.result).toBe(RuleResult.PASS);
    expect(result.finding?.rule_id).toBe(DRAFT_RULE.id);
  });

  it('DRAFT: naming a DIFFERENT rule does not opt this one in', () => {
    const result = evaluateRule(DRAFT_RULE, analysis(), new Set(['CT-OTHER-001']));
    expect(result.status).toBe(EvaluationStatus.FAILED);
    expect(result.finding).toBeNull();
  });

  it('DRAFT: every scope is skipped by default, and every scope is decided when named', () => {
    const base = analysis();
    const scoped: AnalysisOutput = {
      ...base,
      tests: [
        {
          test: { id: 'sample.test.ts#it@2', name: 'asserts once', line: 2, declaration: 'it' },
          analysis: base.analysis,
          evidence: { assertion_count: record({ value: 1 }) },
          declaration_gap: null,
        },
      ],
    };
    const skipped = evaluateTests(DRAFT_RULE, scoped);
    expect(skipped.map((s) => s.status)).toEqual([EvaluationStatus.FAILED]);
    expect(skipped.map((s) => s.finding)).toEqual([null]);
    const opted = evaluateTests(DRAFT_RULE, scoped, new Set([DRAFT_RULE.id]));
    expect(opted.map((s) => s.finding?.result)).toEqual([RuleResult.PASS]);
  });

  it('DEPRECATED: evaluated by default, exactly like an ACTIVE rule', () => {
    const result = evaluateRule(DEPRECATED_RULE, analysis());
    expect(result.status).toBe(EvaluationStatus.EVALUATED);
    expect(result.finding?.result).toBe(RuleResult.PASS);
  });

  it('DEPRECATED: the deprecation version rides on the evaluation envelope', () => {
    expect(evaluateRule(DEPRECATED_RULE, analysis()).deprecatedSince).toBe('1.11.0');
    expect(evaluateTests(DEPRECATED_RULE, analysis())[0].deprecatedSince).toBe('1.11.0');
  });

  it('no deprecation version -> the envelope carries no such key (never an empty string)', () => {
    expect('deprecatedSince' in evaluateRule(RULE, analysis())).toBe(false);
    expect('deprecatedSince' in evaluateTests(RULE, analysis())[0]).toBe(false);
  });
});

describe('reason field stays evidence-tied (plan 6.4)', () => {
  const PRESCRIPTION = /\b(should|must|fix|recommend)\b/i;
  const COVERAGE_COMPLETE = {
    status: CollectionStatus.COMPLETE,
    supported_frameworks: ['jest', 'vitest', 'mocha'],
    supported_assertion_forms: ['expect-to-be'],
  };
  const COVERAGE_PARTIAL = {
    status: CollectionStatus.PARTIAL,
    supported_frameworks: ['jest', 'vitest', 'mocha'],
    supported_assertion_forms: ['expect-to-be'],
  };

  beforeAll(() => {
    for (const rule of [CT_INT_001, CT_INT_003, CT_INT_004, CT_COV_001, CT_MUT_001, CT_DEMO_001]) {
      registerRule(rule);
    }
  });

  function recordFor(rule: { id: string }, evType: string, scenario: string): EvidenceRecord {
    const partial = scenario === 'incomplete';
    const unknownAvail = scenario === 'unknown-avail';
    const coverage = partial ? COVERAGE_PARTIAL : COVERAGE_COMPLETE;
    const availability = partial || unknownAvail ? Availability.UNKNOWN : Availability.KNOWN;

    let value: unknown;
    if (scenario === 'nonfinite') {
      value = Number.NaN;
    } else if (evType === 'mutation_score') {
      if (scenario === 'fail') value = { score: 0.2, killed: 1, survived: 4, detected: 1, valid: 5 };
      else value = { score: 0.8, killed: 4, survived: 1, detected: 4, valid: 5 };
    } else if (scenario === 'fail') {
      value = 0;
    } else if (scenario === 'between') {
      value = 0.5;
    } else {
      value = 1;
    }

    const rec: EvidenceRecord = {
      type: evType,
      value,
      availability,
      provenance: evType === 'line_coverage' || evType === 'mutation_score' ? Provenance.EXTERNAL : Provenance.DIRECT,
      source: 'test-adapter',
      collector_version: '0.0.0',
      scope: 'test-body',
      coverage,
    };

    if (scenario === 'conflict') {
      rec.conflicts = [{ value: 2, source: 'x', provenance: Provenance.DIRECT, collector_version: '0.0.0' }];
    }

    if (evType === 'assertion_count' && rule.id === 'CT-INT-003') {
      rec.unestablished_assertions = scenario === 'fail' ? { count: 1, reasons: ['r'] } : { count: 0, reasons: [] };
    }
    if (evType === 'assertion_count' && rule.id === 'CT-INT-004') {
      rec.unclassified_constructs = scenario === 'fail' ? { count: 1, reasons: ['r'] } : { count: 0, reasons: [] };
    }

    return rec;
  }

  function buildEnvelope(rule: any, scenario: string): AnalysisOutput {
    const inapplicableType = rule.applies_to[0] === TestType.UNIT ? TestType.COMPONENT : TestType.UNIT;
    const testType =
      scenario === 'unknown-type' ? TestType.UNKNOWN : scenario === 'na' ? inapplicableType : rule.applies_to[0];
    const status = scenario === 'unsupported' ? AnalysisStatus.UNSUPPORTED : AnalysisStatus.SUCCESS;
    const evidence =
      scenario === 'absent'
        ? {}
        : Object.fromEntries(
            (rule.required_evidence as string[]).map((ev: string) => [ev, recordFor(rule, ev, scenario)]),
          );
    const capabilities = Object.fromEntries(
      (rule.required_evidence as string[]).map((ev: string) => [ev, CapabilityStatus.AVAILABLE]),
    );
    return {
      subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
      analysis: {
        status,
        completeness: Completeness.COMPLETE,
        scope: rule.analysis_scope,
        test_type: { value: testType, source: ClassificationSource.EXPLICIT },
      },
      evidence,
      capabilities,
    };
  }

  const SCENARIOS = [
    'pass',
    'fail',
    'unknown-type',
    'na',
    'unsupported',
    'absent',
    'incomplete',
    'unknown-avail',
    'conflict',
    'between',
    'nonfinite',
  ];

  it('every shipped rule reason is free of prescription keywords across verdict paths', () => {
    let findingCount = 0;
    for (const rule of allRules()) {
      for (const scenario of SCENARIOS) {
        const env = buildEnvelope(rule, scenario);
        const er = evaluateRule(rule, env);
        if (er.finding) {
          findingCount++;
          expect(er.finding.reason).not.toMatch(PRESCRIPTION);
        }
      }
    }
    expect(findingCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// TASK 3 (capability seam, plan .opencode/plans/2026-11-18-int003-capability-seam.md
// decisions D1/D2/D2b) — step-4 completeness policy truth table.
//
// GREEN NOW, must stay GREEN through tasks 4-5 (regression guard): for every
// existing evidence type (assertion_count, line_coverage, mutation_score) the
// step-4 gate stays COVERAGE_RANK-based — COVERAGE_RANK[coverage] >=
// COVERAGE_RANK[minimum] with COMPLETE=3 > PARTIAL=2 > UNAVAILABLE=1. The seam
// adds a presence-and-count 'signal' policy for the new unestablished_assertion
// type ONLY (D2b candidate 1); it must not change these rows.
//
// The pending block at the bottom pins the POST-SEAM signal semantics. It is
// RED-by-design at HEAD (type not yet in EVIDENCE_TYPES, ct-int-003.ts not yet
// switched) and is what task 4 turns GREEN.
// ---------------------------------------------------------------------------
describe('step-4 truth table — rank semantics per existing evidence type (regression guard)', () => {
  // RULE_TEMPLATE + per-type evidence records through the PUBLIC evaluateRule
  // interface: required evidence present at a given coverage status.
  function ruleFor(type: EvidenceType): RuleMetadata {
    // metric must be the per-type record too: step 7 thresholds the metric
    // record, so a template metric of 'assertion_count' would make a
    // line_coverage/mutation_score rule INDETERMINATE for the wrong reason.
    return {
      ...RULE,
      id: `CT-TRUTH-${type}`,
      required_evidence: [type],
      evaluation: { metric: type, pass_at_least: 1, fail_at_most: 0 },
    };
  }

  function recordOfType(type: EvidenceType, coverage: CollectionStatus): EvidenceRecord {
    return { ...record({ coverage }), type };
  }

  function analysisFor(type: EvidenceType, coverage: CollectionStatus): AnalysisOutput {
    const base = analysis({ coverage });
    return {
      ...base,
      evidence: { [type]: recordOfType(type, coverage) },
      capabilities: { [type]: CapabilityStatus.AVAILABLE },
    };
  }

  const ALL_TYPES: readonly EvidenceType[] = ['assertion_count', 'line_coverage', 'mutation_score'];

  it.each(ALL_TYPES)('%s: COMPLETE >= COMPLETE → record admitted (numeric step decides)', (type) => {
    const { finding } = evaluateRule(ruleFor(type), analysisFor(type, CollectionStatus.COMPLETE));
    expect(finding?.result).toBe(RuleResult.PASS); // value 1 >= pass_at_least 1
  });

  it.each(ALL_TYPES)('%s: PARTIAL < COMPLETE minimum → INDETERMINATE at step 4', (type) => {
    const { finding } = evaluateRule(ruleFor(type), analysisFor(type, CollectionStatus.PARTIAL));
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('coverage.status PARTIAL');
  });

  it.each(ALL_TYPES)('%s: UNAVAILABLE < COMPLETE minimum → INDETERMINATE at step 4', (type) => {
    const { finding } = evaluateRule(ruleFor(type), analysisFor(type, CollectionStatus.UNAVAILABLE));
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('coverage.status UNAVAILABLE');
  });

  it.each(ALL_TYPES)('%s: PARTIAL coverage clears a PARTIAL minimum (asymmetric, unchanged)', (type) => {
    const rule: RuleMetadata = { ...ruleFor(type), minimum_evidence_completeness: CollectionStatus.PARTIAL };
    const { finding } = evaluateRule(rule, analysisFor(type, CollectionStatus.PARTIAL));
    expect(finding?.result).toBe(RuleResult.PASS);
  });

  it('COVERAGE_RANK order itself: COMPLETE > PARTIAL > UNAVAILABLE (pins the ladder the seam must not reorder)', () => {
    const complete = evaluateRule(
      ruleFor('assertion_count'),
      analysisFor('assertion_count', CollectionStatus.COMPLETE),
    );
    const partial = evaluateRule(ruleFor('assertion_count'), analysisFor('assertion_count', CollectionStatus.PARTIAL));
    const unavailable = evaluateRule(
      ruleFor('assertion_count'),
      analysisFor('assertion_count', CollectionStatus.UNAVAILABLE),
    );
    expect(complete.finding?.result).toBe(RuleResult.PASS);
    expect(partial.finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(unavailable.finding?.result).toBe(RuleResult.INDETERMINATE);
  });

  it('existing shipped rules keep their minima (CT-INT-001/004/COV/MUT unchanged by the seam)', () => {
    // Verbatim from src/rules/*.ts at HEAD d2daf16 — note CT-INT-004 is the
    // asymmetric PARTIAL-minimum rule (ct-int-004.ts:51), not COMPLETE.
    expect(CT_INT_001.required_evidence).toEqual(['assertion_count']);
    expect(CT_INT_001.minimum_evidence_completeness).toBe(CollectionStatus.COMPLETE);
    expect(CT_INT_001.evaluation.metric).toBe('assertion_count');
    expect(CT_INT_004.required_evidence).toEqual(['assertion_count']);
    expect(CT_INT_004.minimum_evidence_completeness).toBe(CollectionStatus.PARTIAL);
    expect(CT_INT_004.evaluation.metric).toBe('assertion_count');
    expect(CT_COV_001.required_evidence).toEqual(['line_coverage']);
    expect(CT_COV_001.minimum_evidence_completeness).toBe(CollectionStatus.COMPLETE);
    expect(CT_MUT_001.required_evidence).toEqual(['mutation_score']);
    expect(CT_MUT_001.minimum_evidence_completeness).toBe(CollectionStatus.COMPLETE);
  });
});

describe('step-4 signal policy for unestablished_assertion — POST-SEAM truth table (RED until task 4)', () => {
  // POST-SEAM: CT-INT-003's required_evidence includes 'unestablished_assertion'
  // whose completeness policy is presence+count ('signal'), NOT the rank ladder.
  // A signal record with coverage PARTIAL (the honest collector status for a
  // recognized-but-unestablished assertion, collector.ts:397-404) must reach
  // the local hook and yield FAIL on count > 0 — instead of being refused at
  // step 4 by COVERAGE_RANK[PARTIAL] < COVERAGE_RANK[COMPLETE] (current HEAD
  // behavior, pinned above and in tests/rules/ct-int-003.test.ts).
  it('signal record with count>0 on PARTIAL coverage → FAIL (RED until task 4)', () => {
    const collected: AnalysisOutput = {
      subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
      analysis: {
        status: AnalysisStatus.SUCCESS,
        completeness: Completeness.COMPLETE,
        scope: 'test-body',
        test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
      },
      evidence: {
        assertion_count: {
          ...record({ coverage: CollectionStatus.PARTIAL }),
          unestablished_assertions: {
            count: 1,
            reasons: ['assertion is inside a callback; callback execution cannot be established statically'],
          },
        },
        unestablished_assertion: {
          type: 'unestablished_assertion',
          value: 1,
          availability: Availability.KNOWN,
          provenance: Provenance.DIRECT,
          source: 'test-adapter',
          collector_version: '0.0.0',
          scope: 'test-body',
          coverage: {
            status: CollectionStatus.PARTIAL,
            supported_frameworks: ['jest', 'vitest', 'mocha'],
            supported_assertion_forms: ['expect-to-be'],
          },
          unestablished_assertions: {
            count: 1,
            reasons: ['assertion is inside a callback; callback execution cannot be established statically'],
          },
        },
      },
      capabilities: { assertion_count: CapabilityStatus.AVAILABLE },
    };
    const { finding } = evaluateRule(CT_INT_003, collected);
    expect(finding?.result).toBe(RuleResult.FAIL);
  });

  it('signal record with count 0 → PASS (present-only convention preserved, RED until task 4)', () => {
    const collected: AnalysisOutput = {
      subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
      analysis: {
        status: AnalysisStatus.SUCCESS,
        completeness: Completeness.COMPLETE,
        scope: 'test-body',
        test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
      },
      evidence: {
        assertion_count: record({ value: 1 }),
        unestablished_assertion: {
          type: 'unestablished_assertion',
          value: 0,
          availability: Availability.KNOWN,
          provenance: Provenance.DIRECT,
          source: 'test-adapter',
          collector_version: '0.0.0',
          scope: 'test-body',
          coverage: {
            status: CollectionStatus.COMPLETE,
            supported_frameworks: ['jest', 'vitest', 'mocha'],
            supported_assertion_forms: ['expect-to-be'],
          },
          unestablished_assertions: { count: 0, reasons: [] },
        },
      },
      capabilities: { assertion_count: CapabilityStatus.AVAILABLE },
    };
    const { finding } = evaluateRule(CT_INT_003, collected);
    expect(finding?.result).toBe(RuleResult.PASS);
  });

  it('signal record absent → INDETERMINATE "required evidence absent" (RED until task 4)', () => {
    // Post-seam CT-INT_003.required_evidence includes unestablished_assertion;
    // an envelope without the signal record must be refused, not guessed.
    const collected: AnalysisOutput = {
      subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
      analysis: {
        status: AnalysisStatus.SUCCESS,
        completeness: Completeness.COMPLETE,
        scope: 'test-body',
        test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
      },
      evidence: { assertion_count: record({ value: 1 }) },
      capabilities: { assertion_count: CapabilityStatus.AVAILABLE },
    };
    const { finding } = evaluateRule(CT_INT_003, collected);
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain("'unestablished_assertion'");
  });
});
