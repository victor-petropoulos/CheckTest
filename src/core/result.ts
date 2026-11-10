/**
 * Rule result + finding shape (plan task 2; SPEC:15-20, 489-525).
 *
 * The result dimension is SEPARATE from analysis status and evidence
 * completeness (SPEC:366) — never collapse them.
 */

import { TestIdentity } from './analysis';
import { EvidenceLocation } from './evidence';

export enum RuleResult {
  PASS = 'PASS',
  FAIL = 'FAIL',
  /** The rule applies, but evidence is insufficient, incomplete, or conflicting (SPEC:19). */
  INDETERMINATE = 'INDETERMINATE',
  /** The rule does not apply to this subject (SPEC:20, 472-473). */
  N_A = 'N/A',
}

/**
 * Whether the engine reached a verdict AT ALL — a fourth dimension, distinct
 * from analysis status and from every RuleResult (SPEC:366,405).
 *
 * FAILED is not a verdict. A required analysis step failed, so the rule was
 * never asked: no RuleResult exists and none is invented, and in particular no
 * bare INDETERMINATE stands in for the abort (SPEC:405 forbids implying a clean
 * result). Consumers read this field instead of inferring "aborted" from an
 * empty findings array.
 */
export enum EvaluationStatus {
  /** The rule was decided; `finding` is non-null and carries a RuleResult. */
  EVALUATED = 'EVALUATED',
  /** A required analysis step failed — the rule was not evaluated (SPEC:405). */
  FAILED = 'FAILED',
}

/** The engine's output for one rule over one subject: the status plus its verdict. */
export interface EvaluationResult {
  status: EvaluationStatus;
  /** Non-null exactly when `status` is EVALUATED; never a fabricated verdict. */
  finding: RuleFinding | null;
}

/**
 * The engine's output for one rule over one SCOPE — one test declaration, or
 * the subject itself when the analysis carries no per-test records (plan task
 * 4, `evaluateTests`). Same status/finding semantics as EvaluationResult, so
 * EvaluationStatus is never redefined per scope: FAILED is still not a
 * verdict and is still never laundered into INDETERMINATE (SPEC:405).
 */
export interface TestEvaluation {
  /** Per-test identity; null for the single subject-level (fallback) entry. */
  test: TestIdentity | null;
  status: EvaluationStatus;
  /** Non-null exactly when `status` is EVALUATED; never a fabricated verdict. */
  finding: RuleFinding | null;
}

/** One rule's verdict for one subject. Reason is always present — no silent verdicts. */
export interface RuleFinding {
  rule_id: string;
  result: RuleResult;
  reason: string;
  /** Evidence types the rule consulted, in evaluation order. */
  evidence: string[];
  /** Source location copied from the evidence record when one exists (null-able; never fabricated). */
  location?: EvidenceLocation;
}
