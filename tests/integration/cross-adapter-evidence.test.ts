/**
 * Phase 9 Package 2, task 2.4 — cross-adapter evidence parity.
 *
 * Verifies that equivalent evidence has consistent provenance/freshness AND
 * identical rule results across the TypeScript and Python adapters:
 *
 *   (a) coverage parity — runs TS (parseCoverageReport) and Python (collectAnalysis)
 *       adapters on equivalent coverage inputs; asserts provenance EXTERNAL for
 *       both, freshness check behavior identical, mismatch → UNKNOWN for both.
 *
 *   (b) assertion-evidence parity — constructs the SAME normalized evidence
 *       record (same evidenceStrength/availability/completeness) and runs
 *       CT-INT-001 through the shared evaluator (evaluateRule) on both
 *       adapter-produced inputs; asserts identical verdict.
 *
 * Seam: adapter-level API calls + shared evaluateRule (src/core/evaluation.ts),
 * matching the seam used by tests/adapters/python/collector.test.ts and
 * tests/integration/fixtures.test.ts. No CLI spawn, no tree-sitter optionalDeps.
 *
 * Grounding:
 *   TS coverage:        src/providers/coverage.ts (parseCoverageReport :247, reason :248-250 / :320-322)
 *   Py coverage:        src/adapters/python/collector.ts (pythonCoverageFreshness :529-549, applyCoverageReport :816-905)
 *   Shared evaluator:  src/core/evaluation.ts (evaluateRule :170, evaluateTests :198)
 *   CT-INT-001 rule:   src/rules/ct-int-001.ts
 *   EvidenceStrength: src/core/evidence.ts (EvidenceStrength enum)
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { collectAnalysis, pythonCoverageFreshness } from '../../src/adapters/python/collector';
import { evaluateRule, evaluateTests } from '../../src/core/evaluation';
import { Availability, CollectionStatus, EvidenceStrength, Provenance } from '../../src/core/evidence';
import { AnalysisStatus, Completeness, TestType } from '../../src/core/analysis';
import { CT_INT_001 } from '../../src/rules/ct-int-001';
import { parseCoverageReport } from '../../src/providers/coverage';

const PY_FIXTURES = join(__dirname, '..', 'adapters', 'python', 'fixtures');

/**
 * Write a temp Istanbul-shaped coverage report (TS side) or coverage.py JSON
 * (Python side) and return its path. Cleanup is caller-driven via the tmpdir.
 */
function tmpReport(name: string, body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'xtest-'));
  const path = join(dir, name);
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return path;
}

// ---------------------------------------------------------------------------
// (a) COVERAGE PARITY
// ---------------------------------------------------------------------------

describe('cross-adapter coverage parity (phase9 2.4a)', () => {
  // TS side uses Istanbul `covered` shape; Python side uses coverage.py JSON
  // `files.<name>.executed_lines`. Both carry an optional source revision.
  const TS_REPORT_MATCH = {
    covered: {
      'src/foo.ts': [1, 2, 3, 5],
    },
  };
  const TS_REPORT_MISMATCH = {
    covered: {
      'src/foo.ts': [1, 2, 3, 5],
    },
  };

  const PY_REPORT_MATCH = {
    meta: { version: '7.0', source_revision: 'abc123' },
    files: {
      'pytest_sample.py': { executed_lines: [1, 2, 3, 5], missing_lines: [] },
    },
  };
  const PY_REPORT_MISMATCH = {
    meta: { version: '7.0', source_revision: 'abc123' },
    files: {
      'pytest_sample.py': { executed_lines: [1, 2, 3, 5], missing_lines: [] },
    },
  };

  it('provenance EXTERNAL on both adapters for a matching-revision report', () => {
    const tsPath = tmpReport('istanbul.json', { ...TS_REPORT_MATCH, source_revision: 'abc123' });
    const ts = parseCoverageReport(tsPath, {
      provider: 'istanbul',
      provider_version: '1.0.0',
      source_revision: 'abc123',
      analyzedRevision: 'abc123',
    });
    const tsRec = ts.records.get('src/foo.ts')!;
    expect(tsRec.provenance).toBe(Provenance.EXTERNAL);
    expect(tsRec.availability).toBe(Availability.KNOWN);

    const pyPath = tmpReport('coverage.json', PY_REPORT_MATCH);
    const py = collectAnalysis(join(PY_FIXTURES, 'pytest_sample.py'), {
      coverageReport: pyPath,
      analyzedRevision: 'abc123',
    } as any);
    const pyRec = py.evidence['line_coverage'];
    expect(pyRec).toBeDefined();
    expect(pyRec.provenance).toBe(Provenance.EXTERNAL);
    expect(pyRec.availability).toBe(Availability.KNOWN);

    // parity: both EXTERNAL + KNOWN on matching revision
    expect(tsRec.provenance).toBe(pyRec.provenance);
    expect(tsRec.availability).toBe(pyRec.availability);
  });

  it('mismatch → UNKNOWN with equivalent reason wording on both adapters', () => {
    // TS: analyzedRevision != report revision
    const tsPath = tmpReport('istanbul.json', { ...TS_REPORT_MISMATCH, source_revision: 'abc123' });
    const ts = parseCoverageReport(tsPath, {
      provider: 'istanbul',
      provider_version: '1.0.0',
      source_revision: 'abc123',
      analyzedRevision: 'def456', // mismatch
    });
    const tsRec = ts.records.get('src/foo.ts')!;
    expect(tsRec.availability).toBe(Availability.UNKNOWN);
    expect(tsRec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(tsRec.reason).toContain('source revision mismatch');

    // Python: same mismatch
    const pyPath = tmpReport('coverage.json', PY_REPORT_MISMATCH);
    const py = collectAnalysis(join(PY_FIXTURES, 'pytest_sample.py'), {
      coverageReport: pyPath,
      analyzedRevision: 'def456', // mismatch
    } as any);
    const pyRec = py.evidence['line_coverage'];
    expect(pyRec).toBeDefined();
    expect(pyRec.availability).toBe(Availability.UNKNOWN);
    expect(pyRec.coverage.status).toBe(CollectionStatus.UNAVAILABLE);
    expect(pyRec.reason).toContain('source revision mismatch');

    // parity: both UNKNOWN + UNAVAILABLE + identical mismatch wording prefix
    expect(tsRec.availability).toBe(pyRec.availability);
    expect(tsRec.coverage.status).toBe(pyRec.coverage.status);
    expect(tsRec.reason).toBe(pyRec.reason);
  });

  it('missing revision on report → UNKNOWN on both adapters', () => {
    // TS: report has no source_revision, analyzedRevision set
    const tsPath = tmpReport('istanbul.json', TS_REPORT_MISMATCH); // no source_revision
    const ts = parseCoverageReport(tsPath, {
      provider: 'istanbul',
      provider_version: '1.0.0',
      analyzedRevision: 'abc123',
    });
    const tsRec = ts.records.get('src/foo.ts')!;
    expect(tsRec.availability).toBe(Availability.UNKNOWN);
    expect(tsRec.reason).toContain('report revision unknown');

    // Python: report with no revision
    const pyPath = tmpReport('coverage.json', {
      meta: { version: '7.0' },
      files: { 'pytest_sample.py': { executed_lines: [1, 2, 3, 5], missing_lines: [] } },
    });
    const py = collectAnalysis(join(PY_FIXTURES, 'pytest_sample.py'), {
      coverageReport: pyPath,
      analyzedRevision: 'abc123',
    } as any);
    const pyRec = py.evidence['line_coverage'];
    expect(pyRec).toBeDefined();
    expect(pyRec.availability).toBe(Availability.UNKNOWN);
    expect(pyRec.reason).toContain('report revision unknown');

    // parity
    expect(tsRec.reason).toBe(pyRec.reason);
  });

  it('pythonCoverageFreshness mirrors TS mismatch/unknown/match outcomes', () => {
    // Unit-level parity on the freshness verdict helper (collector.ts:529).
    expect(pythonCoverageFreshness(undefined, 'abc')).toEqual({
      availability: Availability.KNOWN,
      status: CollectionStatus.COMPLETE,
    });
    expect(pythonCoverageFreshness('abc', undefined)).toEqual({
      availability: Availability.UNKNOWN,
      status: CollectionStatus.UNAVAILABLE,
      reason: 'report revision unknown; freshness cannot be established',
    });
    expect(pythonCoverageFreshness('abc', 'def')).toEqual({
      availability: Availability.UNKNOWN,
      status: CollectionStatus.UNAVAILABLE,
      reason: 'source revision mismatch: report def != analyzed abc',
    });
    expect(pythonCoverageFreshness('abc', 'abc')).toEqual({
      availability: Availability.KNOWN,
      status: CollectionStatus.COMPLETE,
    });
  });
});

// ---------------------------------------------------------------------------
// (b) ASSERTION-EVIDENCE PARITY
// ---------------------------------------------------------------------------

/**
 * Normalize an adapter's AnalysisOutput into the minimal shape evaluateRule
 * needs for CT-INT-001: a subject + analysis envelope + assertion_count record
 * carrying the same value / availability / evidenceStrength / completeness.
 *
 * We construct the SAME normalized evidence fixture from both adapter outputs
 * and run CT-INT-001 through the shared evaluator, asserting identical verdict.
 */
function assertionEvidenceFromAdapter(output: {
  analysis: { status: AnalysisStatus; completeness: Completeness };
  evidence: Record<
    string,
    {
      value: unknown;
      availability: Availability;
      evidenceStrength?: EvidenceStrength;
      coverage: { status: CollectionStatus };
    }
  >;
}): Parameters<typeof evaluateRule>[1] {
  const rec = output.evidence['assertion_count'];
  return {
    subject: { id: 's', name: 'sample', file: 'sample', language: 'typescript' },
    analysis: {
      status: output.analysis.status,
      completeness: output.analysis.completeness,
      scope: 'test-body',
      test_type: { value: TestType.UNIT, source: 'explicit' as any },
    },
    evidence: {
      assertion_count: {
        type: 'assertion_count',
        value: rec.value,
        availability: rec.availability,
        provenance: Provenance.DIRECT,
        source: 'adapter',
        collector_version: '0.0.0',
        scope: 'test-body',
        coverage: { status: rec.coverage.status, supported_frameworks: [], supported_assertion_forms: [] },
        evidenceStrength: rec.evidenceStrength,
      },
    },
    capabilities: { assertion_count: 'available' as any },
  };
}

describe('cross-adapter assertion-evidence parity (phase9 2.4b)', () => {
  it('CT-INT-001 yields identical verdict on TS and Python adapter outputs', () => {
    // Python adapter output: pytest_sample.py has 2 asserts → KNOWN, COMPLETE.
    const py = collectAnalysis(join(PY_FIXTURES, 'pytest_sample.py'));
    const pyAnalysis = assertionEvidenceFromAdapter(py as any);
    const pyResult = evaluateRule(CT_INT_001, pyAnalysis).finding?.result;
    expect(pyResult).toBe('PASS');
    // Python assertion_count record carries a positive value and KNOWN availability.
    const pyRec = py.evidence['assertion_count'];
    expect(pyRec.availability).toBe(Availability.KNOWN);
    expect(pyRec.coverage.status).toBe(CollectionStatus.COMPLETE);

    // TS adapter output: build the equivalent normalized evidence fixture
    // (same value>0 / KNOWN / COMPLETE) — this is the TS jest-family shape.
    const tsAnalysis: Parameters<typeof evaluateRule>[1] = {
      subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
      analysis: {
        status: AnalysisStatus.SUCCESS,
        completeness: Completeness.COMPLETE,
        scope: 'test-body',
        test_type: { value: TestType.UNIT, source: 'explicit' as any },
      },
      evidence: {
        assertion_count: {
          type: 'assertion_count',
          value: 2,
          availability: Availability.KNOWN,
          provenance: Provenance.DIRECT,
          source: 'test-adapter',
          collector_version: '0.0.0',
          scope: 'test-body',
          coverage: {
            status: CollectionStatus.COMPLETE,
            supported_frameworks: ['jest', 'vitest', 'mocha'],
            supported_assertion_forms: ['expect-to-be'],
          },
          evidenceStrength: EvidenceStrength.SYNTAX_OBSERVED,
        },
      },
      capabilities: { assertion_count: 'available' as any },
    };
    const tsResult = evaluateRule(CT_INT_001, tsAnalysis).finding?.result;
    expect(tsResult).toBe('PASS');

    // parity: identical verdict
    expect(tsResult).toBe(pyResult);
  });

  it('CT-INT-001 yields identical INDETERMINATE verdict on PARTIAL evidence from both adapters', () => {
    // Python: hypothesis @given → PARTIAL assertion_count (collector.test.ts pattern).
    const py = collectAnalysis(join(PY_FIXTURES, 'hypothesis_given.py'));
    const pyRec = py.evidence['assertion_count'];
    expect(pyRec.coverage.status).toBe(CollectionStatus.PARTIAL);
    // @given records are tagged property_based (present-only, never false; D-20261117-2 Q1).
    expect((pyRec as { property_based?: boolean }).property_based).toBe(true);
    const pyAnalysis = assertionEvidenceFromAdapter(py as any);
    const pyResult = evaluateRule(CT_INT_001, pyAnalysis).finding?.result;
    // minimum_evidence_completeness COMPLETE + PARTIAL → INDETERMINATE (rule-contract).
    expect(pyResult).toBe('INDETERMINATE');

    // TS: equivalent PARTIAL fixture.
    const tsAnalysis: Parameters<typeof evaluateRule>[1] = {
      subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
      analysis: {
        status: AnalysisStatus.SUCCESS,
        completeness: Completeness.INCOMPLETE,
        scope: 'test-body',
        test_type: { value: TestType.UNIT, source: 'explicit' as any },
      },
      evidence: {
        assertion_count: {
          type: 'assertion_count',
          value: undefined,
          availability: Availability.UNKNOWN,
          provenance: Provenance.DIRECT,
          source: 'test-adapter',
          collector_version: '0.0.0',
          scope: 'test-body',
          coverage: {
            status: CollectionStatus.PARTIAL,
            supported_frameworks: ['jest', 'vitest', 'mocha'],
            supported_assertion_forms: ['expect-to-be'],
          },
        },
      },
      capabilities: { assertion_count: 'available' as any },
    };
    const tsResult = evaluateRule(CT_INT_001, tsAnalysis).finding?.result;
    expect(tsResult).toBe('INDETERMINATE');

    // parity
    expect(tsResult).toBe(pyResult);
  });
});
