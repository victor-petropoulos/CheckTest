# CheckTest

Static test-quality analysis: deterministic evidence collector + rule engine.

CheckTest inspects a single test file without running it. It collects assertion evidence from the AST, classifies each declaration, and evaluates rules against the collected evidence. Output is machine-readable (JSON or SARIF 2.1.0) with structured verdicts.

## Install

```sh
npm i -g checktest-cli
```

From source:

```sh
npm install
npm run build
```

## Usage

```
checktest [check] --test <path> [--type <TYPE>] [--adapter <id>] [--rule <id>] [--format <fmt>] [--coverage-report <path>] [--coverage-map <from>=<to>] [--per-test-run] [--source-revision <rev>] [--mutation-report <path>] [--mutation-source-revision <rev>] [--config <path>]
```

Full `--help` output (verified live):

```
Usage: checktest [check] --test <path> [--type <TYPE>] [--rule <id>] [--format <fmt>] [--config <path>]

  --test <path>   test file to analyze (required)
  --type <TYPE>   declared test type: UNIT | COMPONENT | INTEGRATION | CONTRACT | E2E | UNKNOWN
                  (default UNKNOWN; never inferred from the file)
  --adapter <id>  adapter to dispatch with (default: resolved via flag > manifest > extension, ADR-034)
  --rule <id>     rule to evaluate (default CT-INT-001); DRAFT rules are opt-in via --rule; DEPRECATED rules run by default
  --format <fmt>  report format: 'json' | 'sarif' (default json)
  --coverage-report <path>  external Istanbul/c8 coverage report to attach
  --coverage-map <from>=<to>  map analyzed file path to report key (repeatable)
  --per-test-run            mark the coverage report as a single-test-file run (CT-COV-001)
  --source-revision <rev>   declared revision the coverage report was produced against
  --mutation-report <path>  external Stryker mutation report to attach
  --mutation-source-revision <rev>  declared revision the mutation report was produced against (valid git rev or unknown)
  --config <path>           explicit config file (checktest.config.json); no implicit discovery

Writes the report (JSON by default, SARIF 2.1.0 with --format sarif) to
stdout. Exits 0 when the rule was evaluated (any
rule result, including FAIL, and any UNSUPPORTED analysis), 2 when the engine
reached no verdict (including a file that declares no tests), and 1 on a usage
error or a failed run.
```

### Flags

| Flag                               | Description                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--test <path>`                    | Path to the test file to analyze (required)                                                              |
| `--type <TYPE>`                    | Declared test type: `UNIT`, `COMPONENT`, `INTEGRATION`, `CONTRACT`, `E2E`, `UNKNOWN` (default `UNKNOWN`) |
| `--adapter <id>`                   | Adapter to dispatch with (default: resolved via flag > manifest > extension, ADR-034)                    |
| `--rule <id>`                      | Rule ID to evaluate (default `CT-INT-001`)                                                               |
| `--format <fmt>`                   | Report format: `json` or `sarif` (default `json`)                                                        |
| `--coverage-report <path>`         | External Istanbul/c8 coverage report JSON to attach                                                      |
| `--coverage-map <from>=<to>`       | Map analyzed file path to report key (repeatable; expects `<from>=<to>`)                                 |
| `--per-test-run`                   | Mark the coverage report as a single-test-file run (CT-COV-001)                                          |
| `--source-revision <rev>`          | Declared revision the coverage report was produced against (CLI beats config `sourceRevision`)           |
| `--mutation-report <path>`         | External Stryker mutation report JSON to attach                                                          |
| `--mutation-source-revision <rev>` | Declared revision the mutation report was produced against (valid git rev or `unknown`)                  |
| `--config <path>`                  | Explicit config file (`checktest.config.json`); no implicit discovery                                    |

### Config File

Config is explicit-only: pass `--config <path>`; there is no implicit discovery of `checktest.config.json`.

Top-level keys are `rules` and `sourceRevision` (`src/core/config.ts:23-28`); `sourceRevision` must be a string and unknown top-level keys are rejected (`src/core/config.ts:65-72`). Each rule entry is an override shaped `{ enabled?, thresholds?: { passAtLeast?, failAtMost? }, severity?: 'error'|'warning'|'info' }` (`src/core/config.ts:12-21`).

```json
{
  "rules": {
    "CT-INT-001": {
      "enabled": false,
      "severity": "warning"
    }
  }
}
```

- Precedence: CLI `--source-revision` beats config `sourceRevision` (see the Flags table above).
- Thresholds are not configurable for every rule: CT-COV-001 has `thresholds_inert: true` (`src/rules/ct-cov-001.ts:28`) and a `thresholds` override is rejected with `invalid --config: thresholds are not configurable for rule '<id>': its thresholds are inert` (`src/core/config.ts:117`).
- Local-decision rules reject thresholds with a distinct message: `invalid --config: 'thresholds' is not configurable for local-decision rule '<id>'` (`src/core/config.ts:113`).

### Mutation Testing

Attach an external Stryker mutation report and evaluate CT-MUT-001 against it.

```sh
npx stryker run --reporter json
checktest check --test <file> --mutation-report <path> --mutation-source-revision <rev>
```

- `--mutation-report <path>` attaches the external Stryker mutation report JSON.
- `--mutation-source-revision <rev>` declares the revision the mutation report was produced against (valid git rev or `unknown`).
- Freshness: report usable when declared revision matches analyzed git HEAD; mismatch or missing flag → INDETERMINATE (CT-MUT-001), never FAIL from stale/missing report.
- CT-MUT-001: PASS ≥ 0.5 / FAIL < 0.5 on mutation_score, only when freshness established. The verdict is file-level (mutation evidence is never per-declaration): it appears as a `ruleResults` entry with no `test_id`, alongside any per-test findings, and its `rationale` states that no per-declaration attribution is claimed.

### Coverage

Supported: Istanbul JSON, c8 JSON, per-test-run derived shape. Raw vitest coverage-final.json is NOT supported. See [docs/limitations.md](./docs/limitations.md) §25 for accepted shapes, freshness, and file-identity matching, and [supported syntax](./docs/supported-syntax.md#coverage-formats) for adapter-specific matching rules.

### Exit Codes

| Code | Meaning                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------- |
| `0`  | Verdict produced (PASS, FAIL, INDETERMINATE, or UNSUPPORTED analysis)                                   |
| `1`  | Usage error or runtime crash                                                                            |
| `2`  | No verdict — engine reached no conclusion (e.g. file declares no tests, or no adapter matched the file) |

The `doctor` and `explain` subcommands share the same 0/1/2 contract: `0` = diagnostic success, `1` = usage error (unknown flag / rule / id), `2` = unresolvable dispatch (`doctor --test <path>` with no matching adapter). `explain` has no exit-2 case — an unknown `--rule` is a usage error (1).

Exit 2 is the no-verdict bucket, not an error severity. When `check` cannot dispatch an adapter for the test file, it exits 2 with a diagnostic on stderr. In the default JSON format it also writes a stable no-verdict envelope to stdout (additive, `schemaVersion` 0.5 — no rule verdicts are invented):

```json
{
  "kind": "check",
  "schemaVersion": "0.5",
  "analysisStatus": "UNSUPPORTED",
  "evaluationStatus": "FAILED",
  "completeness": "NOT_APPLICABLE",
  "reasonCode": "NO_ADAPTER_MATCHED",
  "reason": "no adapter matched for <path>; run 'checktest doctor --test <path>' to inspect dispatch, or force an adapter with --adapter <id>",
  "test": { "file": "<path>" },
  "ruleResults": [],
  "testResults": [],
  "summary": { "total": 0, "pass": 0, "fail": 0, "indeterminate": 0, "not_applicable": 0, "failed": 0 }
}
```

`evaluationStatus: FAILED` here means no verdict was reached (the rule was never evaluated) — never a rule FAIL. With `--format sarif` no envelope is emitted: stdout stays empty and the diagnostic rides stderr, unchanged.

### Discoverability

Two read-only subcommands help orient a new user without running an analysis.

**`doctor`** — environment probe (manifests, registered adapters + capabilities, config validity). Add `--json` for machine-readable output; add `--test <path>` to probe adapter dispatch for a single file; add `--adapter <id>` to force the adapter for that probe (an unregistered id falls through to the manifest/extension layers, same as `check`).

```sh
checktest doctor            # human-readable env probe (exits 0)
checktest doctor --json     # machine-readable env probe (kind: doctor, schemaVersion 0.5)
checktest doctor --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts
checktest doctor --test <path> --adapter <id>   # explicit adapter for the dispatch probe
```

`doctor --test <path>` output (verbatim, exit 0):

```
checktest doctor (dispatch)
Test: tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts
Adapter: typescript-jest-adapter (manifest) resolved
```

`doctor --json` (env mode) shape — capabilities, never a framework-certainty claim:

```json
{
  "kind": "doctor",
  "schemaVersion": "0.5",
  "mode": "env",
  "node": "v24.18.1",
  "manifests": [{ "name": "package.json", "present": true }],
  "adapters": [
    {
      "id": "typescript-jest-adapter",
      "version": "0.1.0",
      "language": "typescript",
      "extensions": [".ts", ".tsx", ".js", ".jsx"],
      "manifestSignatures": ["package.json"],
      "providerHints": ["istanbul", "c8", "stryker"],
      "capabilities": {
        "frameworks": ["jest", "vitest", "mocha"],
        "assertionForms": ["expect-to-be", "expect-to-equal"]
      }
    }
  ],
  "config": { "supplied": false, "status": "not-supplied" },
  "supported": { "extensions": [".ts", ".tsx", ".js", ".jsx"], "frameworks": ["jest", "vitest", "mocha"] }
}
```

**`explain`** — print a registered rule's full `RuleMetadata` (meaning, applicability, required evidence, evaluation, severity, status, rationale, limitations, docs URL) without analyzing any file. Add `--json` for machine-readable output.

```sh
checktest explain --rule CT-INT-001          # human-readable (exits 0)
checktest explain --rule CT-INT-001 --json   # machine-readable (kind: explain, schemaVersion 0.5)
checktest explain --rule CT-NOPE             # unknown id -> exit 1, lists registered ids on stderr
```

`explain --rule CT-INT-001` output (verbatim, exit 0):

```
checktest explain: CT-INT-001
Name: assertion-required
Category: integrity
Description: A test should contain at least one executable verification of an observable outcome.
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
Severity: error
Status: active
Rationale: A test without an executable assertion verifies nothing, so its verdict would rest on the absence of evidence (SPEC:490-525).
Limitations: Executability after return/throw and inside callbacks is unresolved (plan A7); unestablished assertion constructs are excluded from the count, so a helper-built assertion is not established.
Docs URL: https://github.com/victor-petropoulos/CheckTest/blob/main/docs/supported-syntax.md#assertion-forms-11-forms-a9
```

### Rule Lifecycle

- `CT-INT-001` — **Active**
- `CT-INT-003` — **Active**
- `CT-INT-004` — **Active**
- `CT-COV-001` — **Active**
- `CT-MUT-001` — **Active**

- **Active** — evaluated by default; verdicts produced like any rule.
- **Draft** — excluded by default; opt in via `--rule <id>`.
- **Deprecated** — still evaluated and reported until removal; reports carry `deprecatedSince`.

No Draft or Deprecated rules are registered today; all five registered rules are Active. `src/rules/ct-demo-001.ts` is an unregistered N/A-path stub used only in tests; it is not a shipped rule (see [rule catalog](./docs/rules/catalog.md)).

## Supported Frameworks

Jest and Vitest are supported natively. Mocha-class bare-global derivations and Supertest HTTP assertion chains also produce evidence. JSX in `.js` test files parses.

- **Jest**: import from `jest` or any `@jest/*` subpath that ships runtime code
- **Vitest**: import from `vitest` or `vitest/*`; bare `vi.<name>(...)` calls also count as a Vitest signal
- **Derived fallback**: bare `it`/`test` + `expect` (no import) → inferred as Jest; bare `describe`/`it`/`test` without `expect` → `mocha` ([limitations §22](./docs/limitations.md#22-mocha-class-bare-global-derivation-p2-sp2))
- **Supertest chains**: `request(app).<method>(...).expect(...)` → `supertest-expect-status` / `supertest-expect-body` ([supported-syntax](./docs/supported-syntax.md#supertest-http-assertion-chains-sp3-2026-11-09))
- **JSX in `.js`**: files with JSX tags parse via `ts.ScriptKind.JSX` with TS fallback on diagnostics

- **Python**: `pytest` and `unittest`, statically collected (the file is never executed) → adapter id `python-pytest-adapter` ([supported-syntax Python section](./docs/supported-syntax.md#python); [limitations §23](./docs/limitations.md)). Example: `checktest check --test test_sample.py --adapter python-pytest-adapter`

See [supported syntax](./docs/supported-syntax.md) for assertion forms and [framework detection](./docs/supported-syntax.md#framework-detection) rules. See [docs/limitations.md](./docs/limitations.md) for declared gaps. Coverage rule CT-COV-001 is Active (activated 2026-11-07 via ADR-031); with an explicit `--coverage-map` it evaluates mapped coverage — see [docs/limitations.md](./docs/limitations.md) §14.

## Agent Skill (using-checktest)

The repo ships the `using-checktest` skill — the operating guide for using CheckTest _with_ an AI coding agent (verdict semantics, exit-code honesty, evidence-interpretation rules, common mistakes).

- In-repo path: [`.agents/skills/using-checktest/SKILL.md`](./.agents/skills/using-checktest/SKILL.md).
- npm installs: the skill file ships in the published `checktest-cli` package (`package.json` `files` includes `.agents/skills`) — find it at `node_modules/checktest-cli/.agents/skills/using-checktest/SKILL.md`.
- Clone-and-build: copy the repo path into your agent's skills directory, e.g. `mkdir -p ~/.agents/skills && cp -r .agents/skills/using-checktest ~/.agents/skills/` (OpenCode: `~/.config/opencode/skills/`; adjust for your agent's convention).

## Example Output

```json
{
  "test": {
    "id": "tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts",
    "name": "sample.test.ts",
    "file": "tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts",
    "language": "typescript",
    "framework": "jest",
    "type": "UNIT"
  },
  "analysisStatus": "SUCCESS",
  "evaluationStatus": "EVALUATED",
  "completeness": "COMPLETE",
  "scope": "test-body",
  "test_type": {
    "value": "UNIT",
    "source": "EXPLICIT"
  },
  "capabilities": {
    "assertion_forms": "AVAILABLE",
    "custom_helper_resolution": "UNAVAILABLE",
    "runtime_execution": "UNAVAILABLE"
  },
  "evidence": {
    "assertion_count": {
      "value": 1,
      "availability": "KNOWN",
      "provenance": "DIRECT",
      "source": "typescript-jest-adapter",
      "collector_version": "0.1.0",
      "scope": "test-body",
      "coverage": {
        "status": "COMPLETE",
        "supported_frameworks": ["jest", "vitest"],
        "supported_assertion_forms": [
          "expect-to-be",
          "expect-to-equal",
          "expect-to-be-truthy",
          "expect-to-be-falsy",
          "expect-to-throw",
          "expect-rejects-to-throw",
          "expect-to-match-snapshot",
          "expect-to-contain",
          "expect-matcher-utils",
          "expect-to-match-object",
          "expect-to-have-been-called-times"
        ]
      },
      "location": {
        "file": "tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts",
        "line": 9
      }
    }
  },
  "ruleResults": [
    {
      "rule_id": "CT-INT-001",
      "result": "PASS",
      "reason": "CT-INT-001: assertion_count=1 >= 1",
      "evidence": ["assertion_count"],
      "test_id": "tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts#it@8",
      "location": {
        "file": "tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts",
        "line": 9
      }
    }
  ],
  "schemaVersion": "0.5",
  "adapter": "typescript-jest-adapter",
  "decidedBy": "manifest",
  "testResults": [
    {
      "test": {
        "id": "tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts#it@8",
        "name": "adds two numbers",
        "line": 8,
        "declaration": "it"
      },
      "analysisStatus": "SUCCESS",
      "evaluationStatus": "EVALUATED",
      "completeness": "COMPLETE",
      "evidence": {
        "assertion_count": {
          "value": 1,
          "availability": "KNOWN",
          "provenance": "DIRECT",
          "source": "typescript-jest-adapter",
          "collector_version": "0.1.0",
          "scope": "test-body",
          "coverage": {
            "status": "COMPLETE",
            "supported_frameworks": ["jest", "vitest"],
            "supported_assertion_forms": [
              "expect-to-be",
              "expect-to-equal",
              "expect-to-be-truthy",
              "expect-to-be-falsy",
              "expect-to-throw",
              "expect-rejects-to-throw",
              "expect-to-match-snapshot",
              "expect-to-contain",
              "expect-matcher-utils",
              "expect-to-match-object",
              "expect-to-have-been-called-times"
            ]
          },
          "location": {
            "file": "tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts",
            "line": 9
          }
        }
      },
      "ruleResults": [
        {
          "rule_id": "CT-INT-001",
          "result": "PASS",
          "reason": "CT-INT-001: assertion_count=1 >= 1",
          "evidence": ["assertion_count"],
          "test_id": "tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts#it@8",
          "location": {
            "file": "tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts",
            "line": 9
          }
        }
      ]
    }
  ],
  "summary": {
    "total": 1,
    "pass": 1,
    "fail": 0,
    "indeterminate": 0,
    "not_applicable": 0,
    "failed": 0
  }
}
```

**schemaVersion 0.5.** The report envelope optionally carries `adapter` and `decidedBy` keys between `schemaVersion` and `testResults`; `decidedBy` records the dispatch layer (`flag`/`manifest`/`extension`/`unsupported`, ADR-034). The example block above already shows `0.5` + `adapter` + `decidedBy`.

### Richer example: evidence strength and unestablished assertions

The example above shows a single straight-line assertion. The report below is a real run over a file with two declarations — one straight-line assertion and one assertion nested inside a callback — and shows `evidenceStrength` on the evidence record AND on the finding, plus the `unestablished_assertions` signal. Generated with the default JSON format (paths are repo-relative, exactly as the CLI emits them when invoked with a relative `--test` path):

```sh
checktest check --test tests/fixtures/int003-probes/probe-mixed.test.ts --type UNIT
```

- `established scope` (line 1): straight-line `expect(10).toBe(10)` — executing the test proves the assertion ran, so its `assertion_count` evidence record and its `PASS` finding both carry `evidenceStrength: "EXECUTION_ESTABLISHED"`.
- `unestablished scope` (line 5): `expect(20).toBe(20)` inside `[1].forEach(...)` — the assertion form is visible in source, but callback execution cannot be established statically. Its evidence record carries `evidenceStrength: "SYNTAX_OBSERVED"` and `unestablished_assertions: { "count": 1, "reasons": [...] }`, and its finding is `INDETERMINATE` (unestablished evidence never produces `FAIL`).
- The file-level `evidence.assertion_count` aggregate carries the weakest strength (`SYNTAX_OBSERVED`) and `availability: "UNKNOWN"`. Strength and availability are independent axes: a strength value never turns `UNKNOWN` into `KNOWN`. An omitted `evidenceStrength` means no strength value was supplied and MUST NOT be read as `EXECUTION_ESTABLISHED`.

```json
{
  "test": {
    "id": "tests/fixtures/int003-probes/probe-mixed.test.ts",
    "name": "probe-mixed.test.ts",
    "file": "tests/fixtures/int003-probes/probe-mixed.test.ts",
    "language": "typescript",
    "framework": "jest",
    "type": "UNIT"
  },
  "analysisStatus": "SUCCESS",
  "evaluationStatus": "EVALUATED",
  "completeness": "COMPLETE",
  "scope": "test-body",
  "test_type": {
    "value": "UNIT",
    "source": "EXPLICIT"
  },
  "capabilities": {
    "assertion_forms": "PARTIAL",
    "custom_helper_resolution": "UNAVAILABLE",
    "runtime_execution": "UNAVAILABLE",
    "framework_detection": "PARTIAL"
  },
  "evidence": {
    "assertion_count": {
      "value": 1,
      "availability": "UNKNOWN",
      "provenance": "DIRECT",
      "source": "typescript-jest-adapter",
      "collector_version": "0.1.0",
      "scope": "test-body",
      "coverage": {
        "status": "PARTIAL",
        "supported_frameworks": ["jest", "vitest", "mocha"],
        "supported_assertion_forms": [
          "expect-to-be",
          "expect-to-equal",
          "expect-to-be-truthy",
          "expect-to-be-falsy",
          "expect-to-throw",
          "expect-rejects-to-throw",
          "expect-to-match-snapshot",
          "expect-to-contain",
          "expect-matcher-utils",
          "expect-to-match-object",
          "expect-to-have-been-called-times"
        ]
      },
      "reason": "framework 'jest' derived from bare-global test declarations and expect() usage with no framework import; bare globals cannot distinguish jest from mocha/chai/jasmine, so assertions are counted only when the matcher matches a supported form | 1 of 2 recognized assertion(s) have unestablished executability: expect(20).toBe(20) — assertion is inside a callback; callback execution cannot be established statically",
      "location": {
        "file": "tests/fixtures/int003-probes/probe-mixed.test.ts",
        "line": 2
      },
      "evidenceStrength": "SYNTAX_OBSERVED"
    }
  },
  "ruleResults": [
    {
      "rule_id": "CT-INT-001",
      "result": "PASS",
      "reason": "CT-INT-001: assertion_count=1 >= 1",
      "evidence": ["assertion_count"],
      "ruleStatus": "active",
      "description": "A test should contain at least one executable verification of an observable outcome.",
      "rationale": "A test without an executable assertion verifies nothing, so its verdict would rest on the absence of evidence (SPEC:490-525).",
      "limitations": "Executability after return/throw and inside callbacks is unresolved (plan A7); unestablished assertion constructs are excluded from the count, so a helper-built assertion is not established.",
      "docsUrl": "https://github.com/victor-petropoulos/CheckTest/blob/main/docs/supported-syntax.md#assertion-forms-11-forms-a9",
      "evidenceStrength": "EXECUTION_ESTABLISHED",
      "provenance": "DIRECT",
      "availability": "KNOWN",
      "test_id": "tests/fixtures/int003-probes/probe-mixed.test.ts#test@1:0",
      "completeness": "COMPLETE",
      "location": {
        "file": "tests/fixtures/int003-probes/probe-mixed.test.ts",
        "line": 2
      }
    },
    {
      "rule_id": "CT-INT-001",
      "result": "INDETERMINATE",
      "reason": "CT-INT-001: coverage.status PARTIAL for 'assertion_count' is below required COMPLETE (1 of 1 recognized assertion(s) have unestablished executability: expect(20).toBe(20) — assertion is inside a callback; callback execution cannot be established statically)",
      "evidence": ["assertion_count"],
      "ruleStatus": "active",
      "description": "A test should contain at least one executable verification of an observable outcome.",
      "rationale": "A test without an executable assertion verifies nothing, so its verdict would rest on the absence of evidence (SPEC:490-525).",
      "limitations": "Executability after return/throw and inside callbacks is unresolved (plan A7); unestablished assertion constructs are excluded from the count, so a helper-built assertion is not established.",
      "docsUrl": "https://github.com/victor-petropoulos/CheckTest/blob/main/docs/supported-syntax.md#assertion-forms-11-forms-a9",
      "evidenceStrength": "SYNTAX_OBSERVED",
      "provenance": "DIRECT",
      "availability": "UNKNOWN",
      "test_id": "tests/fixtures/int003-probes/probe-mixed.test.ts#test@5:0",
      "completeness": "COMPLETE",
      "location": {
        "file": "tests/fixtures/int003-probes/probe-mixed.test.ts",
        "line": 6
      }
    }
  ],
  "schemaVersion": "0.5",
  "adapter": "typescript-jest-adapter",
  "decidedBy": "manifest",
  "testResults": [
    {
      "test": {
        "id": "tests/fixtures/int003-probes/probe-mixed.test.ts#test@1:0",
        "name": "established scope",
        "line": 1,
        "declaration": "test"
      },
      "analysisStatus": "SUCCESS",
      "evaluationStatus": "EVALUATED",
      "completeness": "COMPLETE",
      "evidence": {
        "assertion_count": {
          "value": 1,
          "availability": "KNOWN",
          "provenance": "DIRECT",
          "source": "typescript-jest-adapter",
          "collector_version": "0.1.0",
          "scope": "test-body",
          "coverage": {
            "status": "COMPLETE",
            "supported_frameworks": ["jest", "vitest", "mocha"],
            "supported_assertion_forms": [
              "expect-to-be",
              "expect-to-equal",
              "expect-to-be-truthy",
              "expect-to-be-falsy",
              "expect-to-throw",
              "expect-rejects-to-throw",
              "expect-to-match-snapshot",
              "expect-to-contain",
              "expect-matcher-utils",
              "expect-to-match-object",
              "expect-to-have-been-called-times"
            ]
          },
          "location": {
            "file": "tests/fixtures/int003-probes/probe-mixed.test.ts",
            "line": 2
          },
          "evidenceStrength": "EXECUTION_ESTABLISHED"
        },
        "unestablished_assertion": {
          "value": 0,
          "availability": "KNOWN",
          "provenance": "DIRECT",
          "source": "typescript-jest-adapter",
          "collector_version": "0.1.0",
          "scope": "test-body",
          "coverage": {
            "status": "COMPLETE",
            "supported_frameworks": ["jest", "vitest", "mocha"],
            "supported_assertion_forms": [
              "expect-to-be",
              "expect-to-equal",
              "expect-to-be-truthy",
              "expect-to-be-falsy",
              "expect-to-throw",
              "expect-rejects-to-throw",
              "expect-to-match-snapshot",
              "expect-to-contain",
              "expect-matcher-utils",
              "expect-to-match-object",
              "expect-to-have-been-called-times"
            ]
          },
          "unestablished_assertions": {
            "count": 0,
            "reasons": []
          },
          "evidenceStrength": "SYNTAX_OBSERVED"
        }
      },
      "ruleResults": [
        {
          "rule_id": "CT-INT-001",
          "result": "PASS",
          "reason": "CT-INT-001: assertion_count=1 >= 1",
          "evidence": ["assertion_count"],
          "ruleStatus": "active",
          "description": "A test should contain at least one executable verification of an observable outcome.",
          "rationale": "A test without an executable assertion verifies nothing, so its verdict would rest on the absence of evidence (SPEC:490-525).",
          "limitations": "Executability after return/throw and inside callbacks is unresolved (plan A7); unestablished assertion constructs are excluded from the count, so a helper-built assertion is not established.",
          "docsUrl": "https://github.com/victor-petropoulos/CheckTest/blob/main/docs/supported-syntax.md#assertion-forms-11-forms-a9",
          "evidenceStrength": "EXECUTION_ESTABLISHED",
          "provenance": "DIRECT",
          "availability": "KNOWN",
          "test_id": "tests/fixtures/int003-probes/probe-mixed.test.ts#test@1:0",
          "completeness": "COMPLETE",
          "location": {
            "file": "tests/fixtures/int003-probes/probe-mixed.test.ts",
            "line": 2
          }
        }
      ]
    },
    {
      "test": {
        "id": "tests/fixtures/int003-probes/probe-mixed.test.ts#test@5:0",
        "name": "unestablished scope",
        "line": 5,
        "declaration": "test"
      },
      "analysisStatus": "SUCCESS",
      "evaluationStatus": "EVALUATED",
      "completeness": "COMPLETE",
      "evidence": {
        "assertion_count": {
          "value": 0,
          "availability": "UNKNOWN",
          "provenance": "DIRECT",
          "source": "typescript-jest-adapter",
          "collector_version": "0.1.0",
          "scope": "test-body",
          "coverage": {
            "status": "PARTIAL",
            "supported_frameworks": ["jest", "vitest", "mocha"],
            "supported_assertion_forms": [
              "expect-to-be",
              "expect-to-equal",
              "expect-to-be-truthy",
              "expect-to-be-falsy",
              "expect-to-throw",
              "expect-rejects-to-throw",
              "expect-to-match-snapshot",
              "expect-to-contain",
              "expect-matcher-utils",
              "expect-to-match-object",
              "expect-to-have-been-called-times"
            ]
          },
          "reason": "1 of 1 recognized assertion(s) have unestablished executability: expect(20).toBe(20) — assertion is inside a callback; callback execution cannot be established statically",
          "location": {
            "file": "tests/fixtures/int003-probes/probe-mixed.test.ts",
            "line": 6
          },
          "unestablished_assertions": {
            "count": 1,
            "reasons": ["assertion is inside a callback; callback execution cannot be established statically"]
          },
          "evidenceStrength": "SYNTAX_OBSERVED"
        },
        "unestablished_assertion": {
          "value": 1,
          "availability": "KNOWN",
          "provenance": "DIRECT",
          "source": "typescript-jest-adapter",
          "collector_version": "0.1.0",
          "scope": "test-body",
          "coverage": {
            "status": "PARTIAL",
            "supported_frameworks": ["jest", "vitest", "mocha"],
            "supported_assertion_forms": [
              "expect-to-be",
              "expect-to-equal",
              "expect-to-be-truthy",
              "expect-to-be-falsy",
              "expect-to-throw",
              "expect-rejects-to-throw",
              "expect-to-match-snapshot",
              "expect-to-contain",
              "expect-matcher-utils",
              "expect-to-match-object",
              "expect-to-have-been-called-times"
            ]
          },
          "unestablished_assertions": {
            "count": 1,
            "reasons": ["assertion is inside a callback; callback execution cannot be established statically"]
          },
          "evidenceStrength": "SYNTAX_OBSERVED"
        }
      },
      "ruleResults": [
        {
          "rule_id": "CT-INT-001",
          "result": "INDETERMINATE",
          "reason": "CT-INT-001: coverage.status PARTIAL for 'assertion_count' is below required COMPLETE (1 of 1 recognized assertion(s) have unestablished executability: expect(20).toBe(20) — assertion is inside a callback; callback execution cannot be established statically)",
          "evidence": ["assertion_count"],
          "ruleStatus": "active",
          "description": "A test should contain at least one executable verification of an observable outcome.",
          "rationale": "A test without an executable assertion verifies nothing, so its verdict would rest on the absence of evidence (SPEC:490-525).",
          "limitations": "Executability after return/throw and inside callbacks is unresolved (plan A7); unestablished assertion constructs are excluded from the count, so a helper-built assertion is not established.",
          "docsUrl": "https://github.com/victor-petropoulos/CheckTest/blob/main/docs/supported-syntax.md#assertion-forms-11-forms-a9",
          "evidenceStrength": "SYNTAX_OBSERVED",
          "provenance": "DIRECT",
          "availability": "UNKNOWN",
          "test_id": "tests/fixtures/int003-probes/probe-mixed.test.ts#test@5:0",
          "completeness": "COMPLETE",
          "location": {
            "file": "tests/fixtures/int003-probes/probe-mixed.test.ts",
            "line": 6
          }
        }
      ]
    }
  ],
  "summary": {
    "total": 2,
    "pass": 1,
    "fail": 0,
    "indeterminate": 1,
    "not_applicable": 0,
    "failed": 0
  }
}
```

## Documentation

| Doc                                                    | Content                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| [docs/supported-syntax.md](./docs/supported-syntax.md) | Assertion forms, declaration types, straight-line body rule |
| [docs/limitations.md](./docs/limitations.md)           | Known gaps and intentional boundaries                       |
