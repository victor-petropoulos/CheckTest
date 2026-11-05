/**
 * CLI + CT-COV-001 integration (WP4.1 task 57 tester audit, acceptance plan:876-882).
 *
 * Covers the seam src/cli.ts `--coverage-report` -> applyCoverageReport ->
 * evaluateRule/evaluateTests, which neither tests/providers/coverage.test.ts
 * (provider units) nor tests/rules/ct-cov-001.test.ts (synthesized records)
 * reach:
 *
 *   a. flag present: PASS/FAIL/INDETERMINATE reach the report with
 *      schemaVersion 0.4 and provider fields in evidence;
 *   b. flag absent: CT-COV-001 INDETERMINATE with the absent-evidence reason,
 *      and CT-INT-001 output byte-identical to the baseline run;
 *   c. stale revision: NO definitive verdict (PASS/FAIL) is ever produced,
 *      driven end-to-end through collectAnalysis -> applyCoverageReport.
 *
 * Same seam as tests/cli.test.ts: main() called directly with stdout/stderr
 * captured. Fixtures are report files written to a per-run temp dir.
 */

import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

import { main } from '../src/cli';
import { collectAnalysis } from '../src/adapters/typescript/collector';
import { applyCoverageReport } from '../src/providers/coverage';
import { evaluateRule, evaluateTests } from '../src/core/evaluation';
import { TestType } from '../src/core/analysis';
import { RuleResult } from '../src/core/result';
import { CT_COV_001 } from '../src/rules/ct-cov-001';

const CASE_ROOT = join(__dirname, 'fixtures', 'ct-int-001');
const CASE_01 = join(CASE_ROOT, 'case-01-standard-assertion', 'sample.test.ts');

const TMP = join(process.env.TMPDIR || '/tmp', 'checktest-cli-coverage');

function report(name: string, body: string): string {
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, name);
  writeFileSync(p, body, 'utf8');
  return p;
}

let stdout = '';
let stderr = '';
let stdoutSpy: jest.SpyInstance;
let stderrSpy: jest.SpyInstance;

beforeEach(() => {
  stdout = '';
  stderr = '';
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  });
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

/** The report the CLI wrote to stdout, parsed (one run, one JSON document). */
function reportJson(): Record<string, any> {
  return JSON.parse(stdout.trim()) as Record<string, any>;
}

function run(argv: string[]): number {
  stdout = '';
  return main(argv);
}

describe('CLI --coverage-report with CT-COV-001', () => {
  it('covered line: PASS, schemaVersion 0.4, provider fields in evidence', () => {
    // case-01 declares one `it` at line 8; dense 0/1 istanbul hit-map, index 7
    // hit -> COMPLETE -> per-decl value 1 -> threshold PASS.
    const p = report('covered.json', JSON.stringify({ covered: { 'sample.test.ts': [0, 0, 0, 0, 0, 0, 0, 1] } }));
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.schemaVersion).toBe('0.4');
    expect(json.ruleResults[0].result).toBe('PASS');
    expect(json.testResults[0].ruleResults[0].result).toBe('PASS');
    const evid = json.testResults[0].evidence.line_coverage;
    expect(evid.provider).toBe('istanbul');
    expect(evid.provider_version).toBe('1.0.0');
    expect(evid.source_revision).toBe('unknown');
    expect(evid.provenance).toBe('EXTERNAL');
    expect(evid.availability).toBe('KNOWN');
    expect(stderr).toBe('');
  });

  it('uncovered line: FAIL with COMPLETE coverage (definitive negative verdict)', () => {
    const p = report('uncovered.json', JSON.stringify({ covered: { 'sample.test.ts': [0, 0, 0, 0, 0, 0, 0, 0] } }));
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.testResults[0].ruleResults[0].result).toBe('FAIL');
    expect(json.summary.fail).toBe(1);
    expect(json.testResults[0].evidence.line_coverage.coverage.status).toBe('COMPLETE');
    expect(stderr).toBe('');
  });

  it('c8-format report drives the verdict too (provider c8 in evidence)', () => {
    const p = report('c8-cli.json', JSON.stringify({ files: { 'sample.test.ts': { coveredLines: [8] } } }));
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.testResults[0].ruleResults[0].result).toBe('PASS');
    expect(json.testResults[0].evidence.line_coverage.provider).toBe('c8');
    expect(json.schemaVersion).toBe('0.4');
  });

  it('no entry for this file: INDETERMINATE with reason, never FAIL', () => {
    // Two mismatching records -> no exact match, no basename match, no
    // single-record fallback -> explicit UNKNOWN record with reason.
    const p = report('nopath.json', JSON.stringify({ covered: { 'x.ts': [1], 'y.ts': [1, 1] } }));
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    expect(json.testResults[0].evidence.line_coverage.availability).toBe('UNKNOWN');
    expect(json.testResults[0].evidence.line_coverage.reason).toContain('no coverage data');
    expect(json.summary.fail).toBe(0);
  });

  it('malformed report: INDETERMINATE with reason, never a fabricated zero', () => {
    const p = report('malformed.json', '{not json');
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.analysisStatus).toBe('SUCCESS');
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    const evid = json.testResults[0].evidence.line_coverage;
    expect(evid.value).toBeNull();
    expect(evid.availability).toBe('UNKNOWN');
    expect(evid.reason).toBeTruthy();
    expect(json.summary.fail).toBe(0);
  });

  it('missing report file: INDETERMINATE, no crash, no FAIL', () => {
    const p = join(TMP, 'does-not-exist.json');
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    expect(stderr).toBe('');
    expect(json.summary.fail).toBe(0);
  });

  it('absent --coverage-report: CT-COV-001 INDETERMINATE with absent-evidence reason', () => {
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001']);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    expect(json.testResults[0].ruleResults[0].reason).toContain(
      "required evidence 'line_coverage' is absent from the analysis envelope",
    );
    expect(json.testResults[0].evidence.line_coverage).toBeUndefined();
    expect(summary(json)).toEqual({ total: 1, pass: 0, fail: 0, indeterminate: 1, not_applicable: 0, failed: 0 });
  });

  it('CT-INT-001 output unchanged with vs without --coverage-report (baseline diff)', () => {
    const p = report('ctint.json', JSON.stringify({ covered: { 'sample.test.ts': [0, 0, 0, 0, 0, 0, 0, 0] } }));

    const baselineCode = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-INT-001']);
    expect(baselineCode).toBe(0);
    const baseline = reportJson();

    const withFlagCode = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-INT-001', '--coverage-report', p]);
    expect(withFlagCode).toBe(0);
    const withFlag = reportJson();

    // The assertion_count verdict/naming is identical either way: external
    // coverage evidence is invisible to rules that do not require it.
    expect(withFlag.ruleResults).toEqual(baseline.ruleResults);
    expect(withFlag.testResults[0].ruleResults).toEqual(baseline.testResults[0].ruleResults);
    expect(withFlag.summary).toEqual(baseline.summary);
    expect(baseline.ruleResults[0].evidence).toEqual(['assertion_count']);
    expect(baseline.ruleResults[0].result).toBe('PASS');
    // The finding itself never consumes line_coverage: identical reason, and
    // the evidence list of the verdict names assertion_count only.
    expect(withFlag.ruleResults[0].evidence).toEqual(['assertion_count']);
    expect(withFlag.ruleResults[0].reason).toBe(baseline.ruleResults[0].reason);
  });

  it('null-entry istanbul map: PARTIAL coverage -> INDETERMINATE even when line reported covered', () => {
    // Coverage.ts:67-73 — any null entry -> PARTIAL, and PARTIAL ranks below
    // the rule minimum COMPLETE, so the engine never decides PASS/FAIL on it.
    const p = report(
      'partial-map.json',
      JSON.stringify({ covered: { 'sample.test.ts': [null, null, null, null, null, null, null, 1] } }),
    );
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.testResults[0].evidence.line_coverage.coverage.status).toBe('PARTIAL');
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    expect(json.testResults[0].ruleResults[0].reason).toContain('below required COMPLETE');
    expect(json.summary.fail).toBe(0);
  });
});

function summary(json: Record<string, any>) {
  return json.summary;
}

describe('stale revision: no definitive verdict (provider -> engine)', () => {
  // CLI passes no revision opts, so staleness can only arrive from a caller
  // supplying analyzedRevision. End-to-end: real fixture analysis, real
  // applyCoverageReport, real engine.
  const STALE_OPTS = { source_revision: 'rev-old', analyzed_revision: 'rev-new' };

  function verdicts(format: 'istanbul' | 'c8', opts: Record<string, string>): RuleResult[] {
    const body =
      format === 'istanbul'
        ? JSON.stringify({ covered: { 'sample.test.ts': [0, 0, 0, 0, 0, 0, 0, 1] } })
        : JSON.stringify({ files: { 'sample.test.ts': { coveredLines: [8] } } });
    const p = report(`stale-${format}.json`, body);
    const analysis = applyCoverageReport(collectAnalysis(CASE_01, TestType.UNIT), p, opts);
    const subject = evaluateRule(CT_COV_001, analysis).finding?.result;
    const perTest = evaluateTests(CT_COV_001, analysis).map((e) => e.finding?.result ?? null);
    return [subject, ...perTest] as RuleResult[];
  }

  it('stale istanbul report: subject and every scope INDETERMINATE, never PASS/FAIL', () => {
    const results = verdicts('istanbul', STALE_OPTS);
    expect(results.length).toBeGreaterThan(1);
    for (const r of results) {
      expect(r).toBe(RuleResult.INDETERMINATE);
      expect(r).not.toBe(RuleResult.PASS);
      expect(r).not.toBe(RuleResult.FAIL);
    }
  });

  it('stale c8 report: verdicts INDETERMINATE with mismatch reason on the record', () => {
    const body = JSON.stringify({ files: { 'sample.test.ts': { coveredLines: [8] } } });
    const p = report('stale-c8b.json', body);
    const analysis = applyCoverageReport(collectAnalysis(CASE_01, TestType.UNIT), p, STALE_OPTS);
    const evid = analysis.evidence.line_coverage;
    expect(evid.availability).toBe('UNKNOWN');
    expect(evid.reason).toContain('mismatch');
    expect(evid.value).toBeUndefined();
    for (const e of evaluateTests(CT_COV_001, analysis)) {
      expect(e.finding?.result).toBe(RuleResult.INDETERMINATE);
    }
    expect(evaluateRule(CT_COV_001, analysis).finding?.result).toBe(RuleResult.INDETERMINATE);
  });

  it('matching revision on the same fixture DOES yield a definitive verdict (control)', () => {
    const results = verdicts('istanbul', { source_revision: 'same', analyzed_revision: 'same' });
    // record KNOWN, non-null COMPLETE array -> per-decl value is a number -> threshold applies
    expect(results.slice(1)).toEqual([RuleResult.PASS]);
  });
});
