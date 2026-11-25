# Known Limitations (Milestone-1)

This document lists the intentional gaps in Milestone-1. Each is a documented known limitation, not a bug.

Report/verdict semantics live in [docs/evaluation-model.md](evaluation-model.md) and the authoritative [docs/product-contract.md](product-contract.md); the evaluation lifecycle and reporting map live in [docs/architecture.md](architecture.md). This page lists limitations only and does not restate their schemas.

---

## 1. No Control-Flow Analysis

The collector does not perform control-flow analysis (reachability, branch conditions, loop analysis, try/catch/finally). It only recognizes unestablished patterns per the straight-line definition (E):

- Assertion after an unconditional `return`/`throw` in the same block.
- Assertion inside a nested callback (arrow function, function expression, or function declaration nested in the test body).
- Assertion inside a control-flow construct (`if`/`else`, loop, `try`/`catch`/`finally`, `switch`, `do`, labeled statement).
- Assertion inside a modifier test declaration (`each`, `skip`, `only`, `todo`, `failing`, `concurrent`, `skipIf`, `runIf`, or unrecognized modifier).

Conditional returns (`if (x) return;`), early returns in nested blocks, `try/catch` around assertions, and labeled breaks are **not analyzed**. All such assertions are treated as established.

**Source:** `src/adapters/typescript/collector.ts:542-555` (`isControlFlow`), `src/adapters/typescript/collector.ts:492-540` (`scanTestBody` — the 5 straight-line rules), `docs/supported-syntax.md` (Straight-Line Body section).

---

## 2. No Cross-File Helper Resolution (A1)

Custom assertion helpers (e.g., `expectValidUser(id)`) are recognized by name pattern (`/^expect[A-Z_]/` or `/assert/i`) and reported as **unsupported forms** with reason `custom assertion helper is out of the declared test-body scope`. The helper body in another file is never read or analyzed.

**KickOff §4 handle-case #5 (helper implementation available in-scope):** This case — where the helper is defined in the same file and thus technically in scope — is **DEFERRED** under the A1 `test-body` scope decision. Milestone-1 does not analyze helper bodies even when they are in-file (fixture 4 `expectValidUser` is in-file yet recorded unsupported). A dedicated rule (`CT-INT-004`, SPEC:614-628) owns helper-resolution semantics in a future milestone.

**Milestone-5 note:** An in-file helper heuristic may be added (resolve helpers defined in the same file), but cross-file resolution remains out of scope for Milestone-1.

**Source:** `src/adapters/typescript/support.ts:67` (`CUSTOM_HELPER_NAME_PATTERNS`), `src/adapters/typescript/collector.ts:626-635` (`looksLikeCustomHelper` handling), `src/adapters/typescript/collector.ts:208` (`custom_helper_resolution: UNAVAILABLE`).

---

## 3. No Runtime I/O

The test file is **never executed**. No dynamic analysis, no test runs, no runtime values. `runtime_execution` capability is always `UNAVAILABLE`.

**Source:** `src/adapters/typescript/collector.ts:210` (`runtime_execution: UNAVAILABLE`), KickOff:194.

---

## 4. Supported Frameworks (Jest + Vitest) — Runtime Allowlist, Type-Only Skip, Derived Bare-Globals, Mixed→UNSUPPORTED

- Only **runtime** imports from `jest` or the 12 `@jest/*` subpaths in `JEST_RUNTIME_SPECIFIERS` (verified to ship runtime code) are accepted as Jest.
- Type-only imports (`import type ...` or all-type named imports) are ignored — they prove nothing about the runtime framework.
- **Bare-global derived fallback (P1.3).** When a file has **no** runtime framework import and **no** local binding of `it`/`test`/`describe`/`expect`, the collector reports `jest` for the bare-global test shape: at least one bare, **fully-supported** `it(...)`/`test(...)` call site **and** a bare `expect(...)` call. This is a **DERIVED** signal (`Provenance.DERIVED`), not a runtime observation — the collector publishes `framework_detection: PARTIAL` and names the inference in the `assertion_count` reason.
  - **Only the bare declaration form counts.** Modifier/chained declarations (`it.each(t)(...)`, `test.concurrent.only(...)`) do **not** trigger the fallback: their bodies are not scanned and are reported as unsupported-form gaps, so they must never be the reason a file is labelled `jest`.
  - **Bare globals cannot distinguish frameworks.** Jest, Mocha, Chai, Jasmine and Vitest share the same bare `describe`/`it`/`test`/`expect` globals, so a file derived as `jest` may actually run under Mocha or Chai. The label is an inference, not proof.
  - **Assertions are counted only when the matcher matches `SUPPORTED_ASSERTION_FORMS`.** A Chai-style `expect(x).to.equal(y)` is not a supported matcher → recorded as an unclassified construct → `PARTIAL` → `INDETERMINATE`, never a fabricated zero.
  - **`expect(` is required (anti-false-zero).** A file whose assertions live only in an unsupported API — supertest's fluent `.expect(200)`, chai, should — is left `UNKNOWN_FRAMEWORK`/`UNSUPPORTED`, so an assertion the collector cannot see is never read as a proved zero-assertion `FAIL` (case-30).
  - **An imported name suppresses the fallback.** `import { it } from 'mocha'` and `import type { it } from 'vitest'` bind the identifier locally, so neither call is a bare global — case-10 and case-26 stay `UNSUPPORTED`.
  - Still `UNKNOWN_FRAMEWORK`/`UNSUPPORTED`: a custom runner (`defineIntegrationTestSuite`), a setup/module file with no `it`/`test` declaration (e.g. `expect.extend` only), or a bare-declaration file with no bare `expect(`.
  - **Corollary (WP3.4 defect 3, corpus re-check 2026-10-23, revised by P1.3):** a teardown/globals file whose **only** vitest import is type-only reports `unknown` when that type-only import binds the test identifiers (`import type { it } from "vitest"`, case-26 — the binding makes `it` local). An earlier report expecting `framework: "vitest"` for such files was over-claiming. Without a bound identifier, a bare-global shape now takes the DERIVED `jest` fallback described above (e.g. a `import type { Mock } from "vitest"` file that also declares bare `it`/`expect`); it is no longer forced to `unknown`.
- Files importing two different frameworks (e.g., Jest + Vitest) → `MIXED_FRAMEWORK` → `UNSUPPORTED` (not first-wins).
- Mocha, Jasmine, Playwright Test, etc., imported explicitly are `UNSUPPORTED`. Vitest is supported (B1).

**Source:** `src/adapters/typescript/support.ts:19` (`SUPPORTED_FRAMEWORKS`), `src/adapters/typescript/support.ts:170` (`detectFrameworkDetail`), `src/adapters/typescript/support.ts:217` (`detectFramework`), `src/adapters/typescript/support.ts:138` (`BARE_GLOBAL_NAMES`), `src/adapters/typescript/support.ts:226` (`collectImportedNames`), `src/adapters/typescript/support.ts:253` (`isBareTestDeclarationCall`), `src/adapters/typescript/support.ts:265` (`isBareExpectCall`), `src/adapters/typescript/support.ts:191` (`isTypeOnlyImport`), `src/adapters/typescript/collector.ts:89` (`FRAMEWORK_DERIVED_REASON`), `src/adapters/typescript/collector.ts:194-197` (unsupported on non-Jest), `tests/fixtures/ct-int-001/case-10-unsupported-framework`, `tests/fixtures/ct-int-001/case-15-mixed-framework`, `tests/fixtures/ct-int-001/case-26-vitest-no-runtime-import`, `tests/fixtures/ct-int-001/case-29-bare-global-jest`, `tests/fixtures/ct-int-001/case-30-bare-global-without-expect`.

---

## 5. Computed Matchers → Partial Coverage

`expect(x)[matcher]()` where the matcher name is computed (variable, property access) cannot be resolved statically. The construct is recorded as an unclassified assertion → `CollectionStatus.PARTIAL` → `availability: UNKNOWN` → `INDETERMINATE`.

**Source:** `src/adapters/typescript/collector.ts:593-600` (element access on expect chain), `src/adapters/typescript/support.ts:397-399` (computed/element-access matchers return null in `classifyForm`).

---

## 6. `test.each` / `it.each` / `it.todo` — Literal Tables Counted, the Rest Reported (F)

An `each` table is **statically countable** when the table argument is an `ArrayExpression` whose elements are, recursively, primitive literals (string / number / boolean / null) or nested arrays of them — no spread, identifiers, calls, template literals or computed members (`literalTableRows`, `src/adapters/typescript/support.ts:821-845`). Such a declaration has **no gap**: its one shared callback runs once per row, so its established count is `rows x straight-line assertion count`, reported `KNOWN` / `COMPLETE`, with the file-level aggregate summing the same product across declarations. One `TestScopeResult` per declaration site is kept (an aggregate `xN` value, not one record per row), so the test id and report shapes are unchanged.

Everything else stays detected-but-not-analyzed:

- **Non-literal tables** (`it.each(rows)`, `it.each(makeRows())`, a spread, a template expression, a computed member) and the **tagged-template form** (``it.each`row ${n}` ``) keep the `unsupported-form` gap: the row count is not statically enumerable without executing the file. An **empty** literal table (`it.each([])`) is also not counted — jest rejects it and it runs nothing — and parentheses / negative numeric literals are not peeled.
- **Other modifier forms** (`skip`, `only`, `failing`, `concurrent`, `skipIf`, `runIf`, unrecognized, chained) and **non-inline bodies** (`it('name', helperFn)`) are unchanged: detected, reported as "not fully supported", never counted.
- A countable table whose callback body is **not straight-line** reports only its established assertions (multiplied by rows) under `PARTIAL` coverage — `availability: UNKNOWN`, never a fabricated `rows x 0`.

Assertions inside a gapped declaration are still not counted toward `assertion_count`. A declaration-only form (`it.todo`) does not degrade **file-level** coverage because its body provably does not exist; its own per-declaration record is still `UNAVAILABLE` / `availability: UNKNOWN` (see §11).

**Source:** `src/adapters/typescript/support.ts:821-839` (`literalTableRows` / `isLiteralTableCell`), `:841-851` (`eachTableArgument`), `:853-893` (`declarationSite` — gap + `rowCount`), `:530` (`TEST_DECLARATION_NAMES`), `:682-691` (`classifyTestDeclaration`), `src/adapters/typescript/collector.ts:556-569` (`findTestDeclarations`), `:313-322` + `:336` (file-level xN aggregate), `:400-504` (`testScopeResult` — per-declaration `value`/`availability`), `:506-540` (`coverageReason`).

---

## 7. Unsupported-Assertion Allowlist Heuristic

Only namespaces `assert`, `chai`, `should` are recognized as unsupported assertion APIs (recorded with reason). An unknown namespace like `customAssert.equal(x, y)` is **not detected** — the call is silently ignored (no evidence record created). This is a known gap: the allowlist is intentionally narrow to avoid false positives.

**Source:** `src/adapters/typescript/support.ts:57` (`UNSUPPORTED_ASSERTION_NAMESPACES`), `src/adapters/typescript/collector.ts:614-624` (namespace check).

---

## 8. Regex Stub Is a Stub (Fixture 13)

The conflicting-evidence fixture (case-13) uses a **regex-based stub provider** that counts `expect` calls inside comments. This is an intentional test-only mechanism to produce a deterministic conflict; it is not a general comment-analysis feature.

**Source:** Plan §4 row 13, `tests/integration/fixtures.test.ts` (fixture 13 setup).

---

## 9. No Cross-Test Flow Analysis

The collector and engine analyze each test declaration in isolation. No dataflow, control-flow, or state flow is tracked across test boundaries:

- A variable assigned in test A is not visible to test B
- A mock setup in test A does not carry to test B
- Shared `beforeEach`/`afterEach` hooks are not analyzed (out of declared `test-body` scope, A1)
- No test-order dependency detection

This is intentional: the declared scope is `test-body` only (A1), and per-test evidence isolation (A10) requires that a conflict on test A never alters test B's verdict.

**Source:** `src/adapters/typescript/collector.ts:683-701` (each `DeclarationSite` scanned independently), `src/core/evaluation.ts:147-172` (`evaluateTests` runs `decide` per scope independently), `docs/supported-syntax.md` (Per-Test Evidence Granularity section).

---

## 10. Per-Test Framework Detection Impossible

Framework detection is **file-scoped only** because ES module imports are at the module level, not per declaration. A file importing Jest + Vitest is `MIXED_FRAMEWORK` → `UNSUPPORTED` and emits **no per-test records** (a per-test PASS on an unsupported file would be the over-claim rejected in KickOff:108-109).

Per-test framework detection would require either:

- Runtime execution (out of scope, Milestone-1 §3)
- Static analysis of which framework's globals each test uses (heuristic, not deterministic)

**Source:** `src/adapters/typescript/support.ts:126-153` (`detectFramework` runs once per file), `src/adapters/typescript/collector.ts:172-175` (an unsupported framework returns an envelope with NO `tests` field at all — `collector.ts:283-307`), `src/reporters/json.ts:227` (the consequence: an absent `tests` field yields no per-test scope).

---

## 11. Unestablishable Declarations Never FAIL

The five declaration gap forms (`declaration-only` / `unresolved-body` / `unsupported-form` / `conditional` / `aliased`) each produce a per-test record with `availability: UNKNOWN` and **can never produce a FAIL verdict**:

- `declaration-only` (`it.todo`): no body exists → nothing to count → `availability: UNKNOWN` (no value recorded, coverage `UNAVAILABLE`) — a zero is never asserted, so no violation can be claimed
- `unresolved-body` (`it('name', helperFn)`): body is an identifier reference → `availability: UNKNOWN` → rule's `unknown_evidence_policy` (default INDETERMINATE)
- `unsupported-form` (`it.each` over a non-literal/tagged-template table, modifiers, chained):
- `conditional` (`(c ? it.skip : it)(...)`, WP3.4 defect 1): which declaration runs cannot be established statically → `availability: UNKNOWN` → `unknown_evidence_policy`
- `aliased` (`const t = it; t(...)`, WP3.4 defect 2): how the aliased declaration runs is not established at this analysis level → `availability: UNKNOWN` → `unknown_evidence_policy`

Conservative rule enforced in `evaluateRule` step 5 (availability guard): `availability !== KNOWN` → `unknown_evidence_policy` → INDETERMINATE. A zero count from an unestablishable body is **never** read as meaningful and turned into FAIL (SPEC:425 applied per test: "zero not meaningful unless COMPLETE+supported").

**Source:** `src/adapters/typescript/support.ts:853-893` (`declarationSite` gap classification), `src/adapters/typescript/support.ts:793-807` (`declarationGapReason`), `src/adapters/typescript/collector.ts:400-423` (gap → `PARTIAL`/`UNAVAILABLE` coverage mapping and the value/availability pair), `src/core/evaluation.ts:243-254` (step 5 availability guard), `docs/supported-syntax.md` (Five Declaration Gaps table).

**DPC-1 (resolved 2026-10-17, user decision "Align docs to code").** This section previously claimed `availability: KNOWN` for `declaration-only`. That was wrong for the per-declaration record: a gap forces `coverage.status: UNAVAILABLE` and leaves `value` undefined (`collector.ts:400-423`), so the declaration is `UNKNOWN`, never `KNOWN`-zero. Corrected above.

The **file-level aggregate** for a file whose only gaps are declaration-only does remain `COMPLETE`/`KNOWN` — a different scope, documented separately at `docs/supported-syntax.md:169` (table scope header at `:166`, scope note at `:164`). The two scopes do not necessarily agree; reading one as the other was the whole of DPC-1. `docs/supported-syntax.md` already stated both correctly and is unchanged.

---

## 12. Dynamically Constructed Declarations (WP3.4 correction, 2026-10-23)

**Status changed by WP3.4 (task 48).** This section previously said aliased declarations are "not detected" and can produce an unjustified FAIL. That silent drop is FIXED — conservatively, not by broadening support.

Detection is by **root identifier**: a call is a fully supported test declaration only when its callee peels down to the literal identifier `it` or `test` (`src/adapters/typescript/support.ts`, `classifyTestDeclaration`). Three previously-silent construct forms are now **reported with a declaration gap** (all are unsupported-form-class gaps: no value, `availability: UNKNOWN` → INDETERMINATE via `unknown_evidence_policy` — never FAIL):

```ts
// 1. Conditional declaration (WP3.4 defect 1; apollo-server
//    packages/server/src/__tests__/plugin/subscriptionCallback/index.test.ts:901).
//    Both branches resolvable OR only one branch resolving to a root:
(process.env.X ? it.skip : it)('maybe', () => {
  expect(1).toBe(1);
});
(c ? it : helper)('x', () => {
  expect(1).toBe(1);
});
//  -> gap 'conditional': which declaration runs cannot be established statically.

// 2. Compound callee via && / || (WP3.4 remediation). One or both operands
//    resolving to a test root:
(flag && it.skip)('y', () => {
  expect(1).toBe(1);
});
(cond || it)('z', () => {
  expect(1).toBe(1);
});
//  -> gap 'conditional': which operand runs cannot be established statically.

// 3. Verified in-file alias (WP3.4 defect 2, fixture case-21). `const` AND
//    `let` declarations are detected — the initializer is the same static
//    in-file evidence either way (e.g. `let t = it` reports identically):
const t = it; // alias verified statically in-file
t('dynamic', () => {
  expect(1).toBe(1);
});
//  -> gap 'aliased': the collector reports the declaration through the alias
//     without establishing how it runs.
```

The file-level aggregate no longer reads `COMPLETE`/`value 0`/`KNOWN` for such a file: the reported declaration is a capability gap (`isCapabilityGap`, `collector.ts`), so the file is `PARTIAL` with a reason and CT-INT-001 yields **INDETERMINATE**, not the unjustified FAIL described below.

**Still NOT detected (documented boundary, unchanged):**

- computed callees whose root is not statically a literal identifier — `it[prop]`, `obj[prop]()`, `getFn()()` — and member expressions rooted at a non-`it`/`test` identifier (`const s = it.skip` then `s(...)`, `const fat = it` only matches the exact `const x = it|test` form),
- reassignment without a declaration initializer (`let t; t = test` — the alias has no `= it|test` initializer at declaration time, so there is nothing static to verify),
- chained aliases (`const u = t`),
- aliased members (`const s = it.skip`),
- ternary/binary compound callees where NEITHER side resolves to a test root (e.g. `(c ? helper : other)(...)`) — silently dropped, no test-root evidence.

These have no static initializer evidence rooted at `it`/`test`, so they keep the old path (unreported). That conservatism is by design — the WP3.4 floor (`docs/Development_Roadmap.md:957-959`) forbids broadening syntax merely to clear INDETERMINATE results, and no new assertion form or execution model is claimed here: the 'aliased' and 'conditional' declarations carry the same `unsupported-form`-class gap evidence as `it.each`.

**Regression coverage:** `tests/adapters/collector.test.ts` (declaration boundary coverage describe: conditional + aliased + compound-callee tests, all red before the fix) and `tests/fixtures/ct-int-001/case-21-dynamic-declaration` (golden updated FAIL → INDETERMINATE, the contract correction) / `case-22-conditional-declaration` / `case-23-compound-callee` (new fixtures).

**Source:** `src/adapters/typescript/support.ts` (`collectTestAliases`, `classifyTestDeclaration` — conditional-callee and alias-map paths, `calleeCore` paren peel), `src/adapters/typescript/collector.ts` (`DeclarationGap` + `'conditional'`/`'aliased'` members, `declarationSite`, `declarationGapReason`, `isCapabilityGap`, body-scan gating), `src/core/evaluation.ts:243-254` (step 5 availability guard), `src/rules/ct-int-001.ts:65-70` (thresholds — unchanged).

---

## 13. Provenance Reachability Is Documented, Not Tested (DPC-3)

The evidence model distinguishes three provenance values (`src/core/evidence.ts:14-18`). Provenance identifies WHERE a value came from — not how certain it is.

| Provenance | Meaning                                                             | Reachable in Milestone-1                            | Producer                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DIRECT`   | value observed by the AST collector itself                          | YES                                                 | `src/adapters/typescript/collector.ts:267` (failed scan), `:294` (unsupported framework), `:336` (file-level aggregate record), `:408` (per-declaration record)    |
| `DERIVED`  | value derived from another signal (e.g., regex scan of source text) | YES — test stub only                                | `src/adapters/typescript/regex-assertion-count.ts:51`                                                                                                              |
| `EXTERNAL` | value from an external tool/provider (coverage, mutation, runtime)  | YES — file-level (and per-declaration for coverage) | `src/providers/coverage.ts:90,146,281,331` and `src/providers/mutation.ts:194,210,225,360` (file-level scope; coverage also per-declaration by line-range overlap) |

`DIRECT` is produced at 4 sites in `collector.ts`. `DERIVED` exists only as the fixture-13 regex stub (`regex-assertion-count.ts`); no `src/` module imports it. `EXTERNAL` is produced by the coverage provider (`src/providers/coverage.ts`, §14) and the mutation provider (`src/providers/mutation.ts`, §19); both attach file-level records, and coverage additionally attaches per-declaration records by line-range overlap with a declaration `location`.

**Consequence:** reachability is documented here, not asserted by a test. No fake producer is built to make `EXTERNAL` reachable (DPC-3, closed). `EXTERNAL` provenance fields are added in WP4.1 task 56a (optional `provider`, `provider_version`, `source_revision`), present only when `provenance === EXTERNAL`; real producers exist as of §14 (coverage) and §19 (mutation). §13 and §14 no longer contradict: §13 states provenance-level reachability (EXTERNAL reachable today via those providers, file-level scope with an additional per-declaration pass for coverage), and §14/§19 describe provider behavior. Missing/unreadable/malformed/stale reports yield explicit UNKNOWN records with a reason rather than zero (§14, §19).

**Source:** `src/core/evidence.ts:14-18` (enum), `src/adapters/typescript/collector.ts:267/294/336/408` (DIRECT producers), `src/adapters/typescript/regex-assertion-count.ts:51` (DERIVED producer), `src/providers/coverage.ts:343-369` (`applyCoverageReport`, per-declaration attribution at `coverage.ts:308-341`), `src/providers/mutation.ts:378-399` (`applyMutationReport`, file-level only).

---

## 14. External Coverage Provider (WP4.1 task 56b)

`EvidenceRecord` carries optional provenance fields `provider`, `provider_version`, and `source_revision`, meaningful only when `provenance === EXTERNAL`. A producer now exists: `src/providers/coverage.ts` (`parseCoverageReport`) reads an Istanbul (primary) or c8 (secondary) JSON report from disk and emits `line_coverage` records with `provenance: EXTERNAL` plus provider identity/version/revision. File-level coverage attaches to `AnalysisOutput.evidence`; per-declaration coverage is attributed by line-range overlap with declaration locations and attaches to `TestScopeResult.evidence`; these records now carry `location` { file, line } naming the test file and declaration line (advisory records for mapped coverage stay location-less).

Missing/unreadable/malformed/unsupported reports do NOT crash and never read as zero coverage: they yield empty records or explicit UNKNOWN records with a reason. A stale or mismatched `source_revision` versus the analyzed revision yields UNKNOWN records (reason records the mismatch) instead of a definitive result. External evidence is opt-in via `--coverage-report <path>`; with no flag, existing rules behave exactly as before.

Historical (superseded): CT-COV-001 (`src/rules/ct-cov-001.ts`) consumed `line_coverage` evidence and was registered with `status: 'draft'` (ADR-030). Activated 2026-11-07 by ADR-031: `status: 'active'` (`src/rules/ct-cov-001.ts:29`). Active semantics: when coverage is explicitly mapped via `--coverage-map <from>=<to>` (repeatable CLI flag, `src/cli.ts:92/227-233`), the rule evaluates the mapped production file only — subject-level value = `countCoveredLines(mappedFile)` when evidence is `KNOWN`+`COMPLETE` → `PASS` if `>= 1`, `FAIL` if `<= 0`; per-declaration records are advisory (reason: "per-declaration attribution not supported for mapped coverage") and yield `INDETERMINATE`. Without a mapping, unmapped exact-match subject records stay the raw line array (not thresholdable at subject level) → `INDETERMINATE`. Missing / non-`COMPLETE` evidence → `INDETERMINATE`. A missing report produces an `UNKNOWN` record and therefore `INDETERMINATE`, never `FAIL`. Existing rules that do not require `line_coverage` (including CT-INT-001) are unaffected and keep their normal verdicts. See decision record 030 (draft rules produce no verdicts; amended by ADR-031) and ADR-031 (CT-COV-001: active-file-level mapped coverage semantics).

Setup: run your coverage tool to produce a JSON report (Istanbul-style `{ "covered": { "/abs/file.js": [null|1, ...] } }`), then invoke `checktest --test <file> --coverage-report <report.json> [--coverage-map <from>=<to>]`.

**Mapping limitations (user-asserted linkage, not per-test causality):**

- Mapping is a user-declared assertion that `<from>` (the analyzed test-file path) corresponds to `<to>` (the production file exercised by some test run); it does not establish which declaration caused coverage or prove any causal link between a specific test body and the covered lines.
- File-level PASS/FAIL is driven solely by the mapped production file's covered-line count; per-declaration attribution remains advisory only — every declaration record carries the same mapped-file result plus a reason marking it non-attributed.
- If no `--coverage-map` flags the tested file, the subject-level record stays the raw line array; CT-COV-001 cannot threshold that and returns `INDETERMINATE` (no verdict). The rule therefore requires an explicit mapping to emit anything other than INDETERMINATE.
- ADR-031 rollback criterion: if mapped verdicts prove unsound in corpus runs, set `status: 'deprecated'` (registry supports it) rather than reverting to draft.

**Per-test-run mode (opt-in, ADR-032):** a coverage report can be attested as a single-test-file run via the opt-in `--per-test-run` flag (`CoverageReportOptions.per_test_run`, parsed at the CLI/config layer). The claim stays file-level; with mapping + `KNOWN` + `COMPLETE` + explicit source revision, per-declaration records become numeric under the claim "the mapped production file was exercised in the run of this test file". A mapped-pair contradiction (unrelated report entries `PARTIAL`) only prepends a `veto-WARN:` reason and never gates the verdict. Revision-less reports stay `INDETERMINATE`; per-test-run numeric attribution is reached via explicit source-revision declaration / programmatic corpus harness.

**Python mapped coverage (ADR-038, shipped):** the Python adapter applies the same mapped-coverage semantics for `--coverage-report` + `--coverage-map` (coverage.py JSON / lcov) as the TypeScript provider — the claim is file-level evidence linkage, not per-test causality. Mapped semantics are numeric only when the mapping is present with `KNOWN`+`COMPLETE` evidence and `--per-test-run` attestation; without `--per-test-run`, mapped declarations stay `INDETERMINATE`. Reason strings (verbatim, `src/adapters/python/collector.ts`): `coverage evidence mapped to <to>`, `no coverage data for <to>`, `coverage map supplied without --per-test-run attestation; mapped semantics not applied`, `coverage evidence from a run scoped to <testFile>`. See [coverage provider landscape](providers/coverage-provider-landscape.md) for per-test attribution and format-parser ownership.

**Source:** `src/providers/coverage.ts`, `src/cli.ts` (`--coverage-report`), `src/core/evidence.ts` (EvidenceRecord), `src/reporters/json.ts`.

### 14.1 `--source-revision <rev>` — explicit coverage-report revision declaration (1.6.0)

The `--source-revision <rev>` CLI flag (and the top-level `sourceRevision` config key) lets a caller declare the revision a coverage report was produced against. The declaration flows to the coverage provider as `source_revision` and is compared against the analyzed revision (git HEAD, injected unchanged as `analyzedRevision`); precedence is `declaredRevision = options.sourceRevision ?? options.config?.sourceRevision` at `src/cli.ts`.

- **Mapped pair, declared revision == analyzed revision**: freshness is **KNOWN** (evidence `availability: KNOWN`, `source_revision` echoes the declared rev). This is the only path that yields a definitive coverage freshness result. [`tests/cli-source-revision.test.ts` case A]
- **Declared revision != analyzed revision**: the pre-existing mismatch path is unchanged → `UNAVAILABLE`/`UNKNOWN` with a reason recording the mismatch; verdict `INDETERMINATE`. [`case C`]
- **Revision-less (no `--source-revision`, no config `sourceRevision`)**: stays **INDETERMINATE** via the `keep_guard`. The jev ruling `jev/record/ct-cov-revision-2026-11-10.md` (Decider confirmed 2026-11-10, confidence 0.67) adopted `keep_guard`; revision-less reports remain `UNAVAILABLE`/`UNKNOWN` and never yield a KNOWN freshness claim. [`case B`]
- **`sourceRevision` in `--config`**: this is an **input selection**, not evidence semantics (§21 discipline). It feeds the same provider input as the CLI flag; precedence is CLI flag > config `sourceRevision` > auto-detect-HEAD (`analyzedRevision` injection, unchanged). Config `sourceRevision` does not relax any evidence guard and cannot manufacture a KNOWN claim. [`case D`, `case D2`]
- **No coverage evidence**: the flag is inert — output identical to a no-flag run; `source_revision` is not emitted. [`case E`]

**Source:** `src/cli.ts` (`--source-revision` parse + `declaredRevision` precedence in `runAnalysis`), `src/core/config.ts` (`CheckTestConfig.sourceRevision` field + parse validation), `tests/cli-source-revision.test.ts` (cases A–E), `jev/record/ct-cov-revision-2026-11-10.md` (keep_guard ruling), `docs/Development_Roadmap.md:1213-1215` (config-cannot-override-evidence constraints), `docs/limitations.md §21` (evidence semantics immutable).

---

## 15. Dist-freshness rule (2026-10-29)

Every corpus/CLI run (tasks A5, B3, B9) MUST run `npm run build` first.
Stale `dist/` caused silent pre-fix results (WP3.5 §4 rank 4). The build output is the
oracle for corpus analyses, CLI runs and gate artifacts; verify with `npm run build` exit 0 before each such run.

---

## 16. Gate base semantics (2026-10-31; updated 2026-11-01 for checkchange 0.5.0)

checkchange gate evaluates branch deltas vs `--base`. A clean master has no
delta, so `gate: NOT_EVALUATED` with `changedFunctions: []` is correct semantics
and `exit 0` (oracle: `npm run gate` raw JSON excerpt — "gate": "NOT_EVALUATED",
"changedFunctions": [], exit 0 on master). The WARN-blocks-merge invariant applies
at merge time, not on master. No delta means no changed functions to gate against.

Update (checkchange 0.5.0, verified 2026-11-01): docs-only diffs now report
`analysisStatus: "UNSUPPORTED"` with `gateReason: "no-supported-file-extensions"`
and `completeness: "INCOMPLETE"` alongside `gate: NOT_EVALUATED` — the reason is
now explicit instead of implicit. Exit code remains 0; semantics unchanged.

## Rule finding locations (B7 prerequisite, 2026-11-01)

`RuleFinding` (and the serialized `ruleResults[]` entries) now carry an optional
`location: { file, line, column? }` copied from the evidence record that produced
the verdict, appended last in construction order. It is present only when that
record has a location; it is never fabricated. Line-only precision remains: no
producer currently populates `column`. Unsupported/failed subjects and coverage
records still provide file-level identity at best. This directly addresses the
WP4.3 audit's first gap (rule findings had no direct location).

## 17. SARIF output (WP4.3, B7, 2026-11-01)

`--format sarif` emits a SARIF 2.1.0 log (`src/reporters/sarif.ts`); `--format
json` remains the default and is byte-unchanged. Known limitations of the SARIF
output:

- **Locations are line-only, and a test-scoped result carries its TEST's position.**
  A result that belongs to a test declares that test in `results[].properties.testId`
  and reports the location the test id encodes
  (`<file>#<declaration>@<line>:<index>` -> `artifactLocation.uri` = the file,
  `region.startLine` = the declaration line), so a SARIF consumer can attribute
  the verdict to the exact declaration (phase 9 package 4, task 4.4). A
  subject-level result (no test) keeps the finding's own source location (the
  evidence record that produced the verdict has one — e.g. an assertion-bearing
  test) and gets NO `locations` key when it has none; no position is fabricated.
  `column` is never populated by any producer, so `region.startColumn` is
  effectively absent.
- **Coverage records lack a location in SARIF output.** The SARIF reporter
  (`src/reporters/sarif.ts`) does not serialize evidence records, so coverage
  evidence carries no `location` there. JSON output now carries `location` on
  provider per-declaration records (file-level records stay keyed by file, with
  no `location`).
- **UNSUPPORTED/FAILED are diagnostics, not findings.** An UNSUPPORTED or FAILED
  analysis state is recorded at `runs[0].properties`
  (`analysisStatus`/`evaluationStatus`/`completeness`), never emitted as a
  synthetic SARIF result (roadmap task 5). A FAILED analysis yields an empty
  `results[]`; an UNSUPPORTED analysis keeps its genuine INDETERMINATE rule
  finding, which is a real verdict, not a stand-in for the state.
- **Severity is not conflated with result.** `level` is derived from the rule
  RESULT alone via the documented table (FAIL→`warning`, INDETERMINATE→`note`,
  PASS/N/A→`none`). SARIF 2.1.0 has no `info` level, so an INDETERMINATE verdict
  maps to `note` rather than an out-of-enum value. The rule's own declared
  severity is recorded separately at
  `runs[0].tool.driver.rules[].properties.severity`, and the raw result at
  `results[].properties.result`.
- **Validation is structural, not full-schema.** Tests assert the SARIF 2.1.0
  required keys and the pinned shape (top required `version`+`runs`; result
  required `message`; `level` in the schema enum). No external SARIF validator
  is a dependency, so a full JSON-schema validation is not performed in-repo.

- **JSON↔SARIF field asymmetry is intentional.** JSON is the envelope format: per-test records live in `testResults[]` (`src/reporters/json.ts:294`, `:354-355`) with the aggregate `summary` (`:227`, `:355`), and every `ruleResults[]` entry carries `ruleStatus` (`src/reporters/json.ts:133-138`); JSON has no rule descriptor. SARIF has no `testResults[]`: findings are `runs[0].results[]`, the test id rides at `results[].properties.testId` (`src/reporters/sarif.ts:135-147`), and rule lifecycle status lives on the rule descriptor at `runs[0].tool.driver.rules[].properties.status` (`:161-178`, with `deprecatedSince` there when present). Analysis/evaluation state is top-level in JSON (`src/reporters/json.ts:10-17`) but `runs[0].properties` in SARIF (`src/reporters/sarif.ts:24-28`). Both formats DO serialize `evidenceStrength` today: JSON on evidence records and on findings, SARIF on result properties (§24.4).

A representative byte-exact golden lives at
`tests/reporters/fixtures/case-24.sarif.json` (generated from the real collector
over case-24); the fixture root is normalized to `<fixture-root>` so the golden is
machine-portable.

B8 (2026-11-01) extends this to FULL-FILE byte-exact regression goldens for BOTH
formats, driven by the real CLI. `tests/integration/goldens.test.ts` spawns
`node dist/src/cli.js` over three pinned cases — PASS (case-24-vitest-standard),
FAIL (case-27-k15-describe-fail, the K-15 describe-wrapped zero-assertion shape)
and INDETERMINATE (case-25-vitest-aliased) — and asserts exact string equality
(never a deep compare) against `tests/reporters/fixtures/{case-24,k15-fail,case-25}
{,.sarif}.json`. Each case is run twice to re-assert determinism. The
`sample.expected.json` sidecars under `tests/fixtures/ct-int-001/` stay a PROJECTED
SUBSET (DPC-5); the goldens are the full-file regression layer that a schema change
can no longer slip past. `dist/` is gitignored, so the suite builds the CLI in
`beforeAll`.

- **Multi-rule runs are first-rule-only in SARIF.** Repeating `--rule` makes the JSON
  report gain an additive `rules` array (one `{ rule, ruleResults, summary }` entry per
  named rule) while its top-level `ruleResults`/`summary` mirror the **first named rule**
  — not an aggregate across rules. SARIF has no `rules` equivalent: a multi-rule run
  serializes the first named rule's evaluation only. Single-file scope only (one
  `--test`); multi-file is deferred.

## 18. Global `vi.*` Is a Heuristic Vitest Signal (Option A, 2026-11-02)

Vitest's `globals: true` config exposes `vi` on the global scope, so a globals-enabled
test file can call `vi.fn()`, `vi.mock()`, etc. with **no** `vitest` import. To avoid
reporting those files as `UNKNOWN_FRAMEWORK` → `UNSUPPORTED`, `detectFramework` now
treats a member call `vi.<name>(...)` on the **bare identifier** `vi` as a Vitest
runtime signal.

This is a documented heuristic, not proof:

- It only fires for the exact receiver identifier `vi`. `obj.vi.fn()` (a property),
  `myvi.fn()` (a longer identifier) and `vi()` (a non-member call) do **not** count.
- It cannot tell the Vitest global from an unrelated in-file `const vi = ...` that
  happens to expose the same member names. A file that does that is misreported as
  Vitest. Milestone-1 accepts this because it is the same class of syntactic evidence
  the collector already relies on (it never executes the file).
- A Vitest file that imports **nothing** and uses **no** `vi.*` call still reports
  `UNKNOWN_FRAMEWORK` → `UNSUPPORTED`. There is no other runtime evidence to detect.
- A Jest import plus `vi.*` usage reports `MIXED_FRAMEWORK` (two frameworks), not
  first-wins.

**Source:** `src/adapters/typescript/support.ts:137` (`detectFramework`),
`src/adapters/typescript/support.ts:176` (`isGlobalViMemberCall`),
`tests/adapters/support.test.ts` (detectFramework `vi` cases),
`tests/fixtures/ct-int-001/case-28-global-vi` (fixture 28).

## 19. External Mutation Provider — Parse-Only, File-Level (P2.3, 2026-11-02)

`src/providers/mutation.ts` (`parseMutationReport` / `applyMutationReport`) reads a
**Stryker** mutation-testing report (schema v1/v2) from disk and emits file-level
`mutation_score` records with `provenance: EXTERNAL` plus `provider`,
`provider_version` and `source_revision`. It is **parse-only**: it never runs Stryker
and never rebuilds a mutation engine (roadmap `docs/Development_Roadmap.md:1085`).

Known limitations:

- **No declaration attribution.** A Stryker report keys mutants by source file and
  says nothing about individual test declarations. Mutation evidence is therefore
  attached only to `AnalysisOutput.evidence`; no `TestScopeResult` is decorated
  (roadmap:1086 "Do not assume file-level evidence is test-level evidence").
- **File-level surfacing in `ruleResults`.** The file-level CT-MUT-001 verdict
  appears in `ruleResults` as an entry with no `test_id` and is counted in
  `summary.total`; mutation evidence stays file-level (no per-declaration
  attribution — see the bullet above). This raises `summary.total` by 1 on
  mutation-report runs.
- **CT-MUT-001 now consumes `mutation_score`.** `src/rules/ct-mut-001.ts` declares `required_evidence: ['mutation_score']` with a fixed `MUTATION_THRESHOLD = 0.5` (user ruling 2026-11-07). A supplied report triggers PASS/FAIL/INDETERMINATE — not just an additive record. Missing / unreadable / malformed / zero-valid / revision-mismatched reports yield UNKNOWN → INDETERMINATE (never FAIL; "no report ≠ zero mutants", roadmap:1087) and are documented fully at `docs/rules/ct-mut-001-contract.md`.
- **Missing ≠ zero.** A missing, unreadable, malformed, or unsupported report (no
  `files` key, wrong/absent `schemaVersion`) yields an explicit `UNKNOWN` record with
  a reason. It is never read as a mutation score of zero (roadmap:1087).
- **Stale ≠ definitive.** A report whose `source_revision` disagrees with the analysed
  revision yields `UNKNOWN` records carrying the mismatch reason instead of a
  definitive score (roadmap:1088).
- **Legacy revision keys (provider-API surface only).** `parseMutationReport` resolves
  the report revision via a `pick()` chain that also reads the legacy option keys
  `source_revision`, `sourceRevision` and `revision` (`src/providers/mutation.ts:268-269`).
  A library caller who omits `mutationSourceRevision` but supplies one of these keys
  gets it used as the report revision; if it happens to equal `analyzedRevision` the
  freshness check treats the report as revision-matched (KNOWN score, decided verdict),
  weakening the missing-vs-mismatch distinction **on that API path only**
  (owner ruling D6, 2026-11-18: keys kept as documented surface with this caveat).
  Not reachable via the CLI: `src/cli.ts:804-810` forwards only `analyzedRevision`,
  `coverageMap`, and the explicit `--mutation-source-revision` flag.
- **Score is emitted only when honest.** The score follows Stryker's metric:
  `detected = Killed + Timeout`, `valid = detected + Survived + NoCoverage`,
  `score = detected / valid`. `CompileError`, `RuntimeError`, `Ignored` and `Pending`
  are excluded. A file with zero valid mutants (or an unrecognized mutant status)
  yields `UNKNOWN`, never a fabricated score.
- **Schema tolerance.** `schemaVersion` must be `1`, `2`, or a dotted sub-version
  (`2.0`, `2.0.0`). The core `files[].mutants[]` shape is identical across v1 and v2.

Setup: run Stryker with a JSON reporter, then invoke
`checktest --test <file> --mutation-report <mutation.json>`.

**Source:** `src/providers/mutation.ts`, `src/cli.ts` (`--mutation-report`),
`tests/providers/mutation.test.ts`, `.opencode/progress/reports/WP4.6-mutation-schema.md`.

---

## 20. Pending/skipped declarations and no-tests behavior

- There is **no** `PENDING` or `SKIPPED` status enum. `it.todo` and `it.skip` are reported as declaration gaps via the `declaration_gap` string (`declarationGapReason` at `src/adapters/typescript/support.ts:709`, attached in `src/adapters/typescript/collector.ts:406`), with `availability: UNKNOWN` and coverage `UNAVAILABLE`; they never produce a FAIL verdict.
- **No-tests behavior** (a file with zero recognized declarations, e.g. `case-18-no-tests`): `analysisStatus` stays `SUCCESS` (the analysis itself completed), `evaluationStatus` is `FAILED`, `ruleResults`/`testResults` stay empty, CLI exits `2`. Source: `src/cli.ts:856` (`const exitCode = scopes.some(...) ? 0 : 2`), contract pinned in `tests/cli.test.ts:259-282`. Exit `2` is the single "no verdict" bucket; exit `0` means at least one scope reached `EVALUATED`; exit `1` stays reserved for usage errors/crashes.
- **Exported test functions with no `it`/`test` call site** (`case-36-vitest-exported-test-fn`): a file whose only test-like code is an exported function body (not wrapped in `it`/`test`) has zero recognized declarations. The collector reports `assertion_count: 0` with `availability: KNOWN` and `coverage_status: COMPLETE` (no declarations to be incomplete about). CT-INT-001's `minimum_evidence_completeness: COMPLETE` admits the result, and the numeric threshold `assertion_count > 0` yields **FAIL**. This is the same outcome as any file with zero assertions in supported declarations — not a vitest-specific gap.
- **`expect(...).not.*` negation** (`case-37-vitest-not-to-throw`; supported since 2026-11-22): a literal `.not` whose receiver is a direct `expect(...)` call maps through `ASSERTION_NEGATED_FORM_BY_MATCHER` to one of 6 negated forms (`expect-not-to-be` / `-to-contain` / `-to-have-property` / `-to-be-null` / `-to-throw` / `-to-have-been-called`), so `expect(() => {}).not.toThrow()` counts as an established assertion → `COMPLETE` → **PASS**. Only a computed `.not` (`expect(x).not[m]()`) or async negation (`expect(p).rejects.not.<matcher>()`) stays `UNKNOWN` → **INDETERMINATE** (§5).
- **Vitest-only matchers** (`case-38-vitest-matchers`): matchers that exist in Vitest but not in the Jest allowlist — `toBeCloseTo` (and, before 2026-11-22, `toHaveLength` / `toBeGreaterThan`) — are not in `SUPPORTED_ASSERTION_FORMS` and produce an unsupported-form record → `PARTIAL` → `UNKNOWN` → **INDETERMINATE**, same treatment as computed matchers (§5) or Chai-style matchers (§7). `toHaveLength` and `toBeGreaterThan` became supported on 2026-11-22, so case-38 now yields `assertion_count: 2` with `coverage_status: PARTIAL` (only `toBeCloseTo` unresolved) → still **INDETERMINATE**.

**Source:** `tests/fixtures/ct-int-001/case-36-vitest-exported-test-fn`, `case-37-vitest-not-to-throw`, `case-38-vitest-matchers`; `src/adapters/typescript/capabilities.ts:25-54` (`SUPPORTED_ASSERTION_FORMS`); `src/adapters/typescript/collector.ts:593-600` (unsupported matcher path).

---

## 21. Configuration layer (--config) — explicit-path-only, evidence semantics immutable

- **Schema**: `checktest.config.json` carries a single top-level key `rules` whose value is an object keyed by rule ID; each entry permits exactly three override keys — `enabled` (boolean), `thresholds` (object with optional `passAtLeast` / `failAtMost`, finite numbers, must satisfy `passAtLeast > failAtMost`), and `severity` (`'error' | 'warning' | 'info'`). Unknown top-level keys or unknown per-rule keys are rejected at parse time as `UsageError`. Source: `src/core/config.ts:35-41` (`parseConfig`), `:61-68` (`readRulesSection`), `:70-97` (`parseAllRules` + `parseRuleOverride`), `:114-119` (`parseSeverity`), `:121-135` (`parseThresholds` + ordering guard). Immutability test: `tests/core/config.test.ts` — `applyConfigToRule` copies `evaluation` but never touches `unknown_evidence_policy` / `conflicting_evidence_policy` (`src/rules/registry.ts:POLICY_FIELDS`), so evidence semantics cannot be reconfigured.
- **Explicit-path-only**: no implicit discovery — config file is read only when `--config <path>` is given on the CLI (`src/cli.ts:210-217`). The flag stores the path into `options.config`; `loadConfig(path, knownRuleIds)` throws `UsageError` on missing/unreadable file (`config.ts:162-170`). No other resolution strategy (cwd, home, etc.) exists.
- **Per-rule overrides limited to enabled / thresholds / severity ONLY**: `validateOverrideKeys` at `config.ts:99-105` rejects any key outside `['enabled', 'thresholds', 'severity']`. Evidence fields (`unknown_evidence_policy`, `conflicting_evidence_policy`) are structurally inaccessible via config. Thresholds cannot manufacture evidence — they adjust numeric cut-points only; INDETERMINATE on incomplete evidence remains fail-closed. Source: `roadmap:1213-1215` constraint enforced by `applyConfigToRule` structural copy (config.ts:172-213).
- **Evidence semantics NEVER configurable**: roadmap constraints (do not let configuration override evidence semantics; do not make severity automatically determine exit status without an explicit policy) are hard-coded in the apply path — `applyConfigToRule` returns `{ ...rule, evaluation: { ...rule.evaluation, pass_at_least, fail_at_most }, severity }` and never touches `evaluation.unknown_evidence_policy` / `evaluation.conflicting_evidence_policy` (`src/rules/registry.ts:POLICY_FIELDS`). Per-declaration INDETERMINATE on PARTIAL coverage, missing ≠ zero, and unsupported-form handling are unchanged by config.
- **Exit codes unchanged**: no `--ci` flag introduced; severity values do NOT drive exit codes (exit 0 = evaluated, 1 = usage error/crash, 2 = no-verdict bucket remain as-is). This was explicitly scoped out by D-20261107-4 (OpenChamber choice card ruling).
- **Thresholds rejected on local-decision rules**: config now REJECTS `thresholds` on local-decision rules (CT-COV-001, CT-MUT-001, CT-INT-003, CT-INT-004) at parse time (`src/core/config.ts:108-109`): `invalid --config: 'thresholds' is not configurable for local-decision rule '${ruleId}'`. Local-decision hooks bypass generic threshold evaluation, so user-supplied thresholds are refused rather than accepted inertly. **Historical note (superseded):** before this rejection, thresholds could land structurally but were inert at runtime for the then-covered local-decision rules; the contract comments in `ct-mut-001.ts` and `ct-cov-001.ts` record that earlier posture.
- **Validation-before-analysis**: `loadConfig` runs before `collectAnalysis` (`src/cli.ts:211,632,655` — `main()` parses flags, loads config if present, THEN dispatches `runAnalysis`). Usage errors abort before any analysis work starts, keeping the failure mode deterministic and documented as exit 1.
- **Corpus behavior unchanged**: full corpus re-run against 14 repos post-SP4 (2026-11-07) produced identical aggregates to SP1 baseline — SUCCESS 10 / UNSUPPORTED 3 / FAILED 1. No delta; config layer is orthogonal to framework detection and declaration collection. See ledger row below.

**Source:** `src/core/config.ts` (full module, task 18), `src/cli.ts:210-217,632,655` (--config wiring + main() load-gate), `src/rules/registry.ts:POLICY_FIELDS` (immutability anchor), `src/rules/ct-mut-001.ts:local_decision` (inert-thresholds note), `src/rules/ct-cov-001.ts:29-34` (activation semantics), `docs/Development_Roadmap.md:1213-1215` (constraints), `.opencode/progress/DECISIONS.md:D-20261107-4` (explicit-path-only + no--ci ruling).

---

## 22. Mocha-class bare-global derivation (P2, SP2)

- **Derivation rule**: A file with bare `describe`/`it`/`test` declarations and/or bare `expect()` calls — no framework import and no local binding of those identifiers — is treated as a **mocha-class DERIVED signal**. This is not a runtime observation; mocha, chai, jasmine, ava, and jest all expose these globals, so the shape alone cannot distinguish among them. The same honesty frame applies as §18's global-vi note (vitest globals-only heuristic — inferred, not observed).
- **Jest keeps its own derivation**: Files with a bare declaration **plus** a bare `expect(...)` call keep the existing jest derivation (`Provenance.DERIVED`, `framework_detection: PARTIAL`) because the 44 supported assertion forms are Jest/Vitest-specific matchers. Without `expect(`, only the mocha-class derivation fires.
- **Imported bindings block both derivations**: An explicit import such as `import { describe } from 'mocha'` or `import { expect } from 'vitest'` makes the identifier local, not global — neither derivation applies, and the file falls through to the standard framework-import detection path.
- **Supertest chains now classified (SP3)**: mocha-derived files whose assertions are supertest fluent chains (`.expect(status)` / `.expect(status, body, …)`) are now classified as `supertest-expect-status` / `supertest-expect-body` and counted toward `assertion_count` (fixture `case-40-supertest-chains`: 2 assertions, `COMPLETE`/`KNOWN`/`PASS`; corpus: `checktest-corpus/express/test/res.sendStatus.js:17,29,41` (clone of expressjs/express). The earlier 'report zero' under-count no longer applies to these forms.
- **Remaining unclassified fluent-chain APIs**: chai `expect(x).to.equal(y)`, should.js `.should.equal(...)`, node `assert.*` remain explicit-unsupported — their namespaces are in `UNSUPPORTED_ASSERTION_NAMESPACES` (`support.ts:67`, unchanged). Such chains land in the unsupported reporting path (`collector.ts:675` expect-rooted unsupported matcher; `:682` namespace check) → `PARTIAL` → `UNKNOWN` → `INDETERMINATE`: never a silent drop and never a fabricated zero. See [Supported Syntax — Supertest HTTP Assertion Chains](./supported-syntax.md#supertest-http-assertion-chains-sp3-2026-11-09).
- **Cross-reference**: Full behaviour table and source pointers are in [Supported Syntax — Framework Detection](./supported-syntax.md#framework-detection).

**Source:** `src/adapters/typescript/support.ts:176` (`detectFrameworkDetail`), `src/adapters/typescript/support.ts:229` (`detectFramework`), `src/adapters/typescript/collector.ts:98` (`FRAMEWORK_DERIVED_REASON`), `src/adapters/typescript/support.ts:346-378` (supertest forms + classifyForm branch), `src/adapters/typescript/collector.ts:671-680` / `:682-690` (unsupported reporting path), `tests/fixtures/ct-int-001/case-28-global-vi` (fixture 28, parity note), `tests/fixtures/ct-int-001/case-29-bare-global-jest` (fixture 29, jest-keeps-derivation), `tests/fixtures/ct-int-001/case-30-bare-global-without-expect/sample.test.ts:13` (fixture 30, mocha-class derivation trigger), `tests/fixtures/ct-int-001/case-40-supertest-chains` (SP3 supertest chains), `checktest-corpus/express/test/res.sendStatus.js:17,29,41` (corpus evidence: supertest `.expect(…)` chains now classified).

---

## 23. Python/pytest adapter (Phase 8) — native tree-sitter primary, earned stdlib-ast fallback; mutation_score always UNKNOWN

- **Substrate: native tree-sitter primary, earned python3 stdlib-ast fallback.** Native tree-sitter (`tree-sitter` + `tree-sitter-python`, optionalDependencies) is the primary substrate, loaded lazily inside a guarded `require` (`src/adapters/python/collector.ts:257-294`). When the native modules are absent or fail to load, the collector spawns `python3 -c <AST_SCRIPT> <file>` and parses the module with the stdlib `ast` module — the earned fallback (`parseWithPythonAst`, `collector.ts:296-309`). `restorePristineRootNode` (`collector.ts:217-245`) repairs the upstream node-tree-sitter #181 undefined-rootNode race before any root read. `collectAnalysis` (`collector.ts:536-581`) tries native first, falls back to python3-ast on walk failure, and only then gives up. Absent both — native null AND `python3` fails — `unsupportedParser` emits `AnalysisStatus.UNSUPPORTED` (`collector.ts:707-726`), and the CLI turns that unsupported dispatch pair into exit 2 (`src/cli.ts:742-743`, `:659-703`). Ruling: DECISIONS.md `D-20261112-3` (native primary + earned stdlib-ast fallback; absent both → UNSUPPORTED, council verdict), addendum "verdict STANDS" 2026-11-12 (main checkout `.opencode/progress/DECISIONS.md:2161-2168`).

- **Unsupported assertion/declaration forms.** Gap strings VERBATIM from `src/adapters/python/support.ts`: `unsupported-form` (`:49` — now only unrecognized assertion forms, NOT `@given`), `unparseable-coverage-report` (`:55`), `no mutation report supplied` (`:52`). Hypothesis `@given`-decorated tests are no longer a gap: their body assertions are counted with `availability: KNOWN`, `coverage` `PARTIAL` and reason `hypothesis @given: property-based count (not case-exhaustive)` (`testEvidence`, `collector.ts:713-737`), plus a present-only `property_based: true` marker (subject-level reason `:818-822`). The count is NOT case-exhaustive.

- **`property_based` signals a non-case-exhaustive count; consume the verdict, not `availability`.** `property_based: true` is detection-affirmative only — its absence is NEVER negative evidence about a test's nature. It is a JSON-only present-only key (`src/reporters/json.ts:119`, never `false`, schemaVersion stays `'0.5'`, SARIF unchanged). A real `@given` test has `value > 0` with `availability: KNOWN` and `coverage: PARTIAL` yet stays INDETERMINATE under CT-INT-001 — key on the verdict, never on `availability`.

- **mutation_score always UNKNOWN in v1.** No mutmut wiring. The file-level record (`collector.ts:614-624`) and the per-declaration record (`:500-510`) both emit `availability: Availability.UNKNOWN` with reason `gapReason('no-mutation-report')` = `'no mutation report supplied'` (`support.ts:52`). `PROVIDER_HINTS = ['coverage-py', 'pytest-cov', 'mutmut']` (`support.ts:40`) is declared but unconsumed — nothing reads it (`adapter.ts:52` labels `providerHints` "DECLARED BUT UNCONSUMED — ADR-033 §Decision 1"); `mutmut` is a hint, not a wired provider. ADR-033 exists (`docs/adr/ADR-033-per-language-adapter-modules-formal-contract.md`, accepted 2026-11-11).

- **Coverage input formats: coverage.py JSON + lcov ONLY.** `parseCoverageReport` (`collector.ts:441-465`) detects lcov via `text.includes('SF:')` / `.lcov` suffix (`:446`) and coverage.py JSON via `files[].executed_lines` (`:456-464`). The analyzed test file must appear in the report — basename match (`basename(key) === analyzed`, `:443-444`, `wanted()` at `:444`). A missing entry throws `no entry for ${analyzed} in lcov/coverage.py report` (`:453, :464`), caught → `unparseable-coverage-report` UNKNOWN record (`:644-655`).

- **Dispatch.** `resolveAdapter` layers explicit flag > manifest signature > extension (`src/adapters/registry.ts:90-112`); `decidedBy` is `'flag' | 'manifest' | 'extension' | 'unsupported'` (`registry.ts:38-39`). An unsupported pair (`adapterId === null || decidedBy === 'unsupported'`) throws `UnsupportedDispatchError` → exit 2 (`src/cli.ts:742-743`, `:659-703`). Pinned per-repo: `tests/integration/python-slice-corpus.test.ts:88` asserts `decidedBy ∈ {flag, manifest, extension}`.

- **Corpus-validated limit (static collection).** The pytest repo's unittest-form tests report `assertion_count = 0`, so CT-INT-001 returns FAIL — the honest verdict of static collection, pinned deliberately: pass 30 / fail 40 (`tests/integration/python-slice-corpus.test.ts:112-116`). Packaging pass 62 / fail 0 (`:103-106`), click pass 42 / fail 0 (`:107-110`).

**Source:** `src/adapters/python/collector.ts:5-16, 217-245, 257-309, 441-465, 498, 500-510, 536-581, 601-602, 614-624, 644-655, 707-726`; `src/adapters/python/support.ts:40, 49, 52, 55`; `src/adapters/python/capabilities.ts:18, 24-34`; `src/adapters/python/adapter.ts:52`; `src/adapters/registry.ts:38-39, 90-112, 115`; `src/cli.ts:659-703, 742-743`; `tests/integration/python-slice-corpus.test.ts:88, 103-116`; DECISIONS.md `D-20261112-3` + addendum (main checkout `.opencode/progress/DECISIONS.md`); `docs/adr/ADR-033-per-language-adapter-modules-formal-contract.md` (accepted 2026-11-11).

---

## 24. Evidence Strength Contract (D10)

`EvidenceStrength` (`src/core/evidence.ts:72-79`) is the third independent axis on an `EvidenceRecord`, alongside `provenance` and `availability`: **how** an assertion was established, along the syntax → execution axis. It is orthogonal to both other dimensions — a form can be fully classified and still be only observed, never executed, and `Availability.UNKNOWN` stays `UNKNOWN`: nothing here promotes a value to a definite claim. `UNKNOWN` is never promoted (roadmap §277).

### 24.1 Taxonomy

| Strength                | Definition                                                                                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXECUTION_ESTABLISHED` | A straight-line test-body assertion: executing the test proves the assertion itself ran. In Python, a unittest `TestClass` method IS a straight-line test body; class-method containment is not nesting.                                                                                                 |
| `SYNTAX_OBSERVED`       | The assertion form is visible in source, but execution does not establish it (nested helper called from the body; assertion in a conditional/loop branch). pytest `@given` properties are this level even though their assertions are now counted: `PARTIAL` coverage keeps executability unestablished. |
| `UNSUPPORTED`           | The adapter cannot classify this form at all.                                                                                                                                                                                                                                                            |

Classification is language-specific and lives in the adapters (`src/adapters/*`); core only names the axis.

### 24.2 Per-language mapping

**TypeScript (jest/vitest)** — `src/adapters/typescript/regex-assertion-count.ts:69` (`classifyFormStrength`), `src/adapters/typescript/collector.ts:329` (file-level) / `:418` (per-declaration):

| Construct                                                                                                                             | Strength                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Straight-line module-level assertion (all 5 straight-line rules hold)                                                                 | `EXECUTION_ESTABLISHED` |
| Assertion nested in a helper/branch/callback, or a gapped modifier declaration (`it.each` over a non-literal table/`skip`/`only`/...) | `SYNTAX_OBSERVED`       |
| Unclassifiable matcher, computed matcher, or gapped declaration with no classified form                                               | `UNSUPPORTED`           |

Aggregation: weakest-finding-wins at file level and per-declaration (`classifyFormStrength`: an unclassifiable form outranks a classified-but-unestablished one, which outranks a straight-line one). A scan that found nothing is `EXECUTION_ESTABLISHED` — its value 0 is definite.

**Python (pytest/unittest)** — `src/adapters/python/collector.ts` (`countAsserts` native + `AST_SCRIPT`):

| Construct                                                                                 | Strength                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| pytest/unittest straight-line body assertion (class-method containment is NOT nesting)    | `EXECUTION_ESTABLISHED`                                                                    |
| Assertion inside a helper called from the body, or inside `if`/`for`/`while`/`try` branch | `SYNTAX_OBSERVED`                                                                          |
| `@given`-decorated test (assertions counted, tagged `property_based: true`)               | `SYNTAX_OBSERVED`; `value > 0`, `availability: KNOWN`, `CollectionStatus.PARTIAL` retained |
| Non-pytest `.raises` receiver form (e.g. `foo.raises(Exception)`, `self.assertRaises`)    | counted in `totalAsserts`, strength `UNSUPPORTED` on both substrates                       |

Aggregation: weakest-strength at subject level (`aggregateSubjectStrength`); per-declaration uses the same weakest reduction over its asserts (see `testEvidence`).

### 24.3 Orthogonality

`evidenceStrength` is independent of `availability` and of `collection status`. A strength never turns `UNKNOWN` into `KNOWN`, and an observed form is never upgraded to execution-established by inference. `Availability.UNKNOWN` stays `UNKNOWN` regardless of strength.

### 24.4 Report exposure

`evidenceStrength` is serialized today in BOTH report formats, at three documented locations:

1. **JSON evidence records.** `serializeEvidence` emits the record's strength via `setIfPresent(json, 'evidenceStrength', record.evidenceStrength)` (`src/reporters/json.ts:121`), on the file-level `evidence` map and on every `testResults[].evidence` record.
2. **JSON findings.** `serializeFinding` emits the finding's strength via `setIfPresent(json, 'evidenceStrength', finding.evidenceStrength)` (`src/reporters/json.ts:150`), on `ruleResults[]` and `testResults[].ruleResults[]`. The finding's value is copied from the evidence record the verdict rests on, only when that record carries one (`src/core/evaluation.ts:133-134`); `RuleFinding` declares it optional (`src/core/result.ts:128`).
3. **SARIF result properties.** `serializeResult` emits the finding's strength into `runs[0].results[].properties.evidenceStrength` (`src/reporters/sarif.ts:146-147`). The SARIF reporter does not serialize evidence records (§17), so result properties are the only SARIF location.

All three locations are present-when-present (`setIfPresent`, `src/reporters/json.ts:61-65`; the SARIF `undefined` guard): an omitted evidenceStrength means no strength value was supplied and MUST NOT be read as EXECUTION_ESTABLISHED. The field is never defaulted, never emitted as null or an empty string, and never invented for a verdict that rests on no strength-classified record.

Byte-exact goldens pin all three locations with BOTH `EXECUTION_ESTABLISHED` and `SYNTAX_OBSERVED`: `tests/reporters/fixtures/case-26.json` and `tests/reporters/fixtures/case-26.sarif.json`, generated from a real CLI run over `tests/fixtures/int003-probes/probe-mixed.test.ts` (one straight-line test → `EXECUTION_ESTABLISHED` PASS; one callback-nested test → `SYNTAX_OBSERVED` INDETERMINATE), fixture root normalized to `<fixture-root>`. The reporter golden tests in `tests/reporters/json.test.ts` and `tests/reporters/sarif.test.ts` consume them through `runAnalysis` (`src/cli.ts:719`), the CLI's own collect→evaluate→serialize pipeline.

**Source:** `src/core/evidence.ts:85-92` (enum), `src/core/evaluation.ts:133-134` (record → finding copy), `src/core/result.ts:128` (`RuleFinding.evidenceStrength`), `src/reporters/json.ts:61-65` (`setIfPresent`), `:77-123` (`serializeEvidence`, strength at `:121`), `:125-178` (`serializeFinding`, strength at `:150`), `src/reporters/sarif.ts:135-164` (`serializeResult`, strength at `:146-147`), `src/cli.ts:719` (`runAnalysis`); goldens: `tests/reporters/fixtures/case-26.json`, `tests/reporters/fixtures/case-26.sarif.json`.

## 25. Coverage Input Formats and File Identity Matching (Phase 9 Package 2, task 2.2)

The TypeScript external coverage provider accepts only explicitly shaped JSON reports for the supported coverage inputs.

Raw Vitest `coverage-final.json` (shape A: flat Istanbul map `{ "<absPath>": { statementMap, s, ... } }`) is now parsed natively by `src/providers/coverage.ts`; covered lines are the sorted unique `statementMap[*].start.line` values whose hit count in `s` is > 0 (the derive() recipe, `validation/cov001-per-test-recipe.sh:124-145`). Malformed shape-A entries fail closed: `UNKNOWN` / `UNAVAILABLE`, never a zero-coverage `KNOWN`. Other raw shapes still require conversion (Istanbul `covered`, or the derived c8 `files.<path>.coveredLines`) before passing `--coverage-report`.

| Format                                     | Provenance | Freshness check                                                                                                                                                                                       | Example                                                       |
| ------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Istanbul JSON                              | `EXTERNAL` | source revision must be declared and equal the analyzed revision for a `KNOWN` freshness claim; mismatch or unknown revision → `UNKNOWN` / `UNAVAILABLE`                                              | `{ "covered": { "/abs/file.js": [null, 1, 0] } }`             |
| c8 JSON                                    | `EXTERNAL` | source revision must be declared and equal the analyzed revision for a `KNOWN` freshness claim; mismatch or unknown revision → `UNKNOWN` / `UNAVAILABLE`                                              | `{ "files": { "/abs/file.js": { "coveredLines": [1, 3] } } }` |
| Per-test-run derived shape                 | `EXTERNAL` | source revision plus explicit mapping plus `--per-test-run`; numeric per-declaration attribution only when `KNOWN` + `COMPLETE`                                                                       | derived c8-shaped report plus mapping plus attestation        |
| Raw Vitest `coverage-final.json` (shape A) | `EXTERNAL` | source revision must be declared and equal the analyzed revision for a `KNOWN` freshness claim; mismatch or unknown revision → `UNKNOWN` / `UNAVAILABLE`; malformed entry → `UNKNOWN` / `UNAVAILABLE` | `{ "<absPath>": { "statementMap": {...}, "s": {...} } }`      |

**File identity matching.** Exact normalized path match is preferred. Explicit mapping uses `--coverage-map <from>=<to>`; a mapped-missing target yields reason `no coverage data for <mappedTo>`, optionally prefixed with the mapping reason. Without mapping, an exact miss with multiple basename collisions fails closed with reason `ambiguous basename match: <sorted colliding paths>`, availability `UNKNOWN`, coverage status `UNAVAILABLE`, no numeric value (undefined, or the c8 fail-closed empty array); never wrong-file selection.

Cross-reference: [§14](#14-external-coverage-provider-wp41-task-56b) and ADR-031 for mapped semantics; do not duplicate.

## 26. Test Identity Contract (Phase 9 Package 4)

- **Scope**: `TestIdentity` is unique within ONE analysis run (per-analysis), covering the recognized per-test slices emitted by that run.
- **Determinism**: identical input → identical ids; no clock, no randomness; source-order counter. See `src/core/analysis.ts:73-91`, `src/adapters/typescript/collector.ts:652-655` + `:670-672`, and `src/adapters/python/collector.ts:977-983` + `:994-996`.
- **Format**: `<file>#<declaration>@<line>:<index>`.
  - TS: `sample.test.ts#it@2:0`, `sample.test.ts#it@2:1` (two `it` on one line); `it.each` token: `sample.test.ts#it.each@2:1`.
  - Python: `pytest_sample.py#test_add@4:0`; same-line index always 0 in valid Python because a `def` owns its logical line (collision structurally impossible; guard exists anyway).
- **Explicit non-promise (locked ruling D8)**: ids are NOT stable across edits — inserting a declaration earlier in a file shifts subsequent per-line indices and line numbers. Consumers must not persist ids across runs/edits as foreign keys.
- **Type check**: docs-only; no TS source changed, so `tsc` is not affected (acceptance: tsc clean).

**Source:** `src/core/analysis.ts:73-91` (`TestIdentity`); `src/adapters/typescript/collector.ts:458` (id), `:652-655` + `:670-672` (index); `src/adapters/python/collector.ts:1001` (id), `:977-983` + `:994-996` (index); tests: `tests/adapters/typescript/collector.test.ts:31-90`, `tests/adapters/python/collector.test.ts:636-760`.

Cross-reference: Coverage-input file identity is in §25; declaration/test identity is scoped here, not duplicated.

## 27. Rule Lifecycle (Phase 9 close-out, plan 9.3)

`RuleStatus` is a closed set of three operational states, declared as a const object with a derived union at `src/core/rule.ts:39-84` (not a TS enum and not an inline union — the wire values stay `'active' | 'draft' | 'deprecated'`).

| Status       | Default run                               | Explicit `--rule <id>`                                        | Registration requirement            |
| ------------ | ----------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `active`     | evaluated; verdict reported               | same                                                          | none                                |
| `draft`      | excluded: no verdict, no evidence wiring  | opt-in: evaluated like an `active` rule, real verdict emitted | none                                |
| `deprecated` | evaluated; verdict reported until removal | same                                                          | non-empty `deprecatedSince` version |

- **Draft gate.** `src/core/evaluation.ts:311-317` short-circuits a draft rule before any evidence guard unless its id is in `explicitRuleIds` (the CLI's `--rule`, D6). Naming the rule IS the opt-in — the verdict that follows is genuine, not a synthetic INDETERMINATE. Contract prose: `src/core/rule.ts:44-48`, `:66-71`.
- **Deprecated rules** have no engine special case (`src/core/rule.ts:78-82`): they run by default and report a verdict. `deprecatedSince` is enforced at registration by `validateRule` → `guardEvaluationLifecycle` (`src/rules/registry.ts:131-140`, `:163-173`); a deprecated rule without it is rejected with `deprecatedSince must be a non-empty string when status is deprecated`.
- **Registration is explicit** and re-registering an id replaces the entry (`src/rules/registry.ts:175-181`). Validation covers id shape, classification, thresholds, severity, status and advisory fields (`:34-150`); evidence policy fields are immutable via config (§21).
- **Report exposure differs by format.** JSON carries `ruleStatus` on each finding (`src/reporters/json.ts:133-138`); SARIF carries `status` (and `deprecatedSince` when present) on the rule descriptor (`src/reporters/sarif.ts:161-178`). See the §17 asymmetry note.
- **Historical posture.** ADR-030 (`docs/adr/030-draft-rules-produce-no-verdicts.md`) recorded the earlier "draft rules produce no verdicts" decision and was amended by ADR-031 for CT-COV-001. Its blanket statement about future draft rules is superseded for opt-in runs by the D6 enforcement above; the ADR is retained as history, not rewritten here.
- **Today's registry** contains five registered rules, all `active`: CT-INT-001, CT-INT-003, CT-INT-004, CT-COV-001, CT-MUT-001 (`src/cli.ts` `main()` — five `registerRule` calls, observed at `:589-593` on 2026-11-20; rule files `src/rules/ct-{int-001,int-003,int-004,cov-001,mut-001}.ts` each declare `RuleStatus.ACTIVE`). `src/rules/ct-demo-001.ts` declares `RuleStatus.ACTIVE` (`ct-demo-001.ts:30`) but is an unregistered N/A-path stub, registered only in tests (`tests/integration/fixtures.test.ts:179`); it is not a shipped rule. No draft or deprecated rule is registered, so the gates above are contract behavior for future rules, not currently exercised by a shipped rule.

**Source:** `src/core/rule.ts:39-84`; `src/core/evaluation.ts:311-317`; `src/rules/registry.ts:34-150,163-181`; `src/reporters/json.ts:133-138`; `src/reporters/sarif.ts:161-178`; `README.md:95-108`; `docs/adr/030-draft-rules-produce-no-verdicts.md`.

## 28. Adapter dispatch across working directories (F1, 2026-11-21)

Adapter selection is stable across working directories for every file extension a shipped adapter claims. The manifest layer is filtered by extension affinity: a manifest candidate must both match a manifest signature AND claim the file's extension (`src/adapters/registry.ts:109-115`), so a `package.json` in the current working directory cannot route a `.py` file to the TypeScript adapter (WP10 F1; ADR-034 Amendment 2026-11-21). From a manifest-owning directory (repo root): `.py` → `python-pytest-adapter` with `decidedBy: 'extension'`; `.rs` → `UNSUPPORTED` / `NO_ADAPTER_MATCHED`; `.ts` → `typescript-jest-adapter` with `decidedBy: 'manifest'` (unchanged).

- **`decidedBy` is provenance, not stability.** The resolved adapter id is cwd-stable for claimed extensions, but `decidedBy` records which layer decided and may still differ by working directory: with a matching manifest present the layer is `'manifest'`, without one it is `'extension'`. The dispatch tuple `(filePath, flags, filesystem state)` remains deterministic (ADR-034 §Decision item 3).
- **Manifest matching is file existence, not manifest parsing.** The manifest layer tests manifest-FILE EXISTENCE via `fsState.manifestExists` (`src/adapters/registry.ts:111-115`; callers `src/cli.ts:331` doctor and `:733-739` check); it does not parse a `frameworks` array. The extension-affinity filter is the whole refinement — the uniqueness check (`src/adapters/registry.ts:116-118`) and the layer order `flag > manifest > extension` are unchanged.
- **Pre-fix workaround.** On checkouts before this fix, force the intended adapter with `--adapter <id>` (e.g. `check --test path/to/test.py --adapter python-pytest-adapter`) or run from a directory without a conflicting manifest; both yield the adapter the fixed dispatch now selects by itself.

**Source:** `src/adapters/registry.ts:103-118` (manifest block), `:120-129` (extension + unsupported); `src/adapters/adapter.ts:143-149` (extensions also gate manifest candidacy); `src/cli.ts:326-331` (`runDoctorDispatch`), `:719,733-739` (`runAnalysis`); `docs/adr/ADR-034-layered-adapter-dispatch-recorded-decision.md` §Amendment 2026-11-21. Probes from repo root: `check --test tests/adapters/python/fixtures/pytest_sample.py --type UNIT` → exit 0, `python-pytest-adapter`, `decidedBy: extension`; `doctor --test ... --json` → `adapterId: python-pytest-adapter`, `decidedBy: extension`; repo-root `.rs` → exit 2 / `NO_ADAPTER_MATCHED`, pinned by `tests/cli.test.ts:1055`.

---

## 29. Post-v1.15.1 backlog initiative (WP11, 2026-11-21)

The initiative closed the seven backlog register items (WP11 brief:11-17) across commits `02837f8`, `163bcfb` and `4b6b2c1` (HEAD). `REPORT_SCHEMA_VERSION` stayed `0.5`; ADR-042 held (no envelope key add/remove/rename).

**(a) python-slice-corpus — RESTORED, machine-local.** Verdict `FEASIBLE`: all four feasibility conjuncts PASS, the recipe re-ran (exit 0), all six raw-artifact sha256 values re-verified, and the corpus suite executes green — `npx jest tests/integration/python-slice-corpus.test.ts`: 21 passed, 21 total, 0 skipped (3-implementer-notes.md §3). Disclosed behavior: `validation/python-slice/manifest.json` is gitignored (`.gitignore:8 validation/*`), so every checkout without the corpus lacks the manifest and the `it.skip` guard at `tests/integration/python-slice-corpus.test.ts:70-73` remains the honest default — the suite runs when the manifest is present, skips when absent. Evidence: 2-researcher-notes.md (`VERDICT: FEASIBLE` + per-conjunct (a)-(d) table); 3-implementer-notes.md (recipe run + jest output + skip-guard KEPT decision).

**(b) CI Option C — (c') measured-dispatch landed, UNPROVEN-on-runner.** `.github/workflows/stryker-dispatch.yml` (89 lines) landed at commit `163bcfb`: `workflow_dispatch`-ONLY (no `schedule`, no `cron`, no `pull_request`/`push`), one scoped-recipe stryker run per dispatch (config PATH positional, no `--configFile`, `-c 1`), records wall-clock/exit code/report size+score/mutant count, uploads the report artifact with 14d retention, 30-minute timeout. First manual dispatch completed 2026-11-22 (run 44968057090: real 4m10.7s, exit 0, score 67/68 = 0.9852941176470589 — identical to the local baseline; runner determinism confirmed; datum in .opencode/scratch/wp11-followups/followup-stryker-datum.md). Owner ruling (WP11 plan ## Decisions #16): **manual dispatch stays the permanent mode — no schedule**. No playbook pitfall-6 amendment this initiative — `docs/release-playbook.md:234` ("Don't add Stryker to CI.") stands; the amendment is a gated policy edit deferred to a later owner decision. Evidence: 10-orchestrator-notes.md (ruling); 15-orchestrator-notes.md (commit execution + auditor 13/13 INFO); the workflow file's `on:` block.

**(c) 22 WP6 expectation-gap clusters — resolved expectation-side.** Owner ruling ## Decisions #12 (task 16): all 22 clusters answered exactly once, every batch "Amend expectations" plus B5 cleanup (C-1 publish the canonical `unsupported-form` constant; C-2 remove the ordinary per-test `line_coverage` copy). Zero src/ bugs designated, zero deferrals; sidecars pin adapter behavior per cluster (`jev/record/post-v1151-cluster-rulings-2026-11-21.md`; commit `4b6b2c1`). 168 conformance tests green (144 + 24 harness-adoption suite), unchanged.

Adoption landed: the conformance harness now reads the `*ByLanguage` sidecar branches via the exported deep-merge helper `mergeExpected` in `tests/conformance/harness.ts`; each branch is authoritative per key over the shared block (branch key wins per leaf, arrays/scalars/null replace, branch absent → shared identity), and shared blocks remain for branchless fixtures. The two EXPECTED-REMAINING shared-only residuals (CF-COND-001 python `unestablished_assertions`, CF-UNSUP-001 python `unclassified_constructs`) are reported residuals in the observation table, not failures. C-2's `perTest line_coverage` MUST_BE_ABSENT rule stands — src now complies.

**(d) §4.7 closed — no human summary ever.** Owner ruling ## Decisions #14 (task 23): `check` never emits a separate human count summary. Rejected alternatives, one reason each: a stderr-only summary (a second output surface with no demonstrated need); an opt-in stdout summary flag (two documented stdout shapes when the envelope already carries the counters); an always-on stdout summary (changes the default report bytes); a new envelope key (ADR-042 freezes the envelope). `[docs/reporting-contract.md §4.7](reporting-contract.md)` records the closure + rationale; default `check` stdout is pinned byte-for-byte by `tests/cli.test.ts:1605-1615` (digest `dcec8784...`). Task 24 was docs-only plus the byte-pin test; `src/` is untouched. Evidence: `docs/reporting-contract.md §4.7` (`:227-237`); `jev/record/post-v1151-section47-summary-2026-11-21.md`; 23-orchestrator-notes.md; 24-implementer-notes.md.

**(e) Observation statuses — both awaiting first real data.**

- Item 7 (checkchange Option A WARN/FAILED path on a real runner): `PENDING-PR`. Public run `44939792339` was a push (base `8c345ea`, gate `NOT_EVALUATED`, exit 0); the WARN/FAILED path is unproven on a real runner until a PR lands (8-orchestrator-notes.md item-7 checkpoint). Not a task in this initiative.
- Stryker measured-dispatch experiment: CLOSED 2026-11-22 — first dispatch datum landed (run 44968057090) and the owner ruling is manual-only status quo (## Decisions #16). Evidence: 15-orchestrator-notes.md; followup-stryker-datum.md.

**Source:** `.opencode/plans/2026-11-21-post-v1151-backlog-initiative.md` (task 26 acceptance; ## Decisions #8-14); commits `4b6b2c1` / `163bcfb` / `02837f8`.

---

## 30. Node `assert` Is a Detected-but-Unsupported Assertion Namespace (T10, council-frozen 2026-11-22)

`node:assert` calls (`assert.strictEqual(...)`, `assert.equal(...)`, ...) are **detected but never counted**. The namespace guard at `src/adapters/typescript/collector.ts:766-774` resolves the call's root identifier and, when it is one of `UNSUPPORTED_ASSERTION_NAMESPACES = ['assert', 'chai', 'should']` (`src/adapters/typescript/support.ts:92`), records an unsupported-form construct with reason `'assert' is not a supported assertion form` — `form: null`, `established: false`. The construct therefore never enters `assertion_count`; the file is `PARTIAL` and CT-INT-001 yields **INDETERMINATE**, never PASS and never FAIL.

- **Bare `assert(x)` is not even detected as an assertion API.** `classifyForm` requires a property-access callee (`src/adapters/typescript/support.ts:395-398`); a bare call has no matcher to read, so it returns `null` and is silently dropped (the §7 heuristic gap). Only `assert.<member>(...)` forms reach the namespace guard.
- **Census size: 42 rows.** The external B census carries **42** node-assert-unsupported rows after the gap-closure re-run (37 before -> 42 after; `.opencode/scratch/dogfood-gap-closure/21-reviewer-notes.md:109`; council fact-check `.opencode/scratch/open-items-closure/c-council-notes.md:24`). The regrowth is the documented fence-maintenance cost of the hand-maintained `UNSUPPORTED_ASSERTION_NAMESPACES` list.
- **Frozen semantics (Q10 = B).** The reason stays `'assert' is not a supported assertion form`; the boundary is stated here and in [Supported Syntax — Not Recognized](./supported-syntax.md#not-recognized-recorded-as-unsupported-forms) (`docs/supported-syntax.md:77`). No src/ change.
- **Deferral clause.** Supporting node:assert becomes a dedicated milestone unit **only if** a future census shows demand, and only with per-form static semantics (strict vs loose equality, `assert.ok`, `assert.ifError`, `assert.doesNotReject`, ...) plus characterization fixtures (true + near-miss) first. Partial-namespace support (bare `assert(x)` plus loose `assert.equal`) was rejected: it would create a mixed PASS/INDETERMINATE split inside one namespace.

**Source:** `src/adapters/typescript/collector.ts:766-774` (namespace guard + reason), `src/adapters/typescript/support.ts:92` (`UNSUPPORTED_ASSERTION_NAMESPACES`), `src/adapters/typescript/support.ts:395-398` (`classifyForm` property-access guard), `docs/supported-syntax.md:77` (Not Recognized), `.opencode/scratch/dogfood-gap-closure/21-reviewer-notes.md:109` (37->42), `.opencode/scratch/open-items-closure/c-council-notes.md:27` (Q10 = B frozen + deferral clause).

---

## 31. Framework-Unknown Files Are UNSUPPORTED-as-Expected (T5, council-frozen 2026-11-22)

A file whose detected framework is `unknown` — no detectable `jest`/`vitest`/`mocha` runtime signal — is reported at **report level** as `analysisStatus: UNSUPPORTED`, `completeness: NOT_APPLICABLE`, with the verbatim reason:

```
framework 'unknown' is outside the supported framework list [jest, vitest, mocha]
```

The reason is built at `src/adapters/typescript/collector.ts:278-279` from `SUPPORTED_FRAMEWORKS = ['jest', 'vitest', 'mocha']` (`src/adapters/typescript/capabilities.ts:18`). No `testResults` are emitted, so the file contributes neither PASS nor INDETERMINATE to test-level numerics.

- **Corpus size: 7 files.** Five `vitest` UI specs (`test/ui/test/{trace,watch-updates,editor,ui,trace-stream}.spec.ts`) import `@playwright/test`; `react packages/dom-event-testing-library/testHelpers.js` and `react-testing-library tests/failOnUnexpectedConsoleCalls.js` carry no runner import at all (`.opencode/scratch/dogfood-census/B-census-external-notes.md:81-85,96,100,189`).
- **Declared product boundary (Q5 = B, unanimous).** The framework list is the product boundary; no Playwright adapter is planned at milestone-1. This is report-level text only — no schema change, no src/ change. See §4 for the detection rules that leave these files `unknown`.
- **The two helper-only files assert nothing by design.** `testHelpers.js` and `failOnUnexpectedConsoleCalls.js` are setup/helper modules, not test modules; the UNSUPPORTED verdict is the honest outcome, not a missed detection. Folding them into a bucket would overstate coverage.

**Source:** `src/adapters/typescript/collector.ts:278-279` (`unsupported()` reason), `src/adapters/typescript/capabilities.ts:18` (`SUPPORTED_FRAMEWORKS`), §4 (framework detection), `.opencode/scratch/dogfood-census/B-census-external-notes.md:81-85,96,100,189` (7-file census), `.opencode/scratch/open-items-closure/c-council-notes.md:28` (Q5 = B frozen).

---

## 32. Zero-Assertion FAILs and Their Known False-Negative Causes (T9, council-frozen 2026-11-22)

All **86** external-census FAILs carry the identical reason `CT-INT-001: assertion_count=0 <= 0`. Per-repo split (re-aggregated from the 99 retained B-reports, no re-clone): express 26, apollo-server 22, testcontainers-node 15, react 14, redux 7, vitest 2 (`.opencode/scratch/open-items-closure/t9a-documenter-notes.md` §2). The count measures **recognized** forms within the declared form vocabulary (`SUPPORTED_ASSERTION_FORMS`); it is a real measurement, not a fabricated zero.

- **Known false-negative cause 1 — supertest chains read as declaration gaps.** A supertest fluent chain (`request(app).post('/').expect(413, done)`) is not a recognized assertion; the collector can read `var test = request(app).post('/')` as a test declaration and its `.set()/.write()/.expect()/.end()` calls as gap evidence. Verified example: `express/test/express.json.js#it@132` — `should 413 when over limit with chunked encoding`, whose body ends `test.expect(413, done)` — is reported FAIL with `assertion_count=0` (`B-reports/express--test_express.json.js.json`, test_id `...#it@132:0`; corpus source `express/test/express.json.js:132-141`). The misread is documented at `.opencode/scratch/dogfood-census/B-census-external-notes.md:174`.
- **Known false-negative cause 2 — callback-executed assertions.** The 40 `coverage-evidence-missing` rows are INDETERMINATE (`assertion is inside a callback; callback execution cannot be established statically`), **correctly NOT FAIL** — a recognized assertion whose execution cannot be established statically is not a proved zero.
- **Mislabel honesty (Q9 = B-conditional).** A FAIL here means **"no recognized assertion"**, not "no assertion". Local-variable supertest chains are recognized as of 2026-11-22 (S unit, C2 council), so that cause is closed for the in-file shape; the bucket stays a known false-negative bucket pending the deferred external re-measure, not a precision measurement.
- **Named follow-up — recognition LANDED 2026-11-22 (S unit, C2 council).** The `supertest-chain assertion recognition` unit landed: `isSupertestChain` (`src/adapters/typescript/support.ts:442-461`) now resolves a non-`expect` root identifier to its enclosing `VariableDeclaration` initializer and re-walks that initializer's chain for an HTTP verb (`SUPERTEST_HTTP_METHODS`), so local-variable supertest chains (`const test = request(app).post('/'); test.expect(413)`) are recognized. Residual zero-assertion FAILs are unchanged; the external 86-FAIL census re-measure is **deferred to a later named unit** (cite-don't-re-measure — no corpus re-clone in this unit).

**Source:** `.opencode/scratch/open-items-closure/t9a-documenter-notes.md` §2 (86 + per-repo split, verbatim reasons), `.opencode/scratch/dogfood-census/B-census-external-notes.md:163,165,174,179-182` (bucket + FAIL table + supertest note), `.opencode/scratch/dogfood-census/B-reports/express--test_express.json.js.json` (`#it@132:0` FAIL), `src/adapters/typescript/capabilities.ts:25-54` (`SUPPORTED_ASSERTION_FORMS`), `.opencode/scratch/open-items-closure/c-council-notes.md:29` (Q9 = B-conditional frozen).

---

## 33. `.cjs` Is Claimed by the TypeScript Adapter (T11, owner ruling 2026-11-22)

The TypeScript adapter claims `.cjs` (`src/adapters/typescript/adapter.ts:50`), so a CommonJS test file resolves to `typescript-jest-adapter` at the extension layer instead of `UNSUPPORTED` / `no adapter matched`. Owner ruling 2026-11-22 (open item 11, `docs/open-items.md:166-169`): **add `.cjs`** rather than document `.cjs` as out-of-scope UNSUPPORTED.

- **Why the claim is safe.** The collector applies no extension gate — it parses any path it is given (`src/adapters/typescript/collector.ts:139-148`) — so `extensions` is a dispatch CLAIM, not an analysis filter. `.cjs` source is CommonJS, parsed as `ScriptKind.TS` (the JSX heuristic matches only `/\.(jsx?|tsx?)$/`).
- **Honest outcome, not a PASS.** A `.cjs` smoke test with bare `test(...)` and node `assert` derives the framework as `mocha` (bare-global, no `expect`) and `assert` is a detected-but-unsupported namespace (§30), so the file is `SUCCESS` / `PARTIAL` with `assertion_count` UNKNOWN and CT-INT-001 **INDETERMINATE**. The ruling makes the file ANALYZED; it does not extend the assertion vocabulary.
- **Pinned by** `tests/adapters/adapter-contract.test.ts` (`.cjs` claimed), `tests/adapters/registry-integration.test.ts` (`.cjs` → `extension` / `typescript-jest-adapter`), and fixture `tests/fixtures/ct-int-001/case-57-cjs-extension/`.

**Source:** `src/adapters/typescript/adapter.ts:50` (`extensions`), `src/adapters/registry.ts:120-129` (extension layer), `docs/open-items.md:166-169` (item 11), §30 (assert namespace), `tests/fixtures/ct-int-001/case-57-cjs-extension/sample.expected.json` (derived from a real `collectAnalysis` run).

---

## 34. Custom-Helper Calls Outside the Declared Test-Body Scope (A1 honest remainder; T7, owner ruling 2026-11-22)

A1, verbatim (`docs/supported-syntax.md:227`): "**Cross-file helper resolution: out of scope.** A call like `expectValidUser(id)` is recorded as an unsupported form with reason `custom assertion helper is out of the declared test-body scope` — never silently dropped." The external census B re-aggregation contains exactly **33** such pure custom-helper rows (per-repo table, `.opencode/scratch/open-items-remainder-closure/t7-evidence-documenter-notes.md`, 10639B, lines 27–70) across **4 repos**: redux 23, react 6, axios 3, apollo-server 1. All 33 are **INDETERMINATE** verdicts with `coverage.status` PARTIAL — **never FAIL**. (The census's 86 FAILs are all `CT-INT-001: assertion_count=0 <= 0`; none involves a custom helper.)

- **Representative helper patterns.** Each row is a direct call inside a test body: `assert(response.body.kind === 'single')` (apollo-server, 1 row), `expectAdapterFailurePreserved()` (axios, 3 rows), `assertConsoleErrorDev([...])` (react, 6 rows in one file), `expectTypeOf(...)` (redux, 23 rows across five `.test-d.ts` files).
- **Capability gate.** Every row maps to A1: resolving a custom helper is `custom_helper_resolution: UNAVAILABLE` (`src/adapters/typescript/collector.ts:223`); no row is the A1 "test body passed as an identifier" case.
- **Owner ruling (O2, 2026-11-22): keep out-of-scope.** These 33 rows stay INDETERMINATE/PARTIAL as the honest remainder; no src/ change is warranted. A "relax for local helpers" unit (enable `custom_helper_resolution`, so rows whose only gap is the helper can tip toward COMPLETE/PASS) is a possible future design unit — **not scheduled** under this docs-only unit (§11 guardrail).

**Source:** `.opencode/scratch/open-items-remainder-closure/t7-evidence-documenter-notes.md:22-35,37-43,45-77` (33-row table, per-repo split, A1 mapping), `.opencode/scratch/dogfood-census/B-census-external-notes.md:163,179` (bucket baseline "33 custom-helper-out-of-scope"; 86 zero-assertion FAILs), `docs/supported-syntax.md:227-231` (A1), `src/adapters/typescript/collector.ts:223` (`custom_helper_resolution: UNAVAILABLE`), owner ruling O2 (2026-11-22).

---

## 35. Nested-Block Assertions Stay INDETERMINATE (executability honest remainder; T8, council-frozen 2026-11-22)

Anchor A's straight-line rule 3, verbatim (`src/adapters/typescript/collector.ts:596-599`):

> 3. it is not nested inside a block or control-flow construct (`if`,
>    `else`, loop, `try`/`catch`/`finally`, `switch`, `do`, labeled
>    statement) — those may or may not run, and which is not establishable
>    without control-flow analysis, which milestone-1 does not do;

An assertion failing that rule is **unestablished**: it is not counted, `coverage.status` is `PARTIAL`, `evidence.assertion_count.availability` becomes `UNKNOWN`, and CT-INT-001 yields **INDETERMINATE** — never FAIL (§1, §11). The reason string is `assertion is inside a nested block (if/loop/try/switch); straight-line execution cannot be established statically` (`src/adapters/typescript/collector.ts:94-95`); the walk that applies it is `isControlFlow` (`src/adapters/typescript/collector.ts:672-685`).

- **Census datum — misc 108, named split.** The post-T9 self census (47 subjects, HEAD `2b7d060`) reports the `misc` bucket — `(nested-block OR custom-helper) AND NOT matcher` — at **108**, split **nested-only 67 / custom-only 37 / both 4** (`.opencode/scratch/dogfood-gap-closure/census-after/summary.md:24-27`, disk-verified; cite-don't-re-measure). The nested-only 67 is this section's actionable remainder; custom-only 37 and both 4 are §34's A1 remainder. The 53 → 108 rise is the documented partition effect of A's bucket definition plus new/changed test code between `d472fea` and `2b7d060`, not a tool regression (`census-after/summary.md:37-60`, "Why misc rose while INDET fell").
- **Never-FAIL invariant.** No unestablished construct yields FAIL: an unestablished assertion is not a proved zero, so `availability: UNKNOWN` routes to `unknown_evidence_policy` = INDETERMINATE under the step-5 availability guard (`src/core/evaluation.ts:412-428`; `src/rules/ct-int-001.ts:63`). UNKNOWN stays INDETERMINATE.
- **Council ruling (C2, 2026-11-22, unanimous 5/5): keep.** Item 8 = documented honest remainder with **zero src/ change**; semantics unchanged (nested/unestablished → coverage PARTIAL → INDETERMINATE, never FAIL). Executability heuristics — attempting to prove nested-block execution statically — were rejected as fabricated evidence; Anchor A already states the epistemic limit. The named reason split above is adopted from the Expansionist advisor so the bucket is actionable (`.opencode/scratch/open-items-remainder-closure/c2-council-notes.md:53-54`).
- **Milestone that would change this.** Control-flow analysis (reachability, branch conditions, loop trip counts, `try`/`catch` paths) is the milestone that would let a nested-block assertion be established instead of left UNKNOWN; until it lands, the honest remainder stands.

**Source:** `src/adapters/typescript/collector.ts:596-599` (Anchor A rule 3 verbatim), `src/adapters/typescript/collector.ts:94-95` (`REASON_NESTED_BLOCK`), `src/adapters/typescript/collector.ts:663-666` (nested-block walk), `src/adapters/typescript/collector.ts:672-685` (`isControlFlow`), `src/core/evaluation.ts:412-428` (step-5 availability guard), `src/rules/ct-int-001.ts:63` (`unknown_evidence_policy: INDETERMINATE`), `docs/supported-syntax.md:97` (A7 table row), `.opencode/scratch/dogfood-gap-closure/census-after/summary.md:24-27,37-60` (misc 108 split + partition note), `.opencode/scratch/open-items-remainder-closure/c2-council-notes.md:53-54` (item 8 = (a) frozen), §1, §11, §34.

---

## 36. TSX Parse Failures Surface as Report-Level FAILED + stderr Warning (T6, owner ruling 2026-11-22)

A `.tsx` test file whose source the TypeScript parser rejects is a **report-level FAILED entry**, exactly as before: `analysisStatus: FAILED`, `evaluationStatus: FAILED`, `ruleResults: []`, `testResults: []`, `schemaVersion` 0.5 and the report envelope unchanged (ADR-042). Owner ruling O2 (2026-11-22, verbatim "Tolerate-skip + warning (Recommended)") adds a **file-level human-readable warning on stderr** — one line per file, no new report fields:

```
checktest: TSX parse failure: <file path>: parse diagnostics (N): TS<code> <message> (line L); …
```

- **Seam.** `runAnalysis` computes an optional `warning` string (`src/cli.ts`, `tsxParseWarning`) from the collector's own `parse diagnostics …` reason and returns it as data; `main()` writes it to the existing `process.stderr` channel. `runAnalysis` stays I/O-free. The warning is derived from `formatParseDiagnostics` (`src/adapters/typescript/collector.ts:238-247`), so the report reason and the stderr line cannot drift.
- **Scoped to `.tsx`.** A `.ts` parse failure (fixture `tests/fixtures/ct-int-001/case-11-collector-failure/broken.test.ts`) keeps the long-standing contract "a FAILED test is reported in the JSON — never on stderr" (`tests/cli.test.ts`, case-11). The new warning fires only for a `.tsx` path whose analysis is FAILED with a `parse diagnostics` reason.
- **Census datum — 10 FAILED files.** External census B (`.opencode/scratch/dogfood-census/B-census-external-notes.md:112-113,128-138,168`) reports **10** TSX parse FAILED files, all in the report-level bucket and excluded from the 776 test-level `ruleResults`: styled-components 2 (`commit-order.test.tsx` TS1109 line 638, 1 diag; `modern-css.test.tsx` TS1005 line 1032, 8 diags), query 5 (`useMutationState.test.tsx` TS1005 line 256, 25; `usePrefetchInfiniteQuery.test.tsx` TS1109 line 33, 38; `useQueries.test.tsx` TS1109 line 69, 35; `fine-grained-persister.test.tsx` TS1109 line 30, 12; `useMutation.test.tsx` TS1005 line 68, 155), zustand 3 (`persistAsync.test.tsx` TS1005 line 285, 14; `middlewareTypes.test.tsx` TS1109 line 47, 286; `basic.test.tsx` TS1109 line 225, 3). Under this ruling the 10 stay FAILED; the warning only makes the parse diagnostics visible on stderr.
- **Parse-level, not TSX-per-se.** The same zustand repo has 4 TSX SUCCESS rows (`persistSync.test.tsx`, `immer.test.tsx`, `subscribe.test.tsx`, `vanilla/subscribe.test.tsx`; `B-census-external-notes.md:134-136,140`) — identical extension, clean parse. The failures are TSX grammar diagnostics, not a TSX-specific incapability.
- **Pinned by** `tests/cli.test.ts` (T6: exit 2, FAILED report entry unchanged, stderr names the file and the first `TS<code>`).

**Source:** `.opencode/scratch/open-items-remainder-closure/t6-evidence-documenter-notes.md:4-46` (10-file catalog + verbatim diagnostic codes), `:48-57` (4 zustand TSX SUCCESS contrast), `:91-115` (collector parse-failure seam `src/adapters/typescript/collector.ts:166-172,249-276`), `.opencode/scratch/dogfood-census/B-census-external-notes.md:112-113,128-138,134-136,140,168` (census buckets), `src/cli.ts` (`tsxParseWarning`, `runAnalysis` warning return, `main()` stderr write), `src/adapters/typescript/collector.ts:238-247` (`formatParseDiagnostics`), owner ruling O2 (2026-11-22), §33.

---

## 37. Source-Touch Contract — Static-Read-Only Analysis vs External Stryker (U8, 2026-11-23)

**CheckTest analysis is static-read-only.** The TypeScript adapter parses the test file via AST (`src/adapters/typescript/collector.ts`); the coverage and mutation providers only READ report files from disk (`src/providers/coverage.ts`, `src/providers/mutation.ts`); `doctor`/`explain` never write files. Nothing in the `check` path creates, edits, or deletes a file in the analyzed repository.

**Battery precedent (2026-11-23).** The five-rule battery replayed against the CheckChange and Engram checkouts ended with **0 tracked-file modifications in both foreign repos** (`.opencode/scratch/open-items-remainder-closure/dogfood-checkchange-engram-repos-2026-11-23.md`). That is the observed contract, not a promised guarantee.

**The mutating component is external Stryker.** CheckTest never runs Stryker; it only reads a Stryker report the user produced (`--mutation-report`). Stryker is the tool that instruments and rewrites source files, so the safe-area question belongs to the user's mutation workflow, not to CheckTest's analysis path.

**Shipped helper (owner ruling U8 option (B), `jev/record/mutation-sandbox-guarantee-2026-11-23.md`).** `checktest mutation-sandbox init [--dir <path>]` prepares the safe area:

- creates a gitignored sandbox directory `.checktest-sandbox/` in the target repo;
- writes `.checktest-sandbox/stryker.config.json` bound to that sandbox (`tempDirName: ".checktest-sandbox/stryker-tmp"`, `inPlace: false`, `ignorePatterns` including `.checktest-sandbox/**`; no `testRunner`, no `mutate` — runner-agnostic and minimal);
- for CheckTest's own repo, ensures the `.gitignore` entry `.checktest-sandbox/` (idempotent);
- for a FOREIGN repo, PRINTS the required `.gitignore` line and leaves the foreign `.gitignore` byte-identical — it never silently appends to a tracked file in a repo this unit does not own.

**No enforcement claim.** The helper prepares a directory and a config; it does not run Stryker, does not watch provenance, and does not guarantee anything about where the user's mutation tooling actually runs. Framing constraint (binding, from the ruling record): CheckTest analysis is read-only; the sandbox is where the user's external mutation tool should run.

**Foreign-repo caveat (battery finding).** In the 2026-11-23 battery, CheckChange's `.gitignore` covered `.stryker-tmp/` natively, while Engram's did NOT — residue had to be removed by hand. A foreign repo without an ignore entry will show `.checktest-sandbox/` as untracked; add the printed line before running mutation tooling there.

**Source:** `src/sandbox/init.ts` (`initMutationSandbox`, `buildStrykerConfig`, `isOwnRepo`), `src/sandbox/cli.ts` (`runMutationSandbox`), `src/cli.ts` (dispatch only), `tests/cli-mutation-sandbox.test.ts` (dir creation, config content, own-repo append / foreign print-or-confirm with byte-identical foreign `.gitignore`), `jev/record/mutation-sandbox-guarantee-2026-11-23.md` (ruling + binding framing constraint), `.opencode/scratch/open-items-remainder-closure/dogfood-checkchange-engram-repos-2026-11-23.md` (battery precedent: 0 tracked-file modifications), `node_modules/@stryker-mutator/core/schema/stryker-schema.json` (`tempDirName`, `inPlace`, `ignorePatterns`; `workingDir` is not a Stryker core option and is deliberately absent).


## 40. Re-derivation and provenance (outputs terminal)

CheckTest reports are terminal outputs, not inputs. A report is the serialized result
of one deterministic analysis of one input file; feeding a report back as an input
(`--from-report`) is not supported and would break the determinism and
schema-stability contracts (ADR-042, ADR-035).

**Re-derivation recipe.** To reproduce a run, keep the inputs and re-run:

1. Preserve the test file analyzed (its path is `test.file` in the report).
2. Preserve every external evidence report attached via `--coverage-report` /
   `--mutation-report`. Their paths and sha256 are recorded in the provenance
   manifest's `external_evidence` block when `--provenance` was used.
3. Re-run the command recorded in the provenance manifest's `command` field with
   the same flags. The manifest's `input.sha256` must match the preserved test
   file; a mismatch means the input changed and the verdict may differ — that is
   correct, not a defect.
4. Outputs are byte-identical when inputs, flags, and CheckTest version match.

**If inputs are lost.** The manifest records that they are gone (sha256 mismatch or
missing file) but cannot reconstruct the original verdict. Preserve inputs; this
is a documentation contract, not an engine feature.
