/**
 * WP6 task 3 — TypeScript conformance suite for the frozen WP5 fixture catalog.
 *
 * Amendment A-WP6-1 (plan .opencode/plans/2026-11-20-wp6-conformance-harness.md:113-115):
 * GROUP A asserts ONLY harness-independent §B/§D invariants (shape, identity,
 * dispatch, evidence field-shape, §D 6-field diagnostic shape, NOT_APPLICABLE
 * paths). Sidecar verdict/evidence comparisons run as GROUP B — an OBSERVATION
 * pass written to scratch, NOT jest verdict assertions. No sidecar amended,
 * no src change, no fixture edit.
 *
 * Ruling D-WP6-1 (plan :117-119): declaredType is passed explicitly as
 * TestType.UNIT — the frozen sidecars pin no declaredType and the UNKNOWN
 * default aborts every int-rule verdict as INDETERMINATE (src/core/evaluation.ts).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';

import { TestType } from '../../src/core/analysis';
import type { AnalysisOutput } from '../../src/core/analysis';
import { Availability, CollectionStatus, Provenance } from '../../src/core/evidence';
import type { EvidenceRecord } from '../../src/core/evidence';
import { defaultRegistry } from '../../src/adapters/registry';
import { loadFixture, runFixture, selfCheck } from './harness';
import type { ConformanceResult } from './harness';

jest.setTimeout(120_000);

const FIXTURE_IDS = [
  'CF-DISC-001',
  'CF-ASSERT-001',
  'CF-ASSERT-002',
  'CF-ASSERT-003',
  'CF-COND-001',
  'CF-HELPER-001',
  'CF-SETUP-001',
  'CF-NEST-001',
  'CF-PARAM-001',
  'CF-UNSUP-001',
  'CF-INCOMP-001',
  'CF-NORULE-001',
  'CF-COV-001',
  'CF-MUT-001',
] as const;

/** Ruling D-WP6-1: sidecar framework lines expect concrete-type verdicts → UNIT. */
const UNIT_OPTIONS = { declaredType: TestType.UNIT };
const TS_ADAPTER_ID = 'typescript-jest-adapter';
const INT_RULES = ['CT-INT-001', 'CT-INT-003', 'CT-INT-004'] as const;
/** §D step 4 / README: the five registered rules only. */
const ALLOWED_RULE_IDS = new Set(['CT-INT-001', 'CT-INT-003', 'CT-INT-004', 'CT-COV-001', 'CT-MUT-001']);
/** §B cat 6 (schemas/checktest-report.schema.json:290): required per-record fields. */
const REQUIRED_AC_FIELDS = [
  'value',
  'availability',
  'provenance',
  'source',
  'collector_version',
  'scope',
  'coverage',
] as const;
const TIME_KEY = /time|date|timestamp/i;

const OBS_DIR = join(__dirname, '..', '..', '.opencode', 'scratch', 'checktest-foundation-initiative');
const OBS_PATH = join(OBS_DIR, 'wp6-observation-ts.md');

/** Direct collectAnalysis through the registered TS adapter (harness-independent §B path). */
function collectDirect(fixtureId: string): AnalysisOutput {
  const source = loadFixture(fixtureId).sources.ts;
  if (source === undefined) throw new Error(`${fixtureId}: no ts source in catalog`);
  const adapter = defaultRegistry.get(TS_ADAPTER_ID);
  if (adapter === undefined) throw new Error(`adapter not registered: ${TS_ADAPTER_ID}`);
  return adapter.collectAnalysis(source, UNIT_OPTIONS);
}

/** Comparable shape of one collection: ids + evidence-key maps (no values). */
function collectionShape(a: AnalysisOutput): { ids: string[]; fileKeys: string[]; perTestKeys: string[][] } {
  const tests = a.tests ?? [];
  return {
    ids: tests.map((t) => t.test.id),
    fileKeys: Object.keys(a.evidence),
    perTestKeys: tests.map((t) => Object.keys(t.evidence)),
  };
}

/* ---- shared runs (top-level beforeAll: every test below reads these) ---- */

let unitResults: Map<string, ConformanceResult>;
let analyses: Map<string, AnalysisOutput>;

beforeAll(() => {
  unitResults = new Map(FIXTURE_IDS.map((id) => [id, runFixture(id, 'ts', UNIT_OPTIONS)]));
  analyses = new Map(FIXTURE_IDS.map((id) => [id, collectDirect(id)]));
});

/* ================= GROUP A — §B/§D invariants (must be GREEN) ================= */

describe('GROUP A: harness-independent conformance invariants (ts)', () => {
  describe('§B cat 1 / adapter dispatch — every fixture collects through the extension layer', () => {
    it.each(FIXTURE_IDS)('%s: status PASS|FAIL, adapter typescript-jest-adapter, decidedBy extension', (id) => {
      const r = unitResults.get(id)!;
      expect(['PASS', 'FAIL']).toContain(r.status);
      expect(r.adapterId).toBe(TS_ADAPTER_ID);
      expect(r.decidedBy).toBe('extension');
      // Harness scopes manifest state to the fixture directory (harness.ts:13-16;
      // collectFixture manifestExists at harness.ts:171-176): no package.json
      // inside a fixture dir, so resolveAdapter's manifest layer finds no
      // candidate (src/adapters/registry.ts:81) and the extension layer decides.
      // Recorded in the unit-1 checkpoint — decidedBy 'extension' is a
      // harness-scope property, not adapter drift.
    });
  });

  describe('§B cat 2 — identity shape, declaration order, repeat-call stability', () => {
    it.each(FIXTURE_IDS)('%s: ids match <file>#<declaration>@<line>:<index>, ascending by line, unique', (id) => {
      const source = loadFixture(id).sources.ts!;
      const ids = collectionShape(analyses.get(id)!).ids;
      const seen = new Set<string>();
      let prevLine = -1;
      for (const testId of ids) {
        const m = /^(.+)#([^#@]+)@(\d+):(\d+)$/.exec(testId);
        expect(m).not.toBeNull();
        if (m === null) continue;
        expect(m[1].endsWith(basename(source))).toBe(true); // <file> = the fixture source
        expect(m[2].length).toBeGreaterThan(0); // declaration token non-empty
        const line = Number(m[3]);
        expect(line).toBeGreaterThanOrEqual(prevLine); // declaration order preserved
        expect(Number(m[4])).toBeGreaterThanOrEqual(0); // same-line index
        prevLine = line;
        expect(seen.has(testId)).toBe(false); // deterministic, collision-free
        seen.add(testId);
      }
    });

    it.each(FIXTURE_IDS)('%s: two collects produce identical ids and evidence keys', (id) => {
      const a = collectDirect(id);
      const b = collectDirect(id);
      expect(collectionShape(b)).toEqual(collectionShape(a));
    });
  });

  describe('§B cat 6 — evidence field-shape, constants, enums', () => {
    it.each(FIXTURE_IDS)('%s: every per-test assertion_count record carries the required field set', (id) => {
      for (const t of analyses.get(id)!.tests ?? []) {
        const ac: EvidenceRecord | undefined = t.evidence['assertion_count'];
        expect(ac).toBeDefined();
        if (ac === undefined) continue;
        for (const field of REQUIRED_AC_FIELDS) expect(ac).toHaveProperty(field);
        expect(ac.source).toBe(TS_ADAPTER_ID);
        expect(ac.collector_version).toBe('0.1.0');
        expect(Object.values(Availability)).toContain(ac.availability);
        expect(Object.values(Provenance)).toContain(ac.provenance);
        expect(Object.values(CollectionStatus)).toContain(ac.coverage.status);
      }
    });

    it('evidence field-shape checks are non-vacuous (at least one assertion_count record seen)', () => {
      let records = 0;
      for (const a of analyses.values())
        for (const t of a.tests ?? []) if (t.evidence['assertion_count'] !== undefined) records++;
      expect(records).toBeGreaterThan(0);
    });
  });

  describe('§B cat 6 — no timestamps anywhere in envelope/evidence', () => {
    it('no key matching /time|date|timestamp/i in any analysis output or runFixture actual', () => {
      const offending: string[] = [];
      const walk = (value: unknown, path: string): void => {
        if (Array.isArray(value)) {
          value.forEach((v, i) => walk(v, `${path}[${i}]`));
          return;
        }
        if (value !== null && typeof value === 'object') {
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const here = `${path}.${k}`;
            if (TIME_KEY.test(k)) offending.push(here);
            walk(v, here);
          }
        }
      };
      // Scope: the evidence maps (file-level + per-declaration, nested fields
      // included) and the runFixture `actual` envelope — the §B cat 6 /
      // schema:305-308 timestamp ban targets evidence records and the report
      // envelope. AnalysisOutput.capabilities is deliberately NOT walked: its
      // keys are named collector capabilities (`runtime_execution`,
      // src/adapters/typescript/collector.ts:220; SPEC:395-399 via
      // src/core/analysis.ts:66) whose names coincidentally match /time/i.
      for (const [id, a] of analyses) {
        walk(a.evidence, `${id}.evidence`);
        for (const [i, t] of (a.tests ?? []).entries()) walk(t.evidence, `${id}.tests[${i}].evidence`);
      }
      for (const [id, r] of unitResults) walk(r.actual, `${id}.actual`);
      expect(offending).toEqual([]);
    });
  });

  describe('§D step 7 / §B cat 2+7 — test_id placement', () => {
    it('harness selfCheck passes (deliberately wrong expectation yields the six-field diagnostic)', () => {
      expect(() => selfCheck()).not.toThrow();
    });

    it('CF-ASSERT-001: per-test findings of the three int rules carry test_id; subject-scope omit it', () => {
      const findings = unitResults.get('CF-ASSERT-001')!.actual.findings;
      for (const rule of INT_RULES) {
        const perTest = findings.filter((f) => f.rule_id === rule && f.test_id_present);
        expect(perTest.length).toBeGreaterThanOrEqual(1);
        for (const f of perTest) expect(f.test_id).not.toBeNull();
      }
      // Non-attribution marker consistency (schemas/checktest-report.schema.json:414-417):
      // test_id present ⇔ test_id_present true. Subject-scope findings (the
      // file-level int-rule results, docs/reporting-contract.md:168) omit
      // test_id BY DESIGN — the dispatch's "(per-test scope)" qualifier targets
      // the per-test findings, which is what the loop above pins.
      for (const f of findings) expect(f.test_id_present).toBe(f.test_id !== null);
    });
  });

  describe('§D NOT_APPLICABLE paths', () => {
    it.each(['CF-COV-001', 'CF-MUT-001'])('%s: python is NOT_APPLICABLE with zero mismatches', (id) => {
      const r = runFixture(id, 'python');
      expect(r.status).toBe('NOT_APPLICABLE');
      expect(r.mismatches).toEqual([]);
      expect(r.adapterId).toBeNull();
    });
  });

  describe('§D step 7 — six-field failure diagnostic shape', () => {
    it('CF-ASSERT-001 with default options (declaredType absent) fails; every mismatch has exactly the six fields', () => {
      const r = runFixture('CF-ASSERT-001', 'ts');
      expect(r.mismatches.length).toBeGreaterThan(0);
      for (const m of r.mismatches) {
        expect(Object.keys(m).sort()).toEqual(['actual', 'adapter', 'diagnostics', 'evidence', 'expected', 'fixture']);
        expect(typeof m.diagnostics.reason).toBe('string');
        expect(m.diagnostics.reason.length).toBeGreaterThan(0);
      }
    });
  });

  describe('§B cat 12 — no new rules', () => {
    it('rule ids in actual findings are a subset of the five registered rules', () => {
      const seen = new Set<string>();
      for (const r of unitResults.values()) for (const f of r.actual.findings) seen.add(f.rule_id);
      expect(seen.size).toBeGreaterThan(0); // non-vacuous: findings were produced
      expect([...seen].filter((id) => !ALLOWED_RULE_IDS.has(id))).toEqual([]);
    });
  });
});

/* ================= GROUP B — observation pass (scratch table) ================= */

describe('GROUP B: observation pass — sidecar comparisons recorded, not asserted', () => {
  beforeAll(() => {
    mkdirSync(OBS_DIR, { recursive: true });
    const cell = (v: unknown): string => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const compact = (v: unknown, max = 180): string => {
      if (v === undefined) return cell('undefined');
      const s = JSON.stringify(v) ?? String(v);
      return cell(s.length > max ? `${s.slice(0, max)}…` : s);
    };
    /** evidence cell: keys + status only (Amendment A-WP6-1 keeps the table compact). */
    const evidenceSummary = (ev: unknown): string => {
      if (ev === null) return 'null';
      if (Array.isArray(ev)) return `array(${ev.length})`;
      if (typeof ev === 'object') {
        const rec = ev as Record<string, unknown>;
        const bits = [`keys=[${Object.keys(rec).join(',')}]`];
        if (typeof rec['availability'] === 'string') bits.push(`availability=${rec['availability']}`);
        if (typeof rec['status'] === 'string') bits.push(`status=${rec['status']}`);
        const ac = rec['assertion_count'] as Record<string, unknown> | undefined;
        if (ac !== null && typeof ac === 'object' && typeof ac['availability'] === 'string') {
          bits.push(`AC.availability=${ac['availability']}`);
        }
        return cell(bits.join(' '));
      }
      return compact(ev, 80);
    };

    const md: string[] = [
      '# WP6 TypeScript conformance — observation pass (ts, declaredType=UNIT)',
      '',
      'Generated by tests/conformance/typescript.conformance.test.ts (GROUP B).',
      'Observation only per Amendment A-WP6-1 — NOT jest verdict assertions; classification',
      'of expectation-vs-adapter-gap vs spec-vs-fixture gap is the owner §6.5 gate decision.',
      '',
      '## Summary (one row per fixture)',
      '',
      '| Fixture | Adapter | decidedBy | Status | Mismatches | Envelope (analysis/evaluation/completeness) |',
      '|---|---|---|---|---|---|',
    ];
    for (const id of FIXTURE_IDS) {
      const r = unitResults.get(id)!;
      const e = r.actual.envelope;
      md.push(
        `| ${id} | ${r.adapterId ?? '—'} | ${r.decidedBy ?? '—'} | ${r.status} | ${r.mismatches.length} | ${e.analysisStatus}/${e.evaluationStatus}/${e.completeness} |`,
      );
    }
    md.push('', '## Mismatch detail (one row per mismatch; evidence = keys + status only)', '');
    md.push('| Fixture | Adapter | Expected | Actual | Evidence | diagnostics.reason |');
    md.push('|---|---|---|---|---|---|');
    for (const id of FIXTURE_IDS) {
      for (const m of unitResults.get(id)!.mismatches) {
        md.push(
          `| ${id} | ${m.adapter ?? '—'} | ${compact(m.expected)} | ${compact(m.actual)} | ${evidenceSummary(m.evidence)} | ${cell(m.diagnostics.reason)} |`,
        );
      }
    }
    writeFileSync(OBS_PATH, `${md.join('\n')}\n`, 'utf8');
  });

  it('observation table has exactly 14 fixture rows (one per fixture, summary section)', () => {
    const md = readFileSync(OBS_PATH, 'utf8');
    const summary = md.split('## Mismatch detail')[0];
    const rows = summary.split('\n').filter((l) => l.startsWith('| CF-'));
    expect(rows.length).toBe(14);
    const rowIds = rows.map((l) => l.split('|')[1].trim());
    expect(new Set(rowIds)).toEqual(new Set<string>(FIXTURE_IDS));
  });

  it('mismatch detail section holds one row per live mismatch', () => {
    const md = readFileSync(OBS_PATH, 'utf8');
    const detail = md.split('## Mismatch detail')[1];
    const rows = detail.split('\n').filter((l) => l.startsWith('| CF-'));
    let live = 0;
    for (const r of unitResults.values()) live += r.mismatches.length;
    expect(rows.length).toBe(live);
  });
});
