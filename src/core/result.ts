/**
 * Rule result + finding shape (plan task 2; SPEC:15-20, 489-525).
 *
 * The result dimension is SEPARATE from analysis status and evidence
 * completeness (SPEC:366) — never collapse them.
 */

import { TestIdentity } from './analysis';
import { EvidenceLocation, EvidenceStrength } from './evidence';
// The lifecycle status of the rule a finding came from (plan task 5.6).
//
// TYPE-ONLY import, deliberately: src/core/rule.ts imports THIS module, so a
// value import would close a runtime cycle (result -> rule -> result).
// `import type` is erased at compile time, so the cycle stays type-level.
import type { RuleStatus } from './rule';

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
  /**
   * The version in which the evaluated rule was deprecated, when the rule
   * declares one (D7). Absent for every rule that does not — the key is
   * omitted, never an empty string.
   */
  deprecatedSince?: string;
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
  /**
   * The version in which the evaluated rule was deprecated, when the rule
   * declares one (D7). Absent for every rule that does not — the key is
   * omitted, never an empty string.
   */
  deprecatedSince?: string;
}

/** One rule's verdict for one subject. Reason is always present — no silent verdicts. */
export interface RuleFinding {
  rule_id: string;
  result: RuleResult;
  reason: string;
  /** Evidence types the rule consulted, in evaluation order. */
  evidence: string[];
  /**
   * The lifecycle status of the rule that produced this finding (plan task 5.6;
   * the RuleStatus contract of src/core/rule.ts).
   *
   * REQUIRED, never optional: a finding IS one rule's verdict, so the rule's
   * lifecycle state is part of that verdict's identity. A consumer reading a
   * finding can then tell an active rule's verdict from a deprecated rule's
   * without resolving the rule registry. One of 'active' | 'draft' |
   * 'deprecated' — never an empty string, never absent.
   */
  ruleStatus: RuleStatus;
  /** Source location copied from the evidence record when one exists (null-able; never fabricated). */
  location?: EvidenceLocation;
  /**
   * The rule's own description, copied from the evaluated rule's RuleMetadata
   * (src/core/rule.ts) — plan task 6.1, SELF-CONTAINED findings.
   *
   * The four fields below (description, rationale, limitations, docsUrl) are
   * COPIES of the rule's metadata, never re-authored: a consumer reading a
   * finding learns WHAT the rule checks and WHAT IT DOES NOT ESTABLISH without
   * resolving the rule registry.
   *
   * Additive and OPTIONAL (D11): the key is OMITTED when the rule declares no
   * such metadata — never an empty string, never invented, never a default.
   */
  description?: string;
  /** WHY the rule exists (RuleMetadata.rationale) — copied, never re-authored. */
  rationale?: string;
  /** What the rule's verdict does NOT establish (RuleMetadata.limitations). */
  limitations?: string;
  /** Reference into the spec/docs for the rule's own definition (RuleMetadata.docsUrl). */
  docsUrl?: string;
  /**
   * D10 — HOW the evidence the verdict rests on was established
   * (src/core/evidence.ts `EvidenceStrength`): SYNTAX_OBSERVED /
   * EXECUTION_ESTABLISHED / UNSUPPORTED.
   *
   * Copied from the evidence record the finding was decided FROM — never
   * derived, never guessed, never promoted. ABSENT when the verdict rests on no
   * evidence record (an applicability or UNSUPPORTED verdict) or when that
   * record carries no strength of its own (an adapter that does not classify
   * strength yet). It never substitutes for `availability`: strength is not a
   * certainty.
   */
  evidenceStrength?: EvidenceStrength;
}
