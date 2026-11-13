/**
 * Phase 8 task B1 — TDD RED: dispatch/registry determinism tests.
 *
 * These tests target `src/adapters/registry.ts`, which DOES NOT EXIST yet.
 * They define the resolveAdapter contract the registry module must satisfy:
 *
 *   resolveAdapter(filePath, flags, fsState) -> { adapterId, decidedBy, reason }
 *
 * Dispatch priority is the Adapter contract's own vocabulary
 * (src/adapters/adapter.ts:122-134 / ADR-034):
 *   1. explicit flag (highest),
 *   2. manifest signature (middle),
 *   3. file extension (lowest).
 * With no adapter matched the result is UNSUPPORTED with a stated reason —
 * never a silent guess (ruling #11: 'a conservative resolution is a stated
 * reason, not a silent pass').
 *
 * Purity: fsState is an injected fake (no real fs, no clock, no randomness);
 * same inputs -> same outputs.
 */

import { resolveAdapter } from '../../src/adapters/registry';

/** Injected fs state: which manifest file names exist for this call. */
function fsStateWith(manifests: string[]) {
  return { manifestExists: (name: string) => manifests.includes(name) };
}

const TS_FILE = 'src/foo.test.ts';
const PY_FILE = 'src/test_thing.py';

describe('adapter registry dispatch (Phase 8 B1 RED)', () => {
  it("1. explicit --adapter flag wins -> decidedBy 'flag'", () => {
    const result = resolveAdapter(TS_FILE, { adapter: 'typescript-jest-adapter' }, fsStateWith([]));
    expect(result).toEqual({
      adapterId: 'typescript-jest-adapter',
      decidedBy: 'flag',
      reason: null,
    });
  });

  it("2. no flag + package.json manifest -> typescript-jest-adapter, decidedBy 'manifest'", () => {
    const result = resolveAdapter(TS_FILE, {}, fsStateWith(['package.json']));
    expect(result).toEqual({
      adapterId: 'typescript-jest-adapter',
      decidedBy: 'manifest',
      reason: null,
    });
  });

  it("3. no flag + no manifest + .ts file -> typescript-jest-adapter, decidedBy 'extension'", () => {
    for (const file of ['src/foo.test.ts', 'src/foo.test.tsx']) {
      const result = resolveAdapter(file, {}, fsStateWith([]));
      expect(result).toEqual({
        adapterId: 'typescript-jest-adapter',
        decidedBy: 'extension',
        reason: null,
      });
    }
  });

  it("4. no flag + no manifest + .py file -> extension / 'python-pytest-adapter' (python adapter registered, C4)", () => {
    // python adapter registered (C4): the default registry now ships the
    // python adapter, so a .py file resolves via the extension layer.
    const result = resolveAdapter(PY_FILE, {}, fsStateWith([]));
    expect(result).toEqual({
      adapterId: 'python-pytest-adapter',
      decidedBy: 'extension',
      reason: null,
    });
  });

  it("4b. boundary extension: 'test.ts.snapshot' is NOT a .ts match -> UNSUPPORTED (extname, not endsWith)", () => {
    const result = resolveAdapter('src/test.ts.snapshot', {}, fsStateWith([]));
    expect(result).toEqual({
      adapterId: null,
      decidedBy: 'unsupported',
      reason: 'no adapter matched',
    });
  });

  it('5. purity: same inputs -> identical outputs (no clock/randomness)', () => {
    const a = resolveAdapter(TS_FILE, {}, fsStateWith(['package.json']));
    const b = resolveAdapter(TS_FILE, {}, fsStateWith(['package.json']));
    expect(a).toEqual(b);
    const c = resolveAdapter(TS_FILE, { adapter: 'typescript-jest-adapter' }, fsStateWith([]));
    const d = resolveAdapter(TS_FILE, { adapter: 'typescript-jest-adapter' }, fsStateWith([]));
    expect(c).toEqual(d);
  });
});
