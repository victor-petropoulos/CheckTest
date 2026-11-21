# CheckTest worked examples (12 scenarios)

All commands executed at HEAD `f77c38f` on 2026-11-20. Use them as templates; replace only the `--test` path with the actual changed test file. Fixture paths keep the examples runnable in this repo.

## 1. Creating a new test

New test file created. Declare its type (do not infer from filename):

```bash
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts --type UNIT
```

Observed: CT-INT-001 `PASS`, `analysisStatus SUCCESS`, `completeness COMPLETE`, exit 0. Record the rule/evidence; do not claim universal quality.

## 2. Modifying an assertion

Assertion removed from a test; rerun its file:

```bash
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-02-no-assertion/sample.test.ts --type UNIT
```

Observed: CT-INT-001 `FAIL` (`assertion_count=0 <= 0`), exit 0. FAIL exits 0. Investigate before any edit.

## 3. Refactoring a test helper

Shared helper changed; check the affected test file (indirect change):

```bash
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-04-custom-helper/sample.test.ts --type UNIT
```

Observed: CT-INT-001 `INDETERMINATE`, `completeness INCOMPLETE`, exit 0. Report which helper construct is unresolvable; no inferred zero.

## 4. Changing production code without changing tests

No CheckTest run is warranted when tests and CheckTest-relevant evidence are unchanged and an existing report is current. Verify with `git diff --name-only` (shell, not CLI) and say "not run — no evaluated test or evidence changed". Do not invent a run or a verdict.

## 5. Receiving a FAIL result

Use scenario 2's command. Then: read `explain --rule CT-INT-001`, inspect evidence and the test at `location.line`, decide whether the finding is meaningful. Keep verdict `FAIL`; do not auto-edit.

## 6. Receiving an INDETERMINATE result

Type not declared (CLI default `UNKNOWN`); run:

```bash
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-08-callback/sample.test.ts
```

Observed: `test_type.value UNKNOWN`, CT-INT-001 `INDETERMINATE`, exit 0. Name the ambiguous evidence; collect more if material; never call this PASS. The mixed fixture (`tests/fixtures/int003-probes/probe-mixed.test.ts --type UNIT`) shows PASS and INDETERMINATE in one report.

## 7. Encountering unsupported syntax / no adapter

```bash
npx --yes tsx src/cli.ts doctor --test /tmp/no-such-file.xyz --json
npx --yes tsx src/cli.ts check --test /tmp/no-such-file.xyz
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-03-unsupported-api/sample.test.ts --type UNIT
```

Observed: doctor dispatch exit 2 (`decidedBy "unsupported"`, `reason "no adapter matched"`); check `.xyz` exit 2 with `analysisStatus FAILED`, empty verdict list; unsupported API fixture yields CT-INT-001 `INDETERMINATE`, exit 0. Report the capability gap; no adapter substitution, no fabricated evidence.

## 8. Encountering incomplete external evidence

```bash
npx --yes tsx src/cli.ts check --test tests/adapters/python/fixtures/pytest_sample.py --adapter python-pytest-adapter --coverage-report tests/adapters/python/fixtures/coverage_garbage.lcov
```

Observed: exit 0; two CT-INT-001 `INDETERMINATE` findings (malformed coverage produces UNKNOWN evidence, not a zero). State that evidence is unparseable; collect a valid report and rerun.

## 9. Accepting a valid finding

Use scenario 2's command. Investigation confirms the condition is intentional. Record: CheckTest verdict `FAIL`; workflow disposition `ACCEPTED`; reason why. Never rewrite the report as PASS.

## 10. Correcting a finding and rerunning

After a justified test change (not assertion weakening), rerun the same file:

```bash
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts --type UNIT
```

Observed: CT-INT-001 `PASS`, exit 0. Compare with the original FAIL; report what changed and why the test remains meaningful.

## 11. Reviewing a pull request with test changes

Run one check per changed test file (no repeatable `--test`); see the sorted multi-file loop in [command reference](command-reference.md#multi-file-loop-one-check-per-file). Verified files for a dry run:

```bash
npx --yes tsx src/cli.ts check --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts --type UNIT
npx --yes tsx src/cli.ts check --test tests/adapters/python/fixtures/pytest_sample.py --adapter python-pytest-adapter
```

Capture each JSON + exit code separately; summarize verdict counts, unsupported/incomplete conditions, and independent review notes. Exit 0 on a FAIL file must not be reported as "all green".

## 12. Investigating a suspected CheckTest adapter defect

```bash
npx --yes tsx src/cli.ts doctor --json
npx --yes tsx src/cli.ts doctor --test tests/fixtures/ct-int-001/case-01-standard-assertion/sample.test.ts --adapter typescript-jest-adapter
npx --yes tsx src/cli.ts explain --rule CT-INT-001 --json
```

Observed: `doctor --json` lists adapters/capabilities; dispatch probe reports `Adapter: typescript-jest-adapter (flag) resolved` (exit 0); `explain --json` prints rule applicability, required evidence, and policies (exit 0). Compare declared capabilities against observed evidence, then classify as adapter defect, evidence-attribution problem, applicability issue, or product defect. If undecidable, report uncertainty; do not patch a test to hide the anomaly.
