# Rule Catalog

**Type:** Reference (Diátaxis). **Audience:** rule authors, reviewers, and report consumers who need to know what each shipped rule checks and what its verdict does not establish.

**Scope:** the five rules registered by the production CLI and the one unregistered stub. Registration is explicit, never an import side effect (`src/cli.ts`, `main()` registration comment); the five `registerRule` calls are in `src/cli.ts` `main()` (observed at `:589-593` on 2026-11-20; line numbers shift with unrelated CLI edits). Every field value below is read from the rule's `RuleMetadata` declaration; field semantics come from `src/core/rule.ts:138-225`. The per-rule data tables in the GENERATED section below are produced from that same metadata by `scripts/gen-rule-catalog.ts` (CI fails on regeneration drift); the per-rule prose sections are hand-written.

## Field schema

| Catalog field                    | `RuleMetadata` field                                                                                                      | Source                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Purpose                          | `description`                                                                                                             | `src/core/rule.ts:142`                                                                                    |
| Applicability                    | `applies_to`                                                                                                              | `src/core/rule.ts:143-144` (concrete types only; `UNKNOWN` never appears — unknown becomes INDETERMINATE) |
| Required evidence                | `required_evidence`                                                                                                       | `src/core/rule.ts:145`                                                                                    |
| Analysis scope                   | `analysis_scope`                                                                                                          | `src/core/rule.ts:156`                                                                                    |
| Evaluation                       | `evaluation`, `minimum_evidence_completeness`, `unknown_evidence_policy`, `conflicting_evidence_policy`, `local_decision` | `src/core/rule.ts:157-180`                                                                                |
| Evidence completeness policy     | `evidence_completeness`                                                                                                   | `src/core/rule.ts:146-155` (optional; defaults to `rank` for every type)                                  |
| Rationale                        | `rationale`                                                                                                               | `src/core/rule.ts:202-214`                                                                                |
| Limitations                      | `limitations`                                                                                                             | `src/core/rule.ts:215-216`                                                                                |
| Lifecycle status                 | `status`, `deprecatedSince`                                                                                               | `src/core/rule.ts:182-201`; values `active`/`draft`/`deprecated` at `src/core/rule.ts:39-55`              |
| Severity                         | `severity`                                                                                                                | `src/core/rule.ts:181`                                                                                    |
| Documentation reference          | `docsUrl`                                                                                                                 | `src/core/rule.ts:217-218`                                                                                |
| Numeric-threshold honesty marker | `thresholds_inert`                                                                                                        | `src/core/rule.ts:219-224`                                                                                |

All five registered rules declare `status: RuleStatus.ACTIVE` (`ct-int-001.ts:67`, `ct-int-003.ts:49`, `ct-int-004.ts:59`, `ct-cov-001.ts:30`, `ct-mut-001.ts:47`); no registered rule is `draft` or `deprecated`, and none carries `deprecatedSince`. Applicability is category-derived and enforced at registration: `registerRule` rejects any declared/derived mismatch after `validateRule()` (`src/rules/registry.ts:176-201`), so a registered rule never ships outside its category's allowed set. integrity and coverage rules apply to all five concrete types — UNIT, COMPONENT, INTEGRATION, CONTRACT, E2E (`ct-int-001.ts:59`, `ct-int-003.ts:35`, `ct-int-004.ts:43`, `ct-cov-001.ts:21`); the mutation rule CT-MUT-001 applies to UNIT + COMPONENT only (`ct-mut-001.ts:37`).

<!-- BEGIN GENERATED: rule-data-tables — generated by scripts/gen-rule-catalog.ts; do not edit inside this block -->

## Rule data tables

Generated from `RuleMetadata` by `scripts/gen-rule-catalog.ts` — do not edit this section by hand; run the generator instead. Field semantics: the Field schema table above and `src/core/rule.ts`.

### CT-INT-001 — assertion-required

| Catalog field                    | Value                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose                          | A test should contain at least one executable verification of an observable outcome.                                                                                                             |
| Applicability                    | UNIT, COMPONENT, INTEGRATION, CONTRACT, E2E                                                                                                                                                      |
| Required evidence                | `assertion_count`                                                                                                                                                                                |
| Analysis scope                   | `test-body`                                                                                                                                                                                      |
| Evaluation                       | metric `assertion_count`, pass_at_least 1, fail_at_most 0; minimum_evidence_completeness COMPLETE; unknown → INDETERMINATE; conflicting → INDETERMINATE; no local_decision hook (numeric step 7) |
| Evidence completeness policy     | rank (default) for every type                                                                                                                                                                    |
| Rationale                        | A test without an executable assertion verifies nothing, so its verdict would rest on the absence of evidence (SPEC:490-525).                                                                    |
| Limitations                      | Executability after return/throw and inside callbacks is unresolved (plan A7); unestablished assertion constructs are excluded from the count, so a helper-built assertion is not established.   |
| Lifecycle status                 | active                                                                                                                                                                                           |
| Severity                         | error                                                                                                                                                                                            |
| Documentation reference          | https://github.com/victor-petropoulos/CheckTest/blob/main/docs/supported-syntax.md#assertion-forms-11-forms-a9                                                                                   |
| Numeric-threshold honesty marker | absent (thresholds live)                                                                                                                                                                         |
| File-level-only evidence         | —                                                                                                                                                                                                |

### CT-INT-003 — unestablished-assertions

| Catalog field                    | Value                                                                                                                                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                          | Reports recognized assertions whose execution is not established by the static test-body shape, per declaration.                                                                                                        |
| Applicability                    | UNIT, COMPONENT, INTEGRATION, CONTRACT, E2E                                                                                                                                                                             |
| Required evidence                | `assertion_count`, `unestablished_assertion`                                                                                                                                                                            |
| Analysis scope                   | `test-body`                                                                                                                                                                                                             |
| Evaluation                       | metric `unestablished_assertion`, pass_at_least 1, fail_at_most 0; minimum_evidence_completeness COMPLETE; unknown → INDETERMINATE; conflicting → INDETERMINATE; local_decision hook replaces numeric step 7            |
| Evidence completeness policy     | `unestablished_assertion`: signal; rank (default) for all other types                                                                                                                                                   |
| Rationale                        | A recognized assertion inside a callback, nested block, or after an unconditional halt is not proven to execute by the static test-body shape, so its verification is unestablished (SPEC:490-525; collector.ts:85-89). |
| Limitations                      | Does not claim the assertion never runs: no dataflow, branch-condition, loop-trip or exception-path analysis is performed. Only static shape is reported.                                                               |
| Lifecycle status                 | active                                                                                                                                                                                                                  |
| Severity                         | warning                                                                                                                                                                                                                 |
| Documentation reference          | https://github.com/victor-petropoulos/CheckTest/blob/main/docs/supported-syntax.md#executability-establishment-rule-a7                                                                                                  |
| Numeric-threshold honesty marker | `thresholds_inert: true`                                                                                                                                                                                                |
| File-level-only evidence         | —                                                                                                                                                                                                                       |

### CT-INT-004 — unclassified-constructs

| Catalog field                    | Value                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                          | Reports constructs CheckTest cannot inspect statically (computed matchers, unsupported assert/chai/should namespaces, unresolvable custom helpers) per declaration. Transparency rule: never FAILs.               |
| Applicability                    | UNIT, COMPONENT, INTEGRATION, CONTRACT, E2E                                                                                                                                                                       |
| Required evidence                | `assertion_count`                                                                                                                                                                                                 |
| Analysis scope                   | `test-body`                                                                                                                                                                                                       |
| Evaluation                       | metric `assertion_count`, pass_at_least 0, fail_at_most -1; minimum_evidence_completeness PARTIAL; unknown → INDETERMINATE; conflicting → INDETERMINATE; local_decision hook replaces numeric step 7              |
| Evidence completeness policy     | rank (default) for every type                                                                                                                                                                                     |
| Rationale                        | CheckTest cannot inspect every assertion form statically; reporting the constructs it could not classify keeps the verdict honest instead of silently treating them as absent (collector.ts:612-679; KickOff:72). |
| Limitations                      | Does not claim the unclassified construct is wrong or unused. It reports only that static analysis cannot classify it; no runtime behaviour is observed.                                                          |
| Lifecycle status                 | active                                                                                                                                                                                                            |
| Severity                         | info                                                                                                                                                                                                              |
| Documentation reference          | https://github.com/victor-petropoulos/CheckTest/blob/main/docs/supported-syntax.md#not-recognized-recorded-as-unsupported-forms                                                                                   |
| Numeric-threshold honesty marker | `thresholds_inert: true`                                                                                                                                                                                          |
| File-level-only evidence         | —                                                                                                                                                                                                                 |

### CT-COV-001 — coverage-observed

| Catalog field                    | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                          | coverage-observed diagnostic: measures whether the mapped production file was exercised by an external coverage provider. Produces a file-level verdict when coverage is mapped (count of covered lines); when the report was produced by a run scoped to a single test file (--per-test-run) it also yields numeric per-declaration verdicts against the mapped file, which additionally require an explicit --coverage-map and a KNOWN + COMPLETE mapped target. Never asserts that a specific test body executed. |
| Applicability                    | UNIT, COMPONENT, INTEGRATION, CONTRACT, E2E                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Required evidence                | `line_coverage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Analysis scope                   | `test-body`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Evaluation                       | metric `line_coverage`, pass_at_least 1, fail_at_most 0; minimum_evidence_completeness COMPLETE; unknown → INDETERMINATE; conflicting → INDETERMINATE; no local_decision hook (numeric step 7)                                                                                                                                                                                                                                                                                                                       |
| Evidence completeness policy     | rank (default) for every type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Rationale                        | When coverage is mapped from a test file to a production file, CT-COV-001 reports whether that production file was exercised (any covered line). It does not claim a specific test body executed: per-declaration attribution is not supported for ordinary mapped coverage, but a report produced by a run scoped to that test file (--per-test-run) with an explicit --coverage-map and a KNOWN + COMPLETE mapped target yields numeric per-declaration verdicts carrying the file-level claim.                    |
| Limitations                      | Depends entirely on an externally produced coverage report; a missing, stale, partial or mismatched report yields INDETERMINATE rather than FAIL. In --per-test-run mode a mapped-pair contradiction (other PARTIAL report entries) only prepends veto-WARN to the subject reason and never changes a verdict.                                                                                                                                                                                                       |
| Lifecycle status                 | active                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Severity                         | warning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Documentation reference          | https://github.com/victor-petropoulos/CheckTest/blob/main/docs/limitations.md#14-external-coverage-provider-wp41-task-56b                                                                                                                                                                                                                                                                                                                                                                                            |
| Numeric-threshold honesty marker | `thresholds_inert: true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| File-level-only evidence         | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### CT-MUT-001 — mutation-score-observed

| Catalog field                    | Value                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                          | mutation-score-observed diagnostic: reports whether the file-level mutation score meets the fixed 0.5 threshold. Evidence is file-level only (Stryker report); no per-declaration attribution is claimed.                                                                                      |
| Applicability                    | UNIT, COMPONENT                                                                                                                                                                                                                                                                                |
| Required evidence                | `mutation_score`                                                                                                                                                                                                                                                                               |
| Analysis scope                   | `test-body`                                                                                                                                                                                                                                                                                    |
| Evaluation                       | metric `mutation_score`, pass_at_least 1, fail_at_most 0; minimum_evidence_completeness COMPLETE; unknown → INDETERMINATE; conflicting → INDETERMINATE; local_decision hook replaces numeric step 7                                                                                            |
| Evidence completeness policy     | rank (default) for every type                                                                                                                                                                                                                                                                  |
| Rationale                        | A mutation report gives a file-level mutation score (detected/valid). CT-MUT-001 reports whether that score meets the fixed 0.5 threshold. It is file-level only: no per-declaration attribution is derived from a mutation report.                                                            |
| Limitations                      | Depends entirely on an externally produced Stryker mutation report. A missing, unreadable, malformed, revision-mismatched or zero-valid-mutants report yields INDETERMINATE rather than FAIL ("no report != zero mutants"). Coverage is always COMPLETE on a scored record, UNKNOWN otherwise. |
| Lifecycle status                 | active                                                                                                                                                                                                                                                                                         |
| Severity                         | warning                                                                                                                                                                                                                                                                                        |
| Documentation reference          | https://github.com/victor-petropoulos/CheckTest/blob/main/docs/limitations.md#19-external-mutation-provider--parse-only-file-level-p23-2026-11-02                                                                                                                                              |
| Numeric-threshold honesty marker | `thresholds_inert: true`                                                                                                                                                                                                                                                                       |
| File-level-only evidence         | `file_level_only: true`                                                                                                                                                                                                                                                                        |

<!-- END GENERATED: rule-data-tables -->

## CT-INT-001 — assertion-required

- **Purpose:** "A test should contain at least one executable verification of an observable outcome." (`src/rules/ct-int-001.ts:56,58`; declared purpose in `description`).
- **Applicability:** UNIT, COMPONENT, INTEGRATION, CONTRACT, E2E — all concrete types, hence it can never report N/A (`src/rules/ct-int-001.ts:59`; N/A-never note `:39`).
- **Required evidence:** `assertion_count` (`src/rules/ct-int-001.ts:60`); analysis scope `test-body` (`:61`).
- **Evaluation:** `{ metric: 'assertion_count', pass_at_least: 1, fail_at_most: 0 }` (`src/rules/ct-int-001.ts:65`) — the engine's numeric step 7; no `local_decision` hook is declared (the optional hook is defined at `src/core/rule.ts:118-136`). `minimum_evidence_completeness: COMPLETE` (`:62`), so a PARTIAL scan cannot buy PASS or FAIL (`src/rules/ct-int-001.ts:41-46`). Unknown and conflicting evidence both yield `INDETERMINATE` (`:63-64`). Verdict meanings: PASS = at least one _established_ executable assertion; FAIL = zero assertions from a COMPLETE scan; INDETERMINATE = incomplete collection, unsupported framework/assertion form, unresolved helper behavior, or unestablished executability (`:29-38`).
- **Rationale:** a test without an executable assertion verifies nothing, so its verdict would rest on absence of evidence (`src/rules/ct-int-001.ts:70-71`).
- **Limitations:** executability after `return`/`throw` and inside callbacks is unresolved (plan A7); unestablished constructs are excluded from the count, so a helper-built assertion is not established (`src/rules/ct-int-001.ts:72-73`). `severity: error` is the rule's spec default; BLOCKER is not in the core `error|warning|info` union (`src/rules/ct-int-001.ts:10-15,66`).
- **Lifecycle status:** `RuleStatus.ACTIVE` (`src/rules/ct-int-001.ts:67`) — evaluated by default (`src/core/rule.ts:40-43`). Status is not STABLE because assertion executability edge cases are unresolved (`src/rules/ct-int-001.ts:17-25`).
- **External-evidence need:** none. The only required evidence is statically collected `assertion_count` (`src/rules/ct-int-001.ts:60`) over `test-body` scope (`:61`).
- **Documentation reference:** `src/rules/ct-int-001.ts:74-75`.

## CT-INT-003 — unestablished-assertions

- **Purpose:** "Reports recognized assertions whose execution is not established by the static test-body shape, per declaration." (`src/rules/ct-int-003.ts:33-34`).
- **Applicability:** all five concrete test types (`src/rules/ct-int-003.ts:35`).
- **Required evidence:** `assertion_count`, `unestablished_assertion` (`src/rules/ct-int-003.ts:39`) — the rule reads the additive `unestablished_assertions` field carried on the `assertion_count` per-declaration record (`:4-9,36-38`); analysis scope `test-body` (`:40`).
- **Evaluation:** rule-local verdict via `local_decision` (`src/rules/ct-int-003.ts:50-86`), which replaces only numeric step 7; guards 0-6 stay shared (`src/rules/ct-int-003.ts:11-16`). Count 0 → PASS (`:56-62`); count > 0 without a decidable signal (availability KNOWN + finite integer count ≥ 0) → INDETERMINATE (`:64-75`); count > 0 with a decidable signal → FAIL listing the collector's reasons verbatim (`:77-85`). `minimum_evidence_completeness: COMPLETE` (`:41`); unknown/conflicting evidence → INDETERMINATE (`:42-43`). `evidence_completeness: { unestablished_assertion: 'signal' }` (`:44`) makes the signal record's completeness presence-and-count (ADR-035 amendment 2026-11-18) instead of the coverage rank. The declared thresholds `{ metric: 'unestablished_assertion', pass_at_least: 1, fail_at_most: 0 }` are inert — kept only to satisfy the registry's strict ordering contract (`src/rules/ct-int-003.ts:45-47`).
- **Rationale:** a recognized assertion inside a callback, nested block, or after an unconditional halt is not proven to execute by static shape, so its verification is unestablished (`src/rules/ct-int-003.ts:87-88`).
- **Limitations:** does **not** claim the assertion never runs; no dataflow, branch-condition, loop-trip, or exception-path analysis — static shape only (`src/rules/ct-int-003.ts:18-21,89-90`). `severity: warning` (`:48`).
- **Lifecycle status:** `RuleStatus.ACTIVE` (`src/rules/ct-int-003.ts:49`).
- **External-evidence need:** none. The signal is collector-produced static shape on the `assertion_count` record (`src/rules/ct-int-003.ts:4-9,36-39`). Subject scope (file-level) also decides: the collector emits a file-level `unestablished_assertion` aggregate signal in `AnalysisOutput.evidence` (`src/adapters/typescript/collector.ts` `supported()`), counted only over statically scanned declarations — the five §11 gap forms are excluded so UNKNOWN is never laundered into KNOWN→FAIL (ADR-035 amendment 2026-11-18, `docs/adr/ADR-035-closed-evidence-vocabulary-minimal-envelope-change.md`).
- **Documentation reference:** `src/rules/ct-int-003.ts:91-92`. See `docs/rules/ct-int-003-proposal.md` §3 for the evidence-map shape; the subject-scope aggregate is documented at §3 note (file-level `unestablished_assertion`).

## CT-INT-004 — unclassified-constructs

- **Purpose:** "Reports constructs CheckTest cannot inspect statically (computed matchers, unsupported assert/chai/should namespaces, unresolvable custom helpers) per declaration. Transparency rule: never FAILs." (`src/rules/ct-int-004.ts:39,41-42`).
- **Applicability:** all five concrete test types (`src/rules/ct-int-004.ts:43`).
- **Required evidence:** `assertion_count` (`src/rules/ct-int-004.ts:46`) — the rule reads the additive `unclassified_constructs` field on that record (`:4-9,44-45`); analysis scope `test-body` (`:47`).
- **Evaluation:** rule-local `local_decision` (`src/rules/ct-int-004.ts:60-84`). Count 0/absent → PASS (`:66-72`); count > 0 → INDETERMINATE with the collector's reasons verbatim (`:74-83`); FAIL unreachable by construction — an unclassified construct is absence of evidence, never a negative finding (`src/rules/ct-int-004.ts:11-15,74-77`). `minimum_evidence_completeness: PARTIAL` (`src/rules/ct-int-004.ts:51`), deliberately not COMPLETE: the collector forces coverage PARTIAL when it records an unclassified construct (`src/adapters/typescript/collector.ts:313-317`, cited at `src/rules/ct-int-004.ts:17-26,48-50`), so COMPLETE would block the rule's own evidence at guard 4. Unknown/conflicting evidence → INDETERMINATE (`:52-53`). Thresholds `{ metric: 'assertion_count', pass_at_least: 0, fail_at_most: -1 }` are inert; `fail_at_most: -1` makes even the numeric path incapable of FAIL (`src/rules/ct-int-004.ts:54-57`).
- **Rationale:** reporting what static analysis could not classify keeps the verdict honest instead of silently treating uninspectable constructs as absent (`src/rules/ct-int-004.ts:85-86`).
- **Limitations:** does not claim the construct is wrong or unused; no runtime behavior is observed (`src/rules/ct-int-004.ts:28-29,87-88`). `severity: info` (`:58`).
- **Lifecycle status:** `RuleStatus.ACTIVE` (`src/rules/ct-int-004.ts:59`).
- **External-evidence need:** none. Signal is collector-produced static shape (`src/rules/ct-int-004.ts:4-9,44-46`).
- **Documentation reference:** `src/rules/ct-int-004.ts:89-90`.

## CT-COV-001 — coverage-observed

- **Purpose:** reports whether the mapped production file was exercised by an external coverage provider; produces a file-level verdict from covered-line count, and with `--per-test-run` also numeric per-declaration verdicts against the mapped file. It never asserts that a specific test body executed (`src/rules/ct-cov-001.ts:17,19-20`).
- **Applicability:** all five concrete test types (`src/rules/ct-cov-001.ts:21`).
- **Required evidence:** `line_coverage` (`src/rules/ct-cov-001.ts:22`), provenance EXTERNAL; the rule only runs on that evidence and never makes it mandatory for any other rule (`src/rules/ct-cov-001.ts:3-8`); analysis scope `test-body` (`:23`).
- **Evaluation:** `{ metric: 'line_coverage', pass_at_least: 1, fail_at_most: 0 }` with `thresholds_inert: true` (`src/rules/ct-cov-001.ts:27-28`). `minimum_evidence_completeness: COMPLETE` (`:24`); unknown/conflicting evidence → INDETERMINATE (`:25-26`). Missing/stale/partial/mismatched report yields INDETERMINATE, not FAIL (`src/rules/ct-cov-001.ts:33-34`; contract matrix `docs/rules/ct-cov-001-contract.md:116-126`). With a `--per-test-run` report, a KNOWN + COMPLETE mapped pair yields numeric per-declaration verdicts carrying the file-level claim; a mapped-pair contradiction (other PARTIAL entries) only prepends `veto-WARN` to the subject reason and never changes a verdict (`src/rules/ct-cov-001.ts:31-34`).
- **Rationale:** mapped coverage establishes only that the production file was exercised (any covered line); per-declaration attribution is unsupported for ordinary mapped coverage, so the rule does not overclaim (`src/rules/ct-cov-001.ts:31-32`). The underlying evidence granularity is production-source, not per-test (`docs/rules/ct-cov-001-contract.md:14-18`).
- **Limitations:** depends entirely on an externally produced coverage report; missing, stale, partial, or mismatched input yields INDETERMINATE (`src/rules/ct-cov-001.ts:33-34`). Per-declaration scope is unavailable by default; `--per-test-run` is an opt-in amendment (ADR-032) to the boundary documented at `docs/rules/ct-cov-001-contract.md:154-164`. `severity: warning` (`src/rules/ct-cov-001.ts:29`). The contract's Option-B verdict table (`docs/rules/ct-cov-001-contract.md:168-175`) describes the forward-looking baseline (contract status: `docs/rules/ct-cov-001-contract.md:4`); the shipped rule's current contract is the `RuleMetadata` at `src/rules/ct-cov-001.ts:15-37`.
- **Lifecycle status:** `RuleStatus.ACTIVE` (`src/rules/ct-cov-001.ts:30`).
- **External-evidence need:** **yes** — a coverage report must be supplied from an external provider; the rule is inert without `line_coverage` evidence (`src/rules/ct-cov-001.ts:3-8,22,33-34`).
- **Documentation reference:** `src/rules/ct-cov-001.ts:35-36`; full contract `docs/rules/ct-cov-001-contract.md`.

## CT-MUT-001 — mutation-score-observed

- **Purpose:** reports whether the file-level mutation score meets the fixed 0.5 threshold; evidence is file-level only (Stryker report), with no per-declaration attribution claimed (`src/rules/ct-mut-001.ts:33,35-36`).
- **Applicability:** all five concrete test types (`src/rules/ct-mut-001.ts:37`).
- **Required evidence:** `mutation_score` (`src/rules/ct-mut-001.ts:38`), produced by the external Stryker provider `src/providers/mutation.ts` (`src/rules/ct-mut-001.ts:3-5`); analysis scope `test-body` (`:39`).
- **Evaluation:** rule-local `local_decision` (`src/rules/ct-mut-001.ts:48-87`) replaces step 7 because a score is a fraction carried as an object (`src/rules/ct-mut-001.ts:7-10`). Fixed `MUTATION_THRESHOLD = 0.5` (`:29`, user ruling `:12-14`): non-finite/missing score → INDETERMINATE (`:56-61`); score ≥ 0.5 → PASS (`:64-70`); score < 0.5 with coverage below COMPLETE → INDETERMINATE (`:72-80`); otherwise FAIL (`:82-86`). `minimum_evidence_completeness: COMPLETE` (`:40`); unknown/conflicting evidence → INDETERMINATE (`:41-42`). Declared thresholds `{ metric: 'mutation_score', pass_at_least: 1, fail_at_most: 0 }` are inert, retained for registry ordering (`src/rules/ct-mut-001.ts:43-45`). Full INDETERMINATE matrix: `docs/rules/ct-mut-001-contract.md:54-77`.
- **Rationale:** a mutation report gives a file-level detected/valid score; the rule reports threshold conformance and derives no per-declaration claim (`src/rules/ct-mut-001.ts:88-89`).
- **Limitations:** depends entirely on an external Stryker report; missing, unreadable, malformed, revision-mismatched, or zero-valid-mutants input yields INDETERMINATE, never FAIL — "no report != zero mutants" (`src/rules/ct-mut-001.ts:16-18,90-91`). File-level only (`src/rules/ct-mut-001.ts:20-21`; `docs/rules/ct-mut-001-contract.md:105-113`). `severity: warning` (`src/rules/ct-mut-001.ts:46`).
- **Lifecycle status:** `RuleStatus.ACTIVE` (`src/rules/ct-mut-001.ts:47`).
- **External-evidence need:** **yes** — a Stryker mutation report must be supplied; the rule is inert without `mutation_score` evidence (`src/rules/ct-mut-001.ts:3-5,38,90-91`).
- **Documentation reference:** `src/rules/ct-mut-001.ts:92-93`; full contract `docs/rules/ct-mut-001-contract.md`.

## CT-DEMO-001 — unregistered stub, NOT a shipped rule

`src/rules/ct-demo-001.ts` exists **solely to exercise the engine's N/A path**: it applies only to UNIT, so a COMPONENT fixture case proves the applicability guard short-circuits first; it is not a real quality rule and reports no verdict about component tests (`src/rules/ct-demo-001.ts:1-10`). Its metadata (`src/rules/ct-demo-001.ts:17-31`) declares `applies_to: [UNIT]` (`:22`), `severity: info` (`:29`), and `status: RuleStatus.ACTIVE` (`:30`), but **status alone does not make a rule shipped** — registration is the composition point (`src/cli.ts`, `main()` registration block).

Evidence of non-registration, verified live: `grep -n registerRule src/cli.ts` returns one import and exactly **five** `registerRule(CT_*)` calls inside `src/cli.ts` `main()` (observed at `:589-593` on 2026-11-20), naming CT-INT-001, CT-INT-003, CT-INT-004, CT-COV-001, CT-MUT-001 — no `CT_DEMO_001`. The stub is referenced only in tests as an unregistered N/A witness (`tests/integration/fixtures.test.ts:262-264`) to drive the N/A fixture case (`case-14-not-applicable`); requesting it from the production CLI is rejected as unknown (`tests/rules/rule-contract.test.ts:151,170-173`). Treat it as an unregistered test fixture, not a sixth active rule, when reading `RuleStatus` values in `src/rules/ct-*.ts`.

## Baseline representative fixture set — `tests/fixtures/ct-int-001/`

`ls -d tests/fixtures/ct-int-001/*/ | wc -l` = **44** directories. This is the baseline representative set for CT-INT-001. The integration suite declares **41** of them in its `CASES` table (`tests/integration/fixtures.test.ts:42-84`, length asserted `:202`) and checks each against a `*.expected.json` sidecar (`:203-205,208-210`). Verdict column below is the `rule_result` in each fixture's sidecar; `null` means no verdict is emitted.

| Fixture dir                          | Declared in CASES | Sidecar                     | Expected rule / result              |
| ------------------------------------ | ----------------- | --------------------------- | ----------------------------------- |
| `case-01-standard-assertion`         | yes (`:43`)       | yes                         | CT-INT-001 / PASS                   |
| `case-02-no-assertion`               | yes (`:44`)       | yes                         | CT-INT-001 / FAIL                   |
| `case-03-unsupported-api`            | yes (`:45`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-04-custom-helper`              | yes (`:46`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-05-snapshot`                   | yes (`:47`)       | yes                         | CT-INT-001 / PASS                   |
| `case-06-async`                      | yes (`:48`)       | yes                         | CT-INT-001 / PASS                   |
| `case-07-after-return`               | yes (`:49`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-08-callback`                   | yes (`:50`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-09-partial-collection`         | yes (`:51`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-10-unsupported-framework`      | yes (`:52`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-11-collector-failure`          | yes (`:53`)       | yes                         | CT-INT-001 / null (FAILED scan)     |
| `case-12-unknown-classification`     | yes (`:54`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-13-conflict`                   | yes (`:55`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-14-not-applicable`             | yes (`:56`)       | yes                         | CT-DEMO-001 / N/A (stub, test-only) |
| `case-15-mixed-framework`            | yes (`:57`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-16-per-test-mixed`             | yes (`:58`)       | yes                         | CT-INT-001 / PASS                   |
| `case-17-failed-multi-test`          | yes (`:59`)       | yes                         | CT-INT-001 / null (FAILED scan)     |
| `case-18-no-tests`                   | yes (`:60`)       | yes                         | CT-INT-001 / FAIL                   |
| `case-19-it-only`                    | yes (`:61`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-20-unresolved-body`            | yes (`:62`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-21-dynamic-declaration`        | yes (`:63`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-22-conditional-declaration`    | yes (`:64`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-23-compound-callee`            | yes (`:65`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-24-vitest-standard`            | yes (`:66`)       | yes                         | CT-INT-001 / PASS                   |
| `case-25-vitest-aliased`             | yes (`:67`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-26-vitest-no-runtime-import`   | yes (`:68`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-27-k15-describe-fail`          | yes (`:69`)       | yes                         | CT-INT-001 / FAIL                   |
| `case-28-global-vi`                  | yes (`:70`)       | yes                         | CT-INT-001 / PASS                   |
| `case-29-bare-global-jest`           | yes (`:71`)       | yes                         | CT-INT-001 / PASS                   |
| `case-30-bare-global-without-expect` | yes (`:72`)       | yes                         | CT-INT-001 / PASS                   |
| `case-31-vitest-it-each-array`       | yes (`:73`)       | yes                         | CT-INT-001 / PASS                   |
| `case-32-vitest-it-each-template`    | yes (`:74`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-33-vitest-it-todo`             | yes (`:75`)       | yes                         | CT-INT-001 / FAIL                   |
| `case-34-vitest-it-skip`             | yes (`:76`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-35-vitest-it-skipif`           | yes (`:77`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-36-vitest-exported-test-fn`    | yes (`:78`)       | yes                         | CT-INT-001 / FAIL                   |
| `case-37-vitest-not-to-throw`        | yes (`:79`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-38-vitest-matchers`            | yes (`:80`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-39-bare-mocha`                 | yes (`:81`)       | yes                         | CT-INT-001 / INDETERMINATE          |
| `case-40-supertest-chains`           | yes (`:82`)       | yes                         | CT-INT-001 / PASS                   |
| `case-41-jsx-js`                     | yes (`:83`)       | yes                         | CT-INT-001 / PASS                   |
| `python-slice-click`                 | no                | **no — `report.json` only** | not a CASES assertion               |
| `python-slice-packaging`             | no                | **no — `report.json` only** | not a CASES assertion               |
| `python-slice-pytest`                | no                | **no — `report.json` only** | not a CASES assertion               |

### Dirs lacking a `*.expected.json` sidecar (verified)

Exactly three, confirmed by iterating all 44 dirs and testing for `*.expected.json`:

- `python-slice-click`
- `python-slice-packaging`
- `python-slice-pytest`

Each contains only a `report.json` (observed via `ls -la`); none is listed in `CASES` (`tests/integration/fixtures.test.ts:42-84`). Do not treat these three as expected-verdict regression fixtures.

### Uncertain / unsupported cases visible in the CASES table

- **No verdict (FAILED scan):** `case-11-collector-failure` and `case-17-failed-multi-test` are asserted to yield `rule_result === null` — the engine aborts at step 0 instead of inventing a verdict (`tests/integration/fixtures.test.ts:324-329`).
- **Unsupported / unestablished assertion forms (expected INDETERMINATE):** `case-03-unsupported-api`, `case-04-custom-helper`, `case-07-after-return`, `case-08-callback`, `case-09-partial-collection`, `case-10-unsupported-framework`, `case-12-unknown-classification`, `case-13-conflict`, `case-15-mixed-framework`, `case-19-it-only`, `case-20-unresolved-body`, `case-21-dynamic-declaration`, `case-22-conditional-declaration`, `case-23-compound-callee`, `case-25-vitest-aliased`, `case-26-vitest-no-runtime-import`, `case-32-vitest-it-each-template`, `case-34-vitest-it-skip`, `case-35-vitest-it-skipif`, `case-37-vitest-not-to-throw`, `case-38-vitest-matchers`, `case-39-bare-mocha`.
- **N/A path:** `case-14-not-applicable` uses the unregistered CT-DEMO-001 stub, referenced only in tests as an unregistered N/A witness (`tests/integration/fixtures.test.ts:262-264`); it is not evidence of a shipped sixth rule.
- **Coverage of all four verdict classes** (PASS, FAIL, INDETERMINATE, N/A) is asserted at `tests/integration/fixtures.test.ts:318-329`.

## Sources

- Field contract: `src/core/rule.ts:39-55,138-225`.
- Registration: `src/cli.ts` `main()` — five `registerRule(...)` calls (observed at `:589-593` on 2026-11-20); registry validation `src/rules/registry.ts:34-150,171-173`.
- Rule metadata: `src/rules/ct-int-001.ts:54-76`, `ct-int-003.ts:29-93`, `ct-int-004.ts:37-91`, `ct-cov-001.ts:15-37`, `ct-mut-001.ts:31-94`; stub `ct-demo-001.ts:1-31`.
- Rule contracts: `docs/rules/ct-cov-001-contract.md`, `docs/rules/ct-mut-001-contract.md`.
- Fixture baseline: `tests/fixtures/ct-int-001/` (44 dirs); `tests/integration/fixtures.test.ts:42-84,202-210,318-329`.
