import { join } from 'path';

import { pythonAdapter } from '../../../src/adapters/python/adapter';
import { AnalysisStatus } from '../../../src/core/analysis';
import { Availability } from '../../../src/core/evidence';

const FIXTURES = join(__dirname, 'fixtures');
const PY_FIXTURE = join(FIXTURES, 'pytest_sample.py');
const MAPPED_COVERAGE = join(FIXTURES, 'mapped-production.json');

describe('python adapter — coverageMap + perTestRun forwarding', () => {
  it('forwards coverageMap and perTestRun into the collector evidence pipeline', () => {
    const output = pythonAdapter.collectAnalysis(PY_FIXTURE, {
      coverageReport: MAPPED_COVERAGE,
      coverageMap: [`${PY_FIXTURE}=/abs/production.py`],
      perTestRun: true,
    });

    expect(output.analysis.status).toBe(AnalysisStatus.SUCCESS);

    const subjectRecord = output.evidence['line_coverage'];
    expect(subjectRecord).toBeDefined();
    expect(subjectRecord?.availability).toBe(Availability.KNOWN);
    expect(subjectRecord?.value).toBe(2);
    expect(subjectRecord?.reason).toContain('mapped to /abs/production.py');

    const scopedRecords = output.tests ?? [];
    expect(scopedRecords.length).toBeGreaterThan(0);
    for (const scope of scopedRecords) {
      const record = scope.evidence['line_coverage'];
      expect(record).toBeDefined();
      expect(record?.availability).toBe(Availability.KNOWN);
      expect([0, 1]).toContain(record?.value);
      expect(record?.reason).toContain('coverage evidence from a run scoped to');
    }
  });
});
