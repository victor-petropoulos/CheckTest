/**
 * E4 — pinned-repo integration test for the Python slice corpus.
 *
 * Mirrors tests/integration/per-test-coverage.test.ts skip convention: validation/
 * is gitignored and machine-local, so a missing manifest SKIPS the whole suite
 * with an explicit warning rather than crashing at module load.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { execFileSync, execSync } from 'child_process';
import { join, dirname } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'dist', 'src', 'cli.js');
const MANIFEST_PATH = join(REPO_ROOT, 'validation', 'python-slice', 'manifest.json');
const GOLDEN_ROOT = join(REPO_ROOT, 'tests', 'fixtures', 'ct-int-001');

interface RepoEntry {
  name: string;
  commit_sha: string;
  checkout_dir: string;
  test_file: string;
  test_file_abs: string;
  raw_json_artifact: string;
  raw_json_sha256: string;
  raw_lcov_artifact: string;
  raw_lcov_sha256: string;
  coverage_json_path: string;
  lcov_path: string;
}

const manifest: RepoEntry[] | null = existsSync(MANIFEST_PATH)
  ? (JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as RepoEntry[])
  : null;

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

beforeAll(() => {
  if (!existsSync(CLI) || statSync(CLI).mtimeMs < newestMtime(join(REPO_ROOT, 'src'))) {
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'ignore' });
  }
}, 180_000);

function runCli(entry: RepoEntry, coveragePath: string | null, rule: string | null): string {
  const args = [CLI, '--test', entry.test_file_abs, '--type', 'UNIT'];
  if (coveragePath !== null) {
    args.push('--coverage-report', coveragePath);
  }
  if (rule !== null) {
    args.push('--rule', rule);
  }
  const stdout = execFileSync(process.execPath, args, { cwd: entry.checkout_dir, encoding: 'utf8' });
  const corpusRoot = dirname(entry.checkout_dir);
  return stdout.replace(/\n$/, '').split(corpusRoot).join('<corpus-root>');
}

function goldenPath(entry: RepoEntry): string {
  return join(GOLDEN_ROOT, `python-slice-${entry.name}`, 'report.json');
}

describe('E4 — python-slice corpus integration', () => {
  if (manifest === null) {
    it.skip('python-slice corpus — manifest missing on this checkout', () => {});
    return;
  }

  for (const entry of manifest) {
    describe(`${entry.name} @ ${entry.commit_sha.slice(0, 12)}`, () => {
      it('raw artifacts integrity (sha256)', () => {
        const j = createHash('sha256').update(readFileSync(entry.raw_json_artifact)).digest('hex');
        const l = createHash('sha256').update(readFileSync(entry.raw_lcov_artifact)).digest('hex');
        expect(j).toBe(entry.raw_json_sha256);
        expect(l).toBe(entry.raw_lcov_sha256);
      });

      it('dispatches to python adapter (manifest layer)', () => {
        const out = runCli(entry, entry.raw_lcov_artifact, 'CT-INT-001');
        const d = JSON.parse(out) as { adapter: string; decidedBy: string; schemaVersion: string };
        expect(d.adapter).toBe('python-pytest-adapter');
        expect(['flag', 'manifest', 'extension']).toContain(d.decidedBy);
        expect(d.schemaVersion).toBe('0.5');
      });

      it('CT-COV-001: line_coverage availability KNOWN with non-empty value', () => {
        const out = runCli(entry, entry.raw_lcov_artifact, 'CT-COV-001');
        const d = JSON.parse(out) as { evidence: { line_coverage: { availability: string; value: unknown[] } } };
        expect(d.evidence.line_coverage.availability).toBe('KNOWN');
        expect(Array.isArray(d.evidence.line_coverage.value)).toBe(true);
        expect((d.evidence.line_coverage.value as unknown[]).length).toBeGreaterThan(0);
      });

      it('CT-INT-001 verdict pinned per repo', () => {
        const out = runCli(entry, null, 'CT-INT-001');
        const d = JSON.parse(out) as { summary: { pass: number; fail: number } };
        if (entry.name === 'packaging') {
          // all 62 tests carry >=1 assertion -> PASS
          expect(d.summary.pass).toBe(62);
          expect(d.summary.fail).toBe(0);
        } else if (entry.name === 'click') {
          // all 42 tests carry >=1 assertion -> PASS
          expect(d.summary.pass).toBe(42);
          expect(d.summary.fail).toBe(0);
        } else {
          // pytest: 40 unittest-style tests report assertion_count=0, so
          // CT-INT-001 FAIL is the honest verdict, pinned deliberately.
          expect(d.summary.pass).toBe(30);
          expect(d.summary.fail).toBe(40);
        }
      });

      it('lcov vs coverage.py JSON agree (packaging)', () => {
        if (entry.name !== 'packaging') return;
        const a = JSON.parse(runCli(entry, entry.raw_lcov_artifact, 'CT-COV-001')) as {
          evidence: { line_coverage: { value: unknown[] } };
        };
        const b = JSON.parse(runCli(entry, entry.raw_json_artifact, 'CT-COV-001')) as {
          evidence: { line_coverage: { value: unknown[] } };
        };
        expect(a.evidence.line_coverage.value).toEqual(b.evidence.line_coverage.value);
      });

      it('golden report matches byte-for-byte', () => {
        const gp = goldenPath(entry);
        if (!existsSync(gp)) {
          console.warn(`python-slice-corpus: SKIP golden ${entry.name} — ${gp} missing`);
          return;
        }
        const actual = runCli(entry, null, null);
        const expected = readFileSync(gp, 'utf8');
        expect(actual).toBe(expected);
      });

      it('deterministic across two CLI runs', () => {
        expect(runCli(entry, null, null)).toBe(runCli(entry, null, null));
      });
    });
  }
});
