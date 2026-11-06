/**
 * CLI exit-code tests (plan task 2/I; src/cli.ts contract).
 *
 * The CLI maps the SET of scope evaluations, NEVER `analysis.status`:
 *
 *   EvaluationStatus.EVALUATED (any verdict) -> 0
 *   EvaluationStatus.FAILED (no verdict)     -> 2
 *   usage error / crash                      -> 1
 *
 * Under the FAILED-first order (plan task 4, D2) a FAILED analysis can NEVER
 * yield a verdict: the engine aborts before rule evaluation (SPEC:374/405), so
 * no applicability N/A or UNKNOWN-type INDETERMINATE reaches the report and
 * every FAILED analysis exits 2.
 *
 * These tests drive `main()` through the SAME public seams as a shell run —
 * real fixtures on disk, real collector, real engine — and capture stdout /
 * stderr so both the exit code and the emitted report are pinned together. A
 * decided FAIL or an UNSUPPORTED analysis are still successful analyses, so
 * they exit 0; only an evaluation that produced no verdict at all exits 2.
 */

import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

import { main } from '../src/cli';

const CASE_ROOT = join(__dirname, 'fixtures', 'ct-int-001');

function fixture(caseName: string, file = 'sample.test.ts'): string {
  return join(CASE_ROOT, caseName, file);
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

/** The report the CLI wrote to stdout, parsed. Throws if it is not valid JSON. */
function report(): Record<string, any> {
  return JSON.parse(stdout) as Record<string, any>;
}

describe('CLI exit codes', () => {
  it('case-01 PASS -> exit 0', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT']);
    expect(code).toBe(0);
    expect(report().ruleResults[0].result).toBe('PASS');
  });

  it('case-02 FAIL -> exit 0 (a decided FAIL is a successful analysis)', () => {
    const code = main(['--test', fixture('case-02-no-assertion'), '--type', 'UNIT']);
    expect(code).toBe(0);
    const json = report();
    expect(json.analysisStatus).toBe('SUCCESS');
    expect(json.ruleResults[0].result).toBe('FAIL');
  });

  it('case-10 UNSUPPORTED analysis -> exit 0 (INDETERMINATE is still a verdict)', () => {
    const code = main(['--test', fixture('case-10-unsupported-framework'), '--type', 'UNIT']);
    expect(code).toBe(0);
    const json = report();
    expect(json.analysisStatus).toBe('UNSUPPORTED');
    expect(json.evaluationStatus).toBe('EVALUATED');
    expect(json.ruleResults[0].result).toBe('INDETERMINATE');
  });

  it('case-11 FAILED analysis -> exit 2 with evaluationStatus FAILED and NO rule result', () => {
    const code = main(['--test', fixture('case-11-collector-failure', 'broken.test.ts'), '--type', 'UNIT']);
    expect(code).toBe(2);
    const json = report();
    expect(json.analysisStatus).toBe('FAILED');
    expect(json.evaluationStatus).toBe('FAILED');
    // The abort is never laundered into a verdict or a silent empty report.
    expect(json.ruleResults).toEqual([]);
  });

  it('case-09 SUCCESS + INCOMPLETE -> exit 0: an INDETERMINATE scope counts as EVALUATED (UD-8)', () => {
    const code = main(['--test', fixture('case-09-partial-collection'), '--type', 'UNIT']);
    expect(code).toBe(0);
    const json = report();
    expect(json.analysisStatus).toBe('SUCCESS');
    expect(json.completeness).toBe('INCOMPLETE');
    expect(json.evaluationStatus).toBe('EVALUATED');
    expect(json.ruleResults[0].result).toBe('INDETERMINATE');
  });

  it('case-16 per-test mixed -> exit 0: one PASS + one FAIL, both decided', () => {
    const code = main(['--test', fixture('case-16-per-test-mixed'), '--type', 'UNIT']);
    expect(code).toBe(0);
    const json = report();
    expect(json.analysisStatus).toBe('SUCCESS');
    expect(json.evaluationStatus).toBe('EVALUATED');
    const results = json.testResults.map((r: any) => r.ruleResults[0].result);
    expect(results).toEqual(['PASS', 'FAIL']);
    expect(json.summary).toEqual({
      total: 2,
      pass: 1,
      fail: 1,
      indeterminate: 0,
      not_applicable: 0,
      failed: 1,
    });
  });

  it('usage error (missing --test) -> exit 1 with usage on stderr, no report on stdout', () => {
    const code = main([]);
    expect(code).toBe(1);
    expect(stderr).toContain('--test <path> is required');
    expect(stderr).toContain('Usage: checktest');
    expect(stdout).toBe('');
  });

  it('USAGE text documents the no-tests exit-2 case', () => {
    const code = main([]);
    expect(code).toBe(1);
    expect(stderr).toContain('Usage: checktest');
    // UD-8 / DPC-8: exit 2 covers a file that declares no tests.
    expect(stderr).toContain('declares no tests');
    expect(stderr).toContain('2 when the engine');
  });

  it('usage error (unknown flag) -> exit 1', () => {
    const code = main(['--bogus', 'x']);
    expect(code).toBe(1);
    expect(stderr).toContain("unknown argument '--bogus'");
  });

  it('usage error (invalid --type value) -> exit 1', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'SMOKE']);
    expect(code).toBe(1);
    expect(stderr).toContain("invalid --type 'SMOKE'");
  });

  it("'check' prefix produces identical stdout to bare invocation", () => {
    const bareArgs = ['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT'];
    const bareCode = main(bareArgs);
    const bareStdout = stdout;
    stdout = '';
    const prefixedCode = main(['check', ...bareArgs]);
    expect(bareCode).toBe(0);
    expect(prefixedCode).toBe(0);
    expect(stdout).toBe(bareStdout);
  });

  it('--version exits 0 and prints 1.1.0', () => {
    const code = main(['--version']);
    expect(code).toBe(0);
    expect(stdout).toBe('1.1.0\n');
    expect(stderr).toBe('');
  });

  it('--help exits 0 and contains Usage: checktest', () => {
    const code = main(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: checktest');
    expect(stderr).toBe('');
  });

  it('-h exits 0 and contains Usage: checktest', () => {
    const code = main(['-h']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: checktest');
  });

  it('no args exits 1', () => {
    const code = main([]);
    expect(code).toBe(1);
  });

  it('case-01 PASS -> exit 0, one per-test record, schemaVersion present', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT']);
    expect(code).toBe(0);
    const json = report();
    // The single located declaration gets its OWN record, carrying the verdict.
    expect(json.testResults).toHaveLength(1);
    expect(json.testResults[0].ruleResults[0].result).toBe('PASS');
    expect(json.testResults[0].ruleResults[0].test_id).toBe(json.testResults[0].test.id);
    expect(json.testResults[0].test.name).toBe('adds two numbers');
    expect(typeof json.schemaVersion).toBe('string');
    expect(json.summary).toEqual({
      total: 1,
      pass: 1,
      fail: 0,
      indeterminate: 0,
      not_applicable: 0,
      failed: 0,
    });
  });

  it('case-02 FAIL -> exit 0 and a per-test FAIL (a decided FAIL, never stderr)', () => {
    const code = main(['--test', fixture('case-02-no-assertion'), '--type', 'UNIT']);
    expect(code).toBe(0);
    const json = report();
    expect(json.testResults[0].ruleResults[0].result).toBe('FAIL');
    expect(json.summary.failed).toBe(1);
    // A FAILED test is reported in the JSON — stderr stays empty.
    expect(stderr).toBe('');
  });

  it('case-10 UNSUPPORTED -> exit 0 with NO per-test records (no fabricated PASS)', () => {
    const code = main(['--test', fixture('case-10-unsupported-framework'), '--type', 'UNIT']);
    expect(code).toBe(0);
    const json = report();
    // Framework detection is file-scoped: an unsupported file has no per-test
    // scope to report, rather than one invented PASS.
    expect(json.analysisStatus).toBe('UNSUPPORTED');
    expect(json.testResults).toEqual([]);
    expect(json.ruleResults).toHaveLength(1);
    expect(json.ruleResults[0].result).toBe('INDETERMINATE');
    expect(json.ruleResults[0].test_id).toBeUndefined();
  });

  it('case-11 FAILED -> exit 2, empty ruleResults, and NOTHING on stderr', () => {
    const code = main(['--test', fixture('case-11-collector-failure', 'broken.test.ts'), '--type', 'UNIT']);
    expect(code).toBe(2);
    const json = report();
    expect(json.evaluationStatus).toBe('FAILED');
    expect(json.ruleResults).toEqual([]);
    expect(json.testResults).toEqual([]);
    // stderr is the usage/crash channel only.
    expect(stderr).toBe('');
  });

  it('FAILED abort FIRST: FAILED analysis + UNKNOWN declared type -> exit 2, no verdict (D2 regression)', () => {
    // No --type: the declared type is UNKNOWN, but engine step 0 (FAILED abort)
    // fires BEFORE step 1 (UNKNOWN-type INDETERMINATE) — SPEC:374/405: no rule
    // evaluation occurs on a FAILED analysis, so no verdict may stand in for the
    // abort. Pre-fix this exited 0 with EVALUATED/INDETERMINATE (plan task 4, D2).
    const code = main(['--test', fixture('case-11-collector-failure', 'broken.test.ts')]);
    expect(code).toBe(2);
    const json = report();
    expect(json.evaluationStatus).toBe('FAILED');
    expect(json.ruleResults).toEqual([]);
    // The failure itself remains reportable, not hidden.
    expect(json.analysisStatus).toBe('FAILED');
  });

  // WP1.2 — contract verification for the no-tests path (behavior exists from
  // WP1.1; these tests pin the contract, they do not introduce it).
  it('case-18 no-tests -> exit 2: no scope reached a verdict, nothing on stderr', () => {
    const code = main(['--test', fixture('case-18-no-tests'), '--type', 'UNIT']);
    expect(code).toBe(2);
    const json = report();
    expect(json.evaluationStatus).toBe('FAILED');
    // stderr is the usage/crash channel only.
    expect(stderr).toBe('');
  });

  it('case-18 no-tests -> JSON contract: analysisStatus SUCCESS, testResults []', () => {
    const code = main(['--test', fixture('case-18-no-tests'), '--type', 'UNIT']);
    expect(code).toBe(2);
    const json = report();
    // Not an analysis failure: the scan completed.
    expect(json.analysisStatus).toBe('SUCCESS');
    // No declarations → no per-test records.
    expect(json.testResults).toEqual([]);
    // No scope evaluated → shared "no verdict" bucket, no rule finding.
    expect(json.evaluationStatus).toBe('FAILED');
    expect(json.ruleResults).toEqual([]);
    expect(json.summary.total).toBe(0);
    expect(json.schemaVersion).toBe('0.4');
    expect(stderr).toBe('');
  });
});

describe('CLI --format sarif (WP4.3)', () => {
  it('default (no --format) is still JSON — unchanged, no $schema key', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT']);
    expect(code).toBe(0);
    const json = report();
    expect(json.schemaVersion).toBe('0.4');
    expect(json.$schema).toBeUndefined();
  });

  it('--format sarif emits a SARIF 2.1.0 log with the CheckTest driver', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--format', 'sarif']);
    expect(code).toBe(0);
    const log = report();
    expect(log.version).toBe('2.1.0');
    expect(log.runs[0].tool.driver.name).toBe('CheckTest');
    expect(log.runs[0].results[0].ruleId).toBe('CT-INT-001');
    expect(log.runs[0].results[0].properties.result).toBe('PASS');
    expect(stderr).toBe('');
  });

  it('--format sarif carries the real finding location (case-24 assertion line 5)', () => {
    const code = main(['--test', fixture('case-24-vitest-standard'), '--type', 'UNIT', '--format', 'sarif']);
    expect(code).toBe(0);
    const log = report();
    const loc = log.runs[0].results[0].locations[0].physicalLocation;
    expect(loc.region.startLine).toBe(5);
    expect(loc.artifactLocation.uri).toContain('sample.test.ts');
  });

  it('unsupported --format -> exit 1, formats listed, nothing on stdout', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--format', 'xml']);
    expect(code).toBe(1);
    expect(stderr).toContain("unsupported --format 'xml'");
    expect(stderr).toContain('json');
    expect(stderr).toContain('sarif');
    expect(stdout).toBe('');
  });
});

/**
 * CLI --mutation-report (P2.4 verification of commit 400fdf4; seam
 * src/cli.ts -> applyMutationReport -> evidence.mutation_score).
 *
 * Neither tests/providers/mutation.test.ts (provider units) nor the rule
 * suites reach this seam: the flag must attach a FILE-LEVEL EXTERNAL
 * mutation_score record to the analysis envelope, never touch a verdict
 * (docs/limitations.md "never changes a verdict — it only adds a record"),
 * and degrade to an explicit UNKNOWN record — never a fabricated zero —
 * when the report is unreadable or malformed.
 */
describe('CLI --mutation-report', () => {
  const TMP = join(process.env.TMPDIR || tmpdir(), 'checktest-cli-mutation');

  // The verbatim schema-v2 sample fragment from
  // .opencode/progress/reports/WP4.6-mutation-schema.md:19 (single file
  // entry, one Survived + one Killed -> detected 1 / valid 2 = 0.5).
  const VALID_STRYKER_REPORT =
    '{"schemaVersion":"2","files":{"src/a.ts":{"language":"typescript","source":"function a() { return true; }","mutants":[{"id":"0","mutatorName":"BooleanLiteral","replacement":"false","location":{"start":{"line":2,"column":0},"end":{"line":2,"column":1}},"status":"Survived","coveredBy":["T1"],"killedBy":[],"testsCompleted":1},{"id":"1","mutatorName":"BlockStatement","replacement":"{}","location":{"start":{"line":3,"column":0},"end":{"line":3,"column":1}},"status":"Killed","coveredBy":["T1"],"killedBy":["T1"],"testsCompleted":1}]}},"testFiles":{"a.test.ts":{"tests":[{"id":"T1","name":"checks a","location":{"start":{"line":1,"column":0},"end":{"line":1,"column":8}}}]}}}';

  function reportFile(name: string, body: string): string {
    mkdirSync(TMP, { recursive: true });
    const p = join(TMP, name);
    writeFileSync(p, body, 'utf8');
    return p;
  }

  it('valid Stryker report keyed to the subject file: exit 0, mutation_score EXTERNAL but UNKNOWN (report has no revision; CLI analyzed git HEAD)', () => {
    // Key the report by the exact subject file path so findFileRecord matches and
    // the revision-freshness path (not the no-match path) is what is exercised.
    const subjectFile = fixture('case-01-standard-assertion');
    const body = JSON.stringify({
      schemaVersion: '2',
      files: {
        [subjectFile]: {
          language: 'typescript',
          source: 'function a() { return true; }',
          mutants: [
            { id: '0', mutatorName: 'BooleanLiteral', replacement: 'false', status: 'Survived' },
            { id: '1', mutatorName: 'BlockStatement', replacement: '{}', status: 'Killed' },
          ],
        },
      },
    });
    const p = reportFile('p24-valid.json', body);
    const code = main(['--test', subjectFile, '--type', 'UNIT', '--mutation-report', p]);
    expect(code).toBe(0);
    const json = report();
    // The verdict is untouched: mutation evidence never changes a verdict.
    expect(json.ruleResults[0].result).toBe('PASS');
    const ev = json.evidence.mutation_score;
    expect(ev.provenance).toBe('EXTERNAL');
    expect(ev.provider).toBe('stryker');
    // Report carries no revision and the CLI supplies analyzedRevision (git HEAD),
    // so freshness cannot be established: UNKNOWN, never a fabricated 0.5.
    expect(ev.availability).toBe('UNKNOWN');
    expect(ev.coverage.status).toBe('UNAVAILABLE');
    expect(ev.value).toBeNull();
    expect(ev.reason).toBe('report revision unknown; freshness cannot be established');
    expect(stderr).toBe('');
  });

  it('malformed JSON report: exit 0, UNKNOWN record with reason — never a fabricated zero', () => {
    const p = reportFile('p24-malformed.json', '{"schemaVersion":"2", not json');
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--mutation-report', p]);
    // The flag never changes a verdict: a decided PASS stays exit 0.
    expect(code).toBe(0);
    const json = report();
    expect(json.ruleResults[0].result).toBe('PASS');
    const ev = json.evidence.mutation_score;
    expect(ev.availability).toBe('UNKNOWN');
    expect(ev.provenance).toBe('EXTERNAL');
    // undefined serializes to null — never score 0.
    expect(ev.value).toBeNull();
    expect(ev.reason).toContain('malformed mutation report JSON');
    expect(stderr).toBe('');
  });

  it('missing report file: UNKNOWN record with read reason, verdict untouched', () => {
    const p = join(TMP, 'does-not-exist-mutation.json');
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--mutation-report', p]);
    expect(code).toBe(0);
    const json = report();
    expect(json.ruleResults[0].result).toBe('PASS');
    const ev = json.evidence.mutation_score;
    expect(ev.availability).toBe('UNKNOWN');
    expect(ev.value).toBeNull();
    expect(ev.reason).toContain('unable to read mutation report');
  });

  it('flag absent: no mutation_score evidence key, output identical to baseline', () => {
    const baseline = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT']);
    expect(baseline).toBe(0);
    const json = report();
    expect(json.evidence.mutation_score).toBeUndefined();
    expect(json.ruleResults[0].evidence).toEqual(['assertion_count']);
  });

  it('verdict unchanged with vs without --mutation-report (record-only attachment)', () => {
    const p = reportFile('p24-verdict.json', VALID_STRYKER_REPORT);

    const baselineCode = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT']);
    expect(baselineCode).toBe(0);
    const baseline = report();
    // One run, one JSON document on stdout: clear the captured stream between runs.
    stdout = '';

    const withFlag = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--mutation-report', p]);
    expect(withFlag).toBe(0);
    const flagged = report();

    expect(flagged.ruleResults).toEqual(baseline.ruleResults);
    expect(flagged.testResults).toEqual(baseline.testResults);
    expect(flagged.summary).toEqual(baseline.summary);
    expect(flagged.evidence.mutation_score.provenance).toBe('EXTERNAL');
    expect(flagged.evidence.assertion_count).toEqual(baseline.evidence.assertion_count);
  });
});
