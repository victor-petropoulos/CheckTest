/**
 * Task 1 (plan .opencode/plans/2026-11-22-selfcheck-unit-test.md) — RED suite for the
 * §D diagnostic-shape validation extracted from harness.ts selfCheck (harness.ts:662-667).
 *
 * Drives every throw branch of the exported helper assertDiagnosticShape: valid
 * diagnostic (no throw), one case per missing field of the six-field §D diagnostic
 * (harness.ts:77-84), empty reason, non-string reason; plus the selfCheck() happy
 * path. RED today: harness.ts does not export assertDiagnosticShape yet — ts-jest
 * fails with TS2305. That failure IS the deliverable evidence for this task.
 */

import { assertDiagnosticShape, selfCheck } from './harness';
import type { Diagnostic } from './harness';

/** The six §D diagnostic fields (harness.ts:662), in the harness's own order. */
const DIAGNOSTIC_FIELDS = ['adapter', 'fixture', 'expected', 'actual', 'evidence', 'diagnostics'] as const;

/** Valid baseline diagnostic: mirrors the mismatch selfCheck builds (harness.ts:650, :660). */
function validDiagnostic(): Diagnostic {
  return {
    adapter: 'typescript-jest-adapter',
    fixture: 'CF-ASSERT-001',
    expected: 999,
    actual: 1,
    evidence: null,
    diagnostics: { reason: 'deliberate self-check mismatch: expected assertion_count 999', completeness: 'COMPLETE' },
  };
}

/** Remove one field from an otherwise-valid diagnostic (typecheck-safe mutation). */
function withoutField(field: string): Diagnostic {
  const bad: Record<string, unknown> = { ...validDiagnostic() };
  delete bad[field];
  return bad as unknown as Diagnostic;
}

/** Replace diagnostics.reason with a non-string value (typecheck-safe mutation). */
function withReason(reason: unknown): Diagnostic {
  const bad: Record<string, unknown> = { ...validDiagnostic() };
  bad.diagnostics = { reason, completeness: 'COMPLETE' };
  return bad as unknown as Diagnostic;
}

describe('selfCheck unit suite (§D diagnostic-shape validation)', () => {
  describe('assertDiagnosticShape — valid diagnostic', () => {
    it('valid six-field diagnostic passes without throwing', () => {
      expect(() => assertDiagnosticShape(validDiagnostic())).not.toThrow();
    });
  });

  describe('assertDiagnosticShape — missing field branches', () => {
    it.each(DIAGNOSTIC_FIELDS)('missing %s throws /diagnostic missing field %s/', (field) => {
      expect(() => assertDiagnosticShape(withoutField(field))).toThrow(new RegExp(`diagnostic missing field ${field}`));
    });
  });

  describe('assertDiagnosticShape — reason branches', () => {
    it('empty reason throws /diagnostic reason empty/', () => {
      expect(() => assertDiagnosticShape(withReason(''))).toThrow(/diagnostic reason empty/);
    });

    it('non-string reason throws /diagnostic reason empty/', () => {
      expect(() => assertDiagnosticShape(withReason(42))).toThrow(/diagnostic reason empty/);
    });
  });

  describe('selfCheck() regression', () => {
    it('selfCheck passes (existing behavior held constant)', () => {
      expect(() => selfCheck()).not.toThrow();
    });
  });
});
