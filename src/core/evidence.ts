/**
 * Normalized evidence contract (plan task 2; SPEC:285-425).
 *
 * Core is language-agnostic: this module must never import `typescript`.
 * Adapters (src/adapters/*) produce these records; the engine (src/core/evaluation.ts,
 * task 4) consumes them. Nothing here knows about rules.
 *
 * Two independent dimensions, per SPEC:330:
 *   provenance  — WHERE the value came from (not a confidence score)
 *   availability— WHETHER the collector could decide the value at all
 */

/**
 * SPEC:306-328 — identifies the evidence source, not certainty.
 *
 * EXTERNAL was unreachable until WP4.1 (DPC-3, closed 2026-10-17: document
 * reachability only, no fake producer built for it). Since WP4.1 task 56b the
 * coverage provider (src/providers/coverage.ts) is a real EXTERNAL producer.
 *
 * DPC-4 (WP4.1, task 56a): provider identity/version/revision fields are
 * present on `EvidenceRecord` (provider?, provider_version?, source_revision?),
 * together with the REPORT_SCHEMA_VERSION bump to '0.4' (current version: '0.5',
 * ADR-035). They remain optional and
 * only meaningful when provenance === EXTERNAL.
 */
export enum Provenance {
  DIRECT = 'DIRECT',
  DERIVED = 'DERIVED',
  EXTERNAL = 'EXTERNAL',
}

/** SPEC:334-360 — every evidence value must distinguish known / unknown / not applicable. */
export enum Availability {
  KNOWN = 'KNOWN',
  UNKNOWN = 'UNKNOWN',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

/**
 * Core-owned, single source of truth for the evidence/analysis scope value ('test-body').
 * Adapters re-export this as ANALYSIS_SCOPE so adapter code uses its own name; the alias
 * must stay value-identical (seam), never diverge or be renamed independently.
 */
export const EVIDENCE_SCOPE_TEST_BODY = 'test-body';

/** Closed set of evidence type ids thresholded by rules. */
export const EVIDENCE_TYPES = ['assertion_count', 'line_coverage', 'mutation_score'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** SPEC:421 — what the collector examined and what it knows how to recognize. */
export enum CollectionStatus {
  COMPLETE = 'COMPLETE',
  PARTIAL = 'PARTIAL',
  UNAVAILABLE = 'UNAVAILABLE',
}

/** SPEC:414-423 — collection coverage for one evidence type. */
export interface EvidenceCoverage {
  status: CollectionStatus;
  supported_frameworks: string[];
  supported_assertion_forms: string[];
}

/** SPEC:296-301 — source location when the collector can point at it. */
export interface EvidenceLocation {
  file: string;
  line: number;
  column?: number;
}

/**
 * A4 OPTION A — per-evidence conflicts, alongside the primary value.
 * Both values and their provenance are preserved (SPEC:507 policy is applied
 * by the engine, not here). Conflicts do NOT imply incompleteness (SPEC:366).
 */
export interface EvidenceConflict {
  value: unknown;
  source: string;
  provenance: Provenance;
  collector_version: string;
}

/**
 * One normalized evidence item. Field names follow the report JSON shape
 * (SPEC:247-269) so serialization stays a rename-free copy.
 */
export interface EvidenceRecord {
  /** Evidence type id, e.g. 'assertion_count'. */
  type: string;
  value: unknown;
  availability: Availability;
  provenance: Provenance;
  /** Collector id, e.g. 'typescript-jest-adapter'. */
  source: string;
  /** Constant string — no timestamps (plan guardrail). */
  collector_version: string;
  /**
   * The ANALYSIS scope the collector scanned, e.g. 'test-body'
   * (`ANALYSIS_SCOPE`, src/adapters/typescript/support.ts:16).
   *
   * This is NOT the record's subject. It says which construct the collector
   * looked at; it never says WHICH test or file the value belongs to. Every
   * shipped producer fills the same constant, at file level
   * (collector.ts:339) and per declaration (collector.ts:411) alike, so the
   * string alone cannot distinguish the two.
   *
   * Subject attribution is STRUCTURAL, and deliberately not a field here:
   *   - a file-level aggregate record sits in `AnalysisOutput.evidence`
   *     (analysis.ts:109) and is the aggregate over the whole file;
   *   - a per-declaration record sits in that declaration's own
   *     `TestScopeResult.evidence` (analysis.ts:100, built at
   *     collector.ts:379-445) and covers that one declaration.
   *
   * The engine reads exactly one such map per scope
   * (src/core/evaluation.ts:152-162) and looks up one type inside it
   * (:96-98), so a sibling declaration's evidence has no path to a verdict.
   * A `test_id`/`subject` field would have no reader that does not already
   * have this context, and adding one would reach the JSON report
   * (src/reporters/json.ts:63-99) and require a REPORT_SCHEMA_VERSION bump.
   */
  scope: string;
  coverage: EvidenceCoverage;
  /** Required whenever the value is unknown, partial or unavailable. */
  reason?: string;
  location?: EvidenceLocation;
  conflicts?: EvidenceConflict[];
  /**
   * Phase 3 (Unit A) — per-declaration unestablished-assertion evidence.
   * Additive, optional: absent (undefined) when there are no unestablished
   * recognized assertions in the declaration; never serialized as `{count:0,
   * reasons:[]}`. Provenance DIRECT, scope `test-body`. Only meaningful on
   * per-declaration records; file-level aggregate records leave it unset.
   */
  unestablished_assertions?: { count: number; reasons: string[] };
  /**
   * Phase 3 (Unit A) — per-declaration unclassified-construct evidence.
   * Additive, optional: absent (undefined) when there are no unclassified
   * constructs in the declaration; never serialized as `{count:0, reasons:[]}`.
   * Provenance DIRECT, scope `test-body`. Only meaningful on per-declaration
   * records; file-level aggregate records leave it unset.
   */
  unclassified_constructs?: { count: number; reasons: string[] };
  /**
   * DPC-4 (WP4.1) — provider identity for EXTERNAL provenance records.
   * Only meaningful when `provenance === Provenance.EXTERNAL`; DIRECT and
   * DERIVED records never carry these. Undefined for non-EXTERNAL records and
   * absent from the serialized JSON when unset (rename-free copy).
   */
  provider?: string;
  /** Provider/tool version string. Only meaningful with EXTERNAL provenance. */
  provider_version?: string;
  /** Source revision the external evidence was derived from. Only meaningful with EXTERNAL provenance. */
  source_revision?: string;
  /**
   * CT-COV-001 — the coverage evidence came from a run SCOPED TO ONE TEST FILE
   * (`vitest run <file> --coverage`, design §1 "Marker mechanism").
   *
   * Additive, optional: absent (undefined) unless the caller opted in
   * (`--per-test-run` / `per_test_run` on `CoverageReportOptions`), so unmarked
   * input keeps ADR-031 semantics byte-identical. It describes the RUN SCOPE of
   * the parsed report, never a per-declaration attribution: the claim stays
   * "the mapped production file was exercised in the run of this test file".
   *
   * Only the coverage provider (src/providers/coverage.ts) sets it; DIRECT
   * records never carry it.
   */
  per_test_run?: boolean;
}

/**
 * Params for `makeEvidenceRecord`. Required fields mirror `EvidenceRecord`'s
 * required shape (type, value, availability, provenance, source, coverage).
 * `collector_version` and `scope` are optional with safe defaults (see factory).
 *
 * Discriminated on `provenance`: provider/provider_version/source_revision are
 * only legal when provenance === EXTERNAL. Passing them for DIRECT/DERIVED is a
 * compile error (excess-property check on the union member).
 */
export type MakeEvidenceBaseParams = {
  type: string;
  value: unknown;
  availability: Availability;
  source: string;
  coverage: EvidenceCoverage;
  collector_version?: string;
  scope?: string;
  reason?: string;
  location?: EvidenceLocation;
  conflicts?: EvidenceConflict[];
  unestablished_assertions?: { count: number; reasons: string[] };
  unclassified_constructs?: { count: number; reasons: string[] };
};

export type MakeEvidenceDirectParams = MakeEvidenceBaseParams & {
  provenance: Provenance.DIRECT | Provenance.DERIVED;
};

export type MakeEvidenceExternalParams = MakeEvidenceBaseParams & {
  provenance: Provenance.EXTERNAL;
  provider?: string;
  provider_version?: string;
  source_revision?: string;
};

export type MakeEvidenceParams = MakeEvidenceDirectParams | MakeEvidenceExternalParams;

/**
 * Single construction seam for `EvidenceRecord`. Hides the 16-field shape,
 * defaults `scope` to `EVIDENCE_SCOPE_TEST_BODY` and `collector_version` to ''
 * (empty — never a plausible version, so a caller that forgets to pass its
 * own version cannot masquerade as a real collector/provider; providers and the
 * adapter always pass their own). Provider identity fields are attached ONLY
 * when `provenance === EXTERNAL` and only when supplied, so DIRECT/DERIVED
 * records omit them entirely (no `provider: undefined` keys).
 */
export function makeEvidenceRecord(params: MakeEvidenceParams): EvidenceRecord {
  const record: EvidenceRecord = {
    type: params.type,
    value: params.value,
    availability: params.availability,
    provenance: params.provenance,
    source: params.source,
    collector_version: params.collector_version ?? '',
    scope: params.scope ?? EVIDENCE_SCOPE_TEST_BODY,
    coverage: params.coverage,
  };
  if (params.reason !== undefined) {
    record.reason = params.reason;
  }
  if (params.location !== undefined) {
    record.location = params.location;
  }
  if (params.conflicts !== undefined) {
    record.conflicts = params.conflicts;
  }
  if (params.unestablished_assertions !== undefined) {
    record.unestablished_assertions = params.unestablished_assertions;
  }
  if (params.unclassified_constructs !== undefined) {
    record.unclassified_constructs = params.unclassified_constructs;
  }
  if (params.provenance === Provenance.EXTERNAL) {
    const external = params as MakeEvidenceExternalParams;
    if (external.provider !== undefined) {
      record.provider = external.provider;
    }
    if (external.provider_version !== undefined) {
      record.provider_version = external.provider_version;
    }
    if (external.source_revision !== undefined) {
      record.source_revision = external.source_revision;
    }
  }
  return record;
}

/**
 * M1 — availability is governed by the COLLECTOR'S EXECUTABILITY, not by
 * coverage.status alone.
 *
 * `coverage.status === COMPLETE` means "the scan ran to completion", NOT "every
 * value is known". A completed scan of an unsupported construct (assertion in a
 * callback, computed matcher) still yields UNKNOWN for that evidence item — so
 * the collector reports PARTIAL there rather than claiming COMPLETE.
 *
 * NOT_APPLICABLE is never inferred from collection status. It is only returned
 * when the caller supplies an explicit justification that the evidence type is
 * irrelevant to the declared scope (SPEC:380; plan A8).
 *
 * @param status collector executability for THIS evidence item
 * @param irrelevantToScopeReason justification; when present, NOT_APPLICABLE
 */
export function deriveAvailability(status: CollectionStatus, irrelevantToScopeReason?: string): Availability {
  if (status === CollectionStatus.COMPLETE) {
    return Availability.KNOWN;
  }
  if (irrelevantToScopeReason !== undefined) {
    return Availability.NOT_APPLICABLE;
  }
  return Availability.UNKNOWN;
}
