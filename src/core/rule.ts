/**
 * Rule metadata contract (plan task 2; SPEC:489-525).
 *
 * M2 — RuleMetadata lives in CORE, not in src/rules/registry. The registry
 * (task 4) imports it from here; the evaluator (src/core/evaluation.ts) consumes
 * it. Keeping it in core prevents a core↔rules import cycle and keeps
 * RuleFinding's `rule_id: string` honestly typed against RuleMetadata['id'].
 */

import { AnalysisSummary, TestType } from './analysis';
import { CollectionStatus, EvidenceLocation, EvidenceRecord, EvidenceType } from './evidence';
import { RuleFinding, RuleResult } from './result';

/**
 * The numeric threshold a rule applies to its single named evidence item.
 *
 * HIGHER-IS-BETTER contract: the metric counts something the collector can add
 * to but never subtract from. The engine's asymmetric coverage guard (plan task
 * 4) rests on that — an incomplete scan can only raise the count, so a count
 * already at `pass_at_least` still PASSes while one below it proves nothing.
 * An inverted metric (lower is better) would break that reasoning and must not
 * be modelled with these fields.
 */
export interface RuleEvaluation {
  /** Evidence type the threshold is applied to, e.g. 'assertion_count'. */
  metric: EvidenceType;
  /** PASS when the value is >= this. */
  pass_at_least: number;
  /** FAIL when the value is === this. Must be < pass_at_least. */
  fail_at_most: number;
}

/**
 * Seam (Unit B1): optional rule-local verdict returned INSTEAD of the engine's
 * numeric step-7 threshold. Steps 0-6 remain centralized in evaluation.ts; a
 * rule that declares this hook keeps the shared guards (FAILED abort, UNKNOWN
 * type, applicability, UNSUPPORTED, completeness, availability, conflicts)
 * and only replaces the final numeric comparison. CT-INT-001 does NOT declare
 * it, so its numeric path stays byte-identical.
 *
 * The hook receives a context object carrying the metric record (spread in, so
 * a hook written as `(record) => ...` works) plus `rule`, `record`,
 * `metricRecord`, `evidence` and `summary`. It returns either a
 * `{ result, reason, location? }` object, a RuleResult, or a RuleFinding.
 */
export interface RuleLocalDecision {
  result: RuleResult;
  reason: string;
  location?: EvidenceLocation;
}

export interface RuleLocalDecisionContext extends EvidenceRecord {
  rule: RuleMetadata;
  record: EvidenceRecord;
  metricRecord: EvidenceRecord;
  evidence: Record<string, EvidenceRecord>;
  summary: AnalysisSummary;
}

export type RuleLocalDecisionHook = (
  context: RuleLocalDecisionContext,
  record?: EvidenceRecord,
  rule?: RuleMetadata,
) => RuleLocalDecision | RuleResult | RuleFinding;

export interface RuleMetadata {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Concrete types only — UNKNOWN never appears here; unknown → INDETERMINATE. */
  applies_to: TestType[];
  required_evidence: EvidenceType[];
  analysis_scope: string;
  /**
   * Minimum collection completeness before this rule may reach a verdict
   * (SPEC:430). A record at or above it passes engine step 3.
   *
   * WHERE THIS ADMITS PARTIAL, the engine stays ASYMMETRIC (plan task 4,
   * decision D): PASS is still allowed, because an incomplete scan can only add
   * to the established count, but FAIL is not — a count at or below
   * `fail_at_most` from a PARTIAL record is a floor, not a measurement, so it
   * yields INDETERMINATE. Both shipped rules declare COMPLETE and so never reach
   * that branch; this is the contract for a rule that lowers its minimum.
   */
  minimum_evidence_completeness: CollectionStatus;
  unknown_evidence_policy: RuleResult;
  conflicting_evidence_policy: RuleResult;
  evaluation: RuleEvaluation;
  /**
   * Optional local verdict, called after centralized guards 0-6 and INSTEAD of
   * the numeric step-7 comparison. Absent for every pre-existing rule, so the
   * engine's numeric path is unchanged. Aliases are accepted so the seam is
   * tolerant of a caller spelling the hook camelCase or as `decide`.
   */
  local_decision?: RuleLocalDecisionHook;
  localDecision?: RuleLocalDecisionHook;
  decide?: RuleLocalDecisionHook;
  severity: 'error' | 'warning' | 'info';
  /**
   * Lifecycle label (SPEC:1240-1245: EXPERIMENTAL | STABLE | DEPRECATED).
   *
   * ADVISORY IN MILESTONE-1 — recorded, NOT enforced. Neither `evaluateRule`
   * nor the CLI filters on this field, so a `draft` or `deprecated` rule is
   * still evaluated and still reported when explicitly requested. This comment
   * previously claimed draft rules are "never reported", which was never
   * implemented; the smaller correct fix is to state the real behaviour rather
   * than add untested filtering to the engine. Enforcement is deferred to the
   * milestone that introduces rule lifecycle / promotion policy.
   */
  status: 'active' | 'draft' | 'deprecated';
  /**
   * WHY this rule exists, in prose (roadmap task 23: "rationale, limitations,
   * documentation reference — where applicable"). ADVISORY IN MILESTONE-1:
   * nothing in src/core/evaluation.ts reads these three fields, so they are
   * recorded documentation, not behaviour. When present they must be a
   * non-empty string — an empty rationale is worse than none, and
   * validateRule() rejects it.
   */
  rationale?: string;
  /** What this rule does NOT establish, so no consumer overreads its verdict. */
  limitations?: string;
  /** Reference into the spec/docs for the rule's own definition. */
  docsUrl?: string;
}
