import { collectAnalysis } from '../../src/adapters/typescript/collector';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('JSX .js parsing (SP4 decision B)', () => {
  const dir = mkdtempSync(process.env.TMPDIR ? join(process.env.TMPDIR, 'ct-jsx-') : join(tmpdir(), 'ct-jsx-'));
  const write = (name: string, text: string) => {
    const p = join(dir, name);
    writeFileSync(p, text);
    return p;
  };

  it('JSX in a .js test file parses and classifies its declarations', () => {
    const p = write(
      'jsx-test.js',
      "import { it, expect } from '@jest/globals';\nconst x = <div />;\nit('renders', () => { expect(x.type).toBe('div'); });\n",
    );
    const out = collectAnalysis(p);
    expect(out.analysis.status).not.toBe('FAILED');
    expect(out.tests).toHaveLength(1);
  });

  it('non-JSX .js keeps TS parse kind (regression guard)', () => {
    const p = write(
      'plain-test.js',
      "import { it, expect } from '@jest/globals';\nconst a = 1 < 2;\nconst b = (x) => x;\nit('plain', () => { expect(a).toBe(true); });\n",
    );
    const out = collectAnalysis(p);
    expect(out.analysis.status).not.toBe('FAILED');
  });
});
