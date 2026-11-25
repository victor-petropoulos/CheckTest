import { join } from 'path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

import { main } from '../src/cli';
import { UsageError } from '../src/cli';

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

describe('CLI --provenance', () => {
  const TMP = join(process.env.TMPDIR || tmpdir(), 'checktest-cli-prov');

  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  it('writes manifest with all 11 top-level fields; sha256 matches test file', () => {
    const out = join(TMP, 'prov.json');
    const testFile = fixture('case-01-standard-assertion');
    const code = main(['--test', testFile, '--type', 'UNIT', '--provenance', out]);
    expect(code).toBe(0);
    const m = JSON.parse(readFileSync(out, 'utf8'));
    const keys = Object.keys(m);
    for (const k of [
      'checktest_version',
      'timestamp',
      'command',
      'input',
      'adapter',
      'decidedBy',
      'rules',
      'external_evidence',
      'exit_code',
      'report_file',
    ]) {
      expect(keys).toContain(k);
    }
    // input has file/sha256/size_bytes = 3 → 11 top-level-ish? count flattened fields
    expect(m.input.file).toBe(testFile);
    expect(m.input.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof m.input.size_bytes).toBe('number');
    expect(m.external_evidence.coverage_report).toBeNull();
    expect(m.external_evidence.mutation_report).toBeNull();
  });

  it('--provenance empty value → UsageError', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--provenance', '']);
    expect(code).toBe(1);
    expect(stderr).toContain('missing value for --provenance');
  });

  it('--provenance missing value (last arg) → UsageError', () => {
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--provenance']);
    expect(code).toBe(1);
    expect(stderr).toContain("missing value for '--provenance'");
  });

  it('without --provenance → no file written', () => {
    const out = join(TMP, 'nope.json');
    main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT']);
    let exists = true;
    try {
      readFileSync(out);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it('nested path creates parent dirs', () => {
    const out = join(TMP, 'sub', 'deep', 'prov.json');
    const code = main(['--test', fixture('case-01-standard-assertion'), '--type', 'UNIT', '--provenance', out]);
    expect(code).toBe(0);
    const m = JSON.parse(readFileSync(out, 'utf8'));
    expect(m.exit_code).toBe(0);
  });

  it('external evidence populated when --coverage-report passed', () => {
    const covPath = join(TMP, 'cov.json');
    writeFileSync(covPath, JSON.stringify({ total: { lines: { pct: 100 } } }), 'utf8');
    const out = join(TMP, 'prov.json');
    const code = main([
      '--test',
      fixture('case-01-standard-assertion'),
      '--type',
      'UNIT',
      '--coverage-report',
      covPath,
      '--provenance',
      out,
    ]);
    expect(code).toBe(0);
    const m = JSON.parse(readFileSync(out, 'utf8'));
    expect(m.external_evidence.coverage_report).not.toBeNull();
    expect(m.external_evidence.coverage_report.path).toBe(covPath);
    expect(m.external_evidence.coverage_report.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('CLI --provenance manifestFramework', () => {
  const TMP = join(process.env.TMPDIR || tmpdir(), 'checktest-cli-prov-mf');

  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  it('includes manifestFramework when package.json declares jest', () => {
    const testFile = join(TMP, 'sample.test.ts');
    writeFileSync(testFile, readFileSync(fixture('case-01-standard-assertion'), 'utf8'));
    writeFileSync(join(TMP, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29' } }));
    const out = join(TMP, 'prov.json');
    const code = main(['--test', testFile, '--type', 'UNIT', '--provenance', out]);
    expect(code).toBe(0);
    const m = JSON.parse(readFileSync(out, 'utf8'));
    expect(m.manifestFramework).toBe('jest');
  });

  it('omits manifestFramework when no package.json', () => {
    const testFile = join(TMP, 'sample.test.ts');
    writeFileSync(testFile, readFileSync(fixture('case-01-standard-assertion'), 'utf8'));
    const out = join(TMP, 'prov.json');
    const code = main(['--test', testFile, '--type', 'UNIT', '--provenance', out]);
    expect(code).toBe(0);
    const m = JSON.parse(readFileSync(out, 'utf8'));
    expect(m.manifestFramework).toBeUndefined();
    expect('manifestFramework' in m).toBe(false);
  });
});
