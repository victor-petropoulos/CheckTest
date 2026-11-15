import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { AnalysisOutput, TestType } from '../../../src/core/analysis';
import { collectAnalysis } from '../../../src/adapters/typescript/collector';

/** Fixtures live outside the repo so a malformed one never reaches `tsc`. */
const tempDirs: string[] = [];

function writeFixture(source: string, name = 'sample.test.ts'): string {
  const dir = mkdtempSync(join(tmpdir(), 'checktest-id-'));
  tempDirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, source, 'utf8');
  return file;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const JEST_IMPORT = "import { expect, it } from '@jest/globals';\n";

function ids(output: AnalysisOutput): string[] {
  return (output.tests ?? []).map((entry) => entry.test.id);
}

describe('collectAnalysis — test id uniqueness within one line (plan task 4.1)', () => {
  it('gives two `it` declarations on one line distinct ids', () => {
    const file = writeFixture(
      `${JEST_IMPORT}it('a', () => { expect(1).toBe(1); }); it('b', () => { expect(2).toBe(2); });\n`,
    );
    const output = collectAnalysis(file, TestType.UNIT);

    expect(ids(output)).toEqual([`${file}#it@2:0`, `${file}#it@2:1`]);
  });

  it('gives two `it.each` declarations on one line distinct ids', () => {
    const file = writeFixture(
      `${JEST_IMPORT}it.each([[1]])('a', (n: number) => { expect(n).toBe(1); }); ` +
        `it.each([[2]])('b', (n: number) => { expect(n).toBe(2); });\n`,
    );
    const output = collectAnalysis(file, TestType.UNIT);

    expect(ids(output)).toEqual([`${file}#it.each@2:0`, `${file}#it.each@2:1`]);
  });

  it('gives mixed declaration forms on one line distinct ids', () => {
    const file = writeFixture(
      `${JEST_IMPORT}it('a', () => { expect(1).toBe(1); }); ` +
        `it.each([[2]])('b', (n: number) => { expect(n).toBe(2); });\n`,
    );
    const output = collectAnalysis(file, TestType.UNIT);

    expect(ids(output)).toEqual([`${file}#it@2:0`, `${file}#it.each@2:1`]);
  });

  it('numbers each line independently — a different line starts at index 0', () => {
    const file = writeFixture(
      `${JEST_IMPORT}it('a', () => { expect(1).toBe(1); });\n` + `it('b', () => { expect(2).toBe(2); });\n`,
    );
    const output = collectAnalysis(file, TestType.UNIT);

    expect(ids(output)).toEqual([`${file}#it@2:0`, `${file}#it@3:0`]);
  });

  it('does not count `describe` as a test declaration on the same line', () => {
    const file = writeFixture(
      `import { describe, expect, it } from '@jest/globals';\n` +
        `describe('suite', () => { it('a', () => { expect(1).toBe(1); }); }); ` +
        `it('b', () => { expect(2).toBe(2); });\n`,
    );
    const output = collectAnalysis(file, TestType.UNIT);

    expect(ids(output)).toEqual([`${file}#it@2:0`, `${file}#it@2:1`]);
  });

  it('keeps ids unique within one analysis and identical across two runs', () => {
    const file = writeFixture(
      `${JEST_IMPORT}it('a', () => { expect(1).toBe(1); }); it('b', () => { expect(2).toBe(2); });\n`,
    );
    const first = ids(collectAnalysis(file, TestType.UNIT));
    const second = ids(collectAnalysis(file, TestType.UNIT));

    expect(new Set(first).size).toBe(first.length);
    expect(first).toEqual(second);
  });
});

describe('collectAnalysis — same test name across files/scopes (plan task 4.5)', () => {
  it('two files with the SAME test name yield distinct ids (file component disambiguates)', () => {
    const a = writeFixture(`${JEST_IMPORT}it('same', () => { expect(1).toBe(1); });\n`, 'a.test.ts');
    const b = writeFixture(`${JEST_IMPORT}it('same', () => { expect(1).toBe(1); });\n`, 'b.test.ts');

    const idA = ids(collectAnalysis(a, TestType.UNIT));
    const idB = ids(collectAnalysis(b, TestType.UNIT));

    expect(idA).toEqual([`${a}#it@2:0`]);
    expect(idB).toEqual([`${b}#it@2:0`]);
    expect(idA[0]).not.toBe(idB[0]);
  });

  it('vitest `it.each` template-literal form gets a per-line index (case-32 shape)', () => {
    // Backtick and ${...} are written via escapes so the fixture source stays a
    // plain single-quoted JS string (no nested template interpolation).
    const tick = String.fromCharCode(96);
    const src =
      "import { describe, expect, it } from 'vitest';\n" +
      `it.each${tick}\n  a | b\n  \${1} | \${2}\n${tick}('adds', ({ a, b }) => { expect(a + b).toBe(3); });\n`;
    const file = writeFixture(src);
    const output = collectAnalysis(file, TestType.UNIT);
    const got = ids(output);

    expect(got.length).toBe(1);
    expect(got[0]).toMatch(/^.+#.+@\d+:\d+$/);
  });
});
