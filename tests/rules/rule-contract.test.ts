/**
 * WP2.1 tester-lite — rule contract tests (plan task 24).
 *
 * Contract asserted for every rule in this repo's rule set, applied through the
 * public seams only: `validateRule` (pure, no map mutation), `registerRule`,
 * `getRule`, `evaluateRule`, and the CLI `main`. No src file is touched.
 *
 * Coverage (plan task 24 acceptance):
 *   - describe.each over the rule set: full contract for every entry
 *   - malformed definition rejected (validateRule + registerRule throwing)
 *   - incomplete definition rejected
 *   - demo rule excluded from production CLI lookup (--rule)
 *   - determinism: same input twice → identical result
 *   - no rule evaluates evidence outside its declared scope
 *   - throwaway rule: the untouched engine decides it without per-rule code
 *   - task 66: the six validateRule error branches that had no coverage, plus
 *     the behaviour-parity pin of the full, ordered error list
 *   - task 5.4: the RuleStatus lifecycle contract — enum membership for
 *     `status`, and the DEPRECATED ⇒ deprecatedSince requirement
 *
 * CT-INT-001 and CT-DEMO-001 must both pass validateRule; so must every
 * other shipped rule.
 */

import { join } from 'path';

import { evaluateRule } from '../../src/core/evaluation';
import {
  AnalysisOutput,
  AnalysisStatus,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../src/core/analysis';
import { Availability, CollectionStatus, EvidenceRecord, EvidenceType, Provenance } from '../../src/core/evidence';
import { EvaluationStatus, RuleResult } from '../../src/core/result';
import { RuleEvaluation, RuleMetadata, RuleStatus, hasLocalDecisionHook } from '../../src/core/rule';
import { CT_INT_001 } from '../../src/rules/ct-int-001';
import { CT_INT_003 } from '../../src/rules/ct-int-003';
import { CT_INT_004 } from '../../src/rules/ct-int-004';
import { CT_COV_001 } from '../../src/rules/ct-cov-001';
import { CT_MUT_001 } from '../../src/rules/ct-mut-001';
import { CT_DEMO_001 } from '../../src/rules/ct-demo-001';
import { derivedAppliesTo, getRule, registerRule, validateRule } from '../../src/rules/registry';

/** Every rule in this repo's rule set. CT-DEMO-001 is demo-only; CT-INT-001 is
 * the only rule src/cli.ts registers into the production CLI. */
const CONTRACT_RULES: RuleMetadata[] = [CT_INT_001];

/** Every rule shipped in src/rules — all six must pass validateRule. */
const SHIPPED_RULES: RuleMetadata[] = [CT_INT_001, CT_INT_003, CT_INT_004, CT_COV_001, CT_MUT_001, CT_DEMO_001];

const FIXTURE = join(__dirname, '..', 'fixtures', 'ct-int-001', 'case-01-standard-assertion', 'sample.test.ts');

function record(value: unknown = 2): EvidenceRecord {
  return {
    type: 'assertion_count',
    value,
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
  };
}

/** A valid analysis for `rule`: its first declared test type, complete
 * coverage, KNOWN availability, value above pass_at_least → PASS. */
function analysisFor(rule: RuleMetadata): AnalysisOutput {
  const testType = rule.applies_to[0];
  return {
    subject: { id: 's', name: 'sample', file: 'sample.test.ts', language: 'typescript' },
    analysis: {
      status: AnalysisStatus.SUCCESS,
      completeness: Completeness.COMPLETE,
      scope: rule.analysis_scope,
      test_type: { value: testType, source: ClassificationSource.EXPLICIT },
    },
    evidence: { assertion_count: record() },
    capabilities: { assertion_count: CapabilityStatus.AVAILABLE },
  };
}

describe('shipped rules validate cleanly', () => {
  it.each(CONTRACT_RULES)('%s passes validateRule with no errors', (rule) => {
    expect(validateRule(rule)).toEqual([]);
  });
});

describe('malformed definitions rejected', () => {
  const base = (): RuleMetadata => ({ ...CT_INT_001 });

  it.each([
    ['id does not match CT-<CAT>-<NNN>', { id: 'bad-id' }],
    ['id lowercase category', { id: 'ct-int-001' }],
    ['name empty', { name: '' }],
    ['category empty', { category: '' }],
    ['description empty', { description: '' }],
    ['analysis_scope empty', { analysis_scope: '' }],
    ['applies_to empty', { applies_to: [] }],
    ['applies_to contains UNKNOWN', { applies_to: [TestType.UNKNOWN] }],
    ['applies_to has duplicate', { applies_to: [TestType.UNIT, TestType.UNIT] }],
    ['required_evidence empty', { required_evidence: [] }],
    [
      'minimum_evidence_completeness invalid',
      { minimum_evidence_completeness: 'bogus' as unknown as CollectionStatus },
    ],
    ['unknown_evidence_policy invalid', { unknown_evidence_policy: 'bogus' as unknown as RuleResult }],
    [
      'pass_at_least not > fail_at_most',
      { evaluation: { metric: 'assertion_count', pass_at_least: 0, fail_at_most: 1 } },
    ],
    ['severity invalid', { severity: 'bogus' as unknown as 'error' | 'warning' | 'info' }],
    ['status invalid', { status: 'bogus' as unknown as 'active' | 'draft' | 'deprecated' }],
    ['rationale empty when present', { rationale: '' }],
    ['limitations empty when present', { limitations: '' }],
  ])('%s rejected by validateRule', (_label, overrides) => {
    const errors = validateRule({ ...base(), ...overrides } as RuleMetadata);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('registerRule throws for a malformed definition', () => {
    expect(() => registerRule({ ...base(), id: 'NOT-A-RULE-001' })).toThrow(/Invalid rule definition NOT-A-RULE-001/);
  });
});

describe('incomplete definitions rejected', () => {
  const base = (): RuleMetadata => ({ ...CT_INT_001 });

  it('missing applies_to is rejected', () => {
    const errors = validateRule({ ...base(), applies_to: undefined as unknown as TestType[] });
    expect(errors).toContain('applies_to must list at least one test type');
  });

  it('missing required_evidence is rejected', () => {
    const errors = validateRule({ ...base(), required_evidence: undefined as unknown as EvidenceType[] });
    expect(errors).toContain('required_evidence must list at least one evidence type');
  });

  it('registerRule throws on an incomplete definition', () => {
    expect(() => registerRule({ ...base(), required_evidence: [] })).toThrow(/Invalid rule definition CT-INT-001/);
  });
});

describe('CT-DEMO-001 excluded from production CLI lookup (--rule)', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let err = '';

  beforeEach(() => {
    err = '';
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      err += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('--rule CT-DEMO-001 is unknown: exit 1, no report', () => {
    const code = require('../../src/cli').main(['--rule', 'CT-DEMO-001', '--test', FIXTURE]);
    expect(code).toBe(1);
    expect(err).toContain("unknown --rule 'CT-DEMO-001'");
  });

  it('--rule CT-INT-001 is accepted by the production CLI', () => {
    const code = require('../../src/cli').main(['--rule', 'CT-INT-001', '--test', FIXTURE]);
    expect(code).toBe(0);
    expect(err).toBe('');
  });
});

describe.each(CONTRACT_RULES.map((rule) => [rule.id, rule] as [string, RuleMetadata]))(
  'rule contract: %s',
  (_id, rule) => {
    it('can be registered and looked up by id', () => {
      registerRule(rule);
      expect(getRule(rule.id)).toBe(rule);
    });

    it('evaluation.metric is declared in required_evidence — a rule never thresholds evidence it did not require', () => {
      expect(rule.required_evidence).toContain(rule.evaluation.metric);
    });

    it('is deterministic: identical input → identical result', () => {
      const input = analysisFor(rule);
      const first = evaluateRule(rule, input);
      const second = evaluateRule(rule, input);
      expect(second).toEqual(first);
      expect(first.status).toBe(EvaluationStatus.EVALUATED);
    });

    it('evaluates only its declared evidence: unrelated evidence yields INDETERMINATE, never a metric verdict', () => {
      const unrelated: EvidenceRecord = { ...record(), type: 'unrelated_metric' };
      const input = { ...analysisFor(rule), evidence: { unrelated_metric: unrelated } };
      const result = evaluateRule(rule, input);
      expect(result.status).toBe(EvaluationStatus.EVALUATED);
      expect(result.finding?.result).toBe(RuleResult.INDETERMINATE);
      expect(result.finding?.reason).toContain('absent');
    });
  },
);

describe('throwaway rule exercises the untouched engine', () => {
  it('decide() needs no per-rule code: a newly added rule is decided by the same ordered guards', () => {
    const throwaway: RuleMetadata = {
      ...CT_INT_001,
      id: 'CT-THROW-001',
      name: 'throwaway-contract-rule',
      description: 'a rule that exists only in this test',
    };
    expect(validateRule(throwaway)).toEqual([]);
    registerRule(throwaway);
    expect(getRule('CT-THROW-001')).toBe(throwaway);

    const result = evaluateRule(throwaway, analysisFor(throwaway));
    expect(result.status).toBe(EvaluationStatus.EVALUATED);
    expect(result.finding?.rule_id).toBe('CT-THROW-001');
    expect(result.finding?.result).toBe(RuleResult.PASS);
  });
});

/**
 * Task 66 — the six validateRule error branches that NO test exercised before
 * the per-aspect decomposition (pre-fix src/rules/registry.ts:52, :69, :73,
 * :90, :96, :102 — see reports/RETRO-CHECKCHANGE-PHASE2.md). Each is pinned to
 * its exact error string.
 */
describe('validateRule — error branches with no coverage before task 66', () => {
  const base = (): RuleMetadata => ({ ...CT_INT_001 });

  it('rejects an unknown test type in applies_to', () => {
    const errors = validateRule({
      ...base(),
      applies_to: ['NOT_A_TYPE' as unknown as TestType],
    });
    expect(errors).toEqual(['applies_to contains unknown test type NOT_A_TYPE']);
  });

  it('rejects an empty evidence type in required_evidence', () => {
    const errors = validateRule({ ...base(), required_evidence: ['' as unknown as EvidenceType, 'assertion_count'] });
    expect(errors).toEqual(['required_evidence contains an empty evidence type']);
  });

  it('rejects a duplicate evidence type in required_evidence', () => {
    const errors = validateRule({
      ...base(),
      required_evidence: ['assertion_count', 'assertion_count'],
    });
    expect(errors).toEqual(['required_evidence contains a duplicate evidence type']);
  });

  it('rejects a non-object evaluation', () => {
    const errors = validateRule({
      ...base(),
      evaluation: undefined as unknown as RuleEvaluation,
    });
    expect(errors).toEqual(['evaluation must be an object with metric, pass_at_least and fail_at_most']);
  });

  it('rejects an empty evaluation metric', () => {
    const errors = validateRule({
      ...base(),
      evaluation: { metric: '' as unknown as EvidenceType, pass_at_least: 1, fail_at_most: 0 },
    });
    expect(errors).toEqual(['evaluation.metric must be a non-empty string']);
  });

  it('rejects a non-finite threshold', () => {
    const errors = validateRule({
      ...base(),
      evaluation: { metric: 'assertion_count', pass_at_least: Number.NaN, fail_at_most: 0 },
    });
    expect(errors).toEqual(['evaluation.pass_at_least must be a finite number (got NaN)']);
  });
});

/**
 * Task 66 — behaviour parity. The strings and their order below were captured
 * from the PRE-decomposition implementation (the unmodified
 * src/rules/registry.ts at 7d71c7b) and are a public contract:
 * `registerRule` throws them joined with '; '.
 */
describe('validateRule — behaviour parity with the pre-decomposition implementation', () => {
  const MALFORMED: RuleMetadata = {
    id: 'bad-id',
    name: '',
    category: '',
    description: '',
    analysis_scope: '',
    applies_to: ['NOT_A_TYPE' as unknown as TestType, TestType.UNKNOWN, TestType.UNIT, TestType.UNIT],
    required_evidence: ['' as unknown as EvidenceType, 'assertion_count', 'assertion_count'],
    minimum_evidence_completeness: 'bogus' as unknown as CollectionStatus,
    unknown_evidence_policy: 'bogus' as unknown as RuleResult,
    conflicting_evidence_policy: 'bogus' as unknown as RuleResult,
    evaluation: {
      metric: '' as unknown as EvidenceType,
      pass_at_least: Number.NaN,
      fail_at_most: Number.POSITIVE_INFINITY,
    },
    severity: 'bogus' as unknown as 'error' | 'warning' | 'info',
    status: 'bogus' as unknown as 'active' | 'draft' | 'deprecated',
    rationale: '',
    limitations: '',
    docsUrl: '',
  };

  const MALFORMED_ERRORS = [
    'id must match ^CT-[A-Z]+-[0-9]{3}$ (got bad-id)',
    'name must be a non-empty string',
    'category must be a non-empty string',
    'description must be a non-empty string',
    'analysis_scope must be a non-empty string',
    'applies_to contains unknown test type NOT_A_TYPE',
    'applies_to must not contain UNKNOWN — an unknown type is INDETERMINATE, not a rule input',
    'applies_to contains a duplicate test type',
    'required_evidence contains an empty evidence type',
    'required_evidence contains a duplicate evidence type',
    'minimum_evidence_completeness must be a CollectionStatus (got bogus)',
    'unknown_evidence_policy must be a RuleResult (got bogus)',
    'conflicting_evidence_policy must be a RuleResult (got bogus)',
    'evaluation.metric must be a non-empty string',
    'evaluation.pass_at_least must be a finite number (got NaN)',
    'evaluation.fail_at_most must be a finite number (got Infinity)',
    'severity must be error|warning|info (got bogus)',
    'status must be active|draft|deprecated (got bogus)',
    'rationale, when present, must be a non-empty string',
    'limitations, when present, must be a non-empty string',
    'docsUrl, when present, must be a non-empty string',
  ];

  it('reports every defect of a malformed rule — same strings, same order', () => {
    expect(validateRule(MALFORMED)).toEqual(MALFORMED_ERRORS);
  });

  it('registerRule throws the same aggregate message — same strings, same order', () => {
    let thrown: Error | undefined;
    try {
      registerRule(MALFORMED);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toBe(
      'Invalid rule definition bad-id: id must match ^CT-[A-Z]+-[0-9]{3}$ (got bad-id); ' +
        'name must be a non-empty string; category must be a non-empty string; ' +
        'description must be a non-empty string; analysis_scope must be a non-empty string; ' +
        'applies_to contains unknown test type NOT_A_TYPE; ' +
        'applies_to must not contain UNKNOWN — an unknown type is INDETERMINATE, not a rule input; ' +
        'applies_to contains a duplicate test type; ' +
        'required_evidence contains an empty evidence type; ' +
        'required_evidence contains a duplicate evidence type; ' +
        'minimum_evidence_completeness must be a CollectionStatus (got bogus); ' +
        'unknown_evidence_policy must be a RuleResult (got bogus); ' +
        'conflicting_evidence_policy must be a RuleResult (got bogus); ' +
        'evaluation.metric must be a non-empty string; ' +
        'evaluation.pass_at_least must be a finite number (got NaN); ' +
        'evaluation.fail_at_most must be a finite number (got Infinity); ' +
        'severity must be error|warning|info (got bogus); ' +
        'status must be active|draft|deprecated (got bogus); ' +
        'rationale, when present, must be a non-empty string; ' +
        'limitations, when present, must be a non-empty string; ' +
        'docsUrl, when present, must be a non-empty string',
    );
  });

  it('keeps the ordering between required_evidence and evaluation.metric', () => {
    expect(validateRule({ ...CT_INT_001, required_evidence: [42 as unknown as EvidenceType] })).toEqual([
      'required_evidence contains an empty evidence type',
      'evaluation.metric "assertion_count" is not in required_evidence',
    ]);
  });

  it('accepts a well-formed rule', () => {
    expect(validateRule(CT_INT_001)).toEqual([]);
  });
});

/**
 * Task 66 — the remaining value-shape branches of the per-aspect validators.
 */
describe('validateRule — remaining value-shape branches', () => {
  const base = (): RuleMetadata => ({ ...CT_INT_001 });

  it('rejects a non-string id', () => {
    expect(validateRule({ ...base(), id: 42 as unknown as string })).toEqual([
      'id must match ^CT-[A-Z]+-[0-9]{3}$ (got 42)',
    ]);
  });

  it('rejects a non-string required text field', () => {
    expect(validateRule({ ...base(), name: 7 as unknown as string })).toEqual(['name must be a non-empty string']);
  });

  it('rejects a null evaluation', () => {
    expect(validateRule({ ...base(), evaluation: null as unknown as RuleEvaluation })).toEqual([
      'evaluation must be an object with metric, pass_at_least and fail_at_most',
    ]);
  });

  it('rejects a non-string evaluation metric', () => {
    expect(
      validateRule({
        ...base(),
        evaluation: { metric: 7 as unknown as EvidenceType, pass_at_least: 1, fail_at_most: 0 },
      }),
    ).toEqual(['evaluation.metric must be a non-empty string']);
  });

  it('rejects a metric that is not among the required evidence', () => {
    expect(
      validateRule({
        ...base(),
        evaluation: { metric: 'other_metric' as unknown as EvidenceType, pass_at_least: 1, fail_at_most: 0 },
      }),
    ).toEqual(['evaluation.metric "other_metric" is not in required_evidence']);
  });

  it('rejects a non-finite fail_at_most', () => {
    expect(
      validateRule({
        ...base(),
        evaluation: {
          metric: 'assertion_count',
          pass_at_least: 1,
          fail_at_most: Number.POSITIVE_INFINITY,
        },
      }),
    ).toEqual(['evaluation.fail_at_most must be a finite number (got Infinity)']);
  });

  it('rejects thresholds that are not strictly ordered', () => {
    expect(
      validateRule({
        ...base(),
        evaluation: { metric: 'assertion_count', pass_at_least: 1, fail_at_most: 1 },
      }),
    ).toEqual(['evaluation.pass_at_least must be greater than evaluation.fail_at_most']);
  });

  it('rejects a non-string advisory field', () => {
    expect(validateRule({ ...base(), rationale: 7 as unknown as string })).toEqual([
      'rationale, when present, must be a non-empty string',
    ]);
  });

  it('registerRule omits the id from the aggregate message when the id is not a string', () => {
    let thrown: Error | undefined;
    try {
      registerRule({ ...base(), id: 42 as unknown as string });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toBe('Invalid rule definition: id must match ^CT-[A-Z]+-[0-9]{3}$ (got 42)');
  });
});

/**
 * Plan task 5.4 — the RuleStatus lifecycle contract, enforced by
 * validateRule/registerRule. `status` is OPERATIONAL, not advisory: a DRAFT
 * rule is excluded from the default run and is evaluated only when it is named
 * via --rule; a DEPRECATED rule still runs until removal and must name the
 * version it was deprecated in.
 */
describe('validateRule — RuleStatus lifecycle contract (plan task 5.4)', () => {
  const DEPRECATED_SINCE_ERROR = 'deprecatedSince must be a non-empty string when status is deprecated';

  const base = (): RuleMetadata => ({ ...CT_INT_001 });

  const deprecated = (overrides: Partial<RuleMetadata> = {}): RuleMetadata => ({
    ...base(),
    status: RuleStatus.DEPRECATED,
    ...overrides,
  });

  it('rejects a DEPRECATED rule with no deprecatedSince', () => {
    expect(validateRule(deprecated())).toEqual([DEPRECATED_SINCE_ERROR]);
  });

  it('rejects a DEPRECATED rule with an empty deprecatedSince', () => {
    expect(validateRule(deprecated({ deprecatedSince: '' }))).toEqual([DEPRECATED_SINCE_ERROR]);
  });

  it('rejects a DEPRECATED rule with a whitespace-only deprecatedSince', () => {
    expect(validateRule(deprecated({ deprecatedSince: '   ' }))).toEqual([DEPRECATED_SINCE_ERROR]);
  });

  it('accepts a DEPRECATED rule that carries deprecatedSince', () => {
    expect(validateRule(deprecated({ deprecatedSince: '1.11.0' }))).toEqual([]);
  });

  it('registerRule throws for a DEPRECATED rule with no deprecatedSince', () => {
    expect(() => registerRule({ ...deprecated(), id: 'CT-DEPRECATED-001' })).toThrow(
      /Invalid rule definition CT-DEPRECATED-001/,
    );
    expect(() => registerRule({ ...deprecated(), id: 'CT-DEPRECATED-001' })).toThrow(DEPRECATED_SINCE_ERROR);
  });

  it('rejects a status outside the RuleStatus enum', () => {
    const errors = validateRule({ ...base(), status: 'bogus' as unknown as RuleStatus });
    expect(errors).toEqual(['status must be active|draft|deprecated (got bogus)']);
  });

  it('accepts every RuleStatus member that carries its required metadata', () => {
    expect(validateRule({ ...base(), status: RuleStatus.ACTIVE })).toEqual([]);
    expect(validateRule({ ...base(), status: RuleStatus.DRAFT })).toEqual([]);
    expect(validateRule(deprecated({ deprecatedSince: '1.11.0' }))).toEqual([]);
  });
});

/**
 * Task 3 — derivedAppliesTo tiers and registerRule derived-mismatch rejection.
 * These tests verify that registerRule rejects rules whose applies_to does not
 * match the derived applicability set for their category, and that the error
 * message exactly matches the shape from src/rules/registry.ts:197-199.
 */

describe('derivedAppliesTo tiers and registerRule mismatch', () => {
  it('derivedAppliesTo integrity returns all five concrete types', () => {
    const derived = derivedAppliesTo('integrity');
    expect(derived).toEqual(['UNIT', 'COMPONENT', 'INTEGRATION', 'CONTRACT', 'E2E']);
  });

  it('derivedAppliesTo coverage returns all five concrete types', () => {
    const derived = derivedAppliesTo('coverage');
    expect(derived).toEqual(['UNIT', 'COMPONENT', 'INTEGRATION', 'CONTRACT', 'E2E']);
  });

  it('derivedAppliesTo mutation returns UNIT and COMPONENT', () => {
    const derived = derivedAppliesTo('mutation');
    expect(derived).toEqual(['UNIT', 'COMPONENT']);
  });

  it('derivedAppliesTo unknown category falls back to all five concrete types', () => {
    const derived = derivedAppliesTo('unknown-category');
    expect(derived).toEqual(['UNIT', 'COMPONENT', 'INTEGRATION', 'CONTRACT', 'E2E']);
  });

  it('registerRule throws for valid structure but wrong applies_to (CT_DEMO_001)', () => {
    // CT_DEMO_001 has category 'integrity' but applies_to [TestType.UNIT]
    // derivedAppliesTo('integrity') = [UNIT, COMPONENT, INTEGRATION, CONTRACT, E2E]
    // so registration must throw with the derived-mismatch message
    expect(() => registerRule(CT_DEMO_001)).toThrow(
      'Invalid rule definition CT-DEMO-001: applies_to must match derived applicability for category "integrity" (UNIT, COMPONENT, INTEGRATION, CONTRACT, E2E) (got UNIT)',
    );
  });

  it('registerRule throws for valid structure but wrong applies_to (mutation rule with wrong types)', () => {
    // A rule with category 'mutation' but applies_to [TestType.INTEGRATION]
    // derivedAppliesTo('mutation') = [UNIT, COMPONENT]
    const badMutationRule = {
      ...CT_MUT_001,
      id: 'CT-BAD-001',
      name: 'bad mutation rule',
      applies_to: [TestType.INTEGRATION],
    } as unknown as RuleMetadata;
    expect(() => registerRule(badMutationRule)).toThrow(
      'Invalid rule definition CT-BAD-001: applies_to must match derived applicability for category "mutation" (UNIT, COMPONENT) (got INTEGRATION)',
    );
  });
});

describe('all shipped rules validate cleanly', () => {
  it.each(SHIPPED_RULES.map((rule) => [rule.id, rule] as [string, RuleMetadata]))(
    '%s passes validateRule with no errors',
    (_id, rule) => {
      expect(validateRule(rule)).toEqual([]);
    },
  );
});

describe('threshold-inert metadata contract', () => {
  it('every rule with a local_decision hook declares thresholds_inert === true', () => {
    for (const rule of SHIPPED_RULES) {
      if (hasLocalDecisionHook(rule)) {
        expect(rule.thresholds_inert).toBe(true);
      }
    }
  });
});
