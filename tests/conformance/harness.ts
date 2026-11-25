/**
 * WP6 task 1 — shared conformance harness for the frozen WP5 fixture catalog.
 *
 * Implements docs/adapter-conformance.md §D steps 1-5 and 7: load a sidecar,
 * resolve the adapter through the registry, collect normalized evidence,
 * evaluate the five registered rules through the shared engine, compare against
 * the sidecar, and emit one six-field diagnostic per mismatch (§D step 7).
 * Step 6 (wire-contract validation) belongs to the reporter suites. Nothing here
 * re-implements collector or engine semantics.
 *
 * tests/ only. No src changes, no new dependencies, no fixture edits.
 *
 * Manifest state is scoped to the fixture directory: the repo-root package.json
 * would otherwise make the manifest layer resolve every .py file to the TS
 * adapter. Scoping keeps resolveAdapter's own layer semantics (extension decides
 * here) while letting each fixture stand as its own project.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import type { Adapter, AdapterOptions } from '../../src/adapters/adapter';
import { AdapterResolution, defaultRegistry, resolveAdapter } from '../../src/adapters/registry';
import { AnalysisOutput } from '../../src/core/analysis';
import type { EvidenceRecord } from '../../src/core/evidence';
import { evaluateRule, evaluateTests } from '../../src/core/evaluation';
import type { EvaluationResult, TestEvaluation } from '../../src/core/result';
import type { RuleMetadata } from '../../src/core/rule';
import { CT_INT_001 } from '../../src/rules/ct-int-001';
import { CT_INT_003 } from '../../src/rules/ct-int-003';
import { CT_INT_004 } from '../../src/rules/ct-int-004';
import { CT_COV_001 } from '../../src/rules/ct-cov-001';
import { CT_MUT_001 } from '../../src/rules/ct-mut-001';

export type Language = 'ts' | 'python';

/** Sidecar finding entry (tests/fixtures/conformance/README.md "Sidecar finding shape"). */
export interface FindingExpectation {
  rule_id: string;
  result: string;
  test_id_present?: boolean;
}

interface DiscoveryExpectation {
  count?: number;
  sites?: Array<Record<string, unknown>>;
  declarationToken?: string;
}

export interface Sidecar {
  fixtureId: string;
  expectedDiscovery?: Record<string, DiscoveryExpectation>;
  expectedEnvelope?: { analysisStatus?: string; evaluationStatus?: string; completeness?: string };
  expectedEnvelopeByLanguage?: Record<
    Language,
    { analysisStatus?: string; evaluationStatus?: string; completeness?: string }
  >;
  expectedEvidence?: { perTest?: Record<string, unknown>; fileLevel?: Record<string, unknown> };
  expectedEvidenceByLanguage?: Record<
    Language,
    { perTest?: Record<string, unknown>; fileLevel?: Record<string, unknown> }
  >;
  expectedApplicability?: string[];
  expectedFindings?: FindingExpectation[] | Record<string, FindingExpectation[]>;
  expectedDiagnostics?: { reasons?: string[] };
  [key: string]: unknown;
}

export interface Fixture {
  fixtureId: string;
  dir: string;
  sidecar: Sidecar;
  sources: { ts?: string; python?: string; externalReport?: string };
}

/** §D step 7 — the six-field failure diagnostic. */
export interface Diagnostic {
  adapter: string | null;
  fixture: string;
  expected: unknown;
  actual: unknown;
  evidence: unknown;
  diagnostics: { reason: string; completeness: string };
}

export interface ActualFinding {
  rule_id: string;
  test_id: string | null;
  test_id_present: boolean;
  result: string | null;
  reason: string | null;
}

export interface ConformanceResult {
  fixtureId: string;
  language: Language;
  status: 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'UNSUPPORTED';
  adapterId: string | null;
  decidedBy: AdapterResolution['decidedBy'] | null;
  reason: string | null;
  mismatches: Diagnostic[];
  actual: {
    envelope: { analysisStatus: string | null; evaluationStatus: string | null; completeness: string | null };
    evidenceKeys: { fileLevel: string[]; perTest: string[][] };
    findings: ActualFinding[];
  };
}

interface RuleEvaluation {
  subject: EvaluationResult;
  tests: TestEvaluation[];
}

interface FixtureRun {
  adapter: Adapter;
  resolution: AdapterResolution;
  analysis: AnalysisOutput;
}

type CollectOutcome =
  | { kind: 'not-applicable'; reason: string }
  | { kind: 'unsupported'; resolution: AdapterResolution }
  | { kind: 'collected'; run: FixtureRun };

interface Ctx {
  fixtureId: string;
  adapterId: string | null;
  adapter: Adapter | null;
  completeness: string;
  mismatches: Diagnostic[];
}

/** The five registered rules (cli.ts:589-593), imported directly — no registry side effects. */
const REGISTERED_RULES: Record<string, RuleMetadata> = {
  'CT-INT-001': CT_INT_001,
  'CT-INT-003': CT_INT_003,
  'CT-INT-004': CT_INT_004,
  'CT-COV-001': CT_COV_001,
  'CT-MUT-001': CT_MUT_001,
};

/** External provider ids are not pinned by WP5 (README placeholder table); skip that field. */
const UNPINNED = Symbol('unpinned');

/* ------------------------------------------------------------------ *
 * Step 1 — load fixture catalog entry.
 * ------------------------------------------------------------------ */

export function loadFixture(fixtureId: string): Fixture {
  const dir = join(__dirname, '..', 'fixtures', 'conformance', 'fixtures', fixtureId);
  const sidecarPath = join(dir, `${fixtureId}.expected.json`);
  if (!existsSync(sidecarPath)) throw new Error(`conformance fixture not found: ${sidecarPath}`);
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Sidecar;
  const ts = join(dir, 'sample.ts');
  const py = join(dir, 'sample.py');
  const external = join(dir, 'external-report.json');
  return {
    fixtureId,
    dir,
    sidecar,
    sources: {
      ts: existsSync(ts) ? ts : undefined,
      python: existsSync(py) ? py : undefined,
      externalReport: existsSync(external) ? external : undefined,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Steps 2-3 — registry dispatch + collect.
 * ------------------------------------------------------------------ */

function collectFixture(fixture: Fixture, language: Language, options?: AdapterOptions): CollectOutcome {
  const source = language === 'ts' ? fixture.sources.ts : fixture.sources.python;
  const branch = fixture.sidecar.expectedDiscovery?.[language];
  if (!source || !branch) {
    return { kind: 'not-applicable', reason: `fixture ${fixture.fixtureId} has no ${language} source/sidecar branch` };
  }
  const resolution = resolveAdapter(
    source,
    {},
    { manifestExists: (name) => existsSync(join(dirname(source), name)) },
    defaultRegistry,
  );
  if (resolution.adapterId === null || resolution.decidedBy === 'unsupported') {
    return { kind: 'unsupported', resolution };
  }
  const adapter = defaultRegistry.get(resolution.adapterId);
  if (adapter === undefined) return { kind: 'unsupported', resolution };
  const analysis = adapter.collectAnalysis(source, options);
  // Mirror cli.ts: the dispatch decision rides on the envelope (ADR-035).
  analysis.adapter = resolution.adapterId;
  analysis.decidedBy = resolution.decidedBy;
  return { kind: 'collected', run: { adapter, resolution, analysis } };
}

/* ------------------------------------------------------------------ *
 * Step 4 — evaluate the sidecar's rules through the shared engine.
 * ------------------------------------------------------------------ */

function expectedFindingList(sidecar: Sidecar, language: Language): FindingExpectation[] {
  const f = sidecar.expectedFindings;
  if (Array.isArray(f)) return f;
  if (f && typeof f === 'object') return (f as Record<string, FindingExpectation[]>)[language] ?? [];
  return [];
}

function sidecarRuleIds(sidecar: Sidecar): string[] {
  const ids = new Set<string>(sidecar.expectedApplicability ?? []);
  const f = sidecar.expectedFindings;
  const lists = Array.isArray(f) ? [f] : f && typeof f === 'object' ? Object.values(f) : [];
  for (const list of lists) for (const entry of list) ids.add(entry.rule_id);
  return [...ids];
}

function evaluateRules(ruleIds: string[], analysis: AnalysisOutput): Map<string, RuleEvaluation> {
  const map = new Map<string, RuleEvaluation>();
  for (const id of ruleIds) {
    const rule = REGISTERED_RULES[id];
    if (rule === undefined) continue; // unknown id is reported by compareFindings
    map.set(id, { subject: evaluateRule(rule, analysis), tests: evaluateTests(rule, analysis) });
  }
  return map;
}

/** evaluationStatus is the absence/presence of a verdict across the evaluated rules. */
function deriveEvaluationStatus(evaluations: Map<string, RuleEvaluation>): string {
  for (const ev of evaluations.values()) {
    if (ev.subject.finding !== null) return 'EVALUATED';
    if (ev.tests.some((t) => t.finding !== null)) return 'EVALUATED';
  }
  return 'FAILED';
}

/* ------------------------------------------------------------------ *
 * Step 5 — compare against the sidecar. Collect ALL mismatches.
 * ------------------------------------------------------------------ */

function mismatch(ctx: Ctx, expected: unknown, actual: unknown, evidence: unknown, reason: string): void {
  ctx.mismatches.push({
    adapter: ctx.adapterId,
    fixture: ctx.fixtureId,
    expected,
    actual,
    evidence,
    diagnostics: { reason, completeness: ctx.completeness },
  });
}

/** Deep equality; sidecar null and a collector's absent value are the same wire state. */
function eq(expected: unknown, actual: unknown): boolean {
  if (expected === null && actual === undefined) return true;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return expected.length === actual.length && expected.every((v, i) => eq(v, actual[i]));
  }
  if (expected !== null && actual !== null && typeof expected === 'object' && typeof actual === 'object') {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    const keys = Object.keys(e);
    return keys.length === Object.keys(a).length && keys.every((k) => eq(e[k], a[k]));
  }
  return expected === actual;
}

/** Plain-object guard for mergeExpected: excludes null and arrays. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Plan task 2 — deep-merge a per-language sidecar branch over its shared block:
 * the branch wins per key, plain objects merge recursively, arrays/scalars/null
 * replace wholesale, and keys present only in `shared` are kept. Returns `shared`
 * unchanged when the branch is absent; never mutates either input.
 */
export function mergeExpected<T extends Record<string, unknown>>(
  branch: T | undefined,
  shared: T | undefined,
): T | undefined {
  if (branch === undefined) return shared;
  if (shared === undefined) return branch;
  const merged: Record<string, unknown> = { ...shared };
  for (const [key, branchValue] of Object.entries(branch)) {
    const sharedValue = (shared as Record<string, unknown>)[key];
    if (isPlainObject(branchValue) && isPlainObject(sharedValue)) {
      merged[key] = mergeExpected(branchValue, sharedValue);
    } else {
      merged[key] = branchValue;
    }
  }
  return merged as T;
}

function resolvePlaceholder(expected: unknown, adapter: Adapter | null): unknown {
  if (expected === 'ADAPTER_SOURCE') return adapter?.id ?? expected;
  if (expected === 'ADAPTER_FRAMEWORKS') return adapter?.capabilities.frameworks ?? expected;
  if (expected === 'ADAPTER_FORMS') return adapter?.capabilities.assertionForms ?? expected;
  if (expected === 'EXTERNAL_COVERAGE_PROVIDER' || expected === 'EXTERNAL_MUTATION_PROVIDER') return UNPINNED;
  return expected;
}

/** Compare only the fields the sidecar pins; absent sidecar fields are not asserted. */
function compareFields(
  ctx: Ctx,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  evidence: unknown,
  label: string,
): void {
  for (const [key, exp] of Object.entries(expected)) {
    const act = actual[key];
    if (exp === 'MUST_BE_ABSENT') {
      if (key in actual) mismatch(ctx, 'MUST_BE_ABSENT', act, evidence, `${label}.${key} must be absent`);
      continue;
    }
    if (exp !== null && typeof exp === 'object' && !Array.isArray(exp)) {
      if (act === null || typeof act !== 'object' || Array.isArray(act)) {
        mismatch(ctx, exp, act, evidence, `${label}.${key} shape differs from sidecar`);
        continue;
      }
      compareFields(ctx, exp as Record<string, unknown>, act as Record<string, unknown>, evidence, `${label}.${key}`);
      continue;
    }
    const resolved = resolvePlaceholder(exp, ctx.adapter);
    if (resolved === UNPINNED) continue;
    if (!eq(resolved, act)) mismatch(ctx, exp, act, evidence, `${label}.${key} does not match sidecar`);
  }
}

function compareDiscovery(ctx: Ctx, sidecar: Sidecar, language: Language, analysis: AnalysisOutput): void {
  const exp = sidecar.expectedDiscovery?.[language];
  if (!exp) return;
  const tests = analysis.tests ?? [];
  if (exp.count !== undefined && exp.count !== tests.length) {
    mismatch(
      ctx,
      exp.count,
      tests.length,
      tests.map((t) => t.test),
      'discovery count does not match sidecar',
    );
  }
  const sites = exp.sites ?? [];
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const t = tests[i];
    if (!t) {
      mismatch(
        ctx,
        site,
        undefined,
        tests.map((x) => x.test),
        'discovery site absent from collection',
      );
      continue;
    }
    if (site['line'] !== undefined && site['line'] !== t.test.line) {
      mismatch(ctx, site['line'], t.test.line, t.test, 'discovery line does not match sidecar');
    }
    // Python declaration token is NOT_VERIFIED at WP5 — skip that sub-assertion.
    if (
      site['declaration'] !== undefined &&
      exp.declarationToken !== 'NOT_VERIFIED' &&
      site['declaration'] !== t.test.declaration
    ) {
      mismatch(ctx, site['declaration'], t.test.declaration, t.test, 'discovery declaration does not match sidecar');
    }
    // Extra pinned site fields (assertionLine/helperCallLine/...) map to the
    // declaration's assertion_count evidence location line.
    for (const [key, val] of Object.entries(site)) {
      if (key === 'line' || key === 'declaration') continue;
      const loc = t.evidence['assertion_count']?.location?.line;
      if (!eq(val, loc)) mismatch(ctx, val, loc, t.test, `discovery ${key} does not match sidecar`);
    }
  }
}

function compareEnvelope(
  ctx: Ctx,
  sidecar: Sidecar,
  language: Language,
  analysis: AnalysisOutput,
  evaluations: Map<string, RuleEvaluation>,
): void {
  const env = mergeExpected(sidecar.expectedEnvelopeByLanguage?.[language], sidecar.expectedEnvelope);
  if (!env) return;
  if (env.analysisStatus !== undefined && env.analysisStatus !== analysis.analysis.status) {
    mismatch(
      ctx,
      env.analysisStatus,
      analysis.analysis.status,
      analysis.analysis,
      'analysisStatus does not match sidecar',
    );
  }
  if (env.completeness !== undefined && env.completeness !== analysis.analysis.completeness) {
    mismatch(
      ctx,
      env.completeness,
      analysis.analysis.completeness,
      analysis.analysis,
      'completeness does not match sidecar',
    );
  }
  const evalStatus = deriveEvaluationStatus(evaluations);
  if (env.evaluationStatus !== undefined && env.evaluationStatus !== evalStatus) {
    mismatch(ctx, env.evaluationStatus, evalStatus, analysis.analysis, 'evaluationStatus does not match sidecar');
  }
}

function compareEvidence(ctx: Ctx, sidecar: Sidecar, language: Language, analysis: AnalysisOutput): void {
  const ee = mergeExpected(sidecar.expectedEvidenceByLanguage?.[language], sidecar.expectedEvidence);
  if (!ee) return;
  if (ee.perTest) {
    const tests = analysis.tests ?? [];
    if (tests.length === 0 && Object.keys(ee.perTest).length > 0) {
      mismatch(ctx, ee.perTest, undefined, [], 'per-test evidence expected but no declarations collected');
    }
    for (const t of tests) {
      compareFields(
        ctx,
        ee.perTest,
        t.evidence as unknown as Record<string, unknown>,
        t.evidence,
        `perTest[${t.test.id}]`,
      );
    }
  }
  if (ee.fileLevel) {
    compareFields(
      ctx,
      ee.fileLevel,
      analysis.evidence as unknown as Record<string, unknown>,
      analysis.evidence,
      'fileLevel',
    );
  }
}

function compareFindings(
  ctx: Ctx,
  sidecar: Sidecar,
  language: Language,
  analysis: AnalysisOutput,
  evaluations: Map<string, RuleEvaluation>,
): void {
  const expected = expectedFindingList(sidecar, language);
  const tests = analysis.tests ?? [];
  for (const exp of expected) {
    const ev = evaluations.get(exp.rule_id);
    if (!ev) {
      mismatch(ctx, exp, undefined, null, `rule ${exp.rule_id} was not evaluated`);
      continue;
    }
    if (exp.test_id_present === false) {
      // File-level (non-attributed) finding: subject scope, no test_id.
      const f = ev.subject.finding;
      if (!f) mismatch(ctx, exp, { status: ev.subject.status }, null, `no subject-level finding for ${exp.rule_id}`);
      else if (f.result !== exp.result) {
        mismatch(ctx, exp, { rule_id: f.rule_id, result: f.result }, f, 'verdict does not match sidecar');
      }
      continue;
    }
    // Per-declaration finding: the expected list applies to each declaration.
    if (tests.length === 0) {
      mismatch(ctx, exp, ev.tests, null, `no per-declaration scopes for ${exp.rule_id}`);
      continue;
    }
    for (const t of tests) {
      const te = ev.tests.find((x) => x.test?.id === t.test.id);
      const f = te?.finding;
      if (!f) mismatch(ctx, exp, te ?? null, t.evidence, `no per-declaration finding for ${exp.rule_id}`);
      else if (f.result !== exp.result) {
        mismatch(
          ctx,
          exp,
          { rule_id: f.rule_id, result: f.result, test_id: t.test.id },
          t.evidence,
          'verdict does not match sidecar',
        );
      }
    }
  }
}

/** Collector diagnostic reasons on the pinned assertion evidence (record.reason + signal reasons + gap). */
function collectReasons(analysis: AnalysisOutput): string[] {
  const out = new Set<string>();
  const add = (record: EvidenceRecord | undefined): void => {
    if (!record) return;
    if (record.reason) out.add(record.reason);
    for (const r of record.unestablished_assertions?.reasons ?? []) out.add(r);
    for (const r of record.unclassified_constructs?.reasons ?? []) out.add(r);
  };
  add(analysis.evidence['assertion_count']);
  for (const t of analysis.tests ?? []) {
    add(t.evidence['assertion_count']);
    if (t.declaration_gap) out.add(t.declaration_gap);
  }
  return [...out];
}

function compareReasons(ctx: Ctx, sidecar: Sidecar, analysis: AnalysisOutput): void {
  const expected = sidecar.expectedDiagnostics?.reasons;
  if (expected === undefined) return;
  const actual = collectReasons(analysis);
  for (const r of expected) {
    if (!actual.includes(r)) mismatch(ctx, r, undefined, actual, 'expected diagnostic reason absent from run');
  }
  if (expected.length === 0 && actual.length > 0) {
    mismatch(ctx, [], actual, actual, 'unexpected diagnostic reasons present');
  }
}

/* ------------------------------------------------------------------ *
 * Step 7 — result + actuals for the suites.
 * ------------------------------------------------------------------ */

function buildActual(
  analysis: AnalysisOutput | null,
  evaluations: Map<string, RuleEvaluation>,
): ConformanceResult['actual'] {
  if (!analysis) {
    return {
      envelope: { analysisStatus: null, evaluationStatus: null, completeness: null },
      evidenceKeys: { fileLevel: [], perTest: [] },
      findings: [],
    };
  }
  const findings: ActualFinding[] = [];
  for (const [id, ev] of evaluations) {
    if (ev.subject.finding) {
      findings.push({
        rule_id: id,
        test_id: null,
        test_id_present: false,
        result: ev.subject.finding.result,
        reason: ev.subject.finding.reason,
      });
    }
    for (const t of ev.tests) {
      if (t.finding) {
        findings.push({
          rule_id: id,
          test_id: t.test?.id ?? null,
          test_id_present: t.test !== null,
          result: t.finding.result,
          reason: t.finding.reason,
        });
      }
    }
  }
  return {
    envelope: {
      analysisStatus: analysis.analysis.status,
      evaluationStatus: deriveEvaluationStatus(evaluations),
      completeness: analysis.analysis.completeness,
    },
    evidenceKeys: {
      fileLevel: Object.keys(analysis.evidence),
      perTest: (analysis.tests ?? []).map((t) => Object.keys(t.evidence)),
    },
    findings,
  };
}

/**
 * Run one fixture in one language and compare against its sidecar.
 * `options` forwards to adapter.collectAnalysis; omitted means the adapter's
 * default (declaredType UNKNOWN — no sidecar pins a concrete type).
 */
export function runFixture(fixtureId: string, language: Language, options?: AdapterOptions): ConformanceResult {
  const fixture = loadFixture(fixtureId);
  const outcome = collectFixture(fixture, language, options);
  if (outcome.kind === 'not-applicable') {
    return {
      fixtureId,
      language,
      status: 'NOT_APPLICABLE',
      adapterId: null,
      decidedBy: null,
      reason: outcome.reason,
      mismatches: [],
      actual: buildActual(null, new Map()),
    };
  }
  if (outcome.kind === 'unsupported') {
    const diagnostic: Diagnostic = {
      adapter: null,
      fixture: fixtureId,
      expected: 'a registered adapter',
      actual: null,
      evidence: null,
      diagnostics: { reason: 'no adapter matched', completeness: 'NOT_APPLICABLE' },
    };
    return {
      fixtureId,
      language,
      status: 'UNSUPPORTED',
      adapterId: null,
      decidedBy: outcome.resolution.decidedBy,
      reason: outcome.resolution.reason,
      mismatches: [diagnostic],
      actual: buildActual(null, new Map()),
    };
  }
  const { adapter, analysis } = outcome.run;
  const evaluations = evaluateRules(sidecarRuleIds(fixture.sidecar), analysis);
  const ctx: Ctx = {
    fixtureId,
    adapterId: adapter.id,
    adapter,
    completeness: analysis.analysis.completeness,
    mismatches: [],
  };
  compareDiscovery(ctx, fixture.sidecar, language, analysis);
  compareEnvelope(ctx, fixture.sidecar, language, analysis, evaluations);
  compareEvidence(ctx, fixture.sidecar, language, analysis);
  compareFindings(ctx, fixture.sidecar, language, analysis, evaluations);
  compareReasons(ctx, fixture.sidecar, analysis);
  return {
    fixtureId,
    language,
    status: ctx.mismatches.length === 0 ? 'PASS' : 'FAIL',
    adapterId: adapter.id,
    decidedBy: outcome.run.resolution.decidedBy,
    reason: null,
    mismatches: ctx.mismatches,
    actual: buildActual(analysis, evaluations),
  };
}

/** Plan acceptance alias for runFixture. */
export const evaluateFixture = runFixture;

/** §D diagnostic-shape validation, extracted from selfCheck so it is unit-testable (tests-only export). */
export function assertDiagnosticShape(bad: Diagnostic): void {
  for (const key of ['adapter', 'fixture', 'expected', 'actual', 'evidence', 'diagnostics'] as const) {
    if (!(key in bad)) throw new Error(`self-check: diagnostic missing field ${key}`);
  }
  if (typeof bad.diagnostics.reason !== 'string' || bad.diagnostics.reason.length === 0) {
    throw new Error('self-check: diagnostic reason empty');
  }
}

/**
 * Unit-level self-check (plan task 1 acceptance): a deliberately wrong
 * expectation must fail with the full six-field §D diagnostic shape.
 * Throws on any self-check failure; returns nothing on success.
 */
export function selfCheck(): void {
  const fixture = loadFixture('CF-ASSERT-001');
  const outcome = collectFixture(fixture, 'ts');
  if (outcome.kind !== 'collected') throw new Error('self-check: CF-ASSERT-001 ts did not collect');
  const { adapter, analysis } = outcome.run;
  const perTest = (fixture.sidecar.expectedEvidence?.perTest ?? {}) as Record<string, unknown>;
  const ac = (perTest['assertion_count'] ?? {}) as Record<string, unknown>;
  const mutated: Sidecar = {
    ...fixture.sidecar,
    expectedEvidence: { perTest: { ...perTest, assertion_count: { ...ac, value: 999 } }, fileLevel: {} },
  };
  const ctx: Ctx = {
    fixtureId: fixture.fixtureId,
    adapterId: adapter.id,
    adapter,
    completeness: analysis.analysis.completeness,
    mismatches: [],
  };
  compareEvidence(ctx, mutated, 'ts', analysis);
  const bad = ctx.mismatches.find((m) => m.expected === 999);
  if (!bad) throw new Error('self-check: deliberately wrong expectation produced no mismatch');
  assertDiagnosticShape(bad);
}
