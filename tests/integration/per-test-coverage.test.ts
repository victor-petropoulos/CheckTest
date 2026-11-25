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
 * on the four pinned vitest-family repos (validation/corpus-manifest.json).
 *
 * Two format boundaries are pinned here, both observed on real runs:
 *   1. the RAW vitest/v8 `coverage-final.json` is an Istanbul FLAT map keyed by
 *      absolute production paths; since C2 `parseCoverageReport` reads shape-A
 *      natively and its coveredLines equal the DERIVED artifact on the same
 *      bytes. Test files never appear in the map (contract §1.1), so a
 *      per-file run's map IS the run-scoped evidence.
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

import { main } from '../../src/cli';

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
  axios: 'a81d62a22e4b291a05d5b087a89fcc9d16075e83',
  query: '3875d1d19642694dfcb14602cfeb582e393103e3',
  redux: '61ebf8596654cf3c4b197e426e302fcb3c2bc13e',
  zustand: '9fed2eb2f3af672da9f7bf694b996df3831fc207',
};

const PINNED: Record<string, Golden> = {
  // tests/unit/axios.test.js -> lib/utils.js: 204 covered lines.
  'axios:executed': {
    covered_lines: 204,
    subject: RuleResult.PASS,
    subject_value: 204,
    decl: RuleResult.PASS,
    decl_value: 1,
  },
  // tests/unit/axios.test.js -> lib/cancel/CancelToken.js: instrumented, zero
  // executed statements. Real zero evidence, not a fabricated empty report.
  'axios:unexecuted': {
    covered_lines: 0,
    subject: RuleResult.FAIL,
    subject_value: 0,
    decl: RuleResult.FAIL,
    decl_value: 0,
  },
  // No mapping: the subject IS the test file, which never appears in the map.
  'axios:unmapped': {
    covered_lines: -1,
    subject: RuleResult.INDETERMINATE,
    subject_value: undefined,
    decl: RuleResult.INDETERMINATE,
    decl_value: undefined,
  },
  // packages/vue-query/src/__tests__/useQuery.test.ts ->
  // packages/vue-query/src/useBaseQuery.ts: 67 covered lines.
  'query:executed': {
    covered_lines: 67,
    subject: RuleResult.PASS,
    subject_value: 67,
    decl: RuleResult.PASS,
    decl_value: 1,
  },
  // packages/vue-query/src/__tests__/useQuery.test.ts ->
  // packages/vue-query/src/useMutation.ts: loaded, never executed.
  'query:unexecuted': {
    covered_lines: 0,
    subject: RuleResult.FAIL,
    subject_value: 0,
    decl: RuleResult.FAIL,
    decl_value: 0,
  },
  'query:unmapped': {
    covered_lines: -1,
    subject: RuleResult.INDETERMINATE,
    subject_value: undefined,
    decl: RuleResult.INDETERMINATE,
    decl_value: undefined,
  },
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
      { name: 'axios', commit_sha: PINNED_COMMITS.axios, test_file: 'tests/unit/axios.test.js' },
      {
        name: 'query',
        commit_sha: PINNED_COMMITS.query,
        test_file: 'packages/vue-query/src/__tests__/useQuery.test.ts',
      },
      { name: 'redux', commit_sha: PINNED_COMMITS.redux, test_file: 'test/createStore.spec.ts' },
      { name: 'zustand', commit_sha: PINNED_COMMITS.zustand, test_file: 'tests/devtools.test.tsx' },
    ]);
  });

  if (manifest === null) {
    it.skip('per-test-run corpus goldens — case manifest missing on this checkout', () => {});
  } else {
    for (const entry of manifest) {
      describe(`${entry.name} @ ${entry.commit_sha.slice(0, 12)}`, () => {
        // Pinned boundary 1: the RAW vitest/v8 report is an Istanbul flat map;
        // since C2 it parses natively (shape A) with coveredLines identical to
        // the derived c8 recipe output for the same run bytes.
        it('raw vitest coverage-final.json parses natively (shape A, derive()-equivalent)', () => {
          requireArtifact(entry.raw_artifact);
          requireArtifact(entry.derived_artifact);
          // Integrity pin: the goldens below hold only for these exact run bytes.
          const digest = createHash('sha256').update(readFileSync(entry.raw_artifact)).digest('hex');
          expect(digest).toBe(entry.raw_sha256);
          const raw = parseCoverageReport(entry.raw_artifact);
          expect(raw.provider).toBe('vitest');
          expect(raw.reason).toBeUndefined();
          const derived = JSON.parse(readFileSync(entry.derived_artifact, 'utf8')) as {
            files: Record<string, { coveredLines: number[] }>;
          };
          expect(raw.records.size).toBe(Object.keys(derived.files).length);
          for (const [file, rec] of raw.records) {
            expect(rec.availability).toBe(Availability.KNOWN);
            expect(rec.coverage.status).toBe(CollectionStatus.COMPLETE);
            expect(rec.value).toEqual(derived.files[file].coveredLines);
          }
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
              expect(subject.reason).toBe(
                `no coverage data for ${entry.test_file_abs} (no --coverage-map <from>=<to> entry maps this test file to a production file with coverage)`,
              );
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
              // B5 C-2 (Decisions #12): ordinary non-mapped coverage carries no
              // per-declaration line_coverage copy; only mapped runs attribute it.
              if (decl === undefined) {
                expect(testCase.mapped_to).toBeNull();
              } else {
                expect(testCase.mapped_to).not.toBeNull();
                expect(decl.value).toBe(golden.decl_value);
                expect('per_test_run' in decl).toBe(false);
                expect(decl.reason).toBe(`coverage evidence from a run scoped to ${entry.test_file_abs}`);
              }
              expect(evaluateTests(CT_COV_001, out)[i].finding?.result).toBe(golden.decl);
            }
          });
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// phase9 2.3 — synthetic-report CLI cases. The corpus block above needs
// machine-local validation/ artifacts; these build their own report in a tmp
// dir, so they run on any checkout (same seam as tests/cli-coverage.test.ts:
// main() called directly with stdout captured).
// ---------------------------------------------------------------------------
const SYNTH_TMP = join(process.env.TMPDIR || '/tmp', 'checktest-ptr-synthetic');
const SYNTH_SUBJECT = join(__dirname, '..', 'fixtures', 'ct-int-001', 'case-01-standard-assertion', 'sample.test.ts');
const SYNTH_SUBJECT_ABS = join(process.cwd(), 'tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts');

function synthReport(name: string, body: string): string {
  mkdirSync(SYNTH_TMP, { recursive: true });
  const p = join(SYNTH_TMP, name);
  writeFileSync(p, body, 'utf8');
  return p;
}

describe('CT-COV-001 unit D — synthetic-report CLI cases (phase9 2.3)', () => {
  let stdout = '';
  let stderr = '';
  let outSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    stdout = '';
    stderr = '';
    outSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      return true;
    });
    errSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      return true;
    });
  });

  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
  });

  function runCli(report: string): { code: number; json: Record<string, any> } {
    const code = main([
      '--test',
      SYNTH_SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-COV-001',
      '--coverage-report',
      report,
      '--source-revision',
      'rev-synth',
    ]);
    return { code, json: JSON.parse(stdout.trim()) as Record<string, any> };
  }

  it('mapped target absent from a synthetic report: UNKNOWN/UNAVAILABLE on the record, INDETERMINATE at both levels', () => {
    const p = synthReport('synth-missing.json', JSON.stringify({ covered: { 'unrelated.ts': [1, 1] } }));
    const { code, json } = runCli(p);
    // INDETERMINATE is a verdict, not a failure: exit 0, no stderr.
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(json.summary.fail).toBe(0);

    const subj = json.evidence.line_coverage;
    expect(subj.availability).toBe('UNKNOWN');
    expect(subj.coverage.status).toBe('UNAVAILABLE');
    expect(subj.value).toBeNull();
    expect(subj.reason).toBe(
      `no coverage data for ${SYNTH_SUBJECT_ABS} (no --coverage-map <from>=<to> entry maps this test file to a production file with coverage)`,
    );

    expect(json.ruleResults).toHaveLength(1);
    expect(json.ruleResults[0].result).toBe('INDETERMINATE');
    expect(json.testResults[0].ruleResults[0].result).toBe('INDETERMINATE');
  });

  it('one --coverage-map value carries ONE mapping (split at the first `=`); a two-pair value degrades to unmapped UNKNOWN', () => {
    const p = synthReport(
      'synth-collision.json',
      JSON.stringify({ covered: { 'src/collide.ts': [0, 0], 'vendor/collide.ts': [1, 1], 'keep.ts': [1] } }),
    );
    // CLI limitation, characterized not fixed: '--coverage-map a=b,c=d' is ONE
    // string, and toCoverageMappings splits it at the FIRST '=' (coverage.ts:88-92),
    // so the second pair never becomes a mapping and the subject stays unmapped.
    // The two-entry collision itself is characterized at the provider seam below.
    const code = main([
      '--test',
      SYNTH_SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-COV-001',
      '--coverage-report',
      p,
      '--source-revision',
      'rev-synth',
      '--coverage-map',
      `other.ts=src/collide.ts,${SYNTH_SUBJECT_ABS}=src/collide.ts`,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const json = JSON.parse(stdout.trim()) as Record<string, any>;
    const subj = json.evidence.line_coverage;
    expect(subj.availability).toBe('UNKNOWN');
    expect(subj.coverage.status).toBe('UNAVAILABLE');
    expect(subj.value).toBeNull();
    expect(subj.reason).toBe(
      `no coverage data for ${SYNTH_SUBJECT_ABS} (no --coverage-map <from>=<to> entry maps this test file to a production file with coverage)`,
    );
    expect(json.ruleResults[0].result).toBe('INDETERMINATE');
  });

  // Provider-seam characterization (applyCoverageReport directly): two distinct
  // `from` entries naming the SAME `to` that EXISTS in the report resolve
  // silently, whichever entry matched the subject. No src/ change — documented.
  function mappedPair(mappings: Array<{ from: string; to: string }>, subject: string, report: string) {
    const out = applyCoverageReport(analysisWith(subject, [1, 2]), report, { coverageMap: mappings });
    const subj = out.evidence.line_coverage;
    return { subj, verdict: evaluateRule(CT_COV_001, out).finding?.result };
  }

  it('mapped collision, both entry orders: exact-key pick, same reason, no ambiguity, no misattribution', () => {
    const p = synthReport(
      'synth-collision2.json',
      JSON.stringify({ covered: { 'src/collide.ts': [0, 0], 'vendor/collide.ts': [1, 1], 'keep.ts': [1] } }),
    );
    const forward = mappedPair(
      [
        { from: 'other.ts', to: 'src/collide.ts' },
        { from: SYNTH_SUBJECT_ABS, to: 'src/collide.ts' },
      ],
      SYNTH_SUBJECT_ABS,
      p,
    );
    expect(forward.subj.availability).toBe(Availability.KNOWN);
    expect(forward.subj.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(forward.subj.value).toBe(0); // count of 1s in [0, 0] — the exact key, not vendor/collide.ts
    expect(forward.subj.reason).toBe(`coverage mapped from ${SYNTH_SUBJECT_ABS} to src/collide.ts per user mapping`);
    expect(forward.verdict).toBe(RuleResult.FAIL);

    const reversed = mappedPair(
      [
        { from: SYNTH_SUBJECT_ABS, to: 'src/collide.ts' },
        { from: 'other.ts', to: 'src/collide.ts' },
      ],
      SYNTH_SUBJECT_ABS,
      p,
    );
    expect(reversed.subj.value).toBe(0);
    expect(reversed.subj.reason).toBe(forward.subj.reason);

    // A `to` matching NO report key stays UNKNOWN even though two records share
    // its basename: the mapped branch has no basename fallback (coverage.ts:520-543).
    const noKey = mappedPair(
      [
        { from: 'other.ts', to: 'collide.ts' },
        { from: SYNTH_SUBJECT_ABS, to: 'collide.ts' },
      ],
      SYNTH_SUBJECT_ABS,
      p,
    );
    expect(noKey.subj.availability).toBe(Availability.UNKNOWN);
    expect(noKey.subj.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(noKey.subj.reason).toBe(
      `coverage mapped from ${SYNTH_SUBJECT_ABS} to collide.ts per user mapping (no coverage data for collide.ts)`,
    );
    expect(noKey.verdict).toBe(RuleResult.INDETERMINATE);
  });
});
