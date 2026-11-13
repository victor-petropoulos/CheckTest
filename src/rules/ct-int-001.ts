/**
 * CT-INT-001 — assertion-required (SPEC:490-525, 561-569).
 *
 * A test should contain at least one executable verification of an observable
 * outcome. Applies to all five concrete test types, so it can never report N/A
 * (the N/A path is exercised by the CT-DEMO-001 stub).
 *
 * Two vocabulary choices, both pinned to what SPEC states:
 *
 *   severity — 'error'. SPEC:519-520 defines `severity.default: error` for this
 *   rule. SPEC:858 lists BLOCKER as a possible severity and SPEC:873 illustrates
 *   CT-INT-001 as BLOCKER, but the core RuleMetadata union (task 2) is
 *   error|warning|info. Widening that union to carry BLOCKER is a task-2 core
 *   change, not a rule decision, so milestone-1 records the rule's own spec
 *   default. A CI policy may raise error to blocker later (SPEC:876).
 *
 *   status — 'active', which is the milestone-1 equivalent of EXPERIMENTAL.
 *   SPEC:1245 says a rule must not be promoted to STABLE until its evidence
 *   behavior and edge cases are understood: executability after return/throw and
 *   inside callbacks is deliberately unresolved here (plan A7), so claiming
 *   STABLE would overstate what this rule knows. The core union is
 *   active|draft|deprecated and 'draft' means "never reported", which would
 *   disable the rule. Recorded here; the reporter does not yet filter on status.
 *
 * Per-result requirements (SPEC:567-569), enforced by src/core/evaluation.ts:
 *
 *   PASS          at least one executable assertion is established — the metric
 *                 value meets pass_at_least (1). The count that reaches the
 *                 engine is the ESTABLISHED count: unestablished constructs are
 *                 excluded from it (plan A7).
 *   FAIL          zero executable assertions, and only from a COMPLETE scan. A
 *                 zero collected under PARTIAL coverage is an unproved zero, so
 *                 the engine returns INDETERMINATE instead of FAIL (SPEC:425).
 *   INDETERMINATE assertion collection incomplete, framework or assertion form
 *                 unsupported, helper behavior unresolved, or executability
 *                 cannot be established where required.
 *   N/A           never — applies to all five concrete types.
 *
 * Because minimum_evidence_completeness is COMPLETE (SPEC:430), a PARTIAL record
 * is refused at engine step 3, so this rule never reaches the engine's asymmetric
 * PASS-on-PARTIAL branch: an incomplete collection buys PASS for no rule in
 * milestone-1. That is this rule's configuration, not a limitation of the engine —
 * a rule that declared PARTIAL would PASS at value >= pass_at_least and go
 * INDETERMINATE, never FAIL, below it.
 */

import { TestType } from '../core/analysis';
import { CollectionStatus } from '../core/evidence';
import { RuleResult } from '../core/result';
import { RuleMetadata } from '../core/rule';

export const CT_INT_001: RuleMetadata = {
  id: 'CT-INT-001',
  name: 'assertion-required',
  category: 'integrity',
  description: 'A test should contain at least one executable verification of an observable outcome.',
  applies_to: [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION, TestType.CONTRACT, TestType.E2E],
  required_evidence: ['assertion_count'],
  analysis_scope: 'test-body',
  minimum_evidence_completeness: CollectionStatus.COMPLETE,
  unknown_evidence_policy: RuleResult.INDETERMINATE,
  conflicting_evidence_policy: RuleResult.INDETERMINATE,
  evaluation: { metric: 'assertion_count', pass_at_least: 1, fail_at_most: 0 },
  severity: 'error',
  status: 'active',
  // Advisory, milestone-1 only (validated as non-empty by registry.validateRule,
  // otherwise unused by the engine).
  rationale:
    'A test without an executable assertion verifies nothing, so its verdict would rest on the absence of evidence (SPEC:490-525).',
  limitations:
    'Executability after return/throw and inside callbacks is unresolved (plan A7); unestablished assertion constructs are excluded from the count, so a helper-built assertion is not established.',
  docsUrl: 'docs/CHECKTEST_SPEC_v0.3.md#rule-ct-int-001',
};
