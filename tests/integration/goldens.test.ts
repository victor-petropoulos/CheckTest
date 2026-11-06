/**
 * B8 — full-file byte-exact regression goldens (JSON + SARIF).
 *
 * DPC-5 (DECISIONS.md:40,46-48) closed golden reports as a PROJECTED SUBSET
 * (the `*.expected.json` sidecars), with byte-exact full-file goldens deferred
 * as a follow-on. This suite is that follow-on: it pins the ENTIRE report the
 * real CLI emits, so a schema change (a renamed key, a dropped field, a reordered
 * entry, a reworded reason) can never silently drift.
 *
 * Unlike the sidecar oracle (tests/integration/fixtures.test.ts), which projects
 * a handful of fields through in-process seams, these goldens are produced by
 * spawning the built CLI (`node dist/src/cli.js`) and comparing stdout
 * BYTE-FOR-BYTE against a committed file. Nothing is deep-compared: `toBe` on
 * the exact string, so any byte change fails.
 *
 * Three pinned cases span the verdict space and both reporter file shapes:
 *
 *   case-24-vitest-standard   PASS           JSON + SARIF
 *   case-27-k15-describe-fail FAIL (K-15)     JSON + SARIF
 *   case-25-vitest-aliased    INDETERMINATE   JSON + SARIF
 *
 * Two normalizations, both deliberate:
 *
 *   1. The absolute fixture root is replaced with `<fixture-root>` — the exact
 *      convention the committed `case-24.sarif.json` golden already uses — so
 *      the goldens stay machine-portable.
 *   2. Exactly ONE trailing `\n` is stripped. `cli.ts` writes `${report}\n`, but
 *      both reporters return a bare string with no trailing newline. Stripping
 *      the CLI's separator makes the golden the REPORTER PAYLOAD, which is why
 *      the single committed `case-24.sarif.json` is authoritative for both the
 *      direct `toSarif` golden test (tests/reporters/sarif.test.ts) and this
 *      CLI-level one — one file, no drift between the two seams.
 *
 * Determinism is re-asserted here (report plan §1, D9): each case is run TWICE
 * and the two runs must be byte-identical, so a clock, a set iteration order or
 * an environment read creeping into a reporter fails this suite.
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
/** The built CLI entry point. `dist/` is gitignored, so beforeAll builds it. */
const CLI = join(REPO_ROOT, 'dist', 'src', 'cli.js');
const FIXTURE_ROOT = join(REPO_ROOT, 'tests', 'fixtures', 'ct-int-001');
const GOLDEN_ROOT = join(__dirname, '..', 'reporters', 'fixtures');

interface Golden {
  /** Committed golden file under tests/reporters/fixtures/. */
  golden: string;
  /** Fixture case directory. */
  caseDir: string;
  /** Input file within the case directory. */
  file: string;
  format: 'json' | 'sarif';
  /** The verdict this golden pins (documentation; the bytes are the oracle). */
  verdict: 'PASS' | 'FAIL' | 'INDETERMINATE';
}

const GOLDENS: readonly Golden[] = [
  {
    golden: 'case-24.json',
    caseDir: 'case-24-vitest-standard',
    file: 'sample.test.ts',
    format: 'json',
    verdict: 'PASS',
  },
  {
    golden: 'case-24.sarif.json',
    caseDir: 'case-24-vitest-standard',
    file: 'sample.test.ts',
    format: 'sarif',
    verdict: 'PASS',
  },
  {
    golden: 'k15-fail.json',
    caseDir: 'case-27-k15-describe-fail',
    file: 'sample.test.ts',
    format: 'json',
    verdict: 'FAIL',
  },
  {
    golden: 'k15-fail.sarif.json',
    caseDir: 'case-27-k15-describe-fail',
    file: 'sample.test.ts',
    format: 'sarif',
    verdict: 'FAIL',
  },
  {
    golden: 'case-25.json',
    caseDir: 'case-25-vitest-aliased',
    file: 'sample.test.ts',
    format: 'json',
    verdict: 'INDETERMINATE',
  },
  {
    golden: 'case-25.sarif.json',
    caseDir: 'case-25-vitest-aliased',
    file: 'sample.test.ts',
    format: 'sarif',
    verdict: 'INDETERMINATE',
  },
];

// The compiled CLI is gitignored (.gitignore:2), so a fresh checkout has none.
// Build it only when needed — a missing CLI, or one older than the newest source
// file. Building unconditionally spawns a second tsc alongside jest's own
// compiler under --coverage; that spike once segfaulted the worker, and on the
// common already-built path it is pure waste.
// ponytail: freshness check beats an unconditional build in a test's beforeAll.
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

/** Run the real CLI for one fixture and return its normalized stdout. */
function runCli(entry: Golden): string {
  const args = [CLI, '--test', join(FIXTURE_ROOT, entry.caseDir, entry.file), '--type', 'UNIT', '--rule', 'CT-INT-001'];
  if (entry.format === 'sarif') {
    args.push('--format', 'sarif');
  }
  const stdout = execFileSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return stdout.replace(/\n$/, '').split(FIXTURE_ROOT).join('<fixture-root>');
}

/** The committed golden, verbatim (no trimming — the bytes are the contract). */
function golden(entry: Golden): string {
  return readFileSync(join(GOLDEN_ROOT, entry.golden), 'utf8');
}

describe('B8 — full-file byte-exact goldens (JSON + SARIF)', () => {
  it.each(GOLDENS)('$golden matches the real CLI output byte-for-byte', (entry) => {
    // Exact string equality, never a deep compare: any byte change fails.
    expect(runCli(entry)).toBe(golden(entry));
  });

  it.each(GOLDENS)('$golden is deterministic across two CLI runs', (entry) => {
    // A clock, run-order dependence or environment read would break this.
    expect(runCli(entry)).toBe(runCli(entry));
  });

  it('pins one golden per verdict and per format (the coverage claim)', () => {
    expect(GOLDENS.map((entry) => entry.verdict).sort()).toEqual([
      'FAIL',
      'FAIL',
      'INDETERMINATE',
      'INDETERMINATE',
      'PASS',
      'PASS',
    ]);
    expect(GOLDENS.filter((entry) => entry.format === 'sarif')).toHaveLength(3);
  });
});
