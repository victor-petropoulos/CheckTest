/**
 * CT-DEMO-001 — stub rule, exists SOLELY to exercise the engine's N/A path.
 *
 * Plan A2 OPTION A: CT-INT-001 applies to every concrete test type, so N/A can
 * never arise from it. This rule applies to UNIT only, which makes fixture
 * case-14 (a COMPONENT test) deterministic proof that the applicability guard
 * runs first and short-circuits the rest of the order.
 *
 * It is not a real quality rule and reports no verdict about component tests.
 */

import { TestType } from '../core/analysis';
import { CollectionStatus } from '../core/evidence';
import { RuleResult } from '../core/result';
import { RuleMetadata } from '../core/rule';

export const CT_DEMO_001: RuleMetadata = {
  id: 'CT-DEMO-001',
  name: 'assertion-required-unit-demo',
  category: 'integrity',
  description: 'Demonstration rule restricted to UNIT tests, used only to prove the engine N/A path.',
  applies_to: [TestType.UNIT],
  required_evidence: ['assertion_count'],
  analysis_scope: 'test-body',
  minimum_evidence_completeness: CollectionStatus.COMPLETE,
  unknown_evidence_policy: RuleResult.INDETERMINATE,
  conflicting_evidence_policy: RuleResult.INDETERMINATE,
  evaluation: { metric: 'assertion_count', pass_at_least: 1, fail_at_most: 0 },
  severity: 'info',
  status: 'active',
};
