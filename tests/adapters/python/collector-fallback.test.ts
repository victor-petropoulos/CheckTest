import { join } from 'path';

import { AnalysisStatus } from '../../../src/core/analysis';
import { Availability } from '../../../src/core/evidence';
import { collectAnalysis, type SubstrateProbe } from '../../../src/adapters/python/collector';

/** Simulated prebuild miss: substrate probe that fails to resolve tree-sitter (C5 flake fix — no cross-suite jest.mock). */
const NO_NATIVE: SubstrateProbe = {
  require(id: string): unknown {
    throw new Error(`simulated prebuild miss for ${id}`);
  },
};

const FIXTURES = join(__dirname, 'fixtures');

describe('python adapter — substrate fallback (native unavailable)', () => {
  it('fallback (python3 ast) → SUCCESS with counts', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), { substrateProbe: NO_NATIVE });
    const record = output.evidence['assertion_count'];

    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);
    expect(record.availability).toBe(Availability.KNOWN);
    expect(typeof record.value).toBe('number');
    expect(record.value as number).toBeGreaterThan(0);
  });

  it('fallback (python3 ast) -> per-declaration span intersection matches the native spans', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), {
      substrateProbe: NO_NATIVE,
      coverageReport: join(FIXTURES, 'coverage.lcov'),
    });
    const scopes = output.tests ?? [];
    const byName = new Map(scopes.map((scope) => [scope.test.name, scope]));
    // The python3-ast substrate emits the SAME {start,end} spans as the native
    // tree-sitter substrate: test_add spans lines 4-6 (covered {5,6} -> 2) and
    // test_sub spans lines 9-10 (covered {9} -> 1).
    expect(byName.get('test_add')!.evidence['line_coverage'].value).toBe(2);
    expect(byName.get('test_sub')!.evidence['line_coverage'].value).toBe(1);
  });
});
