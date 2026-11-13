/**
 * CT-MUT-001 — mutation-score-observed (WP4.1 task 14 / SP3.2).
 *
 * Turns a file-level `mutation_score` evidence record (produced by the
 * external Stryker mutation provider, src/providers/mutation.ts) into a verdict.
 *
 * The verdict is rule-local because the metric is a fraction (0..1) carried as
 * an object (`MutationScore.score`), while the engine's numeric step 7 assumes a
 * single higher-is-better count. The shared guards 0-6 remain centralized; only
 * step 7 is replaced (rule.ts Unit B1 seam).
 *
 * Fixed threshold (user ruling 2026-11-07): `MUTATION_THRESHOLD = 0.5`.
 * PASS when mutation_score >= 0.5, FAIL when < 0.5. No CLI flag, no config
 * (SP4 owns thresholds).
 *
 * "no report != zero mutants": a missing/unreadable/malformed/no-valid-mutants
 * provider record is Availability.UNKNOWN and never reaches this hook as a
 * number — the step-5 guard yields INDETERMINATE instead of FAIL.
 *
 * File-level only: mutation evidence never reaches a per-declaration scope
 * (roadmap:1086); this rule reports a file-level verdict.
 */
import { TestType } from '../core/analysis';
import { requiresCompleteForNegativeVerdict } from '../core/evaluation';
import { CollectionStatus } from '../core/evidence';
import { RuleResult } from '../core/result';
import { RuleMetadata } from '../core/rule';

export const MUTATION_THRESHOLD = 0.5;

export const CT_MUT_001: RuleMetadata = {
  id: 'CT-MUT-001',
  name: 'mutation-score-observed',
  category: 'mutation',
  description:
    'mutation-score-observed diagnostic: reports whether the file-level mutation score meets the fixed 0.5 threshold. Evidence is file-level only (Stryker report); no per-declaration attribution is claimed.',
  applies_to: [TestType.UNIT, TestType.COMPONENT, TestType.INTEGRATION, TestType.CONTRACT, TestType.E2E],
  required_evidence: ['mutation_score'],
  analysis_scope: 'test-body',
  minimum_evidence_completeness: CollectionStatus.COMPLETE,
  unknown_evidence_policy: RuleResult.INDETERMINATE,
  conflicting_evidence_policy: RuleResult.INDETERMINATE,
  // Numeric thresholds are inert for this rule: local_decision replaces step 7.
  // They still satisfy the registry's strict ordering contract (pass > fail).
  evaluation: { metric: 'mutation_score', pass_at_least: 1, fail_at_most: 0 },
  severity: 'warning',
  status: 'active',
  local_decision: (context) => {
    const record = (context as { record?: any }).record ?? context;
    const ms = record.value;
    const score =
      ms !== null && typeof ms === 'object' && typeof (ms as { score?: unknown }).score === 'number'
        ? (ms as { score: number }).score
        : undefined;

    if (typeof score !== 'number' || !Number.isFinite(score)) {
      return {
        result: RuleResult.INDETERMINATE,
        reason: `${CT_MUT_001.id}: mutation_score is not computable${record.reason ? ` (${record.reason})` : ''}`,
        location: record.location,
      };
    }

    if (score >= MUTATION_THRESHOLD) {
      return {
        result: RuleResult.PASS,
        reason: `${CT_MUT_001.id}: mutation_score=${score} >= ${MUTATION_THRESHOLD}`,
        location: record.location,
      };
    }

    // A negative verdict still needs COMPLETE evidence. Step 4 already enforced
    // the minimum; this repeats the guard so direct hook invocation stays honest.
    if (!requiresCompleteForNegativeVerdict(record.coverage.status, CollectionStatus.COMPLETE)) {
      return {
        result: RuleResult.INDETERMINATE,
        reason: `${CT_MUT_001.id}: mutation_score=${score} but coverage.status ${record.coverage.status} is below required COMPLETE — an incomplete scan cannot prove this verdict`,
        location: record.location,
      };
    }

    return {
      result: RuleResult.FAIL,
      reason: `${CT_MUT_001.id}: mutation_score=${score} < ${MUTATION_THRESHOLD}`,
      location: record.location,
    };
  },
  rationale:
    'A mutation report gives a file-level mutation score (detected/valid). CT-MUT-001 reports whether that score meets the fixed 0.5 threshold. It is file-level only: no per-declaration attribution is derived from a mutation report.',
  limitations:
    'Depends entirely on an externally produced Stryker mutation report. A missing, unreadable, malformed, revision-mismatched or zero-valid-mutants report yields INDETERMINATE rather than FAIL ("no report != zero mutants"). Coverage is always COMPLETE on a scored record, UNKNOWN otherwise.',
  docsUrl: 'docs/rules/ct-mut-001-contract.md',
};
