import { join, resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

import { parseCoverageReport, applyCoverageReport } from '../../src/providers/coverage';
import {
  Availability,
  CollectionStatus,
  EVIDENCE_SCOPE_TEST_BODY,
  EvidenceStrength,
  Provenance,
} from '../../src/core/evidence';
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
// (parseC8, findFileRecord) through the two public entry points — tests MUST
// NOT modify src/. (B5 C-2 removed isLineCovered/perDeclarationRecord.)

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
    // Fail-closed (F3): entries without a valid coveredLines/covered array are
    // UNKNOWN/UNAVAILABLE, never a measured zero.
    for (const file of ['c.ts', 'd.ts', 'e.ts']) {
      const rec = r.records.get(file)!;
      expect(rec.availability).toBe(Availability.UNKNOWN);
      expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
      expect(rec.reason).toBe('missing or invalid coveredLines array');
    }
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
    for (const file of ['a.ts', 'b.ts']) {
      const rec = r2.records.get(file)!;
      expect(rec.value).toEqual([]);
      expect(rec.availability).toBe(Availability.UNKNOWN);
      expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
      expect(rec.reason).toBe('missing or invalid coveredLines array');
    }
  });

  // F3 fail-closed matrix: missing array / malformed array / valid empty array
  // (measured zero) / valid non-empty array.
  it('c8 fail-closed: missing and malformed coveredLines are UNKNOWN, valid empty is measured zero', () => {
    const p = tmpFile(
      'c8-fail-closed.json',
      JSON.stringify({
        files: {
          'missing.ts': {},
          'missing-both.ts': { hits: 3 },
          'malformed.ts': { coveredLines: 'nope' },
          'malformed-object.ts': { covered: { '1': 1 } },
          'valid-empty.ts': { coveredLines: [] },
          'valid-empty-covered.ts': { covered: [] },
          'valid-nonempty.ts': { coveredLines: [1, 4] },
        },
      }),
    );
    const r = parseCoverageReport(p, { provider_version: '9.9.9', source_revision: 'rev-c8' });

    for (const file of ['missing.ts', 'missing-both.ts', 'malformed.ts', 'malformed-object.ts']) {
      const rec = r.records.get(file)!;
      expect(rec.value).toEqual([]);
      expect(rec.availability).toBe(Availability.UNKNOWN);
      expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
      expect(rec.reason).toBe('missing or invalid coveredLines array');
    }

    // A valid empty array IS measured data: measured zero, not unknown.
    for (const file of ['valid-empty.ts', 'valid-empty-covered.ts']) {
      const rec = r.records.get(file)!;
      expect(rec.value).toEqual([]);
      expect(rec.availability).toBe(Availability.KNOWN);
      expect(rec.coverage.status).toBe(CollectionStatus.COMPLETE);
      expect(rec.reason).toBeUndefined();
    }

    const nonempty = r.records.get('valid-nonempty.ts')!;
    expect(nonempty.value).toEqual([1, 4]);
    expect(nonempty.availability).toBe(Availability.KNOWN);
    expect(nonempty.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(nonempty.reason).toBeUndefined();
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

describe('findFileRecord via applyCoverageReport (fail-closed join)', () => {
  it('exact-key match', () => {
    const p = tmpFile('ffr-exact.json', JSON.stringify({ covered: { 's.test.ts': [1, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p);
    expect(out.evidence.line_coverage.value).toEqual([1, 1]);
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    // B5 C-2 (Decisions #12): ordinary non-mapped coverage carries no per-declaration record.
    expect(out.tests![0].evidence.line_coverage).toBeUndefined();
  });

  it('exact match: absolute report key vs relative subject path matches after normalize', () => {
    const absKey = resolve('s.test.ts'); // cwd-absolute, identical to normalizePath('s.test.ts')
    const p = tmpFile('ffr-abskey.json', JSON.stringify({ covered: { [absKey]: [1, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p);
    expect(out.evidence.line_coverage.value).toEqual([1, 1]);
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    // B5 C-2 (Decisions #12): ordinary non-mapped coverage carries no per-declaration record.
    expect(out.tests![0].evidence.line_coverage).toBeUndefined();
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
    expect(byBasename.evidence.line_coverage.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(byBasename.evidence.line_coverage.reason).toContain('ambiguous basename match:');
    expect(byBasename.evidence.line_coverage.reason).toContain('/one/s.test.ts');
    expect(byBasename.evidence.line_coverage.reason).toContain('/two/s.test.ts');
    // B5 C-2 (Decisions #12): ordinary non-mapped coverage carries no per-declaration record.
    expect(byBasename.tests![0].evidence.line_coverage).toBeUndefined();
  });

  it('no basename fallback: absolute report key vs relative subject -> UNKNOWN + reason', () => {
    const p = tmpFile('ffr-base.json', JSON.stringify({ covered: { '/abs/dir/s.test.ts': [0, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [2]), p);
    expect(out.evidence.line_coverage.value).toBeUndefined();
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.reason).toContain('no coverage data for s.test.ts');
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    // B5 C-2 (Decisions #12): ordinary non-mapped coverage carries no per-declaration record.
    expect(out.tests![0].evidence.line_coverage).toBeUndefined();
  });

  it('sole unrelated report entry -> fail-closed UNKNOWN, no match', () => {
    const p = tmpFile('ffr-single.json', JSON.stringify({ covered: { 'only.ts': [0, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [2]), p);
    expect(out.evidence.line_coverage.value).toBeUndefined();
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.reason).toContain('no coverage data for s.test.ts');
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    // B5 C-2 (Decisions #12): ordinary non-mapped coverage carries no per-declaration record.
    expect(out.tests![0].evidence.line_coverage).toBeUndefined();
  });

  it('no match with multiple records → UNKNOWN record with reason, per-decl UNKNOWN', () => {
    const p = tmpFile('ffr-miss.json', JSON.stringify({ covered: { 'x.ts': [1], 'y.ts': [1, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p);
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.reason).toContain('no coverage data for s.test.ts');
    // B5 C-2 (Decisions #12): ordinary non-mapped coverage carries no per-declaration record.
    expect(out.tests![0].evidence.line_coverage).toBeUndefined();
  });

  it('ambiguous basename match: multiple report files map to same source basename', () => {
    const p = tmpFile(
      'ffr-ambig.json',
      JSON.stringify({ covered: { 'src/a/mod.ts': [1, 1], 'src/b/mod.ts': [0, 1] } }),
    );
    const out = applyCoverageReport(analysisWith('mod.ts', [1]), p);
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(out.evidence.line_coverage.reason).toContain('ambiguous basename match:');
    expect(out.evidence.line_coverage.reason).toContain('src/a/mod.ts');
    expect(out.evidence.line_coverage.reason).toContain('src/b/mod.ts');
    // B5 C-2 (Decisions #12): ordinary non-mapped coverage carries no per-declaration record.
    expect(out.tests![0].evidence.line_coverage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// phase9 2.3 — failure-mode matrix. Every row names the DISTINCTING reason
// keyword the provider emits, so no two failure modes are conflated and none
// ever yields a fabricated numeric.
// ---------------------------------------------------------------------------
describe('failure-mode matrix (phase9 2.3)', () => {
  const active = (): typeof CT_COV_001 => ({ ...CT_COV_001, status: 'active' });

  interface Row {
    readonly name: string;
    readonly subj: { availability: Availability; status: CollectionStatus; value: unknown; reason: string };
    readonly decl?: { availability: Availability; value: unknown; reason: string };
  }

  function row(out: ReturnType<typeof applyCoverageReport>): Row {
    const subj = out.evidence.line_coverage;
    const decl = out.tests![0].evidence.line_coverage;
    return {
      name: '',
      subj: {
        availability: subj.availability,
        status: subj.coverage.status,
        value: subj.value,
        reason: subj.reason ?? '',
      },
      // B5 C-2 (Decisions #12): the ordinary non-mapped path carries no per-declaration record.
      decl:
        decl === undefined
          ? undefined
          : { availability: decl.availability, value: decl.value, reason: decl.reason ?? '' },
    };
  }

  /**
   * The contract every failure row shares: nothing is decidable, nothing numeric.
   * `value` is undefined, or the c8 fail-closed EMPTY array (coverage.ts:228) —
   * never a number, so no threshold can read it as a measured zero.
   */
  function expectNotNumeric(value: unknown): void {
    if (value !== undefined) expect(value).toEqual([]);
    expect(typeof value === 'number').toBe(false);
  }

  function expectUndecidable(r: Row, keyword: string): void {
    expect(r.subj.availability).toBe(Availability.UNKNOWN);
    expect(r.subj.status).toBe(CollectionStatus.UNAVAILABLE);
    expectNotNumeric(r.subj.value);
    expect(r.subj.reason).toContain(keyword);
    // B5 C-2 (Decisions #12): the ordinary non-mapped path carries no per-declaration
    // record; mapped rows still carry the advisory per-declaration record.
    if (r.decl !== undefined) {
      expect(r.decl.availability).toBe(Availability.UNKNOWN);
      expectNotNumeric(r.decl.value);
      expect(r.decl.reason).toBeTruthy();
    }
    // Rule level: an undecidable record is INDETERMINATE, never FAIL.
    expect(r.subj.status).not.toBe(CollectionStatus.COMPLETE);
  }

  /**
   * Mapped rows carry TWO wordings by design: the SUBJECT record names the mapping
   * and the join outcome (coverage.ts:530, :540-542); the per-declaration record is
   * advisory for mapped coverage (advisoryPerDeclarationRecord, coverage.ts:392-418).
   */
  function expectMappedUndecidable(r: Row, subjectKeyword: string): void {
    expectUndecidable(r, subjectKeyword);
    // B5 C-2 (Decisions #12): only mapped rows carry the advisory per-declaration record.
    expect(r.decl).toBeDefined();
    expect(r.decl!.reason).toContain('per-declaration attribution not supported for mapped coverage');
  }

  it('valid zero coverage is MEASURED data (KNOWN/COMPLETE, value 0) — not a failure mode', () => {
    // c8: a present-but-empty coveredLines array is a measured zero.
    const c8Zero = row(
      applyCoverageReport(
        analysisWith('from.ts', [1]),
        tmpFile(
          'fm-zero-c8.json',
          JSON.stringify({
            files: { 'to.ts': { coveredLines: [] } },
          }),
        ),
        { coverageMap: { 'from.ts': 'to.ts' } },
      ),
    );
    expect(c8Zero.subj.availability).toBe(Availability.KNOWN);
    expect(c8Zero.subj.status).toBe(CollectionStatus.COMPLETE);
    expect(c8Zero.subj.value).toBe(0);
    expect(c8Zero.subj.reason).toContain('coverage mapped from from.ts to to.ts per user mapping');

    // Istanbul: an all-zero hit-map is the same measured zero.
    const istZero = row(
      applyCoverageReport(
        analysisWith('from.ts', [1]),
        tmpFile(
          'fm-zero-ist.json',
          JSON.stringify({
            covered: { 'to.ts': [0, 0, 0] },
          }),
        ),
        { coverageMap: { 'from.ts': 'to.ts' } },
      ),
    );
    expect(istZero.subj.availability).toBe(Availability.KNOWN);
    expect(istZero.subj.status).toBe(CollectionStatus.COMPLETE);
    expect(istZero.subj.value).toBe(0);
    expect(
      evaluateRule(
        active(),
        applyCoverageReport(
          analysisWith('from.ts', [1]),
          tmpFile('fm-zero-ist2.json', JSON.stringify({ covered: { 'to.ts': [0, 0, 0] } })),
          { coverageMap: { 'from.ts': 'to.ts' } },
        ),
      ).finding?.result,
    ).toBe(RuleResult.FAIL); // a measured zero is decidable
  });

  it('missing array: c8 entry without coveredLines/covered -> UNKNOWN/UNAVAILABLE + parse reason', () => {
    const out = applyCoverageReport(
      analysisWith('from.ts', [1]),
      tmpFile('fm-missing-array.json', JSON.stringify({ files: { 'to.ts': { hits: 3 } } })),
      { coverageMap: { 'from.ts': 'to.ts' } },
    );
    const r = row(out);
    expectUndecidable(r, 'missing or invalid coveredLines array');
    expect(evaluateRule(active(), out).finding?.result).toBe(RuleResult.INDETERMINATE);
  });

  it('malformed array: c8 coveredLines of the wrong JSON type -> UNKNOWN/UNAVAILABLE + parse reason', () => {
    const out = applyCoverageReport(
      analysisWith('from.ts', [1]),
      tmpFile('fm-malformed-array.json', JSON.stringify({ files: { 'to.ts': { coveredLines: 'nope' } } })),
      { coverageMap: { 'from.ts': 'to.ts' } },
    );
    expectUndecidable(row(out), 'missing or invalid coveredLines array');
    expect(evaluateRule(active(), out).finding?.result).toBe(RuleResult.INDETERMINATE);
  });

  it('malformed at the report level (unparseable JSON / unsupported shape) -> no records, reason, INDETERMINATE', () => {
    // Malformed JSON fails at PARSE, not at apply: the provider returns zero
    // records plus a reason, and apply turns the empty join into UNKNOWN.
    const bad = parseCoverageReport(tmpFile('fm-bad-json.json', '{not json'));
    expect(bad.records.size).toBe(0);
    expect(bad.reason).toContain('malformed coverage report JSON');
    const unsupported = parseCoverageReport(tmpFile('fm-unsupported.json', JSON.stringify({ foo: 1 })));
    expect(unsupported.records.size).toBe(0);
    expect(unsupported.reason).toContain('unsupported coverage report format');

    const out = applyCoverageReport(analysisWith('from.ts', [1]), tmpFile('fm-bad-json2.json', '{not json'), {
      coverageMap: { 'from.ts': 'to.ts' },
    });
    expectMappedUndecidable(row(out), 'no coverage data for to.ts');
    expect(evaluateRule(active(), out).finding?.result).toBe(RuleResult.INDETERMINATE);
  });

  it('unmapped file, no basename collision -> UNKNOWN/UNAVAILABLE "no coverage data for <subject>"', () => {
    const out = applyCoverageReport(
      analysisWith('s.test.ts', [1]),
      tmpFile('fm-unmapped.json', JSON.stringify({ covered: { 'x.ts': [1], 'y.ts': [1, 1] } })),
    );
    expectUndecidable(row(out), 'no coverage data for s.test.ts');
    expect(out.evidence.line_coverage.reason).not.toContain('ambiguous basename');
    expect(evaluateRule(active(), out).finding?.result).toBe(RuleResult.INDETERMINATE);
  });

  it('unmapped subject error names the expected test->production mapping (--coverage-map hint)', () => {
    const out = applyCoverageReport(
      analysisWith('s.test.ts', [1]),
      tmpFile('fm-unmapped-hint.json', JSON.stringify({ covered: { 'x.ts': [1] } })),
    );
    expect(out.evidence.line_coverage.reason).toContain('no coverage data for s.test.ts');
    expect(out.evidence.line_coverage.reason).toContain('--coverage-map <from>=<to>');
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(evaluateRule(active(), out).finding?.result).toBe(RuleResult.INDETERMINATE);
  });

  it('ambiguous basename match -> UNKNOWN/UNAVAILABLE "ambiguous basename match: <paths>"', () => {
    const out = applyCoverageReport(
      analysisWith('mod.ts', [1]),
      tmpFile('fm-ambiguous.json', JSON.stringify({ covered: { 'src/a/mod.ts': [1, 1], 'src/b/mod.ts': [0, 1] } })),
    );
    expectUndecidable(row(out), 'ambiguous basename match:');
    expect(out.evidence.line_coverage.reason).toContain('src/a/mod.ts');
    expect(out.evidence.line_coverage.reason).toContain('src/b/mod.ts');
    expect(out.evidence.line_coverage.reason).not.toContain('no coverage data for');
    expect(evaluateRule(active(), out).finding?.result).toBe(RuleResult.INDETERMINATE);
  });

  it('mapped target absent from report -> UNKNOWN/UNAVAILABLE, mappingReason prefix + "no coverage data for <mappedTo>"', () => {
    const out = applyCoverageReport(
      analysisWith('from.ts', [1]),
      tmpFile('fm-mapped-missing.json', JSON.stringify({ covered: { 'other.ts': [1] } })),
      { coverageMap: { 'from.ts': 'nope.ts' } },
    );
    const r = row(out);
    expectMappedUndecidable(r, 'no coverage data for nope.ts');
    expect(r.subj.reason).toContain('coverage mapped from from.ts to nope.ts per user mapping');
    expect(r.subj.reason).not.toContain('ambiguous basename');
    expect(evaluateRule(active(), out).finding?.result).toBe(RuleResult.INDETERMINATE);
  });

  it('mapped target present but malformed (istanbul non-array value) -> same "no coverage data for <mappedTo>" wording', () => {
    // Istanbul entries that are not arrays are SKIPPED at parse
    // (parseIstanbul, coverage.ts:195-198), so the mapped target is absent.
    const parsed = parseCoverageReport(
      tmpFile('fm-mapped-malformed.json', JSON.stringify({ covered: { 'to.ts': 'nope', 'other.ts': [1] } })),
    );
    expect(parsed.records.has('to.ts')).toBe(false);
    expect(parsed.records.size).toBe(1);

    const out = applyCoverageReport(
      analysisWith('from.ts', [1]),
      tmpFile('fm-mapped-malformed2.json', JSON.stringify({ covered: { 'to.ts': 'nope', 'other.ts': [1] } })),
      { coverageMap: { 'from.ts': 'to.ts' } },
    );
    expectMappedUndecidable(row(out), 'no coverage data for to.ts');
    expect(out.evidence.line_coverage.reason).toContain('coverage mapped from from.ts to to.ts per user mapping');
    expect(evaluateRule(active(), out).finding?.result).toBe(RuleResult.INDETERMINATE);
  });

  it('revision mismatch (istanbul + c8) -> UNKNOWN/UNAVAILABLE + mismatch reason, never numeric', () => {
    const ist = applyCoverageReport(
      analysisWith('s.test.ts', [1]),
      tmpFile('fm-rev-ist.json', JSON.stringify({ covered: { 's.test.ts': [1, 1] } })),
      { source_revision: 'rev-old', analyzedRevision: 'rev-new' },
    );
    expectUndecidable(row(ist), 'source revision mismatch');
    expect(ist.evidence.line_coverage.reason).toContain('rev-old');
    expect(ist.evidence.line_coverage.reason).toContain('rev-new');

    const c8 = applyCoverageReport(
      analysisWith('s.test.ts', [1]),
      tmpFile('fm-rev-c8.json', JSON.stringify({ files: { 's.test.ts': { coveredLines: [1] } } })),
      { source_revision: 'rev-old', analyzedRevision: 'rev-new' },
    );
    expectUndecidable(row(c8), 'source revision mismatch');
    for (const out of [ist, c8]) {
      expect(evaluateRule(active(), out).finding?.result).toBe(RuleResult.INDETERMINATE);
      for (const scope of evaluateTests(active(), out)) expect(scope.finding?.result).toBe(RuleResult.INDETERMINATE);
    }
  });

  it('revision unknown + analyzed declared -> "freshness cannot be established" (no freshness claim without the analyzed input)', () => {
    const out = applyCoverageReport(
      analysisWith('s.test.ts', [1]),
      tmpFile('fm-rev-unknown.json', JSON.stringify({ covered: { 's.test.ts': [1, 1] } })),
      { analyzedRevision: 'rev-new' },
    );
    expectUndecidable(row(out), 'report revision unknown; freshness cannot be established');
    expect(evaluateRule(active(), out).finding?.result).toBe(RuleResult.INDETERMINATE);

    // No analyzed input -> no freshness claim at all (KNOWN, no reason).
    const none = applyCoverageReport(
      analysisWith('s.test.ts', [1]),
      tmpFile('fm-rev-none.json', JSON.stringify({ covered: { 's.test.ts': [1, 1] } })),
    );
    expect(none.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    expect(none.evidence.line_coverage.reason).toBeUndefined();
  });

  it('every failure row yields a distinct reason (no two modes share wording)', () => {
    const reasons = [
      row(
        applyCoverageReport(
          analysisWith('s.test.ts', [1]),
          tmpFile(
            'fm-dist-unmapped.json',
            JSON.stringify({
              covered: { 'x.ts': [1] },
            }),
          ),
        ),
      ).subj.reason,
      row(
        applyCoverageReport(
          analysisWith('mod.ts', [1]),
          tmpFile(
            'fm-dist-ambig.json',
            JSON.stringify({
              covered: { 'a/mod.ts': [1], 'b/mod.ts': [1] },
            }),
          ),
        ),
      ).subj.reason,
      row(
        applyCoverageReport(
          analysisWith('from.ts', [1]),
          tmpFile(
            'fm-dist-mapped.json',
            JSON.stringify({
              covered: { 'other.ts': [1] },
            }),
          ),
          { coverageMap: { 'from.ts': 'nope.ts' } },
        ),
      ).subj.reason,
      row(
        applyCoverageReport(
          analysisWith('s.test.ts', [1]),
          tmpFile(
            'fm-dist-rev.json',
            JSON.stringify({
              covered: { 's.test.ts': [1] },
            }),
          ),
          { source_revision: 'r1', analyzedRevision: 'r2' },
        ),
      ).subj.reason,
    ];
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it('characterization: two --coverage-map entries naming the SAME `to` target resolve silently to the report key, whichever entry matched the subject', () => {
    // The report holds TWO records whose basename is `to.ts`, neither of which
    // is the literal `to.ts` the mapping names, plus one exact `src/to.ts`.
    const body = JSON.stringify({
      covered: { 'src/to.ts': [0, 0], 'vendor/to.ts': [1, 1], 'keep.ts': [1] },
    });
    const reportPath = tmpFile('fm-collision.json', body);

    // (a) two `from` entries -> the same `to`; the SUBJECT-matching entry wins
    //     (mappings.find first match, coverage.ts:507) and the mapping is exact.
    const twoFrom = applyCoverageReport(analysisWith('from.ts', [1]), reportPath, {
      coverageMap: [
        { from: 'other.ts', to: 'src/to.ts' },
        { from: 'from.ts', to: 'src/to.ts' },
      ],
    });
    expect(twoFrom.evidence.line_coverage.value).toBe(0); // count of 1s in [0,0]
    expect(twoFrom.evidence.line_coverage.reason).toBe('coverage mapped from from.ts to src/to.ts per user mapping');
    expect(evaluateRule(active(), twoFrom).finding?.result).toBe(RuleResult.FAIL);

    // (b) reversed order: the SUBJECT-matching entry is second, so a
    //     first-match-only implementation would miss it — it does not.
    const reversed = applyCoverageReport(analysisWith('from.ts', [1]), reportPath, {
      coverageMap: [
        { from: 'from.ts', to: 'src/to.ts' },
        { from: 'other.ts', to: 'src/to.ts' },
      ],
    });
    expect(reversed.evidence.line_coverage.reason).toBe('coverage mapped from from.ts to src/to.ts per user mapping');
    expect(reversed.evidence.line_coverage.value).toBe(0);

    // (c) the same `to` under a DIFFERENT subject also resolves, silently.
    const other = applyCoverageReport(analysisWith('other.ts', [1]), reportPath, {
      coverageMap: [
        { from: 'other.ts', to: 'src/to.ts' },
        { from: 'from.ts', to: 'src/to.ts' },
      ],
    });
    expect(other.evidence.line_coverage.value).toBe(0);
    expect(other.evidence.line_coverage.reason).toBe('coverage mapped from other.ts to src/to.ts per user mapping');

    // (d) a `to` that matches NO report key is UNKNOWN even when another
    //     record shares its basename (no basename fallback in the mapped branch).
    const noKey = applyCoverageReport(analysisWith('from.ts', [1]), reportPath, {
      coverageMap: [
        { from: 'a.ts', to: 'to.ts' },
        { from: 'from.ts', to: 'to.ts' },
      ],
    });
    expect(noKey.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(noKey.evidence.line_coverage.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(noKey.evidence.line_coverage.reason).toBe(
      'coverage mapped from from.ts to to.ts per user mapping (no coverage data for to.ts)',
    );
    expect(evaluateRule(active(), noKey).finding?.result).toBe(RuleResult.INDETERMINATE);
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
    // B5 C-2 (Decisions #12): ordinary non-mapped coverage carries no per-declaration record.
    expect(out.tests![0].evidence.line_coverage).toBeUndefined();
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
    // I0 (Q3 parity): advisory per-declaration records stay location-less (ADR-039:22).
    expect(out.tests![1].evidence.line_coverage.location).toBeUndefined();
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
  // (a) Provenance.EXTERNAL on the apply-side failure paths — unknownRecord: even a
  // missing-file join yields an EXTERNAL record, never a fabricated value and never an
  // untyped record. (B5 C-2: the ordinary path no longer adds a per-declaration record.)
  it('apply: no matching report entry → subject record is EXTERNAL with a reason', () => {
    const p = tmpFile('prov-apply-miss.json', JSON.stringify({ covered: { 'other.ts': [1, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1]), p);
    const subj = out.evidence.line_coverage;
    expect(subj.provenance).toBe(Provenance.EXTERNAL);
    expect(subj.availability).toBe(Availability.UNKNOWN);
    expect(subj.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(subj.reason).toContain('no coverage data for s.test.ts');
    // B5 C-2 (Decisions #12): ordinary non-mapped coverage carries no per-declaration record.
    expect(out.tests![0].evidence.line_coverage).toBeUndefined();
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
  it('apply: file-level aggregate stays EXTERNAL/test-body; ordinary path carries no per-declaration record', () => {
    const p = tmpFile('prov-scope.json', JSON.stringify({ files: { 's.test.ts': { coveredLines: [1, 3] } } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1, 3]), p);
    const subj = out.evidence.line_coverage;
    expect(subj.value).toEqual([1, 3]);
    expect(subj.scope).toBe(EVIDENCE_SCOPE_TEST_BODY);
    expect(subj.provenance).toBe(Provenance.EXTERNAL);
    // B5 C-2 (Decisions #12): the ordinary non-mapped path carries no per-declaration
    // record, so the file-level aggregate is the only line_coverage evidence.
    for (const t of out.tests!) expect(t.evidence.line_coverage).toBeUndefined();
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
    // B5 C-2 (Decisions #12): ordinary non-mapped coverage carries no per-declaration record.
    expect(out.tests![0].evidence.line_coverage).toBeUndefined();
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
      // I0 (Q3 parity): advisory per-declaration records stay location-less (ADR-039:22).
      expect(t.evidence.line_coverage.location).toBeUndefined();
    }
  });

  // CT-COV-001 verdict matrix after the F3 fail-closed fix (c8 input):
  // valid empty array = measured zero -> FAIL; missing/malformed array -> UNKNOWN -> INDETERMINATE.
  it('mapped c8 valid empty coveredLines (measured zero) -> subject-level FAIL', () => {
    const p = tmpFile('sp2fix-c8-zero.json', JSON.stringify({ files: { 'to.ts': { coveredLines: [] } } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1]), p, { coverageMap: { 'from.ts': 'to.ts' } });
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(out.evidence.line_coverage.value).toBe(0);
    expect(evaluateRule(activeRule(), out).finding?.result).toBe(RuleResult.FAIL);
  });

  it('mapped c8 missing coveredLines -> UNKNOWN -> subject-level INDETERMINATE, never FAIL', () => {
    const p = tmpFile('sp2fix-c8-missing.json', JSON.stringify({ files: { 'to.ts': {} } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1]), p, { coverageMap: { 'from.ts': 'to.ts' } });
    expect(out.evidence.line_coverage.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.line_coverage.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(out.evidence.line_coverage.reason).toContain('missing or invalid coveredLines array');
    expect(evaluateRule(activeRule(), out).finding?.result).toBe(RuleResult.INDETERMINATE);
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
      // I0 (Q3 parity): advisory per-declaration records stay location-less (ADR-039:22).
      expect(decl.location).toBeUndefined();
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
      // I0 (Q3 parity): advisory per-declaration records stay location-less (ADR-039:22).
      expect(decl.location).toBeUndefined();
    }
    for (const e of evaluateTests(active(), out)) expect(e.finding?.result).toBe(RuleResult.INDETERMINATE);
  });
});

// I0 (Q3 parity) — RED-first location contract BEFORE implementation (ADR-039).
// Numeric per-declaration records (scopedPerDeclarationRecord) MUST carry
// location { file, line } naming the TEST file + declaration line. The ordinary
// non-mapped path carries NO per-declaration record (B5 C-2, Decisions #12).
// Advisory per-declaration records (advisoryPerDeclarationRecord) MUST stay
// location-LESS: their reason disclaims per-declaration attribution, so a
// location would be a false attribution claim (ADR-039:22,40; DECISIONS Q6).
// location.file is the TEST file containing the declaration, never the mapped
// production file (ADR-039:21, Q3 ruling).
// RED semantics: the numeric toBeDefined/toEqual pins FAIL pre-impl (location
// is undefined today); the advisory toBeUndefined pins PASS pre-impl (they pin
// the asymmetry by design).
describe('per-declaration location (Q3 parity)', () => {
  it('scopedPerDeclarationRecord: numeric records carry location { file: test file, line: decl line }', () => {
    const p = tmpFile('q3-scoped.json', JSON.stringify({ covered: { 'to.ts': [0, 1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: true,
    });
    expect(out.tests).toHaveLength(2);
    const decl1 = out.tests!.find((t) => t.test.line === 1)!.evidence.line_coverage;
    expect(decl1.value).toBe(1);
    expect(decl1.reason).toBe('coverage evidence from a run scoped to from.ts');
    expect(decl1.location).toBeDefined();
    expect(decl1.location).toEqual({ file: 'from.ts', line: 1 });
    const decl2 = out.tests!.find((t) => t.test.line === 2)!.evidence.line_coverage;
    expect(decl2.location).toBeDefined();
    expect(decl2.location).toEqual({ file: 'from.ts', line: 2 });
  });

  it('advisoryPerDeclarationRecord: mapped advisory records stay location-less (asymmetry pin)', () => {
    const p = tmpFile('q3-advisory.json', JSON.stringify({ covered: { 'to.ts': [0, 1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, { coverageMap: { 'from.ts': 'to.ts' } });
    for (const t of out.tests!) {
      const decl = t.evidence.line_coverage;
      expect(decl.value).toBeUndefined();
      expect(decl.reason).toContain('per-declaration attribution not supported for mapped coverage');
      expect(decl.location).toBeUndefined();
    }
  });

  it('asymmetry: ordinary path carries no per-decl record; mapped advisory records are location-less', () => {
    const numericReport = tmpFile(
      'q3-asym-num.json',
      JSON.stringify({ files: { 's.test.ts': { coveredLines: [1] } } }),
    );
    const numeric = applyCoverageReport(analysisWith('s.test.ts', [1]), numericReport);
    // B5 C-2 (Decisions #12): ordinary non-mapped coverage is not attributed per declaration.
    expect(numeric.tests![0].evidence.line_coverage).toBeUndefined();

    const advisoryReport = tmpFile('q3-asym-adv.json', JSON.stringify({ covered: { 'to.ts': [0, 1] } }));
    const advisory = applyCoverageReport(analysisWith('from.ts', [1]), advisoryReport, {
      coverageMap: { 'from.ts': 'to.ts' },
    });
    expect(advisory.tests![0].evidence.line_coverage.location).toBeUndefined();
  });
});

describe('task 5 — provider-set EvidenceStrength surfaces on evidence record in JSON', () => {
  it('missing report yields UNSUPPORTED strength on the synthesized record and in JSON output', () => {
    const out = applyCoverageReport(analysisWith('subject.ts', [1]), join(TMP, 'definitely-missing.json'));
    expect(out.evidence.line_coverage.evidenceStrength).toBe(EvidenceStrength.UNSUPPORTED);
    const json = JSON.parse(toJson(out, evaluateRule(CT_COV_001, out), evaluateTests(CT_COV_001, out))) as Record<
      string,
      any
    >;
    expect(json.evidence.line_coverage.evidenceStrength).toBe('UNSUPPORTED');
  });
});

// ---------------------------------------------------------------------------
// WP-C task 17 (RED) — owner ruling ## Decisions #12 B5 C-2:
// "Remove the perTest copy (Recommended)" — src/providers/coverage.ts:604-613.
// Sidecar CF-COV-001 pins perTest.line_coverage = MUST_BE_ABSENT for the
// ordinary (non-mapped) path. The mapped (scopedPerDeclarationRecord :432) and
// advisory (advisoryPerDeclarationRecord :396) branches stay intact.
// ---------------------------------------------------------------------------
describe('C-2: perTest line_coverage MUST_BE_ABSENT on the ordinary non-mapped path (Decisions #12 B5 C-2)', () => {
  it('ordinary istanbul report: file-level line_coverage stays, every per-test line_coverage is absent', () => {
    const p = tmpFile('c2-ordinary-ist.json', JSON.stringify({ covered: { 's.test.ts': [null, 1, 0, 1] } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [2, 3]), p);
    // file-level record remains present with the raw array value
    expect(out.evidence.line_coverage).toBeDefined();
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    expect(out.evidence.line_coverage.value).toEqual([null, 1, 0, 1]);
    // per-test copy removed (CF-COV-001 perTest.line_coverage MUST_BE_ABSENT)
    expect(out.tests).toHaveLength(2);
    for (const t of out.tests!) {
      expect(t.evidence.line_coverage).toBeUndefined();
    }
  });

  it('ordinary c8 report: same MUST_BE_ABSENT contract', () => {
    const p = tmpFile('c2-ordinary-c8.json', JSON.stringify({ files: { 's.test.ts': { coveredLines: [1, 3] } } }));
    const out = applyCoverageReport(analysisWith('s.test.ts', [1, 3]), p);
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    for (const t of out.tests!) {
      expect(t.evidence.line_coverage).toBeUndefined();
    }
  });

  it('mapped + per_test_run: scoped numeric per-declaration branch stays intact (regression)', () => {
    const p = tmpFile('c2-mapped-scoped.json', JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: true,
    });
    for (const t of out.tests!) {
      const decl = t.evidence.line_coverage;
      expect(decl).toBeDefined();
      expect([0, 1]).toContain(decl.value);
      expect(decl.reason).toBe('coverage evidence from a run scoped to from.ts');
    }
  });

  it('mapped without per_test_run: advisory per-declaration branch stays intact (regression)', () => {
    const p = tmpFile('c2-mapped-advisory.json', JSON.stringify({ covered: { 'to.ts': [0, 1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, { coverageMap: { 'from.ts': 'to.ts' } });
    for (const t of out.tests!) {
      const decl = t.evidence.line_coverage;
      expect(decl).toBeDefined();
      expect(decl.value).toBeUndefined();
      expect(decl.reason).toContain('per-declaration attribution not supported for mapped coverage');
    }
  });
});

describe('raw vitest shape-A (coverage-final.json flat Istanbul map, C2)', () => {
  const FIXTURE = join(__dirname, '..', 'fixtures', 'vitest-shape-a-coverage-final.json');
  const SHAPE_A_PATH = '/Users/victorpetropoulos/Cursor Projects/engram/scripts/lib/mcp.ts';
  // derive() semantics: sorted unique statementMap start lines where s>0
  // (validation/cov001-per-test-recipe.sh:124-145).
  const EXPECTED_LINES = [4, 5, 6, 7, 11, 26, 27, 30, 31, 33, 60, 61, 62, 63, 64, 66, 67];

  it('parses the tracked real fixture to a KNOWN record with derive()-equivalent coveredLines', () => {
    const r = parseCoverageReport(FIXTURE);
    expect(r.provider).toBe('vitest');
    expect(r.records.size).toBe(1);
    const rec = r.records.get(SHAPE_A_PATH)!;
    expect(rec).toBeDefined();
    expect(rec.type).toBe('line_coverage');
    expect(rec.provenance).toBe(Provenance.EXTERNAL);
    expect(rec.availability).toBe(Availability.KNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(rec.value).toEqual(EXPECTED_LINES);
    expect((rec.value as number[]).length).toBe(17);
    // lines are strictly sorted ascending with no duplicates
    const arr = rec.value as number[];
    expect(arr).toEqual(Array.from(new Set(arr)).sort((a, b) => a - b));
  });

  it('apply: unmapped subject record carries the same KNOWN array', () => {
    const out = applyCoverageReport(analysisWith(SHAPE_A_PATH, [1]), FIXTURE);
    expect(out.evidence.line_coverage.availability).toBe(Availability.KNOWN);
    expect(out.evidence.line_coverage.value).toEqual(EXPECTED_LINES);
  });

  it('measured zero: all hit counts 0 -> KNOWN/COMPLETE with an empty line list', () => {
    const p = tmpFile(
      'shapeA-zero.json',
      JSON.stringify({ '/x/a.ts': { statementMap: { '0': { start: { line: 1 } } }, s: { '0': 0 } } }),
    );
    const r = parseCoverageReport(p);
    const rec = r.records.get('/x/a.ts')!;
    expect(rec.availability).toBe(Availability.KNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.COMPLETE);
    expect(rec.value).toEqual([]);
  });

  it('malformed shape-A entry -> UNKNOWN (fail-closed F3), never a zero-coverage KNOWN', () => {
    const p = tmpFile(
      'shapeA-malformed.json',
      JSON.stringify({
        '/x/ok.ts': { statementMap: { '0': { start: { line: 1 } } }, s: { '0': 1 } },
        '/x/bad-stmtmap.ts': { statementMap: 'nope', s: {} },
        '/x/bad-hits.ts': { statementMap: {}, s: 'nope' },
        '/x/bad-line.ts': { statementMap: { '0': { start: {} } }, s: { '0': 2 } },
        '/x/bad-hitcount.ts': { statementMap: { '0': { start: { line: 1 } } }, s: { '0': 'x' } },
        '/x/bad-nullentry.ts': null,
      }),
    );
    const r = parseCoverageReport(p);
    expect(r.provider).toBe('vitest');
    expect(r.records.size).toBe(6);

    const ok = r.records.get('/x/ok.ts')!;
    expect(ok.availability).toBe(Availability.KNOWN);
    expect(ok.value).toEqual([1]);

    for (const file of [
      '/x/bad-stmtmap.ts',
      '/x/bad-hits.ts',
      '/x/bad-line.ts',
      '/x/bad-hitcount.ts',
      '/x/bad-nullentry.ts',
    ]) {
      const rec = r.records.get(file)!;
      expect(rec.availability).toBe(Availability.UNKNOWN);
      expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
      expect(rec.value).toEqual([]);
      expect(typeof rec.value !== 'number').toBe(true);
      expect(rec.reason).toContain('missing or invalid statementMap/s');
    }
  });

  it('revision mismatch marks every shape-A record UNAVAILABLE with mismatch reason', () => {
    const p = tmpFile(
      'shapeA-mismatch.json',
      JSON.stringify({ '/x/a.ts': { statementMap: { '0': { start: { line: 1 } } }, s: { '0': 1 } } }),
    );
    const r = parseCoverageReport(p, { source_revision: 'rev1', analyzedRevision: 'rev2' });
    expect(r.mismatch).toBe(true);
    const rec = r.records.get('/x/a.ts')!;
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(rec.value).toBeUndefined();
    expect(rec.reason).toContain('mismatch');
  });

  it('provider override replaces the vitest default', () => {
    const p = tmpFile(
      'shapeA-provider.json',
      JSON.stringify({ '/x/a.ts': { statementMap: { '0': { start: { line: 1 } } }, s: { '0': 1 } } }),
    );
    const r = parseCoverageReport(p, { provider: 'custom-vitest' });
    expect(r.provider).toBe('custom-vitest');
    expect(r.records.get('/x/a.ts')!.provider).toBe('custom-vitest');
  });
});

describe('per-declaration coverage attribution (Task 1)', () => {
  it('Tier 1: numeric KNOWN single-decl self-coverage', () => {
    const p = tmpFile('pd-tier1.json', JSON.stringify({ covered: { 'from.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [2]), p, {
      coverageMap: { 'from.ts': 'from.ts' },
      per_test_run: true,
      per_declaration_coverage: true,
      source_revision: 'r1',
      analyzedRevision: 'r1',
    });
    const decl = out.tests![0].evidence.line_coverage!;
    expect(decl.value).toBe(1);
    expect(decl.availability).toBe('KNOWN');
    expect(decl.location).toEqual({ file: 'from.ts', line: 2 });
    expect(decl.reason).toContain('per-test-run attested');
    expect(decl.reason).toContain('single-declaration');
  });

  it('Tier 2 cross-file mapping: value undefined + UNKNOWN + run-scoped reason', () => {
    const p = tmpFile('pd-tier2-cross.json', JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [2]), p, {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: true,
      per_declaration_coverage: true,
      source_revision: 'r1',
      analyzedRevision: 'r1',
    });
    const decl = out.tests![0].evidence.line_coverage!;
    expect(decl.value).toBeUndefined();
    expect(decl.availability).toBe('UNKNOWN');
    expect(decl.reason).toContain('run-scoped file-level coverage, not per-test-causal');
  });

  it('Tier 2 multi-decl same-file: value undefined + UNKNOWN', () => {
    const p = tmpFile('pd-tier2-multi.json', JSON.stringify({ covered: { 'from.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, {
      coverageMap: { 'from.ts': 'from.ts' },
      per_test_run: true,
      per_declaration_coverage: true,
      source_revision: 'r1',
      analyzedRevision: 'r1',
    });
    const decl = out.tests![0].evidence.line_coverage!;
    expect(decl.value).toBeUndefined();
    expect(decl.availability).toBe('UNKNOWN');
    expect(decl.reason).toContain('run-scoped file-level coverage, not per-test-causal');
  });

  it('Tier 2 flag on without per_test_run: value undefined + UNKNOWN', () => {
    const p = tmpFile('pd-tier2-noper.json', JSON.stringify({ covered: { 'from.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [2]), p, {
      coverageMap: { 'from.ts': 'from.ts' },
      per_declaration_coverage: true,
      source_revision: 'r1',
      analyzedRevision: 'r1',
    });
    const decl = out.tests![0].evidence.line_coverage!;
    expect(decl.value).toBeUndefined();
    expect(decl.availability).toBe('UNKNOWN');
    expect(decl.reason).toContain('run-scoped file-level coverage, not per-test-causal');
  });

  it('Tier 3 no declared source_revision: UNKNOWN', () => {
    const p = tmpFile('pd-tier3.json', JSON.stringify({ covered: { 'from.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [2]), p, {
      coverageMap: { 'from.ts': 'from.ts' },
      per_test_run: true,
      per_declaration_coverage: true,
    });
    const decl = out.tests![0].evidence.line_coverage!;
    expect(decl.value).toBeUndefined();
    expect(decl.availability).toBe('UNKNOWN');
  });

  it('precedence flag OFF + per_test_run ON: scoped 0/1 unchanged', () => {
    const p = tmpFile('pd-prec-a.json', JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, {
      coverageMap: { 'from.ts': 'to.ts' },
      per_test_run: true,
    });
    const decl = out.tests![0].evidence.line_coverage!;
    expect(decl.value).toBe(1);
    expect(decl.reason).toBe('coverage evidence from a run scoped to from.ts');
  });

  it('precedence flag OFF + mapped: advisory reason unchanged', () => {
    const p = tmpFile('pd-prec-b.json', JSON.stringify({ covered: { 'to.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [1, 2]), p, {
      coverageMap: { 'from.ts': 'to.ts' },
    });
    const decl = out.tests![0].evidence.line_coverage!;
    expect(decl.reason).toContain('per-declaration attribution not supported for mapped coverage');
  });
});

describe('per-declaration coverage attribution (reviewer fixes)', () => {
  it('Tier 1 span intersection excludes covered lines before declLine', () => {
    // covered line 1 (import) precedes declaration at line 3 -> excluded
    const p = tmpFile('pd-span.json', JSON.stringify({ covered: { 'from.ts': [1, 0, 1] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [3]), p, {
      coverageMap: { 'from.ts': 'from.ts' },
      per_test_run: true,
      per_declaration_coverage: true,
      source_revision: 'r1',
      analyzedRevision: 'r1',
    });
    const decl = out.tests![0].evidence.line_coverage!;
    expect(decl.value).toBe(1); // only line 3 counts, not line 1
  });

  it('flag ON + unmapped: per-declaration line_coverage absent (C-2)', () => {
    const p = tmpFile('pd-unmapped.json', JSON.stringify({ covered: { 'from.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [2]), p, {
      per_declaration_coverage: true,
    });
    expect(out.tests![0].evidence.line_coverage).toBeUndefined();
  });

  it('Tier 3 cause substring: mapped target missing', () => {
    const p = tmpFile('pd-tier3-missing.json', JSON.stringify({ covered: { 'other.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [2]), p, {
      coverageMap: { 'from.ts': 'nonexistent.ts' },
      per_test_run: true,
      per_declaration_coverage: true,
    });
    const decl = out.tests![0].evidence.line_coverage!;
    expect(decl.availability).toBe('UNKNOWN');
    expect(decl.value).toBeUndefined();
    // reason = targetRecord.reason ?? 'per-declaration attribution unavailable'
    // targetRecord = findFileRecord(parsed, 'nonexistent.ts') = undefined → unknownRecord
    expect(decl.reason).toContain('no coverage data for');
  });

  it('Tier 3 cause substring: no declared --source-revision', () => {
    const p = tmpFile('pd-tier3-nodecl.json', JSON.stringify({ covered: { 'from.ts': [0, 1, 0] } }));
    const out = applyCoverageReport(analysisWith('from.ts', [2]), p, {
      coverageMap: { 'from.ts': 'from.ts' },
      per_test_run: true,
      per_declaration_coverage: true,
    });
    const decl = out.tests![0].evidence.line_coverage!;
    expect(decl.availability).toBe('UNKNOWN');
    expect(decl.value).toBeUndefined();
    // source_revision absent → unknownRecord cause string
    expect(decl.reason).toContain('per-declaration attribution unavailable');
  });
});
