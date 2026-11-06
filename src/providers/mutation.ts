/**
 * External mutation evidence provider (P2.3, WP4.6 schema research).
 *
 * Parses a Stryker mutation-testing report (schema v1/v2) from disk into
 * normalized `mutation_score` `EvidenceRecord`s. It is PARSE-ONLY: it never
 * runs or rebuilds a mutation engine (roadmap constraint
 * docs/Development_Roadmap.md:1085) and never fabricates a score
 * (roadmap:1087, :1088).
 *
 * Missing / unreadable / malformed / unsupported reports degrade to explicit
 * UNKNOWN records with a reason — never a zero, never a crash.
 *
 * Evidence is FILE-LEVEL ONLY: a mutation report keys mutants by source file and
 * says nothing about individual test declarations, so no per-declaration record
 * is ever derived from it (roadmap:1086 "Do not assume file-level evidence is
 * test-level evidence").
 *
 * Metric definition (verified against Stryker docs via Context7):
 *   detected  = Killed + Timeout
 *   undetected= Survived + NoCoverage
 *   valid     = detected + undetected
 *   score     = detected / valid       (undefined when valid === 0)
 *   CompileError / RuntimeError / Ignored / Pending are NOT in the score.
 */
import { readFileSync } from 'fs';
import { normalize, resolve } from 'path';

import {
  Availability,
  CollectionStatus,
  EVIDENCE_SCOPE_TEST_BODY,
  EvidenceRecord,
  Provenance,
  makeEvidenceRecord,
} from '../core/evidence';
import { AnalysisOutput } from '../core/analysis';

export interface MutationReportOptions {
  provider?: string;
  provider_version?: string;
  providerVersion?: string;
  source_revision?: string;
  sourceRevision?: string;
  analyzedRevision?: string;
  analyzed_revision?: string;
  revision?: string;
}

/** Per-file mutation score breakdown. `score` is null only when not computable. */
export interface MutationScore {
  score: number | null;
  detected: number;
  valid: number;
  killed: number;
  survived: number;
  timeout: number;
  noCoverage: number;
  compileError: number;
  runtimeError: number;
  ignored: number;
  pending: number;
}

export interface MutationReportResult {
  records: Map<string, EvidenceRecord>;
  provider: string;
  provider_version: string;
  source_revision: string;
  reason?: string;
  mismatch?: boolean;
}

interface StatusCounts {
  killed: number;
  survived: number;
  timeout: number;
  noCoverage: number;
  compileError: number;
  runtimeError: number;
  ignored: number;
  pending: number;
}

function pick(
  opts: MutationReportOptions | undefined,
  ...names: Array<keyof MutationReportOptions>
): string | undefined {
  if (opts === undefined) return undefined;
  for (const name of names) {
    const value = opts[name];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function coverageBlock(status: CollectionStatus): EvidenceRecord['coverage'] {
  return {
    status,
    supported_frameworks: [],
    supported_assertion_forms: [],
  };
}

/**
 * Turn one file's `mutants[]` into a score. Returns a failure reason instead of
 * a value whenever the report cannot be scored honestly — an unrecognized status
 * or zero valid mutants (never a fabricated zero).
 */
function scoreMutants(mutants: unknown[]): { ok: true; value: MutationScore } | { ok: false; reason: string } {
  const c: StatusCounts = {
    killed: 0,
    survived: 0,
    timeout: 0,
    noCoverage: 0,
    compileError: 0,
    runtimeError: 0,
    ignored: 0,
    pending: 0,
  };

  for (let i = 0; i < mutants.length; i += 1) {
    const mutant = mutants[i];
    if (mutant === null || typeof mutant !== 'object') {
      return { ok: false, reason: `mutant ${i} is not an object` };
    }
    const status = (mutant as Record<string, unknown>).status;
    // Explicit, exhaustive handling of the eight schema statuses. Anything else
    // leaves the file UNKNOWN rather than silently dropping a mutant.
    switch (status) {
      case 'Killed':
        c.killed += 1;
        break;
      case 'Survived':
        c.survived += 1;
        break;
      case 'Timeout':
        c.timeout += 1;
        break;
      case 'NoCoverage':
        c.noCoverage += 1;
        break;
      case 'CompileError':
        c.compileError += 1;
        break;
      case 'RuntimeError':
        c.runtimeError += 1;
        break;
      case 'Ignored':
        c.ignored += 1;
        break;
      case 'Pending':
        c.pending += 1;
        break;
      default:
        return { ok: false, reason: `unrecognized mutant status '${String(status)}' at mutant ${i}` };
    }
  }

  const detected = c.killed + c.timeout;
  const valid = detected + c.survived + c.noCoverage;
  if (valid === 0) {
    return {
      ok: false,
      reason: 'no valid mutants (ignored/pending/error only); mutation score not computable',
    };
  }

  return { ok: true, value: { score: detected / valid, detected, valid, ...c } };
}

function isUnavailableRevision(revision: string, analyzed: string | undefined): boolean {
  return analyzed !== undefined && (revision === 'unknown' || analyzed !== revision);
}
function reasonRevision(revision: string, analyzed: string | undefined): string {
  return revision === 'unknown'
    ? 'report revision unknown; freshness cannot be established'
    : `source revision mismatch: report ${revision} != analyzed ${analyzed ?? ''}`.trim();
}
function buildRecord(
  provider: string,
  version: string,
  revision: string,
  value: MutationScore | undefined,
  mismatch: boolean,
  analyzed: string | undefined,
  failureReason: string | undefined,
): EvidenceRecord {
  const unavailable = mismatch || isUnavailableRevision(revision, analyzed);
  if (unavailable) {
    return makeEvidenceRecord({
      type: 'mutation_score',
      value: undefined,
      availability: Availability.UNKNOWN,
      provenance: Provenance.EXTERNAL,
      source: provider,
      collector_version: version,
      scope: EVIDENCE_SCOPE_TEST_BODY,
      coverage: coverageBlock(CollectionStatus.UNAVAILABLE),
      provider,
      provider_version: version,
      source_revision: revision,
      reason: reasonRevision(revision, analyzed),
    });
  }
  if (value === undefined) {
    return makeEvidenceRecord({
      type: 'mutation_score',
      value: undefined,
      availability: Availability.UNKNOWN,
      provenance: Provenance.EXTERNAL,
      source: provider,
      collector_version: version,
      scope: EVIDENCE_SCOPE_TEST_BODY,
      coverage: coverageBlock(CollectionStatus.UNAVAILABLE),
      provider,
      provider_version: version,
      source_revision: revision,
      reason: failureReason,
    });
  }
  return makeEvidenceRecord({
    type: 'mutation_score',
    value,
    availability: Availability.KNOWN,
    provenance: Provenance.EXTERNAL,
    source: provider,
    collector_version: version,
    scope: EVIDENCE_SCOPE_TEST_BODY,
    coverage: coverageBlock(CollectionStatus.COMPLETE),
    provider,
    provider_version: version,
    source_revision: revision,
  });
}

function parseFiles(
  files: Record<string, unknown>,
  provider: string,
  version: string,
  revision: string,
  mismatch: boolean,
  analyzed: string | undefined,
): Map<string, EvidenceRecord> {
  const records = new Map<string, EvidenceRecord>();
  for (const [file, info] of Object.entries(files)) {
    const recInfo = (info ?? {}) as Record<string, unknown>;
    const mutants = Array.isArray(recInfo.mutants) ? (recInfo.mutants as unknown[]) : [];
    const scored = scoreMutants(mutants);
    const record = scored.ok
      ? buildRecord(provider, version, revision, scored.value, mismatch, analyzed, undefined)
      : buildRecord(provider, version, revision, undefined, mismatch, analyzed, scored.reason);
    records.set(file, record);
  }
  return records;
}

export function parseMutationReport(path: string, opts?: MutationReportOptions): MutationReportResult {
  const providerOverride = pick(opts, 'provider');
  const version = pick(opts, 'provider_version', 'providerVersion') ?? '1.0.0';
  const revision = pick(opts, 'source_revision', 'sourceRevision', 'revision') ?? 'unknown';
  const analyzed = pick(opts, 'analyzedRevision', 'analyzed_revision');
  const mismatch = analyzed !== undefined && (revision === 'unknown' || analyzed !== revision);
  const provider = providerOverride ?? 'stryker';

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return {
      records: new Map(),
      provider,
      provider_version: version,
      source_revision: revision,
      reason: `unable to read mutation report: ${(error as Error).message}`,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      records: new Map(),
      provider,
      provider_version: version,
      source_revision: revision,
      reason: `malformed mutation report JSON: ${(error as Error).message}`,
    };
  }

  if (json === null || typeof json !== 'object') {
    return {
      records: new Map(),
      provider,
      provider_version: version,
      source_revision: revision,
      reason: 'unsupported mutation report format',
      mismatch: mismatch || undefined,
    };
  }

  const obj = json as Record<string, unknown>;

  // schemaVersion is required by the Stryker schema; tolerate v1, v2 and dotted
  // sub-versions ("2", "2.0", "2.0.0"). Anything else is unsupported.
  const schema = obj.schemaVersion;
  if (typeof schema !== 'string' || !/^[12](\.\d+)*$/.test(schema)) {
    return {
      records: new Map(),
      provider,
      provider_version: version,
      source_revision: revision,
      reason: 'unsupported mutation report format',
      mismatch: mismatch || undefined,
    };
  }

  if (obj.files === undefined || typeof obj.files !== 'object' || obj.files === null) {
    return {
      records: new Map(),
      provider,
      provider_version: version,
      source_revision: revision,
      reason: 'unsupported mutation report format',
      mismatch: mismatch || undefined,
    };
  }

  const records = parseFiles(obj.files as Record<string, unknown>, provider, version, revision, mismatch, analyzed);
  const result: MutationReportResult = {
    records,
    provider,
    provider_version: version,
    source_revision: revision,
  };
  if (records.size === 0) result.reason = 'mutation report contained no file entries';
  if (mismatch) result.mismatch = true;
  return result;
}

function normalizePath(p: string): string {
  const resolved = resolve(p);
  const normalized = normalize(resolved);
  return normalized.replace(/[\\/]+$/, '');
}

function findFileRecord(parsed: MutationReportResult, filePath: string): EvidenceRecord | undefined {
  const target = normalizePath(filePath);
  for (const [key, value] of parsed.records) {
    if (normalizePath(key) === target) return value;
  }
  return undefined;
}

function unknownRecord(parsed: MutationReportResult, reason: string): EvidenceRecord {
  return makeEvidenceRecord({
    type: 'mutation_score',
    value: undefined,
    availability: Availability.UNKNOWN,
    provenance: Provenance.EXTERNAL,
    source: parsed.provider,
    collector_version: parsed.provider_version,
    scope: EVIDENCE_SCOPE_TEST_BODY,
    coverage: coverageBlock(CollectionStatus.UNAVAILABLE),
    provider: parsed.provider,
    provider_version: parsed.provider_version,
    source_revision: parsed.source_revision,
    reason,
  });
}

/**
 * Attach a file-level `mutation_score` record to `AnalysisOutput.evidence`.
 * Mutation evidence never reaches a per-declaration scope (roadmap:1086), so no
 * `TestScopeResult` is touched. No rule consumes `mutation_score` yet, so
 * verdicts are unchanged (roadmap:1089).
 */
export function applyMutationReport(
  analysis: AnalysisOutput,
  reportPath: string,
  opts?: MutationReportOptions,
): AnalysisOutput {
  const parsed = parseMutationReport(reportPath, opts);
  // Whole-report failure (missing/malformed/unsupported) keeps its parse reason;
  // a parsed report that simply lacks this file gets a per-file reason.
  const record =
    findFileRecord(parsed, analysis.subject.file) ??
    unknownRecord(
      parsed,
      parsed.records.size === 0 && parsed.reason !== undefined
        ? parsed.reason
        : `no mutation data for ${analysis.subject.file}`,
    );

  return {
    ...analysis,
    evidence: { ...analysis.evidence, mutation_score: record },
  };
}
