/**
 * Task 12 — tracked conformance test for the Adapter contract instance.
 *
 * Pins three properties (brief scope decision 4):
 *   (a) the TypeScript adapter object satisfies the Adapter descriptor shape
 *       with NON-EMPTY metadata (a contract instance with an empty allowlist
 *       would silently claim nothing);
 *   (b) `typescriptAdapter.collectAnalysis` is byte-identical at unit level to
 *       the collector's own function — same fixture, same mapping, deep-equal
 *       envelope (the full-file byte proof lives in
 *       tests/integration/goldens.test.ts + the Task 12 report's CLI-level diff);
 *   (c) the capability lists are the support.ts VALUES (identity, not a copy)
 *       so no duplication can drift.
 */

import { join } from 'path';

import { typescriptAdapter } from '../../src/adapters/typescript/adapter';
import { collectAnalysis } from '../../src/adapters/typescript/collector';
import { SUPPORTED_ASSERTION_FORMS, SUPPORTED_FRAMEWORKS } from '../../src/adapters/typescript/support';
import { pythonAdapter } from '../../src/adapters/python/adapter';
import { collectAnalysis as collectPy } from '../../src/adapters/python/collector';
import {
  SUPPORTED_ASSERTION_FORMS as PY_SUPPORTED_ASSERTION_FORMS,
  SUPPORTED_FRAMEWORKS as PY_SUPPORTED_FRAMEWORKS,
} from '../../src/adapters/python/capabilities';
import { TestType } from '../../src/core/analysis';
import type { Adapter } from '../../src/adapters/adapter';

/** Known fixture, same oracle path the integration suites use. */
const FIXTURE = join(__dirname, '..', 'fixtures', 'ct-int-001', 'case-24-vitest-standard', 'sample.test.ts');

/** Known python fixture, same oracle path the python collector suites use. */
const pyFixture = (name: string) => join(__dirname, 'python', 'fixtures', name);

describe('typescript adapter — Adapter contract conformance (task 12)', () => {
  it('is assignable to the Adapter contract and carries non-empty descriptor metadata', () => {
    // Compile-time conformance, enforced again at runtime for the descriptor:
    const adapter: Adapter = typescriptAdapter;
    expect(adapter.id).toBe('typescript-jest-adapter');
    expect(adapter.version).toBe('0.1.0');
    expect(adapter.language).toBe('typescript');
    expect(adapter.extensions.length).toBeGreaterThan(0);
    expect(adapter.manifestSignatures.length).toBeGreaterThan(0);
    expect(adapter.capabilities.frameworks.length).toBeGreaterThan(0);
    expect(adapter.capabilities.assertionForms.length).toBeGreaterThan(0);
    expect(adapter.providerHints.length).toBeGreaterThan(0);
  });

  it('collectAnalysis deep-equals the collector output for a known fixture (both option shapes)', () => {
    // No options — the adapter default maps to the collector's UNKNOWN default.
    expect(typescriptAdapter.collectAnalysis(FIXTURE)).toEqual(collectAnalysis(FIXTURE));
    // Explicit options bag — the documented positional mapping.
    expect(typescriptAdapter.collectAnalysis(FIXTURE, { declaredType: TestType.UNIT })).toEqual(
      collectAnalysis(FIXTURE, TestType.UNIT),
    );
  });

  it('capability lists are the support.ts exports BY REFERENCE (no duplication drift)', () => {
    // Identity, not deep equality: the same array objects, so the contract can
    // never silently diverge from the allowlist the collector enforces.
    expect(typescriptAdapter.capabilities.frameworks).toBe(SUPPORTED_FRAMEWORKS);
    expect(typescriptAdapter.capabilities.assertionForms).toBe(SUPPORTED_ASSERTION_FORMS);
    expect([...typescriptAdapter.capabilities.frameworks]).toEqual(['jest', 'vitest', 'mocha']);
  });
});

describe('python adapter — Adapter contract conformance (Phase 8 task C4)', () => {
  it('is assignable to the Adapter contract and carries non-empty descriptor metadata', () => {
    const adapter: Adapter = pythonAdapter;
    expect(adapter.id).toBe('python-pytest-adapter');
    expect(adapter.version).toBe('0.1.0');
    expect(adapter.language).toBe('python');
    expect(adapter.extensions.length).toBeGreaterThan(0);
    expect(adapter.manifestSignatures.length).toBeGreaterThan(0);
    expect(adapter.capabilities.frameworks.length).toBeGreaterThan(0);
    expect(adapter.capabilities.assertionForms.length).toBeGreaterThan(0);
    expect(adapter.providerHints.length).toBeGreaterThan(0);
  });

  it('collectAnalysis deep-equals the collector output for a known fixture', () => {
    expect(pythonAdapter.collectAnalysis(pyFixture('pytest_sample.py'))).toEqual(
      collectPy(pyFixture('pytest_sample.py')),
    );
  });

  it('capability lists are the capabilities.ts exports BY REFERENCE (no duplication drift)', () => {
    expect(pythonAdapter.capabilities.frameworks).toBe(PY_SUPPORTED_FRAMEWORKS);
    expect(pythonAdapter.capabilities.assertionForms).toBe(PY_SUPPORTED_ASSERTION_FORMS);
    expect([...pythonAdapter.capabilities.frameworks]).toEqual(['pytest', 'unittest']);
  });
});
