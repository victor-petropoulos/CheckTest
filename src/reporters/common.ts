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
  return analysis.tests === undefined && evaluations.length === 0
    ? [
        {
          test: null,
          status: evaluation.status,
          finding: evaluation.finding,
        },
      ]
    : evaluations;
}
