# INT-003 probe fixtures

Source of truth for the 4 probe inputs consumed by `tests/rules/ct-int-003.test.ts`
(real-CLI probes, invoked through the compiled `dist/src/cli.js`).

## Origin

Copied **verbatim** from `.opencode/scratch/int003-capability-seam/probes/`
(`probe-*.test.ts` only). The scratch directory is gitignored (`.gitignore:7`)
and is a measurement-run artifact; these 4 files are permanent CI inputs, which
is what `tests/fixtures/` is for (see `tests/fixtures/ct-int-001/`).

## Byte-identical rule

Each file here MUST remain byte-identical to its scratch original. Do not edit.
The SHA-256 of each file is pinned in the plan
`.opencode/plans/2026-11-18-ci-probe-fix.md` (task 1) and verified by the
reviewer gate. Regenerating a probe requires re-running the INT-003 probe
measurement and re-copying verbatim.

## Files

- `probe-callback.test.ts`
- `probe-nested.test.ts`
- `probe-mixed.test.ts`
- `probe-custom-helper.test.ts`

The `.opencode/scratch/.../probes/*.json` / `*.err` output artifacts are NOT
copied here — only the `.test.ts` sources are tracked.
