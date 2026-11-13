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

  it('ambiguous manifest (package.json + pyproject.toml) falls through to extension layer', () => {
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
      // manifest layer inconclusive (2 candidates) -> extension layer decides
      const tsResult = resolveAdapter(tsFile, {}, fsState, registry);
      expect(tsResult).toEqual({
        adapterId: 'typescript-jest-adapter',
        decidedBy: 'extension',
        reason: null,
      });
      const pyResult = resolveAdapter(pyFile, {}, fsState, registry);
      expect(pyResult).toEqual({
        adapterId: 'python-test-adapter',
        decidedBy: 'extension',
        reason: null,
      });
      // no extension match either -> unsupported
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
});
