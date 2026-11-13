import { readFileSync } from 'fs';
import { join } from 'path';

import { parseMutationReport } from '../../src/providers/mutation';
import { Availability, CollectionStatus, Provenance } from '../../src/core/evidence';

const FIXTURE = join(__dirname, 'fixtures', 'stryker-sample.json');

// Schema contract verified against src/providers/mutation.ts:
//   schemaVersion required, /^[12](\.\d+)*$/        mutation.ts:306-307
//   files object required                            mutation.ts:318
//   per-file mutants[].status scored                 mutation.ts:247, :126-156
//   detected = killed + timeout, valid = detected + survived + noCoverage, score = detected/valid  mutation.ts:159-168
// The provider reads NEITHER a top-level `mutationScore` NOR `mutantScore`;
// it computes per-file scores from mutants. This fixture is a real Stryker 10
// json report (schemaVersion "1.0") which has neither top-level field.
describe('mutation provider — real Stryker sample fixture (SP3.1)', () => {
  it('parses the fixture and scores each file from its mutants', () => {
    const raw = readFileSync(FIXTURE, 'utf8');
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(raw);
    }).not.toThrow();

    const report = parsed as Record<string, unknown>;
    expect(typeof report.schemaVersion).toBe('string');
    expect(String(report.schemaVersion)).toMatch(/^[12](\.\d+)*$/); // same gate as mutation.ts:306-307
    expect(report.files).toBeTruthy(); // required by mutation.ts:318
    expect('mutationScore' in report).toBe(false); // not consumed by provider
    expect('mutantScore' in report).toBe(false); // not consumed by provider

    const r = parseMutationReport(FIXTURE);
    expect(r.provider).toBe('stryker'); // default, mutation.ts:263
    expect(r.provider_version).toBe('1.0.0'); // default, mutation.ts:259
    expect(r.source_revision).toBe('unknown'); // default, mutation.ts:260
    expect(r.records.size).toBe(1);

    const rec = r.records.get('src/index.js')!;
    expect(rec.type).toBe('mutation_score');
    expect(rec.provenance).toBe(Provenance.EXTERNAL);
    expect(rec.availability).toBe(Availability.KNOWN);
    expect(rec.coverage.status).toBe(CollectionStatus.COMPLETE);

    const v = rec.value as Record<string, number>;
    expect(v.killed).toBe(20);
    expect(v.survived).toBe(0);
    expect(v.detected).toBe(20); // killed + timeout, mutation.ts:159
    expect(v.valid).toBe(20); // mutation.ts:160
    expect(v.score).toBe(1); // GREEN: real fixture score is 20 killed / 20 valid = 1
  });
});
