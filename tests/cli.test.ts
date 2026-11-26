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

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { join } from 'path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

import { main, runAnalysis } from '../src/cli';
import { UsageError } from '../src/cli';
import { getRule, registerRule } from '../src/rules/registry';
import { collectAnalysis } from '../src/adapters/typescript/collector';
import { applyMutationReport } from '../src/providers/mutation';
import { evaluateRule } from '../src/core/evaluation';
import { TestType } from '../src/core/analysis';
import { CT_MUT_001 } from '../src/rules/ct-mut-001';
import { CT_INT_001 } from '../src/rules/ct-int-001';
import { RuleMetadata, RuleStatus } from '../src/core/rule';

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

  it('--version exits 0 and prints the package.json version', () => {
    const code = main(['--version']);
    expect(code).toBe(0);
    expect(stdout).toBe(`${JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version}\n`);
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

  it('T6: TSX parse failure -> exit 2, FAILED report entry unchanged, stderr warning names file + first TS diagnostic', () => {
    // Owner ruling O2 (2026-11-22): a .tsx file that fails to parse keeps its
    // report-level FAILED entry (no schema/envelope change) AND surfaces a
    // file-level human-readable warning on stderr. Scoped to .tsx so case-11's
    // long-standing "FAILED is reported in JSON, never stderr" contract holds.
    const TMP = join(process.env.TMPDIR || tmpdir(), 'checktest-cli-tsx-parse');
    mkdirSync(TMP, { recursive: true });
    const p = join(TMP, 'broken.test.tsx');
    writeFileSync(
      p,
      "import { expect, it } from '@jest/globals';\nit('broken', () => {\n  const el = <div>;\n});\n",
      'utf8',
    );
    try {
      const code = main(['--test', p, '--type', 'UNIT']);
      expect(code).toBe(2);
      const json = report();
      expect(json.analysisStatus).toBe('FAILED');
      expect(json.evaluationStatus).toBe('FAILED');
      expect(json.ruleResults).toEqual([]);
      expect(json.testResults).toEqual([]);
      expect(stderr).toContain('TSX parse failure');
      expect(stderr).toContain(p);
      expect(stderr).toMatch(/TS\d+/);
    } finally {
      rmSync(TMP, { recursive: true, force: true });
    }
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
    expect(json.schemaVersion).toBe('0.5');
    expect(stderr).toBe('');
  });
});

describe('CLI --format sarif (WP4.3)', () => {
  it('default (no --format) is still JSON — unchanged, no $schema key', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT']);
    expect(code).toBe(0);
    const json = report();
    expect(json.schemaVersion).toBe('0.5');
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

  it('--format sarif carries the test location from the test id (case-24 declaration line 4)', () => {
    const code = main(['--test', fixture('case-24-vitest-standard'), '--type', 'UNIT', '--format', 'sarif']);
    expect(code).toBe(0);
    const log = report();
    const result = log.runs[0].results[0];
    // The result names the test it belongs to…
    expect(result.properties.testId).toMatch(/#it@4:0$/);
    // …and its location is the file:line THAT ID encodes (the declaration),
    // never a fabricated position.
    const loc = result.locations[0].physicalLocation;
    expect(loc.region.startLine).toBe(4);
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
    expect(ev.reason).toBe('mutation report revision unknown; freshness cannot be established');
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

  /**
   * Phase 9 task 3.3 — CLI revision matrix: matching revision, mismatched
   * revision, missing revision, malformed report, and a definite CT-MUT-001
   * verdict when every input is valid.
   *
   * What the CLI report exposes for mutation evidence is the ENVELOPE record
   * `evidence.mutation_score` (json.ts:273-275 serializes `analysis.evidence`).
   * A file-level rule's verdict is computed by the CLI's own engine call
   * (cli.ts:426 `evaluateRule(rule, analysis)`), and that is asserted through the
   * same call here — the pattern tests/cli-coverage.test.ts already uses for the
   * CT-COV-001 subject-level verdict (cli-coverage.test.ts:236-320).
   *
   * `--source-revision` is NOT the mutation revision: it feeds
   * applyCoverageReport only (cli.ts:401-407). analyzedRevision for a mutation
   * report is always `git rev-parse HEAD` (cli.ts:377-387), so a MATCHING
   * revision means `--mutation-source-revision <git HEAD>`.
   */
  describe('revision matrix (phase9 3.3)', () => {
    const REV = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    // Well-formed SHA that is not HEAD: drives the mismatch branch without
    // depending on any real object in the repo.
    const OTHER_REV = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const SUBJECT = fixture('case-01-standard-assertion');

    /** A schema-v2 report keyed to the subject file, one mutant per status. */
    function scoredReport(name: string, statuses: string[]): string {
      const mutants = statuses.map((status, index) => ({
        id: String(index),
        mutatorName: 'BooleanLiteral',
        replacement: 'false',
        status,
      }));
      return reportFile(
        name,
        JSON.stringify({
          schemaVersion: '2',
          files: { [SUBJECT]: { language: 'typescript', source: 'function a() { return true; }', mutants } },
        }),
      );
    }

    /**
     * The file-level CT-MUT-001 verdict for this report, produced exactly as the
     * CLI produces it: collectAnalysis -> applyMutationReport -> evaluateRule.
     */
    function fileLevelVerdict(reportPath: string, mutationSourceRevision?: string) {
      const analysis = applyMutationReport(collectAnalysis(SUBJECT, TestType.UNIT), reportPath, {
        analyzedRevision: REV,
        ...(mutationSourceRevision !== undefined ? { mutationSourceRevision } : {}),
      });
      return evaluateRule(CT_MUT_001, analysis).finding;
    }

    function runCli(reportPath: string, extra: string[] = []): number {
      stdout = '';
      return main(['--test', SUBJECT, '--type', 'UNIT', '--mutation-report', reportPath, ...extra]);
    }

    it('matching revision + valid report → KNOWN/COMPLETE score 0.5, definite PASS (not UNKNOWN)', () => {
      const p = scoredReport('p33-match.json', ['Survived', 'Killed']);
      const code = runCli(p, ['--mutation-source-revision', REV]);
      expect(code).toBe(0);
      expect(stderr).toBe('');
      const ev = report().evidence.mutation_score;
      // The record is decidable: a matching revision is what makes it so.
      expect(ev.availability).toBe('KNOWN');
      expect(ev.coverage.status).toBe('COMPLETE');
      expect(ev.provenance).toBe('EXTERNAL');
      expect(ev.provider).toBe('stryker');
      expect(ev.source_revision).toBe(REV);
      expect(ev.value).toEqual({
        score: 0.5,
        detected: 1,
        valid: 2,
        killed: 1,
        survived: 1,
        timeout: 0,
        noCoverage: 0,
        compileError: 0,
        runtimeError: 0,
        ignored: 0,
        pending: 0,
      });
      // No revision reason: the report revision equals the analyzed revision.
      expect(ev.reason).toBeUndefined();
      // Definite verdict, never UNKNOWN/INDETERMINATE.
      const finding = fileLevelVerdict(p, REV);
      expect(finding?.rule_id).toBe('CT-MUT-001');
      expect(finding?.result).toBe('PASS');
      expect(finding?.reason).toBe('CT-MUT-001: mutation_score=0.5 >= 0.5');
    });

    it('matching revision + all-survived report → KNOWN score 0, definite FAIL (not UNKNOWN)', () => {
      const p = scoredReport('p33-match-fail.json', ['Survived', 'Survived', 'Survived']);
      const code = runCli(p, ['--mutation-source-revision', REV]);
      expect(code).toBe(0);
      expect(stderr).toBe('');
      const ev = report().evidence.mutation_score;
      expect(ev.availability).toBe('KNOWN');
      expect(ev.coverage.status).toBe('COMPLETE');
      expect(ev.value.score).toBe(0);
      expect(ev.value.detected).toBe(0);
      expect(ev.value.valid).toBe(3);
      expect(ev.reason).toBeUndefined();
      const finding = fileLevelVerdict(p, REV);
      expect(finding?.result).toBe('FAIL');
      expect(finding?.reason).toBe('CT-MUT-001: mutation_score=0 < 0.5');
    });

    it('mismatched revision → UNKNOWN + mismatch reason naming both revisions', () => {
      const p = scoredReport('p33-mismatch.json', ['Survived', 'Killed']);
      const code = runCli(p, ['--mutation-source-revision', OTHER_REV]);
      // The flag never changes the verdict: the run is still a successful analysis.
      expect(code).toBe(0);
      expect(stderr).toBe('');
      const ev = report().evidence.mutation_score;
      expect(ev.availability).toBe('UNKNOWN');
      expect(ev.coverage.status).toBe('UNAVAILABLE');
      // undefined serializes to null — never a fabricated 0.5.
      expect(ev.value).toBeNull();
      expect(ev.source_revision).toBe(OTHER_REV);
      expect(ev.reason).toBe(`mutation report revision ${OTHER_REV} does not match analyzed revision ${REV}`);
      // And the rule stays undecided: a stale report is not a FAIL.
      expect(fileLevelVerdict(p, OTHER_REV)?.result).toBe('INDETERMINATE');
    });

    it('missing --mutation-source-revision → UNKNOWN + "revision unknown" reason', () => {
      const p = scoredReport('p33-missing-rev.json', ['Survived', 'Killed']);
      const code = runCli(p);
      expect(code).toBe(0);
      expect(stderr).toBe('');
      const ev = report().evidence.mutation_score;
      expect(ev.availability).toBe('UNKNOWN');
      expect(ev.coverage.status).toBe('UNAVAILABLE');
      expect(ev.value).toBeNull();
      expect(ev.reason).toBe('mutation report revision unknown; freshness cannot be established');
      expect(fileLevelVerdict(p)?.result).toBe('INDETERMINATE');
    });

    it('malformed report → UNKNOWN + parse error reason, never a fabricated score', () => {
      const p = reportFile('p33-malformed.json', '{"schemaVersion":"2", not json');
      const code = runCli(p, ['--mutation-source-revision', REV]);
      expect(code).toBe(0);
      expect(stderr).toBe('');
      const ev = report().evidence.mutation_score;
      expect(ev.availability).toBe('UNKNOWN');
      expect(ev.coverage.status).toBe('UNAVAILABLE');
      expect(ev.value).toBeNull();
      expect(ev.reason).toContain('malformed mutation report JSON');
      expect(fileLevelVerdict(p, REV)?.result).toBe('INDETERMINATE');
    });

    it('valid report + no revision flags → UNKNOWN + missing reason, CT-INT-001 record identical to the no-flag baseline', () => {
      // Row 5 (current behavior preserved): the same evidence record the existing
      // p24-valid.json case pins, plus the regression guard that the CT-INT-001
      // verdict and its evidence list are untouched by the mutation flag.
      const p = scoredReport('p33-no-flags.json', ['Survived', 'Killed']);
      const withFlag = runCli(p);
      expect(withFlag).toBe(0);
      expect(stderr).toBe('');
      const flagged = report();
      const ev = flagged.evidence.mutation_score;
      expect(ev.availability).toBe('UNKNOWN');
      expect(ev.coverage.status).toBe('UNAVAILABLE');
      expect(ev.value).toBeNull();
      expect(ev.reason).toBe('mutation report revision unknown; freshness cannot be established');

      stdout = '';
      const baseline = main(['--test', SUBJECT, '--type', 'UNIT']);
      expect(baseline).toBe(0);
      const bare = report();
      expect(flagged.ruleResults).toEqual(bare.ruleResults);
      expect(flagged.testResults).toEqual(bare.testResults);
      expect(flagged.summary).toEqual(bare.summary);
      expect(bare.evidence.mutation_score).toBeUndefined();
    });
  });
});

describe('file-level CT-MUT-001 surfacing (plan 6.9b)', () => {
  const REV = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const SUBJECT = fixture('case-01-standard-assertion');

  function scoredReport(name: string, statuses: string[]): string {
    const mutants = statuses.map((status, index) => ({
      id: String(index),
      mutatorName: 'BooleanLiteral',
      replacement: 'false',
      status,
    }));
    const TMP = join(process.env.TMPDIR || tmpdir(), 'checktest-cli-mutation');
    mkdirSync(TMP, { recursive: true });
    const p = join(TMP, name);
    writeFileSync(
      p,
      JSON.stringify({
        schemaVersion: '2',
        files: { [SUBJECT]: { language: 'typescript', source: 'function a() { return true; }', mutants } },
      }),
      'utf8',
    );
    return p;
  }

  function runCli(reportPath: string, extra: string[] = []): number {
    stdout = '';
    return main([
      '--test',
      SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-MUT-001',
      '--mutation-report',
      reportPath,
      ...extra,
    ]);
  }

  it('PASS: valid mutation report score >= 0.5 surfaces file-level CT-MUT-001 entry (no test_id) alongside per-test findings', () => {
    const p = scoredReport('p69b-pass.json', ['Survived', 'Killed']);
    const code = runCli(p, ['--mutation-source-revision', REV]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const json = report();
    const perTest = json.ruleResults.filter((e: any) => e.test_id !== undefined);
    const fileLevel = json.ruleResults.filter((e: any) => e.test_id === undefined);
    expect(perTest).toHaveLength(0);
    expect(fileLevel).toHaveLength(1);
    expect(fileLevel[0].rule_id).toBe('CT-MUT-001');
    expect(fileLevel[0].result).toBe('PASS');
    expect(fileLevel[0]).not.toHaveProperty('test_id');
  });

  it('FAIL: valid mutation report score < 0.5 surfaces file-level CT-MUT-001 entry FAIL (no test_id)', () => {
    const p = scoredReport('p69b-fail.json', ['Survived', 'Survived', 'Survived']);
    const code = runCli(p, ['--mutation-source-revision', REV]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const json = report();
    const fileLevel = json.ruleResults.filter((e: any) => e.test_id === undefined);
    expect(fileLevel).toHaveLength(1);
    expect(fileLevel[0].rule_id).toBe('CT-MUT-001');
    expect(fileLevel[0].result).toBe('FAIL');
    expect(fileLevel[0]).not.toHaveProperty('test_id');
  });

  it('SARIF: results[] contains the file-level entry (no properties.testId) alongside per-test results', () => {
    const p = scoredReport('p69b-sarif.json', ['Survived', 'Killed']);
    stdout = '';
    const code = main([
      '--test',
      SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-MUT-001',
      '--format',
      'sarif',
      '--mutation-report',
      p,
      '--mutation-source-revision',
      REV,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const sarif = JSON.parse(stdout);
    const results = sarif.runs[0].results;
    const perTest = results.filter((r: any) => r.properties?.testId !== undefined);
    const fileLevel = results.filter((r: any) => r.properties?.testId === undefined);
    expect(perTest).toHaveLength(0);
    expect(fileLevel).toHaveLength(1);
    expect(fileLevel[0].ruleId).toBe('CT-MUT-001');
    expect(fileLevel[0].properties).not.toHaveProperty('testId');
    expect(fileLevel[0].properties.result).toBe('PASS');
  });

  it('CLI --mutation-report: coverage-map-style mapping lands a decided file-level verdict', () => {
    // The report is keyed to the SOURCE file, not the analyzed test file: only a
    // --coverage-map entry redirects the subject to that key. Without the
    // mapping the record degrades to UNKNOWN and CT-MUT-001 stays INDETERMINATE
    // (RED until task 3 wires options.coverageMap into applyMutationReport).
    const srcKey = 'src/index.js';
    const TMP = join(process.env.TMPDIR || tmpdir(), 'checktest-cli-mutation');
    mkdirSync(TMP, { recursive: true });
    const p = join(TMP, 'p69b-mapped.json');
    writeFileSync(
      p,
      JSON.stringify({
        schemaVersion: '2',
        files: {
          [srcKey]: {
            language: 'typescript',
            source: 'function a() { return true; }',
            mutants: [
              { id: '0', mutatorName: 'BooleanLiteral', replacement: 'false', status: 'Survived' },
              { id: '1', mutatorName: 'BlockStatement', replacement: '{}', status: 'Killed' },
            ],
          },
        },
      }),
      'utf8',
    );
    const code = runCli(p, ['--coverage-map', `${SUBJECT}=${srcKey}`, '--mutation-source-revision', REV]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const json = report();
    const ev = json.evidence.mutation_score;
    expect(ev.availability).toBe('KNOWN');
    expect(ev.coverage.status).toBe('COMPLETE');
    expect(ev.value.score).toBe(0.5);
    expect(ev.reason).toContain('mutation mapped from');
    const fileLevel = json.ruleResults.filter((e: any) => e.test_id === undefined);
    expect(fileLevel).toHaveLength(1);
    expect(fileLevel[0].rule_id).toBe('CT-MUT-001');
    expect(fileLevel[0].result).toBe('PASS');
    expect(fileLevel[0].reason).toBe('CT-MUT-001: mutation_score=0.5 >= 0.5');
    expect(fileLevel[0]).not.toHaveProperty('test_id');
  });

  it('Negative: no mutation report -> no extra ruleResults entry (existing behavior preserved)', () => {
    stdout = '';
    const code = main(['--test', SUBJECT, '--type', 'UNIT', '--rule', 'CT-MUT-001']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const json = report();
    expect(json.ruleResults).toHaveLength(0);
  });

  it('summary.total counts the file-level entry (contract pin, plan 6.9)', () => {
    const p = scoredReport('p69c-total.json', ['Survived', 'Killed']);
    const code = runCli(p, ['--mutation-source-revision', REV]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const json = report();
    const perTestCount = json.ruleResults.filter((e: any) => e.test_id !== undefined).length;
    expect(json.summary.total).toBe(perTestCount + 1);
    const fileLevel = json.ruleResults.filter((e: any) => e.test_id === undefined);
    expect(fileLevel).toHaveLength(1);
    expect(fileLevel[0].rule_id).toBe('CT-MUT-001');
    expect(fileLevel[0]).not.toHaveProperty('test_id');
  });
});

describe('CLI --config (SP4.1)', () => {
  const TMP = join(process.env.TMPDIR || tmpdir(), 'phase5-config');

  function writeCfg(name: string, body: unknown): string {
    mkdirSync(TMP, { recursive: true });
    const p = join(TMP, name);
    writeFileSync(p, JSON.stringify(body), 'utf8');
    return p;
  }

  it('--config missing file -> exit 1 with UsageError diagnostic', () => {
    const code = main([
      '--test',
      fixture('case-01-standard-assertion'),
      '--type',
      'UNIT',
      '--config',
      join(TMP, 'does-not-exist.json'),
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('missing or unreadable --config');
    expect(stdout).toBe('');
  });

  it('--config with thresholds on CT-MUT-001 -> exit 1 + rejection message', () => {
    const p = writeCfg('mut-thresholds.json', {
      rules: { 'CT-MUT-001': { thresholds: { passAtLeast: 2 } } },
    });
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--config', p]);
    expect(code).toBe(1);
    expect(stderr).toContain("'thresholds' is not configurable for local-decision rule 'CT-MUT-001'");
    expect(stdout).toBe('');
  });

  it('--config with thresholds on CT-COV-001 -> exit 1 + honest inert-threshold message', () => {
    const p = writeCfg('cov-thresholds.json', {
      rules: { 'CT-COV-001': { thresholds: { passAtLeast: 0.9 } } },
    });
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--config', p]);
    expect(code).toBe(1);
    expect(stderr).toContain('thresholds');
    expect(stderr).toContain('CT-COV-001');
    expect(stderr).toMatch(/inert/i);
    expect(stderr).not.toContain("local-decision rule 'CT-COV-001'");
    expect(stdout).toBe('');
  });

  it('--config non-JSON file -> exit 1', () => {
    const p = writeCfg('bad.json', '{not json');
    // overwrite with raw invalid JSON text
    writeFileSync(p, '{not json', 'utf8');
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--config', p]);
    expect(code).toBe(1);
    expect(stderr).toContain('invalid --config');
    expect(stdout).toBe('');
  });

  it('--config unknown key -> exit 1', () => {
    const p = writeCfg('unknown-key.json', { foo: {} });
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--config', p]);
    expect(code).toBe(1);
    expect(stderr).toContain("unknown top-level key 'foo'");
  });

  it('--config unknown rule id -> exit 1', () => {
    const p = writeCfg('unknown-rule.json', { rules: { 'CT-NOPE-001': { severity: 'info' } } });
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--config', p]);
    expect(code).toBe(1);
    expect(stderr).toContain("unknown rule id 'CT-NOPE-001'");
  });

  it('--config severity override flows to SARIF report', () => {
    const p = writeCfg('sev.json', { rules: { 'CT-INT-001': { severity: 'info' } } });
    const code = main([
      '--test',
      fixture('case-01-standard-assertion'),
      '--type',
      'UNIT',
      '--format',
      'sarif',
      '--config',
      p,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const log = JSON.parse(stdout);
    expect(log.runs[0].tool.driver.rules[0].properties.severity).toBe('info');
  });

  it('--config thresholds override verdict outcome', () => {
    // Set passAtLeast 99 / failAtMost 1 so case-01 (1 assertion) flips to FAIL.
    const p = writeCfg('thresh.json', {
      rules: { 'CT-INT-001': { thresholds: { passAtLeast: 99, failAtMost: 1 } } },
    });
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--config', p]);
    expect(code).toBe(0);
    expect(report().ruleResults[0].result).toBe('FAIL');
  });

  it('--config disabled rule selected by --rule -> exit 1', () => {
    const p = writeCfg('disabled.json', { rules: { 'CT-INT-001': { enabled: false } } });
    const code = main([
      '--test',
      fixture('case-01-standard-assertion'),
      '--type',
      'UNIT',
      '--rule',
      'CT-INT-001',
      '--config',
      p,
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('disabled by config');
  });

  it('config precedence over built-in thresholds: no existing flag conflict documented', () => {
    // Precedence: --rule selects a rule; --config thresholds apply to it unless
    // a future flag directly overrides. Documented in src/core/config.ts.
    const p = writeCfg('prec.json', { rules: { 'CT-INT-001': { thresholds: { passAtLeast: 5, failAtMost: 4 } } } });
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--config', p]);
    expect(code).toBe(0);
    // case-01 has 1 assertion, thresholds 5/4 -> 1 <= 4 -> FAIL.
    expect(report().ruleResults[0].result).toBe('FAIL');
  });

  it('TS UsageError accessible from cli module for type parity', () => {
    expect(typeof UsageError).toBe('function');
  });
});

describe('registered rules (SP3.2)', () => {
  it('main() registers CT-MUT-001 (appears in registered rule list)', () => {
    const code = main(['--version']);
    expect(code).toBe(0);
    expect(getRule('CT-MUT-001')).toBeDefined();
    expect(getRule('CT-MUT-001')?.id).toBe('CT-MUT-001');
  });
});

describe('CLI adapter dispatch (Phase 8 task B3, ADR-034)', () => {
  const rmRf = (dir: string) => rmSync(dir, { recursive: true, force: true });

  it('--adapter typescript-jest-adapter resolves the registered adapter and behaves as baseline', () => {
    // Adapter id must be a registered id (src/adapters/typescript/support.ts:30);
    // a flag-layer assertion (decidedBy: 'flag') is observable only once the
    // CLI envelope exposes it — lands with task D1.
    const code = main([
      '--test',
      fixture('case-01-standard-assertion'),
      '--type',
      'UNIT',
      '--adapter',
      'typescript-jest-adapter',
    ]);
    expect(code).toBe(0);
    expect(report().ruleResults[0].result).toBe('PASS');
  });

  // Manifest-free tmpdir cwd, following the established pattern below: in the
  // repo root the manifest layer (package.json) would decide before the
  // extension layer is ever reached (src/adapters/registry.ts:99-104), so a
  // .rs file there resolves to the TS adapter and never hits unsupported
  // dispatch.
  function withUnsupportedRs<T>(fn: (rs: string) => T): T {
    const dir = join(tmpdir(), `checktest-b3-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const rs = join(dir, 'sample.test.rs');
    writeFileSync(rs, 'fn test_x() {}\n');
    const cwd = process.cwd();
    process.chdir(dir); // no package.json here -> manifest layer cannot match TS adapter
    try {
      return fn(rs);
    } finally {
      process.chdir(cwd);
      rmRf(dir);
    }
  }

  it('file with extension NO adapter claims (.rs) -> exit 2, UNSUPPORTED envelope on stdout (default JSON)', () => {
    // python adapter registered (C4): the unsupported-dispatch CLI case moved
    // from .py to .rs (an extension no adapter declares) so it keeps testing
    // the UNSUPPORTED path; .py now resolves to the python adapter.
    withUnsupportedRs((rs) => {
      const code = main(['--test', rs, '--type', 'UNIT']);
      expect(code).toBe(2);
      expect(stderr).toContain('UNSUPPORTED: no adapter matched for');
      // UNIT 5: JSON is the default format (check has no --json flag); the
      // no-verdict envelope now rides stdout instead of leaving it empty.
      const json = report();
      expect(json.kind).toBe('check');
      expect(json.schemaVersion).toBe('0.5');
      expect(json.analysisStatus).toBe('UNSUPPORTED');
      expect(json.evaluationStatus).toBe('FAILED');
      expect(json.completeness).toBe('NOT_APPLICABLE');
      expect(json.reasonCode).toBe('NO_ADAPTER_MATCHED');
      expect(json.test).toEqual({ file: rs });
      // No invented verdicts: empty results, zeroed summary (field names
      // mirror src/reporters/json.ts summarize()).
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
    });
  });

  it('unsupported .rs with --format sarif -> exit 2, stdout stays empty (SARIF path unchanged)', () => {
    // Baseline captured BEFORE the UNIT 5 change (manifest-free cwd, built
    // CLI): stdout 0 bytes, stderr prose, exit 2. SARIF gets no no-verdict
    // envelope this cycle — documented in README Exit Codes.
    withUnsupportedRs((rs) => {
      const code = main(['--test', rs, '--type', 'UNIT', '--format', 'sarif']);
      expect(code).toBe(2);
      expect(stderr).toContain('UNSUPPORTED: no adapter matched for');
      expect(stdout).toBe('');
    });
  });

  it('unsupported envelope reason suggests doctor --test and --adapter (human-friendly)', () => {
    withUnsupportedRs((rs) => {
      const code = main(['--test', rs, '--type', 'UNIT']);
      expect(code).toBe(2);
      const json = report();
      expect(json.reason).toContain(`doctor --test ${rs}`);
      expect(json.reason).toContain('--adapter <id>');
    });
  });
});

describe('CLI adapter dispatch from repo root (WP10 F1, ADR-034)', () => {
  // WP10 F1 (plan task 1b): these run from the REPO ROOT (jest default cwd, NO
  // process.chdir escape) so the CWD-relative manifest probe (src/cli.ts:737
  // `(name) => existsSync(name)`) sees the repo-root package.json. Pre-fix that
  // misroutes every non-TS file to the TS adapter via the manifest layer
  // (package.json is a TS signature) — see E2E2a/N1 in
  // .opencode/scratch/checktest-foundation-initiative/wp7-e2e-report.md. Post-fix
  // the manifest candidates are filtered by extension affinity, so the resolved
  // adapter is stable across working directories for claimed extensions.
  const pyPytestFixture = join(__dirname, 'adapters', 'python', 'fixtures', 'pytest_sample.py');

  it('check <.py fixture> from repo root -> exit 0, python-pytest-adapter / extension (was TS/manifest FAILED)', () => {
    const code = main(['check', '--test', pyPytestFixture, '--type', 'UNIT']);
    expect(code).toBe(0);
    const json = report();
    expect(json.adapter).toBe('python-pytest-adapter');
    expect(json.decidedBy).toBe('extension');
  });

  it('check <.rs> from repo root -> exit 2, NO_ADAPTER_MATCHED envelope (was TS/manifest FAILED)', () => {
    // The .rs fixture lives in a tmpdir (the withUnsupportedRs placement
    // mechanism, :965-978) but cwd is NOT escaped — it stays at the repo root, so
    // the CWD-relative manifest probe reproduces F1. The manifest probe reads
    // cwd, not the file's directory (src/cli.ts:737), so the .rs file location is
    // irrelevant to dispatch. No .rs is written into the repo working tree.
    const dir = join(tmpdir(), `checktest-f1-repo-rs-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const rs = join(dir, 'sample.test.rs');
    writeFileSync(rs, 'fn test_x() {}\n');
    try {
      const code = main(['check', '--test', rs, '--type', 'UNIT']);
      expect(code).toBe(2);
      const json = report();
      expect(json.kind).toBe('check');
      expect(json.analysisStatus).toBe('UNSUPPORTED');
      expect(json.reasonCode).toBe('NO_ADAPTER_MATCHED');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('doctor <.py fixture> --json from repo root -> python-pytest-adapter / extension (was TS/manifest)', () => {
    const code = main(['doctor', '--test', pyPytestFixture, '--json']);
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.adapterId).toBe('python-pytest-adapter');
    expect(json.decidedBy).toBe('extension');
  });
});

describe('CLI --mutation-source-revision (phase9 3.1)', () => {
  const REV = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  it('accepts a valid git revision (HEAD sha)', () => {
    const code = main([
      '--test',
      fixture('case-01-standard-assertion'),
      '--type',
      'UNIT',
      '--mutation-source-revision',
      REV,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
  });

  it('accepts the literal "unknown"', () => {
    const code = main([
      '--test',
      fixture('case-01-standard-assertion'),
      '--type',
      'UNIT',
      '--mutation-source-revision',
      'unknown',
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
  });

  it('rejects an invalid value with usage error', () => {
    const code = main([
      '--test',
      fixture('case-01-standard-assertion'),
      '--type',
      'UNIT',
      '--mutation-source-revision',
      'not a rev',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain("invalid --mutation-source-revision 'not a rev'");
    expect(stdout).toBe('');
  });

  it('--source-revision behavior unchanged (still accepted)', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--source-revision', REV]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
  });

  it('flag is standalone (no --mutation-report required)', () => {
    const code = main([
      '--test',
      fixture('case-01-standard-assertion'),
      '--type',
      'UNIT',
      '--mutation-source-revision',
      REV,
    ]);
    expect(code).toBe(0);
  });
});

/**
 * Rule lifecycle at the CLI seam (plan task 5.3; D6 draft opt-in, D7
 * deprecated-until-removal).
 *
 * DRAFT — excluded unless the rule is named EXPLICITLY with --rule; naming it
 *         IS the opt-in, and the rule then produces a real verdict.
 * DEPRECATED — evaluated by default, like an ACTIVE rule, and its deprecation
 *         version is reported as rule metadata.
 */
describe('CLI --rule lifecycle (D6/D7)', () => {
  // CT-INT-001 declares no local_decision hook and no thresholds_inert flag,
  // so registering these clones adds nothing to the config-rejection sets.
  const DRAFT_RULE: RuleMetadata = { ...CT_INT_001, id: 'CT-DRAFT-001', status: RuleStatus.DRAFT };
  const DEPRECATED_RULE: RuleMetadata = {
    ...CT_INT_001,
    id: 'CT-DEPRECATED-001',
    status: RuleStatus.DEPRECATED,
    deprecatedSince: '1.11.0',
  };

  beforeAll(() => {
    registerRule(DRAFT_RULE);
    registerRule(DEPRECATED_RULE);
  });

  it('a DRAFT rule named via --rule is evaluated (opt-in) -> exit 0, verdict present', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--rule', DRAFT_RULE.id]);
    expect(code).toBe(0);
    const json = report();
    expect(json.evaluationStatus).toBe('EVALUATED');
    expect(json.ruleResults).toHaveLength(1);
    expect(json.ruleResults[0].rule_id).toBe(DRAFT_RULE.id);
    expect(json.ruleResults[0].result).toBe('PASS');
  });

  it('a DRAFT rule that is NOT named explicitly is skipped: no verdict, exit 2', () => {
    const { report: json, exitCode } = runAnalysis({
      test: fixture('case-01-standard-assertion'),
      type: TestType.UNIT,
      rules: [DRAFT_RULE.id],
      format: 'json',
    });
    expect(exitCode).toBe(2);
    const parsed = JSON.parse(json);
    expect(parsed.ruleResults).toEqual([]);
    expect(parsed.evaluationStatus).toBe('FAILED');
  });

  it('the default run names no rule, so a DRAFT rule is never reported', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT']);
    expect(code).toBe(0);
    const json = report();
    expect(json.ruleResults.some((r: { rule_id: string }) => r.rule_id === DRAFT_RULE.id)).toBe(false);
  });

  it('a DEPRECATED rule is evaluated by default and reports its deprecation version', () => {
    const code = main([
      '--test',
      fixture('case-01-standard-assertion'),
      '--type',
      'UNIT',
      '--rule',
      DEPRECATED_RULE.id,
      '--format',
      'sarif',
    ]);
    expect(code).toBe(0);
    const sarif = JSON.parse(stdout);
    expect(sarif.runs[0].tool.driver.rules[0].properties.deprecatedSince).toBe('1.11.0');
  });
});

describe('CLI doctor (Phase 2a)', () => {
  it('env-probe happy path exits 0 with no stack trace', () => {
    const code = main(['doctor']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('checktest doctor');
  });

  it('doctor --json emits kind:doctor and schemaVersion 0.5', () => {
    const code = main(['doctor', '--json']);
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.kind).toBe('doctor');
    expect(json.schemaVersion).toBe('0.5');
  });

  it('doctor --test <file> prints adapterId/decidedBy/reason and exits 0', () => {
    const code = main(['doctor', '--test', fixture('case-01-standard-assertion'), '--json']);
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.adapterId).toBe('typescript-jest-adapter');
    expect(json).toHaveProperty('decidedBy');
    expect(json).toHaveProperty('reason');
  });

  it('doctor --test /nonexistent.foo exits 2', () => {
    const code = main(['doctor', '--test', '/nonexistent.foo']);
    expect(code).toBe(2);
  });

  it('doctor --bogus-flag exits 1', () => {
    const code = main(['doctor', '--bogus-flag']);
    expect(code).toBe(1);
  });

  // UNIT 4 (ADR-034): --adapter threads the explicit id through the SAME
  // resolveAdapter call as check (flag > manifest > extension). An
  // unregistered id falls through the structural layers
  // (src/adapters/registry.ts:90-93) — never a fake success.
  const pyFixture = join(__dirname, 'adapters', 'python', 'fixtures', 'unittest_sample.py');

  // Manifest-free tmpdir cwd, following the established pattern at :964-978:
  // in the repo root the manifest layer (package.json) would decide before
  // the extension layer is ever reached.
  function withManifestFreeCwd<T>(tag: string, fn: (dir: string) => T): T {
    const dir = join(tmpdir(), `checktest-doctor-${tag}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      return fn(dir);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('doctor --test <.py> without --adapter: automatic dispatch unchanged, requestedAdapter null', () => {
    withManifestFreeCwd('auto', () => {
      const code = main(['doctor', '--test', pyFixture, '--json']);
      expect(code).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.requestedAdapter).toBeNull();
      expect(json.adapterId).toBe('python-pytest-adapter');
      expect(json.decidedBy).toBe('extension');
      expect(json.reason).toBeNull();
    });
  });

  it('doctor --adapter python-pytest-adapter on a .py fixture: decidedBy flag', () => {
    const code = main(['doctor', '--test', pyFixture, '--adapter', 'python-pytest-adapter', '--json']);
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.requestedAdapter).toBe('python-pytest-adapter');
    expect(json.adapterId).toBe('python-pytest-adapter');
    expect(json.decidedBy).toBe('flag');
    expect(json.reason).toBeNull();
  });

  it('doctor and check select the SAME adapter for the same --adapter id (parity)', () => {
    main(['doctor', '--test', pyFixture, '--adapter', 'python-pytest-adapter', '--json']);
    const doctorJson = JSON.parse(stdout);
    stdout = '';
    const code = main(['check', '--test', pyFixture, '--adapter', 'python-pytest-adapter']);
    expect(code).toBe(0);
    const checkJson = JSON.parse(stdout);
    expect(checkJson.adapter).toBe(doctorJson.adapterId);
    expect(checkJson.decidedBy).toBe(doctorJson.decidedBy);
  });

  it('doctor --adapter nope-adapter on .py: unregistered id falls through to extension (honest outcome)', () => {
    withManifestFreeCwd('fallthrough-py', () => {
      const code = main(['doctor', '--test', pyFixture, '--adapter', 'nope-adapter', '--json']);
      expect(code).toBe(0);
      const json = JSON.parse(stdout);
      expect(json.requestedAdapter).toBe('nope-adapter');
      expect(json.adapterId).toBe('python-pytest-adapter');
      expect(json.decidedBy).toBe('extension');
      expect(json.reason).toBeNull();
    });
  });

  it('doctor --adapter nope-adapter on .rs: fall-through ends unsupported, exit 2', () => {
    withManifestFreeCwd('fallthrough-rs', (dir) => {
      const rs = join(dir, 'sample.test.rs');
      writeFileSync(rs, 'fn test_x() {}\n');
      const code = main(['doctor', '--test', rs, '--adapter', 'nope-adapter', '--json']);
      expect(code).toBe(2);
      const json = JSON.parse(stdout);
      expect(json.requestedAdapter).toBe('nope-adapter');
      expect(json.adapterId).toBeNull();
      expect(json.decidedBy).toBe('unsupported');
      expect(json.reason).toBe('no adapter matched');
    });
  });

  it('doctor --test <.rs> without --adapter: still unsupported, exit 2 (unchanged)', () => {
    withManifestFreeCwd('unsupported-rs', (dir) => {
      const rs = join(dir, 'sample.test.rs');
      writeFileSync(rs, 'fn test_x() {}\n');
      const code = main(['doctor', '--test', rs, '--json']);
      expect(code).toBe(2);
      const json = JSON.parse(stdout);
      expect(json.requestedAdapter).toBeNull();
      expect(json.adapterId).toBeNull();
      expect(json.decidedBy).toBe('unsupported');
    });
  });

  it('doctor human output shows Requested line only when requested differs from resolved', () => {
    withManifestFreeCwd('human', () => {
      const code = main(['doctor', '--test', pyFixture, '--adapter', 'nope-adapter']);
      expect(code).toBe(0);
      expect(stdout).toContain('Requested: nope-adapter');
      expect(stdout).toContain('Adapter: python-pytest-adapter (extension) resolved');
      stdout = '';
      main(['doctor', '--test', pyFixture, '--adapter', 'python-pytest-adapter']);
      expect(stdout).not.toContain('Requested:');
    });
  });

  it('doctor --adapter without value exits 1 via UsageError path', () => {
    const code = main(['doctor', '--test', pyFixture, '--adapter']);
    expect(code).toBe(1);
    expect(stderr).toContain('missing value');
  });

  it('doctor --adapter without --test stays env mode (flag scopes to the dispatch probe)', () => {
    const code = main(['doctor', '--adapter', 'python-pytest-adapter', '--json']);
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.mode).toBe('env');
    expect(json).not.toHaveProperty('requestedAdapter');
  });
});

describe('CLI explain (Phase 2b)', () => {
  it('registered rule exits 0 and prints all metadata fields', () => {
    const code = main(['explain', '--rule', 'CT-INT-001']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('checktest explain: CT-INT-001');
    expect(stdout).toContain('Rationale:');
    expect(stdout).toContain('Limitations:');
    expect(stdout).toContain('Docs URL:');
  });

  it('explain --bogus-flag exits 1 via UsageError path', () => {
    const code = main(['explain', '--bogus-flag']);
    expect(code).toBe(1);
    expect(stderr).toContain('unknown argument');
  });

  it('explain --rule without value exits 1 via UsageError path', () => {
    const code = main(['explain', '--rule']);
    expect(code).toBe(1);
    expect(stderr).toContain('missing value');
  });

  it('explain CT-DEMO-001 exits 1 listing registered ids', () => {
    const code = main(['explain', '--rule', 'CT-DEMO-001']);
    expect(code).toBe(1);
    expect(stderr).toContain('registered rules: CT-INT-001, CT-INT-003, CT-INT-004, CT-COV-001, CT-MUT-001');
  });

  it('explain missing --rule exits 1', () => {
    const code = main(['explain']);
    expect(code).toBe(1);
  });

  it('explain --json emits kind:explain and schemaVersion 0.5', () => {
    const code = main(['explain', '--rule', 'CT-MUT-001', '--json']);
    expect(code).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.kind).toBe('explain');
    expect(json.schemaVersion).toBe('0.5');
    // Full-shape pin: every registered rule carries rationale/limitations/docsUrl;
    // deprecatedSince stays absent; thresholds_inert present for CT-MUT-001 since Task 8 hook-rule flag.
    expect(json.id).toBe('CT-MUT-001');
    expect(typeof json.rationale).toBe('string');
    expect(typeof json.limitations).toBe('string');
    expect(typeof json.docsUrl).toBe('string');
    expect(json).not.toHaveProperty('deprecatedSince');
    expect(json).toHaveProperty('thresholds_inert', true);
  });

  it('explain prints threshold lines for a threshold rule (CT-INT-001)', () => {
    const code = main(['explain', '--rule', 'CT-INT-001']);
    expect(code).toBe(0);
    expect(stdout).toContain('  Metric: assertion_count');
    expect(stdout).toContain('  Pass at least: 1');
    expect(stdout).toContain('  Fail at most: 0');
  });

  it('explain unknown id exits 1', () => {
    const code = main(['explain', '--rule', 'NOPE']);
    expect(code).toBe(1);
  });
});

/**
 * Phase 2c (task 9) — CLI discoverability + contract pins.
 *
 * `doctor --help` / `explain --help` call `process.exit(0)` directly
 * (src/cli.ts:293-296, :459-462), which the in-process `main()` seam cannot
 * observe (the spy records the call but execution continues past it). Those
 * cases therefore drive the real CLI via the same `execFileSync` subprocess
 * seam already used at :475/:637/:940 for git revisions — no production code
 * is restructured. Everything else stays on the in-process `main()` seam.
 */
describe('CLI discoverability & contract (Phase 2c)', () => {
  const CLI = join(__dirname, '..', 'src', 'cli.ts');

  /** Run the CLI as a real subprocess; return {code, stdout, stderr}. */
  function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync('npx', ['tsx', CLI, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout, stderr: '' };
    } catch (e: any) {
      return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  }

  // (a) --help variants that the in-process seam cannot pin (process.exit(0)).
  it('doctor --help exits 0, prints Usage, no stack trace', () => {
    const r = runCli(['doctor', '--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: checktest');
    expect(r.stderr).toBe('');
    expect(r.stdout).not.toContain('    at ');
  });

  it('explain --help exits 0, prints Usage, no stack trace', () => {
    const r = runCli(['explain', '--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: checktest');
    expect(r.stderr).toBe('');
    expect(r.stdout).not.toContain('    at ');
  });

  it('check --help exits 0 (bare --help via check prefix)', () => {
    const code = main(['check', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: checktest');
    expect(stderr).toBe('');
  });

  // (b) doctor env-probe: weak-signal non-certainty. The env probe reports
  // capabilities (frameworks the adapter supports) but never claims a
  // detected-framework certainty for the cwd.
  it('doctor --json: no framework-certainty field; adapters carry capabilities', () => {
    const code = main(['doctor', '--json']);
    expect(code).toBe(0);
    const json = report();
    expect(json.kind).toBe('doctor');
    expect(json.mode).toBe('env');
    // No "detected framework" claim — a certainty field would be a lie here.
    expect(json).not.toHaveProperty('detectedFramework');
    expect(json).not.toHaveProperty('frameworkCertainty');
    expect(json).not.toHaveProperty('detected');
    // Adapters listed with capabilities (frameworks + assertionForms).
    expect(Array.isArray(json.adapters)).toBe(true);
    expect(json.adapters.length).toBeGreaterThan(0);
    for (const a of json.adapters) {
      expect(a).toHaveProperty('id');
      expect(a).toHaveProperty('capabilities');
      expect(a.capabilities).toHaveProperty('frameworks');
      expect(a.capabilities).toHaveProperty('assertionForms');
    }
    // supported.frameworks is the union of adapter capabilities, not a detection.
    expect(Array.isArray(json.supported.frameworks)).toBe(true);
    expect(json.supported.frameworks).toContain('jest');
  });

  // (c) explain usage errors — unknown id exits 1 (registered ok already pinned
  // at :1110). Variant: unknown id via --json also exits 1 (no JSON on stdout).
  it('explain --json unknown id exits 1, nothing on stdout', () => {
    const code = main(['explain', '--rule', 'CT-NOPE', '--json']);
    expect(code).toBe(1);
    expect(stdout).toBe('');
  });

  // (d) JSON shape stability — byte-stable across two invocations in one run.
  it('doctor --json is byte-stable across two invocations', () => {
    main(['doctor', '--json']);
    const first = stdout;
    stdout = '';
    main(['doctor', '--json']);
    const second = stdout;
    expect(second).toBe(first);
    expect(() => JSON.parse(first)).not.toThrow();
  });

  it('explain --json is byte-stable across two invocations', () => {
    main(['explain', '--rule', 'CT-INT-001', '--json']);
    const first = stdout;
    stdout = '';
    main(['explain', '--rule', 'CT-INT-001', '--json']);
    const second = stdout;
    expect(second).toBe(first);
    expect(JSON.parse(first)).toEqual(JSON.parse(second));
  });

  // (e) Exit-code contract table pinned per outcome type. The 0/1/2 semantics
  // (src/cli.ts:15-22) extended to doctor + explain dispatch.
  it('exit-code contract: doctor dispatch unresolvable -> 2 (no-verdict bucket)', () => {
    const code = main(['doctor', '--test', '/nonexistent.foo']);
    expect(code).toBe(2);
  });

  it('exit-code contract: doctor dispatch resolved -> 0 (diagnostic success)', () => {
    const code = main(['doctor', '--test', fixture('case-01-standard-assertion')]);
    expect(code).toBe(0);
  });

  it('exit-code contract: explain unknown rule -> 1 (usage error)', () => {
    const code = main(['explain', '--rule', 'CT-NOPE']);
    expect(code).toBe(1);
  });

  it('exit-code contract: explain registered rule -> 0 (success)', () => {
    const code = main(['explain', '--rule', 'CT-INT-001']);
    expect(code).toBe(0);
  });

  // 0 = EVALUATED-even-FAIL: a decided FAIL is a successful analysis (cli.ts:15-22).
  // Already pinned at :79 (case-02 FAIL -> 0); re-pin here as the table's
  // explicit 0-row so the Phase 2c contract block is self-contained.
  it('exit-code contract: check FAIL still exits 0 (EVALUATED, not FAILED)', () => {
    const code = main(['--test', fixture('case-02-no-assertion'), '--type', 'UNIT']);
    expect(code).toBe(0);
    expect(report().ruleResults[0].result).toBe('FAIL');
  });

  // 1 = usage error: unknown flag on the bare check path.
  it('exit-code contract: unknown flag -> 1 (usage error)', () => {
    const code = main(['--bogus', 'x']);
    expect(code).toBe(1);
  });

  // 2 = no verdict: file declares no tests (case-18, cli.ts:15-22 UD-8).
  // Already pinned at :269; re-pin as the table's explicit 2-row.
  it('exit-code contract: no-tests -> 2 (no verdict)', () => {
    const code = main(['--test', fixture('case-18-no-tests'), '--type', 'UNIT']);
    expect(code).toBe(2);
  });
});

/**
 * WP11 task 24 (owner ruling ## Decisions #14): documentation-only closure of
 * the §4.7 "human count summary" open item. `check` never emits a separate
 * human summary; stdout is report-only and the machine-readable `summary`
 * object is the only summary. This pins the FULL default stdout bytes so any
 * future addition (a human summary line on stdout, a new envelope key, a
 * stderr->stdout spill) fails here.
 *
 * src/ is UNTOUCHED by task 24 — the pin passes identically before and after the
 * docs-only change. The subject path is repo-root-relative (jest's default cwd)
 * and NOT the absolute `fixture()` helper: the report echoes `test.file`
 * verbatim, so an absolute path would bake the checkout location into the digest.
 */
describe('default check stdout byte-stability (WP11 task 24)', () => {
  // pinned 2026-11-21 WP11 task 24; default check stdout byte-stability contract docs/reporting-contract.md §4.7
  // Rebased 2026-11-24 (open item #1, batch 1): the envelope's
  // supported_assertion_forms list gained 12 new matchers (toBeLessThan, toBeCloseTo,
  // toBeInstanceOf, toStrictEqual, toBeTypeOf, toHaveBeenLastCalledWith,
  // toBeCalled, toBeCalledWith, toHaveBeenNthCalledWith, toBeLessThanOrEqual,
  // plus negated forms), so the default report bytes changed.
  // Rebased 2026-11-22 (S unit, C2 council): the envelope's
  // coverage.supported_assertion_forms list gained `supertest-expect-status` /
  // `supertest-expect-body` (capabilities.ts 28→30), so the default report bytes
  // changed. T6's cli.ts change writes its TSX warning to stderr only — stdout
  // (and this digest) is unaffected by it.
  const PINNED_STDOUT_SHA256 = 'af23bd366f1708fccfc4aedde3eff1ca29adcb6782cb9ccca1edf4f5099a1e71';
  const SUBJECT = 'tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts';

  it('default `check` stdout sha256 equals the pinned digest (byte-stability contract)', () => {
    const code = main(['check', '--test', SUBJECT, '--type', 'UNIT']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(createHash('sha256').update(stdout).digest('hex')).toBe(PINNED_STDOUT_SHA256);
  });
});

describe('CLI manifestFramework provenance', () => {
  const TMP = join(process.env.TMPDIR || tmpdir(), 'checktest-cli-mf');

  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  it('report envelope carries manifestFramework when package.json declares jest', () => {
    const testFile = join(TMP, 'sample.test.ts');
    writeFileSync(
      testFile,
      readFileSync(join(__dirname, 'fixtures', 'ct-int-001', 'case-01-standard-assertion', 'sample.test.ts'), 'utf8'),
    );
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29', vitest: '^1' } }));
    const code = main(['--test', testFile, '--type', 'UNIT']);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.test.manifestFramework).toBe('jest');
  });

  it('report envelope omits manifestFramework when no package.json', () => {
    const testFile = join(TMP, 'sample.test.ts');
    writeFileSync(
      testFile,
      readFileSync(join(__dirname, 'fixtures', 'ct-int-001', 'case-01-standard-assertion', 'sample.test.ts'), 'utf8'),
    );
    const code = main(['--test', testFile, '--type', 'UNIT']);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.test.manifestFramework).toBeUndefined();
  });
});

describe('CLI --all-rules sugar (open item #5)', () => {
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('--all-rules expands to all ACTIVE registered rules', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--all-rules']);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as { rules?: { rule: string }[] };
    // Multi-rule output: rules array present with >1 entry (all ACTIVE rules)
    expect(report.rules).toBeDefined();
    expect(Array.isArray(report.rules)).toBe(true);
    expect((report.rules as { rule: string }[]).length).toBeGreaterThan(1);
  });

  it('--all-rules with single active rule still works (edge: only one ACTIVE)', () => {
    // Even if only one rule, --all-rules sets ruleExplicit=true
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--all-rules']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
  });
});
