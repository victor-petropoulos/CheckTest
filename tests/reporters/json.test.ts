/**
 * JSON reporter tests (plan task 1, Option2 acceptance: the report carries the
 * engine's evaluation status).
 *
 * The reporter serializes; it never decides. These tests therefore pin the
 * envelope shape, not any verdict logic — the rules themselves are exercised in
 * tests/core/evaluation.test.ts.
 */

import { toJson, REPORT_SCHEMA_VERSION } from '../../src/reporters/json';
import { evaluateRule, evaluateTests } from '../../src/core/evaluation';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestScopeResult,
  TestType,
} from '../../src/core/analysis';
import { Availability, CollectionStatus, EvidenceRecord, EvidenceStrength, Provenance } from '../../src/core/evidence';
import { RuleMetadata } from '../../src/core/rule';
import { EvaluationStatus, RuleResult } from '../../src/core/result';
import { collectAnalysis } from '../../src/adapters/typescript/collector';
import { CT_INT_001 } from '../../src/rules/ct-int-001';
import { registerRule } from '../../src/rules/registry';
import { runAnalysis } from '../../src/cli';
import { readFileSync } from 'fs';
import { join } from 'path';

const RULE: RuleMetadata = {
  id: 'CT-TEST-000',
  name: 'reporter-test-rule',
  category: 'integrity',
  description: 'Synthetic rule used only to pin the report envelope.',
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

function analysis(status: AnalysisStatus, completeness?: Completeness): AnalysisOutput {
  const record: EvidenceRecord = {
    type: 'assertion_count',
    value: 1,
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
  };
  return {
    subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
    analysis: {
      status,
      completeness:
        completeness ?? (status === AnalysisStatus.FAILED ? Completeness.INCOMPLETE : Completeness.COMPLETE),
      scope: 'test-body',
      test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
    },
    evidence: { assertion_count: record },
    capabilities: { assertion_count: CapabilityStatus.AVAILABLE },
  };
}

function report(status: AnalysisStatus): Record<string, unknown> {
  const output = analysis(status);
  return JSON.parse(toJson(output, evaluateRule(RULE, output))) as Record<string, unknown>;
}

describe('toJson — evaluation status', () => {
  it('reports evaluationStatus EVALUATED and the finding when a verdict was reached', () => {
    const json = report(AnalysisStatus.SUCCESS);
    expect(json.evaluationStatus).toBe(EvaluationStatus.EVALUATED);
    expect(json.ruleResults).toEqual([
      {
        rule_id: RULE.id,
        result: RuleResult.PASS,
        reason: expect.stringContaining('assertion_count=1 >= 1'),
        evidence: ['assertion_count'],
        ruleStatus: 'active',
        description: RULE.description,
        provenance: 'DIRECT',
        availability: 'KNOWN',
        completeness: Completeness.COMPLETE,
      },
    ]);
  });

  it('reports evaluationStatus FAILED with an empty ruleResults array on FAILED', () => {
    const json = report(AnalysisStatus.FAILED);
    expect(json.evaluationStatus).toBe(EvaluationStatus.FAILED);
    expect(json.ruleResults).toEqual([]);
    // The failed scan is never laundered into a verdict or a clean envelope.
    expect(json.analysisStatus).toBe(AnalysisStatus.FAILED);
  });

  it('preserves BOTH conflicting values with their provenance (plan A4)', () => {
    const base = analysis(AnalysisStatus.SUCCESS);
    const record: EvidenceRecord = {
      ...base.evidence.assertion_count,
      // Two providers disagree, so no single value is decided.
      availability: Availability.UNKNOWN,
      conflicts: [
        {
          value: 1,
          source: 'typescript-jest-adapter',
          provenance: Provenance.DIRECT,
          collector_version: '0.1.0',
        },
        {
          value: 2,
          source: 'typescript-jest-regex-stub',
          provenance: Provenance.DERIVED,
          collector_version: '0.1.0',
        },
      ],
    };
    const output: AnalysisOutput = { ...base, evidence: { assertion_count: record } };

    const json = JSON.parse(toJson(output, evaluateRule(RULE, output))) as Record<string, any>;
    const serialized = json.evidence.assertion_count;

    // Neither value nor either provenance is dropped or collapsed into the
    // primary value — a consumer can see exactly who disagreed about what.
    expect(serialized.value).toBe(1);
    expect(serialized.conflicts).toEqual([
      {
        value: 1,
        source: 'typescript-jest-adapter',
        provenance: 'DIRECT',
        collector_version: '0.1.0',
      },
      {
        value: 2,
        source: 'typescript-jest-regex-stub',
        provenance: 'DERIVED',
        collector_version: '0.1.0',
      },
    ]);
  });

  it('keeps analysisStatus and evaluationStatus separate dimensions', () => {
    // UNSUPPORTED: the engine DID decide (INDETERMINATE), so evaluationStatus is
    // EVALUATED while analysisStatus stays UNSUPPORTED — neither collapses.
    const json = report(AnalysisStatus.UNSUPPORTED);
    expect(json.analysisStatus).toBe(AnalysisStatus.UNSUPPORTED);
    expect(json.evaluationStatus).toBe(EvaluationStatus.EVALUATED);
    expect((json.ruleResults as Array<{ result: string }>)[0].result).toBe(RuleResult.INDETERMINATE);
  });

  it('SUCCESS + INCOMPLETE completeness → EVALUATED with an INDETERMINATE rule result (shape 4)', () => {
    const record: EvidenceRecord = {
      type: 'assertion_count',
      value: 1,
      availability: Availability.KNOWN,
      provenance: Provenance.DIRECT,
      source: 'test-adapter',
      collector_version: '0.0.0',
      scope: 'test-body',
      coverage: {
        // PARTIAL is below the rule's COMPLETE minimum, so step 4 of decide()
        // yields INDETERMINATE while the analysis itself completed (SUCCESS).
        status: CollectionStatus.PARTIAL,
        supported_frameworks: ['jest', 'vitest', 'mocha'],
        supported_assertion_forms: ['expect-to-be'],
      },
    };
    const output: AnalysisOutput = {
      ...analysis(AnalysisStatus.SUCCESS, Completeness.INCOMPLETE),
      evidence: { assertion_count: record },
    };
    const json = perTestReport(output);
    expect(json.analysisStatus).toBe(AnalysisStatus.SUCCESS);
    expect(json.completeness).toBe(Completeness.INCOMPLETE);
    expect(json.evaluationStatus).toBe(EvaluationStatus.EVALUATED);
    expect(json.ruleResults).toHaveLength(1);
    expect(json.ruleResults[0].result).toBe(RuleResult.INDETERMINATE);
    expect(json.ruleResults[0].test_id).toBeUndefined();
    expect(json.testResults).toEqual([]);
    expect(json.summary as Record<string, number>).toEqual({
      total: 1,
      pass: 0,
      fail: 0,
      indeterminate: 1,
      not_applicable: 0,
      failed: 0,
    });
  });

  it('determinism: toJson() twice on identical input is byte-identical', () => {
    const output = analysis(AnalysisStatus.SUCCESS);
    const evaluation = evaluateRule(RULE, output);
    const evaluations = evaluateTests(RULE, output);
    const first = toJson(output, evaluation, evaluations);
    const second = toJson(output, evaluation, evaluations);
    expect(second).toBe(first);
  });

  it('adds no test_id to a subject-level (synthetic) finding — exact five keys', () => {
    const json = report(AnalysisStatus.SUCCESS);
    const finding = (json.ruleResults as Array<Record<string, unknown>>)[0];
    // ruleStatus (5.6) joins the four original keys; test_id stays absent.
    expect(Object.keys(finding).sort()).toEqual([
      'availability',
      'completeness',
      'description',
      'evidence',
      'provenance',
      'reason',
      'result',
      'ruleStatus',
      'rule_id',
    ]);
    expect(finding.test_id).toBeUndefined();
  });

  it('emits schemaVersion and the two per-test keys LAST, after the original ones', () => {
    const output = analysis(AnalysisStatus.SUCCESS);
    const json = JSON.parse(toJson(output, evaluateRule(RULE, output))) as Record<string, unknown>;
    const keys = Object.keys(json);
    expect(keys.slice(-3)).toEqual(['schemaVersion', 'testResults', 'summary']);
    expect(json.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    // No per-test records: the subject-level fallback emits an EMPTY array.
    expect(json.testResults).toEqual([]);
  });

  it('emits the optional adapter/decidedBy envelope keys between schemaVersion and the per-test keys (ADR-035)', () => {
    const output: AnalysisOutput = {
      ...analysis(AnalysisStatus.SUCCESS),
      adapter: 'typescript',
      decidedBy: 'extension',
    };
    const json = JSON.parse(toJson(output, evaluateRule(RULE, output))) as Record<string, unknown>;
    expect(Object.keys(json).slice(-5)).toEqual(['schemaVersion', 'adapter', 'decidedBy', 'testResults', 'summary']);
    expect(json.adapter).toBe('typescript');
    expect(json.decidedBy).toBe('extension');
    expect(json.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
  });
});

/**
 * One declaration record with its own value, so each test stands on its own
 * evidence. The id carries the NEW format `<file>#<declaration>@<line>:<index>`
 * (docs/limitations.md §26) — the reporter never rewrites it.
 */
function testScope(name: string, line: number, value: number): TestScopeResult {
  const base = analysis(AnalysisStatus.SUCCESS);
  return {
    test: {
      id: `sample.test.ts#it@${line}:0`,
      name,
      line,
      declaration: 'it',
    },
    analysis: base.analysis,
    evidence: { ...base.evidence, assertion_count: { ...base.evidence.assertion_count, value } },
    declaration_gap: null,
  };
}

/** A file with two declarations: one with an assertion (PASS), one empty (FAIL). */
function twoTestAnalysis(): AnalysisOutput {
  return {
    ...analysis(AnalysisStatus.SUCCESS),
    tests: [testScope('has an assertion', 2, 1), testScope('has none', 5, 0)],
  };
}

function perTestReport(output: AnalysisOutput): Record<string, any> {
  return JSON.parse(toJson(output, evaluateRule(RULE, output), evaluateTests(RULE, output))) as Record<string, any>;
}

describe('toJson — per-test records', () => {
  it('reports one record per declaration, each with its own identity and verdict', () => {
    const json = perTestReport(twoTestAnalysis());
    expect(json.testResults).toHaveLength(2);
    expect(json.testResults[0].test).toEqual({
      id: 'sample.test.ts#it@2:0',
      name: 'has an assertion',
      line: 2,
      declaration: 'it',
    });
    // Each entry carries its OWN analysis/evaluation status and evidence.
    expect(json.testResults[0].analysisStatus).toBe(AnalysisStatus.SUCCESS);
    expect(json.testResults[0].evaluationStatus).toBe(EvaluationStatus.EVALUATED);
    expect(json.testResults[0].completeness).toBe(Completeness.COMPLETE);
    expect(json.testResults[0].evidence.assertion_count.value).toBe(1);
    expect(json.testResults[1].evidence.assertion_count.value).toBe(0);
  });

  it('serializes a MIXED-attribution per-test framework (pytest + unittest) while the subject stays pytest-first', () => {
    const base = analysis(AnalysisStatus.SUCCESS);
    const pytestScope: TestScopeResult = {
      test: {
        id: 'sample_test.py#test_pytest@3:0',
        name: 'test_pytest',
        line: 3,
        declaration: 'def',
        framework: 'pytest',
      },
      analysis: base.analysis,
      evidence: { ...base.evidence, assertion_count: { ...base.evidence.assertion_count, value: 1 } },
      declaration_gap: null,
    };
    const unittestScope: TestScopeResult = {
      test: {
        id: 'sample_test.py#TestThing.test_unittest@8:0',
        name: 'test_unittest',
        line: 8,
        declaration: 'def',
        framework: 'unittest',
      },
      analysis: base.analysis,
      evidence: { ...base.evidence, assertion_count: { ...base.evidence.assertion_count, value: 1 } },
      declaration_gap: null,
    };
    const output: AnalysisOutput = {
      ...base,
      subject: { ...base.subject, framework: 'pytest' },
      tests: [pytestScope, unittestScope],
    };
    const json = perTestReport(output);
    // Each entry reports its OWN framework attribution, not a file-level label.
    expect(json.testResults).toHaveLength(2);
    expect(json.testResults[0].test.framework).toBe('pytest');
    expect(json.testResults[1].test.framework).toBe('unittest');
    // The subject-level framework still resolves pytest-first (mixed -> pytest).
    expect(json.test.framework).toBe('pytest');
  });

  it('never lets a sibling PASS mask a per-test FAIL (plan D1 regression)', () => {
    const json = perTestReport(twoTestAnalysis());
    const results = json.testResults.map((entry: any) => entry.ruleResults[0].result);
    expect(results).toEqual([RuleResult.PASS, RuleResult.FAIL]);
    // Every finding names the test it belongs to.
    expect(json.testResults[1].ruleResults[0].test_id).toBe('sample.test.ts#it@5:0');
    expect(json.testResults[0].ruleResults[0].test_id).toBe('sample.test.ts#it@2:0');
  });

  it('flattens ruleResults in scope order and counts them in summary', () => {
    const json = perTestReport(twoTestAnalysis());
    expect(json.ruleResults.map((finding: any) => [finding.test_id, finding.result])).toEqual([
      ['sample.test.ts#it@2:0', RuleResult.PASS],
      ['sample.test.ts#it@5:0', RuleResult.FAIL],
    ]);
    expect(json.summary).toEqual({
      total: 2,
      pass: 1,
      fail: 1,
      indeterminate: 0,
      not_applicable: 0,
      failed: 1,
    });
  });

  it('reports no per-test records and no test_id when the analysis has none', () => {
    const json = report(AnalysisStatus.UNSUPPORTED);
    expect(json.testResults).toEqual([]);
    expect((json.ruleResults as Array<Record<string, unknown>>)[0].test_id).toBeUndefined();
    // The subject-level fallback still counts as one scope.
    expect((json.summary as Record<string, number>).total).toBe(1);
  });

  it('explicitly empty tests[] → NO synthetic test finding, and none rebuilt from the subject scope (WP1.1)', () => {
    // Pre-fix: the reporter saw `evaluations.length === 0` and re-materialized the
    // subject-level scope, so a SUCCESS file declaring no test was reported as a
    // CT-INT-001-style FAIL with `test: null` — a test that does not exist.
    const output: AnalysisOutput = { ...analysis(AnalysisStatus.SUCCESS), tests: [] };
    const json = perTestReport(output);
    expect(json.ruleResults).toEqual([]);
    expect(json.testResults).toEqual([]);
    expect(json.summary).toEqual({
      total: 0,
      pass: 0,
      fail: 0,
      indeterminate: 0,
      not_applicable: 0,
      failed: 0,
    });
    // The file-level aggregate evidence stays available for legitimate reporting;
    // it is simply never turned into a test-level finding.
    expect((json.evidence as Record<string, any>).assertion_count.value).toBe(1);
    expect(json.analysisStatus).toBe(AnalysisStatus.SUCCESS);
  });

  it('absent tests keeps the documented subject-level fallback (WP1.1 compatibility)', () => {
    const output = analysis(AnalysisStatus.SUCCESS);
    expect(output.tests).toBeUndefined();
    const json = perTestReport(output);
    expect((json.ruleResults as Array<Record<string, unknown>>)[0].test_id).toBeUndefined();
    expect((json.summary as Record<string, number>).total).toBe(1);
  });

  it('reports an aborted evaluation with empty ruleResults and no per-test records', () => {
    const json = report(AnalysisStatus.FAILED);
    expect(json.ruleResults).toEqual([]);
    expect(json.testResults).toEqual([]);
    expect((json.summary as Record<string, number>).failed).toBe(1);
    expect((json.summary as Record<string, number>).total).toBe(1);
  });

  // WP1.2 — contract verification for the no-tests path (behavior exists from
  // WP1.1; these tests pin the contract, they do not introduce it).
  it('no-tests: analysisStatus SUCCESS, evaluationStatus FAILED, empty results, schemaVersion 0.5, completeness COMPLETE', () => {
    const output: AnalysisOutput = { ...analysis(AnalysisStatus.SUCCESS), tests: [] };
    const json = perTestReport(output);

    // The analysis itself completed — SUCCESS, never FAILED.
    expect(json.analysisStatus).toBe(AnalysisStatus.SUCCESS);
    // No scope was evaluated → the shared "no verdict" bucket (UD-8).
    expect(json.evaluationStatus).toBe(EvaluationStatus.FAILED);
    // Zero declarations → no per-test records, no flattened findings.
    expect(json.testResults).toEqual([]);
    expect(json.ruleResults).toEqual([]);
    expect(json.summary as Record<string, number>).toEqual({
      total: 0,
      pass: 0,
      fail: 0,
      indeterminate: 0,
      not_applicable: 0,
      failed: 0,
    });
    expect(json.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(json.completeness).toBe(Completeness.COMPLETE);
  });

  it('no-tests: emits no rule finding — ruleResults length 0, no synthetic verdict', () => {
    const output: AnalysisOutput = { ...analysis(AnalysisStatus.SUCCESS), tests: [] };
    const json = perTestReport(output);
    expect((json.ruleResults as Array<Record<string, unknown>>).length).toBe(0);
  });

  it('no-tests: is not labelled an analysis failure — analysisStatus stays SUCCESS', () => {
    const output: AnalysisOutput = { ...analysis(AnalysisStatus.SUCCESS), tests: [] };
    const json = perTestReport(output);
    expect(json.analysisStatus).not.toBe(AnalysisStatus.FAILED);
    expect(json.analysisStatus).toBe(AnalysisStatus.SUCCESS);
  });
});
describe('toJson — new test id format (phase9 4.4)', () => {
  it('emits the per-line index in every test_id and in testResults[].test.id', () => {
    const json = perTestReport(twoTestAnalysis());
    expect(json.ruleResults.map((finding: any) => finding.test_id)).toEqual([
      'sample.test.ts#it@2:0',
      'sample.test.ts#it@5:0',
    ]);
    expect(json.testResults.map((entry: any) => entry.test.id)).toEqual([
      'sample.test.ts#it@2:0',
      'sample.test.ts#it@5:0',
    ]);
  });

  it('round-trips the REAL collector id (case-24) unchanged — the reporter never rewrites it', () => {
    const file = join(__dirname, '..', 'fixtures', 'ct-int-001', 'case-24-vitest-standard', 'sample.test.ts');
    const output = collectAnalysis(file, TestType.UNIT);
    const json = JSON.parse(
      toJson(output, evaluateRule(CT_INT_001, output), evaluateTests(CT_INT_001, output)),
    ) as Record<string, any>;
    const id = output.tests![0].test.id;
    // The new format the collectors emit: <file>#<declaration>@<line>:<index>.
    expect(id).toMatch(/#it@4:0$/);
    expect(json.ruleResults[0].test_id).toBe(id);
    expect(json.testResults[0].test.id).toBe(id);
  });
});

describe('toJson — finding location (B7 prerequisite)', () => {
  it('serializes a finding location when the evidence record carries one', () => {
    const location = { file: 'sample.test.ts', line: 7, column: 3 };
    const base = analysis(AnalysisStatus.SUCCESS);
    const record: EvidenceRecord = { ...base.evidence.assertion_count, location };
    const output: AnalysisOutput = { ...base, evidence: { assertion_count: record } };
    const json = JSON.parse(toJson(output, evaluateRule(RULE, output))) as Record<string, any>;
    expect(json.ruleResults[0].location).toEqual(location);
  });

  it('omits location when the evidence record has none (never fabricated)', () => {
    const json = report(AnalysisStatus.SUCCESS);
    expect((json.ruleResults as Array<Record<string, unknown>>)[0]).not.toHaveProperty('location');
  });

  it('appends location last in the serialized finding key order', () => {
    const location = { file: 'sample.test.ts', line: 7 };
    const base = analysis(AnalysisStatus.SUCCESS);
    const record: EvidenceRecord = { ...base.evidence.assertion_count, location };
    const output: AnalysisOutput = { ...base, evidence: { assertion_count: record } };
    const json = JSON.parse(toJson(output, evaluateRule(RULE, output))) as Record<string, any>;
    const keys = Object.keys(json.ruleResults[0]);
    expect(keys[keys.length - 1]).toBe('location');
  });
});

describe('toJson — rule lifecycle status (plan 5.6)', () => {
  /** A DEPRECATED rule: evaluated by default, and it names its removal version (D7). */
  const DEPRECATED_RULE: RuleMetadata = {
    ...RULE,
    id: 'CT-TEST-001',
    status: 'deprecated',
    deprecatedSince: '1.11.0',
  };

  it('emits the rule lifecycle status on every finding', () => {
    const json = report(AnalysisStatus.SUCCESS);
    const finding = (json.ruleResults as Array<Record<string, unknown>>)[0];
    expect(finding.ruleStatus).toBe('active');
    // Never an empty string, never absent.
    expect(finding.ruleStatus).not.toBe('');
    expect(finding.ruleStatus).toBeTruthy();
  });

  it('reports a DEPRECATED rule as deprecated and carries its deprecatedSince on the envelope', () => {
    const output = analysis(AnalysisStatus.SUCCESS);
    const json = JSON.parse(toJson(output, evaluateRule(DEPRECATED_RULE, output))) as Record<string, any>;
    expect(json.ruleResults[0].ruleStatus).toBe('deprecated');
    // D7 (reviewer C1): the JSON report states the deprecation version too.
    expect(json.deprecatedSince).toBe('1.11.0');
    expect(json.deprecatedSince).not.toBe('');
  });

  it('carries deprecatedSince on the per-test envelope as well', () => {
    const output = twoTestAnalysis();
    const json = JSON.parse(
      toJson(output, evaluateRule(DEPRECATED_RULE, output), evaluateTests(DEPRECATED_RULE, output)),
    ) as Record<string, any>;
    expect(json.deprecatedSince).toBe('1.11.0');
    for (const entry of json.testResults) {
      expect(entry.deprecatedSince).toBe('1.11.0');
      expect(entry.ruleResults[0].ruleStatus).toBe('deprecated');
    }
  });

  it('omits deprecatedSince entirely for a rule that declares none (never an empty string)', () => {
    const json = report(AnalysisStatus.SUCCESS);
    expect('deprecatedSince' in json).toBe(false);
    expect(json.deprecatedSince).toBeUndefined();
  });
});

/**
 * Contract schema tests (plan 6.5) — pin that every finding in the JSON
 * report carries the documented field set. Per 6.1/6.2/6.3 semantics:
 * present-when-present; absent-by-design never fabricated.
 */
describe('toJson — self-contained finding field contract (plan 6.5)', () => {
  const FULLY_DOCUMENTED_RULE: RuleMetadata = {
    ...RULE,
    id: 'CT-TEST-DOC',
    rationale: 'WHY this rule exists.',
    limitations: 'What this verdict does NOT establish.',
    docsUrl: 'https://example.invalid/rules/CT-TEST-DOC',
  };

  function documentedAnalysis(): AnalysisOutput {
    const base = analysis(AnalysisStatus.SUCCESS);
    const record: EvidenceRecord = {
      ...base.evidence.assertion_count,
      evidenceStrength: EvidenceStrength.EXECUTION_ESTABLISHED,
      location: { file: 'sample.test.ts', line: 3, column: 1 },
    };
    return { ...base, evidence: { assertion_count: record } };
  }

  it('a fully-documented finding carries ALL listed keys with correct values (a)', () => {
    const output = documentedAnalysis();
    const json = JSON.parse(toJson(output, evaluateRule(FULLY_DOCUMENTED_RULE, output))) as Record<string, any>;
    const finding = json.ruleResults[0] as Record<string, unknown>;

    // Required keys (always present)
    expect(finding).toHaveProperty('rule_id');
    expect(finding).toHaveProperty('result');
    expect(finding).toHaveProperty('reason');
    expect(finding).toHaveProperty('evidence');
    expect(finding).toHaveProperty('ruleStatus');

    // Optional keys that are present-when-present (declared by FULLY_DOCUMENTED_RULE)
    expect(finding).toHaveProperty('description');
    expect(finding).toHaveProperty('rationale');
    expect(finding).toHaveProperty('limitations');
    expect(finding).toHaveProperty('docsUrl');
    expect(finding).toHaveProperty('evidenceStrength');
    expect(finding).toHaveProperty('provenance');
    expect(finding).toHaveProperty('availability');
    expect(finding).toHaveProperty('completeness');
    expect(finding).toHaveProperty('location');

    // Values are the source values, verbatim (COPIED not invented)
    expect(finding.description).toBe(FULLY_DOCUMENTED_RULE.description);
    expect(finding.rationale).toBe(FULLY_DOCUMENTED_RULE.rationale);
    expect(finding.limitations).toBe(FULLY_DOCUMENTED_RULE.limitations);
    expect(finding.docsUrl).toBe(FULLY_DOCUMENTED_RULE.docsUrl);
    expect(finding.evidenceStrength).toBe(EvidenceStrength.EXECUTION_ESTABLISHED);
    expect(finding.provenance).toBe(Provenance.DIRECT);
    expect(finding.availability).toBe(Availability.KNOWN);
    expect(finding.completeness).toBe(Completeness.COMPLETE);
  });

  it('a fully-documented per-test finding also carries test_id (a, per-test variant)', () => {
    const output = documentedAnalysis();
    // Add a tests[] with one synthetic per-test scope
    const scope: TestScopeResult = {
      test: { id: 'sample.test.ts#it@3:0', name: 'has an assertion', line: 3, declaration: 'it' },
      analysis: output.analysis,
      evidence: { assertion_count: output.evidence.assertion_count as EvidenceRecord },
      declaration_gap: null,
    };
    const outputWithTest: AnalysisOutput = { ...output, tests: [scope] };
    const json = JSON.parse(
      toJson(
        outputWithTest,
        evaluateRule(FULLY_DOCUMENTED_RULE, outputWithTest),
        evaluateTests(FULLY_DOCUMENTED_RULE, outputWithTest),
      ),
    ) as Record<string, any>;

    const finding = json.ruleResults[0] as Record<string, unknown>;
    expect(finding).toHaveProperty('test_id');
    expect(finding.test_id).toBe('sample.test.ts#it@3:0');
    expect(finding).toHaveProperty('description');
    expect(finding).toHaveProperty('rationale');
    expect(finding).toHaveProperty('limitations');
    expect(finding).toHaveProperty('docsUrl');
    expect(finding).toHaveProperty('evidenceStrength');
    expect(finding).toHaveProperty('provenance');
    expect(finding).toHaveProperty('availability');
    expect(finding).toHaveProperty('completeness');
    expect(finding).toHaveProperty('location');
  });

  it('a minimal finding has base keys only — optional keys absent-by-design (b)', () => {
    const json = report(AnalysisStatus.SUCCESS);
    const finding = (json.ruleResults as Array<Record<string, unknown>>)[0];

    // Required keys (always present)
    expect(finding).toHaveProperty('rule_id');
    expect(finding).toHaveProperty('result');
    expect(finding).toHaveProperty('reason');
    expect(finding).toHaveProperty('evidence');
    expect(finding).toHaveProperty('ruleStatus');
    expect(finding).toHaveProperty('description');
    expect(finding).toHaveProperty('provenance');
    expect(finding).toHaveProperty('availability');
    expect(finding).toHaveProperty('completeness');

    // Optional metadata absent-by-design (RULE declares no rationale/limitations/docsUrl)
    expect(finding).not.toHaveProperty('rationale');
    expect(finding).not.toHaveProperty('limitations');
    expect(finding).not.toHaveProperty('docsUrl');

    // evidenceStrength absent when record carries none (D10 present-when-present)
    expect(finding).not.toHaveProperty('evidenceStrength');

    // test_id absent for subject-level finding (per-test only)
    expect(finding).not.toHaveProperty('test_id');

    // location absent when record carries none (never fabricated)
    expect(finding).not.toHaveProperty('location');
  });
});

describe('toJson — evidenceStrength exposure golden (case-26, real pipeline)', () => {
  // docs/limitations.md §24.4: strength is exposed on JSON evidence records
  // AND findings. probe-mixed has one straight-line test (EXECUTION_ESTABLISHED)
  // and one callback-nested test (SYNTAX_OBSERVED), so one run pins BOTH values.
  const root = join(__dirname, '..', 'fixtures', 'int003-probes');
  const file = join(root, 'probe-mixed.test.ts');

  // Registration is explicit in main() (src/cli.ts:589), never an import side
  // effect — a direct runAnalysis caller registers its rule first, exactly as
  // tests/cli.test.ts does before its own runAnalysis calls.
  beforeAll(() => {
    registerRule(CT_INT_001);
  });

  // runAnalysis is the CLI's own collect→evaluate→serialize composition
  // (src/cli.ts:719), so the golden matches CLI stdout byte-for-byte modulo
  // the fixture-root normalization — including the adapter/decidedBy envelope
  // keys the CLI stamps post-collect (src/cli.ts:760-761).
  function report(): string {
    return runAnalysis({ test: file, type: TestType.UNIT, rules: ['CT-INT-001'], format: 'json' })
      .report.split(root)
      .join('<fixture-root>');
  }

  it('matches the committed byte-exact JSON golden', () => {
    const golden = readFileSync(join(__dirname, 'fixtures', 'case-26.json'), 'utf8');
    expect(report()).toBe(golden);
  });

  it('carries BOTH strengths on evidence records AND findings (§24.4 locations 1+2)', () => {
    const json = JSON.parse(report()) as Record<string, any>;
    // Established scope: straight-line assertion.
    expect(json.testResults[0].evidence.assertion_count.evidenceStrength).toBe(EvidenceStrength.EXECUTION_ESTABLISHED);
    expect(json.testResults[0].ruleResults[0].evidenceStrength).toBe(EvidenceStrength.EXECUTION_ESTABLISHED);
    // Unestablished scope: callback-nested assertion.
    expect(json.testResults[1].evidence.assertion_count.evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
    expect(json.testResults[1].ruleResults[0].evidenceStrength).toBe(EvidenceStrength.SYNTAX_OBSERVED);
    // The flattened list carries the same values in scope order.
    expect(json.ruleResults.map((f: any) => f.evidenceStrength)).toEqual([
      EvidenceStrength.EXECUTION_ESTABLISHED,
      EvidenceStrength.SYNTAX_OBSERVED,
    ]);
  });
  it('carries manifestFramework in test envelope when subject.manifestFramework is set', () => {
    const a = analysis(AnalysisStatus.SUCCESS);
    a.subject = { ...a.subject, framework: 'jest', manifestFramework: 'vitest' } as any;
    const out = JSON.parse(toJson(a, evaluateRule(RULE, a))) as { test: Record<string, any> };
    expect(out.test.manifestFramework).toBe('vitest');
  });

  it('omits manifestFramework from test envelope when subject.manifestFramework is unset', () => {
    const a = analysis(AnalysisStatus.SUCCESS);
    a.subject = { ...a.subject, framework: 'jest' } as any;
    const out = JSON.parse(toJson(a, evaluateRule(RULE, a))) as { test: Record<string, any> };
    expect(out.test.manifestFramework).toBeUndefined();
    expect('manifestFramework' in out.test).toBe(false);
  });
});
