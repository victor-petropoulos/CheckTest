/**
 * Python/pytest adapter — the formal Adapter contract instance (Phase 8
 * task C4; mirrors the TypeScript instance in
 * src/adapters/typescript/adapter.ts).
 *
 * `src/adapters/adapter.ts` is the TYPE-ONLY contract; this module is its
 * runtime instantiation for Python. It publishes the descriptor fields a
 * dispatcher or consumer needs WITHOUT running the adapter, and its single
 * entry point delegates to the UNCHANGED collector
 * (`src/adapters/python/collector.ts`).
 *
 * Module side effects: NONE. This module constructs one data object and
 * imports the collector; it registers nothing and touches no global state
 * (registration happens explicitly in src/adapters/registry.ts), so importing
 * the adapter instance is behaviourally identical to importing the collector
 * function.
 */

import { SUPPORTED_ASSERTION_FORMS, SUPPORTED_FRAMEWORKS } from './capabilities';
import { collectAnalysis, type SubstrateProbe } from './collector';
import { ANALYZER_ID, COLLECTOR_VERSION, PROVIDER_HINTS } from './support';
import type { Adapter } from '../adapter';

export const pythonAdapter: Adapter = {
  /** The collector's evidence `source` id (support.ts ANALYZER_ID). */
  id: ANALYZER_ID,
  /** The collector's version constant (support.ts COLLECTOR_VERSION). */
  version: COLLECTOR_VERSION,
  /** Coarse language family tag, matching the TS instance's mapping. */
  language: 'python',
  /**
   * Exactly the extensions the collector handles (ADR-034's lowest-priority
   * dispatch layer): the python collector parses `.py` files. Like the TS
   * instance's list, this is the CLAIM, not a filter — the collector applies
   * no extension gate itself (parked Phase-7 convention).
   */
  extensions: ['.py'],
  /**
   * Manifest signatures identifying a Python project (ADR-034's middle
   * dispatch layer); no report format is inferred from a manifest today.
   */
  manifestSignatures: ['pyproject.toml', 'setup.py', 'requirements.txt'],
  /**
   * The capability values by REFERENCE — the same arrays exported through
   * `./capabilities` (single definition; the conformance test pins identity).
   */
  capabilities: { frameworks: SUPPORTED_FRAMEWORKS, assertionForms: SUPPORTED_ASSERTION_FORMS },
  /**
   * The provider report-format ids this ecosystem produces (DECLARED BUT
   * UNCONSUMED — ADR-033 §Decision 1; nothing reads this field yet).
   */
  providerHints: PROVIDER_HINTS,
  /**
   * Delegates to the collector, forwarding declaredType and coverageReport
   * (D-20261112-5 Q2/Q1). The python collector's contract is
   * `collectAnalysis(filePath, { coverageReport?, declaredType? })`.
   */
  collectAnalysis: (filePath, options) =>
    collectAnalysis(filePath, {
      ...(options?.declaredType !== undefined ? { declaredType: options.declaredType } : {}),
      ...(options?.coverageReport !== undefined ? { coverageReport: options.coverageReport } : {}),
      ...(options?.coverageMap !== undefined ? { coverageMap: options.coverageMap } : {}),
      ...(options?.perTestRun !== undefined ? { perTestRun: options.perTestRun } : {}),
      ...(typeof options?.substrateProbe === 'object' && options?.substrateProbe !== null
        ? { substrateProbe: options.substrateProbe as SubstrateProbe }
        : {}),
    }),
};
