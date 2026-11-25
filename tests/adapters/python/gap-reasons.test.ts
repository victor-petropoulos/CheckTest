import { join } from 'path';

import { collectAnalysis } from '../../../src/adapters/python/collector';
import { UNSUPPORTED_FORM_GAP, gapReason } from '../../../src/adapters/python/support';

const FIXTURES = join(__dirname, 'fixtures');

// WP-C task 17 (RED) — owner ruling ## Decisions #12 B5 C-1:
// "Publish canonical constant (Recommended)" — support.ts:53 UNSUPPORTED_FORM_GAP
// is published through gapReason() and the collector composes its @given reasons
// from that same canonical constant (collector.ts:734 per-test, :819-822 file-level).
// The test pins that the canonical constant APPEARS; the ad-hoc context wording
// may remain or be replaced (ruling: "compose from the same canonical constant").
describe('C-1: canonical unsupported-form reason published via gapReason (Decisions #12 B5 C-1)', () => {
  it('gapReason("unsupported-form") returns the canonical constant verbatim (regression pin)', () => {
    expect(gapReason('unsupported-form')).toBe(UNSUPPORTED_FORM_GAP);
    expect(UNSUPPORTED_FORM_GAP).toBe('unsupported-form');
  });

  it('per-test assertion_count reason for a @given test CONTAINS the canonical UNSUPPORTED_FORM_GAP', () => {
    const output = collectAnalysis(join(FIXTURES, 'hypothesis_given.py'));
    const scope = (output.tests ?? []).find((s) => s.test.name === 'test_hypothesis');
    expect(scope).toBeDefined();
    const record = scope!.evidence['assertion_count'];
    expect(record.reason).toContain(UNSUPPORTED_FORM_GAP);
  });

  it('file-level assertion_count reason CONTAINS the canonical constant verbatim', () => {
    const output = collectAnalysis(join(FIXTURES, 'hypothesis_given.py'));
    const record = output.evidence['assertion_count'];
    expect(record.reason).toContain(UNSUPPORTED_FORM_GAP);
  });
});
