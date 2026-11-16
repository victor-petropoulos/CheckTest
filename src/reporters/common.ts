/**
 * Shared reporter helpers (architecture deepening T4).
 *
 * Serialization ONLY: both reporters (json.ts, sarif.ts) import from here so
 * neither depends on the other. Only genuinely shared logic lives here — the
 * location shapes differ between reporters (JSON `{file,line,column}` vs SARIF
 * `physicalLocation{artifactLocation:{uri},region:{...}}`) and are deliberately
 * NOT unified.
 */

import { AnalysisOutput } from '../core/analysis';
import { EvaluationResult, TestEvaluation } from '../core/result';
import { CT_MUT_001 } from '../rules/ct-mut-001';

/**
 * The scope list BOTH reporters serialize: one entry per evaluation the caller
 * supplied, or the single subject-level fallback when the envelope never carried
 * per-test records.
 *
 * Moved verbatim from json.ts (was `export function evaluationScopes`) so the
 * SARIF reporter shares the ONE authoritative absent-vs-empty decision (WP1.1,
 * UD-8) instead of duplicating it.
 */
export function evaluationScopes(
  analysis: AnalysisOutput,
  evaluation: EvaluationResult,
  evaluations: readonly TestEvaluation[],
): readonly TestEvaluation[] {
  // Legacy envelope: no per-test records at all → single subject-level entry.
  if (analysis.tests === undefined && evaluations.length === 0) {
    return [
      {
        test: null,
        status: evaluation.status,
        finding: evaluation.finding,
      },
    ];
  }
  // File-level evidence (CT-MUT-001's mutation_score): attached to the subject
  // envelope by applyMutationReport and never to a per-declaration scope. The
  // subject-level verdict would otherwise be computed (cli.ts evaluateRule) and
  // then dropped from ruleResults whenever the file declares tests. Surface it
  // alongside the per-test findings, distinguishable by the absence of test_id.
  // Only when mutation_score is present on the subject and absent from EVERY
  // per-declaration scope, so per-test rules (coverage, assertion counts) keep
  // their single "no aggregate" verdict and never leak a file-level duplicate.
  const hasFileLevelMutationEvidence =
    analysis.tests !== undefined &&
    analysis.tests.length > 0 &&
    evaluations.length > 0 &&
    evaluation.finding !== null &&
    evaluation.finding.rule_id === CT_MUT_001.id &&
    analysis.evidence.mutation_score !== undefined &&
    analysis.tests.every((scope) => scope.evidence?.mutation_score === undefined);
  if (hasFileLevelMutationEvidence) {
    return [
      ...evaluations,
      {
        test: null,
        status: evaluation.status,
        finding: evaluation.finding,
      },
    ];
  }
  return evaluations;
}
