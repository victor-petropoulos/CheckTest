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

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| `0`  | Verdict produced (PASS, FAIL, INDETERMINATE, or UNSUPPORTED analysis)   |
| `1`  | Usage error or runtime crash                                            |
| `2`  | No verdict — engine reached no conclusion (e.g. file declares no tests) |

### Rule Lifecycle

- `CT-INT-001` — **Active**
- `CT-INT-003` — **Active**
- `CT-INT-004` — **Active**
- `CT-COV-001` — **Active**
- `CT-MUT-001` — **Active**
- `CT-DEMO-001` — **Active**

- **Active** — evaluated by default; verdicts produced like any rule.
- **Draft** — excluded by default; opt in via `--rule <id>`.
- **Deprecated** — still evaluated and reported until removal; reports carry `deprecatedSince`.

No Draft or Deprecated rules are registered today; all six shipped rules are Active.

## Supported Frameworks

Jest and Vitest are supported natively. Mocha-class bare-global derivations and Supertest HTTP assertion chains also produce evidence. JSX in `.js` test files parses.

- **Jest**: import from `jest` or any `@jest/*` subpath that ships runtime code
- **Vitest**: import from `vitest` or `vitest/*`; bare `vi.<name>(...)` calls also count as a Vitest signal
- **Derived fallback**: bare `it`/`test` + `expect` (no import) → inferred as Jest; bare `describe`/`it`/`test` without `expect` → `mocha` ([limitations §22](./docs/limitations.md#22-mocha-class-bare-global-derivation-p2-sp2))
- **Supertest chains**: `request(app).<method>(...).expect(...)` → `supertest-expect-status` / `supertest-expect-body` ([supported-syntax](./docs/supported-syntax.md#supertest-http-assertion-chains-sp3-2026-11-09))
- **JSX in `.js`**: files with JSX tags parse via `ts.ScriptKind.JSX` with TS fallback on diagnostics

- **Python**: `pytest` and `unittest`, statically collected (the file is never executed) → adapter id `python-pytest-adapter` ([supported-syntax Python section](./docs/supported-syntax.md#python); [limitations §23](./docs/limitations.md)). Example: `checktest check --test test_sample.py --adapter python-pytest-adapter`

See [supported syntax](./docs/supported-syntax.md) for assertion forms and [framework detection](./docs/supported-syntax.md#framework-detection) rules. See [docs/limitations.md](./docs/limitations.md) for declared gaps. Coverage rule CT-COV-001 is Active (activated 2026-11-07 via ADR-031); with an explicit `--coverage-map` it evaluates mapped coverage — see [docs/limitations.md](./docs/limitations.md) §14.

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

## Documentation

| Doc                                                    | Content                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| [docs/supported-syntax.md](./docs/supported-syntax.md) | Assertion forms, declaration types, straight-line body rule |
| [docs/limitations.md](./docs/limitations.md)           | Known gaps and intentional boundaries                       |
