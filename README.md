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
checktest check --test <file> [--type UNIT|COMPONENT|INTEGRATION|CONTRACT|E2E] [--rule <id>] [--format json|sarif] [--coverage-report <path>] [--mutation-report <path>]
```

Full `--help` output (verified live):

```
Usage: checktest [check] --test <path> [--type <TYPE>] [--rule <id>] [--format <fmt>]

  --test <path>   test file to analyze (required)
  --type <TYPE>   declared test type: UNIT | COMPONENT | INTEGRATION | CONTRACT | E2E | UNKNOWN
                  (default UNKNOWN; never inferred from the file)
  --rule <id>     rule to evaluate (default CT-INT-001)
  --format <fmt>  report format: 'json' | 'sarif' (default json)
  --coverage-report <path>  external Istanbul/c8 coverage report to attach
  --mutation-report <path>  external Stryker mutation report to attach

Writes the report (JSON by default, SARIF 2.1.0 with --format sarif) to
stdout. Exits 0 when the rule was evaluated (any rule result, including FAIL,
and any UNSUPPORTED analysis), 2 when the engine reached no verdict (including
a file that declares no tests), and 1 on a usage error or a failed run.
```

### Flags

| Flag                       | Description                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--test <path>`            | Path to the test file to analyze (required)                                                              |
| `--type <TYPE>`            | Declared test type: `UNIT`, `COMPONENT`, `INTEGRATION`, `CONTRACT`, `E2E`, `UNKNOWN` (default `UNKNOWN`) |
| `--rule <id>`              | Rule ID to evaluate (default `CT-INT-001`)                                                               |
| `--format <fmt>`           | Report format: `json` or `sarif` (default `json`)                                                        |
| `--coverage-report <path>` | External Istanbul/c8 coverage report JSON to attach                                                      |
| `--mutation-report <path>` | External Stryker mutation report JSON to attach                                                          |

### Exit Codes

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| `0`  | Verdict produced (PASS, FAIL, INDETERMINATE, or UNSUPPORTED analysis)   |
| `1`  | Usage error or runtime crash                                            |
| `2`  | No verdict — engine reached no conclusion (e.g. file declares no tests) |

## Supported Frameworks

Jest and Vitest are supported natively. Mocha-class bare-global derivations and Supertest HTTP assertion chains also produce evidence. JSX in `.js` test files parses.

- **Jest**: import from `jest` or any `@jest/*` subpath that ships runtime code
- **Vitest**: import from `vitest` or `vitest/*`; bare `vi.<name>(...)` calls also count as a Vitest signal
- **Derived fallback**: bare `it`/`test` + `expect` (no import) → inferred as Jest; bare `describe`/`it`/`test` without `expect` → `mocha` ([limitations §22](./docs/limitations.md#22-mocha-class-bare-global-derivation-p2-sp2))
- **Supertest chains**: `request(app).<method>(...).expect(...)` → `supertest-expect-status` / `supertest-expect-body` ([supported-syntax](./docs/supported-syntax.md#supertest-http-assertion-chains-sp3-2026-11-09))
- **JSX in `.js`**: files with JSX tags parse via `ts.ScriptKind.JSX` with TS fallback on diagnostics

See [docs/supported-syntax.md](./docs/supported-syntax.md) for the full assertion-form allowlist and framework-detection rules. See [docs/limitations.md](./docs/limitations.md) for declared gaps. Coverage rule CT-COV-001 is currently a draft rule: it reports (and attaches) coverage evidence but produces no verdicts; see [docs/limitations.md](./docs/limitations.md) §14.

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
  "schemaVersion": "0.4",
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

## Documentation

| Doc                                                    | Content                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| [docs/supported-syntax.md](./docs/supported-syntax.md) | Assertion forms, declaration types, straight-line body rule |
| [docs/limitations.md](./docs/limitations.md)           | Known gaps and intentional boundaries                       |
