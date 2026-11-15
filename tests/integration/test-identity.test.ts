/**
 * Integration: test id identity across BOTH real collectors (plan task 4.5).
 *
 * Uses the real collectAnalysis from the typescript and python collectors over
 * fixture files (no fake substrate seam) and asserts the id contract holds at
 * the analysis seam: unique within an analysis, deterministic across runs,
 * shape `<file>#<form>@<line>:<index>`, and file component disambiguates two
 * fixtures that carry the SAME test name.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { TestType } from '../../src/core/analysis';
import { collectAnalysis as tsCollect } from '../../src/adapters/typescript/collector';
import { collectAnalysis as pyCollect } from '../../src/adapters/python/collector';

const CT_INT = join(__dirname, '..', 'fixtures', 'ct-int-001');
const PY_FIXTURES = join(__dirname, '..', 'adapters', 'python', 'fixtures');

const ID_SHAPE = /^.+#.+@\d+:\d+$/;

function ids(output: { tests?: Array<{ test: { id: string } }> }): string[] {
  return (output.tests ?? []).map((scope) => scope.test.id);
}

describe('test identity — both real collectors (plan task 4.5)', () => {
  it('typescript collector: ids unique within analysis and deterministic across runs (case-24)', () => {
    const file = join(CT_INT, 'case-24-vitest-standard', 'sample.test.ts');
    const first = ids(tsCollect(file, TestType.UNIT));
    const second = ids(tsCollect(file, TestType.UNIT));

    expect(first.length).toBeGreaterThan(0);
    expect(new Set(first).size).toBe(first.length);
    expect(first).toEqual(second);
  });

  it('typescript collector: ids match <file>#<form>@<line>:<index> (case-24 + case-25)', () => {
    for (const name of ['case-24-vitest-standard', 'case-25-vitest-aliased']) {
      const file = join(CT_INT, name, 'sample.test.ts');
      for (const id of ids(tsCollect(file, TestType.UNIT))) {
        expect(id).toMatch(ID_SHAPE);
      }
    }
  });

  it('python collector: ids unique within analysis and deterministic across runs (pytest_sample)', () => {
    const file = join(PY_FIXTURES, 'pytest_sample.py');
    const first = ids(pyCollect(file));
    const second = ids(pyCollect(file));

    expect(first.length).toBeGreaterThan(0);
    expect(new Set(first).size).toBe(first.length);
    expect(first).toEqual(second);
  });

  it('python collector: ids match <file>#<form>@<line>:<index> (pytest_sample + unittest_sample)', () => {
    for (const name of ['pytest_sample.py', 'unittest_sample.py']) {
      const file = join(PY_FIXTURES, name);
      for (const id of ids(pyCollect(file))) {
        expect(id).toMatch(ID_SHAPE);
      }
    }
  });

  it('same test name in two different fixture dirs yields DIFFERENT ids (file component disambiguates)', () => {
    // Two fixtures share the test name `it('same')` / `def test_same` but live
    // in different directories. The file component must keep their ids distinct.
    const dir = mkdtempSync(join(tmpdir(), 'checktest-ident-'));
    try {
      const dirA = join(dir, 'a');
      const dirB = join(dir, 'b');
      const tsA = join(dirA, 'sample.test.ts');
      const tsB = join(dirB, 'sample.test.ts');
      const pyA = join(dirA, 'sample.py');
      const pyB = join(dirB, 'sample.py');
      for (const d of [dirA, dirB]) {
        require('fs').mkdirSync(d, { recursive: true });
      }
      writeFileSync(
        tsA,
        "import { it, expect } from '@jest/globals';\nit('same', () => { expect(1).toBe(1); });\n",
        'utf8',
      );
      writeFileSync(
        tsB,
        "import { it, expect } from '@jest/globals';\nit('same', () => { expect(1).toBe(1); });\n",
        'utf8',
      );
      writeFileSync(pyA, 'def test_same():\n    assert 1\n', 'utf8');
      writeFileSync(pyB, 'def test_same():\n    assert 1\n', 'utf8');

      const tsIds = [...ids(tsCollect(tsA, TestType.UNIT)), ...ids(tsCollect(tsB, TestType.UNIT))];
      const pyIds = [...ids(pyCollect(pyA)), ...ids(pyCollect(pyB))];

      // Same logical test name, different files -> distinct ids in each adapter.
      expect(new Set(tsIds).size).toBe(tsIds.length);
      expect(tsIds.length).toBe(2);
      expect(tsIds[0]).not.toBe(tsIds[1]);

      expect(new Set(pyIds).size).toBe(pyIds.length);
      expect(pyIds.length).toBe(2);
      expect(pyIds[0]).not.toBe(pyIds[1]);

      // The disambiguating component is the file path, present in both.
      for (const id of [...tsIds, ...pyIds]) {
        expect(id).toMatch(ID_SHAPE);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
