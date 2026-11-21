# Adapter conformance fixture catalog

**Type:** Reference (Diátaxis). **Audience:** WP6 harness implementer and adapter implementers. **Spec:** [docs/adapter-conformance.md](../../docs/adapter-conformance.md). **Wire contract:** [docs/reporting-contract.md](../../docs/reporting-contract.md) at `schemaVersion: 0.5`.

Shared, hand-checkable fixtures for initiative WP5 §5.3–5.4 (Baseline:1806-1844). Each entry has a stable ID, one source example per supported language where semantics permit, and a `<ID>.expected.json` sidecar. Sidecars describe expected normalized evidence, verdicts and diagnostics; they are **expectations**, not reports, and no sidecar claims to be a valid 0.5 report. Any value they carry uses the 0.5 vocabulary and field names (`schemas/checktest-report.schema.json:287-357,361-426`). No fixture introduces a new rule: applicability is limited to the five registered rules CT-INT-001, CT-INT-003, CT-INT-004, CT-COV-001, CT-MUT-001 (`docs/rules/catalog.md:24,179-183`).

Evidence shorthand: **AC** = `assertion_count`; **UA** = the `unestablished_assertions` signal on the per-declaration AC record; **UC** = the `unclassified_constructs` signal on that record. Every expected evidence record carries the required 0.5 fields `value`, `availability`, `provenance`, `source`, `collector_version`, `scope`, `coverage` (`schemas/checktest-report.schema.json:290`). Source/version constants: TS `typescript-jest-adapter` / `0.1.0` (`src/adapters/typescript/support.ts:33-37`), Python `python-pytest-adapter` / `0.1.0` (`src/adapters/python/support.ts:23-27`). Verdict vocabulary: `PASS | FAIL | INDETERMINATE | N/A` (`schemas/checktest-report.schema.json:197-200`); an aborted scope has **no** verdict and `evaluationStatus: FAILED` (`schemas/checktest-report.schema.json:163-166`).

Twin policy: TS (jest/vitest) and Python (pytest) twins exist for scenarios whose framework semantics are equivalent. Where the Python collector's exact declaration/helper/parameterization handling was not verified at WP5, the expectation is marked **NOT_VERIFIED** and WP6 must confirm it against the collector before treating it as binding; that is a limitation, not a licence to invent a verdict. External-evidence fixtures are TS-only because TS and Python adapters forward `AdapterOptions` differently (`src/adapters/typescript/adapter.ts:69-70` forwards only `declaredType`; `src/adapters/python/adapter.ts:91-100` forwards coverage/map/per-test options too).

---

### CF-DISC-001 — two-test discovery and identity

- **Purpose:** stable discovery order and per-declaration identity for two tests in one file.
- **Source:** `fixtures/CF-DISC-001/sample.ts`, `sample.py`.
- **Language + framework:** TypeScript/vitest; Python/pytest twin.
- **Expected discovery:** 2 declarations, in source order, at the declaration lines in the sidecar; ids follow `<file>#<declaration>@<line>:<index>` (`schemas/checktest-report.schema.json:430`).
- **Expected normalized evidence:** each declaration has its own AC record; no sibling sharing (`schemas/checktest-report.schema.json:472-478`).
- **Expected applicability:** CT-INT-001, CT-INT-003, CT-INT-004.
- **Expected verdict:** PASS for all three rules on both declarations.
- **Expected explanation:** one established assertion per test body; no unestablished or unclassified constructs.
- **Expected diagnostics:** envelope `analysisStatus: SUCCESS`, completeness `COMPLETE`; no reason keys on known records.
- **Known limitations:** exact Python declaration token is NOT_VERIFIED at WP5; WP6 must pin it from the collector, not guess a label.

### CF-ASSERT-001 — test with a valid assertion

- **Purpose:** baseline established assertion.
- **Source:** `fixtures/CF-ASSERT-001/sample.ts`, `sample.py`.
- **Language + framework:** TypeScript/vitest; Python/pytest twin.
- **Expected discovery:** 1 declaration.
- **Expected normalized evidence:** AC `value: 1`, `availability: KNOWN`, `provenance: DIRECT`, `coverage.status: COMPLETE`, `evidenceStrength: SYNTAX_OBSERVED`; UA count 0, UC count 0.
- **Expected applicability:** CT-INT-001, CT-INT-003, CT-INT-004.
- **Expected verdict:** PASS / PASS / PASS (in that order).
- **Expected explanation:** at least one established executable assertion; no unestablished constructs; no unclassified constructs.
- **Expected diagnostics:** no `reason` on the AC record; completeness COMPLETE.
- **Known limitations:** static shape only — no runtime claim (`docs/rules/catalog.md:126,138`).

### CF-ASSERT-002 — test without an assertion

- **Purpose:** zero assertions from a complete scan.
- **Source:** `fixtures/CF-ASSERT-002/sample.ts`, `sample.py`.
- **Language + framework:** TypeScript/vitest; Python/pytest twin.
- **Expected discovery:** 1 declaration.
- **Expected normalized evidence:** AC `value: 0`, `availability: KNOWN`, `coverage.status: COMPLETE`; UA/UC absent or count 0.
- **Expected applicability:** CT-INT-001, CT-INT-003, CT-INT-004.
- **Expected verdict:** CT-INT-001 FAIL; CT-INT-003 PASS; CT-INT-004 PASS.
- **Expected explanation:** FAIL is the numeric rule's zero-assertion outcome from COMPLETE evidence (`docs/rules/catalog.md:40,124`), not an analysis failure.
- **Expected diagnostics:** `analysisStatus: SUCCESS`, `evaluationStatus: EVALUATED`; no evidence `reason`.
- **Known limitations:** does not claim the test is behaviorally weak at runtime.

### CF-ASSERT-003 — multiple assertions

- **Purpose:** count aggregation within one test body.
- **Source:** `fixtures/CF-ASSERT-003/sample.ts`, `sample.py`.
- **Language + framework:** TypeScript/vitest; Python/pytest twin.
- **Expected discovery:** 1 declaration.
- **Expected normalized evidence:** AC `value: 2`, `availability: KNOWN`, `coverage.status: COMPLETE`.
- **Expected applicability:** CT-INT-001, CT-INT-003, CT-INT-004.
- **Expected verdict:** PASS / PASS / PASS.
- **Expected explanation:** two recognized assertion forms (`expect-to-be`, `expect-to-equal` for TS; `assert` for Python) in one test body.
- **Expected diagnostics:** none beyond known-status fields.
- **Known limitations:** count is form-based, not a semantic count of distinct checks.

### CF-COND-001 — assertion inside conditional logic

- **Purpose:** executability of an assertion is not established by static shape.
- **Source:** `fixtures/CF-COND-001/sample.ts`, `sample.py`.
- **Language + framework:** TypeScript/vitest; Python/pytest twin.
- **Expected discovery:** 1 declaration.
- **Expected normalized evidence:** AC carries a decidable UA signal (count ≥ 1 with a reason); `evidenceStrength: SYNTAX_OBSERVED`; coverage `PARTIAL` or INCOMPLETE status preserved, never promoted to COMPLETE.
- **Expected applicability:** CT-INT-001, CT-INT-003, CT-INT-004.
- **Expected verdict:** CT-INT-001 INDETERMINATE; CT-INT-003 FAIL when the UA signal is decidable; CT-INT-004 PASS when no UC signal exists.
- **Expected explanation:** conditional execution is not proven by the static test-body shape; CT-INT-003 reports the signal with the collector's reasons verbatim (`docs/rules/catalog.md:133-139`); INDETERMINATE is not a FAIL.
- **Expected diagnostics:** UA `reasons[]` names the conditional/branch shape; no fabricated location beyond the assertion line if known.
- **Known limitations:** no dataflow, branch-condition, loop-trip or exception-path analysis (`docs/rules/catalog.md:138`); if WP6 observes no decidable signal, CT-INT-003 must be INDETERMINATE and the fixture must be amended with evidence, not silently re-labelled.

### CF-HELPER-001 — assertion inside a helper

- **Purpose:** unresolvable custom assertion helper must not become a zero-assertion PASS.
- **Source:** `fixtures/CF-HELPER-001/sample.ts`, `sample.py`.
- **Language + framework:** TypeScript/vitest; Python/pytest twin.
- **Expected discovery:** 1 declaration.
- **Expected normalized evidence:** AC known gap: TS helper matched by `/^expect[A-Z_]/` or `/assert/i` (`src/adapters/typescript/support.ts:66-74`) → UC count ≥ 1 with reason; `coverage.status: PARTIAL`.
- **Expected applicability:** CT-INT-001, CT-INT-003, CT-INT-004.
- **Expected verdict:** CT-INT-001 INDETERMINATE; CT-INT-004 INDETERMINATE (UC count > 0, never FAIL by construction, `docs/rules/catalog.md:143-153`); CT-INT-003 INDETERMINATE unless a decidable UA signal is produced.
- **Expected explanation:** cross-file helper resolution is out of scope; absent evidence must be reported, not converted into a PASS or FAIL.
- **Expected diagnostics:** UC `reasons[]` records the unresolvable helper; completeness not COMPLETE.
- **Known limitations:** Python helper-name detection is NOT_VERIFIED at WP5; the Python twin's expectation is provisional pending WP6 confirmation.

### CF-SETUP-001 — assertion in setup/teardown

- **Purpose:** assertions outside the `test-body` construct are not test-body evidence.
- **Source:** `fixtures/CF-SETUP-001/sample.ts`, `sample.py`.
- **Language + framework:** TypeScript/vitest (`beforeEach`); Python/pytest (fixture with `yield`).
- **Expected discovery:** 1 declaration (the test body), not the setup hook.
- **Expected normalized evidence:** AC `value: 0`, `availability: KNOWN`, `coverage.status: COMPLETE` for the test body; the setup assertion is outside the scanned construct (`docs/reporting-contract.md:31,113`).
- **Expected applicability:** CT-INT-001, CT-INT-003, CT-INT-004.
- **Expected verdict:** CT-INT-001 FAIL; CT-INT-003 PASS; CT-INT-004 PASS.
- **Expected explanation:** the assertion exists in setup, but the rule's scope is the test body; no unclassified construct is claimed.
- **Expected diagnostics:** no invented reason; note in `knownLimitations` that runtime setup can assert.
- **Known limitations:** this is a scope limitation, not a statement about runtime verification; pytest fixture finalizer semantics differ from `afterEach` and are NOT_VERIFIED beyond scope boundary.

### CF-NEST-001 — nested structure

- **Purpose:** nested describe/scope blocks preserve distinct declaration identities.
- **Source:** `fixtures/CF-NEST-001/sample.ts`, `sample.py`.
- **Language + framework:** TypeScript/vitest; Python/pytest twin (class-based grouping).
- **Expected discovery:** 2 declarations at the lines in the sidecar; ids distinct and deterministic.
- **Expected normalized evidence:** per-declaration AC records; no aggregate standing in for either.
- **Expected applicability:** CT-INT-001, CT-INT-003, CT-INT-004.
- **Expected verdict:** PASS for all three rules on both declarations.
- **Expected explanation:** each test body contains its own established assertion.
- **Expected diagnostics:** none beyond known-status fields.
- **Known limitations:** grouping names are descriptive only; no suite-level verdict is inferred from a group.

### CF-PARAM-001 — parameterized tests

- **Purpose:** parameterized constructs must not be silently expanded into invented declarations or results.
- **Source:** `fixtures/CF-PARAM-001/sample.ts` (`it.each`), `sample.py` (`@pytest.mark.parametrize`).
- **Language + framework:** TypeScript/vitest; Python/pytest twin with different semantics.
- **Expected discovery:** 1 construct recorded; sidecar pins whether it yields a declaration. TS `it.each` cases are known INDETERMINATE (`docs/rules/catalog.md:221-222`).
- **Expected normalized evidence:** AC availability UNKNOWN or coverage PARTIAL with an unclassified-reason; no per-case numeric values invented.
- **Expected applicability:** CT-INT-001, CT-INT-003, CT-INT-004.
- **Expected verdict:** CT-INT-001 INDETERMINATE (both twins); CT-INT-004 INDETERMINATE when a UC signal exists; CT-INT-003 INDETERMINATE when a decidable UA signal is absent.
- **Expected explanation:** the collector cannot statically establish all generated cases; uncertainty preserved.
- **Expected diagnostics:** reason names the parameterized construct; no fabricated case count.
- **Known limitations:** pytest decorator expansion is NOT_VERIFIED at WP5; semantically it is not equivalent to vitest `it.each`, so cross-language evidence equality is NOT expected.

### CF-UNSUP-001 — unsupported syntax

- **Purpose:** unsupported assertion syntax reported explicitly.
- **Source:** `fixtures/CF-UNSUP-001/sample.ts` (`assert.equal`), `sample.py` (Hypothesis `@given`).
- **Language + framework:** TypeScript/vitest; Python/pytest.
- **Expected discovery:** 1 declaration.
- **Expected normalized evidence:** UC count ≥ 1 with reason; `coverage.status: PARTIAL`; AC never silently `KNOWN: 0` from a COMPLETE scan. TS namespace `assert` is listed at `src/adapters/typescript/support.ts:64`; Python publishes `unsupported-form` (`src/adapters/python/support.ts:52-54`).
- **Expected applicability:** CT-INT-001, CT-INT-003, CT-INT-004.
- **Expected verdict:** CT-INT-001 INDETERMINATE; CT-INT-004 INDETERMINATE; CT-INT-003 INDETERMINATE unless a decidable UA signal exists.
- **Expected explanation:** unrecognized constructs are absence of evidence, never a negative finding.
- **Expected diagnostics:** canonical reason string from the adapter's vocabulary, verbatim.
- **Known limitations:** assertion forms outside the 11/9 allowlists are gaps by design (`src/adapters/typescript/capabilities.ts:21-33`, `src/adapters/python/capabilities.ts:24-34`); an unrecognized non-namespace API is a documented milestone-1 gap (`src/adapters/typescript/support.ts:60-62`).

### CF-INCOMP-001 — incomplete analysis

- **Purpose:** unresolvable test body produces no verdict, not a fabricated one.
- **Source:** `fixtures/CF-INCOMP-001/sample.ts`, `sample.py`.
- **Language + framework:** TypeScript/vitest; Python/pytest twin.
- **Expected discovery:** 1 declaration whose body cannot be resolved statically.
- **Expected normalized evidence:** required evidence availability UNKNOWN with reason; no numeric value laundered into a verdict.
- **Expected applicability:** recorded as attempted; no rule reaches a decision.
- **Expected verdict:** none (`null`); `analysisStatus: FAILED` or `UNSUPPORTED`, `evaluationStatus: FAILED`, `ruleResults: []`.
- **Expected explanation:** the engine was never asked; `FAILED` is not a rule FAIL (`docs/reporting-contract.md:29,92-97,141`).
- **Expected diagnostics:** reason names the unresolvable construct; `summary.failed` counts the aborted scope with no per-result counter (`docs/reporting-contract.md:208-219`).
- **Known limitations:** Python twin's exact failure path is NOT_VERIFIED at WP5; WP6 must confirm the collector's status before asserting equality.

### CF-NORULE-001 — no rule applies

- **Purpose:** prove the "no rule applies" scenario without inventing a sixth rule.
- **Source:** `fixtures/CF-NORULE-001/sample.ts` (comments only, zero declarations), `sample.py` (comments only).
- **Language + framework:** TypeScript/vitest; Python/pytest twin.
- **Expected discovery:** 0 declarations.
- **Expected normalized evidence:** empty envelope and per-test evidence maps; no diagnostics invented.
- **Expected applicability:** `[]`. All five registered rules apply to all five concrete types, so N/A is unreachable in shipped registrations (`docs/rules/catalog.md:24`); CT-DEMO-001 is an unregistered test-only stub and is not used (`docs/rules/catalog.md:179-183`).
- **Expected verdict:** none (`null`); zero scopes, `evaluationStatus: FAILED`, `ruleResults: []`, `testResults: []`.
- **Expected explanation:** absence of declarations is absence of evaluation, not a PASS or FAIL (`docs/reporting-contract.md:92-97`).
- **Expected diagnostics:** no-adapter path is NOT used here: the file is supported, it simply yields zero scopes.
- **Known limitations:** this fixture is the honest interpretation of §5.4's "no rule applies" case under the shipped five-rule set.

### CF-COV-001 — externally supplied coverage evidence

- **Purpose:** ordinary mapped coverage stays file-level.
- **Source:** `fixtures/CF-COV-001/sample.ts`; TS-only by design (see twin policy above).
- **Language + framework:** TypeScript/vitest with an external coverage report supplied by the harness.
- **Expected discovery:** 1 declaration with its own static evidence; coverage is **not** copied into it.
- **Expected normalized evidence:** `line_coverage` in the **envelope** `evidence` map only: `value: 1`, `availability: KNOWN`, `provenance: EXTERNAL`, `coverage.status: COMPLETE`, `source` names the external provider. `testResults[].evidence` has no `line_coverage` key.
- **Expected applicability:** CT-COV-001; static rules remain applicable to their own evidence.
- **Expected verdict:** CT-COV-001 PASS (at least one covered line in the mapped production file); no per-test coverage verdict.
- **Expected explanation:** mapped coverage establishes only that the production file was exercised (`docs/rules/catalog.md:87,93,157-161`); absence of `test_id` is the non-attribution marker (`schemas/checktest-report.schema.json:414-417`).
- **Expected diagnostics:** on a missing/stale/partial/mismatched report, `availability: UNKNOWN` and CT-COV-001 INDETERMINATE — never FAIL (`docs/rules/catalog.md:94,160`).
- **Known limitations:** gap 6: never write this file-level metric into `testResults[].evidence`. `--per-test-run` attribution is a separate, documented mechanism (`docs/rules/catalog.md:93,160-162`) and is out of scope for this fixture. No schema version bump (ADR-042).

### CF-MUT-001 — externally supplied mutation evidence

- **Purpose:** suite/file-level mutation score never becomes an individual-test result.
- **Source:** `fixtures/CF-MUT-001/sample.ts`; TS-only by design (see twin policy above).
- **Language + framework:** TypeScript/vitest with an external Stryker-format mutation report.
- **Expected discovery:** 1 declaration; its per-test evidence map contains no mutation key.
- **Expected normalized evidence:** `mutation_score` in the **envelope** `evidence` map only: `value: 0.75`, `availability: KNOWN`, `provenance: EXTERNAL`, `coverage.status: COMPLETE`. No `test_id` on the CT-MUT-001 finding.
- **Expected applicability:** CT-MUT-001.
- **Expected verdict:** CT-MUT-001 PASS (0.75 ≥ fixed 0.5 threshold); no per-test mutation verdict.
- **Expected explanation:** file-level detected/valid only; CT-MUT-001 derives no per-declaration claim (`docs/rules/catalog.md:104,110,169-174`; `docs/reporting-contract.md:123-131`).
- **Expected diagnostics:** missing/unreadable/malformed/revision-mismatched/zero-valid-mutants report → INDETERMINATE, never FAIL ("no report != zero mutants", `docs/rules/catalog.md:111,174`).
- **Known limitations:** gap 6: a suite-level mutation result must not be presented as an individual-test result without a supported relationship; no such relationship is claimed here. Provider hints are declared-but-unconsumed by both adapters (`src/adapters/adapter.ts:35-38,158-164`).

---

## Catalog summary

| Fixture ID | §5.4 scenario | Primary verdict(s) |
|---|---|---|
| CF-DISC-001 | discovery/identity (category 1) | PASS ×3 per test |
| CF-ASSERT-001 | valid assertion | PASS / PASS / PASS |
| CF-ASSERT-002 | no assertion | FAIL / PASS / PASS |
| CF-ASSERT-003 | multiple assertions | PASS / PASS / PASS |
| CF-COND-001 | assertion in conditional | INDETERMINATE / FAIL / PASS |
| CF-HELPER-001 | assertion in helper | INDETERMINATE / INDETERMINATE / INDETERMINATE |
| CF-SETUP-001 | assertion in setup/teardown | FAIL / PASS / PASS |
| CF-NEST-001 | nested structure | PASS ×3 per test |
| CF-PARAM-001 | parameterized tests | INDETERMINATE |
| CF-UNSUP-001 | unsupported syntax | INDETERMINATE |
| CF-INCOMP-001 | incomplete evidence/analysis | no verdict (FAILED) |
| CF-NORULE-001 | no rule applies | no verdict (zero scopes) |
| CF-COV-001 | external coverage | CT-COV-001 PASS, file-level only |
| CF-MUT-001 | external mutation | CT-MUT-001 PASS, file-level only |

All 13 scenarios from Baseline:1828-1842 are represented; CF-DISC-001 adds explicit discovery/identity coverage. No sidecar uses a rule outside the five registered rules and none changes `schemaVersion` from `0.5`.

## Sidecar placeholder convention

Sidecars are expectations, not produced reports. Three string placeholders are resolved by the harness from verified adapter metadata before comparison; they are never literal expected values:

| Placeholder | Resolution | Source |
|---|---|---|
| `ADAPTER_SOURCE` | `typescript-jest-adapter` for TS, `python-pytest-adapter` for Python | `src/adapters/typescript/support.ts:34`, `src/adapters/python/support.ts:24` |
| `ADAPTER_FRAMEWORKS` | The adapter's `capabilities.frameworks` array | `src/adapters/typescript/capabilities.ts:18`, `src/adapters/python/capabilities.ts:18` |
| `ADAPTER_FORMS` | The adapter's `capabilities.assertionForms` array | `src/adapters/typescript/capabilities.ts:21-33`, `src/adapters/python/capabilities.ts:24-34` |
| `EXTERNAL_COVERAGE_PROVIDER` / `EXTERNAL_MUTATION_PROVIDER` | The actual external provider id emitted by the provider on this run; WP5 does not pin one, since provider hints are declared-but-unconsumed (`src/adapters/adapter.ts:35-38,158-164`) | wire field `source` at `schemas/checktest-report.schema.json:301-304` |

The literal `"MUST_BE_ABSENT"` marker in a fixture's `perTest` evidence map is a negative assertion: the harness must assert the key is absent, not compare it to a string. `test_id_present: false` on coverage/mutation findings is the gap-6 non-attribution check (`schemas/checktest-report.schema.json:414-417`).

Sidecar finding shape: `expectedFindings` is **per language** — a twin fixture compares `ts` findings against the TypeScript run and `python` findings against the Python run; entries equal the applicable rules for each declaration the language produces. Cross-language finding equality is never asserted (see the twin policy). Single-language fixtures (CF-COV-001, CF-MUT-001) carry a plain findings array. A fixture with no expected verdict carries `[]` plus `evaluationStatus: FAILED` in the envelope (`docs/reporting-contract.md:92-97`).
