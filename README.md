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

Jest and Vitest are supported. Files importing other frameworks (Mocha, Jasmine, Playwright Test, etc.) report `UNSUPPORTED`.

- **Jest**: import from `jest` or any `@jest/*` subpath that ships runtime code
- **Vitest**: import from `vitest` or `vitest/*`; bare `vi.<name>(...)` calls also count as a Vitest signal
- **Derived fallback**: a file with no framework import but a bare-global `it`/`test` + `expect` shape is inferred as Jest

See [docs/supported-syntax.md](./docs/supported-syntax.md) for the full assertion-form allowlist and framework-detection rules. See [docs/limitations.md](./docs/limitations.md) for declared gaps.

## Example Output

```json
{
  "analysis": {
    "status": "COMPLETE",
    "completeness": "COMPLETE",
    "framework": "jest",
    "derived": false
  },
  "evidence": {
    "assertion_count": {
      "value": 3,
      "availability": "KNOWN",
      "forms": ["expect-to-be", "expect-to-equal", "expect-to-throw"]
    }
  },
  "tests": [
    {
      "id": "sample.test.ts#it@2",
      "name": "adds two numbers",
      "evidence": { "assertion_count": { "value": 1, "availability": "KNOWN" } },
      "declaration_gap": null
    }
  ],
  "rule_results": [
    {
      "rule_id": "CT-INT-001",
      "verdict": "PASS",
      "confidence": 1.0
    }
  ]
}
```

## Documentation

| Doc                                                    | Content                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| [docs/supported-syntax.md](./docs/supported-syntax.md) | Assertion forms, declaration types, straight-line body rule |
| [docs/limitations.md](./docs/limitations.md)           | Known gaps and intentional boundaries                       |
