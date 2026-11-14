/**
 * Integration: Python slice through the CLI pipeline (Phase 8 task C5).
 */

import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

import { main } from '../../src/cli';

const FIXTURES = join(__dirname, '..', 'adapters', 'python', 'fixtures');

function fixture(name: string): string {
  return join(FIXTURES, name);
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  json: Record<string, any> | null;
}

function runMain(args: string[]): RunResult {
  const dir = join(tmpdir(), `checktest-pyslice-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const cwd = process.cwd();
  process.chdir(dir);
  let stdout = '';
  let stderr = '';
  const so = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  });
  const se = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  });
  let code = 0;
  try {
    code = main(args);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    so.mockRestore();
    se.mockRestore();
  }
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = null;
  }
  return { code, stdout, stderr, json };
}

describe('python slice — integration (Phase 8 C5)', () => {
  it('pytest_sample.py + --type UNIT: assertion_count KNOWN value 3, CT-INT-001 PASS', () => {
    const r = runMain(['--test', fixture('pytest_sample.py'), '--type', 'UNIT']);
    expect(r.code).toBe(0);
    expect(r.json!.analysisStatus).toBe('SUCCESS');
    expect(r.json!.evaluationStatus).toBe('EVALUATED');
    expect(r.json!.evidence.assertion_count.availability).toBe('KNOWN');
    expect(r.json!.evidence.assertion_count.value).toBe(3);
    expect(r.json!.ruleResults.map((x: any) => x.result)).toEqual(['PASS', 'PASS']);
  });

  it('pytest_sample.py + --coverage-report lcov + --type UNIT: adapter-owned coverage preserved (D-20261112-6)', () => {
    const r = runMain([
      '--test',
      fixture('pytest_sample.py'),
      '--coverage-report',
      fixture('coverage.lcov'),
      '--type',
      'UNIT',
    ]);
    expect(r.code).toBe(0);
    expect(r.json!.analysisStatus).toBe('SUCCESS');
    // Actual (clobbered) outcome pinned; collector's KNOWN value is lost.
    // D-20261112-6: the core coverage provider applies only to the TypeScript
    // adapter, so the Python adapter's own lcov evidence survives intact
    // (KNOWN instead of the clobbered UNKNOWN).
    expect(r.json!.evidence.line_coverage.availability).toBe('KNOWN');
    expect(r.json!.evidence.line_coverage.source).toBe('python-pytest-adapter');
    expect(r.json!.evidence.line_coverage.value).toEqual([1, 2, 5, 6, 9]);

    const r2 = runMain([
      '--test',
      fixture('pytest_sample.py'),
      '--coverage-report',
      fixture('coverage.lcov'),
      '--type',
      'UNIT',
      '--rule',
      'CT-COV-001',
    ]);
    expect(r2.code).toBe(0);
    // Phase 8 C5 completion: the python adapter now supplies per-declaration
    // line_coverage (the file-level covered lines intersected with each
    // declaration's OWN span), so CT-COV-001 appraises EACH declaration
    // instead of reporting the evidence as absent.
    // pytest_sample.py + coverage.lcov (covered lines [1,2,5,6,9]):
    //   test_add (lines 4-6) -> covered {5,6} -> line_coverage=2 -> PASS
    //   test_sub (lines 9-10) -> covered {9}   -> line_coverage=1 -> PASS
    expect(r2.json!.ruleResults.map((x: any) => x.result)).toEqual(['PASS', 'PASS']);
    expect(r2.json!.ruleResults[0].reason).toContain('line_coverage=2 >= 1');
    expect(r2.json!.ruleResults[1].reason).toContain('line_coverage=1 >= 1');
  });

  it('guard: the TypeScript adapter still routes --coverage-report through the core provider (D-20261112-6)', () => {
    // Same seam, opposite side of the gate: the provider runs for the TypeScript
    // adapter (evidence carries the provider fields), while the Python adapter
    // keeps its own adapter-owned record.
    const tsFile = join(__dirname, '..', 'fixtures', 'ct-int-001', 'case-01-standard-assertion', 'sample.test.ts');
    const key = tsFile;
    const reportPath = join(tmpdir(), `checktest-ts-cov-${Date.now()}.json`);
    writeFileSync(reportPath, JSON.stringify({ covered: { [key]: [0, 0, 0, 0, 0, 0, 0, 1] } }), 'utf8');
    const r = runMain(['--test', tsFile, '--type', 'UNIT', '--coverage-report', reportPath]);
    rmSync(reportPath, { force: true });
    expect(r.code).toBe(0);
    expect(r.json!.evidence.line_coverage.provider).toBe('istanbul');
    expect(r.json!.evidence.line_coverage.provenance).toBe('EXTERNAL');
  });

  it('unittest_sample.py + --type UNIT: assertion_count KNOWN value 2, CT-INT-001 PASS', () => {
    const r = runMain(['--test', fixture('unittest_sample.py'), '--type', 'UNIT']);
    expect(r.code).toBe(0);
    expect(r.json!.analysisStatus).toBe('SUCCESS');
    expect(r.json!.evidence.assertion_count.availability).toBe('KNOWN');
    expect(r.json!.evidence.assertion_count.value).toBe(2);
    expect(r.json!.ruleResults.map((x: any) => x.result)).toEqual(['PASS']);
  });

  it('hypothesis_given.py + --type UNIT: PARTIAL unsupported-form through pipeline', () => {
    const r = runMain(['--test', fixture('hypothesis_given.py'), '--type', 'UNIT']);
    expect(r.code).toBe(0);
    expect(r.json!.analysisStatus).toBe('SUCCESS');
    expect(r.json!.evaluationStatus).toBe('EVALUATED');
    expect(r.json!.evidence.assertion_count.availability).toBe('UNKNOWN');
    expect(r.json!.evidence.assertion_count.coverage.status).toBe('PARTIAL');
    expect(r.json!.evidence.assertion_count.reason).toContain('unsupported-form');
    expect(r.json!.ruleResults.map((x: any) => x.result)).toEqual(['INDETERMINATE']);
  });

  it('--adapter python-pytest-adapter on a .ts fixture: 0-tests FAILED path exit 2', () => {
    const dir = join(tmpdir(), `checktest-pyslice-ts-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const ts = join(dir, 'sample.test.ts');
    writeFileSync(ts, 'test("x", () => { expect(1).toBe(1); });\n');
    const r = runMain(['--test', ts, '--type', 'UNIT', '--adapter', 'python-pytest-adapter']);
    // runMain chdirs away from dir, but --test path is absolute so still resolves.
    rmSync(dir, { recursive: true, force: true });
    // The analysisStatus of a WRONG-adapter .ts call is SUBSTRATE-STATE
    // dependent, so it is NOT pinned here:
    //   - healthy native substrate: tree-sitter parses the .ts source with the
    //     PYTHON grammar (ERROR nodes, no declarations), the walk finds 0
    //     declarations -> analysisStatus SUCCESS with 0 tests;
    //   - degraded substrate (upstream node-tree-sitter #181, the "jest
    //     race": a double module evaluation poisons
    //     Tree.prototype.rootNode so every parse yields no root): the native
    //     walk fails, python3-ast rejects the .ts source as a SyntaxError and
    //     the collector reports analysisStatus FAILED.
    // Both outcomes are contract-legitimate (D-20261112-7, node-tree-sitter
    // #181), so only the INVARIANTS are pinned here: exit 2 (no scope reached
    // a verdict), an empty testResults, and nothing on stderr. The healthy
    // substrate outcome is pinned by the guardrail case below.
    expect(r.code).toBe(2);
    expect(r.json!.testResults).toEqual([]);
    expect(r.stderr).toBe('');
  });

  it('--adapter python-pytest-adapter on a .ts fixture under a healthy native substrate: analysisStatus SUCCESS, 0 tests', () => {
    // GUARDRAIL for the node-tree-sitter #181 hardening in
    // src/adapters/python/collector.ts: with the pristine rootNode getter
    // re-installed, the native substrate parses the .ts source with the
    // python grammar (ERROR nodes, no declarations) and the collector reports
    // a SUCCESSFUL analysis with 0 tests. If a later module evaluation
    // poisons Tree.prototype.rootNode again, the native walk fails, python3-ast
    // rejects the .ts source and the analysisStatus flips to FAILED — this
    // case fails, which is exactly what the guardrail is for.
    const dir = join(tmpdir(), `checktest-pyslice-ts-healthy-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const ts = join(dir, 'sample.test.ts');
    writeFileSync(ts, 'test("x", () => { expect(1).toBe(1); });\n');
    const r = runMain(['--test', ts, '--type', 'UNIT', '--adapter', 'python-pytest-adapter']);
    rmSync(dir, { recursive: true, force: true });
    expect(r.json!.analysisStatus).toBe('SUCCESS');
    // 0 declarations -> 0 scopes -> the engine reached no verdict, so the
    // envelope reports evaluationStatus FAILED (reporters/json.ts).
    expect(r.json!.evaluationStatus).toBe('FAILED');
    expect(r.json!.testResults).toEqual([]);
  });
});
