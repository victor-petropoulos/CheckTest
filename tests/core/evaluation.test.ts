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
import { RuleMetadata } from '../../src/core/rule';

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
      supported_frameworks: ['jest', 'vitest'],
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
