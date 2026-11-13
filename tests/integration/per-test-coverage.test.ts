/**
 * CT-COV-001 unit D — per-test-run corpus proof (real vitest runs, pinned).
 *
 * The per-test-run mode is reached by declaring the revision at the provider
 * options layer (`source_revision` + `analyzedRevision`), never by inferring it
 * from the report: a revision-less report stays UNAVAILABLE/INDETERMINATE per the
 * locked ruling (jev/record/ct-cov-revision-2026-11-10.md, keep_guard).
 *
 * Recipe (validation/cov001-per-test-recipe.sh, machine-local artifacts):
 *   `vitest run <test_file> --coverage --coverage.provider=v8
 *    --coverage.reporter=json --coverage.reportsDirectory=coverage-ptr`
 * on the two pinned vitest-family repos (validation/corpus-manifest.json).
 *
 * Two format boundaries are pinned here, both observed on real runs:
 *   1. the RAW vitest/v8 `coverage-final.json` is an Istanbul FLAT map keyed by
 *      absolute production paths; `parseCoverageReport` does not read it
 *      (reason: 'unsupported coverage report format'). Test files never appear
 *      in the map (contract §1.1), so a per-file run's map IS the run-scoped
 *      evidence.
 *   2. the DERIVED artifact (`{ files: { <abs production path>: { coveredLines }}`)
 *      carries the same run's line hits in the c8 shape the provider parses; the
 *      derivation is mechanical and lives in the recipe script, not here.
 *
 * LIMITATION: validation/ is gitignored (.gitignore) and machine-local, so on a
 * fresh checkout (CI) the case manifest is absent and the whole suite is SKIPPED
 * with an explicit warning. Within a machine that HAS the manifest — the recipe
 * writes the manifest and the artifacts in the same run — a missing artifact is
 * a harness failure, not a fresh checkout, so it FAILS with the recipe command
 * rather than skipping.
 */

import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

import { applyCoverageReport, parseCoverageReport } from '../../src/providers/coverage';
import { evaluateRule, evaluateTests } from '../../src/core/evaluation';
import { RuleResult } from '../../src/core/result';
import { CT_COV_001 } from '../../src/rules/ct-cov-001';
import { Availability, CollectionStatus } from '../../src/core/evidence';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../src/core/analysis';

const REPO_ROOT = join(__dirname, '..', '..');
const RESULT_ROOT = join(REPO_ROOT, 'validation', 'cov001-per-test');
const MANIFEST_PATH = join(RESULT_ROOT, 'manifest.json');
const RECIPE = 'validation/cov001-per-test-recipe.sh';

interface CaseEntry {
  id: 'executed' | 'unexecuted' | 'unmapped';
  mapped_to: string | null;
}

interface RepoEntry {
  name: string;
  commit_sha: string;
  checkout_dir: string;
  test_file: string;
  test_file_abs: string;
  raw_artifact: string;
  raw_sha256: string;
  derived_artifact: string;
  vitest_command: string;
  cases: CaseEntry[];
}

/** Golden pinned per `<repo>:<case>` from the real run's pinned artifacts. */
interface Golden {
  covered_lines: number;
  subject: RuleResult;
  subject_value: number | undefined;
  decl: RuleResult;
  decl_value: number | undefined;
}

/** Pinned baseline — values extracted verbatim from the pinned run artifacts
 *  (jq/python3 over validation/cov001-per-test/<name>-coverage.json:
 *  coveredLines length per mapped file, then the provider + rule outputs).
 *  covered_lines anchors the derivation to the real run: a changed derivation
 *  moves this number and breaks the golden.
 */
const PINNED_COMMITS: Record<string, string> = {
  redux: '61ebf8596654cf3c4b197e426e302fcb3c2bc13e',
  zustand: '9fed2eb2f3af672da9f7bf694b996df3831fc207',
};

const PINNED: Record<string, Golden> = {
  // test/createStore.spec.ts -> src/createStore.ts: 75 of 76 statements executed.
  'redux:executed': {
    covered_lines: 75,
    subject: RuleResult.PASS,
    subject_value: 75,
    decl: RuleResult.PASS,
    decl_value: 1,
  },
  // test/createStore.spec.ts -> src/utils/warning.ts: instrumented, zero executed
  // statements. Real zero evidence, not a fabricated empty report.
  'redux:unexecuted': {
    covered_lines: 0,
    subject: RuleResult.FAIL,
    subject_value: 0,
    decl: RuleResult.FAIL,
    decl_value: 0,
  },
  // No mapping: the subject IS the test file, which never appears in the map.
  'redux:unmapped': {
    covered_lines: -1,
    subject: RuleResult.INDETERMINATE,
    subject_value: undefined,
    decl: RuleResult.INDETERMINATE,
    decl_value: undefined,
  },
  // tests/devtools.test.tsx -> src/middleware/devtools.ts: 237 covered lines.
  'zustand:executed': {
    covered_lines: 237,
    subject: RuleResult.PASS,
    subject_value: 237,
    decl: RuleResult.PASS,
    decl_value: 1,
  },
  // tests/devtools.test.tsx -> src/middleware/combine.ts: loaded, never executed.
  'zustand:unexecuted': {
    covered_lines: 0,
    subject: RuleResult.FAIL,
    subject_value: 0,
    decl: RuleResult.FAIL,
    decl_value: 0,
  },
  'zustand:unmapped': {
    covered_lines: -1,
    subject: RuleResult.INDETERMINATE,
    subject_value: undefined,
    decl: RuleResult.INDETERMINATE,
    decl_value: undefined,
  },
};

const NR_OF_TESTS = { decl_lines: [10, 24] };

/** Minimal subject analysis, mirroring tests/providers/coverage.test.ts:83-113. */
function analysisWith(file: string, declLines: number[]): AnalysisOutput {
  return {
    subject: {
      id: `${file}#file`,
      name: file,
      file,
      language: 'typescript',
      framework: 'vitest',
      type: TestType.UNIT,
    },
    analysis: {
      status: AnalysisStatus.SUCCESS,
      completeness: Completeness.COMPLETE,
      scope: 'test-body',
      test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
    },
    evidence: {},
    capabilities: { typescript: CapabilityStatus.AVAILABLE },
    tests: declLines.map((line) => ({
      test: { id: `${file}#it@${line}`, name: `test_${line}`, line, declaration: 'it' },
      analysis: {
        status: AnalysisStatus.SUCCESS,
        completeness: Completeness.COMPLETE,
        scope: 'test-body',
        test_type: { value: TestType.UNIT, source: ClassificationSource.EXPLICIT },
      },
      evidence: {},
      declaration_gap: null,
    })),
  };
}

// validation/ is gitignored and machine-local: on a fresh checkout (CI) the
// manifest is absent — skip the whole suite with an explicit warning rather than
// crashing at module load (same skip-if-missing design as
// tests/integration/corpus-goldens.test.ts:66-73).
const manifest: RepoEntry[] | null = existsSync(MANIFEST_PATH)
  ? (JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as RepoEntry[])
  : null;

function requireArtifact(path: string): void {
  if (existsSync(path)) return;
  throw new Error(
    `CT-COV-001 unit D: pinned artifact missing: ${path}\n` +
      `the case manifest exists, so this machine ran the recipe; re-run: bash ${RECIPE}`,
  );
}

describe('CT-COV-001 unit D — per-test-run corpus recipe (real vitest runs)', () => {
  it('declares the pinned vitest-family repos in the case manifest', () => {
    if (manifest === null) {
      console.warn(
        'per-test-coverage: SKIP manifest check — validation/cov001-per-test/manifest.json missing (machine-local, gitignored)',
      );
      return;
    }
    expect(
      manifest
        .map((e) => ({ name: e.name, commit_sha: e.commit_sha, test_file: e.test_file }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: 'redux', commit_sha: PINNED_COMMITS.redux, test_file: 'test/createStore.spec.ts' },
      { name: 'zustand', commit_sha: PINNED_COMMITS.zustand, test_file: 'tests/devtools.test.tsx' },
    ]);
  });

  if (manifest === null) {
    it.skip('per-test-run corpus goldens — case manifest missing on this checkout', () => {});
  } else {
    for (const entry of manifest) {
      describe(`${entry.name} @ ${entry.commit_sha.slice(0, 12)}`, () => {
        // Pinned boundary 1: the RAW vitest/v8 report is not provider-consumable.
        it('raw vitest coverage-final.json is an Istanbul flat map the provider does not parse', () => {
          requireArtifact(entry.raw_artifact);
          // Integrity pin: the goldens below hold only for these exact run bytes.
          const digest = createHash('sha256').update(readFileSync(entry.raw_artifact)).digest('hex');
          expect(digest).toBe(entry.raw_sha256);
          const raw = parseCoverageReport(entry.raw_artifact);
          expect(raw.records.size).toBe(0);
          expect(raw.reason).toBe('unsupported coverage report format');
        });

        it('recipe ran a single test file with the json coverage reporter', () => {
          expect(entry.vitest_command).toContain('vitest run');
          expect(entry.vitest_command).toContain('--coverage.reporter=json');
          expect(entry.vitest_command).toContain(entry.test_file);
        });

        // Pinned boundary 2: the derived per-file report drives the per-test-run mode.
        for (const testCase of entry.cases) {
          const golden = PINNED[`${entry.name}:${testCase.id}`];
          it(`${testCase.id}: ${golden.subject} (mapped pair ${testCase.mapped_to ?? 'none'})`, () => {
            requireArtifact(entry.derived_artifact);
            const derived = JSON.parse(readFileSync(entry.derived_artifact, 'utf8')) as {
              files: Record<string, { coveredLines: number[] }>;
            };
            if (testCase.mapped_to !== null) {
              expect(derived.files[testCase.mapped_to].coveredLines).toHaveLength(golden.covered_lines);
            }

            // Revision declared at the provider options layer (locked ruling): no
            // inference from the report, no new CLI flag.
            const out = applyCoverageReport(
              analysisWith(entry.test_file_abs, NR_OF_TESTS.decl_lines),
              entry.derived_artifact,
              {
                per_test_run: true,
                source_revision: entry.commit_sha,
                analyzedRevision: entry.commit_sha,
                ...(testCase.mapped_to !== null ? { coverageMap: { [entry.test_file_abs]: testCase.mapped_to } } : {}),
              },
            );

            const subject = out.evidence.line_coverage;
            expect(subject.per_test_run).toBe(true);
            expect(subject.value).toBe(golden.subject_value);
            expect(evaluateRule(CT_COV_001, out).finding?.result).toBe(golden.subject);

            if (testCase.mapped_to === null) {
              // No mapping: the run-scoped report has no entry for the TEST file
              // (contract §1.1 — test files are never instrumented), so the marker
              // cannot make a claim: UNKNOWN + INDETERMINATE.
              expect(subject.availability).toBe(Availability.UNKNOWN);
              expect(subject.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
              expect(subject.reason).toBe(`no coverage data for ${entry.test_file_abs}`);
            } else {
              expect(subject.availability).toBe(Availability.KNOWN);
              expect(subject.coverage.status).toBe(CollectionStatus.COMPLETE);
              expect(subject.reason).toBe(
                `coverage mapped from ${entry.test_file_abs} to ${testCase.mapped_to} per user mapping`,
              );
            }

            expect(out.tests).toHaveLength(NR_OF_TESTS.decl_lines.length);
            for (const [i, scope] of out.tests!.entries()) {
              const decl = scope.evidence.line_coverage;
              expect(decl.value).toBe(golden.decl_value);
              expect('per_test_run' in decl).toBe(false);
              expect(decl.reason).toBe(
                testCase.mapped_to === null
                  ? `no coverage data for ${entry.test_file_abs}`
                  : `coverage evidence from a run scoped to ${entry.test_file_abs}`,
              );
              expect(evaluateTests(CT_COV_001, out)[i].finding?.result).toBe(golden.decl);
            }
          });
        }
      });
    }
  }
});
