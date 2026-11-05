/**
 * CT-COV-001 — coverage-observed (WP4.1 task 56c).
 *
 * A test declaration whose body lines are reported uncovered by an external
 * coverage provider is flagged. The rule only ever runs on `line_coverage`
 * evidence (provenance EXTERNAL); it never makes such evidence mandatory for
 * any other rule (roadmap constraint).
 */

import { TestType } from '../core/analysis';
import { CollectionStatus } from '../core/evidence';
import { RuleResult } from '../core/result';
import { RuleMetadata } from '../core/rule';

export const CT_COV_001: RuleMetadata = {
  id: 'CT-COV-001',
  name: 'coverage-observed',
  category: 'coverage',
  description:
    'a test declaration whose body lines are reported uncovered by an external coverage provider is flagged.',
  applies_to: [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION, TestType.CONTRACT, TestType.E2E],
  required_evidence: ['line_coverage'],
  analysis_scope: 'test-body',
  minimum_evidence_completeness: CollectionStatus.COMPLETE,
  unknown_evidence_policy: RuleResult.INDETERMINATE,
  conflicting_evidence_policy: RuleResult.INDETERMINATE,
  evaluation: { metric: 'line_coverage', pass_at_least: 1, fail_at_most: 0 },
  severity: 'warning',
  status: 'active',
  rationale:
    'A declaration reported uncovered by an external coverage provider exercises no covered line, so its verdict rests on the absence of observed execution.',
  limitations:
    'Depends entirely on an externally produced coverage report; a missing, stale, partial or mismatched report yields INDETERMINATE rather than FAIL.',
  docsUrl: 'docs/limitations.md#14-external-coverage-provider-wp41-task-56b',
};
