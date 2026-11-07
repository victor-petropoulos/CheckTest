/**
 * Task 5 — fixture integration suite (plan §4, the 14-case table).
 *
 * Each case is a fixture file plus a `*.expected.json` sidecar. This suite runs
 * the SAME public seams the CLI will use — `collectAnalysis`, `registerRule` /
 * `getRule`, `evaluateRule` — so there are no test-only backdoors into the
 * collector or the engine. The sidecar is the oracle.
 *
 * Why the fixtures are not jest suites: they are INPUTS to `collectAnalysis`,
 * never executed. They keep the `*.test.ts` names from the plan's file list
 * (task 10's CLI round-trip cites those exact paths) and are excluded from
 * collection via `testPathIgnorePatterns` in jest.config.js, and from the
 * TypeScript program via `exclude` in tsconfig.json — case 10 imports a package
 * that is not a dependency and case 11 is deliberately unparseable.
 *
 * What is asserted per case, per plan task-5 acceptance and KickOff:161 — not
 * merely that a finding exists, but:
 *   - analysis.status and analysis.completeness (two separate dimensions)
 *   - the normalized evidence record (value, availability, provenance, source,
 *     coverage status) plus the substrings its `reason` must explain
 *   - the rule result, or the ABSENCE of one
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { collectAnalysis } from '../../src/adapters/typescript/collector';
import { regexAssertionCount } from '../../src/adapters/typescript/regex-assertion-count';
import { EVIDENCE_ASSERTION_COUNT } from '../../src/adapters/typescript/support';
import { AnalysisOutput, TestType } from '../../src/core/analysis';
import { Availability, EvidenceConflict, EvidenceRecord } from '../../src/core/evidence';
import { evaluateRule, evaluateTests } from '../../src/core/evaluation';
import { EvaluationStatus, RuleFinding, RuleResult } from '../../src/core/result';
import { CT_DEMO_001 } from '../../src/rules/ct-demo-001';
import { CT_INT_001 } from '../../src/rules/ct-int-001';
import { getRule, registerRule } from '../../src/rules/registry';

const FIXTURE_ROOT = join(__dirname, '..', 'fixtures', 'ct-int-001');

/** Explicit and ordered — directory order must not reach the test names. */
const CASES = [
  'case-01-standard-assertion',
  'case-02-no-assertion',
  'case-03-unsupported-api',
  'case-04-custom-helper',
  'case-05-snapshot',
  'case-06-async',
  'case-07-after-return',
  'case-08-callback',
  'case-09-partial-collection',
  'case-10-unsupported-framework',
  'case-11-collector-failure',
  'case-12-unknown-classification',
  'case-13-conflict',
  'case-14-not-applicable',
  'case-15-mixed-framework',
  'case-16-per-test-mixed',
  'case-17-failed-multi-test',
  'case-18-no-tests',
  'case-19-it-only',
  'case-20-unresolved-body',
  'case-21-dynamic-declaration',
  'case-22-conditional-declaration',
  'case-23-compound-callee',
  'case-24-vitest-standard',
  'case-25-vitest-aliased',
  'case-26-vitest-no-runtime-import',
  'case-27-k15-describe-fail',
  'case-28-global-vi',
  'case-29-bare-global-jest',
  'case-30-bare-global-without-expect',
  'case-31-vitest-it-each-array',
  'case-32-vitest-it-each-template',
  'case-33-vitest-it-todo',
  'case-34-vitest-it-skip',
  'case-35-vitest-it-skipif',
  'case-36-vitest-exported-test-fn',
  'case-37-vitest-not-to-throw',
  'case-38-vitest-matchers',
] as const;

interface ExpectedSidecar {
  case: string;
  fixture: string;
  declared_type: TestType;
  rule: string;
  analysis: {
    status: string;
    completeness: string;
    test_type: { value: string; source: string };
  };
  evidence: {
    assertion_count: {
      value: number | null;
      availability: string;
      provenance: string;
      source: string;
      coverage_status: string;
      reason_contains: string[];
    };
  };
  rule_result: string | null;
  conflicts: Array<{ value: unknown; source: string; provenance: string }>;
  /** Case 13 only: run the regex stub and attach it as a conflicting provider. */
  attach_regex_stub_conflict?: boolean;
}

/** Exact projection the sidecar is compared against. */
function project(analysis: AnalysisOutput, finding: RuleFinding | null) {
  const record = analysis.evidence[EVIDENCE_ASSERTION_COUNT];
  return {
    analysis: {
      status: analysis.analysis.status,
      completeness: analysis.analysis.completeness,
      test_type: analysis.analysis.test_type,
    },
    evidence: {
      assertion_count: {
        // JSON has no `undefined`; a record with no value projects to null so
        // the sidecar can state "no value was produced" explicitly.
        value: record.value === undefined ? null : record.value,
        availability: record.availability,
        provenance: record.provenance,
        source: record.source,
        coverage_status: record.coverage.status,
      },
    },
    rule_result: finding === null ? null : finding.result,
    conflicts: (record.conflicts ?? []).map((conflict) => ({
      value: conflict.value,
      source: conflict.source,
      provenance: conflict.provenance,
    })),
  };
}

/**
 * Case 13 only (A4 OPTION A): attach the regex stub's value as a second,
 * conflicting provider on the AST record.
 *
 * The harness does this because milestone-1 ships NO multi-provider aggregator —
 * `evaluateRule` only READS the conflict container, nothing in src/ writes it.
 * Where a real aggregator will live is a later milestone; this keeps the
 * conflict path reachable and assertable today.
 *
 * `availability` drops to UNKNOWN because two providers disagree about the
 * count, so no provider's number can be presented as decided. Under the fixed
 * evaluation order the engine therefore stops at the availability guard; for
 * CT-INT-001 that guard and `conflicting_evidence_policy` are both INDETERMINATE,
 * so the verdict is the same either way, and the conflict guard itself is
 * covered by tests/core/evaluation.test.ts.
 */
function withStubConflict(analysis: AnalysisOutput, sourceText: string): AnalysisOutput {
  const ast = analysis.evidence[EVIDENCE_ASSERTION_COUNT];
  const stub = regexAssertionCount(sourceText);
  const conflicts: EvidenceConflict[] = [
    {
      value: ast.value,
      source: ast.source,
      provenance: ast.provenance,
      collector_version: ast.collector_version,
    },
    {
      value: stub.value,
      source: stub.source,
      provenance: stub.provenance,
      collector_version: stub.collector_version,
    },
  ];
  const record: EvidenceRecord = { ...ast, availability: Availability.UNKNOWN, conflicts };
  return { ...analysis, evidence: { ...analysis.evidence, [EVIDENCE_ASSERTION_COUNT]: record } };
}

registerRule(CT_INT_001);
registerRule(CT_DEMO_001);

function load(caseName: string): { path: string; expected: ExpectedSidecar } {
  // The fixture file name lives in the sidecar, so each case directory stays
  // free to name its input (`sample.test.ts`, or `broken.test.ts` for case 11).
  const manifest = join(FIXTURE_ROOT, caseName, 'sample.expected.json');
  const fallback = join(FIXTURE_ROOT, caseName, 'broken.expected.json');
  const sidecarPath = manifestExists(manifest) ? manifest : fallback;
  const expected = JSON.parse(readFileSync(sidecarPath, 'utf8')) as ExpectedSidecar;
  return { path: join(FIXTURE_ROOT, caseName, expected.fixture), expected };
}

function manifestExists(path: string): boolean {
  try {
    readFileSync(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

describe('CT-INT-001 fixtures (plan §4)', () => {
  it('declares exactly the planned cases (14 + case-15/16/17), each with a sidecar', () => {
    expect(CASES).toHaveLength(38);
    for (const caseName of CASES) {
      expect(load(caseName).expected.case).toBe(caseName);
    }
  });

  describe.each(CASES)('%s', (caseName) => {
    it('matches its expected sidecar', () => {
      const { path, expected } = load(caseName);

      // Rules resolve through the registry — the same lookup the CLI performs.
      const rule = getRule(expected.rule);
      expect(rule).toBeDefined();

      let analysis = collectAnalysis(path, expected.declared_type);
      if (expected.attach_regex_stub_conflict === true) {
        analysis = withStubConflict(analysis, readFileSync(path, 'utf8'));
      }
      const { finding } = evaluateRule(rule as NonNullable<typeof rule>, analysis);

      // A missing rule result is only legitimate when the sidecar expects one.
      // Guards against a harness that returns null and passes everything.
      expect(finding === null).toBe(expected.rule_result === null);

      expect(project(analysis, finding)).toEqual({
        analysis: expected.analysis,
        evidence: expected.evidence.assertion_count
          ? {
              assertion_count: {
                value: expected.evidence.assertion_count.value,
                availability: expected.evidence.assertion_count.availability,
                provenance: expected.evidence.assertion_count.provenance,
                source: expected.evidence.assertion_count.source,
                coverage_status: expected.evidence.assertion_count.coverage_status,
              },
            }
          : undefined,
        rule_result: expected.rule_result,
        conflicts: expected.conflicts,
      });

      // The reason is what makes an unknown/partial value reportable, so the
      // sidecar pins the substrings that must appear rather than the wording.
      const record = analysis.evidence[EVIDENCE_ASSERTION_COUNT];
      for (const fragment of expected.evidence.assertion_count.reason_contains) {
        expect(record.reason).toContain(fragment);
      }
      if (expected.evidence.assertion_count.reason_contains.length === 0) {
        expect(record.reason).toBeUndefined();
      }

      // Every emitted verdict must carry a reason — no silent verdicts.
      if (finding !== null) {
        expect(finding.rule_id).toBe(expected.rule);
        expect(finding.reason).not.toBe('');
      }
    });
  });
});

describe('CT-INT-001 fixture acceptance details (plan task 5)', () => {
  it('case-11 FAILED produces no rule result at all', () => {
    const { path, expected } = load('case-11-collector-failure');
    const analysis = collectAnalysis(path, expected.declared_type);

    expect(analysis.analysis.status).toBe('FAILED');
    // A failed scan is never COMPLETE (SPEC:425).
    expect(analysis.analysis.completeness).not.toBe('COMPLETE');
    // The engine says so EXPLICITLY: status FAILED, not an empty array a reader
    // must interpret, and not a synthetic INDETERMINATE verdict.
    const evaluation = evaluateRule(CT_INT_001, analysis);
    expect(evaluation.status).toBe(EvaluationStatus.FAILED);
    expect(evaluation.finding).toBeNull();
    expect([evaluation.finding].filter((entry) => entry !== null)).toEqual([]);
  });

  it('case-13 preserves BOTH conflicting values with their provenance', () => {
    const { path, expected } = load('case-13-conflict');
    const sourceText = readFileSync(path, 'utf8');
    const ast = collectAnalysis(path, expected.declared_type);
    const stub = regexAssertionCount(sourceText);

    // The two providers must genuinely disagree, or the fixture proves nothing.
    expect(ast.evidence[EVIDENCE_ASSERTION_COUNT].value).toBe(1);
    expect(stub.value).toBe(2);
    expect(ast.evidence[EVIDENCE_ASSERTION_COUNT].provenance).toBe('DIRECT');
    expect(stub.provenance).toBe('DERIVED');

    const merged = withStubConflict(ast, sourceText);
    const conflicts = merged.evidence[EVIDENCE_ASSERTION_COUNT].conflicts ?? [];
    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((conflict) => conflict.value)).toEqual([1, 2]);
    expect(conflicts.map((conflict) => conflict.provenance)).toEqual(['DIRECT', 'DERIVED']);
    // Both providers stay attributable, and both are version-stamped.
    expect(conflicts.map((conflict) => conflict.source)).toEqual([
      'typescript-jest-adapter',
      'typescript-jest-regex-stub',
    ]);
    for (const conflict of conflicts) {
      expect(conflict.collector_version).toBe('0.1.0');
    }
    expect(evaluateRule(CT_INT_001, merged).finding?.result).toBe('INDETERMINATE');
  });

  it('case-14 N/A comes from applicability, not from weak evidence', () => {
    const { path, expected } = load('case-14-not-applicable');
    const analysis = collectAnalysis(path, TestType.COMPONENT);
    const record = analysis.evidence[EVIDENCE_ASSERTION_COUNT];

    // The evidence here would PASS — so N/A can only be the applicability guard.
    expect(record.availability).toBe('KNOWN');
    expect(record.coverage.status).toBe('COMPLETE');
    expect(evaluateRule(CT_DEMO_001, analysis).finding?.result).toBe('N/A');
    expect(evaluateRule(CT_INT_001, analysis).finding?.result).toBe('PASS');
  });

  it('covers PASS, FAIL, INDETERMINATE and N/A at least once (DoD item 4)', () => {
    const results = CASES.map((caseName) => load(caseName).expected.rule_result);
    expect(results).toContain('PASS');
    expect(results).toContain('FAIL');
    expect(results).toContain('INDETERMINATE');
    expect(results).toContain('N/A');
    // Cases 11 and 17 are the FAILED-scan cases: each must emit NO result at all
    // (DoD item 5) — the engine aborts at step 0 instead of inventing a verdict.
    expect(CASES.filter((caseName, index) => results[index] === null)).toEqual([
      'case-11-collector-failure',
      'case-17-failed-multi-test',
    ]);
  });
});

/**
 * GROUP P — per-test (plan §4). P1, P2, P3, P4 and P6 are already asserted at
 * the unit level (collector.test.ts per-test records; evaluation.test.ts
 * evaluateTests; reporters/json.test.ts D1 leak), so only the cases not yet
 * covered are added here: P5 (`it.each` → own record, UNKNOWN, never FAIL) and
 * P7 (assertion after unconditional return in A → A INDETERMINATE, sibling B
 * unchanged). Each is a named `it(...)`; no src/ is touched.
 */
describe('GROUP P — per-test (plan §4)', () => {
  const tempDirs: string[] = [];
  function writeFixture(source: string, name = 'sample.test.ts'): string {
    const dir = mkdtempSync(join(tmpdir(), 'checktest-group-p-'));
    tempDirs.push(dir);
    const file = join(dir, name);
    writeFileSync(file, source, 'utf8');
    return file;
  }
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const JEST = "import { expect, it } from '@jest/globals';\n";

  it('P8 (WP1.1): a real SUCCESS file with NO declarations → tests: [] → ZERO evaluations, no finding', () => {
    const file = writeFixture(JEST + 'const noop = 1;\nexport { noop };\n');
    const output = collectAnalysis(file, TestType.UNIT);
    // The collector SUPPLIED an empty collection — that is not the same state as
    // a legacy envelope that never carried the field at all.
    expect(output.analysis.status).toBe('SUCCESS');
    expect(output.tests).toEqual([]);
    expect(evaluateTests(CT_INT_001, output)).toEqual([]);
  });

  it('P5: it.each gets its own record, availability UNKNOWN, never FAIL', () => {
    const file = writeFixture(
      JEST +
        "it.each([[1, 2]])('adds %i', (a: number, b: number) => {\n" +
        '  expect(a + b).toBe(b);\n' +
        '});\n' +
        "it('asserted', () => { expect(1).toBe(1); });\n",
    );
    const output = collectAnalysis(file, TestType.UNIT);
    const tests = output.tests ?? [];
    expect(tests).toHaveLength(2);
    // `it.each` is a declaration with its own identity (form + line), never
    // folded into the sibling test's record.
    const each = tests.find((t) => t.test.declaration === 'it.each');
    expect(each).toBeDefined();
    const eachRecord = each!.evidence[EVIDENCE_ASSERTION_COUNT];
    expect(eachRecord.value).toBeUndefined();
    expect(eachRecord.availability).toBe(Availability.UNKNOWN);
    expect(each!.declaration_gap).toContain("'it.each'");
    // The sibling asserted test carries its own KNOWN value.
    const asserted = tests.find((t) => t.test.name === 'asserted');
    expect(asserted).toBeDefined();
    expect(asserted!.evidence[EVIDENCE_ASSERTION_COUNT].value).toBe(1);
    expect(asserted!.evidence[EVIDENCE_ASSERTION_COUNT].availability).toBe(Availability.KNOWN);
    // Rule evaluation: `it.each` can never be read as a zero-assertion FAIL
    // (conservative) → INDETERMINATE; the sibling verdict is unaffected → PASS.
    const results = evaluateTests(CT_INT_001, output);
    const eachResult = results.find((r) => r.test?.declaration === 'it.each');
    expect(eachResult).toBeDefined();
    expect(eachResult!.finding?.result).toBe(RuleResult.INDETERMINATE);
    const assertedResult = results.find((r) => r.test?.name === 'asserted');
    expect(assertedResult!.finding?.result).toBe(RuleResult.PASS);
  });

  it('P7: assertion after unconditional return in A → A INDETERMINATE, sibling B unchanged', () => {
    const file = writeFixture(
      JEST + "it('A', () => { return; expect(1).toBe(1); });\n" + "it('B', () => { expect(2).toBe(2); });\n",
    );
    const output = collectAnalysis(file, TestType.UNIT);
    const tests = output.tests ?? [];
    expect(tests).toHaveLength(2);
    const a = tests.find((t) => t.test.name === 'A');
    const b = tests.find((t) => t.test.name === 'B');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // A's assertion is unreachable: no established count, UNKNOWN availability.
    const aRecord = a!.evidence[EVIDENCE_ASSERTION_COUNT];
    expect(aRecord.value).toBe(0);
    expect(aRecord.availability).toBe(Availability.UNKNOWN);
    // B is fully established and unaffected by A's control flow.
    const bRecord = b!.evidence[EVIDENCE_ASSERTION_COUNT];
    expect(bRecord.value).toBe(1);
    expect(bRecord.availability).toBe(Availability.KNOWN);
    const results = evaluateTests(CT_INT_001, output);
    const aResult = results.find((r) => r.test?.name === 'A');
    const bResult = results.find((r) => r.test?.name === 'B');
    expect(aResult).toBeDefined();
    expect(bResult).toBeDefined();
    expect(aResult!.finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(bResult!.finding?.result).toBe(RuleResult.PASS);
    // Sibling isolation: A being INDETERMINATE never downgrades B's PASS.
    expect(bResult!.finding?.reason).not.toContain('A');
  });
});

/**
 * K-15 (B4): zero `FAIL` ruleResults were ever produced in any
 * `validation/*-report.json` run. The engine has had the FAIL threshold since
 * task 4 (evaluation.ts: value <= fail_at_most with COMPLETE coverage), but no
 * test pinned the verdict END-TO-END for a describe-wrapped zero-assertion
 * test — the fixture shape K-15 is about. This characterizes it: a COMPLETE
 * scan of a declared test with no assertion must report FAIL, both at the file
 * scope and on the test's own per-test record.
 */
describe('K-15 — FAIL characterization (B4)', () => {
  const tempDirs: string[] = [];
  function writeFixture(source: string, name = 'sample.test.ts'): string {
    const dir = mkdtempSync(join(tmpdir(), 'checktest-k15-'));
    tempDirs.push(dir);
    const file = join(dir, name);
    writeFileSync(file, source, 'utf8');
    return file;
  }
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('describe-wrapped test with zero assertions, COMPLETE scan → CT-INT-001 FAIL', () => {
    const file = writeFixture(
      "import { expect, it } from '@jest/globals';\n" +
        "describe('x', () => {\n" +
        "  it('y', () => {\n" +
        '  });\n' +
        '});\n',
    );
    const output = collectAnalysis(file, TestType.UNIT);

    // The scan must be COMPLETE, or engine step asymmetry buys INDETERMINATE.
    expect(output.analysis.status).toBe('SUCCESS');
    expect(output.analysis.completeness).toBe('COMPLETE');

    // Zero was MEASURED under a completed scan — a proved zero, not a gap.
    const record = output.evidence[EVIDENCE_ASSERTION_COUNT];
    expect(record.value).toBe(0);
    expect(record.coverage.status).toBe('COMPLETE');
    expect(record.availability).toBe(Availability.KNOWN);

    // File scope: value 0 <= fail_at_most 0 on COMPLETE coverage → FAIL.
    const evaluation = evaluateRule(CT_INT_001, output);
    expect(evaluation.finding?.result).toBe(RuleResult.FAIL);

    // Per-test scope: the declared test's own record reaches the same verdict.
    const results = evaluateTests(CT_INT_001, output);
    const perTest = results.find((r) => r.test?.name === 'y');
    expect(perTest).toBeDefined();
    expect(perTest!.finding?.result).toBe(RuleResult.FAIL);
  });
});
