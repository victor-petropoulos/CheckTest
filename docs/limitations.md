# Known Limitations (Milestone-1)

This document lists the intentional gaps in Milestone-1. Each is a documented known limitation, not a bug.

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

**Source:** `src/adapters/typescript/collector.ts:593-600` (element access on expect chain), `src/adapters/typescript/support.ts:219-224` (computed matchers not in A9 list).

---

## 6. `test.each` / `it.each` / `it.todo` — Detected But Not Fully Supported (F)

Table-driven tests using `test.each([...])(name, fn)` or `it.each([...])(name, fn)` and `it.todo('name')` **are recognized as test declarations** (the collector reports them) but their bodies are **not analyzed** (rule 5 of straight-line definition). Assertions inside them are not counted toward `assertion_count`.

Other modifier forms (`skip`, `only`, `failing`, `concurrent`, `skipIf`, `runIf`, unrecognized) and non-inline bodies (`it('name', helperFn)`) are also detected and reported as "not fully supported". A declaration-only form (`it.todo`) does not degrade **file-level** coverage because its body provably does not exist; its own per-declaration record is still `UNAVAILABLE` / `availability: UNKNOWN` (see §11, `collector.ts:394-400`).

**Source:** `src/adapters/typescript/support.ts:278-339` (`TEST_DECLARATION_NAMES`, `classifyTestDeclaration`), `src/adapters/typescript/collector.ts:517-566` (`findTestDeclarations`, `declarationSite`, `DeclarationGap`), `src/adapters/typescript/collector.ts:467-501` (`coverageReason` — declares recognized vs supported counts).

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
- `unsupported-form` (`it.each`, modifiers, chained): execution frequency unmodelled → `availability: UNKNOWN` → `unknown_evidence_policy`
- `conditional` (`(c ? it.skip : it)(...)`, WP3.4 defect 1): which declaration runs cannot be established statically → `availability: UNKNOWN` → `unknown_evidence_policy`
- `aliased` (`const t = it; t(...)`, WP3.4 defect 2): how the aliased declaration runs is not established at this analysis level → `availability: UNKNOWN` → `unknown_evidence_policy`

Conservative rule enforced in `evaluateRule` step 5 (availability guard): `availability !== KNOWN` → `unknown_evidence_policy` → INDETERMINATE. A zero count from an unestablishable body is **never** read as meaningful and turned into FAIL (SPEC:425 applied per test: "zero not meaningful unless COMPLETE+supported").

**Source:** `src/adapters/typescript/collector.ts:537-566` (`declarationSite` gap classification), `src/adapters/typescript/collector.ts:455-465` (`declarationGapReason`), `src/adapters/typescript/collector.ts:394-400` (gap → `PARTIAL`/`UNAVAILABLE` coverage mapping), `src/core/evaluation.ts:243-254` (step 5 availability guard), `docs/supported-syntax.md` (Five Declaration Gaps table).

**DPC-1 (resolved 2026-10-17, user decision "Align docs to code").** This section previously claimed `availability: KNOWN` for `declaration-only`. That was wrong for the per-declaration record: a gap forces `coverage.status: UNAVAILABLE` and leaves `value` undefined (`collector.ts:394-400`, `:402-413`), so the declaration is `UNKNOWN`, never `KNOWN`-zero. Corrected above.

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

`DIRECT` is produced at 4 sites in `collector.ts`. `DERIVED` exists only as the fixture-13 regex stub (`regex-assertion-count.ts`); no `src/` module imports it. `EXTERNAL` is produced by the coverage provider (`src/providers/coverage.ts`, §14) and the mutation provider (`src/providers/mutation.ts`, §19); both attach file-level records, and coverage additionally attaches per-declaration records by line-range overlap without a `location`.

**Consequence:** reachability is documented here, not asserted by a test. No fake producer is built to make `EXTERNAL` reachable (DPC-3, closed). `EXTERNAL` provenance fields are added in WP4.1 task 56a (optional `provider`, `provider_version`, `source_revision`), present only when `provenance === EXTERNAL`; real producers exist as of §14 (coverage) and §19 (mutation). §13 and §14 no longer contradict: §13 states provenance-level reachability (EXTERNAL reachable today via those providers, file-level scope with an additional per-declaration pass for coverage), and §14/§19 describe provider behavior. Missing/unreadable/malformed/stale reports yield explicit UNKNOWN records with a reason rather than zero (§14, §19).

**Source:** `src/core/evidence.ts:14-18` (enum), `src/adapters/typescript/collector.ts:267/294/336/408` (DIRECT producers), `src/adapters/typescript/regex-assertion-count.ts:51` (DERIVED producer), `src/providers/coverage.ts:343-369` (`applyCoverageReport`, per-declaration attribution at `coverage.ts:308-341`), `src/providers/mutation.ts:378-399` (`applyMutationReport`, file-level only).

---

## 14. External Coverage Provider (WP4.1 task 56b)

`EvidenceRecord` carries optional provenance fields `provider`, `provider_version`, and `source_revision`, meaningful only when `provenance === EXTERNAL`. A producer now exists: `src/providers/coverage.ts` (`parseCoverageReport`) reads an Istanbul (primary) or c8 (secondary) JSON report from disk and emits `line_coverage` records with `provenance: EXTERNAL` plus provider identity/version/revision. File-level coverage attaches to `AnalysisOutput.evidence`; per-declaration coverage is attributed by line-range overlap with declaration locations and attaches to `TestScopeResult.evidence`.

Missing/unreadable/malformed/unsupported reports do NOT crash and never read as zero coverage: they yield empty records or explicit UNKNOWN records with a reason. A stale or mismatched `source_revision` versus the analyzed revision yields UNKNOWN records (reason records the mismatch) instead of a definitive result. External evidence is opt-in via `--coverage-report <path>`; with no flag, existing rules behave exactly as before.

CT-COV-001 (`src/rules/ct-cov-001.ts`) is the rule that consumes `line_coverage` evidence, but it is currently registered with `status: 'draft'` (`src/rules/ct-cov-001.ts:29`; ADR-030). Draft rules stay registered and their coverage evidence still attaches to reports (provider fields, availability, `coverage.status`, reasons), but the engine short-circuits them before any evidence guard (`src/core/evaluation.ts:175`) and they produce **no verdicts** — no PASS/FAIL/INDETERMINATE findings. So `--rule CT-COV-001` yields an empty `ruleResults` and exit 2 (no verdict), whether or not a coverage report is supplied; a missing report only means the (already silent) evidence is absent, not an INDETERMINATE result. Existing rules that do not require `line_coverage` (including CT-INT-001) are unaffected and keep their normal verdicts. See `docs/adr/030-draft-rules-produce-no-verdicts.md`.

Setup: run your coverage tool to produce a JSON report (Istanbul-style `{ "covered": { "/abs/file.js": [null|1, ...] } }`), then invoke `checktest --test <file> --coverage-report <report.json>`.

**Source:** `src/providers/coverage.ts`, `src/cli.ts` (`--coverage-report`), `src/core/evidence.ts` (EvidenceRecord), `src/reporters/json.ts`.

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

- **Locations are partial and line-only.** A result carries `locations[]` only
  when its finding carries a source location (the evidence record that produced
  the verdict has one — e.g. an assertion-bearing test). Findings with no
  location get NO `locations` key; no position is fabricated. `column` is never
  populated by any producer, so `region.startColumn` is effectively absent.
- **Coverage records lack a location.** The external coverage provider
  (`src/providers/coverage.ts`) keys records by file in a map and never sets
  `location`, so a verdict resting on coverage evidence cannot point at a source
  line.
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
- **No consuming rule yet.** No rule declares `mutation_score` as required evidence,
  so `--mutation-report` never changes a verdict — it only adds a record to the JSON
  report. Existing rules behave exactly as before (roadmap:1089).
- **Missing ≠ zero.** A missing, unreadable, malformed, or unsupported report (no
  `files` key, wrong/absent `schemaVersion`) yields an explicit `UNKNOWN` record with
  a reason. It is never read as a mutation score of zero (roadmap:1087).
- **Stale ≠ definitive.** A report whose `source_revision` disagrees with the analysed
  revision yields `UNKNOWN` records carrying the mismatch reason instead of a
  definitive score (roadmap:1088).
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
- **No-tests behavior** (a file with zero recognized declarations, e.g. `case-18-no-tests`): `analysisStatus` stays `SUCCESS` (the analysis itself completed), `evaluationStatus` is `FAILED`, `ruleResults`/`testResults` stay empty, CLI exits `2`. Source: `src/cli.ts:299` (`const exitCode = scopes.some(...) ? 0 : 2`), contract pinned in `tests/cli.test.ts:259-282`. Exit `2` is the single "no verdict" bucket; exit `0` means at least one scope reached `EVALUATED`; exit `1` stays reserved for usage errors/crashes.
