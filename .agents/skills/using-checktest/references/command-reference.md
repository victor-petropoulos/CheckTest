# CheckTest command reference (verified 2026-11-24, HEAD 7678038)

Every command below was executed at HEAD. `npx --yes tsx src/cli.ts` is the in-repo form; an installed `checktest` binary takes the same arguments. `--help` is ground truth: no `--json` flag on `check`.

## Verified invocations

```bash
npx --yes tsx src/cli.ts --help
npx --yes tsx src/cli.ts doctor
npx --yes tsx src/cli.ts doctor --json
npx --yes tsx src/cli.ts doctor --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts
npx --yes tsx src/cli.ts doctor --test /tmp/no-such-file.xyz --json
npx --yes tsx src/cli.ts doctor --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts --adapter typescript-jest-adapter
npx --yes tsx src/cli.ts explain --rule CT-INT-001
npx --yes tsx src/cli.ts explain --rule CT-INT-001 --json
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts --type UNIT
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-02-no-assertion/sample.test.ts --type UNIT
npx --yes tsx src/cli.ts check --test tests/fixtures/int003-probes/probe-mixed.test.ts --type UNIT
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-08-callback/sample.test.ts
npx --yes tsx src/cli.ts check --test tests/adapters/python/fixtures/pytest_sample.py --adapter python-pytest-adapter
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts --rule CT-INT-003
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts --format sarif
npx --yes tsx src/cli.ts check --test tests/adapters/python/fixtures/pytest_sample.py --adapter python-pytest-adapter --coverage-report tests/adapters/python/fixtures/coverage_garbage.lcov
npx --yes tsx src/cli.ts check --test /tmp/no-such-file.xyz
```

Observed: `doctor` basic=0; dispatch on fixture=0 (`typescript-jest-adapter (manifest) resolved`); dispatch `.xyz` `--json`=2 (`adapterId: null`, `decidedBy: "unsupported"`, `reason: "no adapter matched"`, plus `requestedAdapter` when supplied); `explain CT-INT-001`=0, unknown rule=1; `check` case-01 PASS=0; case-02 FAIL=0; probe-mixed PASS+INDETERMINATE=0; case-08 (no `--type`, type UNKNOWN) INDETERMINATE=0; Python pytest sample=0; `--rule CT-INT-003`=0; `--format sarif` emits SARIF 2.1.0=0; garbage coverage → two CT-INT-001 INDETERMINATE=0; `.xyz` check=2 with `analysisStatus: "FAILED"`, `evaluationStatus: "FAILED"`, `completeness: "INCOMPLETE"`, no rule verdicts. Unsupported-dispatch envelope (`kind: "check"`, `analysisStatus: "UNSUPPORTED"`, `reasonCode: "NO_ADAPTER_MATCHED"`, `src/cli.ts:687-695`) is emitted only when dispatch throws; in this checkout a single `package.json` manifest resolves the TypeScript adapter for most paths, so verify live instead of assuming that shape.

Bad invocations observed: unknown `--format` → 1 with `unsupported --format 'bogus'; expected one of: json, sarif`; missing `--config` path → 1 with `missing or unreadable --config`.

## Multi-file loop (one check per file)

```bash
files=(tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts tests/adapters/python/fixtures/pytest_sample.py)
out=$(mktemp -d); i=0
while IFS= read -r f; do
  i=$((i+1))
  npx --yes tsx src/cli.ts check --test "$f" > "$out/$i-$(basename "$f").json"
  printf '%s exit=%s\n' "$f" "$?"
done < <(printf '%s\n' "${files[@]}" | LC_ALL=C sort)
```

## Report fields (observed, not a second schema)

JSON `schemaVersion: "0.5"`. Envelope: `test{}`, `analysisStatus`, `evaluationStatus`, `completeness`, `scope`, `test_type{value,source}`, `capabilities{}`, `evidence{}`, `ruleResults[]`, `testResults[]`, `summary{total,pass,fail,indeterminate,not_applicable,failed}`, `adapter`, `decidedBy`, and optionally `manifestFramework` (manifest-declared framework from package.json when dispatch is manifest-decided). `doctor`/`explain` payloads carry `kind: "doctor"|"explain"`; `check` envelope observed without `kind` on the normal path. Evidence record: `value`, `availability` (`KNOWN|UNKNOWN|NOT_APPLICABLE`), `provenance` (`DIRECT|DERIVED|EXTERNAL`), `source`, `collector_version`, `scope`, `coverage{status COMPLETE|PARTIAL|UNAVAILABLE,...}`, `location`, `evidenceStrength` (`SYNTAX_OBSERVED|EXECUTION_ESTABLISHED|UNSUPPORTED`). Finding: `rule_id`, `result` (`PASS|FAIL|INDETERMINATE|N/A`), `reason`, `evidence[]`, `ruleStatus`, `description`, `rationale`, `limitations`, `docsUrl`, `test_id`, `location`. `analysisStatus` and `evaluationStatus` are lifecycle states, not verdicts. Omitted `evidenceStrength` must not be read as EXECUTION_ESTABLISHED. Authoritative schema/contract: `docs/product-contract.md`.

## Exit-code matrix

| Command | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `check` | ≥1 scope reached verdict (FAIL included) | usage error / crash | no verdict (no recognized tests, failed analyses, unresolvable dispatch) |
| `doctor` | diagnostic success | usage error | unresolvable dispatch probe |
| `explain` | rule printed | missing/unregistered rule | none |

CI gating is policy above the CLI; exit 0 is not PASS.

## External evidence

Flags verified in `--help`: `--coverage-report <path>`, `--coverage-map <from>=<to>` (repeatable), `--per-test-run`, `--source-revision <rev>`, `--mutation-report <path>`, `--mutation-source-revision <rev>`, `--config <path>`. Revision mismatch → UNKNOWN/INDETERMINATE, never FAIL from stale evidence. Mutation evidence is file-level only; a matching map is required. Legacy provider keys (`source_revision`/`sourceRevision`/`revision`) are library API only, not CLI-reachable (`docs/limitations.md` §19).

## Rationalization table

| Rationalization | Reality |
| --- | --- |
| Exit 0 means pass. | 0 = verdict produced; FAIL also exits 0. |
| UNSUPPORTED = broken test. | No analysis path; out of evidence, not failure. |
| INDETERMINATE is soft FAIL. | Separate bucket; converting it overclaims. |
| Golden passed. | Only for that adapter + declared completeness. |
| CheckTest FAIL ⇒ edit test. | Advisory; independent judgment wins. |
| I know supported forms. | Ask `doctor --json`; inventories change. |

Red flags: "FAIL so test is wrong"; "exit 0, all good"; collapsing UNSUPPORTED/INDETERMINATE into FAIL/PASS; "golden passed" without adapter/completeness; claiming gate/merge decision from output; presenting mismatched-revision evidence as current.

## Handoff template

```text
CheckTest: run / not run (why). Scope: <file(s)>. Adapter/framework: <id>/<name>.
Evidence: <sources + revisions>. Verdict counts: <PASS/FAIL/INDETERMINATE/N/A>.
analysisStatus: <...>; evaluationStatus: <...>; completeness: <...>.
Unsupported: <...>. Incomplete: <...>. Diagnostics: <...>.
Findings: <rule + location>. Dispositions: <...> (verdicts unchanged).
Remediation: <what/why>. Rerun: <yes/no + result>. Report: <path or stdout capture>.
```

Authoritative product docs: `docs/product-contract.md`, `docs/evaluation-model.md`, `docs/architecture.md`, `docs/rules/catalog.md`, `docs/limitations.md`.
