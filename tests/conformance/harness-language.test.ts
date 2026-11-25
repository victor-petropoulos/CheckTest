/**
 * Plan task 1 (.opencode/plans/2026-11-22-bylanguage-harness-adoption.md) —
 * RED adoption contract for the *ByLanguage sidecar branches, encoded through
 * the PUBLIC runFixture API.
 *
 * The harness currently ignores expectedEvidenceByLanguage /
 * expectedEnvelopeByLanguage (harness.ts compareEvidence/compareEnvelope read
 * only the shared expectedEvidence/expectedEnvelope blocks), so (a)/(b)/(c)
 * fail today; the task-2 deep-merge (branch over shared) makes them green.
 * (d) is the no-branch fallback witness and must stay green throughout.
 *
 * Tests only — no harness.ts edit in this task.
 */

import { loadFixture, runFixture } from './harness';
import type { ConformanceResult, Diagnostic } from './harness';
import { TestType } from '../../src/core/analysis';

jest.setTimeout(120_000);

/** Ruling D-WP6-1: sidecar framework lines expect concrete-type verdicts → UNIT. */
const UNIT_OPTIONS = { declaredType: TestType.UNIT };

const LANGUAGES = ['ts', 'python'] as const;

/** Six-field §D diagnostics whose reason matches `needle`. */
function mismatchesMatching(r: ConformanceResult, needle: RegExp): Diagnostic[] {
  return r.mismatches.filter((m) => needle.test(m.diagnostics.reason));
}

describe('task 1(a) DIVERGENCE — CF-ASSERT-001 expectedEvidenceByLanguage', () => {
  it.each(LANGUAGES)('%s: status PASS, zero mismatches, zero evidenceStrength mismatches', (language) => {
    const r = runFixture('CF-ASSERT-001', language, UNIT_OPTIONS);
    // Shared block pins SYNTAX_OBSERVED; both branches pin EXECUTION_ESTABLISHED.
    expect(mismatchesMatching(r, /evidenceStrength/)).toEqual([]);
    expect(r.mismatches).toEqual([]);
    expect(r.status).toBe('PASS');
  });
});

describe('task 1(b) DIVERGENCE — CF-UNSUP-001 expectedEvidenceByLanguage value', () => {
  it.each(LANGUAGES)(
    '%s: no assertion_count.value mismatch (branch pins 0 vs 1, shared pins stale null)',
    (language) => {
      const r = runFixture('CF-UNSUP-001', language, UNIT_OPTIONS);
      expect(mismatchesMatching(r, /assertion_count\.value/)).toEqual([]);
    },
  );
});

describe('task 1(c) ENVELOPE divergence — CF-NORULE-001 expectedEnvelopeByLanguage', () => {
  // Per-language only: ts branch is UNSUPPORTED/NOT_APPLICABLE, python branch is
  // SUCCESS/COMPLETE; the shared block pins SUCCESS/NOT_APPLICABLE for both.
  // Status itself is NOT asserted here — only the envelope-field mismatch reasons.
  it.each(LANGUAGES)('%s: no analysisStatus/completeness mismatch', (language) => {
    const r = runFixture('CF-NORULE-001', language, UNIT_OPTIONS);
    expect(mismatchesMatching(r, /analysisStatus|completeness/)).toEqual([]);
  });
});

describe('task 1(d) FALLBACK — CF-DISC-001 has no *ByLanguage branch', () => {
  it('sidecar carries no *ByLanguage keys (fallback witness premise)', () => {
    const sidecar = loadFixture('CF-DISC-001').sidecar;
    expect(Object.keys(sidecar).filter((k) => k.endsWith('ByLanguage'))).toEqual([]);
  });

  it('ts UNIT stays PASS with the shared blocks only', () => {
    const r = runFixture('CF-DISC-001', 'ts', UNIT_OPTIONS);
    expect(r.status).toBe('PASS');
    expect(r.mismatches).toEqual([]);
  });
});

/* ── Plan task 3 — merge-semantics unit tests (mergeExpected, harness.ts:279) ── */

import { mergeExpected } from './harness';

/** The six fixtures carrying a *ByLanguage branch (5 evidence, 6 envelope... see test). */
const BRANCH_FIXTURES = [
  'CF-ASSERT-001',
  'CF-COND-001',
  'CF-HELPER-001',
  'CF-PARAM-001',
  'CF-NORULE-001',
  'CF-UNSUP-001',
] as const;

/**
 * Dotted leaf-paths of a Record tree: plain objects recurse; arrays, scalars
 * and null are leaves. An empty object is itself a leaf (its own path).
 */
function leafPaths(node: unknown, prefix = ''): string[] {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    const entries = Object.entries(node as Record<string, unknown>);
    if (entries.length === 0) return prefix ? [prefix] : [];
    return entries.flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

describe('task 3(1) NO-LOOSENING — merged leaf-paths ⊇ shared leaf-paths', () => {
  /**
   * Coverage rule: a shared leaf-path survives if (a) it is itself a leaf of
   * the merged tree, or (b) a strict ancestor of it became an explicit-null
   * leaf under merge (task 3(3) asserts-absent REPLACE — the subtree is
   * replaced by an assertion of absence, not weakened). Any other disappearance
   * is a lost assertion and fails.
   */
  function coverageGaps(shared: unknown, merged: unknown): string[] {
    const mergedPaths = leafPaths(merged);
    const mergedSet = new Set(mergedPaths);
    const read = (path: string): unknown =>
      path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], merged);
    const gaps: string[] = [];
    for (const path of leafPaths(shared)) {
      if (mergedSet.has(path)) continue;
      const segments = path.split('.');
      let nullAncestor = false;
      for (let i = segments.length - 1; i >= 1; i--) {
        const ancestor = segments.slice(0, i).join('.');
        if (mergedSet.has(ancestor)) {
          nullAncestor = read(ancestor) === null;
          break;
        }
      }
      if (!nullAncestor) gaps.push(path);
    }
    return gaps;
  }

  it.each(BRANCH_FIXTURES)('%s: no shared leaf-path disappears under merge (evidence + envelope)', (fixtureId) => {
    const sidecar = loadFixture(fixtureId).sidecar;
    for (const language of LANGUAGES) {
      const evBranch = sidecar.expectedEvidenceByLanguage?.[language];
      if (evBranch) {
        const gaps = coverageGaps(sidecar.expectedEvidence, mergeExpected(evBranch, sidecar.expectedEvidence));
        expect({ fixtureId, language, block: 'evidence', gaps }).toEqual({
          fixtureId,
          language,
          block: 'evidence',
          gaps: [],
        });
      }
      const enBranch = sidecar.expectedEnvelopeByLanguage?.[language];
      if (enBranch) {
        const gaps = coverageGaps(sidecar.expectedEnvelope, mergeExpected(enBranch, sidecar.expectedEnvelope));
        expect({ fixtureId, language, block: 'envelope', gaps }).toEqual({
          fixtureId,
          language,
          block: 'envelope',
          gaps: [],
        });
      }
    }
  });

  it('the only subtree replaced by a non-path leaf is CF-ASSERT-001 unestablished_assertions:null (task 3(3))', () => {
    const replacements: string[] = [];
    for (const fixtureId of BRANCH_FIXTURES) {
      const sidecar = loadFixture(fixtureId).sidecar;
      for (const language of LANGUAGES) {
        for (const [block, branchMap, shared] of [
          ['evidence', sidecar.expectedEvidenceByLanguage, sidecar.expectedEvidence],
          ['envelope', sidecar.expectedEnvelopeByLanguage, sidecar.expectedEnvelope],
        ] as const) {
          const branch = branchMap?.[language];
          if (!branch) continue;
          const merged = mergeExpected(branch, shared);
          const mergedSet = new Set(leafPaths(merged));
          for (const path of leafPaths(shared)) {
            if (mergedSet.has(path)) continue;
            const segments = path.split('.');
            for (let i = segments.length - 1; i >= 1; i--) {
              const ancestor = segments.slice(0, i).join('.');
              if (mergedSet.has(ancestor)) {
                replacements.push(`${fixtureId}/${language}/${block}:${ancestor}`);
                break;
              }
            }
          }
        }
      }
    }
    expect([...new Set(replacements)].sort()).toEqual([
      'CF-ASSERT-001/python/evidence:perTest.assertion_count.unestablished_assertions',
      'CF-ASSERT-001/ts/evidence:perTest.assertion_count.unestablished_assertions',
    ]);
  });

  it('branch-fixtures premise: every fixture above carries at least one *ByLanguage branch', () => {
    for (const fixtureId of BRANCH_FIXTURES) {
      const sidecar = loadFixture(fixtureId).sidecar;
      const hasBranch = Boolean(sidecar.expectedEvidenceByLanguage ?? sidecar.expectedEnvelopeByLanguage);
      expect({ fixtureId, hasBranch }).toEqual({ fixtureId, hasBranch: true });
    }
  });
});

describe('task 3(2) array REPLACE — branch reasons array overrides shared wholesale', () => {
  it('reasons replaced by branch array; count replaced by branch scalar', () => {
    const shared = { perTest: { assertion_count: { count: 1, reasons: ['a', 'b'] } } };
    const branch = { perTest: { assertion_count: { count: 2, reasons: ['x'] } } };
    const merged = mergeExpected(branch, shared);
    expect(merged).toEqual({ perTest: { assertion_count: { count: 2, reasons: ['x'] } } });
    // Not concatenated, not deep-merged:
    expect((merged as typeof shared).perTest.assertion_count.reasons).toEqual(['x']);
  });
});

describe('task 3(3) explicit null asserts-absent', () => {
  it('unit: branch null overrides shared object (unestablished_assertions)', () => {
    const merged = mergeExpected(
      { perTest: { assertion_count: { unestablished_assertions: null } } },
      { perTest: { assertion_count: { unestablished_assertions: { count: 0, reasons: [] } } } },
    );
    expect(merged).toEqual({ perTest: { assertion_count: { unestablished_assertions: null } } });
    expect(
      (merged as { perTest: { assertion_count: { unestablished_assertions: unknown } } }).perTest.assertion_count
        .unestablished_assertions,
    ).toBeNull();
  });

  it('behavioral: CF-ASSERT-001 ts (default options) — null-vs-absent eq(), no mismatch reason mentions unestablished_assertions', () => {
    // Premise: default UNKNOWN declaredType → mismatches>0 (other fields diverge).
    const r = runFixture('CF-ASSERT-001', 'ts');
    expect(r.mismatches.length).toBeGreaterThan(0);
    expect(mismatchesMatching(r, /unestablished_assertions/)).toEqual([]);
  });
});

describe('task 3(4) branch-absent → shared identity; merge never mutates', () => {
  it('mergeExpected(undefined, shared) returns shared by identity (toBe)', () => {
    const shared = { perTest: { assertion_count: { value: 1 } } };
    expect(mergeExpected(undefined, shared)).toBe(shared);
  });

  it('mergeExpected(branch, undefined) deep-equals branch', () => {
    const branch = { perTest: { assertion_count: { value: 0 } } };
    expect(mergeExpected(branch, undefined)).toEqual(branch);
  });

  it('merge produces a NEW object and leaves shared untouched', () => {
    const shared = { perTest: { assertion_count: { value: 1, provenance: 'DIRECT' } } };
    const branch = { perTest: { assertion_count: { value: 0 } } };
    const sharedSnapshot = JSON.stringify(shared);
    const branchSnapshot = JSON.stringify(branch);
    const merged = mergeExpected(branch, shared);
    expect(merged).not.toBe(shared);
    expect(JSON.stringify(shared)).toBe(sharedSnapshot);
    expect(JSON.stringify(branch)).toBe(branchSnapshot);
    expect(shared).toEqual({ perTest: { assertion_count: { value: 1, provenance: 'DIRECT' } } });
    expect(merged).toEqual({ perTest: { assertion_count: { value: 0, provenance: 'DIRECT' } } });
  });
});

describe('task 3(5) precedence — branch value wins over shared on the same key', () => {
  it('synthetic: {a:1} over {a:2,b:3} → {a:1,b:3}', () => {
    expect(mergeExpected({ a: 1 }, { a: 2, b: 3 })).toEqual({ a: 1, b: 3 });
  });

  it('real fixture: CF-UNSUP-001 ts evidence branch — value 0 wins over shared null; shared-only provenance kept', () => {
    const sidecar = loadFixture('CF-UNSUP-001').sidecar;
    const branch = sidecar.expectedEvidenceByLanguage?.ts;
    expect(branch).toBeDefined();
    const merged = mergeExpected(branch, sidecar.expectedEvidence) as {
      perTest?: Record<string, Record<string, unknown>>;
    };
    const assertionCount = merged.perTest?.assertion_count;
    expect(assertionCount?.value).toBe(0); // branch 0 wins over shared null
    expect(assertionCount?.provenance).toBe('DIRECT'); // shared key the branch omits survives
  });
});
