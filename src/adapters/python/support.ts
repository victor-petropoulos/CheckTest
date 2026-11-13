/**
 * Python/pytest adapter — supported-syntax surface (Phase 8 task C2).
 *
 * Everything the adapter CLAIMS to recognize is published here as data: the
 * framework allowlist, the assertion form IDs the collector detects, and the
 * provider hints. The collector is the only caller; nothing here evaluates
 * rules.
 *
 * Dependency direction: adapter -> core. This module re-exports one core
 * constant (EVIDENCE_SCOPE_TEST_BODY) as ANALYSIS_SCOPE; it never imports
 * `src/rules`.
 */

import { EVIDENCE_SCOPE_TEST_BODY } from '../../core/evidence';

/** Declared analysis scope. Re-export of the core constant (adapter -> core), mirroring the TS adapter. */
export const ANALYSIS_SCOPE = EVIDENCE_SCOPE_TEST_BODY;

/** SPEC:252 — collector identity published in every evidence record. */
export const ANALYZER_ID = 'python-pytest-adapter';

/** Constant string (plan guardrail: no timestamps in output). */
export const COLLECTOR_VERSION = '0.1.0';

/** The single evidence type this adapter emits. */
export const EVIDENCE_ASSERTION_COUNT = 'assertion_count';

/**
 * Capability vocabulary lives in the leaf `./capabilities` (single definition,
 * mirroring the TS adapter's capabilities.ts precedent); these re-exports keep
 * the existing `./support` importers working unchanged.
 */
export { SUPPORTED_ASSERTION_FORMS, SUPPORTED_FRAMEWORKS } from './capabilities';

/**
 * ADR-033 — declared but unconsumed provider hints: analysis tooling the
 * adapter could consult. No collector code path reads this yet; publishing it
 * keeps the capability surface honest while support lands task by task.
 */
export const PROVIDER_HINTS: readonly string[] = ['coverage-py', 'pytest-cov', 'mutmut'];

/**
 * Gap reasons — why evidence is UNKNOWN / PARTIAL. Reason substrings are
 * pinned by tests/adapters/python/collector.test.ts (C1); changing them means
 * changing the tests.
 */

/** C1: hypothesis `@given` (and any other unrecognized assertion shape). */
export const UNSUPPORTED_FORM_GAP = 'unsupported-form';

/** C1: no mutation tooling report was passed to the collector. */
export const NO_MUTATION_REPORT = 'no mutation report supplied';

/** Coverage provider named without a parseable report file. */
export const UNPARSEABLE_REPORT_GAP = 'unparseable-coverage-report';

/**
 * Why a collected piece of evidence is not KNOWN, mirroring the TS adapter's
 * gap-reason pattern: every gap has a single canonical reason string the
 * collector publishes verbatim, never composed ad hoc at call sites.
 */
export function gapReason(kind: 'unsupported-form' | 'no-mutation-report' | 'unparseable-report'): string {
  switch (kind) {
    case 'unsupported-form':
      return UNSUPPORTED_FORM_GAP;
    case 'no-mutation-report':
      return NO_MUTATION_REPORT;
    default:
      return UNPARSEABLE_REPORT_GAP;
  }
}
