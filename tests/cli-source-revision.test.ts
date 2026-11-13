/**
 * CLI --source-revision flag (TDD RED phase, task 4).
 *
 * The flag declares the revision a coverage report was produced against, so
 * that freshness can be established (KNOWN) when it matches the analyzed
 * revision. Absent the flag, keep_guard stands: revision-less reports stay
 * INDETERMINATE (UNAVAILABLE freshness path).
 *
 * These tests are written against the NOT-YET-IMPLEMENTED flag: they MUST fail
 * before task 5 lands the plumbing. Zero src/ edits in this task.
 */
import { execFileSync } from 'child_process';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

import { main } from '../src/cli';

const CASE_ROOT = join(__dirname, 'fixtures', 'ct-int-001');
const CASE_01 = join(CASE_ROOT, 'case-01-standard-assertion', 'sample.test.ts');

const TMP = join(process.env.TMPDIR || '/tmp', 'checktest-cli-source-revision');

const REV = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

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

function reportJson(): Record<string, any> {
  return JSON.parse(stdout.trim()) as Record<string, any>;
}

function run(argv: string[]): number {
  stdout = '';
  return main(argv);
}

const COMMON = ['--test', CASE_01, '--type', 'UNIT', '--rule', 'CT-COV-001'];

describe('source-revision flag (TDD RED)', () => {
  it('A. --source-revision <rev> with coverage report + map + per-test-run yields KNOWN+COMPLETE numeric verdict', () => {
    const body = JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } });
    const code = run([
      ...COMMON,
      '--coverage-report',
      report('sr-A.json', body),
      '--coverage-map',
      `${CASE_01}=to.ts`,
      '--per-test-run',
      '--source-revision',
      REV,
    ]);
    expect(code).toBe(0);
    const json = reportJson();
    expect(json.evaluationStatus).toBe('EVALUATED');
    const subj = json.evidence.line_coverage;
    expect(subj.availability).toBe('KNOWN');
    expect(subj.coverage.status).toBe('COMPLETE');
    expect(subj.source_revision).toBe(REV);
    const decl = json.testResults[0].evidence.line_coverage;
    expect(decl.value).toBe(1);
    expect(decl.availability).toBe('KNOWN');
    expect(decl.source_revision).toBe(REV);
    expect(json.testResults[0].ruleResults[0].result).toBe('PASS');
  });

  it('B. (guard) absent --source-revision stays INDETERMINATE (keep_guard)', () => {
    const body = JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } });
    const code = run([
      ...COMMON,
      '--coverage-report',
      report('sr-B.json', body),
      '--coverage-map',
      `${CASE_01}=to.ts`,
      '--per-test-run',
    ]);
    expect(code).toBe(0);
    const json = reportJson();
    const subj = json.evidence.line_coverage;
    expect(subj.availability).toBe('UNKNOWN');
    expect(subj.source_revision).toBe('unknown');
    const decl = json.testResults[0].evidence.line_coverage;
    expect(decl.availability).toBe('UNKNOWN');
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
  });

  it('C. --source-revision declared but mismatches analyzed rev -> UNAVAILABLE mismatch', () => {
    const body = JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } });
    const declared = 'rev-declared-mismatch';
    const code = run([
      ...COMMON,
      '--coverage-report',
      report('sr-C.json', body),
      '--coverage-map',
      `${CASE_01}=to.ts`,
      '--per-test-run',
      '--source-revision',
      declared,
    ]);
    expect(code).toBe(0);
    const json = reportJson();
    const subj = json.evidence.line_coverage;
    expect(subj.availability).toBe('UNKNOWN');
    expect(subj.source_revision).toBe(declared);
    expect(String(subj.reason)).toContain('mismatch');
    expect(String(subj.reason)).toContain(declared);
    expect(String(subj.reason)).toContain(REV);
    const decl = json.testResults[0].evidence.line_coverage;
    expect(decl.availability).toBe('UNKNOWN');
    expect(decl.value).toBeNull();
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
  });

  it('D. config-file sourceRevision accepted via --config (KNOWN effect)', () => {
    const body = JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } });
    const cfgPath = report('sr-D.config.json', JSON.stringify({ sourceRevision: REV, rules: {} }));
    const code = run([
      ...COMMON,
      '--coverage-report',
      report('sr-D.json', body),
      '--coverage-map',
      `${CASE_01}=to.ts`,
      '--per-test-run',
      '--config',
      cfgPath,
    ]);
    expect(code).toBe(0);
    const json = reportJson();
    const subj = json.evidence.line_coverage;
    expect(subj.availability).toBe('KNOWN');
    expect(subj.coverage.status).toBe('COMPLETE');
    expect(subj.source_revision).toBe(REV);
    const decl = json.testResults[0].evidence.line_coverage;
    expect(decl.value).toBe(1);
    expect(decl.availability).toBe('KNOWN');
  });

  it('D2. precedence: config sourceRevision X + CLI flag Y -> Y wins', () => {
    const body = JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } });
    const cfgX = 'rev-config-x';
    const cfgPath = report('sr-D2.config.json', JSON.stringify({ sourceRevision: cfgX, rules: {} }));
    const code = run([
      ...COMMON,
      '--coverage-report',
      report('sr-D2.json', body),
      '--coverage-map',
      `${CASE_01}=to.ts`,
      '--per-test-run',
      '--config',
      cfgPath,
      '--source-revision',
      REV,
    ]);
    expect(code).toBe(0);
    const json = reportJson();
    const subj = json.evidence.line_coverage;
    expect(subj.source_revision).toBe(REV);
    const decl = json.testResults[0].evidence.line_coverage;
    expect(decl.source_revision).toBe(REV);
  });

  it('E. --source-revision with no coverage evidence is inert (output identical to no-flag run)', () => {
    const baselineCode = run([...COMMON]);
    expect(baselineCode).toBe(0);
    const baseline = stdout;

    const flaggedCode = run([...COMMON, '--source-revision', REV]);
    expect(flaggedCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toBe(baseline);
    expect(stdout).not.toContain(REV);
  });
});

it('--help lists --source-revision', () => {
  const code = run(['--help']);
  expect(code).toBe(0);
  expect(stdout).toContain('--source-revision');
});
