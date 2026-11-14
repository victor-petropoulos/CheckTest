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
    'coverage-observed diagnostic: measures whether the mapped production file was exercised by an external coverage provider. Produces a file-level verdict when coverage is mapped (count of covered lines); when the report was produced by a run scoped to a single test file (--per-test-run) it also yields numeric per-declaration verdicts against the mapped file. Never asserts that a specific test body executed.',
  applies_to: [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION, TestType.CONTRACT, TestType.E2E],
  required_evidence: ['line_coverage'],
  analysis_scope: 'test-body',
  minimum_evidence_completeness: CollectionStatus.COMPLETE,
  unknown_evidence_policy: RuleResult.INDETERMINATE,
  conflicting_evidence_policy: RuleResult.INDETERMINATE,
  evaluation: { metric: 'line_coverage', pass_at_least: 1, fail_at_most: 0 },
  thresholds_inert: true,
  severity: 'warning',
  status: 'active',
  rationale:
    'When coverage is mapped from a test file to a production file, CT-COV-001 reports whether that production file was exercised (any covered line). It does not claim a specific test body executed: per-declaration attribution is not supported for ordinary mapped coverage, but a report produced by a run scoped to that test file (--per-test-run) with a KNOWN + COMPLETE mapped target yields numeric per-declaration verdicts carrying the file-level claim.',
  limitations:
    'Depends entirely on an externally produced coverage report; a missing, stale, partial or mismatched report yields INDETERMINATE rather than FAIL. In --per-test-run mode a mapped-pair contradiction (other PARTIAL report entries) only prepends veto-WARN to the subject reason and never changes a verdict.',
  docsUrl: 'docs/limitations.md#14-external-coverage-provider-wp41-task-56b',
};
