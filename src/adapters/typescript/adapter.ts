/**
 * TypeScript/Jest adapter — the formal Adapter contract instance (ADR-033
 * §Decision 1; phase 7 task 12).
 *
 * `src/adapters/adapter.ts` is the TYPE-ONLY contract; this module is its
 * runtime instantiation for TypeScript. It publishes the descriptor fields a
 * dispatcher or consumer needs WITHOUT running the adapter, and its single
 * entry point delegates to the UNCHANGED collector
 * (`src/adapters/typescript/collector.ts`).
 *
 * Wiring (task 12 scope decision 3): `src/cli.ts` calls
 * `typescriptAdapter.collectAnalysis(options.test, { declaredType: options.type })`
 * where it previously called the collector's `collectAnalysis(path, type)`
 * directly. The options-bag mapping below (`options?.declaredType ??
 * TestType.UNKNOWN`) preserves today's behaviour exactly: the CLI always
 * passes a `TestType` (default UNKNOWN from `parseArgs`, src/cli.ts:125), and
 * UNKNOWN is the collector's positional default (collector.ts:149) — the type
 * is never inferred (A3, SPEC:450-458).
 *
 * Module side effects: NONE. This module constructs one data object and
 * imports the collector chain; it registers nothing and touches no global
 * state (the rule registry is populated explicitly inside `main()`,
 * src/cli.ts:201-206), so importing the adapter instance is behaviourally
 * identical to importing the collector function.
 */

import { TestType } from '../../core/analysis';
import { SUPPORTED_ASSERTION_FORMS, SUPPORTED_FRAMEWORKS } from './capabilities';
import { collectAnalysis } from './collector';
import { ANALYZER_ID, COLLECTOR_VERSION } from './support';
import type { Adapter } from '../adapter';

export const typescriptAdapter: Adapter = {
  /** Task 11 reviewer-accepted mapping: the collector's evidence `source` id (support.ts:40). */
  id: ANALYZER_ID,
  /** Task 11 reviewer-accepted mapping: the collector's version constant (support.ts:43). */
  version: COLLECTOR_VERSION,
  /** Matches `AnalysisSubject.language` as emitted by the collector (collector.ts:183). */
  language: 'typescript',
  /**
   * Exactly the extensions the collector has explicit handling for (ADR-034's
   * lowest-priority dispatch layer): the JSX-decision-B heuristic at
   * collector.ts:133 matches `/\.(jsx?|tsx?)$/` on the file path, and the .js
   * coverage is exercised by tests/adapters/collector-jsx.test.ts. The
   * collector itself applies no extension gate — it parses any path it is
   * given — so this list is the CLAIM, not a filter.
   */
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  /**
   * Conservative manifest signature: `package.json` is the manifest a
   * TypeScript/JavaScript project carries (ADR-034's middle dispatch layer);
   * nothing else identifies the ecosystem, and no report format is inferred
   * from a manifest today.
   */
  manifestSignatures: ['package.json'],
  /**
   * The capability values by REFERENCE — the same arrays exported through
   * `./capabilities` (single definition; the conformance test pins identity).
   */
  capabilities: { frameworks: SUPPORTED_FRAMEWORKS, assertionForms: SUPPORTED_ASSERTION_FORMS },
  /**
   * The provider report-format ids this ecosystem produces and the providers
   * already parse (DECLARED BUT UNCONSUMED — ADR-033 §Decision 1): coverage
   * defaults `providerOverride ?? 'istanbul'` (src/providers/coverage.ts:287)
   * and `?? 'c8'` (:308); mutation defaults `?? 'stryker'`
   * (src/providers/mutation.ts:263).
   */
  providerHints: ['istanbul', 'c8', 'stryker'],
  /** Delegates to the unchanged collector; the type stays caller-declared. */
  collectAnalysis: (filePath, options) => collectAnalysis(filePath, options?.declaredType ?? TestType.UNKNOWN),
};
