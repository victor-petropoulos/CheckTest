import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

import { parseMutationReport, applyMutationReport } from '../../src/providers/mutation';
import { Availability, CollectionStatus, Provenance } from '../../src/core/evidence';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../src/core/analysis';

const TMP = join(process.env.TMPDIR || '/tmp', 'checktest-mutation-fixtures');

function tmpFile(name: string, content: string): string {
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

// The real schema-v2 Stryker sample from reports/WP4.6-mutation-schema.md:19,
// verbatim. schemaVersion "2", no `thresholds` key (the sample omits it), one
// Killed and one Survived mutant.
const REAL_SAMPLE =
  '{"schemaVersion":"2","files":{"src/a.ts":{"language":"typescript","source":"function a() { return true; }","mutants":[{"id":"0","mutatorName":"BooleanLiteral","replacement":"false","location":{"start":{"line":2,"column":0},"end":{"line":2,"column":1}},"status":"Survived","coveredBy":["T1"],"killedBy":[],"testsCompleted":1},{"id":"1","mutatorName":"BlockStatement","replacement":"{}","location":{"start":{"line":3,"column":0},"end":{"line":3,"column":1}},"status":"Killed","coveredBy":["T1"],"killedBy":["T1"],"testsCompleted":1}]}},"testFiles":{"a.test.ts":{"tests":[{"id":"T1","name":"checks a","location":{"start":{"line":1,"column":0},"end":{"line":1,"column":8}}}]}}}';

function analysisWith(file: string): AnalysisOutput {
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
    tests: [],
  };
}

describe('mutation provider — failure behavior (never fabricate)', () => {
  it('missing report -> UNKNOWN + reason, never zero', () => {
    const out = applyMutationReport(analysisWith('src/a.ts'), join(TMP, 'does-not-exist.json'));
    const rec = out.evidence.mutation_score;
    expect(rec).toBeDefined();
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.value).toBeUndefined();
    expect(rec.value).not.toBe(0);
    expect(rec.reason).toContain('unable to read');
    expect(rec.provenance).toBe(Provenance.EXTERNAL);
    expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
  });

  it('malformed JSON -> UNKNOWN + reason', () => {
    const p = tmpFile('malformed.json', '{not json');
    const out = applyMutationReport(analysisWith('src/a.ts'), p);
    const rec = out.evidence.mutation_score;
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.value).toBeUndefined();
    expect(rec.reason).toContain('malformed');
  });

  it('unsupported format (no files key) -> UNKNOWN + reason', () => {
    const p = tmpFile('unsupported.json', JSON.stringify({ schemaVersion: '2', note: 'nope' }));
    const out = applyMutationReport(analysisWith('src/a.ts'), p);
    const rec = out.evidence.mutation_score;
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.value).toBeUndefined();
    expect(rec.reason).toContain('unsupported');
  });
});

describe('mutation provider — real schema-v2 sample', () => {
  it('parses Killed/Survived statuses into EXTERNAL EvidenceRecords with provider fields', () => {
    const p = tmpFile('real-sample.json', REAL_SAMPLE);
    const r = parseMutationReport(p, {
      provider: 'stryker',
      provider_version: '8.0.0',
      source_revision: 'abc123',
    });
    expect(r.provider).toBe('stryker');
    expect(r.provider_version).toBe('8.0.0');
    expect(r.source_revision).toBe('abc123');
    expect(r.records.size).toBe(1);

    const rec = r.records.get('src/a.ts')!;
    expect(rec.type).toBe('mutation_score');
    expect(rec.provenance).toBe(Provenance.EXTERNAL);
    expect(rec.availability).toBe(Availability.KNOWN);
    expect(rec.provider).toBe('stryker');
    expect(rec.provider_version).toBe('8.0.0');
    expect(rec.source_revision).toBe('abc123');
    expect(rec.collector_version).toBe('8.0.0');
    expect(rec.scope).toBe('test-body');
    expect(rec.coverage.status).toBe(CollectionStatus.COMPLETE);
  });

  it('computes score as detected/valid, never fabricated (1 killed / 2 valid = 0.5)', () => {
    const p = tmpFile('real-sample2.json', REAL_SAMPLE);
    const r = parseMutationReport(p);
    const score = r.records.get('src/a.ts')!.value as Record<string, number>;
    expect(score.killed).toBe(1);
    expect(score.survived).toBe(1);
    expect(score.detected).toBe(1);
    expect(score.valid).toBe(2);
    expect(score.score).toBe(0.5);
  });
});

describe('mutation provider — status handling and score math', () => {
  function fileWith(statuses: string[]): string {
    const mutants = statuses.map((status, i) => ({ id: String(i), mutatorName: 'X', status }));
    return JSON.stringify({
      schemaVersion: '2',
      files: { 'src/a.ts': { language: 'typescript', source: '', mutants } },
    });
  }

  it('maps all eight statuses: detected=Killed+Timeout, valid excludes errors/ignored/pending', () => {
    const p = tmpFile(
      'all-statuses.json',
      fileWith(['Killed', 'Survived', 'Timeout', 'NoCoverage', 'CompileError', 'RuntimeError', 'Ignored', 'Pending']),
    );
    const r = parseMutationReport(p);
    const rec = r.records.get('src/a.ts')!;
    const v = rec.value as Record<string, number>;
    expect(rec.availability).toBe(Availability.KNOWN);
    expect(v.killed).toBe(1);
    expect(v.survived).toBe(1);
    expect(v.timeout).toBe(1);
    expect(v.noCoverage).toBe(1);
    expect(v.compileError).toBe(1);
    expect(v.runtimeError).toBe(1);
    expect(v.ignored).toBe(1);
    expect(v.pending).toBe(1);
    expect(v.detected).toBe(2); // Killed + Timeout
    expect(v.valid).toBe(4); // Killed + Timeout + Survived + NoCoverage
    expect(v.score).toBe(0.5);
  });

  it('score is computed only from present statuses (Survived-only report = 0)', () => {
    const p = tmpFile('survived-only.json', fileWith(['Survived', 'Survived']));
    const rec = parseMutationReport(p).records.get('src/a.ts')!;
    const v = rec.value as Record<string, number>;
    expect(rec.availability).toBe(Availability.KNOWN);
    expect(v.valid).toBe(2);
    expect(v.detected).toBe(0);
    expect(v.score).toBe(0);
  });

  it('no valid mutants (ignored/pending only) -> UNKNOWN, never a fabricated score', () => {
    const p = tmpFile('ignored-only.json', fileWith(['Ignored', 'Pending']));
    const rec = parseMutationReport(p).records.get('src/a.ts')!;
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.value).toBeUndefined();
    expect(rec.reason).toContain('no valid mutants');
  });

  it('unrecognized status -> UNKNOWN per file, never a partially fabricated score', () => {
    const p = tmpFile('bad-status.json', fileWith(['Killed', 'NotARealStatus']));
    const rec = parseMutationReport(p).records.get('src/a.ts')!;
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.value).toBeUndefined();
    expect(rec.reason).toContain('unrecognized');
  });

  it('schemaVersion "2.0.0" dotted sub-version is tolerated', () => {
    const p = tmpFile(
      'dotted.json',
      JSON.stringify({
        schemaVersion: '2.0.0',
        files: { 'src/a.ts': { language: 'typescript', source: '', mutants: [{ id: '0', status: 'Killed' }] } },
      }),
    );
    const rec = parseMutationReport(p).records.get('src/a.ts')!;
    expect(rec.availability).toBe(Availability.KNOWN);
    expect((rec.value as Record<string, number>).killed).toBe(1);
  });

  it('empty files object -> no file entries reason, no records', () => {
    const p = tmpFile('empty-files.json', JSON.stringify({ schemaVersion: '2', files: {} }));
    const r = parseMutationReport(p);
    expect(r.records.size).toBe(0);
    expect(r.reason).toContain('no file entries');
  });
});

describe('mutation provider — apply and revision mismatch', () => {
  it('apply picks the subject file by basename and tags file-level evidence only', () => {
    const p = tmpFile(
      'apply.json',
      JSON.stringify({
        schemaVersion: '2',
        files: { '/abs/dir/a.ts': { language: 'typescript', source: '', mutants: [{ id: '0', status: 'Killed' }] } },
      }),
    );
    const out = applyMutationReport(analysisWith('a.ts'), p);
    expect(out.evidence.mutation_score.availability).toBe(Availability.KNOWN);
    expect((out.evidence.mutation_score.value as Record<string, number>).killed).toBe(1);
    // mutation is file-level only: no per-declaration attribution (roadmap:1086).
    expect(out.tests).toEqual([]);
  });

  it('subject file absent from report -> UNKNOWN with reason', () => {
    const p = tmpFile(
      'apply-miss.json',
      JSON.stringify({
        schemaVersion: '2',
        files: {
          'x.ts': { language: 'ts', source: '', mutants: [{ id: '0', status: 'Killed' }] },
          'y.ts': { language: 'ts', source: '', mutants: [{ id: '0', status: 'Killed' }] },
        },
      }),
    );
    const out = applyMutationReport(analysisWith('a.ts'), p);
    expect(out.evidence.mutation_score.availability).toBe(Availability.UNKNOWN);
    expect(out.evidence.mutation_score.reason).toContain('no mutation data for a.ts');
  });

  it('stale revision mismatch -> UNKNOWN, never a definitive score', () => {
    const p = tmpFile('mismatch.json', REAL_SAMPLE);
    const r = parseMutationReport(p, { source_revision: 'rev1', analyzedRevision: 'rev2' });
    expect(r.mismatch).toBe(true);
    const rec = r.records.get('src/a.ts')!;
    expect(rec.availability).toBe(Availability.UNKNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(rec.value).toBeUndefined();
    expect(rec.reason).toContain('mismatch');
  });

  it('defaults: provider stryker, version 1.0.0, revision unknown', () => {
    const p = tmpFile('defaults.json', REAL_SAMPLE);
    const r = parseMutationReport(p);
    expect(r.provider).toBe('stryker');
    expect(r.provider_version).toBe('1.0.0');
    expect(r.source_revision).toBe('unknown');
  });
});
