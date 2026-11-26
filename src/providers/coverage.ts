/**
 * External coverage evidence provider (WP4.1 task 56b).
 *
 * Parses a coverage report from disk into normalized `line_coverage`
 * `EvidenceRecord`s. It does NOT run or rebuild a coverage engine (roadmap
 * constraint): it only reads a report produced elsewhere.
 *
 * Primary format: Istanbul-style JSON `{ covered: { "/abs/file.js": [null|1, ...] } }`.
 * Secondary: c8-style JSON `{ files: { path: { coveredLines: number[] } } }`.
 * Tertiary: raw vitest/v8 `coverage-final.json` — a flat Istanbul map
 * `{ "/abs/file.js": { statementMap, s, ... } }` ("shape A"), parsed natively.
 * Anything else (or a missing/unreadable/malformed report) degrades to
 * explicit UNKNOWN records with a reason — never a fabricated zero, never a
 * crash.
 *
 * Core is language-agnostic: this module imports core types only.
 */
import { readFileSync } from 'fs';
import { normalizePath } from '../core/paths';

import {
  Availability,
  CollectionStatus,
  EVIDENCE_SCOPE_TEST_BODY,
  EvidenceStrength,
  EvidenceRecord,
  Provenance,
  makeEvidenceRecord,
} from '../core/evidence';
import { AnalysisOutput } from '../core/analysis';
import { intersectLines, lineCount, toCoveredLineNumbers } from '../core/coverage-math';

export type CoverageMapEntry = string | { from: string; to: string } | [string, string];

export type CoverageMapInput = CoverageMapEntry | CoverageMapEntry[] | Record<string, string> | Map<string, string>;

export interface CoverageReportOptions {
  provider?: string;
  provider_version?: string;
  providerVersion?: string;
  source_revision?: string;
  sourceRevision?: string;
  analyzedRevision?: string;
  analyzed_revision?: string;
  revision?: string;
  /** Explicit from=to path mapping (repeatable; config key `coverageMap` deferred to SP4). */
  coverageMap?: CoverageMapInput;
  coverageMaps?: CoverageMapInput;
  coverage_map?: CoverageMapInput;
  mappings?: CoverageMapInput;
  mapping?: CoverageMapInput;
  /**
   * CT-COV-001 — the report at `path` was produced by a run scoped to a single
   * test file. Additive opt-in: when true, the subject-level `line_coverage`
   * record gains `per_test_run: true`; when absent/false nothing is set and
   * behavior is unchanged (ADR-031). Parsed by the CLI/config layer
   * (`--per-test-run`), never inferred from the report.
   */
  per_test_run?: boolean;
  /**
   * When true, per-declaration line_coverage records are attributed per
   * declaration (Tier 1/2/3) instead of the advisory record. Flag-gated;
   * default false keeps behavior byte-identical.
   */
  per_declaration_coverage?: boolean;
}

/** Normalize any supported coverage-map input shape into from=to pairs. */
export function toCoverageMappings(input: unknown): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  if (input === undefined || input === null) return out;
  if (input instanceof Map) {
    for (const [from, to] of input.entries()) {
      if (typeof from === 'string' && typeof to === 'string') out.push({ from, to });
    }
    return out;
  }
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (typeof entry === 'string') {
        const idx = entry.indexOf('=');
        if (idx > 0) out.push({ from: entry.slice(0, idx), to: entry.slice(idx + 1) });
      } else if (
        Array.isArray(entry) &&
        entry.length >= 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'string'
      ) {
        out.push({ from: entry[0], to: entry[1] });
      } else if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        if (typeof obj.from === 'string' && typeof obj.to === 'string') out.push({ from: obj.from, to: obj.to });
      }
    }
    return out;
  }
  if (typeof input === 'string') {
    const idx = input.indexOf('=');
    if (idx > 0) out.push({ from: input.slice(0, idx), to: input.slice(idx + 1) });
    return out;
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj.from === 'string' && typeof obj.to === 'string') {
      out.push({ from: obj.from, to: obj.to });
      return out;
    }
    for (const [from, to] of Object.entries(obj)) {
      if (typeof to === 'string') out.push({ from, to });
    }
  }
  return out;
}

function collectCoverageMappings(
  opts: CoverageReportOptions | undefined,
  extra?: unknown,
): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  if (opts !== undefined) {
    for (const key of ['coverageMap', 'coverageMaps', 'coverage_map', 'mappings', 'mapping'] as const) {
      out.push(...toCoverageMappings((opts as Record<string, unknown>)[key]));
    }
  }
  out.push(...toCoverageMappings(extra));
  return out;
}

export interface CoverageReportResult {
  records: Map<string, EvidenceRecord>;
  provider: string;
  provider_version: string;
  source_revision: string;
  reason?: string;
  mismatch?: boolean;
}

function pick(
  opts: CoverageReportOptions | undefined,
  ...names: Array<keyof CoverageReportOptions>
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

/** Freshness-failure reason shared by every external-report record (one wording). */
function freshnessReason(revision: string, analyzed: string | undefined): string {
  return revision === 'unknown'
    ? 'report revision unknown; freshness cannot be established'
    : `source revision mismatch: report ${revision} != analyzed ${analyzed ?? ''}`.trim();
}

function makeIstanbulRecord(
  provider: string,
  version: string,
  revision: string,
  lines: unknown[],
  mismatch: boolean,
  analyzed: string | undefined,
): EvidenceRecord {
  const hasNull = lines.some((x) => x === null);
  const unknownRevision = revision === 'unknown' && analyzed !== undefined;
  const unavailable = mismatch || unknownRevision;
  const availability = unavailable ? Availability.UNKNOWN : Availability.KNOWN;
  const status = unavailable
    ? CollectionStatus.UNAVAILABLE
    : hasNull
      ? CollectionStatus.PARTIAL
      : CollectionStatus.COMPLETE;
  return makeEvidenceRecord({
    type: 'line_coverage',
    value: unavailable ? undefined : lines,
    availability,
    provenance: Provenance.EXTERNAL,
    source: provider,
    collector_version: version,
    scope: EVIDENCE_SCOPE_TEST_BODY,
    coverage: coverageBlock(status),
    provider,
    provider_version: version,
    source_revision: revision,
    reason: unavailable ? freshnessReason(revision, analyzed) : undefined,
    evidenceStrength: unavailable ? EvidenceStrength.UNSUPPORTED : undefined,
  });
}

function parseIstanbul(
  covered: Record<string, unknown>,
  provider: string,
  version: string,
  revision: string,
  mismatch: boolean,
  analyzed: string | undefined,
): Map<string, EvidenceRecord> {
  const records = new Map<string, EvidenceRecord>();
  for (const [file, lines] of Object.entries(covered)) {
    if (!Array.isArray(lines)) continue;
    records.set(file, makeIstanbulRecord(provider, version, revision, lines, mismatch, analyzed));
  }
  return records;
}

/**
 * Fail-closed record for a report entry whose data is missing or malformed
 * (F3): never a measured zero. Shared by the c8 and raw-vitest shape-A
 * parsers; a caller may embed a freshness reason in `reason`.
 */
function makeMalformedRecord(provider: string, version: string, revision: string, reason: string): EvidenceRecord {
  return makeEvidenceRecord({
    type: 'line_coverage',
    value: [],
    availability: Availability.UNKNOWN,
    provenance: Provenance.EXTERNAL,
    source: provider,
    collector_version: version,
    scope: EVIDENCE_SCOPE_TEST_BODY,
    coverage: coverageBlock(CollectionStatus.UNAVAILABLE),
    provider,
    provider_version: version,
    source_revision: revision,
    reason,
    evidenceStrength: EvidenceStrength.UNSUPPORTED,
  });
}

function parseC8(
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
    // Fail closed (F3): a missing or non-array `coveredLines`/`covered` is NOT
    // measured data — it must never read as a COMPLETE zero-coverage report. A
    // valid array, including a valid empty one, is measured data (measured zero).
    const coveredLines = Array.isArray(recInfo.coveredLines)
      ? (recInfo.coveredLines as unknown[])
      : Array.isArray(recInfo.covered)
        ? (recInfo.covered as unknown[])
        : undefined;
    const malformed = coveredLines === undefined;
    const unknownRevision = revision === 'unknown' && analyzed !== undefined;
    const unavailable = mismatch || unknownRevision || malformed;
    const availability = unavailable ? Availability.UNKNOWN : Availability.KNOWN;
    const status = unavailable ? CollectionStatus.UNAVAILABLE : CollectionStatus.COMPLETE;
    const record = malformed
      ? makeMalformedRecord(provider, version, revision, 'missing or invalid coveredLines array')
      : makeEvidenceRecord({
          type: 'line_coverage',
          value: unavailable ? undefined : coveredLines,
          availability,
          provenance: Provenance.EXTERNAL,
          source: provider,
          collector_version: version,
          scope: EVIDENCE_SCOPE_TEST_BODY,
          coverage: coverageBlock(status),
          provider,
          provider_version: version,
          source_revision: revision,
          evidenceStrength: unavailable ? EvidenceStrength.UNSUPPORTED : undefined,
        });
    records.set(file, record);
  }
  return records;
}

/**
 * Raw vitest/v8 `coverage-final.json` ("shape A"): a FLAT Istanbul map
 * `{ "<absPath>": { path, statementMap, s, b, f, fnMap, branchMap, meta } }`.
 * It matches neither the `covered`-nested shape (parseIstanbul) nor the
 * `files.<path>.coveredLines` shape (parseC8); detected when at least one
 * top-level entry carries both a `statementMap` object and a hit-count map `s`.
 */
function isVitestShapeA(report: Record<string, unknown>): boolean {
  return Object.values(report).some((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const rec = entry as Record<string, unknown>;
    const statementMap = rec.statementMap;
    const hits = rec.s;
    return (
      statementMap !== null &&
      typeof statementMap === 'object' &&
      !Array.isArray(statementMap) &&
      hits !== null &&
      typeof hits === 'object' &&
      !Array.isArray(hits)
    );
  });
}

/**
 * Shape-A conversion — the single native implementation of the derive() recipe
 * (`validation/cov001-per-test-recipe.sh:124-145`): covered lines are the
 * sorted unique `statementMap[*].start.line` values whose `s` hit count is > 0.
 * Returns null when the entry is malformed (fail closed, F3).
 */
function shapeACoveredLines(statementMap: Record<string, unknown>, hits: Record<string, unknown>): number[] | null {
  const lines = new Set<number>();
  for (const [key, hit] of Object.entries(hits)) {
    // Fail closed: a non-numeric hit count is not measured data.
    if (typeof hit !== 'number') return null;
    if (hit <= 0) continue;
    const stmt = statementMap[key];
    const start = stmt !== null && typeof stmt === 'object' ? (stmt as Record<string, unknown>).start : undefined;
    const line = start !== null && typeof start === 'object' ? (start as Record<string, unknown>).line : undefined;
    // A positive hit whose statement location cannot be established is malformed:
    // skipping it would silently shrink the measured line set toward zero.
    if (typeof line !== 'number') return null;
    lines.add(line);
  }
  return Array.from(lines).sort((a, b) => a - b);
}

function parseVitestShapeA(
  report: Record<string, unknown>,
  provider: string,
  version: string,
  revision: string,
  mismatch: boolean,
  analyzed: string | undefined,
): Map<string, EvidenceRecord> {
  const records = new Map<string, EvidenceRecord>();
  for (const [file, entry] of Object.entries(report)) {
    const rec = (entry ?? {}) as Record<string, unknown>;
    const statementMap = rec.statementMap;
    const hits = rec.s;
    if (
      statementMap === null ||
      typeof statementMap !== 'object' ||
      Array.isArray(statementMap) ||
      hits === null ||
      typeof hits !== 'object' ||
      Array.isArray(hits)
    ) {
      const reason = mismatch
        ? `${freshnessReason(revision, analyzed)}; missing or invalid statementMap/s coverage entry`
        : 'missing or invalid statementMap/s coverage entry';
      records.set(file, makeMalformedRecord(provider, version, revision, reason));
      continue;
    }
    const lines = shapeACoveredLines(statementMap as Record<string, unknown>, hits as Record<string, unknown>);
    if (lines === null) {
      const reason = mismatch
        ? `${freshnessReason(revision, analyzed)}; missing or invalid statementMap/s coverage entry`
        : 'missing or invalid statementMap/s coverage entry';
      records.set(file, makeMalformedRecord(provider, version, revision, reason));
      continue;
    }
    // Valid entries reuse the Istanbul record semantics verbatim (F3 freshness
    // handling included) — no replica of makeIstanbulRecord's policy.
    records.set(file, makeIstanbulRecord(provider, version, revision, lines, mismatch, analyzed));
  }
  return records;
}

export function parseCoverageReport(path: string, opts?: CoverageReportOptions): CoverageReportResult {
  const providerOverride = pick(opts, 'provider');
  const version = pick(opts, 'provider_version', 'providerVersion') ?? '1.0.0';
  const revision = pick(opts, 'source_revision', 'sourceRevision', 'revision') ?? 'unknown';
  const analyzed = pick(opts, 'analyzedRevision', 'analyzed_revision');
  const mismatch = analyzed !== undefined && (revision === 'unknown' || analyzed !== revision);

  const providerBase = providerOverride ?? 'coverage';

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return {
      records: new Map(),
      provider: providerBase,
      provider_version: version,
      source_revision: revision,
      reason: `unable to read coverage report: ${(error as Error).message}`,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      records: new Map(),
      provider: providerBase,
      provider_version: version,
      source_revision: revision,
      reason: `malformed coverage report JSON: ${(error as Error).message}`,
    };
  }

  if (json === null || typeof json !== 'object') {
    return {
      records: new Map(),
      provider: providerBase,
      provider_version: version,
      source_revision: revision,
      reason: 'unsupported coverage report format',
    };
  }

  const obj = json as Record<string, unknown>;

  return parseCoverageObject(obj, providerBase, version, revision, mismatch, analyzed, providerOverride);
}

function parseCoverageObject(
  obj: Record<string, unknown>,
  providerBase: string,
  version: string,
  revision: string,
  mismatch: boolean,
  analyzed: string | undefined,
  providerOverride: string | undefined,
): CoverageReportResult {
  if (obj.covered !== undefined && typeof obj.covered === 'object' && obj.covered !== null) {
    const provider = providerOverride ?? 'istanbul';
    const records = parseIstanbul(
      obj.covered as Record<string, unknown>,
      provider,
      version,
      revision,
      mismatch,
      analyzed,
    );
    const result: CoverageReportResult = {
      records,
      provider,
      provider_version: version,
      source_revision: revision,
    };
    if (records.size === 0) result.reason = 'coverage report contained no file entries';
    if (mismatch) result.mismatch = true;
    return result;
  }

  if (obj.files !== undefined && typeof obj.files === 'object' && obj.files !== null) {
    const provider = providerOverride ?? 'c8';
    const records = parseC8(obj.files as Record<string, unknown>, provider, version, revision, mismatch, analyzed);
    // attach reason to records on mismatch; a per-record fail-closed reason
    // (e.g. malformed coveredLines) is kept rather than clobbered
    if (mismatch) {
      const reason = freshnessReason(revision, analyzed);
      for (const rec of records.values()) {
        rec.reason = rec.reason !== undefined ? `${reason}; ${rec.reason}` : reason;
      }
    }
    const result: CoverageReportResult = {
      records,
      provider,
      provider_version: version,
      source_revision: revision,
    };
    if (records.size === 0) result.reason = 'coverage report contained no file entries';
    if (mismatch) result.mismatch = true;
    return result;
  }

  if (isVitestShapeA(obj)) {
    const provider = providerOverride ?? 'vitest';
    const records = parseVitestShapeA(obj, provider, version, revision, mismatch, analyzed);
    const result: CoverageReportResult = {
      records,
      provider,
      provider_version: version,
      source_revision: revision,
    };
    if (records.size === 0) result.reason = 'coverage report contained no file entries';
    if (mismatch) result.mismatch = true;
    return result;
  }

  return {
    records: new Map(),
    provider: providerBase,
    provider_version: version,
    source_revision: revision,
    reason: 'unsupported coverage report format',
    mismatch: mismatch || undefined,
  };
}

function findFileRecord(parsed: CoverageReportResult, filePath: string): EvidenceRecord | undefined {
  const target = normalizePath(filePath);
  for (const [key, value] of parsed.records) {
    if (normalizePath(key) === target) return value;
  }
  return undefined;
}

function unknownRecord(parsed: CoverageReportResult, reason: string): EvidenceRecord {
  return makeEvidenceRecord({
    type: 'line_coverage',
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
    evidenceStrength: EvidenceStrength.UNSUPPORTED,
  });
}

function countCoveredLines(lines: unknown): number {
  return lineCount(lines);
}

function advisoryPerDeclarationRecord(
  fileRecord: EvidenceRecord,
  parsed: CoverageReportResult,
  mappingReason: string | undefined,
): EvidenceRecord {
  const provider = fileRecord.provider ?? parsed.provider;
  const version = fileRecord.provider_version ?? parsed.provider_version;
  const revision = fileRecord.source_revision ?? parsed.source_revision;
  const reason =
    mappingReason !== undefined
      ? `${mappingReason} (per-declaration attribution not supported for mapped coverage)`
      : 'per-declaration attribution not supported for mapped coverage';
  return makeEvidenceRecord({
    type: 'line_coverage',
    value: undefined,
    availability: Availability.UNKNOWN,
    provenance: Provenance.EXTERNAL,
    source: provider,
    collector_version: version,
    scope: EVIDENCE_SCOPE_TEST_BODY,
    coverage: coverageBlock(fileRecord.coverage.status),
    provider,
    provider_version: version,
    source_revision: revision,
    reason,
  });
}

function attributedPerDeclarationRecord(
  targetRecord: EvidenceRecord,
  parsed: CoverageReportResult,
  testFile: string,
  declLine: number,
  tier: 1 | 2 | 3,
  mappingReason: string | undefined,
): EvidenceRecord {
  const provider = targetRecord.provider ?? parsed.provider;
  const version = targetRecord.provider_version ?? parsed.provider_version;
  const revision = targetRecord.source_revision ?? parsed.source_revision;
  if (tier === 1) {
    const covered = toCoveredLineNumbers(targetRecord.value);
    const value = covered === null ? undefined : intersectLines(covered, declLine, Infinity);
    return makeEvidenceRecord({
      type: 'line_coverage',
      value,
      availability: Availability.KNOWN,
      provenance: Provenance.EXTERNAL,
      source: provider,
      collector_version: version,
      scope: EVIDENCE_SCOPE_TEST_BODY,
      coverage: coverageBlock(targetRecord.coverage.status),
      provider,
      provider_version: version,
      source_revision: revision,
      location: { file: testFile, line: declLine },
      reason: `coverage attributed: ${mappingReason ?? 'mapped'}; revision ${revision} matches; per-test-run attested; single-declaration span`,
    });
  }
  if (tier === 2) {
    return makeEvidenceRecord({
      type: 'line_coverage',
      value: undefined,
      availability: Availability.UNKNOWN,
      provenance: Provenance.EXTERNAL,
      source: provider,
      collector_version: version,
      scope: EVIDENCE_SCOPE_TEST_BODY,
      coverage: coverageBlock(targetRecord.coverage.status),
      provider,
      provider_version: version,
      source_revision: revision,
      location: { file: testFile, line: declLine },
      reason: `run-scoped file-level coverage, not per-test-causal (${mappingReason ?? 'mapped'}; revision ${revision})`,
    });
  }
  const cause = targetRecord.reason ?? 'per-declaration attribution unavailable';
  const rec = unknownRecord(parsed, cause);
  return { ...rec, location: { file: testFile, line: declLine } };
}

/**
 * CT-COV-001 per-test-run mode (design §2). A numeric per-declaration record
 * standing for the file-level claim "the mapped production file was exercised in
 * the run of this test file". Declaration lines are never instrumented (design
 * Goal; ADR-031:11-12,66-67), so the value is the FILE-level verdict restricted
 * to 0/1 — 1 when the mapped report shows >= 1 covered line, 0 otherwise — and
 * the reason names the test file the run was scoped to.
 */
function scopedPerDeclarationRecord(
  targetRecord: EvidenceRecord,
  parsed: CoverageReportResult,
  testFile: string,
  declLine: number,
): EvidenceRecord {
  const provider = targetRecord.provider ?? parsed.provider;
  const version = targetRecord.provider_version ?? parsed.provider_version;
  const revision = targetRecord.source_revision ?? parsed.source_revision;
  return makeEvidenceRecord({
    type: 'line_coverage',
    value: countCoveredLines(targetRecord.value) >= 1 ? 1 : 0,
    availability: targetRecord.availability,
    provenance: Provenance.EXTERNAL,
    source: provider,
    collector_version: version,
    scope: EVIDENCE_SCOPE_TEST_BODY,
    coverage: coverageBlock(targetRecord.coverage.status),
    provider,
    provider_version: version,
    source_revision: revision,
    location: { file: testFile, line: declLine },
    reason: `coverage evidence from a run scoped to ${testFile}`,
  });
}

/** Any report entry other than `mappedTo` whose collection status is PARTIAL. */
function hasPartialSibling(parsed: CoverageReportResult, mappedTo: string): boolean {
  const target = normalizePath(mappedTo);
  for (const [file, record] of parsed.records) {
    if (normalizePath(file) !== target && record.coverage.status === CollectionStatus.PARTIAL) return true;
  }
  return false;
}

export function applyCoverageReport(
  analysis: AnalysisOutput,
  reportPath: string,
  opts?: CoverageReportOptions,
  coverageMap?: unknown,
): AnalysisOutput {
  const parsed = parseCoverageReport(reportPath, opts);
  const mappings = collectCoverageMappings(opts, coverageMap);

  // Exact-match only: an explicit mapping redirects the subject file to a report
  // key. No basename/sole-entry fallbacks are added.
  const mappedEntry = mappings.find((m) => normalizePath(m.from) === normalizePath(analysis.subject.file));
  const mappedTo = mappedEntry?.to;
  const mappingReason =
    mappedTo !== undefined ? `coverage mapped from ${mappedEntry!.from} to ${mappedTo} per user mapping` : undefined;
  const isMapped = mappedTo !== undefined;

  let fileRecord: EvidenceRecord;
  // CT-COV-001 per-test-run mode (design §2): when the marker is set AND the
  // mapped target is KNOWN + COMPLETE, per-declaration records become numeric
  // against the mapped production file instead of advisory. `perDeclNumericSource`
  // keeps the RAW target record (the fileRecord's value is already collapsed to a
  // covered-line count, which the numeric per-declaration records appraise).
  let perDeclNumericSource: EvidenceRecord | undefined;
  let mappedTargetRecord: EvidenceRecord | undefined;
  if (mappedTo !== undefined) {
    const targetRecord = findFileRecord(parsed, mappedTo);
    if (targetRecord !== undefined) {
      fileRecord = {
        ...targetRecord,
        // When coverage is mapped, the subject-level record carries the number of
        // covered lines in the mapped production file (count of 1s), so the
        // numeric threshold in CT-COV-001 applies to the file, not a declaration.
        value:
          targetRecord.availability === Availability.KNOWN ? countCoveredLines(targetRecord.value) : targetRecord.value,
        reason: targetRecord.reason ? `${mappingReason} (${targetRecord.reason})` : mappingReason,
      };
      mappedTargetRecord = targetRecord;
      if (
        opts?.per_test_run === true &&
        targetRecord.availability === Availability.KNOWN &&
        targetRecord.coverage.status === CollectionStatus.COMPLETE
      ) {
        perDeclNumericSource = targetRecord;
      }
    } else {
      fileRecord = unknownRecord(parsed, `no coverage data for ${mappedTo}`);
      if (mappingReason !== undefined)
        fileRecord = { ...fileRecord, reason: `${mappingReason} (no coverage data for ${mappedTo})` };
    }
  } else {
    const exact = findFileRecord(parsed, analysis.subject.file);
    if (exact !== undefined) {
      fileRecord = exact;
    } else {
      const subjectBase = normalizePath(analysis.subject.file).split('/').pop()!;
      const basenameMatches = Array.from(parsed.records.keys()).filter(
        (k) => normalizePath(k).split('/').pop() === subjectBase,
      );
      if (basenameMatches.length > 1) {
        fileRecord = unknownRecord(parsed, `ambiguous basename match: ${basenameMatches.slice().sort().join(', ')}`);
      } else {
        fileRecord = unknownRecord(
          parsed,
          `no coverage data for ${analysis.subject.file} (no --coverage-map <from>=<to> entry maps this test file to a production file with coverage)`,
        );
      }
    }
  }

  // CT-COV-001 marker (design §1): the flag describes the RUN SCOPE of the
  // report just parsed, so it is attached to the subject-level record whichever
  // branch produced it. One added field, no verdict moves here — the rule reads
  // it (design §2) in a later unit.
  if (opts?.per_test_run === true) {
    fileRecord = { ...fileRecord, per_test_run: true };
  }

  // CT-COV-001 veto-WARN (design §1, task 6): a scoped run whose mapped target is
  // KNOWN + COMPLETE but whose report ALSO carries unrelated PARTIAL entries
  // contradicts a single-test-file scope. The contradiction only ANNOTATES the
  // subject reason; it never gates a verdict and never touches the numeric
  // per-declaration path above.
  if (
    opts?.per_test_run === true &&
    mappedTo !== undefined &&
    fileRecord.availability === Availability.KNOWN &&
    fileRecord.coverage.status === CollectionStatus.COMPLETE &&
    hasPartialSibling(parsed, mappedTo)
  ) {
    fileRecord = {
      ...fileRecord,
      reason:
        fileRecord.reason !== undefined
          ? `veto-WARN: ${fileRecord.reason}`
          : 'veto-WARN: mapped pair evidence contradicts a run scoped to one test file',
    };
  }

  const next: AnalysisOutput = {
    ...analysis,
    evidence: { ...analysis.evidence, line_coverage: fileRecord },
  };

  if (analysis.tests !== undefined) {
    next.tests = analysis.tests.map((testScope) => {
      // B5 C-2 (Decisions #12): ordinary non-mapped coverage MUST NOT be copied
      // into per-declaration evidence (CF-COV-001 sidecar perTest.line_coverage
      // = MUST_BE_ABSENT). Only the mapped branches attribute per-declaration.
      const selfCoverage = mappedTo !== undefined && normalizePath(mappedTo) === normalizePath(analysis.subject.file);
      const singleDecl = (analysis.tests ?? []).length === 1;
      const tier1 =
        opts?.per_declaration_coverage === true &&
        perDeclNumericSource !== undefined &&
        selfCoverage &&
        singleDecl &&
        mappedTargetRecord !== undefined &&
        mappedTargetRecord.source_revision !== undefined &&
        mappedTargetRecord.source_revision !== 'unknown' &&
        (opts?.analyzedRevision === mappedTargetRecord.source_revision ||
          opts?.analyzed_revision === mappedTargetRecord.source_revision);
      let lineCoverage: EvidenceRecord | undefined;
      if (opts?.per_declaration_coverage !== true) {
        lineCoverage =
          perDeclNumericSource !== undefined
            ? scopedPerDeclarationRecord(perDeclNumericSource, parsed, analysis.subject.file, testScope.test.line)
            : isMapped
              ? advisoryPerDeclarationRecord(fileRecord, parsed, mappingReason)
              : undefined;
      } else if (tier1 && mappedTargetRecord !== undefined) {
        lineCoverage = attributedPerDeclarationRecord(
          mappedTargetRecord,
          parsed,
          analysis.subject.file,
          testScope.test.line,
          1,
          mappingReason,
        );
      } else if (isMapped) {
        if (
          mappedTargetRecord !== undefined &&
          mappedTargetRecord.availability === Availability.KNOWN &&
          mappedTargetRecord.source_revision !== undefined &&
          mappedTargetRecord.source_revision !== 'unknown'
        ) {
          lineCoverage = attributedPerDeclarationRecord(
            mappedTargetRecord,
            parsed,
            analysis.subject.file,
            testScope.test.line,
            2,
            mappingReason,
          );
        } else {
          lineCoverage = attributedPerDeclarationRecord(
            mappedTargetRecord ?? fileRecord,
            parsed,
            analysis.subject.file,
            testScope.test.line,
            3,
            mappingReason,
          );
        }
      } else {
        lineCoverage = undefined;
      }
      return {
        ...testScope,
        evidence:
          lineCoverage === undefined ? testScope.evidence : { ...testScope.evidence, line_coverage: lineCoverage },
      };
    });
  }

  return next;
}
