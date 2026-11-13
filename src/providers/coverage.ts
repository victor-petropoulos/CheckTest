/**
 * External coverage evidence provider (WP4.1 task 56b).
 *
 * Parses a coverage report from disk into normalized `line_coverage`
 * `EvidenceRecord`s. It does NOT run or rebuild a coverage engine (roadmap
 * constraint): it only reads a report produced elsewhere.
 *
 * Primary format: Istanbul-style JSON `{ covered: { "/abs/file.js": [null|1, ...] } }`.
 * Secondary: c8-style JSON `{ files: { path: { coveredLines: number[] } } }`.
 * Anything else (or a missing/unreadable/malformed report) degrades to
 * explicit UNKNOWN records with a reason — never a fabricated zero, never a
 * crash.
 *
 * Core is language-agnostic: this module imports core types only.
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
}

/** Normalize any supported coverage-map input shape into from=to pairs. */
function toCoverageMappings(input: unknown): Array<{ from: string; to: string }> {
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
    reason: unavailable
      ? revision === 'unknown'
        ? 'report revision unknown; freshness cannot be established'
        : `source revision mismatch: report ${revision} != analyzed ${analyzed ?? ''}`.trim()
      : undefined,
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
    const coveredLines = Array.isArray(recInfo.coveredLines)
      ? (recInfo.coveredLines as unknown[])
      : Array.isArray(recInfo.covered)
        ? (recInfo.covered as unknown[])
        : [];
    const unknownRevision = revision === 'unknown' && analyzed !== undefined;
    const unavailable = mismatch || unknownRevision;
    const availability = unavailable ? Availability.UNKNOWN : Availability.KNOWN;
    const status = unavailable ? CollectionStatus.UNAVAILABLE : CollectionStatus.COMPLETE;
    const record = makeEvidenceRecord({
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
    });
    records.set(file, record);
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
    // attach reason to records on mismatch (already handled in parseC8? no—fix here)
    if (mismatch) {
      const reason =
        revision === 'unknown'
          ? 'report revision unknown; freshness cannot be established'
          : `source revision mismatch: report ${revision} != analyzed ${analyzed ?? ''}`.trim();
      for (const rec of records.values()) {
        rec.reason = reason;
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

  return {
    records: new Map(),
    provider: providerBase,
    provider_version: version,
    source_revision: revision,
    reason: 'unsupported coverage report format',
    mismatch: mismatch || undefined,
  };
}

function normalizePath(p: string): string {
  const resolved = resolve(p);
  const normalized = normalize(resolved);
  return normalized.replace(/[\\/]+$/, '');
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
  });
}

function isLineCovered(lines: unknown, declLine: number): boolean {
  if (!Array.isArray(lines)) return false;
  if (lines.some((x) => x === null)) {
    const idx = declLine - 1;
    return idx >= 0 && idx < lines.length && lines[idx] === 1;
  }
  if (!lines.every((x) => typeof x === 'number')) return false;
  const nums = lines as number[];
  if (nums.length > 0 && Math.max(...nums) > 1) {
    return nums.includes(declLine);
  }
  const idx = declLine - 1;
  return idx >= 0 && idx < nums.length && nums[idx] === 1;
}

function countCoveredLines(lines: unknown): number {
  if (!Array.isArray(lines)) return 0;
  if (lines.some((x) => x === null)) {
    return lines.filter((x) => x === 1).length;
  }
  if (!lines.every((x) => typeof x === 'number')) return 0;
  const nums = lines as number[];
  if (nums.length === 0) return 0;
  if (Math.max(...nums) > 1) {
    return nums.length;
  }
  return nums.filter((x) => x === 1).length;
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

function perDeclarationRecord(
  fileRecord: EvidenceRecord,
  parsed: CoverageReportResult,
  declLine: number,
): EvidenceRecord {
  const provider = fileRecord.provider ?? parsed.provider;
  const version = fileRecord.provider_version ?? parsed.provider_version;
  const revision = fileRecord.source_revision ?? parsed.source_revision;
  const availability = fileRecord.availability;
  const status = fileRecord.coverage.status;
  const reason = fileRecord.reason;

  let value: unknown;
  if (availability === Availability.KNOWN) {
    value = isLineCovered(fileRecord.value, declLine) ? 1 : 0;
  } else {
    value = undefined;
  }

  return makeEvidenceRecord({
    type: 'line_coverage',
    value,
    availability,
    provenance: Provenance.EXTERNAL,
    source: provider,
    collector_version: version,
    scope: EVIDENCE_SCOPE_TEST_BODY,
    coverage: coverageBlock(status),
    provider,
    provider_version: version,
    source_revision: revision,
    reason,
  });
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
    fileRecord =
      findFileRecord(parsed, analysis.subject.file) ??
      unknownRecord(parsed, `no coverage data for ${analysis.subject.file}`);
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
    next.tests = analysis.tests.map((testScope) => ({
      ...testScope,
      evidence: {
        ...testScope.evidence,
        line_coverage:
          perDeclNumericSource !== undefined
            ? scopedPerDeclarationRecord(perDeclNumericSource, parsed, analysis.subject.file)
            : isMapped
              ? advisoryPerDeclarationRecord(fileRecord, parsed, mappingReason)
              : perDeclarationRecord(fileRecord, parsed, testScope.test.line),
      },
    }));
  }

  return next;
}
