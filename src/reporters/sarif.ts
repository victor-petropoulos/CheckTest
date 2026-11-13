/**
 * SARIF 2.1.0 reporter (WP4.3, roadmap:1157-1184).
 *
 * Serialization ONLY, exactly like `json.ts`: this module turns the engine's
 * findings into a SARIF log string. It never evaluates a rule, never reads a
 * file and never decides anything — the composition point (`src/cli.ts`) owns
 * all wiring. Like `json.ts` it imports nothing from `src/core/evaluation`.
 *
 * Decisions this reporter encodes (each is a roadmap acceptance criterion):
 *
 *   severity ≠ result. Each result's `level` is derived from the RULE RESULT
 *   alone, through the documented, total table `SARIF_LEVEL_BY_RESULT`. The
 *   rule's own declared severity is recorded SEPARATELY at
 *   `runs[0].tool.driver.rules[].properties.severity`, and the raw result is
 *   preserved at `results[].properties.result`. Nothing is conflated, so a rule
 *   of severity 'error' that FAILs still maps to level 'warning'.
 *
 *   levels are valid SARIF. The 2.1.0 schema (fetched from
 *   https://json.schemastore.org/sarif-2.1.0.json) constrains `result.level` to
 *   ["none","note","warning","error"]. There is no "info" level, so an
 *   INDETERMINATE verdict maps to 'note' rather than a level a strict validator
 *   would reject.
 *
 *   diagnostics are not findings (roadmap task 5). An UNSUPPORTED or FAILED
 *   analysis is a property of the RUN, never a synthetic rule result: the
 *   analysis/evaluation status and completeness live at `runs[0].properties`,
 *   and `results[]` carries exactly the engine's rule findings (empty when the
 *   engine reached no verdict). No diagnostic is ever emitted as a result.
 *
 *   locations are honest. A result carries `locations[]` only when its finding
 *   carries a source location — copied from the evidence record that produced
 *   the verdict (B7 prerequisite, commit 347a04f). A finding with no location
 *   gets NO `locations` key; a precise position is never fabricated.
 *
 * Determinism (plan §1, D9): no clock, no timestamps, no environment reads.
 * `JSON.stringify` preserves the literal construction order below, so the same
 * input always serializes byte-identically.
 */

import { AnalysisOutput } from '../core/analysis';
import { EvidenceLocation } from '../core/evidence';
import { EvaluationResult, EvaluationStatus, RuleFinding, RuleResult, TestEvaluation } from '../core/result';
import { RuleMetadata } from '../core/rule';
import { evaluationScopes } from './common';
// ponytail: the collector's version IS the tool version — one source of truth
// (support.ts:40), not a second constant to keep in sync. This is a constant-only
// import; `support.ts` also imports `typescript`, which the CLI already loads.
import { COLLECTOR_VERSION } from '../adapters/typescript/support';

/** The SARIF format version this reporter emits. */
export const SARIF_VERSION = '2.1.0';

/** The canonical 2.1.0 schema URI (json.schemastore.org; checkchange 0.5.1+ accepts it). */
export const SARIF_SCHEMA_URI = 'https://json.schemastore.org/sarif-2.1.0.json';

/** The producer name recorded on the driver. */
export const SARIF_TOOL_NAME = 'CheckTest';

/** Free-form JSON object; every level is assembled explicitly, in order. */
type Json = Record<string, unknown>;

/** The four levels SARIF 2.1.0 permits for a result. */
export type SarifLevel = 'none' | 'note' | 'warning' | 'error';

/**
 * The documented result → level table (THE non-conflation boundary). `level` is
 * a property of the RESULT, never of the rule's declared `severity`. Total over
 * `RuleResult`, and every value is in the SARIF 2.1.0 enum.
 *
 *   FAIL          → warning  (a decided failure the CLI does not gate on)
 *   INDETERMINATE → note     (not "info": SARIF has no such level)
 *   PASS          → none
 *   N/A           → none
 */
export const SARIF_LEVEL_BY_RESULT: Readonly<Record<RuleResult, SarifLevel>> = {
  [RuleResult.FAIL]: 'warning',
  [RuleResult.INDETERMINATE]: 'note',
  [RuleResult.PASS]: 'none',
  [RuleResult.N_A]: 'none',
};

/** A SARIF physicalLocation: the file uri plus a line-only (or line+column) region. */
function physicalLocation(location: EvidenceLocation): Json {
  // Column is absent on every shipped record (WP4.3 audit: line-only producers);
  // it is emitted only when actually known, so a region never carries a null column.
  const region: Json =
    location.column === undefined
      ? { startLine: location.line }
      : { startLine: location.line, startColumn: location.column };
  return {
    physicalLocation: {
      artifactLocation: { uri: location.file },
      region,
    },
  };
}

/** One finding → one SARIF result. Location present only when the finding has one. */
function serializeResult(finding: RuleFinding): Json {
  const result: Json = {
    ruleId: finding.rule_id,
    level: SARIF_LEVEL_BY_RESULT[finding.result],
    message: { text: finding.reason },
    // The raw RuleResult, preserved un-conflated with `level`.
    properties: { result: finding.result },
  };
  // Appended LAST and ONLY when known: an unknown position is never fabricated.
  if (finding.location !== undefined) {
    result.locations = [physicalLocation(finding.location)];
  }
  return result;
}

/** The driver's rule descriptor: id, short description, and the rule's own metadata. */
function serializeRule(rule: RuleMetadata): Json {
  return {
    id: rule.id,
    shortDescription: { text: rule.name },
    // Rule-severity lives HERE, separate from every result's `level`.
    properties: { severity: rule.severity, category: rule.category },
  };
}

/**
 * Serialize one subject's analysis plus the engine's evaluation as a SARIF 2.1.0
 * log.
 *
 * @param analysis envelope produced by the collector
 * @param evaluation the subject-level evaluation (fallback scope)
 * @param rule the evaluated rule, for the driver's rule descriptor
 * @param evaluations one entry per `analysis.tests[]` declaration, in
 *   declaration order; falls back to the single subject-level scope exactly as
 *   `toJson` does, via the shared `evaluationScopes`.
 */
export function toSarif(
  analysis: AnalysisOutput,
  evaluation: EvaluationResult,
  rule: RuleMetadata,
  evaluations: readonly TestEvaluation[] = [],
): string {
  const scopes = evaluationScopes(analysis, evaluation, evaluations);
  const findings = scopes.flatMap((scope) => (scope.finding === null ? [] : [scope.finding]));
  const evaluationStatus = scopes.some((scope) => scope.status === EvaluationStatus.EVALUATED)
    ? EvaluationStatus.EVALUATED
    : EvaluationStatus.FAILED;

  const log: Json = {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: SARIF_TOOL_NAME,
            version: COLLECTOR_VERSION,
            rules: [serializeRule(rule)],
          },
        },
        // Diagnostics live on the RUN, never as a rule result (roadmap task 5).
        properties: {
          analysisStatus: analysis.analysis.status,
          evaluationStatus,
          completeness: analysis.analysis.completeness,
        },
        // Exactly the engine's findings: empty when it reached no verdict.
        results: findings.map(serializeResult),
      },
    ],
  };
  return JSON.stringify(log, null, 2);
}
