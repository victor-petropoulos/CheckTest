/**
 * Rule registry (plan task 4; validation added by WP2.1, plan task 23).
 *
 * A plain id → metadata map. Registration is explicit, never an import side
 * effect: the composition point (src/cli.ts, task 6) decides which rules run,
 * so importing this module has no observable behaviour.
 *
 * RuleMetadata comes from CORE, not from this file (M2) — the evaluator and the
 * registry therefore share one type without a core↔rules cycle.
 */

import { TestType } from '../core/analysis';
import { CollectionStatus } from '../core/evidence';
import { hasLocalDecisionHook, RuleMetadata, RuleStatus } from '../core/rule';
import { RuleResult } from '../core/result';

const rules = new Map<string, RuleMetadata>();

/** Stable id shape, e.g. CT-INT-001. Checked at the registration boundary. */
const ID_PATTERN = /^CT-[A-Z]+-[0-9]{3}$/;

/** Required free-text fields of a rule definition. */
const TEXT_FIELDS = ['name', 'category', 'description', 'analysis_scope'] as const;

/** The two evidence policies a rule must declare. */
const POLICY_FIELDS = ['unknown_evidence_policy', 'conflicting_evidence_policy'] as const;

/** Advisory documentation fields — optional, but non-empty when present. */
const ADVISORY_FIELDS = ['rationale', 'limitations', 'docsUrl'] as const;

/** The numeric thresholds an evaluation carries. */
const THRESHOLD_FIELDS = ['pass_at_least', 'fail_at_most'] as const;

/** Guard 1 — identity: id shape (aspect 1) + required free-text fields (aspect 2). */
function guardIdentity(rule: RuleMetadata): string[] {
  const errors: string[] = [];
  if (typeof rule.id !== 'string' || !ID_PATTERN.test(rule.id)) {
    errors.push(`id must match ${ID_PATTERN.source} (got ${String(rule.id)})`);
  }
  for (const field of TEXT_FIELDS) {
    if (typeof rule[field] !== 'string' || rule[field].trim() === '') {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  return errors;
}

/** Guard 2 — classification: applies_to (aspect 3), required_evidence (aspect 4),
 *  minimum completeness (aspect 5), evidence policies (aspect 6). */
function guardClassification(rule: RuleMetadata): string[] {
  const errors: string[] = [];

  if (!Array.isArray(rule.applies_to) || rule.applies_to.length === 0) {
    errors.push('applies_to must list at least one test type');
  } else {
    for (const type of rule.applies_to) {
      if (!Object.values(TestType).includes(type)) {
        errors.push(`applies_to contains unknown test type ${String(type)}`);
      }
      if (type === TestType.UNKNOWN) {
        errors.push('applies_to must not contain UNKNOWN — an unknown type is INDETERMINATE, not a rule input');
      }
    }
    const seenTypes = new Set(rule.applies_to);
    if (seenTypes.size !== rule.applies_to.length) {
      errors.push('applies_to contains a duplicate test type');
    }
  }

  if (!Array.isArray(rule.required_evidence) || rule.required_evidence.length === 0) {
    errors.push('required_evidence must list at least one evidence type');
  } else {
    for (const evidence of rule.required_evidence) {
      if (typeof evidence !== 'string' || evidence.trim() === '') {
        errors.push('required_evidence contains an empty evidence type');
      }
    }
    if (new Set(rule.required_evidence).size !== rule.required_evidence.length) {
      errors.push('required_evidence contains a duplicate evidence type');
    }
  }

  if (!Object.values(CollectionStatus).includes(rule.minimum_evidence_completeness)) {
    errors.push(
      `minimum_evidence_completeness must be a CollectionStatus (got ${String(rule.minimum_evidence_completeness)})`,
    );
  }

  const policyValues = Object.values(RuleResult);
  for (const field of POLICY_FIELDS) {
    if (!policyValues.includes(rule[field])) {
      errors.push(`${field} must be a RuleResult (got ${String(rule[field])})`);
    }
  }

  return errors;
}

/** Guard 3 — evaluation lifecycle: evaluation object/metric/thresholds/order (aspect 7),
 *  severity (aspect 8), status (aspect 9), advisory fields (aspect 10). */
function guardEvaluationLifecycle(rule: RuleMetadata): string[] {
  const errors: string[] = [];

  const evaluation = rule.evaluation;
  if (typeof evaluation !== 'object' || evaluation === null) {
    errors.push('evaluation must be an object with metric, pass_at_least and fail_at_most');
  } else {
    if (typeof evaluation.metric !== 'string' || evaluation.metric.trim() === '') {
      errors.push('evaluation.metric must be a non-empty string');
    } else if (Array.isArray(rule.required_evidence) && !rule.required_evidence.includes(evaluation.metric)) {
      errors.push(`evaluation.metric "${evaluation.metric}" is not in required_evidence`);
    }
    for (const field of THRESHOLD_FIELDS) {
      if (!Number.isFinite(evaluation[field])) {
        errors.push(`evaluation.${field} must be a finite number (got ${String(evaluation[field])})`);
      }
    }
    if (
      Number.isFinite(evaluation.pass_at_least) &&
      Number.isFinite(evaluation.fail_at_most) &&
      !(evaluation.pass_at_least > evaluation.fail_at_most)
    ) {
      errors.push('evaluation.pass_at_least must be greater than evaluation.fail_at_most');
    }
  }

  if (!['error', 'warning', 'info'].includes(rule.severity)) {
    errors.push(`severity must be error|warning|info (got ${String(rule.severity)})`);
  }

  const statusValues = Object.values(RuleStatus);
  if (!statusValues.includes(rule.status)) {
    errors.push(`status must be ${statusValues.join('|')} (got ${String(rule.status)})`);
  }
  if (
    rule.status === RuleStatus.DEPRECATED &&
    (typeof rule.deprecatedSince !== 'string' || rule.deprecatedSince.trim() === '')
  ) {
    errors.push('deprecatedSince must be a non-empty string when status is deprecated');
  }

  for (const field of ADVISORY_FIELDS) {
    const value = rule[field];
    if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
      errors.push(`${field}, when present, must be a non-empty string`);
    }
  }

  return errors;
}

/**
 * Validate a rule DEFINITION, purely (WP2.1, plan task 23).
 *
 * Returns every problem found, so a malformed rule reports all its defects at
 * once instead of one per run. Empty array = valid.
 *
 * The ten aspects (1-10) are checked by three module-private guards, in this
 * order, so the reported error strings and their order are exactly what the
 * prior ten-validator implementation produced. Grouping keeps each guard under
 * the change-quality CRAP threshold (task 66).
 *
 * `status` IS enforced here (plan task 5.4): it must be a `RuleStatus` member,
 * and a DEPRECATED rule must carry a non-empty `deprecatedSince` version (D7).
 *
 * The status values are OPERATIONAL, not advisory metadata: a DRAFT rule is
 * excluded from the default run and is evaluated only when it is named
 * explicitly via --rule; a DEPRECATED rule still runs and is reported until
 * the version named by `deprecatedSince` is removed.
 */
export function validateRule(rule: RuleMetadata): string[] {
  return [...guardIdentity(rule), ...guardClassification(rule), ...guardEvaluationLifecycle(rule)];
}

/** Re-registering an id replaces the entry — last registration wins. */
export function registerRule(rule: RuleMetadata): void {
  const errors = validateRule(rule);
  if (errors.length > 0) {
    throw new Error(`Invalid rule definition${typeof rule.id === 'string' ? ` ${rule.id}` : ''}: ${errors.join('; ')}`);
  }
  rules.set(rule.id, rule);
}

export function getRule(id: string): RuleMetadata | undefined {
  return rules.get(id);
}

/** All rules currently registered, in registration order. */
export function allRules(): RuleMetadata[] {
  return Array.from(rules.values());
}

/**
 * Derived membership for the config threshold-rejection contract
 * (hook-based local-decision rules). Does not include thresholds_inert
 * rules — see thresholdsInertRuleIds().
 */
export function localDecisionRuleIds(): string[] {
  return Array.from(rules.values())
    .filter((rule) => hasLocalDecisionHook(rule))
    .map((rule) => rule.id);
}

/**
 * Derived membership for rules whose numeric thresholds are inert (cannot
 * influence the verdict). Combined with localDecisionRuleIds() to form the
 * config threshold-rejection set.
 */
export function thresholdsInertRuleIds(): string[] {
  return Array.from(rules.values())
    .filter((rule) => rule.thresholds_inert === true)
    .map((rule) => rule.id);
}
