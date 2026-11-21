/**
 * WP6 task 5 — external-evidence conformance suite (CF-COV-001 / CF-MUT-001).
 *
 * Covers the external-evidence conformance cells (§B evidence-attribution cat 7 +
 * §C gap-6 guardrails; the initiative brief's "cat 9-10" external-evidence
 * items): coverage/mutation reports attached through provider wiring that
 * mirrors src/cli.ts:752-810 (collectAnalysis → analyzedRevision = git HEAD →
 * applyCoverageReport / applyMutationReport → evaluateRule/evaluateTests).
 *
 * Amendment A-WP6-1 (plan .opencode/plans/2026-11-20-wp6-conformance-harness.md:113-115):
 * GROUP A asserts ONLY harness-independent §B/§D invariants (collect, evidence
 * field-shape, provider freshness recording, gap-6 non-attribution, rule-id
 * subset). Sidecar verdict/value comparisons run as GROUP B — an OBSERVATION
 * pass written to scratch, NOT jest verdict assertions. No sidecar amended,
 * no src change, no fixture edit.
 *
 * Ruling D-WP6-1 (plan :117-119): declaredType is passed explicitly as
 * TestType.UNIT — the frozen sidecars pin no declaredType and the UNKNOWN
 * default aborts every int-rule verdict as INDETERMINATE.
 *
 * Harness API note (task-5 friction, recorded in the checkpoint): harness
 * runFixture has NO provider-attach path — AdapterOptions (adapter.ts:90-117)
 * carries coverageReport but the TS adapter maps only declaredType
 * (typescript/adapter.ts:69-70), and no mutationReport option exists at all.
 * Provider wiring therefore lives suite-side, mirroring cli.ts; the fixture's
 * own external-report.json files are illustrative placeholders (README
 * "Sidecar placeholder convention"), so provider-parseable inputs are
 * synthesized into a runtime tmpdir (plan guardrail: NEVER *.json under
 * tests/conformance/).
 */

import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { defaultRegistry, resolveAdapter } from '../../src/adapters/registry';
import { TestType } from '../../src/core/analysis';
import type { AnalysisOutput } from '../../src/core/analysis';
import { Availability, CollectionStatus, Provenance } from '../../src/core/evidence';
import type { EvidenceRecord } from '../../src/core/evidence';
import { evaluateRule, evaluateTests } from '../../src/core/evaluation';
import { RuleResult } from '../../src/core/result';
import type { EvaluationResult, TestEvaluation } from '../../src/core/result';
import type { RuleMetadata } from '../../src/core/rule';
import { applyCoverageReport } from '../../src/providers/coverage';
import { applyMutationReport } from '../../src/providers/mutation';
import { CT_INT_001 } from '../../src/rules/ct-int-001';
import { CT_INT_003 } from '../../src/rules/ct-int-003';
import { CT_INT_004 } from '../../src/rules/ct-int-004';
import { CT_COV_001 } from '../../src/rules/ct-cov-001';
import { CT_MUT_001 } from '../../src/rules/ct-mut-001';
import { loadFixture, runFixture } from './harness';

jest.setTimeout(120_000);

const COV = 'CF-COV-001';
const MUT = 'CF-MUT-001';
const FIXTURE_IDS = [COV, MUT] as const;

/** Ruling D-WP6-1: sidecar framework lines expect concrete-type verdicts → UNIT. */
const UNIT_OPTIONS = { declaredType: TestType.UNIT };
const TS_ADAPTER_ID = 'typescript-jest-adapter';
/** The five registered rules (cli.ts:589-593 / harness.ts:126-132). */
const REGISTERED_RULES: Record<string, RuleMetadata> = {
  'CT-INT-001': CT_INT_001,
  'CT-INT-003': CT_INT_003,
  'CT-INT-004': CT_INT_004,
  'CT-COV-001': CT_COV_001,
  'CT-MUT-001': CT_MUT_001,
};
const ALLOWED_RULE_IDS = new Set(Object.keys(REGISTERED_RULES));
/** §B cat 6 (schemas/checktest-report.schema.json:290): required per-record fields. */
const REQUIRED_FIELDS = [
  'value',
  'availability',
  'provenance',
  'source',
  'collector_version',
  'scope',
  'coverage',
] as const;
/** A declared revision that cannot equal git HEAD — freshness-mismatch probe. */
const BOGUS_REVISION = '0000000-deadbeef-bogus-revision';

const OBS_DIR = join(__dirname, '..', '..', '.opencode', 'scratch', 'checktest-foundation-initiative');
const OBS_PATH = join(OBS_DIR, 'wp6-observation-external.md');

/** Field probe that does not fight the EvidenceRecord union over optional provider fields. */
function field(record: EvidenceRecord, key: string): unknown {
  return (record as unknown as Record<string, unknown>)[key];
}

/** git HEAD auto-detect, exactly as cli.ts:766-773 (fallback 'unknown' outside a repo). */
function gitHead(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

interface RuleEval {
  subject: EvaluationResult;
  tests: TestEvaluation[];
}

/** Collect one fixture's ts source through the registered adapter (§D steps 2-3). */
function collectBare(fixtureId: string): AnalysisOutput {
  const source = loadFixture(fixtureId).sources.ts;
  if (source === undefined) throw new Error(`${fixtureId}: no ts source in catalog`);
  const adapter = defaultRegistry.get(TS_ADAPTER_ID);
  if (adapter === undefined) throw new Error(`adapter not registered: ${TS_ADAPTER_ID}`);
  const analysis = adapter.collectAnalysis(source, UNIT_OPTIONS);
  // Mirror cli.ts / harness: the dispatch decision rides on the envelope (ADR-035).
  // The null-adapterId/'unsupported' pair is the unsupported outcome (harness.ts:177-181);
  // a catalog fixture always resolves through the extension layer, so reaching it is an error.
  const resolution = resolveAdapter(source, {}, { manifestExists: () => false }, defaultRegistry);
  if (resolution.adapterId === null || resolution.decidedBy === 'unsupported') {
    throw new Error(`${fixtureId}: unexpected unsupported dispatch for a catalog fixture`);
  }
  analysis.adapter = resolution.adapterId;
  analysis.decidedBy = resolution.decidedBy;
  return analysis;
}

function evaluateAll(analysis: AnalysisOutput): Map<string, RuleEval> {
  const map = new Map<string, RuleEval>();
  for (const rule of Object.values(REGISTERED_RULES)) {
    map.set(rule.id, { subject: evaluateRule(rule, analysis), tests: evaluateTests(rule, analysis) });
  }
  return map;
}

interface WiredRun {
  analysis: AnalysisOutput;
  head: string;
  declared: string;
  evals: Map<string, RuleEval>;
}

/* ---- synthesized provider-parseable reports (runtime tmpdir; plan guardrail: no *.json under tests/conformance/) ---- */

let tmpDir: string;
let covReportPath: string;
let mutReportPath: string;

/** Attach one external report exactly as cli.ts:776-810 does (analyzedRevision = git HEAD). */
function wireFixture(fixtureId: string, kind: 'coverage' | 'mutation', declaredRevision?: string): WiredRun {
  const analysis = collectBare(fixtureId);
  const head = gitHead();
  const declared = declaredRevision ?? head;
  if (kind === 'coverage') {
    const wired = applyCoverageReport(analysis, covReportPath, { analyzedRevision: head, source_revision: declared });
    return { analysis: wired, head, declared, evals: evaluateAll(wired) };
  }
  const wired = applyMutationReport(analysis, mutReportPath, {
    analyzedRevision: head,
    mutationSourceRevision: declared,
  });
  return { analysis: wired, head, declared, evals: evaluateAll(wired) };
}

/* ---- shared runs (top-level beforeAll: every test below reads these) ---- */

let covHarness: ReturnType<typeof runFixture>;
let mutHarness: ReturnType<typeof runFixture>;
let covWired: WiredRun;
let mutWired: WiredRun;
let covMismatch: WiredRun;
let mutMismatch: WiredRun;
let mutBare: AnalysisOutput;
let covIllustrativeReason: string | undefined;
let mutIllustrativeReason: string | undefined;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'checktest-ext-evidence-'));
  const covSource = loadFixture(COV).sources.ts!;
  const mutSource = loadFixture(MUT).sources.ts!;
  // Istanbul-format coverage (coverage.ts:294-317): one covered line → coveredLines count 1.
  covReportPath = join(tmpDir, 'coverage-istanbul.json');
  writeFileSync(covReportPath, `${JSON.stringify({ covered: { [covSource]: [null, 1] } })}\n`, 'utf8');
  // Stryker-format mutation (mutation.ts:317-360): 3 Killed + 1 Survived → detected 3 / valid 4 = 0.75.
  mutReportPath = join(tmpDir, 'mutation-stryker.json');
  writeFileSync(
    mutReportPath,
    `${JSON.stringify({
      schemaVersion: '2.0',
      files: {
        [mutSource]: {
          mutants: [{ status: 'Killed' }, { status: 'Killed' }, { status: 'Killed' }, { status: 'Survived' }],
        },
      },
    })}\n`,
    'utf8',
  );
  covHarness = runFixture(COV, 'ts', UNIT_OPTIONS);
  mutHarness = runFixture(MUT, 'ts', UNIT_OPTIONS);
  covWired = wireFixture(COV, 'coverage');
  mutWired = wireFixture(MUT, 'mutation');
  covMismatch = wireFixture(COV, 'coverage', BOGUS_REVISION);
  mutMismatch = wireFixture(MUT, 'mutation', BOGUS_REVISION);
  const bare = collectBare(MUT);
  mutBare = bare;
  // The sidecars' own external-report.json files attached literally (illustrative placeholders).
  const head = gitHead();
  covIllustrativeReason = (
    applyCoverageReport(collectBare(COV), loadFixture(COV).sources.externalReport!, { analyzedRevision: head })
      .evidence['line_coverage'] as EvidenceRecord | undefined
  )?.reason;
  mutIllustrativeReason = (
    applyMutationReport(collectBare(MUT), loadFixture(MUT).sources.externalReport!, { analyzedRevision: head })
      .evidence['mutation_score'] as EvidenceRecord | undefined
  )?.reason;
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/* ================= GROUP A — §B/§D invariants (must be GREEN) ================= */

describe('GROUP A: harness-independent invariants (external evidence)', () => {
  describe('§B cat 1 / §D steps 2-3 — collect through the registry dispatch', () => {
    it.each(FIXTURE_IDS)(
      '%s: collectAnalysis succeeds (ts adapter, extension dispatch, 1 declaration, assertion_count shape)',
      (id) => {
        const analysis = collectBare(id);
        expect(analysis.adapter).toBe(TS_ADAPTER_ID);
        expect(analysis.decidedBy).toBe('extension');
        expect(analysis.tests?.length).toBe(1);
        const ac = analysis.tests?.[0]?.evidence['assertion_count'];
        expect(ac).toBeDefined();
        if (ac === undefined) return;
        for (const f of REQUIRED_FIELDS) expect(ac).toHaveProperty(f);
      },
    );
  });

  describe('§B cat 5-7 / §C gap-6 — CF-COV-001 with coverage report attached (declared revision = git HEAD)', () => {
    it('line_coverage fileLevel record carries the 7-field shape and EXTERNAL enums', () => {
      const lc = covWired.analysis.evidence['line_coverage'];
      expect(lc).toBeDefined();
      if (lc === undefined) return;
      for (const f of REQUIRED_FIELDS) expect(lc).toHaveProperty(f);
      expect(lc.provenance).toBe(Provenance.EXTERNAL);
      expect(lc.scope).toBe('test-body');
      expect(Object.values(Availability)).toContain(lc.availability);
      expect(Object.values(CollectionStatus)).toContain(lc.coverage.status);
      expect(typeof field(lc, 'source')).toBe('string');
      expect((field(lc, 'source') as string).length).toBeGreaterThan(0);
      expect(typeof field(lc, 'collector_version')).toBe('string');
      expect(field(lc, 'provider')).toBe('istanbul'); // documented default (providers/coverage.ts:243,295)
    });

    it('freshness fields recorded: source_revision = declared (=HEAD), no mismatch reason', () => {
      const lc = covWired.analysis.evidence['line_coverage']!;
      expect(covWired.declared).toBe(covWired.head);
      expect(field(lc, 'source_revision')).toBe(covWired.head);
      expect(typeof field(lc, 'provider_version')).toBe('string');
      expect(lc.reason).toBeUndefined(); // freshness established — nothing to record
    });

    it('subject-scope CT-COV-001 finding exists and carries NO test_id (gap-6 non-attribution)', () => {
      const finding = covWired.evals.get('CT-COV-001')!.subject.finding;
      expect(finding).not.toBeNull();
      expect(finding!.rule_id).toBe('CT-COV-001');
      // RuleFinding (core/result.ts:78-90) has no test_id field at all; absence on
      // the subject scope is the non-attribution marker (schema:414-417, §C gap-6.1).
      expect('test_id' in finding!).toBe(false);
      // Harness-run subject findings for this rule agree (test_id_present false ⇔ test_id null).
      for (const f of covHarness.actual.findings.filter((x) => x.rule_id === 'CT-COV-001' && !x.test_id_present)) {
        expect(f.test_id).toBeNull();
      }
    });

    it('CT-COV-001 rationale states no per-declaration attribution for ordinary mapped coverage', () => {
      expect(CT_COV_001.rationale).toMatch(/per-declaration attribution is not supported/i);
    });
  });

  describe('freshness mismatch path — bogus declared revision is RECORDED, never silently ignored', () => {
    it('CF-COV-001: availability UNKNOWN, source_revision = declared bogus value, reason names the mismatch', () => {
      const lc = covMismatch.analysis.evidence['line_coverage']!;
      expect(lc).toBeDefined();
      expect(lc.availability).toBe(Availability.UNKNOWN);
      expect(field(lc, 'source_revision')).toBe(BOGUS_REVISION);
      expect(typeof lc.reason).toBe('string');
      expect(lc.reason).toMatch(/source revision mismatch/i);
    });

    it('CF-MUT-001: availability UNKNOWN, source_revision = declared bogus value, reason names the mismatch', () => {
      const ms = mutMismatch.analysis.evidence['mutation_score']!;
      expect(ms).toBeDefined();
      expect(ms.availability).toBe(Availability.UNKNOWN);
      expect(field(ms, 'source_revision')).toBe(BOGUS_REVISION);
      expect(typeof ms.reason).toBe('string');
      expect(ms.reason).toMatch(/does not match analyzed revision/i);
    });
  });

  describe('CF-MUT-001 with mutation report attached + report-missing path', () => {
    it('mutation_score fileLevel record carries the 7-field shape, EXTERNAL provenance, freshness fields', () => {
      const ms = mutWired.analysis.evidence['mutation_score'];
      expect(ms).toBeDefined();
      if (ms === undefined) return;
      for (const f of REQUIRED_FIELDS) expect(ms).toHaveProperty(f);
      expect(ms.provenance).toBe(Provenance.EXTERNAL);
      expect(ms.scope).toBe('test-body');
      expect(Object.values(Availability)).toContain(ms.availability);
      expect(Object.values(CollectionStatus)).toContain(ms.coverage.status);
      expect(field(ms, 'provider')).toBe('stryker'); // documented default (providers/mutation.ts:275)
      expect(field(ms, 'source_revision')).toBe(mutWired.head);
      expect(ms.reason).toBeUndefined();
    });

    it('report-missing path: mutation_score key absent from the envelope; CT-MUT-001 INDETERMINATE with the canonical absent-evidence reason', () => {
      // No --mutation-report attached → no provider runs → no key is invented.
      expect('mutation_score' in mutBare.evidence).toBe(false);
      const finding = evaluateRule(CT_MUT_001, mutBare).finding;
      expect(finding).not.toBeNull();
      expect(finding!.result).toBe(RuleResult.INDETERMINATE); // never FAIL (evaluation.ts:371-378)
      expect(finding!.reason).toContain("required evidence 'mutation_score' is absent from the analysis envelope");
      // The python gap-reason constant 'no mutation report supplied' (python/support.ts:56,
      // gapReason 'no-mutation-report') has NO TypeScript equivalent (repo-wide grep:
      // only python/support.ts + python/collector.ts) — the TS no-report gap reason is the
      // engine's absent-evidence string above. Exact wording → GROUP B row + adapter-gap candidate.
      expect(finding!.reason).not.toContain('no mutation report supplied');
    });

    it('subject-scope CT-MUT-001 finding (report attached) carries NO test_id (gap-6 non-attribution)', () => {
      const finding = mutWired.evals.get('CT-MUT-001')!.subject.finding;
      expect(finding).not.toBeNull();
      expect(finding!.rule_id).toBe('CT-MUT-001');
      expect('test_id' in finding!).toBe(false);
    });

    it('CT-MUT-001 rationale states no per-declaration attribution', () => {
      expect(CT_MUT_001.rationale).toMatch(/no per-declaration attribution/i);
    });
  });

  describe('§B cat 12 / §D step 4 — rule-id subset', () => {
    it('rule ids in these cells are a subset of the five registered rules (non-vacuous)', () => {
      const seen = new Set<string>();
      for (const run of [covWired, mutWired]) {
        for (const ev of run.evals.values()) {
          if (ev.subject.finding) seen.add(ev.subject.finding.rule_id);
          for (const t of ev.tests) if (t.finding) seen.add(t.finding.rule_id);
        }
      }
      for (const r of [covHarness, mutHarness]) for (const f of r.actual.findings) seen.add(f.rule_id);
      expect(seen.size).toBeGreaterThan(0);
      expect([...seen].filter((id) => !ALLOWED_RULE_IDS.has(id))).toEqual([]);
      expect(seen.has('CT-COV-001')).toBe(true);
      expect(seen.has('CT-MUT-001')).toBe(true);
    });
  });
});

/* ================= GROUP B — observation pass (scratch table) ================= */

describe('GROUP B: observation pass — sidecar comparisons recorded, not asserted', () => {
  beforeAll(() => {
    mkdirSync(OBS_DIR, { recursive: true });
    const cell = (v: unknown): string => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const compact = (v: unknown, max = 220): string => {
      if (v === undefined) return cell('undefined');
      const s = JSON.stringify(v) ?? String(v);
      return cell(s.length > max ? `${s.slice(0, max)}…` : s);
    };
    const recordSummary = (rec: EvidenceRecord | undefined): string => {
      if (rec === undefined) return 'absent';
      const bits = {
        value: rec.value,
        availability: rec.availability,
        provenance: rec.provenance,
        source: field(rec, 'source'),
        collector_version: field(rec, 'collector_version'),
        scope: rec.scope,
        'coverage.status': rec.coverage.status,
        source_revision: field(rec, 'source_revision'),
        ...(rec.reason !== undefined ? { reason: rec.reason } : {}),
      };
      return compact(bits);
    };
    const envelopeTriple = (run: WiredRun): string => {
      let evaluated = false;
      for (const ev of run.evals.values()) {
        if (ev.subject.finding !== null || ev.tests.some((t) => t.finding !== null)) evaluated = true;
      }
      return `${run.analysis.analysis.status}/${evaluated ? 'EVALUATED' : 'FAILED'}/${run.analysis.analysis.completeness}`;
    };

    const md: string[] = [
      '# WP6 external-evidence conformance — observation pass (CF-COV-001 / CF-MUT-001, ts)',
      '',
      'Generated by tests/conformance/external-evidence.conformance.test.ts (GROUP B).',
      'Observation only per Amendment A-WP6-1 — NOT jest verdict assertions; classification',
      'of expectation-vs-adapter-gap vs spec-vs-fixture gap is the owner §6.5 gate decision.',
      'Wired runs attach provider-parseable reports synthesized at runtime (istanbul covered /',
      'Stryker mutants) with analyzedRevision = git HEAD, mirroring cli.ts:752-810.',
      '',
      '## Summary (one row per fixture; Status/Mismatches = harness run WITHOUT a report;',
      'Envelope = provider-wired run)',
      '',
      '| Fixture | Adapter | decidedBy | Status | Mismatches | Envelope (analysis/evaluation/completeness) |',
      '|---|---|---|---|---|---|',
    ];
    for (const id of FIXTURE_IDS) {
      const r = id === COV ? covHarness : mutHarness;
      const wired = id === COV ? covWired : mutWired;
      md.push(
        `| ${id} | ${r.adapterId ?? '—'} | ${r.decidedBy ?? '—'} | ${r.status} | ${r.mismatches.length} | ${envelopeTriple(wired)} |`,
      );
    }

    md.push('', '## Harness mismatch detail — no report attached (one row per mismatch)', '');
    md.push('| Fixture | Adapter | Expected | Actual | Evidence | diagnostics.reason |');
    md.push('|---|---|---|---|---|---|');
    for (const r of [covHarness, mutHarness]) {
      for (const m of r.mismatches) {
        md.push(
          `| ${r.fixtureId} | ${m.adapter ?? '—'} | ${compact(m.expected, 180)} | ${compact(m.actual, 180)} | ${compact(m.evidence, 120)} | ${cell(m.diagnostics.reason)} |`,
        );
      }
    }

    md.push('', '## Sidecar vs provider-wired actual (expected fileLevel/verdict vs actual)', '');
    md.push('| Fixture | Field | Expected (sidecar) | Actual (provider-wired) |');
    md.push('|---|---|---|---|');
    for (const id of FIXTURE_IDS) {
      const wired = id === COV ? covWired : mutWired;
      const sidecar = loadFixture(id).sidecar;
      const metric = id === COV ? 'line_coverage' : 'mutation_score';
      const ruleId = id === COV ? 'CT-COV-001' : 'CT-MUT-001';
      const expFileLevel = (sidecar.expectedEvidence?.fileLevel ?? {}) as Record<string, unknown>;
      const expPerTest = (sidecar.expectedEvidence?.perTest ?? {}) as Record<string, unknown>;
      md.push(`| ${id} | envelope | ${compact(sidecar.expectedEnvelope)} | ${envelopeTriple(wired)} |`);
      md.push(
        `| ${id} | fileLevel.${metric} | ${compact(expFileLevel[metric])} | ${recordSummary(wired.analysis.evidence[metric])} |`,
      );
      const expFinding = JSON.stringify(sidecar.expectedFindings);
      const subjectFinding = wired.evals.get(ruleId)!.subject.finding;
      md.push(
        `| ${id} | verdict ${ruleId} | ${compact(expFinding)} | ${compact(subjectFinding === null ? null : { rule_id: subjectFinding.rule_id, result: subjectFinding.result, reason: subjectFinding.reason })} |`,
      );
      const perTestActual = (wired.analysis.tests ?? []).map((t) =>
        metric in t.evidence ? `${t.test.id} keys=[${Object.keys(t.evidence).join(',')}]` : `${t.test.id} absent`,
      );
      md.push(`| ${id} | perTest.${metric} | ${compact(expPerTest[metric])} | ${compact(perTestActual)} |`);
    }

    md.push('', '## Freshness mismatch path (bogus declared revision; mismatch RECORDED)', '');
    md.push(
      '| Fixture | Declared revision | Analyzed revision (git HEAD) | availability | source_revision recorded | reason |',
    );
    md.push('|---|---|---|---|---|---|');
    for (const [id, run] of [
      [COV, covMismatch],
      [MUT, mutMismatch],
    ] as const) {
      const rec = run.analysis.evidence[id === COV ? 'line_coverage' : 'mutation_score']!;
      md.push(
        `| ${id} | ${run.declared} | ${run.head} | ${rec.availability} | ${cell(field(rec, 'source_revision'))} | ${cell(rec.reason)} |`,
      );
    }

    md.push('', '## Per-test scope for COV/MUT rules (task-3 cluster-10: harness surfaces per-test findings)', '');
    md.push('| Fixture | Rule | Per-test findings | test_id_present | Results | Sample reason |');
    md.push('|---|---|---|---|---|---|');
    for (const [id, run] of [
      [COV, covWired],
      [MUT, mutWired],
    ] as const) {
      for (const ruleId of [id === COV ? 'CT-COV-001' : 'CT-MUT-001']) {
        const tests = run.evals.get(ruleId)!.tests;
        const withFinding = tests.filter((t) => t.finding !== null);
        const results = [...new Set(withFinding.map((t) => t.finding!.result))].join(',');
        md.push(
          `| ${id} | ${ruleId} | ${withFinding.length}/${tests.length} | ${withFinding.some((t) => t.test !== null)} | ${results} | ${cell(withFinding[0]?.finding?.reason ?? '—')} |`,
        );
      }
    }

    md.push('', '## Report-missing path (no --mutation-report; TS gap-reason wording)', '');
    md.push("| Fixture | Subject result | Reason (verbatim) | 'no mutation report supplied' present? |");
    md.push('|---|---|---|---|');
    const bareFinding = evaluateRule(CT_MUT_001, mutBare).finding;
    md.push(
      `| ${MUT} | ${bareFinding?.result ?? 'null'} | ${cell(bareFinding?.reason)} | ${bareFinding?.reason?.includes('no mutation report supplied') ?? false} |`,
    );

    md.push('', '## Fixture external-report.json attached literally (illustrative placeholder → provider parse)', '');
    md.push('| Fixture | Record reason (verbatim) |');
    md.push('|---|---|');
    md.push(`| ${COV} | ${cell(covIllustrativeReason)} |`);
    md.push(`| ${MUT} | ${cell(mutIllustrativeReason)} |`);

    writeFileSync(OBS_PATH, `${md.join('\n')}\n`, 'utf8');
  });

  it('observation table has exactly 2 summary rows (CF-COV-001, CF-MUT-001)', () => {
    const md = readFileSync(OBS_PATH, 'utf8');
    const summary = md.split('## Harness mismatch detail')[0];
    const rows = summary.split('\n').filter((l) => l.startsWith('| CF-'));
    expect(rows.length).toBe(2);
    const rowIds = rows.map((l) => l.split('|')[1].trim());
    expect(new Set(rowIds)).toEqual(new Set<string>([COV, MUT]));
  });

  it('harness mismatch detail holds one row per live harness mismatch', () => {
    const md = readFileSync(OBS_PATH, 'utf8');
    const detail = md.split('## Harness mismatch detail')[1].split('## Sidecar vs provider-wired')[0];
    const rows = detail.split('\n').filter((l) => l.startsWith('| CF-'));
    expect(rows.length).toBe(covHarness.mismatches.length + mutHarness.mismatches.length);
  });
});
