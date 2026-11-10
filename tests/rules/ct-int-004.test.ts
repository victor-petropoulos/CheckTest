/**
 * CT-INT-004 — unclassified-construct reporting (transparency rule).
 *
 * The decision matrix pins the rule-local verdict after the shared engine
 * guards: absent/count=0 PASS, count>0 INDETERMINATE with the collector's
 * reasons verbatim. No input in the matrix may ever produce FAIL.
 *
 * Guard-4 interaction (documented here because it drove the rule's metadata):
 * the collector marks coverage PARTIAL whenever it records an unclassified
 * construct (collector.ts:299), so a COMPLETE minimum would short-circuit every
 * record this rule exists to report at engine step 4. The rule therefore
 * declares PARTIAL; the matrix below pins both that choice and what COMPLETE
 * would have done. Guard 5 still fires first on real collector records, whose
 * availability is UNKNOWN whenever coverage is PARTIAL — its reason embeds the
 * record reason, quoting each collector reason verbatim.
 *
 * The real-fixture tests use case-03-unsupported-api and
 * case-09-partial-collection through the collect path.
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
import { CT_INT_004 } from '../../src/rules/ct-int-004';
import { validateRule } from '../../src/rules/registry';

const COMPUTED_REASON = 'computed matcher cannot be resolved statically';
const NAMESPACE_REASON = "'assert' is not a supported assertion form";

interface Unclassified {
  count: number;
  reasons: string[];
}

interface Overrides {
  status?: AnalysisStatus;
  testType?: TestType;
  coverage?: CollectionStatus;
  availability?: Availability;
  value?: unknown;
  unclassified?: Unclassified;
  conflicts?: EvidenceConflict[];
  reason?: string;
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
      supported_frameworks: ['jest', 'vitest', 'mocha'],
      supported_assertion_forms: ['expect-to-be'],
    },
    conflicts: o.conflicts,
  };
  if (o.reason !== undefined) {
    record.reason = o.reason;
  }
  if (o.unclassified !== undefined) {
    record.unclassified_constructs = o.unclassified;
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
  return evaluateRule(CT_INT_004, analysis(overrides));
}

function resultOf(overrides: Overrides): RuleResult | null {
  const { finding } = evaluationOf(overrides);
  return finding === null ? null : finding.result;
}

describe('CT-INT-004 metadata', () => {
  it('applies to all five concrete test types and never to UNKNOWN', () => {
    expect([...CT_INT_004.applies_to].sort()).toEqual(
      [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION, TestType.CONTRACT, TestType.E2E].sort(),
    );
    expect(CT_INT_004.applies_to).not.toContain(TestType.UNKNOWN);
  });

  it('requires assertion_count, test-body scope, PARTIAL minimum and INDETERMINATE policies', () => {
    expect(CT_INT_004.required_evidence).toEqual(['assertion_count']);
    expect(CT_INT_004.analysis_scope).toBe('test-body');
    // PARTIAL, not the proposal's literal COMPLETE: see the module comment.
    expect(CT_INT_004.minimum_evidence_completeness).toBe(CollectionStatus.PARTIAL);
    expect(CT_INT_004.unknown_evidence_policy).toBe(RuleResult.INDETERMINATE);
    expect(CT_INT_004.conflicting_evidence_policy).toBe(RuleResult.INDETERMINATE);
  });

  it('is the info/active unclassified-constructs rule', () => {
    expect(CT_INT_004.id).toBe('CT-INT-004');
    expect(CT_INT_004.name).toBe('unclassified-constructs');
    expect(CT_INT_004.category).toBe('integrity');
    expect(CT_INT_004.severity).toBe('info');
    expect(CT_INT_004.status).toBe('active');
  });

  it('passes validateRule with a local decision hook present', () => {
    expect(validateRule(CT_INT_004)).toEqual([]);
  });

  it('is deterministic: identical input → identical finding', () => {
    const input = analysis({ unclassified: { count: 1, reasons: [COMPUTED_REASON] } });
    expect(evaluateRule(CT_INT_004, input)).toEqual(evaluateRule(CT_INT_004, input));
  });
});

describe('CT-INT-004 verdicts — the local decision matrix', () => {
  it('PASS: field absent (nothing uninspectable) — reason cites count 0', () => {
    const { finding } = evaluationOf({});
    expect(finding?.result).toBe(RuleResult.PASS);
    expect(finding?.reason).toContain('unclassified_constructs=0');
  });

  it('PASS: field present with count 0 — reason cites count 0', () => {
    const { finding } = evaluationOf({ unclassified: { count: 0, reasons: [] } });
    expect(finding?.result).toBe(RuleResult.PASS);
    expect(finding?.reason).toContain('unclassified_constructs=0');
  });

  it('INDETERMINATE: count > 0 with COMPLETE/KNOWN — local hook lists every reason verbatim', () => {
    const { finding } = evaluationOf({
      unclassified: { count: 2, reasons: [COMPUTED_REASON, NAMESPACE_REASON] },
    });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('unclassified_constructs=2');
    expect(finding?.reason).toContain(COMPUTED_REASON);
    expect(finding?.reason).toContain(NAMESPACE_REASON);
  });

  it('INDETERMINATE: a positive count without a reasons list still reports and says so', () => {
    const { finding } = evaluationOf({ unclassified: { count: 1, reasons: [] } });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('unclassified_constructs=1');
    expect(finding?.reason).toContain('no collector reason recorded');
  });

  it('INDETERMINATE: count > 0 with PARTIAL coverage reaches the hook (PARTIAL minimum admits it)', () => {
    const { finding } = evaluationOf({
      coverage: CollectionStatus.PARTIAL,
      unclassified: { count: 1, reasons: [COMPUTED_REASON] },
    });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    // The local hook ran: its reason, not the engine's coverage/availability text.
    expect(finding?.reason).toContain('unclassified_constructs=1');
    expect(finding?.reason).toContain(COMPUTED_REASON);
  });

  it('INDETERMINATE: realistic collector shape (PARTIAL + UNKNOWN availability) — guard 5, reasons preserved', () => {
    const { finding } = evaluationOf({
      coverage: CollectionStatus.PARTIAL,
      availability: Availability.UNKNOWN,
      reason: `1 assertion-like construct(s) could not be classified: expect(x)[m](2) — ${COMPUTED_REASON}`,
      unclassified: { count: 1, reasons: [COMPUTED_REASON] },
    });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('availability is UNKNOWN');
    expect(finding?.reason).toContain(COMPUTED_REASON);
  });

  it('INDETERMINATE: coverage UNAVAILABLE is below the PARTIAL minimum (engine step 4)', () => {
    const { finding } = evaluationOf({
      coverage: CollectionStatus.UNAVAILABLE,
      availability: Availability.UNKNOWN,
      unclassified: { count: 1, reasons: [COMPUTED_REASON] },
    });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('coverage.status UNAVAILABLE');
  });

  it('INDETERMINATE: unknown availability routes through unknown_evidence_policy', () => {
    const { finding } = evaluationOf({
      availability: Availability.UNKNOWN,
      unclassified: { count: 1, reasons: [COMPUTED_REASON] },
    });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('availability is UNKNOWN');
  });

  it('INDETERMINATE: conflicting evidence routes through conflicting_evidence_policy', () => {
    const conflicts: EvidenceConflict[] = [
      { value: 2, source: 'regex-stub', provenance: Provenance.DERIVED, collector_version: '0.0.0' },
    ];
    const { finding } = evaluationOf({ conflicts, unclassified: { count: 1, reasons: [COMPUTED_REASON] } });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('conflicting evidence');
  });

  it('INDETERMINATE: UNKNOWN test type — applicability cannot be decided', () => {
    expect(resultOf({ testType: TestType.UNKNOWN })).toBe(RuleResult.INDETERMINATE);
  });

  it("N/A: a concrete type outside a derived rule's applies_to", () => {
    const unitOnly: RuleMetadata = { ...CT_INT_004, applies_to: [TestType.UNIT] };
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

  it('never FAILs across the matrix', () => {
    const matrix: Overrides[] = [
      {},
      { unclassified: { count: 0, reasons: [] } },
      { unclassified: { count: 1, reasons: [COMPUTED_REASON] } },
      { unclassified: { count: 3, reasons: [COMPUTED_REASON, NAMESPACE_REASON] } },
      { unclassified: { count: 1, reasons: [] } },
      { coverage: CollectionStatus.PARTIAL, unclassified: { count: 1, reasons: [COMPUTED_REASON] } },
      { coverage: CollectionStatus.PARTIAL, availability: Availability.UNKNOWN },
      { coverage: CollectionStatus.UNAVAILABLE, availability: Availability.UNKNOWN },
      { availability: Availability.UNKNOWN },
      { testType: TestType.UNKNOWN },
      {
        conflicts: [{ value: 0, source: 'stub', provenance: Provenance.DERIVED, collector_version: '0.0.0' }],
      },
    ];
    for (const overrides of matrix) {
      expect(resultOf(overrides)).not.toBe(RuleResult.FAIL);
    }
  });
});

describe('CT-INT-004 guard-4 interaction — why the minimum is PARTIAL', () => {
  it('a COMPLETE minimum would short-circuit the rule’s own PARTIAL signal at step 4', () => {
    const completeMinimum: RuleMetadata = { ...CT_INT_004, minimum_evidence_completeness: CollectionStatus.COMPLETE };
    const { finding } = evaluateRule(
      completeMinimum,
      analysis({ coverage: CollectionStatus.PARTIAL, unclassified: { count: 1, reasons: [COMPUTED_REASON] } }),
    );
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    // Blocked before the local hook: the reason is the coverage guard's, not the
    // rule's reason listing.
    expect(finding?.reason).toContain('coverage.status PARTIAL');
    expect(finding?.reason).toContain('below required COMPLETE');
    expect(finding?.reason).not.toContain('unclassified_constructs=');
  });

  it('the shipped PARTIAL minimum lets the same record reach the local hook', () => {
    const { finding } = evaluationOf({
      coverage: CollectionStatus.PARTIAL,
      unclassified: { count: 1, reasons: [COMPUTED_REASON] },
    });
    expect(finding?.reason).toContain('unclassified_constructs=1');
  });
});

describe('CT-INT-004 real fixtures through collectAnalysis', () => {
  function collect(caseName: string): AnalysisOutput {
    return collectAnalysis(join(__dirname, '..', 'fixtures', 'ct-int-001', caseName, 'sample.test.ts'), TestType.UNIT);
  }

  it('case-03-unsupported-api → INDETERMINATE naming the assert namespace verbatim', () => {
    const collected = collect('case-03-unsupported-api');
    const scope = evaluateTests(CT_INT_004, collected).find((entry) => entry.test?.line === 9);
    expect(scope).toBeDefined();
    expect(scope?.finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(scope?.finding?.reason).toContain(NAMESPACE_REASON);

    const record = collected.tests?.[0].evidence.assertion_count;
    expect(record?.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record?.unclassified_constructs).toEqual({ count: 1, reasons: [NAMESPACE_REASON] });
  });

  it('case-09-partial-collection → INDETERMINATE naming the computed matcher verbatim', () => {
    const collected = collect('case-09-partial-collection');
    const scope = evaluateTests(CT_INT_004, collected).find((entry) => entry.test?.line === 9);
    expect(scope).toBeDefined();
    expect(scope?.finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(scope?.finding?.reason).toContain(COMPUTED_REASON);

    const record = collected.tests?.[0].evidence.assertion_count;
    expect(record?.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record?.unclassified_constructs).toEqual({ count: 1, reasons: [COMPUTED_REASON] });
  });

  it('the local decision returns INDETERMINATE — never FAIL — on a collected record made decidable', () => {
    const collected = collect('case-03-unsupported-api');
    const record = collected.tests?.[0].evidence.assertion_count as EvidenceRecord;
    const decidable: EvidenceRecord = {
      ...record,
      coverage: { ...record.coverage, status: CollectionStatus.COMPLETE },
      availability: Availability.KNOWN,
    };
    const decision = CT_INT_004.local_decision!(
      {
        ...decidable,
        rule: CT_INT_004,
        record: decidable,
        metricRecord: decidable,
        evidence: { assertion_count: decidable },
        summary: collected.tests?.[0].analysis ?? collected.analysis,
      },
      decidable,
      CT_INT_004,
    );
    expect(decision).toMatchObject({ result: RuleResult.INDETERMINATE });
    expect((decision as { reason: string }).reason).toContain(NAMESPACE_REASON);
  });
});
