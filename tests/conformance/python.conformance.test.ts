/**
 * WP6 task 4 — Python conformance suite for the frozen WP5 fixture catalog.
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
 *
 * Closure-evidence tests pin the OBSERVED python behavior behind the capability
 * matrix NOT_VERIFIED items (docs/adapter-capability-matrix.md:41-50): the
 * `def` declaration token, helper-name absence (CF-HELPER-001), parametrize
 * non-expansion (CF-PARAM-001), class-based unittest attribution (CF-NEST-001),
 * and the @given reason strings (CF-UNSUP-001). They assert adapter behavior,
 * never sidecar verdicts.
 */

import { createRequire } from 'module';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';

import { TestType } from '../../src/core/analysis';
import type { AnalysisOutput } from '../../src/core/analysis';
import { Availability, CollectionStatus, Provenance } from '../../src/core/evidence';
import type { EvidenceRecord } from '../../src/core/evidence';
import { defaultRegistry } from '../../src/adapters/registry';
import { collectAnalysis } from '../../src/adapters/python/collector';
import { loadFixture, runFixture } from './harness';
import type { ConformanceResult } from './harness';

jest.setTimeout(120_000);

/** The 12 python-capable fixtures: all except CF-COV-001/CF-MUT-001 (TS-only by twin policy). */
const PY_FIXTURE_IDS = [
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
] as const;

const NOT_APPLICABLE_IDS = ['CF-COV-001', 'CF-MUT-001'] as const;

/** Ruling D-WP6-1: sidecar framework lines expect concrete-type verdicts → UNIT. */
const UNIT_OPTIONS = { declaredType: TestType.UNIT };
const PY_ADAPTER_ID = 'python-pytest-adapter'; // src/adapters/python/support.ts:24
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
const OBS_PATH = join(OBS_DIR, 'wp6-observation-python.md');

/** Direct collectAnalysis through the registered python adapter (harness-independent §B path). */
function collectDirect(fixtureId: string): AnalysisOutput {
  const source = loadFixture(fixtureId).sources.python;
  if (source === undefined) throw new Error(`${fixtureId}: no python source in catalog`);
  const adapter = defaultRegistry.get(PY_ADAPTER_ID);
  if (adapter === undefined) throw new Error(`adapter not registered: ${PY_ADAPTER_ID}`);
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

const idsOf = (a: AnalysisOutput): string[] => (a.tests ?? []).map((t) => t.test.id);

/* ---- shared runs (top-level beforeAll: every test below reads these) ---- */

let unitResults: Map<string, ConformanceResult>;
let analyses: Map<string, AnalysisOutput>;

beforeAll(() => {
  unitResults = new Map(PY_FIXTURE_IDS.map((id) => [id, runFixture(id, 'python', UNIT_OPTIONS)]));
  analyses = new Map(PY_FIXTURE_IDS.map((id) => [id, collectDirect(id)]));
});

/* ================= GROUP A — §B/§D invariants (must be GREEN) ================= */

describe('GROUP A: harness-independent conformance invariants (python)', () => {
  describe('§B cat 1 / adapter dispatch — every fixture collects through the extension layer', () => {
    it.each(PY_FIXTURE_IDS)('%s: status PASS|FAIL, adapter python-pytest-adapter, decidedBy extension', (id) => {
      const r = unitResults.get(id)!;
      expect(['PASS', 'FAIL']).toContain(r.status);
      expect(r.adapterId).toBe(PY_ADAPTER_ID);
      expect(r.decidedBy).toBe('extension');
      // Harness scopes manifest state to the fixture directory (harness.ts:13-16;
      // collectFixture manifestExists at harness.ts:171-176): no package.json
      // inside a fixture dir, so resolveAdapter's manifest layer finds no
      // candidate (src/adapters/registry.ts:81) and the extension layer decides.
    });
  });

  describe('§B cat 2 — identity shape, declaration order, repeat-call stability', () => {
    it.each(PY_FIXTURE_IDS)(
      '%s: ids match <file>#<declaration>@<line>:<index>, declaration def, ascending, unique',
      (id) => {
        const source = loadFixture(id).sources.python!;
        const ids = collectionShape(analyses.get(id)!).ids;
        const seen = new Set<string>();
        let prevLine = -1;
        for (const testId of ids) {
          const m = /^(.+)#([^#@]+)@(\d+):(\d+)$/.exec(testId);
          expect(m).not.toBeNull();
          if (m === null) continue;
          expect(m[1].endsWith(basename(source))).toBe(true); // <file> = the fixture source
          expect(m[2].length).toBeGreaterThan(0); // declaration token non-empty
          // Python id shape is <file>#<name>@<line>:<index> (collector.ts:1081):
          // the middle token is the test NAME (test_ prefix — isTestFunction
          // collector.ts:359-363, AST_SCRIPT collector.ts:179); the TestIdentity
          // declaration field ('def', collector.ts:1084) is pinned below.
          expect(m[2].startsWith('test_')).toBe(true);
          for (const t of analyses.get(id)!.tests ?? []) expect(t.test.declaration).toBe('def');
          const line = Number(m[3]);
          expect(line).toBeGreaterThanOrEqual(prevLine); // declaration order preserved
          expect(Number(m[4])).toBeGreaterThanOrEqual(0); // same-line index
          prevLine = line;
          expect(seen.has(testId)).toBe(false); // deterministic, collision-free
          seen.add(testId);
        }
      },
    );

    it.each(PY_FIXTURE_IDS)('%s: two collects produce identical ids and evidence keys', (id) => {
      const a = collectDirect(id);
      const b = collectDirect(id);
      expect(collectionShape(b)).toEqual(collectionShape(a));
    });
  });

  describe('§B cat 6 — evidence field-shape, constants, enums', () => {
    it.each(PY_FIXTURE_IDS)('%s: every per-test assertion_count record carries the required field set', (id) => {
      for (const t of analyses.get(id)!.tests ?? []) {
        const ac: EvidenceRecord | undefined = t.evidence['assertion_count'];
        expect(ac).toBeDefined();
        if (ac === undefined) continue;
        for (const field of REQUIRED_AC_FIELDS) expect(ac).toHaveProperty(field);
        expect(ac.source).toBe(PY_ADAPTER_ID);
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
      // included) and the runFixture `actual` envelope. AnalysisOutput.capabilities
      // is deliberately NOT walked: its keys are named collector capabilities
      // (`runtime_execution`, src/core/analysis.ts:66-70; emitted at
      // src/adapters/python/collector.ts:559-572, runtime_execution at :570)
      // whose names coincidentally match /time/i.
      for (const [id, a] of analyses) {
        walk(a.evidence, `${id}.evidence`);
        for (const [i, t] of (a.tests ?? []).entries()) walk(t.evidence, `${id}.tests[${i}].evidence`);
      }
      for (const [id, r] of unitResults) walk(r.actual, `${id}.actual`);
      expect(offending).toEqual([]);
    });
  });

  describe('§D step 7 — six-field failure diagnostic shape', () => {
    it('CF-ASSERT-001 with default options (declaredType absent) fails; every mismatch has exactly the six fields', () => {
      const r = runFixture('CF-ASSERT-001', 'python');
      expect(r.mismatches.length).toBeGreaterThan(0);
      for (const m of r.mismatches) {
        expect(Object.keys(m).sort()).toEqual(['actual', 'adapter', 'diagnostics', 'evidence', 'expected', 'fixture']);
        expect(typeof m.diagnostics.reason).toBe('string');
        expect(m.diagnostics.reason.length).toBeGreaterThan(0);
      }
    });
  });

  describe('§D NOT_APPLICABLE paths', () => {
    it.each(NOT_APPLICABLE_IDS)('%s: python is NOT_APPLICABLE with zero mismatches', (id) => {
      const r = runFixture(id, 'python');
      expect(r.status).toBe('NOT_APPLICABLE');
      expect(r.mismatches).toEqual([]);
      expect(r.adapterId).toBeNull();
      expect(typeof r.reason).toBe('string');
      expect(r.reason!.length).toBeGreaterThan(0);
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

/* ============ NOT_VERIFIED closure evidence (capability matrix items) ============ */

describe('NOT_VERIFIED closure evidence — observed python behavior (matrix rows 1/3/4)', () => {
  describe('matrix 1 — python declaration token (def test_ discovery)', () => {
    it('CF-DISC-001: ids are <file>#test_first@1:0 and <file>#test_second@4:0, declaration def', () => {
      const source = loadFixture('CF-DISC-001').sources.python!;
      const ids = idsOf(analyses.get('CF-DISC-001')!);
      expect(ids).toEqual([`${source}#test_first@1:0`, `${source}#test_second@4:0`]);
      for (const t of analyses.get('CF-DISC-001')!.tests ?? []) {
        expect(t.test.declaration).toBe('def');
        expect(t.test.name.startsWith('test_')).toBe(true);
      }
    });

    it('token is substrate-independent: forced python3-ast fallback yields the same ids', () => {
      const source = loadFixture('CF-DISC-001').sources.python!;
      const req = createRequire(join(__dirname, '..', '..', 'src', 'adapters', 'python', 'collector.ts'));
      const forced = collectAnalysis(source, {
        ...UNIT_OPTIONS,
        substrateProbe: {
          require: (id: string) => {
            if (id === 'tree-sitter') throw new Error('forced fallback probe');
            return req(id);
          },
        },
      });
      expect(idsOf(forced)).toEqual(idsOf(analyses.get('CF-DISC-001')!));
    });

    it('substrate in THIS runner: native tree-sitter rootNode observed (or recorded absent)', () => {
      const source = loadFixture('CF-DISC-001').sources.python!;
      const req = createRequire(join(__dirname, '..', '..', 'src', 'adapters', 'python', 'collector.ts'));
      interface MinimalParser {
        setLanguage(lang: unknown): void;
        parse(src: string): { rootNode?: { type: string } };
      }
      let nativeRoot = 'tree-sitter-absent';
      try {
        const real = req('tree-sitter') as { Parser?: new () => MinimalParser; Tree?: { prototype: object } };
        const python = req('tree-sitter-python');
        const Inner = real.Parser ?? (real as unknown as new () => MinimalParser);
        class Wrapped implements MinimalParser {
          private inner: MinimalParser | null = null;
          setLanguage(lang: unknown): void {
            this.inner = new Inner();
            this.inner.setLanguage(lang);
          }
          parse(src: string): { rootNode?: { type: string } } {
            const tree = this.inner!.parse(src);
            nativeRoot = tree.rootNode?.type ?? 'undefined';
            return tree;
          }
        }
        const collected = collectAnalysis(source, {
          ...UNIT_OPTIONS,
          substrateProbe: {
            require: (id: string) => (id === 'tree-sitter' ? { Parser: Wrapped, Tree: real.Tree } : req(id)),
            python3: process.env.PYTHON3 ?? undefined,
          },
        });
        // Whatever substrate answered, discovery must equal the default run.
        expect(idsOf(collected)).toEqual(idsOf(analyses.get('CF-DISC-001')!));
        void python;
      } catch {
        // tree-sitter not installed in this workspace: the collector's earned
        // python3-ast fallback is the substrate (collector.ts:340-353); the
        // forced-fallback test above already pinned its output.
        expect(idsOf(analyses.get('CF-DISC-001')!)).toHaveLength(2);
      }
      // Evidence line for the checkpoint (jest prints console output verbatim).
      console.info(`[wp6-substrate] CF-DISC-001 nativeRoot=${nativeRoot}`);
    });
  });

  describe('matrix 3 — CF-HELPER-001 helper-name detection (actual: absent)', () => {
    it('assert_valid() call is not counted; no unclassified_constructs, no helper reason', () => {
      const a = analyses.get('CF-HELPER-001')!;
      const tests = a.tests ?? [];
      expect(tests).toHaveLength(1);
      const ac = tests[0].evidence['assertion_count']!;
      expect(ac.value).toBe(0);
      expect(ac.availability).toBe(Availability.KNOWN);
      expect(ac.coverage.status).toBe(CollectionStatus.COMPLETE);
      expect(ac).not.toHaveProperty('unclassified_constructs');
      expect(ac).not.toHaveProperty('unestablished_assertions');
      expect(ac.reason).toBeUndefined();
      expect(tests[0].declaration_gap).toBeNull();
      expect(a.subject.framework).toBe('pytest');
      // The ts twin's signal ("unresolvable custom assertion helper") has no
      // python emitter: matrix row "custom assertion helper detection" closes
      // as VERIFIED-ABSENT behavior; disposition (adapter gap vs expectation)
      // is the owner §6.5 gate.
    });
  });

  describe('matrix 3 — CF-PARAM-001 parametrize expansion (actual: none)', () => {
    it('single declaration test_parameterized@4:0, count 1, value 1, no parameterized-construct signal', () => {
      const source = loadFixture('CF-PARAM-001').sources.python!;
      const a = analyses.get('CF-PARAM-001')!;
      expect(idsOf(a)).toEqual([`${source}#test_parameterized@4:0`]); // 1 declaration, NOT 2 expanded
      const ac = a.tests![0].evidence['assertion_count']!;
      expect(ac.value).toBe(1);
      expect(ac.availability).toBe(Availability.KNOWN);
      expect(ac.coverage.status).toBe(CollectionStatus.COMPLETE);
      expect(ac).not.toHaveProperty('unclassified_constructs');
      expect(JSON.stringify(a)).not.toContain('parameterized construct');
    });
  });

  describe('matrix 1 — CF-NEST-001 unittest attribution (self.assert* NOT covered)', () => {
    it('class-based TestOuter: both tests attributed framework unittest; subject unittest', () => {
      const source = loadFixture('CF-NEST-001').sources.python!;
      const a = analyses.get('CF-NEST-001')!;
      expect(idsOf(a)).toEqual([`${source}#test_first_nested@2:0`, `${source}#test_second_nested@5:0`]);
      for (const t of a.tests ?? []) {
        expect(t.test.framework).toBe('unittest'); // collector.ts:473-478 inClass -> unittest
        expect(t.framework).toBe('unittest');
        expect(t.evidence['assertion_count']!.value).toBe(1);
      }
      expect(a.subject.framework).toBe('unittest'); // collector.ts:1030-1032 hasUnittest
      // Matrix item "unittest self.assert* behavior": CF fixtures contain NO
      // self.assert* call anywhere (bodies use bare `assert`) — remains
      // NOT_VERIFIED; class-based grouping attribution is what this run shows.
    });
  });

  describe('matrix 4 — CF-UNSUP-001 @given reason strings + unsupported-form emission', () => {
    it('per-test/file-level @given reasons verbatim; SYNTAX_OBSERVED + property_based; unsupported-form never emitted', () => {
      const a = analyses.get('CF-UNSUP-001')!;
      const t = a.tests![0];
      const ac = t.evidence['assertion_count']!;
      expect(ac.value).toBe(1);
      expect(ac.availability).toBe(Availability.KNOWN);
      expect(ac.coverage.status).toBe(CollectionStatus.PARTIAL);
      expect(ac.evidenceStrength).toBe('SYNTAX_OBSERVED');
      expect((ac as unknown as Record<string, unknown>)['property_based']).toBe(true);
      expect(ac.reason).toBe('hypothesis @given: property-based count (not case-exhaustive)');
      const fileAc = a.evidence['assertion_count']!;
      expect(fileAc.reason).toBe(
        '1 hypothesis @given declaration(s): property-based count (not case-exhaustive), so executability cannot be established statically',
      );
      expect(fileAc.coverage.status).toBe(CollectionStatus.PARTIAL);
      expect(a.analysis.completeness).toBe('INCOMPLETE');
      expect(ac).not.toHaveProperty('unclassified_constructs');
      // UNSUPPORTED_FORM_GAP='unsupported-form' (src/adapters/python/support.ts:53)
      // is imported at src/adapters/python/collector.ts:55 but has NO emission
      // call site in the python collector (rg: only no-mutation-report /
      // unparseable-report reach gapReason). Pin the observed fact:
      expect(JSON.stringify(a)).not.toContain('unsupported-form');
      expect(JSON.stringify(a)).not.toContain("'assert' is not a supported assertion form");
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
      '# WP6 Python conformance — observation pass (python, declaredType=UNIT)',
      '',
      'Generated by tests/conformance/python.conformance.test.ts (GROUP B).',
      'Observation only per Amendment A-WP6-1 — NOT jest verdict assertions; classification',
      'of expectation-vs-adapter-gap vs spec-vs-fixture gap is the owner §6.5 gate decision.',
      '',
      '## Summary (one row per fixture)',
      '',
      '| Fixture | Adapter | decidedBy | Status | Mismatches | Envelope (analysis/evaluation/completeness) |',
      '|---|---|---|---|---|---|',
    ];
    for (const id of PY_FIXTURE_IDS) {
      const r = unitResults.get(id)!;
      const e = r.actual.envelope;
      md.push(
        `| ${id} | ${r.adapterId ?? '—'} | ${r.decidedBy ?? '—'} | ${r.status} | ${r.mismatches.length} | ${e.analysisStatus}/${e.evaluationStatus}/${e.completeness} |`,
      );
    }
    md.push('', '## Mismatch detail (one row per mismatch; evidence = keys + status only)', '');
    md.push('| Fixture | Adapter | Expected | Actual | Evidence | diagnostics.reason |');
    md.push('|---|---|---|---|---|---|');
    for (const id of PY_FIXTURE_IDS) {
      for (const m of unitResults.get(id)!.mismatches) {
        md.push(
          `| ${id} | ${m.adapter ?? '—'} | ${compact(m.expected)} | ${compact(m.actual)} | ${evidenceSummary(m.evidence)} | ${cell(m.diagnostics.reason)} |`,
        );
      }
    }
    writeFileSync(OBS_PATH, `${md.join('\n')}\n`, 'utf8');
  });

  it('observation table has exactly 12 fixture rows (one per python-capable fixture, summary section)', () => {
    const md = readFileSync(OBS_PATH, 'utf8');
    const summary = md.split('## Mismatch detail')[0];
    const rows = summary.split('\n').filter((l) => l.startsWith('| CF-'));
    expect(rows.length).toBe(12);
    const rowIds = rows.map((l) => l.split('|')[1].trim());
    expect(new Set(rowIds)).toEqual(new Set<string>(PY_FIXTURE_IDS));
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
