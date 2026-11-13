/**
 * Formal Adapter contract (ADR-033 prep — Phase 7 task 11).
 *
 * WHY this module exists: ADR-033 turns the adapter boundary from a convention
 * into a compile-time contract. Until now the CLI imported one concrete
 * collector (`src/cli.ts` -> `./adapters/typescript/collector`) and nothing
 * forced a second language's adapter to look the same. This file is that
 * contract: the shape every per-language adapter module must satisfy.
 *
 * Layering: adapter -> core, never the reverse (ADR-012). This module imports
 * ONLY core types (`src/core/analysis`) and must never import `src/rules`,
 * `src/reporters`, `src/providers`, or any concrete adapter implementation.
 * The core therefore stays language-agnostic by construction, not by comment —
 * `src/core/evaluation.ts` never mentions `typescript` and never mentions an
 * adapter, and this contract keeps that true for the next language too.
 *
 * Placement note: ADR-033 §Decision 1 names `src/core/adapter.ts` as the
 * declaration site; the owner ruling behind this task moves the contract to
 * the adapter layer (`src/adapters/adapter.ts`). Reason: everything the
 * contract carries — framework allowlist, assertion forms, file extensions,
 * manifest signatures — is adapter-owned knowledge, and ruling #11 is explicit
 * that core knows zero frameworks. A contract living in core would put that
 * vocabulary one import away from the engine.
 *
 * Gap vocabulary (ADR-035 §Decision 2, ruling #16): the contract carries NO gap
 * kinds. Core owns the structural gap vocabulary (`CollectionStatus`,
 * `Availability`, `Provenance` — `src/core/evidence.ts`); adapters contribute
 * only a prose `reason` string beside an existing core enum. The core-facing
 * shape of a per-declaration gap today is `declaration_gap: string | null`
 * (`src/core/analysis.ts:102`). The adapter-local kind union (`DeclarationGap`,
 * `src/adapters/typescript/support.ts:717`) is a MIGRATION TARGET for Task 12+
 * / Phase 8 (a shared core-owned vocabulary) — it stays where it is; this
 * module documents the rule, it does not move the union.
 *
 * Declared-but-unconsumed fields (ADR-033 §Decision 1): `providerHints` is
 * declared now and consumed by nobody yet. It is declared so the contract
 * shape is settled before a second ecosystem needs it, not because anything
 * reads it today.
 *
 * Two names here differ from ADR-033's prose, by owner ruling rather than by
 * accident:
 *   - the field is `providerHints`, not `providerFormatHints` (ADR-033
 *     §Decision 1 prose) — the ruling names it `providerHints`;
 *   - `capabilities` carries the framework allowlist and the assertion-form
 *     list (ADR-033 §Decision 4 prose suggests `Record<string, CapabilityStatus>`)
 *     — ruling #11 puts framework vocabulary in the adapter, and core's own
 *     `AnalysisOutput.capabilities` (a `Record<string, CapabilityStatus>`,
 *     `src/core/analysis.ts:110`) already owns that other shape.
 *
 * This module is TYPE-ONLY: the `import type` below is deliberate. A contract
 * that emitted a runtime `require` of core would make the dependency visible
 * in the emitted JavaScript even though no value crosses the boundary.
 */

import type { AnalysisOutput, TestType } from '../core/analysis';

/**
 * What an adapter can recognize — adapter-owned by construction (ruling #11).
 *
 * The core holds no notion of 'jest' or 'expect-to-be'; these lists are the
 * only place such vocabulary is allowed to live, and they are data, not
 * behaviour (no adapter module evaluates rules).
 */
export interface AdapterCapabilities {
  /**
   * Framework allowlist. A framework outside this list is UNSUPPORTED, never a
   * guess: the conservative resolution is a stated reason, not a silent pass.
   */
  readonly frameworks: readonly string[];
  /**
   * Recognized assertion-form ids the adapter can count (e.g.
   * 'expect-to-be'). An assertion form outside this list is a declared gap.
   */
  readonly assertionForms: readonly string[];
}

/**
 * Per-call inputs to `collectAnalysis`.
 *
 * WHY an options object rather than a positional argument: the existing
 * TypeScript collector takes `(filePath, declaredType?)`
 * (`src/adapters/typescript/collector.ts`). A named bag keeps the contract
 * stable when the next adapter needs one more input — adding an optional
 * field to a bag does not change any call signature, while a third positional
 * parameter would. The TypeScript adapter maps this bag onto its current
 * positional parameter in Task 12: `options?.declaredType ?? TestType.UNKNOWN`,
 * which preserves today's behaviour exactly (UNKNOWN is the declared default,
 * and the type is never inferred — SPEC:450-458).
 */
export interface AdapterOptions {
  /**
   * Caller-declared test type. Never inferred by the adapter: an undeclared
   * type stays UNKNOWN so classification is explicit or absent, never guessed.
   */
  readonly declaredType?: TestType;

  /**
   * Test seam (Phase 8 C5 flake fix): overrides which native substrate module
   * resolves inside the python collector. Production callers never set it —
   * jest.mock('tree-sitter') under runInBand leaks a throwing factory across
   * suites, so substrate-failure tests inject this probe instead.
   */
  readonly substrateProbe?: unknown;

  /**
   * Path to a coverage report the ADAPTER may parse itself (lcov /
   * coverage.py JSON for the Python collector; D-20261112-5 Q1). Adapters
   * that do not consume it ignore this field — the TypeScript collector
   * takes none, and core providers still apply their own reports
   * post-analysis (src/cli.ts applyCoverageReport is unchanged).
   */
  readonly coverageReport?: string;
}

/**
 * The formal Adapter contract (ADR-033): a structural contract, not a class
 * hierarchy. An adapter is any object satisfying this shape — no base class, no
 * inheritance coupling the engine would have to understand.
 *
 * The descriptor fields are the metadata a dispatcher or a consumer needs to
 * reason about an adapter WITHOUT running it: which language it speaks, which
 * files it claims, which project manifests identify its ecosystem, what it can
 * recognize, and which external report formats its ecosystem produces.
 */
export interface Adapter {
  /**
   * Stable adapter id, e.g. 'typescript-jest-adapter' (the value ADR-035 will
   * carry in the report envelope as `adapter` from Phase 8 on). Stable across
   * versions: a consumer that matched on it must keep matching.
   */
  readonly id: string;
  /** Adapter module version, e.g. '0.1.0'. */
  readonly version: string;
  /**
   * Language id the adapter analyzes, e.g. 'typescript'. Coarse family tag;
   * the precise module identity is `id` above.
   */
  readonly language: string;
  /**
   * File extensions this adapter claims, e.g. ['.ts', '.tsx']. The extension
   * convention is the LOWEST-priority dispatch layer (ADR-034), used only when
   * neither an explicit flag nor a manifest signature resolves.
   */
  readonly extensions: readonly string[];
  /**
   * Project-manifest file names that identify this adapter's ecosystem, e.g.
   * 'pyproject.toml'. The manifest heuristic is the MIDDLE dispatch layer
   * (ADR-034): it reflects project structure the user did not override. An
   * empty list means the adapter claims no manifest signature.
   */
  readonly manifestSignatures: readonly string[];
  /** Framework allowlist and assertion-form list this adapter recognizes. */
  readonly capabilities: AdapterCapabilities;
  /**
   * Provider report-format ids the adapter's ecosystem produces, e.g.
   * ['istanbul', 'c8', 'stryker']. DECLARED BUT UNCONSUMED (ADR-033 §Decision 1):
   * nothing reads this field yet — it exists so the contract shape is settled
   * before a second ecosystem needs it, not because the engine consumes it.
   */
  readonly providerHints: readonly string[];
  /**
   * Collect normalized evidence for one test file.
   *
   * Returns the shared envelope (`AnalysisOutput`, `src/core/analysis.ts:106`)
   * built ONLY from core types — no AST node, no language-specific type
   * escapes the adapter (ADR-012). The caller owns the declared test type; the
   * adapter never infers it.
   */
  collectAnalysis(filePath: string, options?: AdapterOptions): AnalysisOutput;
}
