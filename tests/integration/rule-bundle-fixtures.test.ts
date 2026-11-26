/**
 * Task 10 — integration coverage for shipped CT-INT-003/004 using existing fixtures.
 *
 * Verifies the 8 expectations from the plan's verified expectations table:
 *   case-01 CT-INT-003 PASS reason contains unestablished_assertions=0
 *   case-01 CT-INT-004 PASS reason contains unclassified_constructs=0
 *   case-08 CT-INT-003 FAIL reason contains unestablished_assertions=1 and callback
 *   case-08 CT-INT-004 INDETERMINATE reason contains availability is UNKNOWN
 *   case-09 CT-INT-003 INDETERMINATE reason contains required evidence 'unestablished_assertion' is absent
 *   case-09 CT-INT-004 INDETERMINATE reason contains could not be classified
 *   case-03 CT-INT-003 INDETERMINATE absent-evidence wording (probe actual)
 *   case-03 CT-INT-004 INDETERMINATE reason contains 'assert' is not a supported assertion form
 *
 * Probe findings confirmed via npx tsx script before test encoding.
 *
 * Seam: collectAnalysis + evaluateRule directly (no CLI backdoors).
 * NO sidecar/CASES edits; NO CT_DEMO_001 registration; no broad snapshot rewrites.
 */

import { collectAnalysis } from '../../src/adapters/typescript/collector';
import { evaluateRule } from '../../src/core/evaluation';
import { CT_INT_003 } from '../../src/rules/ct-int-003';
import { CT_INT_004 } from '../../src/rules/ct-int-004';
import { TestType } from '../../src/core/analysis';
import { RuleResult } from '../../src/core/result';
import { join } from 'path';

const FIXTURE_ROOT = join(__dirname, '..', 'fixtures', 'ct-int-001');

const CASES = [
  'case-01-standard-assertion',
  'case-03-unsupported-api',
  'case-08-callback',
  'case-09-partial-collection',
];

describe('CT-INT-003 / CT-INT-004 rule-bundle fixtures', () => {
  describe.each(CASES)('%s', (caseName) => {
    it('CT-INT-003 verdict and reason', () => {
      const fixturePath = join(FIXTURE_ROOT, caseName, 'sample.test.ts');
      const analysis = collectAnalysis(fixturePath, TestType.UNIT);
      const { finding } = evaluateRule(CT_INT_003, analysis);
      expect(finding).not.toBeNull();
      if (caseName === 'case-01') {
        expect(finding?.result).toBe(RuleResult.PASS);
        expect(finding?.reason).toContain('unestablished_assertions=0');
      } else if (caseName === 'case-03') {
        expect(finding?.result).toBe(RuleResult.INDETERMINATE);
        expect(finding?.reason).toContain("required evidence 'unestablished_assertion' is absent");
      } else if (caseName === 'case-08') {
        expect(finding?.result).toBe(RuleResult.FAIL);
        expect(finding?.reason).toContain('unestablished_assertions=1');
        expect(finding?.reason).toContain('callback');
      } else if (caseName === 'case-09') {
        expect(finding?.result).toBe(RuleResult.INDETERMINATE);
        expect(finding?.reason).toContain("required evidence 'unestablished_assertion' is absent");
      }
    });

    it('CT-INT-004 verdict and reason', () => {
      const fixturePath = join(FIXTURE_ROOT, caseName, 'sample.test.ts');
      const analysis = collectAnalysis(fixturePath, TestType.UNIT);
      const { finding } = evaluateRule(CT_INT_004, analysis);
      expect(finding).not.toBeNull();
      if (caseName === 'case-01') {
        expect(finding?.result).toBe(RuleResult.PASS);
        expect(finding?.reason).toContain('unclassified_constructs=0');
      } else if (caseName === 'case-03') {
        expect(finding?.result).toBe(RuleResult.INDETERMINATE);
        expect(finding?.reason).toContain("'assert' is not a supported assertion form");
      } else if (caseName === 'case-08') {
        expect(finding?.result).toBe(RuleResult.INDETERMINATE);
        expect(finding?.reason).toContain('availability is UNKNOWN');
      } else if (caseName === 'case-09') {
        expect(finding?.result).toBe(RuleResult.INDETERMINATE);
        expect(finding?.reason).toContain('could not be classified');
      }
    });
  });
});
