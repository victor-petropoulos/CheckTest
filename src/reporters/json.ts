/**
 * JSON reporter (plan task 6; SPEC:226-279 + 386-401).
 *
 * Serialization ONLY. This module turns an `AnalysisOutput` and the engine's
 * findings into a string. It never evaluates a rule, never reads a file and
 * never decides anything — the composition point (`src/cli.ts`) owns all wiring
 * (plan task-6 seam: "zero evaluation logic; owning layers: collector/engine/
 * reporter").
 *
 * Shape: the SPEC's flat report envelope (SPEC:386-401) carrying the subject,
 * evidence and rule results produced upstream. `analysisStatus`,
 * `evaluationStatus` and `completeness` stay at the TOP level and separate from
 * `ruleResults` (SPEC:366) — an aborted evaluation reports
 * `evaluationStatus: FAILED` and an EMPTY `ruleResults` array, never a synthetic
 * verdict, and never a bare INDETERMINATE that a consumer could mistake for a
 * rule which ran (SPEC:405). The engine decides that status; this module only
 * serializes it.
 *
 * Per-test records (plan task 7): `testResults[]` carries one entry per
 * declaration the collector located, each with its own identity, analysis
 * status, evidence and findings, and `summary` counts the verdicts across the
 * scopes. Both are appended LAST, so a consumer reading the original keys sees
 * unchanged bytes. `ruleResults` is the flattened list — one authoritative
 * flattening, no file-level aggregate beside it.
 *
 * Determinism (plan §1, D9): no clock, no timestamps, no environment reads.
 * Key order is the literal construction order below, and `JSON.stringify`
 * preserves creation order for non-numeric keys, so the same input always
 * serializes byte-identically.
 */

import { AnalysisOutput, TestScopeResult } from '../core/analysis';
import { evaluationScopes } from './common';
import { EvidenceConflict, EvidenceLocation, EvidenceRecord } from '../core/evidence';
import { EvaluationResult, EvaluationStatus, RuleFinding, RuleResult, TestEvaluation } from '../core/result';

/** Free-form JSON object; every level is assembled explicitly, in order. */
type Json = Record<string, unknown>;

/**
 * Wire-contract version of the report envelope (plan task 7). A consumer that
 * reads `testResults`/`summary` can check this without guessing which keys
 * exist. Bumped only when the shape changes meaning — never per run, never with
 * a timestamp.
 *
 * 0.5 adds the OPTIONAL `adapter`/`decidedBy` envelope fields (ADR-035):
 * additive only — nothing removed, nothing renamed — so a consumer reading the
 * original keys sees unchanged bytes, and a consumer reading the new keys
 * checks `schemaVersion` first.
 */
export const REPORT_SCHEMA_VERSION = '0.5';

function locationJson(location: EvidenceLocation): Json {
  return {
    file: location.file,
    line: location.line,
    column: location.column,
  };
}

function setIfPresent(target: Json, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function serializeConflict(conflict: EvidenceConflict): Json {
  return {
    // JSON has no `undefined`; absent and null are the same wire value.
    value: conflict.value === undefined ? null : conflict.value,
    source: conflict.source,
    provenance: conflict.provenance,
    collector_version: conflict.collector_version,
  };
}

function serializeEvidence(record: EvidenceRecord): Json {
  // `type` is omitted on purpose: the key this record sits under already names
  // it (SPEC:250), so repeating it would be the only field needing a rename.
  const json: Json = {
    // A record that produced no value reports null rather than vanishing, so the
    // field set of an evidence item never depends on what the collector knew.
    value: record.value === undefined ? null : record.value,
    availability: record.availability,
    provenance: record.provenance,
    source: record.source,
    collector_version: record.collector_version,
    scope: record.scope,
    coverage: {
      status: record.coverage.status,
      supported_frameworks: [...record.coverage.supported_frameworks],
      supported_assertion_forms: [...record.coverage.supported_assertion_forms],
    },
  };
  // Appended after the fixed fields and only when present, so key order stays
  // identical for every record regardless of which optionals it carries.
  setIfPresent(json, 'reason', record.reason);
  if (record.location !== undefined) {
    json.location = locationJson(record.location);
  }
  // An empty conflicts array carries no information and is dropped; a populated
  // one preserves BOTH disagreeing values with their provenance (plan A4).
  if (record.conflicts !== undefined && record.conflicts.length > 0) {
    json.conflicts = record.conflicts.map(serializeConflict);
  }
  // DPC-4 (WP4.1): external provenance fields — emitted only when present.
  setIfPresent(json, 'provider', record.provider);
  setIfPresent(json, 'provider_version', record.provider_version);
  setIfPresent(json, 'source_revision', record.source_revision);
  // Phase 3 (Unit A): per-declaration additive evidence fields — emitted only
  // when present (never as `{count:0, reasons:[]}`), so consumers reading
  // older records see unchanged bytes.
  if (record.unestablished_assertions !== undefined) {
    json.unestablished_assertions = record.unestablished_assertions;
  }
  if (record.unclassified_constructs !== undefined) {
    json.unclassified_constructs = record.unclassified_constructs;
  }
  return json;
}

function serializeFinding(finding: RuleFinding, testId: string | null): Json {
  const json: Json = {
    rule_id: finding.rule_id,
    result: finding.result,
    reason: finding.reason,
    evidence: [...finding.evidence],
  };
  // Appended LAST and ONLY for a per-test scope: a subject-level (synthetic)
  // envelope keeps its exact four-key finding, byte for byte.
  if (testId !== null) {
    json.test_id = testId;
  }
  // B7 prerequisite: copy the finding location (if any) LAST, so the existing
  // key order is preserved and no position is fabricated. Column is dropped by
  // JSON.stringify when undefined, matching serializeEvidence.
  if (finding.location !== undefined) {
    json.location = locationJson(finding.location);
  }
  return json;
}

/** One finding, or none — an aborted scope carries no verdict, never a stand-in. */
function serializeFindings(finding: RuleFinding | null, testId: string | null): Json[] {
  return finding === null ? [] : [serializeFinding(finding, testId)];
}

/**
 * One declaration's slice of the report (plan task 7): its OWN identity, own
 * analysis status, own evidence and own findings. Nothing here is derived from
 * a sibling, so a per-test FAIL can never be masked by a file-level PASS and a
 * file-level FAIL can never be attributed to a test that did not earn it.
 */
function serializeTestResult(scope: TestScopeResult, evaluation: TestEvaluation): Json {
  return {
    test: {
      id: scope.test.id,
      name: scope.test.name,
      line: scope.test.line,
      declaration: scope.test.declaration,
    },
    analysisStatus: scope.analysis.status,
    evaluationStatus: evaluation.status,
    completeness: scope.analysis.completeness,
    evidence: Object.fromEntries(
      Object.entries(scope.evidence).map(([type, record]) => [type, serializeEvidence(record)]),
    ),
    ruleResults: serializeFindings(evaluation.finding, evaluation.test?.id ?? null),
  };
}

/**
 * Verdict counts across the evaluation scopes. `failed` is the scopes that did
 * NOT end in a clean PASS: a FAIL verdict plus a scope the engine aborted
 * (EvaluationStatus.FAILED), which has no verdict at all and so never appears
 * in the per-result counts.
 */
function summarize(scopes: readonly TestEvaluation[]): Json {
  const summary = {
    total: scopes.length,
    pass: 0,
    fail: 0,
    indeterminate: 0,
    not_applicable: 0,
    failed: 0,
  };
  for (const scope of scopes) {
    const finding = scope.finding;
    if (finding === null) {
      summary.failed += 1;
      continue;
    }
    if (finding.result === RuleResult.PASS) {
      summary.pass += 1;
    } else if (finding.result === RuleResult.FAIL) {
      summary.fail += 1;
      summary.failed += 1;
    } else if (finding.result === RuleResult.INDETERMINATE) {
      summary.indeterminate += 1;
    } else {
      summary.not_applicable += 1;
    }
  }
  return summary;
}

/**
 * Serialize one subject's analysis plus the engine's evaluation as
 * pretty-printed JSON.
 *
 * @param analysis envelope produced by the collector
 * @param evaluation the subject-level evaluation — used only when no per-test
 *   evaluation set is supplied, so a synthetic subject-level envelope keeps its
 *   exact previous bytes
 * @param evaluations one entry per `analysis.tests[]` declaration, in
 *   declaration order (`evaluateTests`); falls back to the single subject-level
 *   scope ONLY when `analysis.tests` is absent (a legacy envelope)
 */
export function toJson(
  analysis: AnalysisOutput,
  evaluation: EvaluationResult,
  evaluations: readonly TestEvaluation[] = [],
): string {
  // ponytail: one shape of scope list — the per-test set when the envelope
  // SUPPLIED one, otherwise the single subject-level entry a legacy caller means.
  //
  // WP1.1 — ABSENT is not EMPTY. A legacy envelope with no `tests` field keeps
  // the documented subject-level fallback. An envelope that supplied the field
  // holds the engine's set AS GIVEN: zero evaluations means "no test was
  // evaluated", and re-materializing the subject scope here would rebuild the
  // synthetic `test: null` finding the evaluator deliberately refused to produce.
  //
  // NO-TESTS, EXPLICITLY (user_decisions UD-8, resolving DPC-2 on 2026-10-16): an
  // envelope carrying `tests: []` is the EMPTY case, so `scopes` is `[]` — zero
  // scopes, not one subject-level scope. That is the SAME "no verdict" bucket an
  // aborted evaluation occupies, which is why the `evaluationStatus` expression
  // below reads FAILED here. Read that FAILED as "the engine reached no
  // verdict", NOT as an analysis failure: `analysisStatus` stays SUCCESS because
  // the analysis itself completed, and no rule FAIL is emitted (`ruleResults`
  // stays empty). The CLI maps the same zero-scope case to exit 2.
  const scopes = evaluationScopes(analysis, evaluation, evaluations);

  // ABSENT is not EMPTY here either — this loop only decides WHICH declarations
  // get a record, never whether a scope exists that had none.
  const tests = analysis.tests === undefined ? [] : analysis.tests;
  const testResults = tests.flatMap((scope, index) => {
    const perTest = index < evaluations.length ? evaluations[index] : undefined;
    // Only a scope the engine actually evaluated per TEST is reported. The
    // subject-level fallback is never copied onto a declaration — that would be
    // the file-level verdict leak (plan D1) restated one level down.
    return perTest !== undefined && perTest.test !== null ? [serializeTestResult(scope, perTest)] : [];
  });

  const report: Json = {
    test: {
      id: analysis.subject.id,
      name: analysis.subject.name,
      file: analysis.subject.file,
      language: analysis.subject.language,
      framework: analysis.subject.framework,
      type: analysis.subject.type,
    },
    analysisStatus: analysis.analysis.status,
    // The engine's own reach: a verdict was produced, or the evaluation aborted.
    // Over several scopes, EVALUATED wins if ANY scope produced a verdict.
    evaluationStatus: scopes.some((scope) => scope.status === EvaluationStatus.EVALUATED)
      ? EvaluationStatus.EVALUATED
      : EvaluationStatus.FAILED,
    completeness: analysis.analysis.completeness,
    scope: analysis.analysis.scope,
    test_type: analysis.analysis.test_type,
    capabilities: analysis.capabilities,
    evidence: Object.fromEntries(
      Object.entries(analysis.evidence).map(([type, record]) => [type, serializeEvidence(record)]),
    ),
    // Flattened, in scope order: one authoritative list. There is deliberately
    // NO separate file-level aggregate verdict beside it — an aggregate PASS
    // next to a per-test FAIL is the same leak (plan task 7, open question).
    ruleResults: scopes.flatMap((scope) => serializeFindings(scope.finding, scope.test?.id ?? null)),
    // Everything below is appended LAST so a consumer reading only the original
    // keys above sees unchanged bytes. The two optional dispatch keys sit
    // inside that block, between `schemaVersion` and the per-test keys.
    schemaVersion: REPORT_SCHEMA_VERSION,
    // ADR-035: the dispatch decision travels with the envelope. Both keys are
    // OPTIONAL and additive — present only when the analysis carries them — and
    // they sit between `schemaVersion` and the per-test keys, so a consumer
    // reading the original keys still sees them in the same order.
    ...(analysis.adapter !== undefined ? { adapter: analysis.adapter } : {}),
    ...(analysis.decidedBy !== undefined ? { decidedBy: analysis.decidedBy } : {}),
    testResults,
    summary: summarize(scopes),
  };
  return JSON.stringify(report, null, 2);
}
