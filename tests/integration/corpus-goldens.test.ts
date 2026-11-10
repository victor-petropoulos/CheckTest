/**
 * DPC-5 — corpus-result aggregate goldens (projected subset).
 *
 * Pins, per repo, the projected subset {name, analysisStatus, total, pass, fail,
 * indeterminate} of validation/<name>-report.json — a projected subset, NOT the
 * full file. Same convention as tests/integration/fixtures.test.ts:89-115
 * (project() compares only the asserted fields); full-file byte-exact goldens
 * are deferred, see tests/integration/goldens.test.ts.
 *
 * Repo identity comes from the manifest key (validation/corpus-manifest.json),
 * NOT from report.test.name — that field holds the analyzed file path
 * (e.g. 'res.sendStatus.js' for express), which differs per repo.
 *
 * LIMITATION: validation/ is gitignored (.gitignore) and machine-local — the
 * corpus harness produces the reports. On a fresh checkout they are absent, so
 * any repo whose report is missing is SKIPPED here with an explicit console
 * warning rather than failing. This suite pins the local machine's corpus
 * baseline; it cannot gate a clean checkout.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const VALIDATION_ROOT = join(REPO_ROOT, 'validation');
const MANIFEST_PATH = join(VALIDATION_ROOT, 'corpus-manifest.json');

interface RepoManifest {
  name: string;
  clone_url: string;
  commit_sha: string;
  language: string;
  framework: string;
  test_runner_version: string;
  analysis_command: string;
  license: string;
  clone_dir: string;
  test_path: string;
}

interface Aggregate {
  name: string;
  analysisStatus: string;
  total: number;
  pass: number;
  fail: number;
  indeterminate: number;
}

/** Exact projection pinned per repo. */
function project(report: unknown, repoName: string): Aggregate {
  const r = report as {
    analysisStatus?: string;
    summary?: { total?: number; pass?: number; fail?: number; indeterminate?: number };
  };
  return {
    name: repoName,
    analysisStatus: r.analysisStatus ?? '',
    total: r.summary?.total ?? -1,
    pass: r.summary?.pass ?? -1,
    fail: r.summary?.fail ?? -1,
    indeterminate: r.summary?.indeterminate ?? -1,
  };
}

// validation/ is gitignored and machine-local: on a fresh checkout (CI) the
// manifest may be absent — resolve it lazily and skip the whole suite with an
// explicit warning rather than crashing at module load (skip-if-missing design,
// same convention as the per-repo report skip below).
const manifest: RepoManifest[] | null = existsSync(MANIFEST_PATH)
  ? (JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as RepoManifest[])
  : null;
const NAMES = (manifest ?? []).map((entry) => entry.name);

/** Pinned baseline — values extracted verbatim from validation/*-report.json
 *  (jq: [.name, .analysisStatus, .summary.total, .summary.pass, .summary.fail, .summary.indeterminate]).
 *  Repo key = manifest name; counts come from report.summary.
 */
const PINNED: Record<string, Aggregate> = {
  axios: { name: 'axios', analysisStatus: 'SUCCESS', total: 17, pass: 0, fail: 4, indeterminate: 13 },
  zustand: { name: 'zustand', analysisStatus: 'SUCCESS', total: 93, pass: 9, fail: 0, indeterminate: 84 },
  query: { name: 'query', analysisStatus: 'SUCCESS', total: 39, pass: 19, fail: 0, indeterminate: 20 },
  jest: { name: 'jest', analysisStatus: 'SUCCESS', total: 18, pass: 15, fail: 1, indeterminate: 2 },
  prisma: { name: 'prisma', analysisStatus: 'SUCCESS', total: 23, pass: 15, fail: 0, indeterminate: 8 },
  redux: { name: 'redux', analysisStatus: 'SUCCESS', total: 42, pass: 28, fail: 0, indeterminate: 14 },
  'styled-components': {
    name: 'styled-components',
    analysisStatus: 'SUCCESS',
    total: 50,
    pass: 14,
    fail: 0,
    indeterminate: 36,
  },
  'testcontainers-node': {
    name: 'testcontainers-node',
    analysisStatus: 'SUCCESS',
    total: 2,
    pass: 0,
    fail: 0,
    indeterminate: 2,
  },
  vitest: { name: 'vitest', analysisStatus: 'SUCCESS', total: 2, pass: 2, fail: 0, indeterminate: 0 },
  'apollo-server': {
    name: 'apollo-server',
    analysisStatus: 'UNSUPPORTED',
    total: 1,
    pass: 0,
    fail: 0,
    indeterminate: 1,
  },
  express: { name: 'express', analysisStatus: 'SUCCESS', total: 3, pass: 3, fail: 0, indeterminate: 0 },
  react: { name: 'react', analysisStatus: 'SUCCESS', total: 1, pass: 1, fail: 0, indeterminate: 0 },
  'react-testing-library': {
    name: 'react-testing-library',
    analysisStatus: 'UNSUPPORTED',
    total: 1,
    pass: 0,
    fail: 0,
    indeterminate: 1,
  },
  'checktest-self': {
    name: 'checktest-self',
    analysisStatus: 'SUCCESS',
    total: 26,
    pass: 20,
    fail: 0,
    indeterminate: 6,
  },
};

describe('DPC-5 — corpus aggregate goldens (projected subset)', () => {
  it('declares the 14 planned repos in the manifest', () => {
    if (manifest === null) {
      console.warn(
        'corpus-goldens: SKIP manifest check — validation/corpus-manifest.json missing (machine-local, gitignored)',
      );
      return;
    }
    expect(NAMES.sort()).toEqual(
      [
        'axios',
        'zustand',
        'query',
        'jest',
        'prisma',
        'redux',
        'styled-components',
        'testcontainers-node',
        'vitest',
        'apollo-server',
        'express',
        'react',
        'react-testing-library',
        'checktest-self',
      ].sort(),
    );
  });

  if (manifest === null) {
    it.skip('corpus aggregate goldens — manifest missing on this checkout', () => {});
  } else {
    it.each(NAMES)('%s report aggregate matches pinned golden', (name) => {
      const reportPath = join(VALIDATION_ROOT, `${name}-report.json`);
      if (!existsSync(reportPath)) {
        // validation/ is gitignored and machine-local: a missing report skips the
        // repo with an explicit warning instead of failing the suite.
        console.warn(
          `corpus-goldens: SKIP ${name} — validation/${name}-report.json missing; ` +
            'validation/ is gitignored and machine-local, so this baseline cannot be pinned on a fresh checkout',
        );
        return;
      }
      const actual = project(JSON.parse(readFileSync(reportPath, 'utf8')), name);
      expect(actual).toEqual(PINNED[name]);
    });
  }
});
