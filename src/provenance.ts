import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export type DecidedBy = 'flag' | 'manifest' | 'extension' | 'unsupported';

export interface ProvenanceManifest {
  checktest_version: string;
  timestamp: string;
  command: string;
  input: { file: string; sha256: string; size_bytes: number };
  adapter: string;
  decidedBy: DecidedBy;
  manifestFramework?: string;
  rules: string[];
  external_evidence: {
    coverage_report: { path: string; sha256: string; source_revision: string } | null;
    mutation_report: { path: string; sha256: string; source_revision: string } | null;
  };
  exit_code: number;
  report_file: string | null;
}

export interface BuildProvenanceOptions {
  testPath: string;
  rules: string[];
  adapter: string;
  decidedBy: DecidedBy;
  manifestFramework?: string;
  coverageReportPath?: string;
  mutationReportPath?: string;
  coverageSourceRevision?: string;
  mutationSourceRevision?: string;
  exitCode: number;
  reportFilePath?: string | null;
  command?: string;
}

export function hashFile(path: string): string {
  const data = readFileSync(path);
  return createHash('sha256').update(data).digest('hex');
}

function readVersion(): string {
  const candidates = [join(__dirname, '..', 'package.json'), join(__dirname, '..', '..', 'package.json')];
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // try next candidate
    }
  }
  throw new Error('checktest: could not locate package.json to read version');
}

export function buildProvenanceManifest(opts: BuildProvenanceOptions): ProvenanceManifest {
  const inputSize = statSync(opts.testPath).size;
  const inputSha = hashFile(opts.testPath);

  let coverage: { path: string; sha256: string; source_revision: string } | null = null;
  if (opts.coverageReportPath) {
    coverage = {
      path: opts.coverageReportPath,
      sha256: hashFile(opts.coverageReportPath),
      source_revision: opts.coverageSourceRevision ?? '',
    };
  }

  let mutation: { path: string; sha256: string; source_revision: string } | null = null;
  if (opts.mutationReportPath) {
    mutation = {
      path: opts.mutationReportPath,
      sha256: hashFile(opts.mutationReportPath),
      source_revision: opts.mutationSourceRevision ?? '',
    };
  }

  return {
    checktest_version: readVersion(),
    timestamp: new Date().toISOString(),
    command: opts.command ?? '',
    input: { file: opts.testPath, sha256: inputSha, size_bytes: inputSize },
    adapter: opts.adapter,
    decidedBy: opts.decidedBy,
    ...(opts.manifestFramework !== undefined ? { manifestFramework: opts.manifestFramework } : {}),
    rules: opts.rules,
    external_evidence: { coverage_report: coverage, mutation_report: mutation },
    exit_code: opts.exitCode,
    report_file: opts.reportFilePath ?? null,
  };
}

export function writeProvenanceManifest(path: string, manifest: ProvenanceManifest): void {
  const tmp = path + '.tmp.' + process.pid;
  try {
    writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to write provenance manifest at ${path}: ${msg}`);
  }
}
