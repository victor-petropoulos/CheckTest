#!/usr/bin/env node
/**
 * CLI entry point (plan task 6; KickOff:179, :224).
 *
 * This is the ONE composition module: it is the only place that imports the
 * collector, the engine and the reporter together (plan §1, seam map "E1
 * composition point"). It contains no evaluation logic — it parses flags,
 * wires the three layers in a fixed order, and maps outcomes to exit codes:
 *
 *   collectAnalysis(path, declaredType) → AnalysisOutput
 *   evaluateRule(rule, output)          → EvaluationResult (status + finding)
 *   evaluateTests(rule, output)         → TestEvaluation[] (one per scope)
 *   toJson(output, evaluation, scopes)  → string on stdout
 *
 * Exit codes: 2 when NO scope produced a verdict (every evaluation is
 * EvaluationStatus FAILED), 0 when at least one was — for ANY RuleResult,
 * including FAIL, INDETERMINATE and N/A — and 1 on a usage error or a crash. A
 * rule FAIL and an UNSUPPORTED analysis are still successful analyses, reported
 * explicitly in the JSON (`ruleResults` / `analysisStatus`), so they keep exit
 * 0; whether a FAILED test should gate CI is a policy decision above this layer
 * (SPEC:407). Only exit 2 describes a run that produced no verdict at all
 * (SPEC:405).
 *
 * stderr is the channel for USAGE and CRASH only. A FAILED test is reported in
 * the JSON — never on stderr — so a machine consumer never has to parse prose.
 *
 * Nothing here is inferred: the declared test type comes from `--type` and is
 * never guessed from the file (plan A3, SPEC:450-458).
 */

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';

import { collectAnalysis } from './adapters/typescript/collector';
import { applyCoverageReport } from './providers/coverage';
import { applyMutationReport } from './providers/mutation';
import { TestType } from './core/analysis';
import { applyConfigToRule, CheckTestConfig, loadConfig, UsageError } from './core/config';
import { evaluateRule, evaluateTests } from './core/evaluation';
import { EvaluationStatus } from './core/result';
import { toJson } from './reporters/json';
import { toSarif } from './reporters/sarif';
import { CT_INT_001 } from './rules/ct-int-001';
import { CT_INT_003 } from './rules/ct-int-003';
import { CT_INT_004 } from './rules/ct-int-004';
import { CT_COV_001 } from './rules/ct-cov-001';
import { CT_MUT_001 } from './rules/ct-mut-001';
import { getRule, registerRule } from './rules/registry';

// Single source of truth: package.json. Resolved relative to this module so it
// works under ts-jest (src/), compiled output (dist/src/), and global install.
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

const VERSION = readVersion();

const USAGE = [
  'Usage: checktest [check] --test <path> [--type <TYPE>] [--rule <id>] [--format <fmt>] [--config <path>]',
  '',
  '  --test <path>   test file to analyze (required)',
  '  --type <TYPE>   declared test type: ' + Object.values(TestType).join(' | '),
  '                  (default UNKNOWN; never inferred from the file)',
  '  --rule <id>     rule to evaluate (default ' + CT_INT_001.id + ')',
  "  --format <fmt>  report format: 'json' | 'sarif' (default json)",
  '  --coverage-report <path>  external Istanbul/c8 coverage report to attach',
  '  --coverage-map <from>=<to>  map analyzed file path to report key (repeatable)',
  '  --per-test-run            mark the coverage report as a single-test-file run (CT-COV-001)',
  '  --mutation-report <path>  external Stryker mutation report to attach',
  '  --config <path>           explicit config file (checktest.config.json); no implicit discovery',
  '',
  'Writes the report (JSON by default, SARIF 2.1.0 with --format sarif) to',
  'stdout. Exits 0 when the rule was evaluated (any',
  'rule result, including FAIL, and any UNSUPPORTED analysis), 2 when the engine',
  'reached no verdict (including a file that declares no tests), and 1 on a usage',
  'error or a failed run.',
].join('\n');

/** Report formats. JSON stays the default and byte-unchanged; SARIF is additive. */
const FORMAT_JSON = 'json';
const FORMAT_SARIF = 'sarif';
const FORMATS: readonly string[] = [FORMAT_JSON, FORMAT_SARIF];

export interface Options {
  test: string;
  type: TestType;
  rule: string;
  format: string;
  coverageReport?: string;
  coverageMap?: string[];
  /** CT-COV-001: the coverage report came from a run scoped to one test file. */
  perTestRun?: boolean;
  mutationReport?: string;
  config?: CheckTestConfig;
  ruleExplicit?: boolean;
}

/** A flag was wrong. Distinguished from a crash so usage is shown, not a stack.
 * Re-exported from the config layer (SP4.1) so a single UsageError travels
 * through both surfaces. */
export { UsageError };

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    test: '',
    type: TestType.UNKNOWN,
    rule: CT_INT_001.id,
    format: FORMAT_JSON,
    coverageMap: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    // `--per-test-run` is the one value-less flag: it is handled BEFORE the
    // missing-value guard below, and `continue` advances past this token only.
    if (flag === '--per-test-run') {
      options.perTestRun = true;
      continue;
    }
    // Every supported flag is `--name value`, so a missing value is detected
    // here rather than silently consuming the next flag as a path.
    const value = argv[i + 1];
    if (value === undefined) {
      throw new UsageError(`missing value for '${flag}'`);
    }

    switch (flag) {
      case '--test':
        options.test = value;
        break;
      case '--type':
        if (!isTestType(value)) {
          throw new UsageError(`invalid --type '${value}'; expected one of: ${Object.values(TestType).join(', ')}`);
        }
        options.type = value;
        break;
      case '--rule':
        if (getRule(value) === undefined) {
          throw new UsageError(
            `unknown --rule '${value}'; expected one of registered rules (use --rule CT-INT-001 default)`,
          );
        }
        options.rule = value;
        options.ruleExplicit = true;
        break;
      case '--config':
        options.config = loadConfig(value, [CT_INT_001.id, CT_INT_003.id, CT_INT_004.id, CT_COV_001.id, CT_MUT_001.id]);
        break;
      case '--format':
        if (!FORMATS.includes(value)) {
          throw new UsageError(`unsupported --format '${value}'; expected one of: ${FORMATS.join(', ')}`);
        }
        options.format = value;
        break;
      case '--coverage-report':
        options.coverageReport = value;
        break;
      case '--coverage-map':
        if (!value.includes('=')) {
          throw new UsageError(`invalid --coverage-map '${value}'; expected '<from>=<to>'`);
        }
        options.coverageMap = options.coverageMap ?? [];
        options.coverageMap.push(value);
        break;
      case '--mutation-report':
        options.mutationReport = value;
        break;
      default:
        throw new UsageError(`unknown argument '${flag}'`);
    }
    i += 1;
  }

  if (options.test === '') {
    throw new UsageError('--test <path> is required');
  }
  return options;
}

function isTestType(value: string): value is TestType {
  return (Object.values(TestType) as string[]).includes(value);
}

/**
 * Run one analysis and write its report.
 *
 * @returns the process exit code (0 = at least one scope reached a verdict,
 *   1 = usage error or crash, 2 = no scope reached a verdict)
 */
export function main(argv: readonly string[]): number {
  // Registration is explicit here, never an import side effect, so importing
  // this module has no observable behaviour.
  // Registration happens BEFORE --config is parsed (parseArgs runs after). The
  // config is applied per registered rule below, after parseArgs, gating
  // `enabled` rules by unregistering. Enabled flags are therefore the
  // config-controlled switch over registration (minimal, no new dispatchers).
  registerRule(CT_INT_001);
  registerRule(CT_INT_003);
  registerRule(CT_INT_004);
  registerRule(CT_COV_001);
  registerRule(CT_MUT_001);

  // Allow a leading 'check' subcommand (npm global usage) without changing
  // the flat flag contract: 'checktest check ...' ≡ 'checktest ...'.
  let args = argv;
  if (args.length > 0 && args[0] === 'check') {
    args = args.slice(1);
  }

  if (args.length === 0) {
    process.stderr.write(`checktest: --test <path> is required\n\n${USAGE}\n`);
    return 1;
  }

  // Early, no-args-required flags handled before parseArgs (which requires --test).
  if (args.includes('--version')) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  let options: Options;
  try {
    options = parseArgs(args);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`checktest: ${error.message}\n\n${USAGE}\n`);
      return 1;
    }
    throw error;
  }

  const baseRule = getRule(options.rule);
  // Unreachable: parseArgs rejects unknown rule ids. Guards against a rule being
  // unregistered between validation and lookup.
  if (baseRule === undefined) {
    process.stderr.write(`checktest: unknown --rule '${options.rule}'\n\n${USAGE}\n`);
    return 1;
  }
  const configOverride = options.config?.rules?.[baseRule.id];
  if (configOverride?.enabled === false) {
    process.stderr.write(`checktest: rule '${baseRule.id}' is disabled by config\n\n${USAGE}\n`);
    return 1;
  }

  try {
    const result = runAnalysis(options);
    process.stdout.write(`${result.report}\n`);
    return result.exitCode;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`checktest: ${error.message}\n\n${USAGE}\n`);
      return 1;
    }
    // Only a genuine crash reaches here: the collector converts unreadable or
    // unparseable input into a FAILED envelope instead of throwing.
    process.stderr.write(`checktest: analysis of '${options.test}' failed: ${(error as Error).message}\n`);
    return 1;
  }
}

/**
 * Pure collect→evaluate→serialize pipeline. No I/O, no process references.
 */
export function runAnalysis(options: Options): { report: string; exitCode: number } {
  const baseRule = getRule(options.rule);
  if (baseRule === undefined) {
    throw new UsageError(`unknown --rule '${options.rule}'`);
  }
  // SP4.1: apply config overrides to the selected rule only. Config may change
  // thresholds + severity + enabled (enabled is gated in main() above), never
  // evidence semantics — see src/core/config.ts applyConfigToRule (structural
  // copy; POLICY_FIELDS remain untouched).
  const overrideForSelected = options.config?.rules?.[baseRule.id];
  const rule = overrideForSelected === undefined ? baseRule : applyConfigToRule(baseRule, overrideForSelected);
  let analysis = collectAnalysis(options.test, options.type);
  // Git HEAD auto-detect for report freshness (WP1.3): when a report is
  // supplied, obtain the analyzed revision from git HEAD (falling back to
  // 'unknown' outside a repo) and pass it to the providers as analyzed_revision.
  let analyzedRevision: string | undefined;
  if (options.coverageReport !== undefined || options.mutationReport !== undefined) {
    try {
      analyzedRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      analyzedRevision = 'unknown';
    }
  }
  if (options.coverageReport !== undefined || (options.coverageMap !== undefined && options.coverageMap.length > 0)) {
    // Coverage report path is required for a mapping to resolve; if only a map is
    // supplied without a report, there is nothing to map and we skip.
    if (options.coverageReport !== undefined) {
      analysis = applyCoverageReport(analysis, options.coverageReport, {
        analyzedRevision,
        coverageMap: options.coverageMap,
        per_test_run: options.perTestRun,
      });
    }
  }
  // Mutation evidence is file-level only. When --mutation-report points to a
  // parseable Stryker report, CT-MUT-001 (registered cli.ts:187) consumes the
  // mutation_score record and can flip the verdict (PASS ≥ 0.5, FAIL < 0.5);
  // missing / malformed / zero-valid / mismatched evidence stays INDETERMINATE.
  if (options.mutationReport !== undefined) {
    analysis = applyMutationReport(analysis, options.mutationReport, { analyzedRevision });
  }
  // The engine reports whether a verdict was reached at all; an aborted
  // evaluation (FAILED analysis) yields status FAILED with no finding, so the
  // report carries an empty ruleResults array rather than a fabricated verdict.
  const evaluation = evaluateRule(rule, analysis);
  // The SAME rule over every scope: one entry per located declaration, or a
  // single subject-level entry when the collector produced none. These are the
  // per-test records the report serializes.
  const scopes = evaluateTests(rule, analysis);
  // Format selection is a pure serialization choice on the SAME evaluation:
  // SARIF is additive, JSON remains the default and byte-unchanged.
  const report =
    options.format === FORMAT_SARIF
      ? toSarif(analysis, evaluation, rule, scopes)
      : toJson(analysis, evaluation, scopes);
  // Map on the SET of scope evaluations, NEVER on `analysis.status`. Under the
  // FAILED-first order (evaluation.ts step 0) an aborted scope yields NO
  // verdict at all — no applicability N/A, no INDETERMINATE — so exit 2 means
  // every scope aborted, and exit 0 means at least one was decided. A per-test
  // FAIL is a decided verdict: it is reported in `testResults`/`summary` and
  // does not change the exit code (plan task 7).
  //
  // NO-TESTS LANDS IN THIS SAME BUCKET (user_decisions UD-8, which resolved
  // DPC-2 on 2026-10-16). After WP1.1 a file whose collector supplied
  // `tests: []` yields `evaluateTests` -> [] and therefore ZERO scopes: no
  // scope was evaluated, so this line exits 2 exactly as an aborted
  // evaluation does.
  //
  // Exit 2 is the SINGLE "no verdict" bucket. No new exit code is introduced:
  // there is no fourth value and no dedicated "no tests found" code, and
  // REPORT_SCHEMA_VERSION is not bumped. Exit 0 means at least one scope
  // reached EVALUATED, including a decided-but-not-failing N/A or
  // INDETERMINATE. Exit 1 stays reserved for usage errors and genuine crashes.
  //
  // A no-tests file is NOT an analysis failure — `analysisStatus` stays
  // SUCCESS because the analysis itself completed — and it is NOT a rule FAIL:
  // no scope exists to hold a finding, so `ruleResults` and `testResults` stay
  // empty rather than carrying a fabricated verdict.
  //
  // Contract mirror: the tests plus this comment (UD-8).
  const exitCode = scopes.some((scope) => scope.status === EvaluationStatus.EVALUATED) ? 0 : 2;
  return { report, exitCode };
}

// `process.exitCode` rather than `process.exit()`: stdout is asynchronous when
// piped, and exiting immediately can truncate the report.
if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
