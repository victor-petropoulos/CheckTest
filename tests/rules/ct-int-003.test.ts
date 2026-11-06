/**
 * CT-INT-003 — unestablished-assertion reporting.
 *
 * The decision matrix pins the rule-local verdict after the shared engine
 * guards: absent/count=0 PASS, count>0 FAIL with the collector's reasons
 * verbatim, and every guard condition (incomplete coverage, unknown
 * availability, conflict, non-applicable, FAILED) unchanged from the engine.
 *
 * The real-fixture test uses case-08-callback through the collect path. That
 * fixture reports the callback reason and count=1, but its assertion_count
 * record is availability UNKNOWN / coverage PARTIAL — the shared step-5 guard
 * therefore returns INDETERMINATE before the local hook. The direct-hook
 * assertion at the end documents the local verdict the rule would produce once
 * the guards admit the record.
 */

import { join } from 'path';

import { collectAnalysis } from '../../src/adapters/typescript/collector';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../src/core/analysis';
import { Availability, CollectionStatus, EvidenceConflict, EvidenceRecord, Provenance } from '../../src/core/evidence';
import { evaluateRule, evaluateTests } from '../../src/core/evaluation';
import { EvaluationStatus, RuleResult } from '../../src/core/result';
import { RuleMetadata } from '../../src/core/rule';
import { CT_INT_003 } from '../../src/rules/ct-int-003';
import { validateRule } from '../../src/rules/registry';

const CALLBACK_REASON = 'assertion is inside a callback; callback execution cannot be established statically';
const NESTED_REASON =
  'assertion is inside a nested block (if/loop/try/switch); straight-line execution cannot be established statically';

interface Unestablished {
  count: number;
  reasons: string[];
}

interface Overrides {
  status?: AnalysisStatus;
  testType?: TestType;
  coverage?: CollectionStatus;
  availability?: Availability;
  value?: unknown;
  unestablished?: Unestablished;
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
  if (o.unestablished !== undefined) {
    record.unestablished_assertions = o.unestablished;
  }
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

function evaluationOf(overrides: Overrides) {
  return evaluateRule(CT_INT_003, analysis(overrides));
}

function resultOf(overrides: Overrides): RuleResult | null {
  const { finding } = evaluationOf(overrides);
  return finding === null ? null : finding.result;
}

describe('CT-INT-003 metadata', () => {
  it('applies to all five concrete test types and never to UNKNOWN', () => {
    expect([...CT_INT_003.applies_to].sort()).toEqual(
      [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION, TestType.CONTRACT, TestType.E2E].sort(),
    );
    expect(CT_INT_003.applies_to).not.toContain(TestType.UNKNOWN);
  });

  it('requires assertion_count, test-body scope, COMPLETE minimum and INDETERMINATE policies', () => {
    expect(CT_INT_003.required_evidence).toEqual(['assertion_count']);
    expect(CT_INT_003.analysis_scope).toBe('test-body');
    expect(CT_INT_003.minimum_evidence_completeness).toBe(CollectionStatus.COMPLETE);
    expect(CT_INT_003.unknown_evidence_policy).toBe(RuleResult.INDETERMINATE);
    expect(CT_INT_003.conflicting_evidence_policy).toBe(RuleResult.INDETERMINATE);
  });

  it('is the warning/active unestablished-assertions rule', () => {
    expect(CT_INT_003.id).toBe('CT-INT-003');
    expect(CT_INT_003.name).toBe('unestablished-assertions');
    expect(CT_INT_003.category).toBe('integrity');
    expect(CT_INT_003.severity).toBe('warning');
    expect(CT_INT_003.status).toBe('active');
  });

  it('passes validateRule with a local decision hook present', () => {
    expect(validateRule(CT_INT_003)).toEqual([]);
  });

  it('is deterministic: identical input → identical finding', () => {
    const input = analysis({ unestablished: { count: 1, reasons: [CALLBACK_REASON] } });
    expect(evaluateRule(CT_INT_003, input)).toEqual(evaluateRule(CT_INT_003, input));
  });
});

describe('CT-INT-003 verdicts — the local decision matrix', () => {
  it('PASS: field absent (no unestablished assertion) — reason cites count 0', () => {
    const { finding } = evaluationOf({});
    expect(finding?.result).toBe(RuleResult.PASS);
    expect(finding?.reason).toContain('unestablished_assertions=0');
  });

  it('PASS: field present with count 0 — reason cites count 0', () => {
    const { finding } = evaluationOf({ unestablished: { count: 0, reasons: [] } });
    expect(finding?.result).toBe(RuleResult.PASS);
    expect(finding?.reason).toContain('unestablished_assertions=0');
  });

  it('FAIL: count > 0 with COMPLETE coverage — reason lists every collector reason verbatim', () => {
    const { finding } = evaluationOf({
      unestablished: { count: 2, reasons: [CALLBACK_REASON, NESTED_REASON] },
    });
    expect(finding?.result).toBe(RuleResult.FAIL);
    expect(finding?.reason).toContain('unestablished_assertions=2');
    expect(finding?.reason).toContain(CALLBACK_REASON);
    expect(finding?.reason).toContain(NESTED_REASON);
  });

  it('FAIL: a positive count without a reasons list still fails and says so', () => {
    const { finding } = evaluationOf({ unestablished: { count: 1, reasons: [] } });
    expect(finding?.result).toBe(RuleResult.FAIL);
    expect(finding?.reason).toContain('unestablished_assertions=1');
    expect(finding?.reason).toContain('no collector reason recorded');
  });

  it('INDETERMINATE: coverage PARTIAL is below the COMPLETE minimum (engine step 4)', () => {
    const { finding } = evaluationOf({
      coverage: CollectionStatus.PARTIAL,
      unestablished: { count: 1, reasons: [CALLBACK_REASON] },
    });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('coverage.status PARTIAL');
  });

  it('INDETERMINATE: coverage UNAVAILABLE is below the COMPLETE minimum (engine step 4)', () => {
    const { finding } = evaluationOf({
      coverage: CollectionStatus.UNAVAILABLE,
      availability: Availability.UNKNOWN,
      unestablished: { count: 1, reasons: [CALLBACK_REASON] },
    });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('coverage.status UNAVAILABLE');
  });

  it('INDETERMINATE: unknown availability routes through unknown_evidence_policy', () => {
    const { finding } = evaluationOf({
      availability: Availability.UNKNOWN,
      unestablished: { count: 1, reasons: [CALLBACK_REASON] },
    });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('availability is UNKNOWN');
  });

  it('INDETERMINATE: conflicting evidence routes through conflicting_evidence_policy', () => {
    const conflicts: EvidenceConflict[] = [
      { value: 2, source: 'regex-stub', provenance: Provenance.DERIVED, collector_version: '0.0.0' },
    ];
    const { finding } = evaluationOf({ conflicts, unestablished: { count: 1, reasons: [CALLBACK_REASON] } });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('conflicting evidence');
  });

  it('INDETERMINATE: UNKNOWN test type — applicability cannot be decided', () => {
    expect(resultOf({ testType: TestType.UNKNOWN })).toBe(RuleResult.INDETERMINATE);
  });

  it("N/A: a concrete type outside a derived rule's applies_to", () => {
    const unitOnly: RuleMetadata = { ...CT_INT_003, applies_to: [TestType.UNIT] };
    const { finding } = evaluateRule(unitOnly, analysis({ testType: TestType.COMPONENT }));
    expect(finding?.result).toBe(RuleResult.N_A);
    expect(finding?.reason).toContain('applicability');
  });

  it('FAILED analysis: no verdict at all — status FAILED, finding null', () => {
    const evaluation = evaluationOf({ status: AnalysisStatus.FAILED });
    expect(evaluation.status).toBe(EvaluationStatus.FAILED);
    expect(evaluation.finding).toBeNull();
  });

  it('applies — not N/A — to every concrete test type', () => {
    for (const testType of [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION, TestType.CONTRACT, TestType.E2E]) {
      expect(resultOf({ testType })).toBe(RuleResult.PASS);
    }
  });
});

describe('CT-INT-003 real fixture — case-08-callback through collectAnalysis', () => {
  const fixture = join(__dirname, '..', 'fixtures', 'ct-int-001', 'case-08-callback', 'sample.test.ts');

  it('collects count=1 with the callback reason, but the shared availability guard yields INDETERMINATE', () => {
    const collected = collectAnalysis(fixture, TestType.UNIT);
    const scope = evaluateTests(CT_INT_003, collected).find((entry) => entry.test?.line === 9);
    expect(scope).toBeDefined();
    expect(scope?.finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(scope?.finding?.reason).toContain('coverage.status PARTIAL');

    const record = collected.tests?.[0].evidence.assertion_count;
    expect(record?.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record?.unestablished_assertions).toEqual({ count: 1, reasons: [CALLBACK_REASON] });
    expect(record?.reason).toContain(CALLBACK_REASON);
  });

  it('the local decision refuses FAIL on the collected PARTIAL record', () => {
    const collected = collectAnalysis(fixture, TestType.UNIT);
    const record = collected.tests?.[0].evidence.assertion_count as EvidenceRecord;
    const decision = CT_INT_003.local_decision!(
      {
        ...record,
        rule: CT_INT_003,
        record,
        metricRecord: record,
        evidence: collected.tests?.[0].evidence ?? {},
        summary: collected.tests?.[0].analysis ?? collected.analysis,
      },
      record,
      CT_INT_003,
    );
    expect(decision).toMatchObject({ result: RuleResult.INDETERMINATE });
  });

  it('the local decision returns FAIL with the callback reason once coverage is COMPLETE', () => {
    const collected = collectAnalysis(fixture, TestType.UNIT);
    const record = collected.tests?.[0].evidence.assertion_count as EvidenceRecord;
    const complete: EvidenceRecord = { ...record, coverage: { ...record.coverage, status: CollectionStatus.COMPLETE } };
    const decision = CT_INT_003.local_decision!(
      {
        ...complete,
        rule: CT_INT_003,
        record: complete,
        metricRecord: complete,
        evidence: { assertion_count: complete },
        summary: collected.tests?.[0].analysis ?? collected.analysis,
      },
      complete,
      CT_INT_003,
    );
    expect(decision).toMatchObject({ result: RuleResult.FAIL });
    expect((decision as { reason: string }).reason).toContain(CALLBACK_REASON);
  });
});
