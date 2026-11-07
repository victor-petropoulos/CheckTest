/**
 * SARIF reporter tests (WP4.3, roadmap:1157-1184).
 *
 * The reporter serializes the engine's findings into a SARIF 2.1.0 log; it
 * never decides a verdict. These tests pin:
 *
 *   1. the SARIF envelope (deterministic, no clock);
 *   2. the result → level mapping, derived from the RULE RESULT only, never from
 *      the rule's declared severity (roadmap: severity ≠ result);
 *   3. location presence/absence (findings without a location get NO locations);
 *   4. the diagnostics decision — UNSUPPORTED/FAILED analysis states live on the
 *      RUN, never as a synthetic rule result.
 *
 * Structural validation is hand-rolled against the SARIF 2.1.0 schema facts
 * (schema fetched from json.schemastore.org; top required ["version","runs"];
 * result required ["message"]; level enum none|note|warning|error). No external
 * validator dependency: full schema validation is a documented limitation
 * (docs/limitations.md).
 */

import {
  SARIF_LEVEL_BY_RESULT,
  SARIF_SCHEMA_URI,
  SARIF_TOOL_NAME,
  SARIF_VERSION,
  toSarif,
} from '../../src/reporters/sarif';
import { evaluateRule, evaluateTests } from '../../src/core/evaluation';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../src/core/analysis';
import { Availability, CollectionStatus, EvidenceLocation, EvidenceRecord, Provenance } from '../../src/core/evidence';
import { RuleMetadata } from '../../src/core/rule';
import { RuleResult } from '../../src/core/result';
import { COLLECTOR_VERSION } from '../../src/adapters/typescript/support';
import { collectAnalysis } from '../../src/adapters/typescript/collector';
import { CT_INT_001 } from '../../src/rules/ct-int-001';
import { readFileSync } from 'fs';
import { join } from 'path';

/** Severity 'error' on purpose: the level must come from the RESULT, not this. */
const RULE: RuleMetadata = {
  id: 'CT-TEST-000',
  name: 'reporter-test-rule',
  category: 'integrity',
  description: 'Synthetic rule used only to pin the SARIF envelope.',
  applies_to: [TestType.UNIT],
  required_evidence: ['assertion_count'],
  analysis_scope: 'test-body',
  minimum_evidence_completeness: CollectionStatus.COMPLETE,
  unknown_evidence_policy: RuleResult.INDETERMINATE,
  conflicting_evidence_policy: RuleResult.INDETERMINATE,
  evaluation: { metric: 'assertion_count', pass_at_least: 1, fail_at_most: 0 },
  severity: 'error',
  status: 'active',
};

interface AnalysisOptions {
  completeness?: Completeness;
  testType?: TestType;
  value?: number;
  coverage?: CollectionStatus;
  location?: EvidenceLocation;
}

function analysis(status: AnalysisStatus, options: AnalysisOptions = {}): AnalysisOutput {
  const record: EvidenceRecord = {
    type: 'assertion_count',
    value: options.value ?? 1,
    availability: Availability.KNOWN,
    provenance: Provenance.DIRECT,
    source: 'test-adapter',
    collector_version: '0.0.0',
    scope: 'test-body',
    coverage: {
      status: options.coverage ?? CollectionStatus.COMPLETE,
      supported_frameworks: ['jest', 'vitest'],
      supported_assertion_forms: ['expect-to-be'],
    },
  };
  if (options.location !== undefined) {
    record.location = options.location;
  }
  return {
    subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
    analysis: {
      status,
      completeness:
        options.completeness ?? (status === AnalysisStatus.FAILED ? Completeness.INCOMPLETE : Completeness.COMPLETE),
      scope: 'test-body',
      test_type: { value: options.testType ?? TestType.UNIT, source: ClassificationSource.EXPLICIT },
    },
    evidence: { assertion_count: record },
    capabilities: { assertion_count: CapabilityStatus.AVAILABLE },
  };
}

/** The full log the CLI would emit, parsed. */
function sarif(output: AnalysisOutput, rule: RuleMetadata = RULE): Record<string, any> {
  return JSON.parse(toSarif(output, evaluateRule(rule, output), rule, evaluateTests(rule, output))) as Record<
    string,
    any
  >;
}

/** The first result of the single run. */
function result(output: AnalysisOutput, rule: RuleMetadata = RULE): Record<string, any> {
  return sarif(output, rule).runs[0].results[0];
}

describe('toSarif — envelope', () => {
  it('emits the SARIF 2.1.0 schema URI and version', () => {
    const log = sarif(analysis(AnalysisStatus.SUCCESS));
    expect(log.$schema).toBe(SARIF_SCHEMA_URI);
    expect(log.version).toBe(SARIF_VERSION);
    expect(log.version).toBe('2.1.0');
  });

  it('names the tool driver CheckTest with the COLLECTOR_VERSION', () => {
    const driver = sarif(analysis(AnalysisStatus.SUCCESS)).runs[0].tool.driver;
    expect(driver.name).toBe(SARIF_TOOL_NAME);
    expect(driver.name).toBe('CheckTest');
    expect(driver.version).toBe(COLLECTOR_VERSION);
  });

  it('declares the rule with id and short description', () => {
    const rules = sarif(analysis(AnalysisStatus.SUCCESS)).runs[0].tool.driver.rules;
    expect(rules).toEqual([
      {
        id: RULE.id,
        shortDescription: { text: RULE.name },
        properties: { severity: 'error', category: 'integrity' },
      },
    ]);
  });

  it('defaults evaluations to a single subject-level scope (legacy envelope)', () => {
    const output = analysis(AnalysisStatus.SUCCESS);
    const log = JSON.parse(toSarif(output, evaluateRule(RULE, output), RULE)) as Record<string, any>;
    // Same absent-vs-empty fallback as toJson (shared evaluationScopes).
    expect(log.runs[0].results).toHaveLength(1);
    expect(log.runs[0].results[0].properties.result).toBe(RuleResult.PASS);
  });
});

describe('toSarif — result mapping (level from RESULT only)', () => {
  it('PASS → level none, properties.result PASS', () => {
    const r = result(analysis(AnalysisStatus.SUCCESS, { value: 1 }));
    expect(r.ruleId).toBe(RULE.id);
    expect(r.level).toBe('none');
    expect(r.properties.result).toBe(RuleResult.PASS);
    expect(r.message.text).toContain('assertion_count=1');
  });

  it('FAIL → level warning, properties.result FAIL', () => {
    const r = result(analysis(AnalysisStatus.SUCCESS, { value: 0 }));
    expect(r.level).toBe('warning');
    expect(r.properties.result).toBe(RuleResult.FAIL);
  });

  it('INDETERMINATE → level note, properties.result INDETERMINATE', () => {
    // PARTIAL coverage is below the rule's COMPLETE minimum → step 4 INDETERMINATE.
    const r = result(analysis(AnalysisStatus.SUCCESS, { coverage: CollectionStatus.PARTIAL }));
    expect(r.level).toBe('note');
    expect(r.properties.result).toBe(RuleResult.INDETERMINATE);
  });

  it('N/A → level none, properties.result N/A', () => {
    // Concrete type outside applies_to → applicability N/A (step 2).
    const r = result(analysis(AnalysisStatus.SUCCESS, { testType: TestType.COMPONENT }));
    expect(r.level).toBe('none');
    expect(r.properties.result).toBe(RuleResult.N_A);
  });

  it('is a documented, total table over every RuleResult (valid SARIF levels only)', () => {
    expect(SARIF_LEVEL_BY_RESULT).toEqual({
      [RuleResult.FAIL]: 'warning',
      [RuleResult.INDETERMINATE]: 'note',
      [RuleResult.PASS]: 'none',
      [RuleResult.N_A]: 'none',
    });
    // Every mapped level is in the SARIF 2.1.0 enum — never 'info'.
    const valid = ['none', 'note', 'warning', 'error'];
    for (const level of Object.values(SARIF_LEVEL_BY_RESULT)) {
      expect(valid).toContain(level);
    }
  });
});

describe('toSarif — severity is not conflated with result', () => {
  it('a rule of severity "error" that FAILs maps to level "warning", keeping severity separate', () => {
    const log = sarif(analysis(AnalysisStatus.SUCCESS, { value: 0 }));
    const r = log.runs[0].results[0];
    // The rule declares severity error…
    expect(log.runs[0].tool.driver.rules[0].properties.severity).toBe('error');
    // …but the result level comes from the RuleResult, NOT the severity.
    expect(r.level).toBe('warning');
    expect(r.properties.result).toBe('FAIL');
  });
});

describe('toSarif — locations', () => {
  it('emits physicalLocation with file uri and region startLine when the finding has one', () => {
    const location = { file: 'sample.test.ts', line: 7, column: 3 };
    const r = result(analysis(AnalysisStatus.SUCCESS, { location }));
    expect(r.locations).toEqual([
      {
        physicalLocation: {
          artifactLocation: { uri: 'sample.test.ts' },
          region: { startLine: 7, startColumn: 3 },
        },
      },
    ]);
  });

  it('omits startColumn when the finding location has no column', () => {
    const r = result(analysis(AnalysisStatus.SUCCESS, { location: { file: 'sample.test.ts', line: 5 } }));
    expect(r.locations[0].physicalLocation.region).toEqual({ startLine: 5 });
  });

  it('emits NO locations key when the finding has none (never fabricated)', () => {
    const r = result(analysis(AnalysisStatus.SUCCESS));
    expect(r).not.toHaveProperty('locations');
  });
});

describe('toSarif — determinism', () => {
  it('two runs on identical input are byte-identical', () => {
    const output = analysis(AnalysisStatus.SUCCESS, { location: { file: 'sample.test.ts', line: 5 } });
    const rule = RULE;
    const first = toSarif(output, evaluateRule(rule, output), rule, evaluateTests(rule, output));
    const second = toSarif(output, evaluateRule(rule, output), rule, evaluateTests(rule, output));
    expect(second).toBe(first);
  });
});

describe('toSarif — diagnostics are not rule findings', () => {
  it('a FAILED analysis yields an empty results[] and records the state on the run', () => {
    const log = sarif(analysis(AnalysisStatus.FAILED));
    expect(log.runs[0].results).toEqual([]);
    expect(log.runs[0].properties.analysisStatus).toBe(AnalysisStatus.FAILED);
    expect(log.runs[0].properties.evaluationStatus).toBe('FAILED');
  });

  it('an UNSUPPORTED analysis keeps its INDETERMINATE rule finding AND records the state on the run', () => {
    const log = sarif(analysis(AnalysisStatus.UNSUPPORTED));
    expect(log.runs[0].properties.analysisStatus).toBe(AnalysisStatus.UNSUPPORTED);
    // The INDETERMINATE here is a genuine rule verdict, not a stand-in diagnostic.
    expect(log.runs[0].results).toHaveLength(1);
    expect(log.runs[0].results[0].properties.result).toBe(RuleResult.INDETERMINATE);
  });
});

describe('toSarif — structural validation (hand-rolled SARIF shape)', () => {
  /** Minimal shape check against the pinned SARIF 2.1.0 required keys. */
  function assertSarifShape(log: any): void {
    expect(typeof log.version).toBe('string');
    expect(Array.isArray(log.runs)).toBe(true);
    expect(log.runs.length).toBeGreaterThan(0);
    const run = log.runs[0];
    expect(typeof run.tool.driver.name).toBe('string');
    expect(Array.isArray(run.tool.driver.rules)).toBe(true);
    for (const rule of run.tool.driver.rules) {
      expect(typeof rule.id).toBe('string');
    }
    expect(Array.isArray(run.results)).toBe(true);
    for (const res of run.results) {
      expect(typeof res.message.text).toBe('string');
      expect(res.message.text.length).toBeGreaterThan(0);
      if (res.locations !== undefined) {
        for (const loc of res.locations) {
          expect(typeof loc.physicalLocation.artifactLocation.uri).toBe('string');
          expect(Number.isInteger(loc.physicalLocation.region.startLine)).toBe(true);
        }
      }
    }
  }

  it('a PASS log satisfies the required SARIF 2.1.0 keys', () => {
    assertSarifShape(sarif(analysis(AnalysisStatus.SUCCESS, { location: { file: 'sample.test.ts', line: 2 } })));
  });

  it('a FAILED log (empty results) still satisfies the required SARIF 2.1.0 keys', () => {
    assertSarifShape(sarif(analysis(AnalysisStatus.FAILED)));
  });
});

describe('toSarif — representative golden (case-24, real collector pipeline)', () => {
  it('matches the committed byte-exact SARIF golden', () => {
    const root = join(__dirname, '..', 'fixtures', 'ct-int-001');
    const file = join(root, 'case-24-vitest-standard', 'sample.test.ts');
    const output = collectAnalysis(file, TestType.UNIT);
    // The collector stamps the absolute input path into the location uri; the
    // golden normalizes the fixture root to a token so it stays machine-portable.
    const actual = toSarif(output, evaluateRule(CT_INT_001, output), CT_INT_001, evaluateTests(CT_INT_001, output))
      .split(root)
      .join('<fixture-root>');
    const golden = readFileSync(join(__dirname, 'fixtures', 'case-24.sarif.json'), 'utf8');
    expect(actual).toBe(golden);
  });
});
