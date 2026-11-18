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
 * record is availability UNKNOWN / coverage PARTIAL — the shared step-4
 * completeness guard therefore returns INDETERMINATE before the local hook.
 *
 * TASK 3 (capability seam, plan
 * .opencode/plans/2026-11-18-int003-capability-seam.md, decisions D1/D2/D2c):
 * the assertions below marked "POST-SEAM" encode the behaviour the seam must
 * produce — CT-INT-003 judges the `unestablished_assertion` signal by
 * presence-and-count semantics (count > 0 → FAIL), so a recognized-but-
 * unestablished assertion reaches the FAIL hook instead of being blocked by
 * the assertion_count coverage rank. They are RED until task 4 lands the seam;
 * the assertions marked "PRE-SEAM (unchanged)" pin engine behaviour that the
 * seam must not alter (CT-INT-001/004/COV/MUT minima, rank semantics for the
 * three existing evidence types, requiresCompleteForNegativeVerdict).
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
      supported_frameworks: ['jest', 'vitest', 'mocha'],
      supported_assertion_forms: ['expect-to-be'],
    },
    conflicts: o.conflicts,
  };
  if (o.unestablished !== undefined) {
    record.unestablished_assertions = o.unestablished;
  }
  // TASK 3: the seam (plan D1/D2c) makes `unestablished_assertion` a required
  // evidence type of CT-INT-003, with presence-and-count signal semantics. The
  // synthetic envelope therefore carries the signal record beside the
  // assertion_count record — pre-seam it is ignored by the engine (step 4 loops
  // `required_evidence`, which names only assertion_count at HEAD), post-seam it
  // is the record the completeness policy and the local hook consult. Built
  // here so every decision-matrix case stays decidable in both phases.
  const signal: EvidenceRecord = {
    ...record,
    type: 'unestablished_assertion',
    value: o.unestablished?.count ?? 0,
    unestablished_assertions: o.unestablished ?? { count: 0, reasons: [] },
  };
  return {
    subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
    analysis: {
      status: o.status ?? AnalysisStatus.SUCCESS,
      completeness: Completeness.COMPLETE,
      scope: 'test-body',
      test_type: { value: o.testType ?? TestType.UNIT, source: ClassificationSource.EXPLICIT },
    },
    evidence: { assertion_count: record, unestablished_assertion: signal },
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
    expect(CT_INT_003.analysis_scope).toBe('test-body');
    expect(CT_INT_003.minimum_evidence_completeness).toBe(CollectionStatus.COMPLETE);
    expect(CT_INT_003.unknown_evidence_policy).toBe(RuleResult.INDETERMINATE);
    expect(CT_INT_003.conflicting_evidence_policy).toBe(RuleResult.INDETERMINATE);
  });

  // POST-SEAM (task 3 RED, plan D2c): required_evidence gains the signal type and
  // the evaluation metric moves onto it, so registry guard 3
  // (registry.ts:110-111, metric ∈ required_evidence) still passes and step 7
  // hands the local hook the signal record instead of the assertion_count record.
  it('POST-SEAM: required_evidence is assertion_count plus unestablished_assertion (RED until task 4)', () => {
    expect(CT_INT_003.required_evidence).toEqual(['assertion_count', 'unestablished_assertion']);
  });

  it('POST-SEAM: evaluation.metric is the unestablished_assertion signal record (RED until task 4)', () => {
    expect(CT_INT_003.evaluation.metric).toBe('unestablished_assertion');
    expect(CT_INT_003.evaluation.pass_at_least).toBe(1);
    expect(CT_INT_003.evaluation.fail_at_most).toBe(0);
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

  // POST-SEAM (capability seam): assertion_count is no longer the completeness
  // subject for CT-INT-003, so PARTIAL coverage no longer blocks the FAIL hook.
  it('POST-SEAM: coverage PARTIAL on assertion_count no longer blocks — signal record admits FAIL', () => {
    const { finding } = evaluationOf({
      coverage: CollectionStatus.PARTIAL,
      unestablished: { count: 1, reasons: [CALLBACK_REASON] },
    });
    expect(finding?.result).toBe(RuleResult.FAIL);
  });

  it('INDETERMINATE: UNAVAILABLE availability on the signal record routes through unknown_evidence_policy', () => {
    const { finding } = evaluationOf({
      coverage: CollectionStatus.UNAVAILABLE,
      availability: Availability.UNKNOWN,
      unestablished: { count: 1, reasons: [CALLBACK_REASON] },
    });
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(finding?.reason).toContain('availability is UNKNOWN');
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

  it('POST-SEAM: collects count=1 with the callback reason and yields FAIL via the signal record', () => {
    const collected = collectAnalysis(fixture, TestType.UNIT);
    const scope = evaluateTests(CT_INT_003, collected).find((entry) => entry.test?.line === 9);
    expect(scope).toBeDefined();
    expect(scope?.finding?.result).toBe(RuleResult.FAIL);
    expect(scope?.finding?.reason).toContain(CALLBACK_REASON);

    const record = collected.tests?.[0].evidence.assertion_count;
    expect(record?.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(record?.unestablished_assertions).toEqual({ count: 1, reasons: [CALLBACK_REASON] });
    expect(record?.reason).toContain(CALLBACK_REASON);
    // Signal record present with availability KNOWN (seam).
    expect(collected.tests?.[0].evidence.unestablished_assertion?.availability).toBe(Availability.KNOWN);
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
    // POST-SEAM: the guard keys on availability KNOWN (signal semantics), not
    // coverage COMPLETE, so admit the record by overriding availability.
    const admitted: EvidenceRecord = { ...record, availability: Availability.KNOWN };
    const decision = CT_INT_003.local_decision!(
      {
        ...admitted,
        rule: CT_INT_003,
        record: admitted,
        metricRecord: admitted,
        evidence: { unestablished_assertion: admitted },
        summary: collected.tests?.[0].analysis ?? collected.analysis,
      },
      admitted,
      CT_INT_003,
    );
    expect(decision).toMatchObject({ result: RuleResult.FAIL });
    expect((decision as { reason: string }).reason).toContain(CALLBACK_REASON);
  });

  // TASK 3 — POST-SEAM (plan decisions D1/D2c): evaluateTests on case-08-callback
  // must now return FAIL with the collector's callback reason (the probe
  // assertion_count record has coverage PARTIAL / count 1 / unestablished 1).
  it('POST-SEAM: evaluateTests on case-08-callback yields FAIL with callback reason (RED until task 4)', () => {
    const collected = collectAnalysis(fixture, TestType.UNIT);
    const scope = evaluateTests(CT_INT_003, collected).find((entry) => entry.test?.line === 9);
    expect(scope).toBeDefined();
    expect(scope?.finding?.result).toBe(RuleResult.FAIL);
    expect(scope?.finding?.reason).toContain(CALLBACK_REASON);
  });
});

// ---------------------------------------------------------------------------
// TASK 3 — real-CLI probes (plan task 3 (a)/(b)).
//
// The probes live in tests/fixtures/int003-probes/ (tracked; copied verbatim
// from .opencode/scratch/int003-capability-seam/probes/) and are NEVER jest
// suites of their own (jest.config.js testPathIgnorePatterns
// '<rootDir>/tests/fixtures/'). They are inputs to the REAL CLI, run here
// through the compiled dist/src/cli.js exactly like
// tests/integration/goldens.test.ts runs its fixtures.
//
// Expected (pre-seam, captured verbatim in
// .opencode/scratch/int003-capability-seam/3-tester-notes.md):
//   probe-callback      CT-INT-003 INDETERMINATE (count=1, PARTIAL)
//   probe-nested        CT-INT-003 INDETERMINATE (count=1, PARTIAL)
//   probe-mixed         CT-INT-003 INDETERMINATE x2 (established COMPLETE / unestablished PARTIAL)
//   probe-custom-helper CT-INT-003 INDETERMINATE (INCOMPLETE)
//   CT-INT-001 / CT-INT-004 on every probe: INDETERMINATE (regression guards).
// POST-SEAM (task 4): CT-INT-003 verdicts become FAIL on probes with
// recognized-but-unestablished assertions; CT-INT-001/004 stay byte-identical.
// ---------------------------------------------------------------------------
import { execFileSync } from 'child_process';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'dist', 'src', 'cli.js');
const PROBES = join(REPO_ROOT, 'tests', 'fixtures', 'int003-probes');

function runCli(rule: string, probe: string): string {
  return execFileSync(process.execPath, [CLI, '--test', join(PROBES, probe), '--type', 'UNIT', '--rule', rule], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

function cliFindings(rule: string, probe: string): RuleResult[] {
  const report = JSON.parse(runCli(rule, probe)) as {
    ruleResults?: Array<{ result: RuleResult }>;
    testResults?: Array<{ ruleResults?: Array<{ result: RuleResult }> }>;
  };
  const top = (report.ruleResults ?? []).map((r) => r.result);
  const perTest = (report.testResults ?? []).flatMap((t) => (t.ruleResults ?? []).map((r) => r.result));
  return perTest.length > 0 ? perTest : top;
}

describe('CT-INT-003 real-CLI probes — pre-seam INDETERMINATE, post-seam FAIL', () => {
  it('POST-SEAM: probe-callback FAILS via CT-INT-003 with callback reason (RED until task 4)', () => {
    const verdicts = cliFindings('CT-INT-003', 'probe-callback.test.ts');
    expect(verdicts).toEqual([RuleResult.FAIL]);
    expect(runCli('CT-INT-003', 'probe-callback.test.ts')).toContain(CALLBACK_REASON);
  });

  it('POST-SEAM: probe-nested FAILS via CT-INT-003 (nested-block reason) (RED until task 4)', () => {
    const verdicts = cliFindings('CT-INT-003', 'probe-nested.test.ts');
    expect(verdicts).toEqual([RuleResult.FAIL]);
    expect(runCli('CT-INT-003', 'probe-nested.test.ts')).toContain(NESTED_REASON);
  });

  it('POST-SEAM: probe-mixed FAILS for the unestablished scope via CT-INT-003 (RED until task 4)', () => {
    const verdicts = cliFindings('CT-INT-003', 'probe-mixed.test.ts');
    // established scope: PASS expected post-seam (count=0); unestablished: FAIL.
    expect(verdicts).toContain(RuleResult.FAIL);
    expect(verdicts).not.toContain(RuleResult.INDETERMINATE);
  });

  it('probe-custom-helper stays INDETERMINATE (unclassified evidence — no recognized assertion to FAIL on)', () => {
    const verdicts = cliFindings('CT-INT-003', 'probe-custom-helper.test.ts');
    expect(verdicts).toEqual([RuleResult.INDETERMINATE]);
  });
});

describe('CT-INT-003 real-CLI probes — regression guards (CT-INT-001 / CT-INT-004 unchanged)', () => {
  // probe-mixed has an established scope (PASS) and an unestablished scope
  // (INDETERMINATE) under CT-INT-001/004, so it is excluded from the
  // all-INDETERMINATE assertion; byte-identicality for it is verified via
  // the .now.json / .after.json diff (validation step 4).
  it.each(['probe-callback', 'probe-nested', 'probe-custom-helper'])(
    '%s: CT-INT-001 verdicts stay INDETERMINATE (byte-identical pre/post seam)',
    (probe) => {
      const verdicts = cliFindings('CT-INT-001', `${probe}.test.ts`);
      expect(verdicts.every((v) => v === RuleResult.INDETERMINATE)).toBe(true);
    },
  );

  it.each(['probe-callback', 'probe-nested', 'probe-custom-helper'])(
    '%s: CT-INT-004 verdicts stay INDETERMINATE (byte-identical pre/post seam)',
    (probe) => {
      const verdicts = cliFindings('CT-INT-004', `${probe}.test.ts`);
      expect(verdicts.every((v) => v === RuleResult.INDETERMINATE)).toBe(true);
    },
  );
});
