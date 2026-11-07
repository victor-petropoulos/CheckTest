/**
 * CT-INT-004 — unclassified-construct reporting (docs/rules/ct-int-004-proposal.md).
 *
 * The collector already records, per declaration, constructs it cannot inspect
 * statically: computed matchers, unsupported matchers on an expect chain,
 * unsupported assertion namespaces (assert/chai/should) and unresolvable custom
 * helpers. Unit A exposes that list as the additive `unclassified_constructs`
 * field on the per-declaration evidence record. This rule is the reader that
 * turns the field into a transparency verdict.
 *
 * Semantics (proposal §1):
 *   count = 0/absent  → PASS — nothing uninspectable to report.
 *   count > 0         → INDETERMINATE, listing the collector's reasons verbatim.
 *   FAIL              → unreachable by construction: an unclassified construct
 *                       is absence of evidence, never a negative finding.
 *
 * Minimum completeness is PARTIAL, not the proposal's literal COMPLETE: the
 * collector sets coverage PARTIAL whenever it records an unclassified construct
 * (collector.ts:299), so a COMPLETE minimum would make guard 4 short-circuit
 * every record the rule exists to report — the rule would be blocked by its own
 * signal. PARTIAL admits exactly that record; UNAVAILABLE still yields
 * INDETERMINATE. Guard 5 (availability) still fires first on real collector
 * records because PARTIAL implies availability UNKNOWN; its reason embeds the
 * record's reason, which quotes every collector reason verbatim. The local hook
 * therefore runs whenever the record is otherwise decidable (KNOWN, no
 * conflicts) and never returns FAIL.
 *
 * Explicit non-claim: an unclassified construct is not proof of a bad test.
 * The rule says only that CheckTest cannot statically inspect it.
 */

import { TestType } from '../core/analysis';
import { CollectionStatus } from '../core/evidence';
import { RuleResult } from '../core/result';
import { RuleMetadata } from '../core/rule';

export const CT_INT_004: RuleMetadata = {
  id: 'CT-INT-004',
  name: 'unclassified-constructs',
  category: 'integrity',
  description:
    'Reports constructs CheckTest cannot inspect statically (computed matchers, unsupported assert/chai/should namespaces, unresolvable custom helpers) per declaration. Transparency rule: never FAILs.',
  applies_to: [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION, TestType.CONTRACT, TestType.E2E],
  // The field is additive evidence on the assertion_count record; requiring that
  // record keeps the shared completeness/availability/conflict guards in force.
  required_evidence: ['assertion_count'],
  analysis_scope: 'test-body',
  // PARTIAL (not COMPLETE): unclassified constructs FORCE coverage PARTIAL
  // (collector.ts:299), so COMPLETE would block the rule's own evidence at
  // guard 4. See the module comment.
  minimum_evidence_completeness: CollectionStatus.PARTIAL,
  unknown_evidence_policy: RuleResult.INDETERMINATE,
  conflicting_evidence_policy: RuleResult.INDETERMINATE,
  // Numeric thresholds are inert: local_decision replaces step 7. `fail_at_most`
  // is -1 so even the numeric path could never FAIL (a count is never < 0); the
  // registry only requires pass_at_least > fail_at_most.
  evaluation: { metric: 'assertion_count', pass_at_least: 0, fail_at_most: -1 },
  severity: 'info',
  status: 'active',
  local_decision: (context) => {
    const record = context.record ?? context;
    const unclassified = record.unclassified_constructs;
    const count = unclassified?.count ?? 0;
    const reasons = unclassified?.reasons ?? [];

    if (count === 0) {
      return {
        result: RuleResult.PASS,
        reason: `${CT_INT_004.id}: unclassified_constructs=0 — nothing uninspectable to report`,
        location: record.location,
      };
    }

    // Transparency rule: presence of uninspectable constructs means the verdict
    // is not established. There is deliberately no FAIL branch — an
    // unclassified construct is not a negative finding, and an incomplete scan
    // can never justify one.
    const detail = reasons.length > 0 ? reasons.join('; ') : 'no collector reason recorded';
    return {
      result: RuleResult.INDETERMINATE,
      reason: `${CT_INT_004.id}: unclassified_constructs=${count}: ${detail}`,
      location: record.location,
    };
  },
  rationale:
    'CheckTest cannot inspect every assertion form statically; reporting the constructs it could not classify keeps the verdict honest instead of silently treating them as absent (collector.ts:612-679; KickOff:72).',
  limitations:
    'Does not claim the unclassified construct is wrong or unused. It reports only that static analysis cannot classify it; no runtime behaviour is observed.',
  docsUrl: 'docs/rules/ct-int-004-proposal.md',
};
