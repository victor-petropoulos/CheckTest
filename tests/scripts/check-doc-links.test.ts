/**
 * UNIT 8 link-checker checks: extraction (fences/code spans excluded, line
 * numbers), GitHub heading slugs, gate-vs-report classification, and real-repo
 * gate determinism. Fixtures are self-contained temp dirs so the suite also
 * passes in the public mirror (which ships no internal docs).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { GATE_FILES, checkLinks, extractLinks, headingSlugs, run, slugify } from '../../scripts/check-doc-links';

const repoRoot = join(__dirname, '..', '..');

describe('extractLinks', () => {
  it('finds inline links and images with 1-based line numbers', () => {
    const text = ['[a](./x.md)', '', '![i](img/y.png)', '[b](https://e.com)', '[c](mailto:e@x)'].join('\n');
    expect(extractLinks(text)).toEqual([
      { target: './x.md', line: 1 },
      { target: 'img/y.png', line: 3 },
      { target: 'https://e.com', line: 4 },
      { target: 'mailto:e@x', line: 5 },
    ]);
  });

  it('excludes fenced blocks and inline code spans, preserving line numbers', () => {
    const text = [
      'real [a](one.md)', // 1
      '```bash', // 2
      '# not a heading', // 3
      '[fake](two.md)', // 4
      '```', // 5
      '`expect(x)[matcher]()`', // 6 — JS example, not a link
      'real [b](three.md)', // 7
    ].join('\n');
    expect(extractLinks(text)).toEqual([
      { target: 'one.md', line: 1 },
      { target: 'three.md', line: 7 },
    ]);
  });
});

describe('heading slugs (GitHub algorithm)', () => {
  it('slugifies punctuation, case, and spaces like GitHub', () => {
    expect(slugify('24. Evidence Strength Contract (D10)')).toBe('24-evidence-strength-contract-d10');
    expect(slugify('Supertest HTTP Assertion Chains (SP3, 2026-11-09)')).toBe(
      'supertest-http-assertion-chains-sp3-2026-11-09',
    );
    expect(slugify('Five Declaration Gaps (Each Gets Its Own Record)')).toBe(
      'five-declaration-gaps-each-gets-its-own-record',
    );
  });

  it('deduplicates repeated headings with -N suffixes and ignores fenced # lines', () => {
    const text = ['## Gap', '```bash', '# fake', '```', '## Gap', '### Gap'].join('\n');
    expect(headingSlugs(text)).toEqual(new Set(['gap', 'gap-1', 'gap-2']));
  });
});

describe('checkLinks classification', () => {
  let root: string;
  const write = (rel: string, content: string): void => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ct-link-check-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('fails on a dead relative path in a gate file, naming source:line and target', () => {
    write('a.md', 'intro\n[bad](./gone.md)\n');
    const result = checkLinks(root, ['a.md']);
    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual([
      {
        source: 'a.md',
        line: 2,
        target: './gone.md',
        resolved: join(root, 'gone.md'),
        kind: 'dead-path',
        blocking: true,
      },
    ]);
  });

  it('passes ./links, root-relative links, images, and valid fragments', () => {
    write('a.md', '[ok](./b.md#sec) [root](/b.md) ![i](./img.png)\n');
    write('b.md', '## Sec\n');
    write('img.png', 'x');
    const result = checkLinks(root, ['a.md']);
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.counts).toEqual([{ file: 'a.md', links: 3 }]);
  });

  it('reports dead fragments as non-blocking warnings (gate and pure anchors)', () => {
    write('a.md', '[x](./b.md#nope) [y](#also-nope)\n');
    write('b.md', '## Real\n');
    const result = checkLinks(root, ['a.md']);
    expect(result.exitCode).toBe(0);
    expect(result.findings.map((f) => [f.kind, f.blocking])).toEqual([
      ['dead-fragment', false],
      ['dead-fragment', false],
    ]);
  });

  it('ignores scheme links, protocol-relative, and empty targets', () => {
    write('a.md', '[h](https://x.com) [m](mailto:a@b) [p](//cdn/x) [e]()\n');
    const result = checkLinks(root, ['a.md']);
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('lists internal-doc dead links in report mode without failing', () => {
    write('a.md', '[ok](./b.md)\n');
    write('b.md', 'x');
    write('docs/adr/x.md', '[dead](../gone.md)\n');
    const result = checkLinks(root, ['a.md']);
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([
      {
        source: join('docs', 'adr', 'x.md'),
        line: 1,
        target: '../gone.md',
        resolved: join(root, 'docs', 'gone.md'),
        kind: 'dead-path',
        blocking: false,
      },
    ]);
  });

  it('treats gate links to unshipped internal docs as warnings (public-mirror rule)', () => {
    write('a.md', '[internal](./docs/adr/gone.md) [shipped](./docs/limitations.md)\n');
    const result = checkLinks(root, ['a.md']);
    expect(result.exitCode).toBe(1); // only the shipped-doc miss blocks
    expect(result.findings.map((f) => [f.target, f.blocking])).toEqual([
      ['./docs/adr/gone.md', false],
      ['./docs/limitations.md', true],
    ]);
  });

  it('fails when a gate file itself is missing', () => {
    const result = checkLinks(root, ['a.md']);
    expect(result.exitCode).toBe(1);
    expect(result.findings[0]).toMatchObject({ source: 'a.md', kind: 'missing-file', blocking: true });
  });
});

describe('real repo (dev + public mirror)', () => {
  // Clean-repo pin (9b link fix): the six pre-existing dead ../ cross-links
  // between docs/limitations.md and docs/supported-syntax.md are fixed
  // (../x.md -> ./x.md; the §14 self-ref became an in-page anchor), and the
  // dead fragment at supported-syntax.md:311 is gone (redundant second link
  // removed — #five-declaration-gaps-each-gets-its-own-record already covers
  // the never-FAIL claim). Any new dead path or fragment regresses this pin.
  it('counts every gate file and finds zero dead links or fragments', () => {
    const result = checkLinks(repoRoot);
    expect(result.counts.map((c) => c.file)).toEqual(expect.arrayContaining([...GATE_FILES]));
    const blocking = result.findings.filter((f) => f.blocking).map((f) => [f.source, f.target] as const);
    expect(blocking).toEqual([]);
    expect(result.findings.filter((f) => f.kind === 'dead-fragment')).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('run() prints per-file counts and a summary consistent with the exit code', () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = run(repoRoot);
      const printed = stdout.mock.calls.map((call) => String(call[0])).join('');
      expect(printed).toContain('README.md:');
      expect(printed).toContain(code === 0 ? 'PASS' : 'FAIL');
      expect(code).toBe(checkLinks(repoRoot).exitCode);
    } finally {
      stdout.mockRestore();
    }
  });
});
