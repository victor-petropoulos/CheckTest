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
 * Rule lifecycle status — the CLOSED SET of lifecycle states a rule may be in
 * (plan task 5.1; D6 draft opt-in, D7 deprecated-until-removal).
 *
 * WHY A CONST OBJECT + DERIVED UNION AND NOT A TS `enum`:
 * the house pattern in this codebase (src/core/evidence.ts `Provenance`,
 * `Availability`, `CollectionStatus`) is a plain TS `enum`, and a TS string
 * enum is NOMINAL — `status: 'active'` stops compiling the moment the field
 * is typed with it (verified against tsc 6.0.3: `error TS2322: Type
 * '"active"' is not assignable to type 'RuleStatusEnum'`). Every rule file
 * (src/rules/ct-*.ts) and the rule contract tests spell the status as a bare
 * string literal today, and src/core/evaluation.ts:234 compares the field
 * against the literal `'draft'`. Typing the field with a nominal enum here
 * would therefore break consumers that live OUTSIDE this task's scope (rule
 * files are migrated in task 5.2, the engine in task 5.3) and would silently
 * change the recorded wire value of every rule.
 *
 * This shape keeps the wire values EXACTLY as they are ('active' | 'draft' |
 * 'deprecated'), makes the field's type a single NAMED contract
 * (`RuleMetadata['status']` is `RuleStatus`, no inline union), and leaves the
 * members usable as values (`RuleStatus.ACTIVE`) so task 5.2 can migrate the
 * rule files to the enum spelling without changing any recorded value. The
 * union is DERIVED from the const object, so a member and its type can never
 * drift apart.
 */
export const RuleStatus = {
  /**
   * Evaluated by default; a verdict is emitted and reported.
   */
  ACTIVE: 'active',
  /**
   * Excluded by default — no verdict, no report entry — UNLESS the rule is
   * explicitly named via --rule (D6).
   */
  DRAFT: 'draft',
  /**
   * Evaluated by default; a verdict is emitted and reported, until a
   * documented removal version (D7). A rule in this state MUST carry
   * `deprecatedSince`.
   */
  DEPRECATED: 'deprecated',
} as const;

/**
 * The status values a rule may carry — DERIVED from {@link RuleStatus} so the
 * runtime members and the compile-time type can never drift apart.
 *
 * statusBehavior — WHAT each status MEANS operationally. This is the contract
 * src/core/evaluation.ts and src/rules/registry.ts will enforce in tasks 5.3
 * and 5.4; it is documented HERE (task 5.1) so the rule contract states the
 * intended behaviour before the enforcement lands.
 *
 *   ACTIVE      evaluated by default; a verdict is emitted and reported.
 *   DRAFT       excluded by default: no verdict, no report entry. A verdict IS
 *               emitted when the rule is explicitly named via --rule (D6).
 *   DEPRECATED  evaluated by default; a verdict is emitted and reported, until
 *               a documented removal version (D7). `deprecatedSince` is
 *               REQUIRED in this state and names that version.
 *
 * ENFORCEMENT STATUS (stated honestly, not aspirationally):
 *   - ACTIVE — live today; src/core/evaluation.ts evaluates every active rule.
 *   - DRAFT — EXCLUDED by default (src/core/evaluation.ts short-circuits on
 *     RuleStatus.DRAFT); naming the rule EXPLICITLY via --rule opts IN, and
 *     the rule is then evaluated like an active one (D6, task 5.3).
 *   - DEPRECATED — evaluated by default (no engine branch treats
 *     'deprecated' specially, so a deprecated rule still produces a verdict)
 *     and its `deprecatedSince` version rides on the evaluation envelope and
 *     on the SARIF rule descriptor (D7, task 5.3). The `deprecatedSince`
 *     requirement is contract-only until task 5.4 adds the registry check.
 */
export type RuleStatus = (typeof RuleStatus)[keyof typeof RuleStatus];

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
  /**
   * Optional per-type completeness policy (CT-INT-003 capability seam, ADR-035
   * amendment 2026-11-18). Defaults to 'rank' for every type: the existing
   * COVERAGE_RANK comparison at evaluation.ts step 4. A type marked 'signal'
   * uses presence-and-count semantics (record present + availability KNOWN +
   * finite integer count >= 0) and skips the rank ladder. COVERAGE_RANK and
   * requiresCompleteForNegativeVerdict stay unchanged; no rule's
   * minimum_evidence_completeness value changes.
   */
  evidence_completeness?: Partial<Record<EvidenceType, 'rank' | 'signal'>>;
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
   * Lifecycle status of this rule. Typed as the NAMED `RuleStatus` contract
   * (not the former inline 'active' | 'draft' | 'deprecated' union) so the
   * legal values are declared once, in one place, with the per-status
   * behaviour documented on {@link RuleStatus}.
   */
  status: RuleStatus;
  /**
   * The version in which a DEPRECATED rule was deprecated, e.g. '1.11.0'.
   *
   * REQUIRED when `status` is `RuleStatus.DEPRECATED`: a deprecated rule with
   * no removal version cannot say when it goes away, which is the whole point
   * of deprecating instead of removing (D7). Meaningless for the other two
   * statuses, so it stays optional.
   *
   * NOT ENFORCED YET — the registry check that rejects a DEPRECATED rule
   * without this field lands in task 5.4 (src/rules/registry.ts); until then
   * this is a recorded, contract-level field.
   */
  deprecatedSince?: string;
  /**
   * WHY this rule exists, in prose (roadmap task 23: "rationale, limitations,
   * documentation reference — where applicable").
   *
   * READ BY THE ENGINE since plan task 6.1: the evaluator copies these three
   * fields — and `description` — onto every finding it produces, so a finding
   * is SELF-CONTAINED: a consumer reading a report learns what the rule checks
   * and what its verdict does NOT establish without resolving the rule
   * registry. The copies are verbatim; the engine never re-authors them. When
   * present they must be a non-empty string — an empty rationale is worse than
   * none, and validateRule() rejects it.
   */
  rationale?: string;
  /** What this rule does NOT establish, so no consumer overreads its verdict. */
  limitations?: string;
  /** Reference into the spec/docs for the rule's own definition. */
  docsUrl?: string;
  /**
   * Declares numeric thresholds inert for config purposes even without a
   * local_decision hook — honesty marker consumed by the config rejection
   * contract (contract-hygiene task 4).
   */
  thresholds_inert?: boolean;
}

/** Single source of truth for the accepted local-decision hook spellings. */
export function localDecisionHookFor(rule: RuleMetadata): RuleLocalDecisionHook | undefined {
  return rule.local_decision ?? rule.localDecision ?? rule.decide;
}

export function hasLocalDecisionHook(rule: RuleMetadata): boolean {
  return localDecisionHookFor(rule) !== undefined;
}
