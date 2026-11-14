import { join } from 'path';

import { AnalysisStatus } from '../../../src/core/analysis';
import { collectAnalysis, type SubstrateProbe } from '../../../src/adapters/python/collector';

const FIXTURES = join(__dirname, 'fixtures');

/** Both substrates unavailable: native require throws + fallback binary missing (C5 flake fix — probe seam replaces cross-suite jest.mock of tree-sitter AND child_process, which leaked a half-built stub into unrelated suites under runInBand). */
const NO_PARSER: SubstrateProbe = {
  require(id: string): unknown {
    throw new Error(`simulated prebuild miss for ${id}`);
  },
  python3: 'python3-definitely-not-on-path',
};

describe('python adapter — unsupported parser (both substrates fail)', () => {
  it('unsupported → reason contains "no python parser available"', () => {
    const output = collectAnalysis(join(FIXTURES, 'pytest_sample.py'), { substrateProbe: NO_PARSER });
    const record = output.evidence['assertion_count'];

    expect(output.analysis.status).toBe(AnalysisStatus.UNSUPPORTED);
    expect(record.reason).toContain('no python parser available');
  });
});
