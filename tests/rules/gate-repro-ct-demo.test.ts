/**
 * Critic-support gate repro for reviewer F1 (plan 2026-11-26-test-type-category-applicability.md).
 *
 * Adapted (jest) from the frozen artifact
 * `.opencode/scratch/test-type-applicability-remediation/gate-repro-ct-demo.test.ts`
 * (node:test style; jest.config.js ignores `.opencode/scratch/`, so it cannot run there).
 *
 * Claimed hazard (reviewer 3-reviewer-plan-notes.md:24, finding F1): the derived-applicability
 * guard (derivedAppliesTo('integrity') = all five concrete TestTypes) makes registerRule throw
 * for CT_DEMO_001, whose declared applies_to is [UNIT] only.
 *
 * Three sufficient conditions, all expected to PASS (hazard reproduced):
 *   (a) tests/integration/fixtures.test.ts has no registerRule(CT_DEMO_001) call,
 *   (b) CT_DEMO_001.applies_to != the category-derived integrity set (order-insensitive),
 *   (c) registerRule(CT_DEMO_001) throws 'applies_to must match derived applicability for category "integrity"'.
 */

import { TestType } from '../../src/core/analysis';
import { CT_DEMO_001 } from '../../src/rules/ct-demo-001';
import { registerRule } from '../../src/rules/registry';

/** Category-derived integrity set (registry.derivedAppliesTo, src/rules/registry.ts:180-183). */
const DERIVED_INTEGRITY: TestType[] = [
  TestType.UNIT,
  TestType.COMPONENT,
  TestType.INTEGRATION,
  TestType.CONTRACT,
  TestType.E2E,
];

const fixturesSource = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'integration', 'fixtures.test.ts'),
  'utf8',
);

describe('gate repro — derived-applicability guard vs CT_DEMO_001', () => {
  it('(a) fixtures.test.ts has no registerRule(CT_DEMO_001) call', () => {
    const hit = fixturesSource.match(/^.*registerRule\(\s*CT_DEMO_001\s*\).*$/m);
    expect(hit).toBeNull();
  });

  it('(b) CT_DEMO_001.applies_to does not equal the category-derived integrity set', () => {
    expect(CT_DEMO_001.category).toBe('integrity');
    expect([...CT_DEMO_001.applies_to].sort()).not.toEqual([...DERIVED_INTEGRITY].sort());
  });

  it('(c) registerRule(CT_DEMO_001) throws the derived-mismatch message', () => {
    expect(() => registerRule(CT_DEMO_001)).toThrow(
      'applies_to must match derived applicability for category "integrity"',
    );
  });
});
