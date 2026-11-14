import { join, resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

import { parseCoverageReport, applyCoverageReport } from '../../src/providers/coverage';
import { Availability, CollectionStatus, EVIDENCE_SCOPE_TEST_BODY, Provenance } from '../../src/core/evidence';
import { evaluateRule, evaluateTests } from '../../src/core/evaluation';
import { toJson } from '../../src/reporters/json';
import { CT_COV_001 } from '../../src/rules/ct-cov-001';
import { RuleResult } from '../../src/core/result';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../src/core/analysis';

const TMP = join(process.env.TMPDIR || '/tmp', 'checktest-coverage-fixtures');

function tmpFile(name: string, content: string): string {
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

describe('coverage provider', () => {
  it('parses a normal Istanbul report', () => {
    const p = tmpFile('normal.json', JSON.stringify({ covered: { 'a.ts': [null, 1, 0 === 0 ? 1 : 0] } }));
    // ensure a 0 (uncovered) entry
    const p2 = tmpFile('normal2.json', JSON.stringify({ covered: { 'a.ts': [null, 1, 0] } }));
    const r = parseCoverageReport(p2);
    expect(r.provider).toBe('istanbul');
    expect(r.records.size).toBe(1);
    const rec = r.records.get('a.ts')!;
    expect(rec.type).toBe('line_coverage');
    expect(rec.provenance).toBe(Provenance.EXTERNAL);
    expect(rec.availability).toBe(Availability.KNOWN);
    expect(rec.provider).toBe(r.provider);
  });

  it('missing file does not crash', () => {
    const r = parseCoverageReport(join(TMP, 'nope.json'));
    expect(r.records.size).toBe(0);
    expect(r.reason).toContain('unable to read');
  });

  it('malformed JSON does not crash', () => {
    const p = tmpFile('bad.json', '{not json');
    const r = parseCoverageReport(p);
    expect(r.records.size).toBe(0);
    expect(r.reason).toContain('malformed');
  });

  it('revision mismatch yields UNKNOWN', () => {
    const p = tmpFile('mm.json', JSON.stringify({ covered: { 'a.ts': [1, 1] } }));
    const r = parseCoverageReport(p, { source_revision: 'rev1', analyzedRevision: 'rev2' });
    const rec = r.records.get('a.ts')!;
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.reason).toContain('mismatch');
    expect(r.mismatch).toBe(true);
  });

  it('partial coverage (null entries) is PARTIAL collection status', () => {
    const p = tmpFile('partial.json', JSON.stringify({ covered: { 'a.ts': [null, 1] } }));
    const r = parseCoverageReport(p);
    const rec = r.records.get('a.ts')!;
    expect(rec.coverage.status).toBe('PARTIAL');
  });

  it('unsupported format yields reason', () => {
    const p = tmpFile('unsup.json', JSON.stringify({ foo: 1 }));
    const r = parseCoverageReport(p);
    expect(r.reason).toContain('unsupported');
  });
});

// WP4.1 task 56b coverage-gap tests below: exercise the private helpers
// (parseC8, isLineCovered, findFileRecord, perDeclarationRecord) through the
// two public entry points — tests MUST NOT modify src/.

function analysisWith(file: string, declLines: number[] = []): AnalysisOutput {
  return {
    subject: {
      id: `${file}#file`,
      name: file,
      file,
      language: 'typescript',
      framework: 'jest',
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

describe('parseC8 via parseCoverageReport', () => {
  it('valid c8-format report with coveredLines and covered arrays', () => {
    const p = tmpFile(
      'c8-valid.json',
      JSON.stringify({
        files: {
          'a.ts': { coveredLines: [1, 3, 5] },
          'b.ts': { covered: [2, 4] },
          'c.ts': 'not-an-object',
          'd.ts': { coveredLines: 'nope', covered: 'nope' },
          'e.ts': {},
        },
      }),
    );
    const r = parseCoverageReport(p, { provider_version: '9.9.9', source_revision: 'rev-c8' });
    expect(r.provider).toBe('c8');
    expect(r.provider_version).toBe('9.9.9');
    expect(r.source_revision).toBe('rev-c8');
    expect(r.records.size).toBe(5);
    expect(r.records.get('a.ts')!.value).toEqual([1, 3, 5]);
    expect(r.records.get('b.ts')!.value).toEqual([2, 4]);
    expect(r.records.get('c.ts')!.value).toEqual([]);
    expect(r.records.get('d.ts')!.value).toEqual([]);
    expect(r.records.get('e.ts')!.value).toEqual([]);
    expect(r.records.get('a.ts')!.provider).toBe('c8');
    expect(r.records.get('a.ts')!.coverage.status).toBe(CollectionStatus.COMPLETE);
  });

  it('malformed c8 entries degrade, missing files entry yields no-entries reason', () => {
    const ok = tmpFile('c8-nofiles.json', JSON.stringify({ files: {} }));
    const r1 = parseCoverageReport(ok);
    expect(r1.records.size).toBe(0);
    expect(r1.reason).toContain('no file entries');
    expect(r1.provider).toBe('c8');

    const bad = tmpFile('c8-malformed.json', JSON.stringify({ files: { 'a.ts': 42, 'b.ts': null } }));
    const r2 = parseCoverageReport(bad);
    expect(r2.records.size).toBe(2);
    expect(r2.records.get('a.ts')!.value).toEqual([]);
    expect(r2.records.get('b.ts')!.value).toEqual([]);
  });

  it('c8 revision mismatch marks every record UNAVAILABLE with reason', () => {
    const p = tmpFile('c8-mismatch.json', JSON.stringify({ files: { 'a.ts': { coveredLines: [1] } } }));
    const r = parseCoverageReport(p, { source_revision: 'rev1', analyzedRevision: 'rev2' });
    expect(r.mismatch).toBe(true);
    const rec = r.records.get('a.ts')!;
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(rec.value).toBeUndefined();
    expect(rec.reason).toContain('mismatch');
  });

  it('provider override replaces c8 default', () => {
    const p = tmpFile('c8-provider.json', JSON.stringify({ files: { 'a.ts': { coveredLines: [1] } } }));
    const r = parseCoverageReport(p, { provider: 'custom-c8' });
    expect(r.provider).toBe('custom-c8');
    expect(r.records.get('a.ts')!.provider).toBe('custom-c8');
  });
});

describe('isLineCovered via applyCoverageReport', () => {
  const DECL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99];

  it('Istanbul null-entried hit-map: 1 at decl line, 0 elsewhere', () => {
    const p = tmpFile('islc-istanbul.json', JSON.stringify({ covered: { 's.test.ts': [null, 1, 0, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', DECL), p);
    const byLine = (l: number) => out.tests!.find((t) => t.test.line === l)!.evidence.line_coverage.value;
    expect(byLine(2)).toBe(1); // lines[1] === 1
    expect(byLine(3)).toBe(0); // lines[2] === 0
    expect(byLine(4)).toBe(1); // lines[3] === 1
    expect(byLine(1)).toBe(0); // lines[0] === null
    expect(byLine(99)).toBe(0); // out of range
    expect(byLine(10)).toBe(0); // out of range
  });

  it('dense 0/1 array without nulls uses index lookup, 0 for out-of-range', () => {
    const p = tmpFile('islc-dense.json', JSON.stringify({ covered: { 's.test.ts': [1, 0, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1, 2, 3, 4, 0]), p);
    const byLine = (l: number) => out.tests!.find((t) => t.test.line === l)!.evidence.line_coverage.value;
    expect(byLine(1)).toBe(1);
    expect(byLine(2)).toBe(0);
    expect(byLine(3)).toBe(1);
    expect(byLine(4)).toBe(0); // beyond end
    expect(byLine(0)).toBe(0); // idx -1
  });

  it('sparse max>1 numeric array (c8 coveredLines) uses includes()', () => {
    const p = tmpFile('islc-sparse.json', JSON.stringify({ files: { 's.test.ts': { coveredLines: [1, 3, 7] } } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [2, 7, 99]), p);
    const byLine = (l: number) => out.tests!.find((t) => t.test.line === l)!.evidence.line_coverage.value;
    expect(byLine(7)).toBe(1); // coveredLines includes 7
    expect(byLine(2)).toBe(0); // not listed
    expect(byLine(99)).toBe(0); // not listed, out of range
  });

  it('array with non-numeric non-null entries yields not covered', () => {
    const p = tmpFile('islc-mixed.json', JSON.stringify({ covered: { 's.test.ts': ['a', 'b'] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1, 2]), p);
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    // isLineCovered: no nulls, not all numbers → false → 0
    expect(out.tests![0].evidence.line_coverage.value).toBe(0);
  });
});

describe('findFileRecord via applyCoverageReport (fail-closed join)', () => {
  it('exact-key match', () => {
    const p = tmpFile('ffr-exact.json', JSON.stringify({ covered: { 's.test.ts': [1, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p);
    expect(out.evidence.line_coverage.value).toEqual([1, 1]);
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    expect(out.tests![0].evidence.line_coverage.value).toBe(1); // per-decl: decl line 1 is covered
  });

  it('exact match: absolute report key vs relative subject path matches after normalize', () => {
    const absKey = resolve('s.test.ts'); // cwd-absolute, identical to normalizePath('s.test.ts')
    const p = tmpFile('ffr-abskey.json', JSON.stringify({ covered: { [absKey]: [1, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p);
    expect(out.evidence.line_coverage.value).toEqual([1, 1]);
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    expect(out.tests![0].evidence.line_coverage.value).toBe(1); // per-decl: decl line 1 is covered
  });

  it('duplicate basenames from different directories: exact match only, basename-only misses', () => {
    const p = tmpFile(
      'ffr-dup.json',
      JSON.stringify({ covered: { '/one/s.test.ts': [1, 1], '/two/s.test.ts': [0, 0] } }),
    );
    const exact = applyCoverageReport(analysisWith('/one/s.test.ts', [1]), p);
    expect(exact.evidence.line_coverage.value).toEqual([1, 1]);
    expect(exact.evidence.line_coverage.availability).toBe(Availability.KNOWN);

    const byBasename = applyCoverageReport(analysisWith('s.test.ts', [1]), p);
    expect(byBasename.evidence.line_coverage.value).toBeUndefined();
    expect(byBasename.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(byBasename.evidence.line_coverage.reason).toContain('no coverage data for s.test.ts');
    expect(byBasename.evidence.line_coverage.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    const decl = byBasename.tests![0].evidence.line_coverage;
    expect(decl.availability).toBe(Availability.UNKNOWN);
    expect(decl.value).toBeUndefined();
    expect(decl.reason).toContain('no coverage data');
    expect(decl.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
  });

  it('no basename fallback: absolute report key vs relative subject -> UNKNOWN + reason', () => {
    const p = tmpFile('ffr-base.json', JSON.stringify({ covered: { '/abs/dir/s.test.ts': [0, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [2]), p);
    expect(out.evidence.line_coverage.value).toBeUndefined();
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.reason).toContain('no coverage data for s.test.ts');
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    const decl = out.tests![0].evidence.line_coverage;
    expect(decl.availability).toBe(Availability.UNKNOWN);
    expect(decl.value).toBeUndefined();
    expect(decl.reason).toContain('no coverage data');
    expect(decl.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
  });

  it('sole unrelated report entry -> fail-closed UNKNOWN, no match', () => {
    const p = tmpFile('ffr-single.json', JSON.stringify({ covered: { 'only.ts': [0, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [2]), p);
    expect(out.evidence.line_coverage.value).toBeUndefined();
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.reason).toContain('no coverage data for s.test.ts');
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    const decl = out.tests![0].evidence.line_coverage;
    expect(decl.availability).toBe(Availability.UNKNOWN);
    expect(decl.value).toBeUndefined();
    expect(decl.reason).toContain('no coverage data');
    expect(decl.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
  });

  it('no match with multiple records → UNKNOWN record with reason, per-decl UNKNOWN', () => {
    const p = tmpFile('ffr-miss.json', JSON.stringify({ covered: { 'x.ts': [1], 'y.ts': [1, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p);
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.reason).toContain('no coverage data for s.test.ts');
    const decl = out.tests![0].evidence.line_coverage;
    expect(decl.availability).toBe(Availability.UNKNOWN);
    expect(decl.value).toBeUndefined();
    expect(decl.reason).toContain('no coverage data');
  });
});

describe('perDeclarationRecord via applyCoverageReport', () => {
  it('coverage KNOWN → 1/0 value with EXTERNAL provenance and provider fields', () => {
    const p = tmpFile('pdr-known.json', JSON.stringify({ files: { 's.test.ts': { coveredLines: [1, 4] } } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1, 3]), p, {
      provider_version: '2.5.0',
      source_revision: 'rev-pdr',
    });
    const covered = out.tests!.find((t) => t.test.line === 1)!.evidence.line_coverage;
    expect(covered.value).toBe(1);
    expect(covered.provenance).toBe(Provenance.EXTERNAL);
    expect(covered.provider).toBe('c8');
    expect(covered.provider_version).toBe('2.5.0');
    expect(covered.source_revision).toBe('rev-pdr');
    expect(covered.collector_version).toBe('2.5.0');
    expect(covered.scope).toBe('test-body');
    expect(covered.coverage.status).toBe(CollectionStatus.COMPLETE);
    const uncovered = out.tests!.find((t) => t.test.line === 3)!.evidence.line_coverage;
    expect(uncovered.value).toBe(0);
    expect(uncovered.availability).toBe(Availability.KNOWN);
  });

  it('coverage UNKNOWN → value undefined, status UNAVAILABLE, reason propagated', () => {
    const p = tmpFile('pdr-unknown.json', JSON.stringify({ covered: { 's.test.ts': [1, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p, {
      source_revision: 'revA',
      analyzedRevision: 'revB',
    });
    const decl = out.tests![0].evidence.line_coverage;
    expect(decl.availability).toBe(Availability.UNKNOWN);
    expect(decl.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(decl.value).toBeUndefined();
    expect(decl.reason).toContain('mismatch');
    expect(decl.provenance).toBe(Provenance.EXTERNAL);
  });
});

describe('revision freshness (parse + apply)', () => {
  it('unknown revision + analyzed supplied -> UNAVAILABLE, reason "report revision unknown; freshness cannot be established"', () => {
    const p = tmpFile('rev-unknown.json', JSON.stringify({ covered: { 'a.ts': [1, 1] } }));
    const r = parseCoverageReport(p, { analyzedRevision: 'rev1' });
    const rec = r.records.get('a.ts')!;
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(rec.value).toBeUndefined();
    expect(rec.reason).toBe('report revision unknown; freshness cannot be established');
    expect(r.mismatch).toBe(true);
  });

  it('c8 unknown revision + analyzed supplied -> UNAVAILABLE + same reason', () => {
    const p = tmpFile('rev-unknown-c8.json', JSON.stringify({ files: { 'a.ts': { coveredLines: [1] } } }));
    const r = parseCoverageReport(p, { analyzedRevision: 'rev1' });
    const rec = r.records.get('a.ts')!;
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(rec.value).toBeUndefined();
    expect(rec.reason).toBe('report revision unknown; freshness cannot be established');
    expect(r.mismatch).toBe(true);
  });

  it('stale revision: report != analyzed -> UNAVAILABLE + mismatch reason', () => {
    const p = tmpFile('rev-stale.json', JSON.stringify({ covered: { 'a.ts': [1, 1] } }));
    const r = parseCoverageReport(p, { source_revision: 'rev1', analyzedRevision: 'rev2' });
    const rec = r.records.get('a.ts')!;
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(rec.value).toBeUndefined();
    expect(rec.reason).toContain('mismatch');
    expect(rec.reason).toContain('rev1');
    expect(rec.reason).toContain('rev2');
    expect(r.mismatch).toBe(true);
  });

  it('matching revision -> KNOWN, COMPLETE, value kept', () => {
    const p = tmpFile('rev-match.json', JSON.stringify({ covered: { 'a.ts': [1, 1] } }));
    const r = parseCoverageReport(p, { source_revision: 'rev1', analyzed_revision: 'rev1' });
    expect(r.mismatch).toBeUndefined();
    const rec = r.records.get('a.ts')!;
    expect(rec.availability).toBe(Availability.KNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(rec.value).toEqual([1, 1]);
  });

  it('revision unknown with NO analyzed input -> KNOWN (no freshness claim)', () => {
    const p = tmpFile('rev-none.json', JSON.stringify({ covered: { 'a.ts': [1, 1] } }));
    const r = parseCoverageReport(p);
    const rec = r.records.get('a.ts')!;
    expect(rec.availability).toBe(Availability.KNOWN);
    expect(rec.source_revision).toBe('unknown');
    expect(rec.reason).toBeUndefined();
  });

  it('apply: unknown revision + analyzed -> subject + per-decl UNAVAILABLE with reason', () => {
    const p = tmpFile('apply-rev-unknown.json', JSON.stringify({ covered: { 's.test.ts': [1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p, { analyzedRevision: 'rev1' });
    const subj = out.evidence.line_coverage;
    expect(subj.availability).toBe(Availability.UNKNOWN);
    expect(subj.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(subj.value).toBeUndefined();
    expect(subj.reason).toBe('report revision unknown; freshness cannot be established');
    const decl = out.tests![0].evidence.line_coverage;
    expect(decl.availability).toBe(Availability.UNKNOWN);
    expect(decl.value).toBeUndefined();
    expect(decl.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(decl.reason).toContain('report revision unknown');
  });

  it('apply: stale revision via analyzedRevision from git HEAD shape -> UNAVAILABLE + mismatch', () => {
    const p = tmpFile('apply-rev-stale.json', JSON.stringify({ covered: { 's.test.ts': [1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p, {
      source_revision: 'rev-old',
      analyzedRevision: 'rev-new',
    });
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(out.evidence.line_coverage.reason).toContain('mismatch');
  });

  it('null entries still yield PARTIAL when no revision input suppresses them', () => {
    const p = tmpFile('rev-partial.json', JSON.stringify({ covered: { 's.test.ts': [null, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p);
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
  });
});

describe('parseCoverageReport end-to-end', () => {
  it('Istanbul: provider_version/source_revision propagate with camelCase aliases', () => {
    const p = tmpFile('e2e-ist.json', JSON.stringify({ covered: { '/x/a.ts': [1, 0] } }));
    const r = parseCoverageReport(p, { providerVersion: '7.7.7', sourceRevision: 'rev-e2e' });
    expect(r.provider).toBe('istanbul');
    expect(r.provider_version).toBe('7.7.7');
    expect(r.source_revision).toBe('rev-e2e');
    const rec = r.records.get('/x/a.ts')!;
    expect(rec.provider_version).toBe('7.7.7');
    expect(rec.source_revision).toBe('rev-e2e');
    expect(rec.collector_version).toBe('7.7.7');
    expect(rec.availability).toBe(Availability.KNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.COMPLETE);
  });

  it('Istanbul empty covered map → no-entries reason, defaults version 1.0.0/unknown', () => {
    const p = tmpFile('e2e-empty.json', JSON.stringify({ covered: {} }));
    const r = parseCoverageReport(p);
    expect(r.provider).toBe('istanbul');
    expect(r.provider_version).toBe('1.0.0');
    expect(r.source_revision).toBe('unknown');
    expect(r.records.size).toBe(0);
    expect(r.reason).toContain('no file entries');
    expect(r.mismatch).toBeUndefined();
  });

  it('Istanbul non-array entry is skipped, arrays kept', () => {
    const p = tmpFile('e2e-nonarray.json', JSON.stringify({ covered: { 'bad.ts': 'nope', 'ok.ts': [1] } }));
    const r = parseCoverageReport(p);
    expect(r.records.size).toBe(1);
    expect(r.records.has('ok.ts')).toBe(true);
    expect(r.records.has('bad.ts')).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it('c8 end-to-end: provider c8, version and revision reach every record', () => {
    const p = tmpFile('e2e-c8.json', JSON.stringify({ files: { '/b.ts': { coveredLines: [2] } } }));
    const r = parseCoverageReport(p, { provider_version: '3.0.0', source_revision: 'rev-9' });
    expect(r.provider).toBe('c8');
    expect(r.provider_version).toBe('3.0.0');
    expect(r.source_revision).toBe('rev-9');
    const rec = r.records.get('/b.ts')!;
    expect(rec.provider).toBe('c8');
    expect(rec.provider_version).toBe('3.0.0');
    expect(rec.source_revision).toBe('rev-9');
    expect(rec.availability).toBe(Availability.KNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.COMPLETE);
  });

  it('c8 matching analysed revision stays KNOWN (no mismatch flag)', () => {
    const p = tmpFile('e2e-c8-match.json', JSON.stringify({ files: { 'a.ts': { coveredLines: [1] } } }));
    const r = parseCoverageReport(p, { source_revision: 'rev1', analyzed_revision: 'rev1' });
    expect(r.mismatch).toBeUndefined();
    expect(r.records.get('a.ts')!.availability).toBe(Availability.KNOWN);
  });

  it('unsupported format with revision mismatch still reports mismatch', () => {
    const p = tmpFile('e2e-unsup-mm.json', JSON.stringify({ note: 'not a report', covered: 'not-an-object' }));
    const r = parseCoverageReport(p, { source_revision: 'r1', analyzed_revision: 'r2' });
    expect(r.reason).toContain('unsupported');
    expect(r.mismatch).toBe(true);
    expect(r.records.size).toBe(0);
  });
});

describe('coverage-map (SP2.2)', () => {
  it('mapped subject resolves to report record for `to`', () => {
    const p = tmpFile('cm-map.json', JSON.stringify({ covered: { 'to.ts': [1, 1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1]), p, { coverageMap: { 'from.ts': 'to.ts' } });
    expect(out.evidence.line_coverage.value).toBe(2);
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    expect(out.evidence.line_coverage.reason).toContain('coverage mapped from from.ts to to.ts per user mapping');
  });

  it('mapped subject per-declaration records carry the mapping reason', () => {
    const p = tmpFile('cm-map2.json', JSON.stringify({ files: { 'to.ts': { coveredLines: [2] } } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, { coverageMap: ['from.ts=to.ts'] });
    expect(out.tests![1].evidence.line_coverage.value).toBeUndefined();
    expect(out.tests![1].evidence.line_coverage.reason).toContain(
      'coverage mapped from from.ts to to.ts per user mapping',
    );
    expect(out.tests![1].evidence.line_coverage.reason).toContain(
      'per-declaration attribution not supported for mapped coverage',
    );
  });

  it('unmapped subject still INDETERMINATE', () => {
    const p = tmpFile('cm-unmap.json', JSON.stringify({ covered: { 'to.ts': [1, 1] } }));
    const out = applyCoverageReport(analysisWith('other.ts', [1]), p, { coverageMap: { 'from.ts': 'to.ts' } });
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.reason).toContain('no coverage data for other.ts');
  });

  it('mapped target missing yields UNKNOWN', () => {
    const p = tmpFile('cm-miss.json', JSON.stringify({ covered: { 'x.ts': [1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1]), p, { coverageMap: { 'from.ts': 'nope.ts' } });
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.reason).toContain('coverage mapped from from.ts to nope.ts per user mapping');
  });

  it('positional coverageMap argument works', () => {
    const p = tmpFile('cm-pos.json', JSON.stringify({ covered: { 'to.ts': [0, 1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1]), p, undefined, new Map([['from.ts', 'to.ts']]));
    expect(out.evidence.line_coverage.value).toBe(1);
  });

  it('normalize matches absolute/relative from', () => {
    const { resolve } = require('path');
    const absFrom = resolve('from.ts');
    const p = tmpFile('cm-norm.json', JSON.stringify({ covered: { 'to.ts': [1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1]), p, { coverageMap: { [absFrom]: 'to.ts' } });
    expect(out.evidence.line_coverage.value).toBe(1);
  });

  it('coverageMaps array of objects/arrays/strings', () => {
    const p = tmpFile('cm-shapes.json', JSON.stringify({ covered: { 'to.ts': [1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1]), p, {
      coverageMaps: [{ from: 'from.ts', to: 'to.ts' }, ['from.ts', 'to.ts'], 'from.ts=to.ts'],
    });
    expect(out.evidence.line_coverage.value).toBe(1);
  });

  it('coverage_map string and mappings from-to object', () => {
    const p = tmpFile('cm-str.json', JSON.stringify({ covered: { 'to.ts': [1] } }));
    const out1 = applyCoverageReport(analysisWith('from.ts', [1]), p, { coverage_map: 'from.ts=to.ts' });
    expect(out1.evidence.line_coverage.value).toBe(1);
    const out2 = applyCoverageReport(analysisWith('from.ts', [1]), p, { mappings: { from: 'from.ts', to: 'to.ts' } });
    expect(out2.evidence.line_coverage.value).toBe(1);
  });

  it('mapping single object and positional string', () => {
    const p = tmpFile('cm-single.json', JSON.stringify({ covered: { 'to.ts': [1] } }));
    const out1 = applyCoverageReport(analysisWith('from.ts', [1]), p, { mapping: { from: 'from.ts', to: 'to.ts' } });
    expect(out1.evidence.line_coverage.value).toBe(1);
    const out2 = applyCoverageReport(analysisWith('from.ts', [1]), p, undefined, 'from.ts=to.ts');
    expect(out2.evidence.line_coverage.value).toBe(1);
  });

  it('null/undefined input yields no mapping', () => {
    const p = tmpFile('cm-null.json', JSON.stringify({ covered: { 'to.ts': [1] } }));
    const out = applyCoverageReport(analysisWith('other.ts', [1]), p, { coverageMap: null as any });
    expect(out.evidence.line_coverage.reason).toContain('no coverage data for other.ts');
  });
});

describe('evidence provenance/completeness (WP2.3 regression)', () => {
  // (a) Provenance.EXTERNAL on the apply-side failure paths — unknownRecord (coverage.ts:281)
  // and perDeclarationRecord (coverage.ts:331): even a missing-file join yields an EXTERNAL
  // record, never a fabricated value and never an untyped record.
  it('apply: no matching report entry → subject + per-declaration records are EXTERNAL with a reason', () => {
    const p = tmpFile('prov-apply-miss.json', JSON.stringify({ covered: { 'other.ts': [1, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p);
    const subj = out.evidence.line_coverage;
    expect(subj.provenance).toBe(Provenance.EXTERNAL);
    expect(subj.availability).toBe(Availability.UNKNOWN);
    expect(subj.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(subj.reason).toContain('no coverage data for s.test.ts');
    const decl = out.tests![0].evidence.line_coverage;
    expect(decl.provenance).toBe(Provenance.EXTERNAL);
    expect(decl.availability).toBe(Availability.UNKNOWN);
    expect(decl.value).toBeUndefined();
    expect(decl.reason).toContain('no coverage data');
  });

  // (a) c8 revision mismatch marks every record EXTERNAL (parseC8, coverage.ts:146).
  it('parse: c8 revision mismatch → every record is EXTERNAL, UNAVAILABLE and valueless', () => {
    const p = tmpFile('prov-c8-mm.json', JSON.stringify({ files: { 'a.ts': { coveredLines: [1] } } }));
    const r = parseCoverageReport(p, { source_revision: 'rev1', analyzedRevision: 'rev2' });
    expect(r.mismatch).toBe(true);
    for (const rec of r.records.values()) {
      expect(rec.provenance).toBe(Provenance.EXTERNAL);
      expect(rec.availability).toBe(Availability.UNKNOWN);
      expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
      expect(rec.value).toBeUndefined();
      expect(rec.reason).toContain('mismatch');
    }
  });

  // (b) File-level vs per-declaration: both levels share scope 'test-body', so scope alone
  // never masquerades the file-level aggregate as per-declaration status — attribution is
  // structural (evidence map location). The file-level record holds the raw array; per-declaration
  // records hold 0/1.
  it('apply: file-level aggregate and per-declaration records share scope test-body; values stay distinct', () => {
    const p = tmpFile('prov-scope.json', JSON.stringify({ files: { 's.test.ts': { coveredLines: [1, 3] } } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1, 3]), p);
    const subj = out.evidence.line_coverage;
    expect(subj.value).toEqual([1, 3]);
    expect(subj.scope).toBe(EVIDENCE_SCOPE_TEST_BODY);
    expect(subj.provenance).toBe(Provenance.EXTERNAL);
    const tests = out.tests!;
    expect(tests).toHaveLength(2);
    for (const t of tests) {
      const decl = t.evidence.line_coverage;
      expect(decl.scope).toBe(EVIDENCE_SCOPE_TEST_BODY);
      expect(decl.provenance).toBe(Provenance.EXTERNAL);
      expect(decl.value).toBe(1);
    }
    expect(tests[0]!.evidence.line_coverage.scope).toBe(subj.scope);
  });

  // (d) Three distinguishable reasons: missing file on disk / empty-but-supplied report /
  // subject file absent from a populated report.
  it('missing file vs empty report vs absent subject: three distinguishable reasons', () => {
    const missing = parseCoverageReport(join(TMP, 'does-not-exist.json'));
    expect(missing.records.size).toBe(0);
    expect(missing.reason).toContain('unable to read');

    const empty = tmpFile('prov-empty.json', JSON.stringify({ covered: {} }));
    const emptyR = parseCoverageReport(empty);
    expect(emptyR.records.size).toBe(0);
    expect(emptyR.reason).toContain('no file entries');

    const populated = tmpFile('prov-pop.json', JSON.stringify({ covered: { 'other.ts': [1, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), populated);
    const reason = out.evidence.line_coverage.reason ?? '';
    expect(reason).toContain('no coverage data for s.test.ts');
    expect(reason).not.toContain('no file entries');
    expect(reason).not.toContain('unable to read');
  });

  // Provider PARTIAL: null entries yield PARTIAL status + KNOWN availability with real values.
  // The provider never fabricates a zero; whether PARTIAL evidence buys a verdict is the
  // engine's decision — and it is never FAIL (see core/evaluation tests).
  it('provider: null entries yield PARTIAL + KNOWN with real values, never a fabricated zero', () => {
    const p = tmpFile('prov-partial.json', JSON.stringify({ covered: { 's.test.ts': [null, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p);
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.PARTIAL);
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    expect(out.evidence.line_coverage.value).toEqual([null, 1]);
    expect(out.tests![0].evidence.line_coverage.value).toBe(0); // null entry → not covered
  });
});

describe('SP2.2-fix mapped file-level verdicts (TDD)', () => {
  function activeRule() {
    return { ...CT_COV_001, status: 'active' as any };
  }

  it('mapped all-uncovered file -> subject-level FAIL under active status', () => {
    const p = tmpFile('sp2fix-fail.json', JSON.stringify({ covered: { 'to.ts': [0, 0, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1]), p, { coverageMap: { 'from.ts': 'to.ts' } });
    const { finding } = evaluateRule(activeRule(), out);
    expect(finding?.result).toBe(RuleResult.FAIL);
    expect(out.evidence.line_coverage.value).toBe(0);
    expect(out.evidence.line_coverage.reason).toContain('coverage mapped from from.ts to to.ts per user mapping');
  });

  it('mapped file with >=1 covered line -> subject-level PASS under active status', () => {
    const p = tmpFile('sp2fix-pass.json', JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1]), p, { coverageMap: { 'from.ts': 'to.ts' } });
    const { finding } = evaluateRule(activeRule(), out);
    expect(finding?.result).toBe(RuleResult.PASS);
    expect(out.evidence.line_coverage.value).toBe(1);
  });

  it('mapped file completeness PARTIAL -> subject-level INDETERMINATE under active status', () => {
    const p = tmpFile('sp2fix-partial.json', JSON.stringify({ covered: { 'to.ts': [null, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1]), p, { coverageMap: { 'from.ts': 'to.ts' } });
    const { finding } = evaluateRule(activeRule(), out);
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.PARTIAL);
  });

  it('unmapped subject unchanged (INDETERMINATE) under active status', () => {
    const p = tmpFile('sp2fix-unmap.json', JSON.stringify({ covered: { 'to.ts': [1, 1] } }));
    const out = applyCoverageReport(analysisWith('other.ts', [1]), p, { coverageMap: { 'from.ts': 'to.ts' } });
    const { finding } = evaluateRule(activeRule(), out);
    expect(finding?.result).toBe(RuleResult.INDETERMINATE);
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
  });

  it('mapped per-declaration records are advisory INDETERMINATE', () => {
    const p = tmpFile('sp2fix-perdecl.json', JSON.stringify({ covered: { 'to.ts': [0, 1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, { coverageMap: { 'from.ts': 'to.ts' } });
    for (const t of out.tests!) {
      expect(t.evidence.line_coverage.reason).toContain(
        'per-declaration attribution not supported for mapped coverage',
      );
    }
  });
});

// CT-COV-001 per-test-run marker (plan tasks 2 + 4, TDD unit A). The marker is an
// additive flag on the subject-level fileRecord only: the rule reads it in a
// later unit, so nothing here moves a verdict.
describe('per_test_run marker (CT-COV-001 unit A)', () => {
  it('marked run: mapped subject record gains per_test_run: true', () => {
    const p = tmpFile('ptr-marked.json', JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: true,
    });
    const subj = out.evidence.line_coverage;
    expect(subj.per_test_run).toBe(true);
    // Nothing else moves: same value and same mapping reason as the unmarked run.
    expect(subj.value).toBe(1);
    expect(subj.reason).toContain('coverage mapped from from.ts to to.ts per user mapping');
  });

  it('unmarked run: field absent, and output byte-identical to per_test_run: false', () => {
    const body = JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } });
    const absent = applyCoverageReport(analysisWith('from.ts', [1, 2]), tmpFile('ptr-absent.json', body), {
      coverageMap: { 'from.ts': 'to.ts' },
    });
    const explicitFalse = applyCoverageReport(analysisWith('from.ts', [1, 2]), tmpFile('ptr-false.json', body), {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: false,
    });
    expect(absent.evidence.line_coverage.per_test_run).toBeUndefined();
    expect('per_test_run' in absent.evidence.line_coverage).toBe(false);
    // Serialized form is the contract ADR-031 protects: identical bytes.
    expect(JSON.stringify(explicitFalse)).toBe(JSON.stringify(absent));
  });

  // Unit B supersedes the original whole-output equality here: in marked mode the
  // PER-DECLARATION records legitimately differ (numeric vs advisory — see the
  // unit-B describe below). The surviving contract is that the SUBJECT record
  // differs only by the added field.
  it('marked vs unmarked: the subject record differs only by the added field', () => {
    const body = JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } });
    const marked = JSON.parse(
      JSON.stringify(
        applyCoverageReport(analysisWith('from.ts', [1, 2]), tmpFile('ptr-diff-marked.json', body), {
          coverageMap: { 'from.ts': 'to.ts' },
          per_test_run: true,
        }),
      ),
    );
    const plain = JSON.parse(
      JSON.stringify(
        applyCoverageReport(analysisWith('from.ts', [1, 2]), tmpFile('ptr-diff-plain.json', body), {
          coverageMap: { 'from.ts': 'to.ts' },
        }),
      ),
    );
    expect(marked.evidence.line_coverage.per_test_run).toBe(true);
    delete marked.evidence.line_coverage.per_test_run;
    expect(marked.evidence.line_coverage).toEqual(plain.evidence.line_coverage);
  });

  // Unit A pinned "marked moves no verdict"; unit B (tasks 5+6) supersedes it:
  // marked + map + KNOWN + COMPLETE now yields NUMERIC per-declaration records.
  // The marker field itself is still never added to a per-declaration record.
  it('marked run + KNOWN + COMPLETE target: per-declaration records become numeric (unit B)', () => {
    const p = tmpFile('ptr-decl.json', JSON.stringify({ covered: { 'to.ts': [0, 1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: true,
    });
    expect(out.tests).toHaveLength(2);
    for (const t of out.tests!) {
      const decl = t.evidence.line_coverage;
      expect(decl.value).toBe(1);
      expect(decl.reason).toBe('coverage evidence from a run scoped to from.ts');
      expect('per_test_run' in decl).toBe(false);
    }
  });

  it('parseCoverageReport accepts the marker option and its records are unchanged', () => {
    const body = JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } });
    const plain = parseCoverageReport(tmpFile('ptr-parse-plain.json', body));
    const marked = parseCoverageReport(tmpFile('ptr-parse-marked.json', body), { per_test_run: true });
    expect(JSON.stringify(marked.records.get('to.ts'))).toBe(JSON.stringify(plain.records.get('to.ts')));
  });
});

// CT-COV-001 per-test-run verdicts + veto-WARN (plan tasks 5+6, TDD unit B).
// Unit A plumbed the marker only; unit B reads it. With the marker + a mapping +
// a KNOWN + COMPLETE mapped target, per-declaration records become NUMERIC (the
// same shape unmapped mode produces) instead of advisory — the claim stays
// file-level ("the mapped production file was exercised in the run of this test
// file"), never a per-test-body claim (design §2). A mapped-pair contradiction
// prepends a veto-WARN to the subject reason and NEVER moves a verdict.
describe('per-test-run verdicts + veto-WARN (CT-COV-001 unit B)', () => {
  const active = (): typeof CT_COV_001 => ({ ...CT_COV_001, status: 'active' });

  it('marked + map + KNOWN + COMPLETE: per-declaration records are numeric with the scoped reason', () => {
    const p = tmpFile('ptrb-numeric.json', JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: true,
    });
    expect(out.tests).toHaveLength(2);
    for (const t of out.tests!) {
      const decl = t.evidence.line_coverage;
      expect(decl.value).toBe(1);
      expect(decl.availability).toBe(Availability.KNOWN);
      expect(decl.provenance).toBe(Provenance.EXTERNAL);
      expect(decl.scope).toBe(EVIDENCE_SCOPE_TEST_BODY);
      expect(decl.coverage.status).toBe(CollectionStatus.COMPLETE);
      expect(decl.reason).toBe('coverage evidence from a run scoped to from.ts');
    }
    // Subject-level verdict unchanged by the mode: >= 1 covered line in the mapped file.
    expect(out.evidence.line_coverage.value).toBe(1);
    expect(evaluateRule(active(), out).finding?.result).toBe(RuleResult.PASS);
  });

  it('marked + map + all-uncovered target: per-declaration numeric 0 -> FAIL', () => {
    const p = tmpFile('ptrb-numeric-zero.json', JSON.stringify({ covered: { 'to.ts': [0, 0, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: true,
    });
    for (const t of out.tests!) expect(t.evidence.line_coverage.value).toBe(0);
    for (const e of evaluateTests(active(), out)) expect(e.finding?.result).toBe(RuleResult.FAIL);
  });

  it('per-declaration verdict changes ONLY in marked mode (subject verdict identical)', () => {
    const body = JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } });
    const marked = applyCoverageReport(analysisWith('from.ts', [1, 2]), tmpFile('ptrb-mode-marked.json', body), {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: true,
    });
    const unmarked = applyCoverageReport(analysisWith('from.ts', [1, 2]), tmpFile('ptrb-mode-plain.json', body), {
      coverageMap: { 'from.ts': 'to.ts' },
    });
    // Unmarked is the ADR-031 advisory contract exactly as unit A pinned it.
    for (const t of unmarked.tests!) {
      const decl = t.evidence.line_coverage;
      expect(decl.value).toBeUndefined();
      expect(decl.availability).toBe(Availability.UNKNOWN);
      expect(decl.reason).toContain('per-declaration attribution not supported for mapped coverage');
    }
    // Per-declaration: unmarked INDETERMINATE, marked decidable PASS.
    for (const e of evaluateTests(active(), unmarked)) expect(e.finding?.result).toBe(RuleResult.INDETERMINATE);
    for (const e of evaluateTests(active(), marked)) expect(e.finding?.result).toBe(RuleResult.PASS);
    // The subject verdict is the same either way.
    expect(evaluateRule(active(), marked).finding?.result).toBe(RuleResult.PASS);
    expect(evaluateRule(active(), unmarked).finding?.result).toBe(RuleResult.PASS);
  });

  it('veto-WARN: PARTIAL sibling entry annotates the subject reason, verdict unchanged', () => {
    const clean = applyCoverageReport(
      analysisWith('from.ts', [1, 2]),
      tmpFile('ptrb-warn-clean.json', JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } })),
      { coverageMap: { 'from.ts': 'to.ts' }, per_test_run: true },
    );
    const warned = applyCoverageReport(
      analysisWith('from.ts', [1, 2]),
      tmpFile('ptrb-warn.json', JSON.stringify({ covered: { 'to.ts': [0, 1, 0], 'other.ts': [null, 1] } })),
      { coverageMap: { 'from.ts': 'to.ts' }, per_test_run: true },
    );
    expect(warned.evidence.line_coverage.reason).toMatch(/^veto-WARN: /);
    expect(warned.evidence.line_coverage.reason).toContain('coverage mapped from from.ts to to.ts per user mapping');
    expect(clean.evidence.line_coverage.reason).not.toContain('veto-WARN');
    // WARN annotates; it never gates the verdict.
    expect(evaluateRule(active(), warned).finding?.result).toBe(evaluateRule(active(), clean).finding?.result);
    expect(evaluateRule(active(), warned).finding?.result).toBe(RuleResult.PASS);
  });

  it('veto-WARN absent: unmarked, no mapping, or no PARTIAL sibling', () => {
    const partialBody = JSON.stringify({ covered: { 'to.ts': [0, 1, 0], 'other.ts': [null, 1] } });
    const unmarked = applyCoverageReport(
      analysisWith('from.ts', [1, 2]),
      tmpFile('ptrb-nowarn-unmarked.json', partialBody),
      { coverageMap: { 'from.ts': 'to.ts' } },
    );
    expect(unmarked.evidence.line_coverage.reason).not.toContain('veto-WARN');

    const unmapped = applyCoverageReport(
      analysisWith('other.test.ts', [1]),
      tmpFile('ptrb-nowarn-unmapped.json', partialBody),
      {
        per_test_run: true,
      },
    );
    expect(unmapped.evidence.line_coverage.reason ?? '').not.toContain('veto-WARN');

    const noPartial = applyCoverageReport(
      analysisWith('from.ts', [1, 2]),
      tmpFile('ptrb-nowarn-clean.json', JSON.stringify({ covered: { 'to.ts': [0, 1, 0], 'other.ts': [1, 1] } })),
      { coverageMap: { 'from.ts': 'to.ts' }, per_test_run: true },
    );
    expect(noPartial.evidence.line_coverage.reason).not.toContain('veto-WARN');
  });

  it('the numeric per-declaration value serializes in the JSON report (no reporter change)', () => {
    const p = tmpFile('ptrb-json.json', JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: true,
    });
    const json = JSON.parse(toJson(out, evaluateRule(active(), out), evaluateTests(active(), out))) as Record<
      string,
      any
    >;
    expect(json.testResults[0].evidence.line_coverage.value).toBe(1);
    expect(json.testResults[0].evidence.line_coverage.reason).toContain('coverage evidence from a run scoped to');
    // The marker field is still not on the wire (unit-A reporter decision).
    expect(json.testResults[0].evidence.line_coverage.per_test_run).toBeUndefined();
  });

  it('marked + map + PARTIAL target: per-declaration stays advisory (guard)', () => {
    const p = tmpFile('ptrb-partial-target.json', JSON.stringify({ covered: { 'to.ts': [null, 1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: true,
    });
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.PARTIAL);
    for (const t of out.tests!) {
      const decl = t.evidence.line_coverage;
      expect(decl.value).toBeUndefined();
      expect(decl.reason).toContain('per-declaration attribution not supported for mapped coverage');
    }
    for (const e of evaluateTests(active(), out)) expect(e.finding?.result).toBe(RuleResult.INDETERMINATE);
  });
});
