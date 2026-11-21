/**
 * Phase 8 task B4 — registry integration tests.
 *
 * Unlike tests/adapters/registry.test.ts (pure injected-fsState unit cases),
 * these exercise resolveAdapter against REAL filesystem state (existsSync over
 * a tmpdir / fixture directory) so the manifest layer actually reads disk.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { AdapterRegistry, resolveAdapter } from '../../src/adapters/registry';
import type { Adapter } from '../../src/adapters/adapter';
import { typescriptAdapter } from '../../src/adapters/typescript/adapter';
import type { AnalysisOutput } from '../../src/core/analysis';

const FIXTURE_ROOT = join(__dirname, '..', 'fixtures', 'ct-int-001');

/** Minimal second adapter used only to force manifest-layer ambiguity. */
const fakePythonAdapter: Adapter = {
  id: 'python-test-adapter',
  version: '0.1.0',
  language: 'python',
  extensions: ['.py'],
  manifestSignatures: ['pyproject.toml'],
  capabilities: { frameworks: [], assertionForms: [] },
  providerHints: [],
  collectAnalysis: () => ({}) as AnalysisOutput,
};

describe('registry integration (Phase 8 task B4)', () => {
  const rmRf = (dir: string) => rmSync(dir, { recursive: true, force: true });

  it('.ts file, no flag, no manifest (tmpdir) -> extension / typescript-jest-adapter', () => {
    const dir = join(tmpdir(), `checktest-b4-ts-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'sample.test.ts');
    writeFileSync(file, "test('x', () => { expect(1).toBe(1); });\n");
    try {
      const fsState = { manifestExists: (name: string) => existsSync(join(dir, name)) };
      const result = resolveAdapter(file, {}, fsState);
      expect(result).toEqual({
        adapterId: 'typescript-jest-adapter',
        decidedBy: 'extension',
        reason: null,
      });
    } finally {
      rmRf(dir);
    }
  });

  it('.ts file, no flag, no manifest (fixture case dir layout) -> extension / typescript-jest-adapter', () => {
    const caseDir = join(FIXTURE_ROOT, 'case-24-vitest-standard');
    const file = join(caseDir, 'sample.test.ts');
    const fsState = { manifestExists: (name: string) => existsSync(join(caseDir, name)) };
    const result = resolveAdapter(file, {}, fsState);
    expect(result).toEqual({
      adapterId: 'typescript-jest-adapter',
      decidedBy: 'extension',
      reason: null,
    });
  });

  it('.py file, no flag, no manifest (tmpdir) -> extension / python-pytest-adapter', () => {
    // python adapter registered (C4): a .py file in a directory with no
    // python manifest now resolves via the extension layer (lowest priority)
    // to the python adapter — no more 'no adapter matched'.
    const dir = join(tmpdir(), `checktest-b4-py-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'sample.test.py');
    writeFileSync(file, 'def test_x():\n    assert True\n');
    try {
      const fsState = { manifestExists: (name: string) => existsSync(join(dir, name)) };
      const result = resolveAdapter(file, {}, fsState);
      expect(result).toEqual({
        adapterId: 'python-pytest-adapter',
        decidedBy: 'extension',
        reason: null,
      });
    } finally {
      rmRf(dir);
    }
  });

  it('--adapter flag naming a registered id -> flag layer', () => {
    const result = resolveAdapter(
      'anything.py',
      { adapter: 'typescript-jest-adapter' },
      {
        manifestExists: () => false,
      },
    );
    expect(result).toEqual({
      adapterId: 'typescript-jest-adapter',
      decidedBy: 'flag',
      reason: null,
    });
  });

  it('ambiguous manifest (package.json + pyproject.toml) resolves per-file by extension affinity (WP10 F1)', () => {
    // SEMANTIC CHANGE (WP10 F1, plan task 1a + §Notes): the manifest layer is
    // refined to filter candidates to adapters that BOTH match a manifest
    // signature AND claim the file extension (option b). With two manifest
    // signatures present each file therefore resolves to the single adapter that
    // claims ITS extension: .ts -> typescript-jest-adapter/manifest,
    // .py -> python-test-adapter/manifest, .rs -> unsupported (no
    // manifest-matching adapter claims it and no extension matches either).
    // PRE-FIX this test asserted a fall-through to the extension layer for ALL
    // files (2 manifest candidates -> inconclusive). See
    // .opencode/plans/2026-11-21-wp10-f1-ci-option-a.md §Notes "Deliberate
    // test-expectation change" — this is the one existing expectation the fix
    // deliberately changes.
    const dir = join(tmpdir(), `checktest-b4-ambig-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{}\n');
    writeFileSync(join(dir, 'pyproject.toml'), '');
    const tsFile = join(dir, 'sample.test.ts');
    const pyFile = join(dir, 'sample.test.py');
    const rsFile = join(dir, 'sample.test.rs');
    writeFileSync(tsFile, '');
    writeFileSync(pyFile, '');
    writeFileSync(rsFile, '');
    const registry = new AdapterRegistry();
    registry.register(typescriptAdapter);
    registry.register(fakePythonAdapter);
    try {
      const fsState = { manifestExists: (name: string) => existsSync(join(dir, name)) };
      // .ts: only the TS adapter (package.json) claims .ts -> manifest decides.
      const tsResult = resolveAdapter(tsFile, {}, fsState, registry);
      expect(tsResult).toEqual({
        adapterId: 'typescript-jest-adapter',
        decidedBy: 'manifest',
        reason: null,
      });
      // .py: only python-test-adapter (pyproject.toml) claims .py -> manifest.
      const pyResult = resolveAdapter(pyFile, {}, fsState, registry);
      expect(pyResult).toEqual({
        adapterId: 'python-test-adapter',
        decidedBy: 'manifest',
        reason: null,
      });
      // .rs: no manifest-matching adapter claims it, no extension match -> unsupported.
      const rsResult = resolveAdapter(rsFile, {}, fsState, registry);
      expect(rsResult).toEqual({
        adapterId: null,
        decidedBy: 'unsupported',
        reason: 'no adapter matched',
      });
    } finally {
      rmRf(dir);
    }
  });

  // WP10 F1 (plan task 1a): a manifest-owning cwd (package.json present) must
  // not select an adapter that does not claim the file extension. These exercise
  // the DEFAULT registry against real fs state with package.json present in the
  // injected (tmpdir) cwd. Under the pre-fix code the manifest layer picks the
  // TS adapter for ANY file (package.json is a TS signature), misrouting .py/.rs;
  // post-fix the manifest candidates are extension-affinity filtered.
  it('package.json present + .py -> extension / python-pytest-adapter (not TS/manifest)', () => {
    const dir = join(tmpdir(), `checktest-f1-manifest-py-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{}\n');
    const pyFile = join(dir, 'sample.test.py');
    writeFileSync(pyFile, 'def test_x():\n    assert True\n');
    try {
      const fsState = { manifestExists: (name: string) => existsSync(join(dir, name)) };
      const result = resolveAdapter(pyFile, {}, fsState);
      expect(result).toEqual({
        adapterId: 'python-pytest-adapter',
        decidedBy: 'extension',
        reason: null,
      });
    } finally {
      rmRf(dir);
    }
  });

  it('package.json present + .rs -> unsupported (no adapter matched)', () => {
    const dir = join(tmpdir(), `checktest-f1-manifest-rs-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{}\n');
    const rsFile = join(dir, 'sample.test.rs');
    writeFileSync(rsFile, 'fn test_x() {}\n');
    try {
      const fsState = { manifestExists: (name: string) => existsSync(join(dir, name)) };
      const result = resolveAdapter(rsFile, {}, fsState);
      expect(result).toEqual({
        adapterId: null,
        decidedBy: 'unsupported',
        reason: 'no adapter matched',
      });
    } finally {
      rmRf(dir);
    }
  });

  it('package.json present + .ts -> manifest / typescript-jest-adapter (unchanged pin)', () => {
    const dir = join(tmpdir(), `checktest-f1-manifest-ts-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{}\n');
    const tsFile = join(dir, 'sample.test.ts');
    writeFileSync(tsFile, '');
    try {
      const fsState = { manifestExists: (name: string) => existsSync(join(dir, name)) };
      const result = resolveAdapter(tsFile, {}, fsState);
      expect(result).toEqual({
        adapterId: 'typescript-jest-adapter',
        decidedBy: 'manifest',
        reason: null,
      });
    } finally {
      rmRf(dir);
    }
  });
});
