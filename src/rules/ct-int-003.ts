/**
 * CT-INT-003 — unestablished-assertion reporting (docs/rules/ct-int-003-proposal.md).
 *
 * The collector already records, per declaration, recognized assertions whose
 * execution the static shape cannot establish: callbacks, nested blocks
 * (if/loop/try/switch), and statements after an unconditional return/throw.
 * Unit A exposes that list as the additive `unestablished_assertions` field on
 * the per-declaration evidence record. This rule is the reader that turns the
 * field into a verdict.
 *
 * The verdict is rule-local because the engine's numeric step 7 thresholds a
 * single higher-is-better count, while this rule reads an absent-or-object
 * field and must list the collector's reasons verbatim. Unit B1 gives
 * RuleMetadata an optional `local_decision` hook; guards 0-6 remain the shared
 * engine guards, and only step 7 is replaced. CT-INT-001 declares no hook, so
 * its numeric path is untouched.
 *
 * Explicit non-claim (proposal §1): an unestablished assertion is not proof
 * that it never runs. The collector's reasons say only that static shape does
 * not establish execution; there is no dataflow, branch-condition or loop-trip
 * analysis here.
 */

import { TestType } from '../core/analysis';
import { Availability, CollectionStatus } from '../core/evidence';
import { RuleResult } from '../core/result';
import { RuleMetadata, RuleStatus } from '../core/rule';

export const CT_INT_003: RuleMetadata = {
  id: 'CT-INT-003',
  name: 'unestablished-assertions',
  category: 'integrity',
  description:
    'Reports recognized assertions whose execution is not established by the static test-body shape, per declaration.',
  applies_to: [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION, TestType.CONTRACT, TestType.E2E],
  // The field is additive evidence on the assertion_count record; the rule
  // requires that record so the shared completeness/availability/conflict
  // guards still apply before the local verdict.
  required_evidence: ['assertion_count', 'unestablished_assertion'],
  analysis_scope: 'test-body',
  minimum_evidence_completeness: CollectionStatus.COMPLETE,
  unknown_evidence_policy: RuleResult.INDETERMINATE,
  conflicting_evidence_policy: RuleResult.INDETERMINATE,
  evidence_completeness: { unestablished_assertion: 'signal' },
  // Numeric thresholds are inert for this rule: local_decision replaces step 7.
  // They still satisfy the registry's strict ordering contract (pass > fail).
  evaluation: { metric: 'unestablished_assertion', pass_at_least: 1, fail_at_most: 0 },
  severity: 'warning',
  status: RuleStatus.ACTIVE,
  local_decision: (context) => {
    const record = context.record ?? context;
    const unestablished = record.unestablished_assertions;
    const count = unestablished?.count ?? 0;
    const reasons = unestablished?.reasons ?? [];

    if (count === 0) {
      return {
        result: RuleResult.PASS,
        reason: `${CT_INT_003.id}: unestablished_assertions=${count}`,
        location: record.location,
      };
    }

    // A negative verdict still needs decidable evidence. The signal record's
    // completeness is presence-and-count (ADR-035 amendment 2026-11-18), so
    // the guard checks availability KNOWN + a finite integer count >= 0 instead
    // of the assertion_count coverage rank. The hook is public and can be
    // invoked directly on a record, so it repeats the guard here.
    if (!(record.availability === Availability.KNOWN && Number.isInteger(count) && count >= 0)) {
      return {
        result: RuleResult.INDETERMINATE,
        reason: `${CT_INT_003.id}: unestablished_assertions=${count} but availability is ${record.availability} — an undecidable signal cannot prove this verdict`,
        location: record.location,
      };
    }

    // The field is additive and optional: a caller can hand-build a record whose
    // count is positive without the reasons list. FAIL still stands on the
    // count; the reason names that the collector supplied no detail.
    const detail = reasons.length > 0 ? reasons.join('; ') : 'no collector reason recorded';
    return {
      result: RuleResult.FAIL,
      reason: `${CT_INT_003.id}: unestablished_assertions=${count}: ${detail}`,
      location: record.location,
    };
  },
  rationale:
    'A recognized assertion inside a callback, nested block, or after an unconditional halt is not proven to execute by the static test-body shape, so its verification is unestablished (SPEC:490-525; collector.ts:85-89).',
  limitations:
    'Does not claim the assertion never runs: no dataflow, branch-condition, loop-trip or exception-path analysis is performed. Only static shape is reported.',
  docsUrl:
    'https://github.com/victor-petropoulos/CheckTest/blob/main/docs/supported-syntax.md#executability-establishment-rule-a7',
};
