/**
 * U7 multi-rule CLI — repeatable `--rule` (mini-plan task 4; tests for the
 * src/cli.ts:143/212-222/276-279/890-908 + src/reporters/json.ts:274-285/370
 * surface landed by mini-plan tasks 1-3).
 *
 * Contract under test:
 *
 *  1. `--rule X --rule Y` evaluates BOTH named ACTIVE rules on one test file.
 *     The report gains an additive `rules` array ONLY when >1 rule was evaluated
 *     (json.ts:370) — a single entry (even one repeated flag, deduped at
 *     cli.ts:218) keeps the legacy shape byte-for-byte.
 *  2. Top-level `ruleResults`/`summary` mirror the FIRST NAMED rule. That is a
 *     compatibility mirror, NOT an aggregate: per-rule numbers live in
 *     `rules[i].ruleResults`/`rules[i].summary`.
 *  3. D6 DRAFT opt-in: the loop iterates ONLY `options.rules` (cli.ts:890-893),
 *     never `allRules()`. A registered DRAFT rule is therefore absent from any
 *     output unless it is named explicitly. The filter is what keeps an
 *     aborted DRAFT scope out of `summary.failed`: a DRAFT rule evaluated
 *     WITHOUT opt-in aborts (null finding → summarize()'s `failed` bucket,
 *     json.ts:242-246) — the negative control below constructs exactly that
 *     abort and shows the shipped loop never performs it.
 *  4. Exit code follows the SET of scope evaluations (any rule decided -> 0;
 *     every rule aborted -> 2), never `analysis.status`.
 *
 * Same public seams as tests/cli.test.ts: real fixture on disk, real registry,
 * real engine, stdout captured through the write spy.
 */

import { join } from 'path';

import { main, runAnalysis } from '../src/cli';
import { registerRule } from '../src/rules/registry';
import { TestType } from '../src/core/analysis';
import { CT_INT_001 } from '../src/rules/ct-int-001';
import { CT_INT_003 } from '../src/rules/ct-int-003';
import { CT_INT_004 } from '../src/rules/ct-int-004';
import { RuleMetadata, RuleStatus } from '../src/core/rule';

const CASE_ROOT = join(__dirname, 'fixtures', 'ct-int-001');

function fixture(caseName: string, file = 'sample.test.ts'): string {
  return join(CASE_ROOT, caseName, file);
}

const SUBJECT = fixture('case-01-standard-assertion');

let stdout = '';
let stderr = '';
let stdoutSpy: jest.SpyInstance;
let stderrSpy: jest.SpyInstance;

beforeEach(() => {
  stdout = '';
  stderr = '';
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  });
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

/** The report the CLI wrote to stdout, parsed. Throws if it is not valid JSON. */
function report(): Record<string, any> {
  return JSON.parse(stdout) as Record<string, any>;
}

/** One check run whose full stdout is returned as the parsed JSON. */
function runCli(args: string[]): { code: number; json: Record<string, any> } {
  const code = main(args);
  return { code, json: report() };
}

/**
 * Synthetic DRAFT rule (mini-plan task 4 acceptance + council clause 3). It is a
 * CLONE of the shipped ACTIVE CT-INT-003 metadata with status flipped to DRAFT
 * and a unique test-scope id, so it registers cleanly and produces a REAL
 * verdict when named. Registered only inside this file (never a shipped rule),
 * which is the only way to exercise D6 — the shipped registry has no DRAFT rule.
 * The id is registry-valid (ID_PATTERN ^CT-[A-Z]+-[0-9]{3}$, registry.ts:20) and
 * namespaced DRAFT-9xx so it cannot collide with a shipped or sibling-test id.
 */
const DRAFT_RULE: RuleMetadata = { ...CT_INT_003, id: 'CT-DRAFT-902', status: RuleStatus.DRAFT };
/**
 * A second DRAFT clone (source: the ACTIVE CT-INT-004, whose
 * required_evidence is ['assertion_count'] — ct-int-004.ts:46 — NOT a coverage
 * record). It demonstrates BOTH halves of D6:
 *   - evaluated WITHOUT opt-in (what the banned `allRules()` loop would do), it
 *     ABORTS: null finding, zero ruleResults, summary.failed 1, exit 2 — the
 *     inflation the loop-level filter exists to prevent;
 *   - named through the CLI, `--rule` IS the opt-in (cli.ts:221
 *     `options.ruleExplicit = true` → cli.ts:887 explicitRuleIds), the D6 gate
 *     passes and it decides like its source rule.
 */
const UNEVALUATED_DRAFT_RULE: RuleMetadata = { ...CT_INT_004, id: 'CT-DRAFT-903', status: RuleStatus.DRAFT };

beforeAll(() => {
  registerRule(DRAFT_RULE);
  registerRule(UNEVALUATED_DRAFT_RULE);
});

describe('multi-rule report shape (--rule repeated)', () => {
  it('two --rule flags on one test file -> both named rules evaluated, rules[] length 2 with per-rule results + summary', () => {
    const { code, json } = runCli([
      '--test',
      SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-INT-001',
      '--rule',
      'CT-INT-003',
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(json.evaluationStatus).toBe('EVALUATED');
    expect(json.schemaVersion).toBe('0.5');
    expect(json.rules).toHaveLength(2);
    expect(json.rules.map((r: any) => r.rule)).toEqual(['CT-INT-001', 'CT-INT-003']);
    for (const entry of json.rules) {
      expect(entry.ruleResults.length).toBeGreaterThan(0);
      expect(entry.summary).toHaveProperty('total');
      // Every record in a per-rule bucket belongs to that rule.
      for (const record of entry.ruleResults) {
        expect(record.rule_id).toBe(entry.rule);
      }
    }
  });

  it('top-level ruleResults/summary mirror the FIRST named rule — a compatibility mirror, NOT an aggregate', () => {
    // A single ACTIVE rule run gives the shape each rules[] entry must hold.
    const first = runCli(['--test', SUBJECT, '--type', 'UNIT', '--rule', 'CT-INT-001']);
    const single = first.json;
    stdout = '';
    const { code, json } = runCli([
      '--test',
      SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-INT-001',
      '--rule',
      'CT-INT-003',
    ]);
    expect(code).toBe(0);
    expect(json.rules[0].ruleResults).toEqual(single.ruleResults);
    expect(json.rules[0].summary).toEqual(single.summary);
    expect(json.ruleResults).toEqual(json.rules[0].ruleResults);
    expect(json.summary).toEqual(json.rules[0].summary);
    // The mirror is NOT the aggregate: the top-level counts cover rule ONE's
    // per-rule records only, never the other rules' records. CT-COV-001 needs a
    // `line_coverage` record (ct-cov-001.ts:22) that a bare --test run never
    // supplies, so it decides INDETERMINATE — its per-rule summary
    // (indeterminate: 1) is verified-live DIFFERENT from rule one's (pass: 1),
    // while the top level still mirrors rule one exactly.
    stdout = '';
    const mixed = runCli(['--test', SUBJECT, '--type', 'UNIT', '--rule', 'CT-INT-001', '--rule', 'CT-COV-001']);
    expect(mixed.code).toBe(0);
    expect(mixed.json.rules).toHaveLength(2);
    expect(mixed.json.rules[0].summary).toEqual(json.rules[0].summary);
    expect(mixed.json.rules[1].summary).toEqual({
      total: 1,
      pass: 0,
      fail: 0,
      indeterminate: 1,
      not_applicable: 0,
      failed: 0,
    });
    // The top level equals rule one's bucket, NOT the sum of both buckets: an
    // aggregate would read total 2 here, the mirror reads total 1.
    expect(mixed.json.summary).toEqual(json.rules[0].summary);
    expect(mixed.json.summary.total).toBe(1);
    expect(mixed.json.summary).not.toEqual(mixed.json.rules[1].summary);
  });

  it('the same --rule repeated twice is deduped: single entry, no rules key (legacy shape)', () => {
    const { code, json } = runCli([
      '--test',
      SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-INT-001',
      '--rule',
      'CT-INT-001',
    ]);
    expect(code).toBe(0);
    expect(json).not.toHaveProperty('rules');
    expect(json.ruleResults).toHaveLength(1);
    expect(json.ruleResults[0].rule_id).toBe('CT-INT-001');
  });

  it('a single --rule emits no rules key (legacy single-rule shape)', () => {
    const { code, json } = runCli(['--test', SUBJECT, '--type', 'UNIT', '--rule', 'CT-INT-003']);
    expect(code).toBe(0);
    expect(json).not.toHaveProperty('rules');
    expect(json.ruleResults.length).toBeGreaterThan(0);
    for (const record of json.ruleResults) {
      expect(record.rule_id).toBe('CT-INT-003');
    }
  });

  it('no --rule -> default [CT-INT-001], no rules key, legacy bytes identical to the explicit single-rule run', () => {
    const defaultRun = main(['--test', SUBJECT, '--type', 'UNIT']);
    const defaultStdout = stdout;
    expect(defaultRun).toBe(0);
    const defaultReport = JSON.parse(defaultStdout) as Record<string, any>;
    expect(defaultReport).not.toHaveProperty('rules');
    expect(defaultReport.ruleResults.length).toBeGreaterThan(0);
    expect(defaultReport.ruleResults[0].rule_id).toBe('CT-INT-001');
    expect(defaultReport.evaluationStatus).toBe('EVALUATED');
    // The default run is byte-identical to the explicit single-rule run.
    stdout = '';
    const explicitRun = main(['--test', SUBJECT, '--type', 'UNIT', '--rule', 'CT-INT-001']);
    expect(explicitRun).toBe(0);
    expect(stdout).toBe(defaultStdout);
  });
});

describe('D6 DRAFT opt-in through the multi-rule loop', () => {
  it('a registered DRAFT rule that is NOT named is absent from the output (loop iterates only named rules)', () => {
    const { code, json } = runCli([
      '--test',
      SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-INT-001',
      '--rule',
      'CT-INT-003',
    ]);
    expect(code).toBe(0);
    expect(json.rules).toHaveLength(2);
    expect(json.rules.map((r: any) => r.rule)).not.toContain(DRAFT_RULE.id);
    expect(JSON.stringify(json)).not.toContain(DRAFT_RULE.id);
  });

  it('the default run (no --rule) never reports the DRAFT rule and summary.failed has no aborted scope', () => {
    const { code, json } = runCli(['--test', SUBJECT, '--type', 'UNIT']);
    expect(code).toBe(0);
    expect(JSON.stringify(json)).not.toContain(DRAFT_RULE.id);
    expect(json.summary.failed).toBe(0);
    expect(json.summary.total).toBe(1);
  });

  it('negative control — a DRAFT rule evaluated WITHOUT opt-in aborts and WOULD inflate summary.failed', () => {
    // The banned path (evaluate every registered rule) makes every unnamed
    // DRAFT abort at the D6 gate: finding === null, no verdict, zero
    // ruleResults, and summarize() counts the null-finding scope as `failed`
    // (json.ts:242-246). Constructed through the runAnalysis seam with
    // `ruleExplicit` absent — exactly what allRules() iteration would mean.
    // Naming a rule through the CLI can NEVER produce this state: --rule sets
    // `ruleExplicit` (cli.ts:221), so the gate always passes.
    const { report: json, exitCode } = runAnalysis({
      test: SUBJECT,
      type: TestType.UNIT,
      rules: [UNEVALUATED_DRAFT_RULE.id],
      format: 'json',
    });
    expect(exitCode).toBe(2);
    const parsed = JSON.parse(json) as Record<string, any>;
    expect(parsed.evaluationStatus).toBe('FAILED');
    expect(parsed.ruleResults).toEqual([]);
    expect(parsed.summary.total).toBe(1);
    expect(parsed.summary.failed).toBe(1);
  });

  it('the same DRAFT named through the CLI decides — --rule IS the opt-in that lifts the gate', () => {
    // ct-int-004.ts:46 required_evidence is ['assertion_count'], which the
    // case-01 envelope supplies, so opted-in it decides like its source rule.
    const { code, json } = runCli(['--test', SUBJECT, '--type', 'UNIT', '--rule', UNEVALUATED_DRAFT_RULE.id]);
    expect(code).toBe(0);
    expect(json).not.toHaveProperty('rules');
    expect(json.ruleResults).toHaveLength(1);
    expect(json.ruleResults[0].rule_id).toBe(UNEVALUATED_DRAFT_RULE.id);
    expect(json.ruleResults[0].result).toBe('PASS');
    expect(json.summary.failed).toBe(0);
  });

  it('summary.failed never counts an aborted DRAFT scope in a shipped run: the unnamed draft is never iterated while named ACTIVE rules decide', () => {
    const { code, json } = runCli([
      '--test',
      SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-INT-001',
      '--rule',
      'CT-INT-003',
    ]);
    expect(code).toBe(0);
    expect(JSON.stringify(json)).not.toContain(UNEVALUATED_DRAFT_RULE.id);
    expect(json.rules).toHaveLength(2);
    // Named ACTIVE rules decided → zero aborted scopes counted; the registered
    // draft that WOULD abort (see the negative control above) was never
    // iterated, so its null-finding scope cannot reach summary.failed.
    expect(json.summary.failed).toBe(0);
    expect(json.rules.every((r: any) => r.summary.failed === 0)).toBe(true);
  });

  it('a DRAFT rule named via --rule is evaluated alongside an ACTIVE rule (D6 opt-in): rules[] holds both with real verdicts', () => {
    const { code, json } = runCli([
      '--test',
      SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-INT-001',
      '--rule',
      DRAFT_RULE.id,
    ]);
    expect(code).toBe(0);
    expect(json.rules).toHaveLength(2);
    expect(json.rules.map((r: any) => r.rule)).toEqual(['CT-INT-001', DRAFT_RULE.id]);
    const draft = json.rules[1];
    expect(draft.ruleResults.length).toBeGreaterThan(0);
    expect(draft.ruleResults[0].rule_id).toBe(DRAFT_RULE.id);
    expect(['PASS', 'FAIL', 'INDETERMINATE', 'NOT_APPLICABLE']).toContain(draft.ruleResults[0].result);
    // A clone carries the SOURCE rule's local_decision verbatim, so its reason
    // text names the original id. The verdict is real regardless: this scope was
    // evaluated, not aborted.
    expect(String(draft.ruleResults[0].reason)).toContain('unestablished_assertions=');
  });

  it('a DRAFT scope that DECIDES contributes 0 to summary.failed (opting-in draft + ACTIVE, case-01)', () => {
    const { code, json } = runCli([
      '--test',
      SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-INT-001',
      '--rule',
      DRAFT_RULE.id,
    ]);
    // Both scopes DECIDED (the DRAFT clone passes on case-01), so neither the
    // mirror nor the per-rule buckets count an aborted scope.
    expect(code).toBe(0);
    for (const entry of json.rules) {
      expect(entry.summary.failed).toBe(0);
    }
    expect(json.summary.failed).toBe(0);
  });
});

describe('multi-rule exit code (decided = any rule decided)', () => {
  it('two named rules both decided -> exit 0', () => {
    const code = main(['--test', SUBJECT, '--type', 'UNIT', '--rule', 'CT-INT-001', '--rule', 'CT-INT-003']);
    expect(code).toBe(0);
    expect(report().evaluationStatus).toBe('EVALUATED');
  });

  it('all rules abort (FAILED analysis) -> exit 2 with empty rules[] and each per-rule summary counting the abort', () => {
    const broken = fixture('case-11-collector-failure', 'broken.test.ts');
    const { report: json, exitCode } = runAnalysis({
      test: broken,
      type: TestType.UNIT,
      rules: ['CT-INT-001', 'CT-INT-003'],
      format: 'json',
    });
    expect(exitCode).toBe(2);
    const parsed = JSON.parse(json) as Record<string, any>;
    expect(parsed.analysisStatus).toBe('FAILED');
    expect(parsed.evaluationStatus).toBe('FAILED');
    expect(parsed.rules).toHaveLength(2);
    expect(parsed.rules.every((r: any) => r.ruleResults.length === 0)).toBe(true);
    // Aborted scopes ARE counted as failed per rule (json.ts:242-246, the
    // existing contract): the multi-rule FAILED analysis mirrors the
    // single-rule one exactly, and the multi-rule mirror does not inflate the
    // count beyond what a single rule run reports (verified live: single run
    // → summary.failed 1, exit 2).
    expect(parsed.summary.failed).toBe(1);
    expect(parsed.rules.every((r: any) => r.summary.failed === 1)).toBe(true);
  });

  it('a rule that produces NO per-test verdict (CT-MUT-001, file-level C4) alongside a deciding rule -> exit 0 (OR across rules)', () => {
    // CT-MUT-001 is the file-level-only rule (cli.ts:938 C4 special case): with
    // no --mutation-report its subject-level evaluation is still decided
    // (INDETERMINATE is a verdict), while the per-test buckets stay empty —
    // verified live. The OR in anyDecided is what keeps the run at exit 0.
    const { code, json } = runCli([
      '--test',
      SUBJECT,
      '--type',
      'UNIT',
      '--rule',
      'CT-INT-001',
      '--rule',
      'CT-MUT-001',
    ]);
    expect(code).toBe(0);
    expect(json.rules).toHaveLength(2);
    expect(json.evaluationStatus).toBe('EVALUATED');
    expect(json.rules[1].summary).toEqual({
      total: 0,
      pass: 0,
      fail: 0,
      indeterminate: 0,
      not_applicable: 0,
      failed: 0,
    });
  });
});
