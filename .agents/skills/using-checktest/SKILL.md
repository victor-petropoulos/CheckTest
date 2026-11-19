---
name: using-checktest
description: Use when reviewing or changing automated tests, interpreting CheckTest JSON/SARIF, or diagnosing unsupported/incomplete analysis. Advisory evidence only — never a merge gate.
---

<!--
MIRROR LOCATION: ~/.agents/skills/using-checktest/SKILL.md
Authored at ~/.config/opencode/skills/using-checktest/SKILL.md.
~/.agents/skills is the mirror. After every edit:
  mkdir -p /Users/victorpetropoulos/.agents/skills/using-checktest
  cp /Users/victorpetropoulos/.config/opencode/skills/using-checktest/SKILL.md \
     /Users/victorpetropoulos/.agents/skills/using-checktest/SKILL.md
-->

# Overview

CheckTest gives deterministic, evidence-backed, per-test verdicts from static analysis of a test file. It never runs the test. Advisory only: phases 0-4 use it as supporting evidence, not a gate. Verdict, exit code, and CI block are three different things.

# When to Use

- Reviewing or changing automated tests.
- Interpreting `checktest check` JSON or `--format sarif` output.
- Diagnosing UNSUPPORTED / INDETERMINATE / INCOMPLETE analysis.
- Checking which adapter/rule/assertion forms exist in this checkout.
- Explaining a rule id via `checktest explain`.

# Policy (advisory)

- Run CheckTest on ALL changed test files. Opt out only for unsupported/irrelevant files (Q2 ruling: all_changed_with_optout).
- Inspect the test yourself first. CheckTest is a second opinion.
- NEVER edit a test solely to please a verdict. FAIL is a question, not an order.
- Preserve non-PASS/FAIL outcomes: rule verdicts INDETERMINATE and N/A; analysisStatus UNSUPPORTED (not a verdict); no-verdict; analyzer failure. Do not convert them to PASS/FAIL in prose.

# Workflow

1. Identify changed test files (git diff). Include all; opt out with a stated reason for unsupported/irrelevant.
2. `doctor` ONLY when environment/dispatch is unclear. `doctor --test <path>` probes adapter selection. Not a habit.
3. Per file: `checktest check --test <path> --type <TYPE>`. Pass `--type` ONLY when declared type known (UNIT | COMPONENT | INTEGRATION | CONTRACT | E2E). Else omit — default UNKNOWN, never inferred from file.
4. Read the report, not just summary: per-test `testResults[]` verdicts; `ruleResults[].rule_id`/`.result`/`.reason`; `location` (file+line); `evidence.assertion_count` (`availability`, `provenance`, `evidenceStrength`, `coverage.status`); `analysisStatus` (SUCCESS|FAILED|UNSUPPORTED); `completeness` (COMPLETE|INCOMPLETE|NOT_APPLICABLE); `adapter`/`decidedBy`; rule `limitations`/`docsUrl`; `capabilities`.
5. Independent inspection: open file at `location.line`. Confirm or disagree; record in Review line.
6. Dynamic facts come from tools: `doctor --json` lists current adapters/extensions/frameworks/assertion forms; `explain --rule <id>` gives current rule meaning. Defer to docs below for static inventories.

Multi-file: one `check` per file (no repeatable `--test`). Explicit list, sorted order, per-file JSON + exit code. JSON is the default format — `check` has no `--json` flag; parse the JSON, never human-readable output.

```bash
files=(tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts tests/adapters/python/fixtures/unittest_sample.py)
out=$(mktemp -d); i=0
while IFS= read -r f; do
  i=$((i+1))
  checktest check --test "$f" > "$out/$i-$(basename "$f").json"
  printf '%s exit=%s\n' "$f" "$?"
done < <(printf '%s\n' "${files[@]}" | LC_ALL=C sort)
```

Unsupported file (e.g. `.rs`): its JSON is the no-verdict envelope (`analysisStatus UNSUPPORTED`, `reasonCode NO_ADAPTER_MATCHED`, exit 2); other files' results are untouched.

# Requires

- `checktest` reachable via `npx tsx src/cli.ts` in this repo (or installed CLI).
- One test file path per `check`.
- No test execution, no network, no implicit config discovery (`--config` explicit-path-only).

# Commands (verified live, HEAD a6babd7)

```bash
npx tsx src/cli.ts doctor
npx tsx src/cli.ts doctor --test tests/cli.test.ts
npx tsx src/cli.ts doctor --test /tmp/no-such-file.xyz --json
npx tsx src/cli.ts explain --rule CT-INT-001
npx tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts --type UNIT
```

Trimmed real outputs:

```
$ npx tsx src/cli.ts doctor
checktest doctor
Node: v24.18.1
Manifests:
  package.json: present
  pyproject.toml: absent
  setup.py: absent
  requirements.txt: absent
Adapters:
  typescript-jest-adapter 0.1.0 (.ts, .tsx, .js, .jsx) hints: istanbul, c8, stryker
  python-pytest-adapter 0.1.0 (.py) hints: coverage-py, pytest-cov, mutmut
Config: not supplied (validity checked only with --config)
Supported extensions: .ts, .tsx, .js, .jsx, .py
Supported frameworks: jest, vitest, mocha, pytest, unittest
EXIT=0

$ npx tsx src/cli.ts doctor --test tests/cli.test.ts
checktest doctor (dispatch)
Test: tests/cli.test.ts
Adapter: typescript-jest-adapter (manifest) resolved
EXIT=0

$ npx tsx src/cli.ts doctor --test /tmp/no-such-file.xyz --json
{
  "kind": "doctor",
  "schemaVersion": "0.5",
  "mode": "dispatch",
  "adapterId": null,
  "decidedBy": "unsupported",
  "reason": "no adapter matched"
}
EXIT=2

$ npx tsx src/cli.ts explain --rule CT-INT-001
checktest explain: CT-INT-001
Name: assertion-required
Category: integrity
Applies to: UNIT, COMPONENT, INTEGRATION, CONTRACT, E2E
Required evidence: assertion_count
Analysis scope: test-body
Minimum evidence completeness: COMPLETE
Unknown evidence policy: INDETERMINATE
Conflicting evidence policy: INDETERMINATE
Evaluation:
  Metric: assertion_count
  Pass at least: 1
  Fail at most: 0
Status: active
EXIT=0

$ npx tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts --type UNIT
{
  "test": { "name": "sample.test.ts", "language": "typescript", "framework": "jest", "type": "UNIT" },
  "analysisStatus": "SUCCESS",
  "evaluationStatus": "EVALUATED",
  "completeness": "COMPLETE",
  "scope": "test-body",
  "ruleResults": [{
    "rule_id": "CT-INT-001",
    "result": "PASS",
    "reason": "CT-INT-001: assertion_count=1 >= 1",
    "evidenceStrength": "EXECUTION_ESTABLISHED",
    "provenance": "DIRECT",
    "availability": "KNOWN",
    "location": { "line": 9 }
  }],
  "schemaVersion": "0.5",
  "adapter": "typescript-jest-adapter",
  "decidedBy": "manifest",
  "summary": { "total": 1, "pass": 1, "fail": 0, ... }
}
EXIT=0

$ npx tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-02-no-assertion/sample.test.ts --type UNIT
  "rule_id": "CT-INT-001",
  "result": "FAIL",
  "reason": "CT-INT-001: assertion_count=0 <= 0",
  "summary": { "total": 1, "pass": 0, "fail": 1, ... }
EXIT=0     <-- FAIL still exits 0
```

# Exit codes — read JSON, not status

- `0` = analysis succeeded: at least one scope reached a verdict — PASS, FAIL, INDETERMINATE or N/A. **Exit 0 is NOT PASS** (verified: case-02 FAIL exits 0).
- `1` = usage error/crash (unknown flag, missing/unregistered `--rule`); prose on stderr.
- `2` = no verdict produced — no scope reached any verdict. Covers all-evaluations-FAILED, files declaring no recognized tests EVEN WITH `analysisStatus SUCCESS` (ruleResults/testResults empty, evaluationStatus FAILED — verified live on a tstyche `__typetests__` file), and doctor dispatch unresolvable/no adapter.
- `doctor` reuses 0/1/2: 0 diagnostic success, 2 unresolvable dispatch, 1 usage error.
- `explain`: 0 success, 1 missing/unregistered rule (+ registered id list); no exit-2 case.
- Gate/CI blocking is separate policy above this layer. CheckTest never blocks on its own in phases 0-4.

# Output schema summary

- All JSON carries `schemaVersion: "0.5"`.
- `kind` discriminator observed on `doctor` and `explain`; `doctor` also has `mode: env|dispatch`. `check` report carried `schemaVersion`, `analysisStatus`, `ruleResults`, `testResults`, `summary` — no `kind` value observed in live output; verify before relying on one.
- `check` report fields: `test{}`, `analysisStatus`, `evaluationStatus`, `completeness`, `scope`, `test_type{value,source}`, `capabilities{}`, `evidence{}`, `ruleResults[]`, `testResults[]`, `summary{total,pass,fail,indeterminate,not_applicable,failed}`, `schemaVersion`, `adapter`, `decidedBy`.
- evidence record: `value`, `availability` (KNOWN|UNKNOWN|NOT_APPLICABLE), `provenance` (DIRECT|DERIVED|EXTERNAL), `source`, `collector_version`, `scope`, `coverage{status (COMPLETE|PARTIAL|UNAVAILABLE),...}`, `location{file,line}`, `evidenceStrength` (SYNTAX_OBSERVED|EXECUTION_ESTABLISHED|UNSUPPORTED).
- rule result: `rule_id`, `result` (PASS|FAIL|INDETERMINATE|N/A), `reason`, `evidence[]`, `ruleStatus`, `description`, `rationale`, `limitations`, `docsUrl`, `evidenceStrength`, `provenance`, `availability`, `test_id`, `completeness`, `location`.
- `analysisStatus` (SUCCESS|UNSUPPORTED|FAILED) is the analysis lifecycle, and `evaluationStatus` (EVALUATED|FAILED) says whether the engine reached a verdict at all — neither is a rule verdict. Rule verdicts are only the `result` values PASS|FAIL|INDETERMINATE|N/A; UNSUPPORTED is never a verdict.
- SARIF: `--format sarif` emits SARIF 2.1.0. Same advisory rules.

# Supported / unsupported — ask, do not hardcode

- Current adapters/extensions/frameworks/assertion forms: `npx tsx src/cli.ts doctor --json` (`adapters[].capabilities.assertionForms`, `supported{}`).
- Rule applicability/required evidence/policy/limitations: `npx tsx src/cli.ts explain --rule <id>`.
- Static pointers: `docs/supported-syntax.md` (framework allowlist, assertion forms, executability, declaration forms, per-test evidence, Python, coverage formats, provenance, evidence strength) and `docs/limitations.md` (§1 no control-flow, §2 no cross-file helpers, §3 no runtime I/O, §11 unestablishable declarations never FAIL, §24 evidence strength, §25 coverage formats, §27 rule lifecycle).
- Never paste a version-specific form inventory into prose.

# External evidence freshness

- Attach with `--coverage-report <path>`, `--coverage-map from=to`, `--per-test-run`, `--source-revision <rev>`, `--mutation-report <path>`, `--mutation-source-revision <rev>`.
- Revision mismatch = stale evidence. Staleness/traceability is a field, not part of identity (Q1 ruling: identity_excludes_git). Do not present stale evidence as proof.
- Mismatched/unparseable external evidence → INDETERMINATE, never FAIL.
- File identity matching is strict; no basename guess as exact match.
- Mutation evidence lands ONLY with a matching map: `--mutation-report <path>` plus `--coverage-map <testFile>=<report files key>` (the report's `files` key). Without a matching entry the file-level `mutation_score` is absent → CT-MUT-001 INDETERMINATE (verified across the MUT-001 corpus). Omit `--mutation-source-revision` and the report revision is `unknown` → mismatch → UNKNOWN → INDETERMINATE; supply the real rev when known.
- Legacy revision keys (`source_revision`/`sourceRevision`/`revision` opts) are a library/provider-API surface only — not CLI-reachable; documented caveat: docs/limitations.md §19.

# Common mistakes

- Exit 0 as PASS (verified false). UNSUPPORTED as failure. INDETERMINATE as FAIL. N/A as PASS.
- Trusting `summary` without per-test `ruleResults` + `location`.
- Trusting goldens without adapter attribution (`adapter`, `decidedBy`) and capability note.
- Guessing `--type` from filename. Hardcoding form/extension lists.
- `doctor` on every file "just in case".
- Editing a test to make verdict green.

# Rationalization table

| Rationalization             | Reality                                         |
| --------------------------- | ----------------------------------------------- |
| Exit 0 means pass.          | 0 = verdict produced; FAIL also exits 0.        |
| UNSUPPORTED = broken test.  | No analysis path; out of evidence, not failure. |
| INDETERMINATE is soft FAIL. | Different bucket; converting overclaims.        |
| Golden passed.              | Only for that adapter + declared completeness.  |
| CheckTest FAIL ⇒ edit test. | Advisory; independent judgment wins.            |
| I know supported forms.     | Ask `doctor --json`; inventories change.        |

# Red flags — stop, do not overclaim

- "CheckTest says FAIL, so test is wrong." / "Exit 0, all good."
- "UNSUPPORTED / INDETERMINATE → count as FAIL/PASS."
- "Golden passed" without adapter/coverage note.
- Claiming gate/block/merge decision from CheckTest output.
- Presenting mismatched-revision coverage/mutation as current.

# Dealing with feedback

| Output                                                        | Action                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| PASS                                                          | Supporting evidence only; still inspect.                 |
| FAIL                                                          | Question test; inspect at `location.line`; no auto-edit. |
| INDETERMINATE                                                 | Report unknown policy; not PASS/FAIL.                    |
| N/A (rule result); NOT_APPLICABLE (availability/completeness) | Report as-is.                                            |
| UNSUPPORTED (analysisStatus, not a verdict)                   | Opt out; state reason.                                   |
| INCOMPLETE                                                    | Note `capabilities` gap; no inferred zero.               |
| exit 1                                                        | Fix invocation/rule id.                                  |
| exit 2                                                        | No verdict: report gap; do not invent verdict.           |

# Dogfood reporting template

```
> CheckTest: `<verdict>` — `<rule id>`
> Evidence: `<observed evidence and location>`
> Completeness: `<complete/partial/unavailable>`; adapter: `<id>`
> Rationale/limit: `<what it supports and what it does not establish>`
> Review: `<agent's independent assessment or disagreement>`
```
