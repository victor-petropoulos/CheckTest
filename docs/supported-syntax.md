# Supported Syntax

This document describes the syntax and framework constructs that CheckTest Milestone-1 recognizes, the assertion forms it classifies, the executability establishment rule, and the declared analysis scope.

---

## Framework Allowlist

Both **Jest** and **Vitest** are supported. The detector recognizes **runtime** imports from:

- `jest`
- The 12 `@jest/*` subpaths in `JEST_RUNTIME_SPECIFIERS` that ship runtime code:
  `@jest/console`, `@jest/core`, `@jest/expect`, `@jest/expect-utils`, `@jest/fake-timers`,
  `@jest/globals`, `@jest/reporters`, `@jest/schemas`, `@jest/source-map`,
  `@jest/test-result`, `@jest/test-sequencer`, `@jest/transform`
- `vitest` and `vitest/*`

It also recognizes one non-import runtime signal: a member call `vi.<name>(...)` whose receiver is the bare identifier `vi` (Option A, 2026-11-02). Vitest's `globals: true` exposes `vi` on the global scope, so a globals-enabled file may use it with no import declaration; such a call marks the file Vitest. A property named `vi` on another object (`obj.vi.fn()`) or a longer identifier (`myvi.fn()`) does not count.

Type-only imports (`import type ...` or all-type named imports) are ignored — they prove nothing about the runtime framework.

Any other framework (Mocha, Jasmine, etc.), a test file with no runtime framework evidence, or a file carrying two different frameworks (e.g., a Jest import plus `vi.*` usage) results in `AnalysisStatus.UNSUPPORTED` with `Completeness.NOT_APPLICABLE`. Mixed-framework files report `MIXED_FRAMEWORK` (not first-wins). Vitest is supported (B1, 2026-11-01): `it`/`test` declarations from a `vitest` import or `vi.*` evidence are collected like Jest.

**Source:** `src/adapters/typescript/support.ts:19` (`SUPPORTED_FRAMEWORKS = ['jest', 'vitest']`), `src/adapters/typescript/support.ts:99` (`JEST_RUNTIME_SPECIFIERS`), `src/adapters/typescript/support.ts:137` (`detectFramework`), `src/adapters/typescript/support.ts:176` (`isGlobalViMemberCall`), `src/adapters/typescript/support.ts:191` (`isTypeOnlyImport`), `src/adapters/typescript/collector.ts:184-187` (unsupported on non-supported framework), `tests/fixtures/ct-int-001/case-15-mixed-framework` (fixture 15), `tests/fixtures/ct-int-001/case-24-vitest-standard` (fixture 24), `tests/fixtures/ct-int-001/case-28-global-vi` (fixture 28).

---

## Assertion Forms (11 forms, A9)

The following 11 assertion form IDs are recognized. Each maps to a Jest matcher on an `expect(...)` chain. **These 11 strings are the verbatim elements of `SUPPORTED_ASSERTION_FORMS` in `src/adapters/typescript/support.ts:22-33`.**

| Form ID                            | Matcher                                                                    | Syntax Example                                                      |
| ---------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `expect-to-be`                     | `toBe`                                                                     | `expect(1 + 1).toBe(2)`                                             |
| `expect-to-equal`                  | `toEqual`                                                                  | `expect({ a: 1 }).toEqual({ a: 1 })`                                |
| `expect-to-be-truthy`              | `toBeTruthy`                                                               | `expect(value).toBeTruthy()`                                        |
| `expect-to-be-falsy`               | `toBeFalsy`                                                                | `expect(value).toBeFalsy()`                                         |
| `expect-to-throw`                  | `toThrow`                                                                  | `expect(() => { throw new Error('x'); }).toThrow('x')`              |
| `expect-rejects-to-throw`          | `rejects.toThrow`                                                          | `await expect(Promise.reject(new Error('x'))).rejects.toThrow('x')` |
| `expect-to-match-snapshot`         | `toMatchSnapshot`                                                          | `expect(rendered).toMatchSnapshot()`                                |
| `expect-to-contain`                | `toContain`                                                                | `expect(array).toContain(item)`                                     |
| `expect-matcher-utils`             | `expect.any` / `objectContaining` / `arrayContaining` / `stringContaining` | `expect(x).toEqual(expect.objectContaining({ a: 1 }))`              |
| `expect-to-match-object`           | `toMatchObject`                                                            | `expect(obj).toMatchObject({ a: 1 })`                               |
| `expect-to-have-been-called-times` | `toHaveBeenCalledTimes`                                                    | `expect(mock).toHaveBeenCalledTimes(1)`                             |

**Source:** `src/adapters/typescript/support.ts:22-30` (`SUPPORTED_ASSERTION_FORMS`), `src/adapters/typescript/support.ts:42-49` (`ASSERTION_FORM_BY_MATCHER`), `src/adapters/typescript/support.ts:199-224` (`classifyForm`).

### Recognized Shapes

1. **Synchronous**: `expect(<arg>).<matcher>(...)` where `<matcher>` is one of the 6 sync matchers above.
2. **Async rejects**: `await expect(<promise>).rejects.toThrow(<matcher>?)` — the only async form in the allowlist.

### Not Recognized (recorded as unsupported forms)

- `expect(x).toBeDefined()`, `expect(x).not.toBe(...)` — matcher not in the 11 forms.
- `expect(x)[computedMatcher]()` — matcher name is not statically resolvable.
- `expect(x).rejects.toBe(...)` — `rejects.toBe` is not in the allowlist.
- Chai-style `assert.equal(x, y)`, `should`, `expect(...).to.be.*` — namespace `assert`/`chai`/`should` is in `UNSUPPORTED_ASSERTION_NAMESPACES`.

---

## Executability Establishment Rule (A7)

An assertion is **established** (counted toward `assertion_count`) **only** when it appears in the **straight-line body** of a test function — the exact definition is in [Straight-Line Body](#straight-line-body-e) below.

An assertion is **unestablished** (not counted, availability becomes `UNKNOWN`) when:

| Condition                                                                                                                       | Reason reported                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| After an unconditional `return` or `throw` in the same block                                                                    | `assertion appears after an unconditional return/throw; execution cannot be established statically`                 |
| Inside a nested block or control-flow construct (`if`/`else`, loop, `try`/`catch`/`finally`, `switch`, `do`, labeled statement) | `assertion is inside a nested block (if/loop/try/switch); straight-line execution cannot be established statically` |
| Inside a nested callback (arrow function, function expression, or function declaration nested in the test body)                 | `assertion is inside a callback; callback execution cannot be established statically`                               |
| Inside a test declaration whose form is not fully supported (`each`, `skip`, `only`, …)                                         | `'it.each' is not a supported test declaration form; how often its body runs cannot be established statically`      |

**Recognition completeness** (whether the collector _recognized_ the construct) is separate from **executability**. A recognized but unestablished assertion leaves `analysis.completeness = COMPLETE` but `evidence.assertion_count.availability = UNKNOWN`. An **unrecognized declaration form** is a recognition gap and additionally leaves `completeness = INCOMPLETE`.

**Source:** `src/adapters/typescript/collector.ts:68-73` (the three reason constants), `src/adapters/typescript/collector.ts:492-540` (`scanTestBody`), `src/adapters/typescript/collector.ts:542-555` (`isControlFlow`), `src/adapters/typescript/collector.ts:570-600` (`describeAssertion`).

### Examples

**Established (counts):**

```ts
it('adds', () => {
  expect(1 + 1).toBe(2); // straight-line body
});
```

**Unestablished — after return (does not count):**

```ts
it('returns before', () => {
  return;
  expect(1 + 1).toBe(2); // after unconditional return
});
```

**Unestablished — in callback (does not count):**

```ts
it('asserts in callback', (done) => {
  setTimeout(() => {
    expect(1 + 1).toBe(2); // inside nested callback
    done();
  }, 1);
});
```

**Unestablished — inside a nested block (does not count):**

```ts
it('asserts in a loop', () => {
  for (const value of []) {
    expect(value).toBe(1); // inside a loop — may never run
  }
});
```

---

## Straight-Line Body (E)

This is the definition of _straight-line_ used by the flow analysis in `scanTestBody`. It is a **syntactic shape test, not a dataflow analysis** — no branch conditions, loop trip counts or exception paths are evaluated.

An assertion is straight-line when **all five** rules hold:

| #   | Rule                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | It is a top-level statement of the test body (or the entire body of a concise arrow, `() => expect(x).toBe(1)`).                                                                                          |
| 2   | No top-level `return` or `throw` precedes it in that block. The first such statement ends the straight-line region; everything after it is unreachable.                                                   |
| 3   | It is **not** nested inside a block or control-flow construct — `if`/`else`, `for`/`for-in`/`for-of`, `while`, `do`, `try`/`catch`/`finally`, `switch`, or a labeled statement. These may or may not run. |
| 4   | It is not inside a function nested in the body (arrow function, function expression, or function declaration). That is a callback.                                                                        |
| 5   | Its enclosing declaration is a bare `it(name, fn)` / `test(name, fn)` — a modifier form (`each`, `skip`, `only`, …) changes how often the body runs in ways milestone-1 does not model.                   |

Failing a rule does **not** make the assertion unrecognized. It is still classified and reported; it only loses `established`, so it is excluded from the count and the availability becomes `UNKNOWN`. Presence alone never proves execution.

The outermost reason wins when several apply — an assertion after a `return` that also sits in a callback reports the `return`.

**Source:** `src/adapters/typescript/collector.ts:464-491` (the five rules, written in full above `scanTestBody`), `src/adapters/typescript/collector.ts:542-555` (`isControlFlow` — the construct list behind rule 3).

---

## Test Declarations (F)

Every `it` / `test` call site in the file is located and reported. A declaration is **never silently omitted**: the evidence record always carries `N test declaration(s) recognized, M not fully supported: …` whenever `M > 0`.

**Fully supported — the only form that can establish assertions:**

| Form                                 | Example                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| Bare declaration with an inline body | `it('name', () => { … })`, `test('name', function () { … })` |

**Detected, but not fully supported (declared unsupported):**

| Form                     | Example                                                                    | Why not supported                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `each` (call form)       | `test.each([[1, 2]])('adds', (a, b) => { … })`                             | the body runs once per table row; row count is not statically enumerable                                            |
| `each` (tagged template) | ``test.each`row ${n}`('adds', (n) => { … })``                              | same                                                                                                                |
| `skip`                   | `it.skip('name', () => { … })`                                             | the body does not execute at all                                                                                    |
| `only`                   | `it.only('name', () => { … })`                                             | changes the executed test set; milestone-1 reports conservatively rather than modelling the filter                  |
| `todo`                   | `it.todo('name')`                                                          | declaration only — no executable body, contributes no assertions                                                    |
| `failing`                | `it.failing('name', () => { … })`                                          | the body is expected to throw; its assertions do not run                                                            |
| `concurrent`             | `it.concurrent('name', () => { … })`                                       | concurrent execution order is not modelled                                                                          |
| Chained modifiers        | `test.concurrent.only('name', () => { … })`, `it.skip.each(t)('name', fn)` | the whole chain is recognized and reported as one declaration, modifier recorded as `concurrent.only` / `skip.each` |
| `skipIf` / `runIf`       | `it.skipIf(cond)('name', () => { … })`                                     | the condition is a runtime value                                                                                    |
| Any other modifier       | `it.whatever('name', () => { … })`                                         | unrecognized modifier on a recognized root — reported, never dropped                                                |
| Non-inline body          | `it('name', helperFn)`                                                     | the body is an identifier the collector cannot resolve or scan                                                      |

**Detection is by root, not by an enumerated modifier list.** Any call whose callee peels down to the identifier `it` or `test` — through `.modifier`, `f(...)` chaining or a tagged template — is a declaration. That is why an _unrecognized_ modifier (`it.whatever`) is still reported instead of vanishing.

Calls rooted at anything else (`describe`, `beforeEach`, a local helper) are **not test declarations** and are correctly out of scope.

### Status and completeness consequences

**Scope of this table: the FILE-LEVEL aggregate record** (`AnalysisOutput.evidence`), not a per-declaration record. A per-declaration record is scoped to one site and is tabulated separately under [Five Declaration Gaps](#five-declaration-gaps-each-gets-its-own-record) — the two scopes do not necessarily agree, and reading one as the other is the source of the `it.todo` contradiction tracked as DPC-1.

| Situation (file-level aggregate)                                              | `coverage.status` | `analysis.completeness` | `availability` |
| ----------------------------------------------------------------------------- | ----------------- | ----------------------- | -------------- |
| All declarations bare, all assertions established                             | `COMPLETE`        | `COMPLETE`              | `KNOWN`        |
| Declaration-only form (`it.todo`) — body provably absent, so nothing was lost | `COMPLETE`        | `COMPLETE`              | `KNOWN`        |
| Modifier form **with** a body, or a non-inline body                           | `PARTIAL`         | `INCOMPLETE`            | `UNKNOWN`      |

The rows are single-cause shorthands: a declaration-only form is not a capability gap (`collector.ts:133-135` `isCapabilityGap`), so a file whose ONLY gaps are declaration-only aggregates as `COMPLETE`/`KNOWN` above — but one declaration-only form mixed with any capability gap makes the aggregate `PARTIAL`/`UNKNOWN` (the fold-in is at `collector.ts:320-328`).

**Source:** `src/adapters/typescript/support.ts:278-339` (`TEST_DECLARATION_NAMES`, `classifyTestDeclaration`), `src/adapters/typescript/collector.ts:517-530` (`findTestDeclarations`), `src/adapters/typescript/collector.ts:537-566` (`declarationSite` — the four gap states), `src/adapters/typescript/collector.ts:133-135` (`isCapabilityGap`), `src/adapters/typescript/collector.ts:455-465` (`declarationGapReason`), `src/adapters/typescript/collector.ts:309-368` (`supported` — status/completeness fold-in).

---

## Declared Scope: `test-body` Only (A1)

Milestone-1 analyzes **only the body of `it` / `test` calls** in the single file passed to `--test`.

- Cross-file helper resolution: **out of scope**. A call like `expectValidUser(id)` is recorded as an unsupported form with reason `custom assertion helper is out of the declared test-body scope` — never silently dropped. The same holds for a test body passed as an identifier (`it('x', helper)`).
- Runtime execution: **out of scope**. The test file is never executed (`runtime_execution` capability is `UNAVAILABLE`).
- Table-driven tests (`test.each`), `.skip` / `.only` bodies: **detected and reported** as declarations, but their bodies are not analyzed — see [Test Declarations](#test-declarations-f).

**Source:** `src/adapters/typescript/support.ts:16` (`ANALYSIS_SCOPE = 'test-body'`), `src/adapters/typescript/collector.ts:227` (`custom_helper_resolution: UNAVAILABLE`), `src/adapters/typescript/support.ts:67` (`CUSTOM_HELPER_NAME_PATTERNS`), `src/adapters/typescript/collector.ts:537-566` (`declarationSite` — the non-inline body gap).

---

## Framework Detection

Detection is deterministic. **Runtime evidence** — import declarations plus the one `vi.*` identifier signal — is authoritative. When there is none, a single **derived** fallback recognizes the bare-global test shape and records that inference honestly.

Runtime evidence (authoritative):

1. Only runtime imports count (type-only imports are ignored).
2. `jest` or a `JEST_RUNTIME_SPECIFIERS` subpath → Jest; `vitest` or `vitest/*` → Vitest.
3. A member call `vi.<name>(...)` on the bare identifier `vi` → Vitest (Option A, 2026-11-02). This is the one runtime identifier-usage signal, because Vitest's `globals: true` exposes `vi` globally and a globals-enabled file needs no import. A property named `vi` on another object (`obj.vi.fn()`) or a longer identifier (`myvi.fn()`) is not the global and is ignored.
4. Two different frameworks detected → `MIXED_FRAMEWORK` (not first-wins). A Jest import plus `vi.*` usage is `MIXED_FRAMEWORK`.

Derived fallback (P1.3, only when steps 1–4 found nothing):

5. A file that declares a bare **fully-supported** `it(...)`/`test(...)` call site **and** calls bare `expect(...)`, with no framework import and **no** local binding of `it`/`test`/`describe`/`expect`, is reported as `jest` with `derived: true` (`Provenance.DERIVED`, not a runtime observation). The collector publishes `framework_detection: PARTIAL` in `capabilities` and names the inference in the `assertion_count` evidence `reason`.
   - **Only the bare declaration form counts:** modifier/chained declarations (`it.each(t)(...)`, `test.concurrent.only(...)`) do **not** trigger the fallback. Their bodies are not scanned and are reported as unsupported-form gaps, so they must never be the reason a file is labelled `jest`.
   - **Why conservative:** bare `describe`/`it`/`test`/`expect` globals are shared by Jest, Mocha, Chai, Jasmine and Vitest, so the shape cannot be told apart statically. A file derived as `jest` may actually run under Mocha/Chai; assertions are therefore counted **only** when the matcher matches a `SUPPORTED_ASSERTION_FORMS` entry. An unsupported matcher form (e.g. Chai `expect(x).to.equal(y)`) is recorded as an unclassified construct → `PARTIAL` → `INDETERMINATE`, never a fabricated zero.
   - **`expect(` is required:** a file whose assertions live only in an unsupported API (supertest's fluent `.expect(200)`, chai, should) is left `UNKNOWN_FRAMEWORK`/`UNSUPPORTED`, so an unseen assertion can never be read as a proved zero-assertion `FAIL` (case-30).
   - **Imported names suppress the fallback:** `import { it } from 'mocha'`, `import type { it } from 'vitest'`, or any import binding of `it`/`test`/`describe`/`expect` makes those identifiers local, not globals (see case-10, case-26).

6. No runtime framework evidence and no bare-global declaration shape → `UNKNOWN_FRAMEWORK` → `UNSUPPORTED`.
7. No other heuristic on identifier usage: a variable or property named `expect` (e.g. `expect.extend(...)` at file scope with no declaration) still does not imply Jest.

**Source:** `src/adapters/typescript/support.ts:170` (`detectFrameworkDetail`), `src/adapters/typescript/support.ts:217` (`detectFramework`), `src/adapters/typescript/support.ts:253` (`isBareTestDeclarationCall`), `src/adapters/typescript/support.ts:265` (`isBareExpectCall`), `src/adapters/typescript/support.ts:226` (`collectImportedNames`), `src/adapters/typescript/support.ts:176` (`isGlobalViMemberCall`), `src/adapters/typescript/support.ts:99` (`JEST_RUNTIME_SPECIFIERS`), `src/adapters/typescript/support.ts:191` (`isTypeOnlyImport`), `src/adapters/typescript/collector.ts:89` (`FRAMEWORK_DERIVED_REASON`), `tests/fixtures/ct-int-001/case-28-global-vi` (fixture 28), `tests/fixtures/ct-int-001/case-29-bare-global-jest` (fixture 29), `tests/fixtures/ct-int-001/case-30-bare-global-without-expect` (fixture 30).

---

## Vitest-Specific Forms (SP1, 2026-11-06)

Milestone-1 treats Vitest and Jest symmetrically for the **supported** forms (bare `it`/`test` declarations, the 11 assertion matchers, the `vi.*` global signal). The eight fixtures added in SP1 (cases 31–38) document the **unsupported** Vitest forms that the collector recognizes but does not analyze — they produce INDETERMINATE or FAIL per the same rules that apply to the equivalent Jest forms.

| Form                                                                                      | Fixture | Status                     | Completeness | Availability | `rule_result` | `reason_contains`                                                |
| ----------------------------------------------------------------------------------------- | ------- | -------------------------- | ------------ | ------------ | ------------- | ---------------------------------------------------------------- |
| `it.each([[...]])(name, fn)` — array-table form                                           | case-31 | UNSUPPORTED-form gap       | INCOMPLETE   | UNKNOWN      | INDETERMINATE | `["it.each", "not a supported test declaration form"]`           |
| `it.each\`template\`` — tagged-template form                                              | case-32 | UNSUPPORTED-form gap       | INCOMPLETE   | UNKNOWN      | INDETERMINATE | `["it.each", "not a supported test declaration form"]`           |
| `it.todo('name')` — declaration-only, no body                                             | case-33 | DECLARATION-ONLY gap       | COMPLETE     | KNOWN        | FAIL          | `["it.todo", "declares no executable test body"]`                |
| `it.skip('name', fn)` — modifier with body                                                | case-34 | UNSUPPORTED-form gap       | INCOMPLETE   | UNKNOWN      | INDETERMINATE | `["it.skip", "not a supported test declaration form"]`           |
| `it.skipIf(cond)('name', fn)` — conditional modifier                                      | case-35 | UNSUPPORTED-form gap       | INCOMPLETE   | UNKNOWN      | INDETERMINATE | `["it.skipIf", "not a supported test declaration form"]`         |
| Exported test fn (`export function testFoo() { … }`) — no `it`/`test` call site           | case-36 | No declaration recognized  | COMPLETE     | KNOWN        | FAIL          | `[]` (0 assertions, no declaration gap)                          |
| `.not.toThrow()` — negated matcher                                                        | case-37 | Unsupported assertion form | INCOMPLETE   | UNKNOWN      | INDETERMINATE | `["expect matcher is not one of the supported assertion forms"]` |
| Vitest-only matchers (`toHaveLength`, `toBeCloseTo`, `toBeGreaterThan`, `toBeCalledWith`) | case-38 | Unsupported assertion form | INCOMPLETE   | UNKNOWN      | INDETERMINATE | `["expect matcher is not one of the supported assertion forms"]` |

**Why these are INDETERMINATE, not FAIL:** The five unsupported-form gaps (`it.each`, `it.skip`, `it.skipIf`, `.not.toThrow`, vitest-only matchers) carry `availability: UNKNOWN`, so `unknown_evidence_policy` (default INDETERMINATE) applies — see [Five Declaration Gaps](#five-declaration-gaps-each-gets-its-own-record) and [Unestablishable Declarations Never FAIL](#unestablishable-declarations-never-fail). The two FAIL outcomes (`it.todo`, exported-test-fn) have `availability: KNOWN` with `value: 0`; CT-INT-001 requires at least one assertion, so 0 asserts FAIL.

**Supported Vitest forms (unchanged from Jest):** bare `it('name', fn)` / `test('name', fn)` with inline body; all 11 assertion matchers on `expect(...)` chains; `vi.<name>(...)` global member calls as a Vitest runtime signal. These behave identically to their Jest counterparts.

**Source:** `tests/fixtures/ct-int-001/case-31-vitest-it-each-array`, `case-32-vitest-it-each-template`, `case-33-vitest-it-todo`, `case-34-vitest-it-skip`, `case-35-vitest-it-skipif`, `case-36-vitest-exported-test-fn`, `case-37-vitest-not-to-throw`, `case-38-vitest-matchers`.

---

## Per-Test Evidence Granularity (v0.3)

### What Counts as One Test

One test = **one `it` / `test` call site** in the source file. The collector locates every declaration (`src/adapters/typescript/collector.ts:517-530` `findTestDeclarations`) and assigns a deterministic identity:

```
<file>#<declaration>@<line>
```

Example: `sample.test.ts#it@2` for `it('adds', () => { ... })` on line 2.

The identity uses the **declaration form as written** (`declaration` field): `it`, `test`, `it.each`, `test.each`, `it.skip`, `it.only`, `it.todo`, `it.failing`, `it.concurrent`, `it.skipIf`, `it.runIf`, or any unrecognized modifier chain (e.g., `test.concurrent.only`).

Declarations are reported in **source order** (AST walk order at `collector.ts:519-528`). This order is deterministic — no counters, no clock, no reordering.

### Five Declaration Gaps (Each Gets Its Own Record)

Every declaration receives a `TestScopeResult` (`src/core/analysis.ts:97-103`) with its own evidence and `declaration_gap` field. Five gap forms are **never silently dropped**:

`declaration_gap` holds the human-readable reason string itself (null on a fully scanned test), so the gap kind is readable from the text; the values below are verbatim from `collector.ts:455-465` (`declarationGapReason`).

| Gap Kind             | Forms                                                                                                                                  | `declaration_gap` Value                                                                                                            | Coverage                                                                  | Availability                                                                                                     | Can FAIL? |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| **declaration-only** | `it.todo('name')`, and any no-body form (`it.skip('name')`)                                                                            | `"'it.todo' declares no executable test body; it contributes no assertions"`                                                       | UNAVAILABLE                                                               | UNKNOWN                                                                                                          | **Never** |
| **unresolved-body**  | `it('name', helperFn)`                                                                                                                 | `"'it' body is not an inline function; the collector cannot resolve or scan it"`                                                   | PARTIAL                                                                   | UNKNOWN                                                                                                          | **Never** |
| **unsupported-form** | `it.each(...)`, `it.skip`, `it.only`, `it.failing`, `it.concurrent`, `it.skipIf`, `it.runIf`, unrecognized modifier, chained modifiers | `"'it.each' is not a supported test declaration form; how often its body runs cannot be established statically"`                   | PARTIAL                                                                   | UNKNOWN                                                                                                          | **Never** |
| **conditional**      | `(c ? it.skip : it)(...)`, `(c ? it : helper)(...)`, `(flag && it.skip)(...)`, `(cond                                                  |                                                                                                                                    | it)(...)` (compound callees; one or both operands resolve to a test root) | `"'it.conditional' is a conditional declaration (...); which declaration runs cannot be established statically"` | PARTIAL   | UNKNOWN | **Never** |
| **aliased**          | `const t = it; t(...)` / `let t = it; t(...)` (verified in-file alias)                                                                 | `"'it.aliased' is declared through a verified in-file test alias (it); the collector reports it without establishing how it runs"` | PARTIAL                                                                   | UNKNOWN                                                                                                          | **Never** |

The gap kind is decided by (has inline callback) × (has modifier) at `collector.ts:546-554`, so `it.skip('name')` — a modifier form with no body at all — lands in **declaration-only**, not **unsupported-form**: no body exists to scan, and the reason still names the form (`'it.skip'`), so the modifier is never lost.

**Conservative non-FAIL rule:** A declaration with `availability: UNKNOWN` (all three gaps: declaration-only, unresolved-body, unsupported-form) is **never** read as zero assertions and turned into FAIL. The rule's `unknown_evidence_policy` applies (default `INDETERMINATE`). This is enforced per test, not file-wide (SPEC:425 applied per declaration).

A `declaration-only` form (`it.todo`) has no body to scan, so it gets its **own** record with no value, `coverage.status: UNAVAILABLE` and availability `UNKNOWN` (`src/adapters/typescript/collector.ts:394-400` the gap→coverage mapping, `:402-413` the value/availability pair, `src/core/evidence.ts:99-109`) — a record that can never become the basis of a FAIL verdict. Its analysis completeness stays `COMPLETE` (`collector.ts:427-430`): the declaration form itself was fully understood.

### Declaration Boundary Enforcement

- An assertion found in one declaration's body is **never** attributed to another (`src/adapters/typescript/collector.ts:683-701` `collectTestBodyFindings` returns findings per declaration; `collector.ts:644-646` stops a scan at a nested declaration node)
- A conflict on test A's evidence record never alters test B's verdict (`src/core/evaluation.ts:147-172` `evaluateTests` runs `decide` on each scope independently)
- A gap on test A's record leaves test B's value, availability and `declaration_gap` byte-identical (`tests/adapters/collector.test.ts:418-436` asserts the `it.todo` sibling case)
- The file-level `evidence` record remains the aggregate for backward compatibility

### Framework Detection Stays File-Scoped

Per-test framework detection is **impossible** because imports are module-scoped. A mixed-framework file is `UNSUPPORTED` at the file level and emits **no per-test records** (a per-test PASS on an unsupported file would be the over-claim rejected in KickOff:108-109).

---

## Provenance Reachability (WP1.4 / DPC-3)

Every evidence record carries a `provenance` value (`src/core/evidence.ts:14-18`) that identifies where the value came from — not how certain it is.

| Provenance | Producer                                                                                                                                                                                                                                                                                  | Reachable in Milestone-1                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `DIRECT`   | `src/adapters/typescript/collector.ts:267` (failed scan), `:294` (unsupported framework), `:336` (file-level aggregate record), `:408` (per-declaration record)                                                                                                                           | YES — 4 sites in the AST collector                                                                                                          |
| `DERIVED`  | `src/adapters/typescript/regex-assertion-count.ts:51` (regex stub that produces the fixture-13 conflict)                                                                                                                                                                                  | YES — test-only stub; no `src/` module imports it                                                                                           |
| `EXTERNAL` | `src/providers/coverage.ts:90` (Istanbul file record), `:146` (c8 file record), `:281` (missing-file fallback), `:331` (per-declaration record); `src/providers/mutation.ts:194` (unavailable revision), `:210` (scoring failure), `:225` (scored record), `:360` (missing-file fallback) | YES — reachable via the coverage provider (file-level + per-declaration, by line-range overlap) and the mutation provider (file-level only) |

This is documentation of reachability, not a test guarantee: `DIRECT` and `DERIVED` are observed in the AST collector, and `EXTERNAL` is now observed reachable via the coverage provider (file-level + per-declaration by line-range overlap) and the mutation provider (file-level only). Neither provider populates `location`; mutation has no per-declaration attribution.
