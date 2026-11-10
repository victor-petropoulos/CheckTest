/**
 * The rule engine — one ordered evaluator for every rule (plan task 4; SPEC:489-525).
 *
 * Rules are DATA, not code: no rule ships its own evaluator function, so the
 * precedence below cannot drift between rules. The order is fixed and each step
 * short-circuits:
 *
 *   0. FAILED abort          — analysis status FAILED → NO verdict at all (null)
 *   1. UNKNOWN test type     — test type UNKNOWN → INDETERMINATE
 *   2. applicability         — concrete type outside applies_to → N/A
 *   3. analysis status       — UNSUPPORTED → INDETERMINATE
 *   4. rule completeness     — any required evidence below minimum → INDETERMINATE
 *   5. availability          — required evidence not KNOWN → unknown_evidence_policy
 *   6. conflicts             — required evidence in conflict → conflicting_evidence_policy
 *   7. numeric threshold     — value >= pass_at_least → PASS; <= fail_at_most → FAIL
 *
 * Step 0 precedes applicability DELIBERATELY (plan task 4, D2). SPEC:374 ("No
 * rule evaluation occurs; the engine aborts before numeric evaluation") and
 * SPEC:405 ("The engine aborts before rule evaluation; evaluationStatus is
 * FAILED and ruleResults is empty") put the FAILED abort BEFORE rule
 * evaluation, so no UNKNOWN-type INDETERMINATE (step 1) and no applicability
 * N/A (step 2) may fire on a FAILED analysis — both would imply the engine
 * evaluated the rule when it never did.
 *
 * Completeness and availability guards precede the numeric step on purpose:
 * a collected zero is only meaningful when the scan actually completed for the
 * declared scope (SPEC:425, plan A6).
 *
 * Step 7 is ASYMMETRIC in coverage (plan task 4, decision D): when the rule's
 * `minimum_evidence_completeness` admits a PARTIAL record, PASS still stands on
 * it — an incomplete scan can only add to a count, never subtract from one, so a
 * count already at the pass threshold cannot be pulled back below it — while FAIL
 * requires COMPLETE, because a sub-threshold count from an incomplete scan is not
 * a measurement of the declared scope, it is a floor on it. Both shipped rules
 * declare COMPLETE, so neither reaches that branch; the guard is what makes the
 * engine correct for any rule that lowers its minimum.
 *
 * Core is language-agnostic: this module imports enums and shapes only, never
 * `typescript` and never an adapter (KickOff:134, plan §1).
 *
 * UNKNOWN test type is NOT an applicability mismatch: the engine cannot decide
 * whether the rule applies, so it reports INDETERMINATE (SPEC:475-479, plan A3).
 * N/A is reserved for a mismatch between two concrete types (SPEC:469-473).
 */

import { AnalysisOutput, AnalysisStatus, AnalysisSummary, CapabilityStatus, TestIdentity, TestType } from './analysis';
import { Availability, CollectionStatus, EvidenceLocation, EvidenceRecord } from './evidence';
import { EvaluationResult, EvaluationStatus, RuleFinding, RuleResult, TestEvaluation } from './result';
import { RuleLocalDecisionHook, RuleMetadata } from './rule';

/** Ordering used only to compare collection statuses against the rule minimum. */
const COVERAGE_RANK: Readonly<Record<CollectionStatus, number>> = {
  [CollectionStatus.COMPLETE]: 3,
  [CollectionStatus.PARTIAL]: 2,
  [CollectionStatus.UNAVAILABLE]: 1,
};

function finding(rule: RuleMetadata, result: RuleResult, reason: string, location?: EvidenceLocation): RuleFinding {
  // ponytail: reason is mandatory (result.ts) — a verdict without a reason is not
  // reportable, so every return path below builds one instead of defaulting to ''.
  // Location is appended LAST and only when an evidence record carries one, so
  // no verdict ever fabricates a source position (B7 prerequisite).
  const out: RuleFinding = { rule_id: rule.id, result, reason, evidence: [...rule.required_evidence] };
  if (location !== undefined) {
    out.location = location;
  }
  return out;
}

/**
 * Unit B1 seam: invoke a rule's optional local decision after guards 0-6 and
 * INSTEAD of the numeric step-7 threshold. The context spreads the metric
 * record, so a hook written as `(record) => ...` reads the same fields; the
 * extra `record`, `rule`, `metricRecord`, `evidence` and `summary` properties
 * let a hook cite its rule or inspect the scope without importing engine
 * internals. Returning a RuleResult alone is tolerated for tiny rules; the
 * normal form is `{ result, reason, location? }`.
 */
function localDecision(
  rule: RuleMetadata,
  hook: RuleLocalDecisionHook,
  record: EvidenceRecord,
  scope: ScopeView,
): RuleFinding {
  const context = Object.assign({}, record, {
    rule,
    record,
    metricRecord: record,
    evidence: scope.evidence,
    summary: scope.summary,
  });
  const outcome = hook(context, record, rule);
  if (typeof outcome === 'string') {
    return finding(rule, outcome, `${rule.id}: local decision returned ${outcome}`, record.location);
  }
  if (outcome === null || typeof outcome !== 'object') {
    return finding(rule, RuleResult.INDETERMINATE, `${rule.id}: local decision returned no verdict`, record.location);
  }
  const reason =
    typeof outcome.reason === 'string' && outcome.reason.trim() !== ''
      ? outcome.reason
      : `${rule.id}: local decision returned ${String(outcome.result)}`;
  return finding(rule, outcome.result, reason, outcome.location ?? record.location);
}

/**
 * Shared step-4 completeness gate: a rule's required evidence must meet its
 * minimum collection status (COVERAGE_RANK order) before any numeric verdict.
 * This is the same comparison made inline at evaluation.ts:219-235: a record
 * exactly AT the rule's minimum is let through.
 *
 * Truth table (coverage × minimum) — rank(coverage) >= rank(minimum):
 *
 *   coverage \ minimum | COMPLETE | PARTIAL | UNAVAILABLE
 *   ------------------+----------+---------+------------
 *   COMPLETE          |   true   |   true  |   true
 *   PARTIAL           |  false   |   true  |   true
 *   UNAVAILABLE       |  false   |  false  |   true
 *
 * Existing guard behavior unchanged: this is a testable projection of the
 * inline check at step 4. (FAIL remains additionally gated at step 7 on
 * COMPLETE coverage, evaluation.ts:297-315.)
 */
export function requiresCompleteForNegativeVerdict(coverage: CollectionStatus, minimum: CollectionStatus): boolean {
  // Step-4 completeness gate: coverage must reach the rule minimum (COVERAGE_RANK).
  return COVERAGE_RANK[coverage] >= COVERAGE_RANK[minimum];
}

/**
 * What the ordered guards need from a scope: its own summary and evidence, plus
 * the subject-level capabilities description used only in the UNSUPPORTED
 * reason (framework detection stays file-scoped — plan task 7). One view type
 * serves both the subject scope and each test scope, so the ordered guards
 * exist in exactly ONE place (D4: two places changing for one reason).
 */
interface ScopeView {
  summary: AnalysisSummary;
  evidence: Record<string, EvidenceRecord>;
  /** Timestamp-free pointer to what the collector could not do (KickOff:246-258). */
  unsupported: string;
  /** Detected framework, when the analysis was UNSUPPORTED due to an unsupported one. */
  framework?: string;
}

/** ponytail: present so the missing-entry case is a real guard, not a crash. */
function lookup(scope: ScopeView, type: string): EvidenceRecord | undefined {
  return scope.evidence[type];
}

/** The subject-level scope: the whole analysis envelope as one view. */
function subjectScope(analysis: AnalysisOutput): ScopeView {
  return {
    summary: analysis.analysis,
    evidence: analysis.evidence,
    unsupported: describe(analysis),
    framework: analysis.subject.framework,
  };
}

/**
 * Public seam: evaluate one rule and report BOTH whether a verdict was reached
 * and what it is (plan task 1, Option2).
 *
 * The status is not derivable from the finding: a FAILED analysis yields
 * `status FAILED` with no finding, which no RuleResult expresses and which an
 * empty findings array would leave ambiguous (SPEC:405). The failed scan stays
 * reportable through `analysisStatus` plus the collector diagnostics on the
 * evidence records — this layer never invents a verdict to cover the abort.
 */
export function evaluateRule(rule: RuleMetadata, analysis: AnalysisOutput): EvaluationResult {
  const finding = decide(rule, subjectScope(analysis));
  return {
    status: finding === null ? EvaluationStatus.FAILED : EvaluationStatus.EVALUATED,
    finding,
  };
}

/**
 * Evaluate one rule over EVERY scope of the analysis (plan task 4): ONE entry
 * per `analysis.tests[]` declaration in declaration order, or — when the
 * optional `tests` field is ABSENT (a legacy envelope that carries no per-test
 * records at all, analysis.ts:111-116) — exactly one subject-level entry with
 * `test: null`, keeping every existing consumer's shape.
 *
 * ABSENT and EMPTY are different states and are not collapsed (WP1.1): a
 * SUPPLIED collection holding zero records is a decided fact — the scan ran and
 * located no declaration — so it yields ZERO evaluations and no verdict. The
 * subject-level fallback is for a legacy envelope that never carried the field,
 * never for one that supplied it empty; otherwise a test-quality rule would
 * report a phantom FAIL for a file that declares no test at all.
 *
 * Deterministic: no counters, no clock, no reordering.
 *
 * Each scope runs the SAME ordered guards as `evaluateRule`, so the FAILED
 * abort (step 0) and every evidence guard apply per test, never laundered
 * across declarations.
 */
export function evaluateTests(rule: RuleMetadata, analysis: AnalysisOutput): TestEvaluation[] {
  const tests = analysis.tests;
  // Framework detection is file-scoped (plan task 7): every test scope of one
  // UNSUPPORTED file shares the subject-level capabilities description.
  const unsupported = describe(analysis);
  const scopes: Array<{ test: TestIdentity | null; scope: ScopeView }> =
    tests === undefined
      ? [{ test: null, scope: subjectScope(analysis) }]
      : tests.map((testScope) => ({
          test: testScope.test,
          scope: {
            summary: testScope.analysis,
            evidence: testScope.evidence,
            unsupported,
            framework: analysis.subject.framework,
          },
        }));

  return scopes.map(({ test, scope }) => {
    const finding = decide(rule, scope);
    return {
      test,
      status: finding === null ? EvaluationStatus.FAILED : EvaluationStatus.EVALUATED,
      finding,
    };
  });
}

/**
 * The fixed decision itself. `null` means step 0 aborted the evaluation
 * (analysis FAILED, SPEC:374,405) — the only path that produces no verdict,
 * and the one both public seams map onto EvaluationStatus.FAILED.
 */
function decide(rule: RuleMetadata, scope: ScopeView): RuleFinding | null {
  // WP1.3: draft rules are registered (and their evidence stays wired) but
  // produce no verdict — they short-circuit before any evidence guard.
  if (rule.status === 'draft') return null;
  const { applies_to, required_evidence } = rule;

  // Step 0 — FAILED abort. FIRST, before applicability (plan task 4, D2):
  // SPEC:374/405 abort BEFORE rule evaluation, so no UNKNOWN-type INDETERMINATE
  // (step 1) and no applicability N/A (step 2) may stand in for the abort —
  // both would imply the rule was evaluated when it never was.
  const status = scope.summary.status;
  if (status === AnalysisStatus.FAILED) {
    return null;
  }

  // Step 1 — UNKNOWN test type: not an applicability mismatch (SPEC:475-479).
  const testType = scope.summary.test_type.value;
  if (testType === TestType.UNKNOWN) {
    return finding(
      rule,
      RuleResult.INDETERMINATE,
      `${rule.id}: test type is UNKNOWN, so applicability cannot be decided (SPEC:475-479)`,
    );
  }

  // Step 2 — applicability: N/A is reserved for two CONCRETE types mismatching.
  if (!applies_to.includes(testType)) {
    return finding(
      rule,
      RuleResult.N_A,
      `${rule.id}: applicability mismatch — test type ${testType} is outside applies_to [${applies_to.join(', ')}]`,
    );
  }

  // Step 3 — analysis status UNSUPPORTED (after applicability: an inapplicable
  // concrete type is a decided N/A, not an undecidable analysis).
  if (status === AnalysisStatus.UNSUPPORTED) {
    const frameworkSuffix = scope.framework === undefined ? '' : ` (detected framework: ${scope.framework})`;
    return finding(
      rule,
      RuleResult.INDETERMINATE,
      `${rule.id}: analysis status UNSUPPORTED${frameworkSuffix} — ${scope.unsupported}`,
    );
  }

  // Step 4 — rule-level completeness: ALL required evidence must meet the minimum.
  // A record exactly AT the rule's minimum is let through; whether step 7 may
  // return PASS or FAIL on it is decided there, not here (asymmetric coverage).
  for (const type of required_evidence) {
    const record = lookup(scope, type);
    if (record === undefined) {
      return finding(
        rule,
        RuleResult.INDETERMINATE,
        `${rule.id}: required evidence '${type}' is absent from the analysis envelope`,
      );
    }
    if (COVERAGE_RANK[record.coverage.status] < COVERAGE_RANK[rule.minimum_evidence_completeness]) {
      return finding(
        rule,
        RuleResult.INDETERMINATE,
        `${rule.id}: coverage.status ${record.coverage.status} for '${type}' is below required ${rule.minimum_evidence_completeness}${suffix(record.reason)}`,
        record.location,
      );
    }
  }

  // Step 5 — availability. NOT_APPLICABLE is folded in with UNKNOWN: either way the
  // collector declined to produce a decidable value, so no numeric verdict follows.
  for (const type of required_evidence) {
    const record = lookup(scope, type) as EvidenceRecord;
    if (record.availability !== Availability.KNOWN) {
      return finding(
        rule,
        rule.unknown_evidence_policy,
        `${rule.id}: availability is ${record.availability} for '${type}'${suffix(record.reason)}`,
        record.location,
      );
    }
  }

  // Step 6 — conflicting evidence. A conflict is not incompleteness (SPEC:366):
  // both values are preserved on the record and the rule's policy decides.
  for (const type of required_evidence) {
    const record = lookup(scope, type) as EvidenceRecord;
    if (record.conflicts !== undefined && record.conflicts.length > 0) {
      return finding(
        rule,
        rule.conflicting_evidence_policy,
        `${rule.id}: conflicting evidence for '${type}' (${record.conflicts.length} recorded value(s))`,
        record.location,
      );
    }
  }

  // Step 7 — numeric threshold.
  const metric = rule.evaluation.metric;
  const record = lookup(scope, metric);
  if (record === undefined) {
    return finding(
      rule,
      RuleResult.INDETERMINATE,
      `${rule.id}: metric '${metric}' is absent from the analysis envelope`,
    );
  }

  // Unit B1 seam — a rule may replace ONLY the numeric step 7. Steps 0-6 above
  // have already run, so its local verdict cannot bypass a centralized guard.
  const hook = rule.local_decision ?? rule.localDecision ?? rule.decide;
  if (typeof hook === 'function') {
    return localDecision(rule, hook, record, scope);
  }

  const value = record.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return finding(
      rule,
      RuleResult.INDETERMINATE,
      `${rule.id}: '${metric}' value is ${describeValue(value)}, not a number — threshold not applied${suffix(record.reason)}`,
      record.location,
    );
  }
  // PASS survives an incomplete scan: the established count is a floor on the real
  // count, so reaching pass_at_least on PARTIAL is the one verdict PARTIAL may buy
  // (asymmetric coverage, decision D).
  if (value >= rule.evaluation.pass_at_least) {
    return finding(
      rule,
      RuleResult.PASS,
      `${rule.id}: ${metric}=${value} >= ${rule.evaluation.pass_at_least}`,
      record.location,
    );
  }
  if (value <= rule.evaluation.fail_at_most) {
    // Asymmetric coverage (plan task 4 / decision D). The count is the number the
    // collector ESTABLISHED; an incomplete scan leaves the rest of the declared
    // scope unexamined, so this number is a floor, not a measurement. Reporting
    // FAIL from it would fabricate a verdict the scan never proved (SPEC:425).
    if (record.coverage.status !== CollectionStatus.COMPLETE) {
      return finding(
        rule,
        RuleResult.INDETERMINATE,
        `${rule.id}: ${metric}=${value} <= ${rule.evaluation.fail_at_most} but coverage.status ${record.coverage.status} — an incomplete scan cannot prove this count${suffix(record.reason)}`,
        record.location,
      );
    }
    return finding(
      rule,
      RuleResult.FAIL,
      `${rule.id}: ${metric}=${value} <= ${rule.evaluation.fail_at_most}`,
      record.location,
    );
  }
  return finding(
    rule,
    RuleResult.INDETERMINATE,
    `${rule.id}: ${metric}=${value} is between the thresholds (<= ${rule.evaluation.fail_at_most} FAIL, >= ${rule.evaluation.pass_at_least} PASS)`,
    record.location,
  );
}

function suffix(reason: string | undefined): string {
  return reason === undefined ? '' : ` (${reason})`;
}

function describeValue(value: unknown): string {
  return value === undefined ? 'undefined' : typeof value;
}

/** Short, timestamp-free pointer to what the collector could not do (KickOff:246-258). */
function describe(analysis: AnalysisOutput): string {
  const unsupported = Object.entries(analysis.capabilities)
    .filter(([, capability]) => capability !== CapabilityStatus.AVAILABLE)
    .map(([name]) => name);
  return unsupported.length === 0
    ? 'no capability is AVAILABLE'
    : `capabilities not AVAILABLE: ${unsupported.join(', ')}`;
}
