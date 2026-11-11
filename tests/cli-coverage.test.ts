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
import { RuleFinding, RuleResult } from '../src/core/result';
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

describe('CLI --coverage-report with CT-COV-001 (active: evidence attaches, verdicts emitted)', () => {
  it('istanbul report: structured evidence attached, ruleResults empty, no verdict (exit 2)', () => {
    // case-01 declares one `it`; dense 0/1 istanbul hit-map. WP1.3 fail-closed
    // join keys on the analyzed file's exact normalized path — an absolute key
    // for the fixture path matches the CLI's cwd-resolved subject. The report
    // carries no revision -> revision 'unknown' + git HEAD analyzed => UNAVAILABLE.
    const key = join(process.cwd(), 'tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts');
    const p = report('covered.json', JSON.stringify({ covered: { [key]: [0, 0, 0, 0, 0, 0, 0, 1] } }));
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0); // active rule: INDETERMINATE is a verdict
    const json = reportJson();
    expect(json.schemaVersion).toBe('0.4');
    expect(json.evaluationStatus).toBe('EVALUATED');
    expect(json.ruleResults).toHaveLength(1);
    expect(json.ruleResults[0].result).toBe('INDETERMINATE');
    expect(json.testResults).toHaveLength(1);
    expect(json.testResults[0].ruleResults).toHaveLength(1);
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    expect(json.summary).toEqual({ total: 1, pass: 0, fail: 0, indeterminate: 1, not_applicable: 0, failed: 0 });
    // Evidence still reaches the report with full structured fields.
    const evid = json.testResults[0].evidence.line_coverage;
    expect(evid.provider).toBe('istanbul');
    expect(evid.provider_version).toBe('1.0.0');
    expect(evid.source_revision).toBe('unknown');
    expect(evid.provenance).toBe('EXTERNAL');
    expect(evid.availability).toBe('UNKNOWN');
    expect(evid.coverage.status).toBe('UNAVAILABLE');
    expect(evid.value).toBeNull();
    expect(evid.reason).toBe('report revision unknown; freshness cannot be established');
    expect(stderr).toBe('');
  });

  it('uncovered line: never a definitive FAIL under a draft rule', () => {
    const p = report('uncovered.json', JSON.stringify({ covered: { 'sample.test.ts': [0, 0, 0, 0, 0, 0, 0, 0] } }));
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.testResults[0].ruleResults).toHaveLength(1);
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    expect(json.summary.fail).toBe(0);
    expect(json.summary.failed).toBe(0); // active: INDETERMINATE is a verdict, not a failure
    const evid = json.testResults[0].evidence.line_coverage;
    expect(evid.availability).toBe('UNKNOWN');
    expect(evid.coverage.status).toBe('UNAVAILABLE');
    expect(evid.value).toBeNull();
    expect(stderr).toBe('');
  });

  it('c8-format report: provider c8 in evidence, no verdict', () => {
    const key = join(process.cwd(), 'tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts');
    const p = report('c8-cli.json', JSON.stringify({ files: { [key]: { coveredLines: [8] } } }));
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.schemaVersion).toBe('0.4');
    expect(json.testResults[0].ruleResults).toHaveLength(1);
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    const evid = json.testResults[0].evidence.line_coverage;
    expect(evid.provider).toBe('c8');
    expect(evid.provider_version).toBe('1.0.0');
    expect(evid.source_revision).toBe('unknown');
    expect(evid.availability).toBe('UNKNOWN');
    expect(evid.coverage.status).toBe('UNAVAILABLE');
    expect(evid.reason).toBe('report revision unknown; freshness cannot be established');
  });

  it('no entry for this file: UNKNOWN record "no coverage data", no verdict', () => {
    // No exact match, no basename match, no sole-entry fallback -> explicit
    // UNKNOWN record with reason; the draft rule still emits no verdict.
    const p = report('nopath.json', JSON.stringify({ covered: { 'x.ts': [1], 'y.ts': [1, 1] } }));
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.testResults[0].ruleResults).toHaveLength(1);
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    expect(json.summary.fail).toBe(0);
    const evid = json.testResults[0].evidence.line_coverage;
    expect(evid.availability).toBe('UNKNOWN');
    expect(evid.coverage.status).toBe('UNAVAILABLE');
    expect(evid.value).toBeNull();
    expect(evid.reason).toContain('no coverage data');
    expect(stderr).toBe('');
  });

  it('malformed report: UNKNOWN record with reason, never a fabricated zero', () => {
    const p = report('malformed.json', '{not json');
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.analysisStatus).toBe('SUCCESS');
    expect(json.testResults[0].ruleResults).toHaveLength(1);
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    const evid = json.testResults[0].evidence.line_coverage;
    expect(evid.value).toBeNull();
    expect(evid.availability).toBe('UNKNOWN');
    expect(evid.reason).toBeTruthy();
    expect(json.summary.fail).toBe(0);
    expect(stderr).toBe('');
  });

  it('missing report file: UNKNOWN record, no crash, no FAIL', () => {
    const p = join(TMP, 'does-not-exist.json');
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--coverage-report', p]);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.testResults[0].ruleResults).toHaveLength(1);
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    expect(stderr).toBe('');
    expect(json.summary.fail).toBe(0);
  });

  it('absent --coverage-report: no line_coverage evidence, no verdict', () => {
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001']);

    expect(code).toBe(0);
    const json = reportJson();
    expect(json.testResults[0].evidence.line_coverage).toBeUndefined();
    expect(json.testResults[0].ruleResults).toHaveLength(1);
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
    expect(json.summary).toEqual({ total: 1, pass: 0, fail: 0, indeterminate: 1, not_applicable: 0, failed: 0 });
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
});

function summary(json: Record<string, any>) {
  return json.summary;
}

describe('stale revision: no definitive verdict (provider -> engine)', () => {
  // CLI passes no revision opts, so staleness is driven here directly:
  // real fixture analysis, real applyCoverageReport, real engine.
  const STALE_OPTS = { source_revision: 'rev-old', analyzed_revision: 'rev-new' };
  const FIX_KEY = join(process.cwd(), 'tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts');

  function verdicts(format: 'istanbul' | 'c8', opts: Record<string, string>): (RuleFinding | null)[] {
    const body =
      format === 'istanbul'
        ? JSON.stringify({ covered: { [FIX_KEY]: [0, 0, 0, 0, 0, 0, 0, 1] } })
        : JSON.stringify({ files: { [FIX_KEY]: { coveredLines: [8] } } });
    const p = report(`stale-${format}.json`, body);
    const analysis = applyCoverageReport(collectAnalysis(CASE_01, TestType.UNIT), p, opts);
    const subject = evaluateRule(CT_COV_001, analysis).finding ?? null;
    const perTest = evaluateTests(CT_COV_001, analysis).map((e) => e.finding ?? null);
    return [subject, ...perTest] as (RuleFinding | null)[];
  }

  it('stale istanbul report: evidence UNAVAILABLE + mismatch reason, every scope null (draft)', () => {
    const key = join(process.cwd(), 'tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts');
    const body = JSON.stringify({ covered: { [key]: [0, 0, 0, 0, 0, 0, 0, 1] } });
    const p = report('stale-istanbul.json', body);
    const analysis = applyCoverageReport(collectAnalysis(CASE_01, TestType.UNIT), p, STALE_OPTS);
    const evid = analysis.evidence.line_coverage;
    expect(evid.availability).toBe('UNKNOWN');
    expect(evid.coverage.status).toBe('UNAVAILABLE');
    expect(evid.value).toBeUndefined();
    expect(evid.reason).toContain('mismatch');
    expect(evid.reason).toContain('rev-old');
    expect(evid.reason).toContain('rev-new');
    const results = verdicts('istanbul', STALE_OPTS);
    expect(results.length).toBeGreaterThan(1);
    for (const r of results) {
      expect(r?.result).toBe('INDETERMINATE');
    }
  });

  it('stale c8 report: verdicts null with mismatch reason on the record', () => {
    const key = join(process.cwd(), 'tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts');
    const body = JSON.stringify({ files: { [key]: { coveredLines: [8] } } });
    const p = report('stale-c8b.json', body);
    const analysis = applyCoverageReport(collectAnalysis(CASE_01, TestType.UNIT), p, STALE_OPTS);
    const evid = analysis.evidence.line_coverage;
    expect(evid.availability).toBe('UNKNOWN');
    expect(evid.reason).toContain('mismatch');
    expect(evid.value).toBeUndefined();
    for (const e of evaluateTests(CT_COV_001, analysis)) {
      expect(e.finding?.result).toBe('INDETERMINATE');
    }
    expect(evaluateRule(CT_COV_001, analysis).finding?.result).toBe('INDETERMINATE');
  });

  it('unknown revision + analyzed supplied -> UNAVAILABLE, reason "report revision unknown; freshness cannot be established"', () => {
    const key = join(process.cwd(), 'tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts');
    const body = JSON.stringify({ covered: { [key]: [0, 0, 0, 0, 0, 0, 0, 1] } });
    const p = report('rev-unknown.json', body);
    const analysis = applyCoverageReport(collectAnalysis(CASE_01, TestType.UNIT), p, {
      analyzed_revision: 'rev1',
    });
    const evid = analysis.evidence.line_coverage;
    expect(evid.availability).toBe('UNKNOWN');
    expect(evid.coverage.status).toBe('UNAVAILABLE');
    expect(evid.value).toBeUndefined();
    expect(evid.reason).toBe('report revision unknown; freshness cannot be established');
    expect(evaluateRule(CT_COV_001, analysis).finding?.result).toBe('INDETERMINATE');
  });

  it('matching revision -> evidence KNOWN/COMPLETE, still no verdict (draft)', () => {
    const results = verdicts('istanbul', { source_revision: 'same', analyzed_revision: 'same' });
    const body = JSON.stringify({ covered: { [FIX_KEY]: [0, 0, 0, 0, 0, 0, 0, 1] } });
    const p = report('rev-match.json', body);
    const analysis = applyCoverageReport(collectAnalysis(CASE_01, TestType.UNIT), p, {
      source_revision: 'same',
      analyzed_revision: 'same',
    });
    const evid = analysis.evidence.line_coverage;
    expect(evid.availability).toBe('KNOWN');
    expect(evid.coverage.status).toBe('COMPLETE');
    expect(evid.value).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    // Record is decidable, but the draft rule still emits no finding.
    expect(results[0]?.result).toBe('INDETERMINATE'); // subject: array value not thresholdable (unmapped exact-match file record)
    expect(evaluateRule(CT_COV_001, analysis).finding?.result).toBe('INDETERMINATE');
  });
});

describe('--per-test-run flag (CT-COV-001 unit A)', () => {
  it('accepted as a boolean flag: last-argument position consumes no value', () => {
    // A value-consuming switch would throw "missing value for '--per-test-run'"
    // here, which is the regression this test pins.
    const code = run(['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001', '--per-test-run']);

    expect(stderr).toBe('');
    expect(code).toBe(0);
    // No report supplied -> nothing to mark, and no verdict moves.
    expect(reportJson().testResults[0].evidence.line_coverage).toBeUndefined();
  });

  it('--help lists --per-test-run', () => {
    const code = run(['--help']);

    expect(code).toBe(0);
    expect(stdout).toContain('--per-test-run');
  });

  // Still byte-identical under unit B, because the CLI injects `analyzedRevision`
  // = git HEAD while the report carries no revision -> revision 'unknown' +
  // analyzed set => UNAVAILABLE (cli.ts:294-312). Unit B's numeric per-declaration
  // path needs a KNOWN + COMPLETE target, so the stale report keeps every record
  // advisory and the marker moves nothing here. The numeric-on-the-wire proof
  // lives in tests/providers/coverage.test.ts (provider -> toJson, KNOWN state).
  it('with report + map: report is byte-identical to the unmarked run and never carries the field', () => {
    const body = JSON.stringify({ covered: { 'to.ts': [0, 0, 0, 0, 0, 0, 0, 1] } });
    const plainCode = run([
      '--test',
      CASE_01,
      '--type',
      'UNIT',
      '--rule',
      'CT-COV-001',
      '--coverage-report',
      report('ptr-cli-plain.json', body),
      '--coverage-map',
      `${CASE_01}=to.ts`,
    ]);
    expect(plainCode).toBe(0);
    const plain = stdout;

    const markedCode = run([
      '--test',
      CASE_01,
      '--type',
      'UNIT',
      '--rule',
      'CT-COV-001',
      '--coverage-report',
      report('ptr-cli-marked.json', body),
      '--coverage-map',
      `${CASE_01}=to.ts`,
      '--per-test-run',
    ]);

    expect(markedCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toBe(plain);
    expect(stdout).not.toContain('per_test_run');
  });

  it('--coverage-map validation is unaffected by the new flag', () => {
    const p = report('ptr-cli-bad-map.json', JSON.stringify({ covered: { 'to.ts': [1] } }));
    const code = run([
      '--test',
      CASE_01,
      '--rule',
      'CT-COV-001',
      '--coverage-report',
      p,
      '--per-test-run',
      '--coverage-map',
      'no-equals-sign',
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("invalid --coverage-map 'no-equals-sign'");
  });
});
