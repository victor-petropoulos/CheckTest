/**
 * Markdown internal-link checker (remediation plan UNIT 8).
 *
 * Gate (blocking, exit 1): every relative link in the shipped/public surface —
 * README.md, docs/limitations.md, docs/supported-syntax.md, docs/rules/catalog.md,
 * .agents/skills/using-checktest/SKILL.md (export allowlist + npm files array) —
 * must resolve on disk. Report (non-blocking): every other existing docs/**.md
 * (adr/, superpowers/, providers/, rules/, internal notes); dead links are listed
 * as WARN lines so internal drift stays visible without gating CI.
 *
 * Public-mirror rule: a dead link FROM a gate file TO a docs/** target that is
 * not one of the three shipped docs is a warning, not a failure — those targets
 * are deliberately unshipped (scripts/export-public-repo.sh allowlist), so the
 * exported CI must not fail on them (e.g. limitations.md -> providers/...).
 *
 * Fragments: the gate contract is PATH resolution ("resolves on disk", plan
 * UNIT 8 acceptance); #fragment is stripped before the disk test. Heading-slug
 * validation (GitHub slugger, ATX headings, fenced code excluded) runs for .md
 * targets in REPORT mode only — dead fragments warn, never block: the gate is
 * the shipped-surface files, and fragment defects are pinned by
 * tests/scripts/check-doc-links.test.ts. Non-.md targets: fragment not checked
 * (GitHub line anchors).
 *
 * Extraction: single-line inline links + images only (the repo has zero
 * reference-style definitions). Fenced blocks and inline code spans are stripped
 * first, preserving line numbers — JS examples like `expect(x)[matcher]()`
 * otherwise fake empty-target links. Skipped: any URL scheme (http/https/mailto),
 * protocol-relative //, empty targets. Pure #fragment targets the source file.
 * Leading '/' resolves from the repo root. Optional link titles and <> wrappers
 * are tolerated. Ceilings: no nested brackets in link text, no %XX decoding,
 * no multi-line code spans (none occur in the checked surface).
 *
 * Run: `npx tsx scripts/check-doc-links.ts` (U3 convention; scripts/ is outside
 * tsconfig include). Positional args override the gate file set (scratch-file
 * failure proofs); no args = default gate set + docs report walk.
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';

/** Shipped/public surface — all five exist in the dev repo AND the public mirror. */
export const GATE_FILES: readonly string[] = [
  'README.md',
  'docs/limitations.md',
  'docs/supported-syntax.md',
  'docs/rules/catalog.md',
  '.agents/skills/using-checktest/SKILL.md',
];

/** The only docs/** paths the export allowlist + npm files array ship. */
const SHIPPED_DOCS: readonly string[] = ['docs/limitations.md', 'docs/supported-syntax.md', 'docs/rules/catalog.md'];

export interface LinkRef {
  target: string;
  line: number;
}

export interface Finding {
  source: string;
  line: number;
  target: string;
  resolved: string;
  kind: 'dead-path' | 'dead-fragment' | 'missing-file';
  blocking: boolean;
}

export interface CheckResult {
  counts: Array<{ file: string; links: number }>;
  findings: Finding[];
  exitCode: number;
}

const toPosix = (p: string): string => p.split(sep).join('/');

/** Blank out fenced blocks and inline code spans, keeping line structure. */
function stripCode(text: string): string {
  let fence: string | null = null;
  return text
    .split('\n')
    .map((line) => {
      const m = /^\s*(`{3,}|~{3,})/.exec(line);
      if (m) {
        const char = m[1][0];
        if (fence === null) fence = char;
        else if (char === fence) fence = null;
        return '';
      }
      if (fence !== null) return '';
      return line.replace(/(`+)[^`\n]*\1/g, '');
    })
    .join('\n');
}

/** Inline links and images, with 1-based line numbers (code already stripped). */
export function extractLinks(text: string): LinkRef[] {
  const refs: LinkRef[] = [];
  const re = /!?\[[^\]\n]*\]\(([^)\n]*)\)/g;
  stripCode(text)
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(re)) refs.push({ target: m[1], line: i + 1 });
    });
  return refs;
}

/** GitHub heading slug: lowercase, drop punctuation, spaces -> hyphens. */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}\p{Pc} \-]/gu, '')
    .replace(/ /g, '-');
}

/** ATX heading slugs with GitHub duplicate -N suffixes; fenced # lines excluded. */
export function headingSlugs(text: string): Set<string> {
  const slugs = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of stripCode(text).split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slugify(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

function walkMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(abs));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(abs);
  }
  return out;
}

function checkRef(root: string, source: string, sourceAbs: string, ref: LinkRef, isGate: boolean): Finding | null {
  let target = ref.target.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  target = target.split(/\s+/)[0]; // drop optional link title
  if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return null;
  const hash = target.indexOf('#');
  const pathPart = hash === -1 ? target : target.slice(0, hash);
  const fragment = hash === -1 ? '' : target.slice(hash + 1);
  const resolved =
    pathPart === ''
      ? sourceAbs
      : pathPart.startsWith('/')
        ? join(root, pathPart)
        : resolve(dirname(sourceAbs), pathPart);
  const base = { source, line: ref.line, target: ref.target, resolved };
  if (!existsSync(resolved)) {
    const rel = toPosix(relative(root, resolved));
    const internalTarget = rel.startsWith('docs/') && !SHIPPED_DOCS.includes(rel);
    return { ...base, kind: 'dead-path', blocking: isGate && !internalTarget };
  }
  if (fragment !== '' && resolved.endsWith('.md') && !headingSlugs(readFileSync(resolved, 'utf8')).has(fragment)) {
    return { ...base, kind: 'dead-fragment', blocking: false };
  }
  return null;
}

/** Check the gate set (blocking) plus every other docs/**.md (report-only). */
export function checkLinks(root: string, gateFiles: readonly string[] = GATE_FILES): CheckResult {
  const counts: CheckResult['counts'] = [];
  const findings: Finding[] = [];
  const gateSet = new Set(gateFiles.map(toPosix));
  const reportFiles = walkMarkdown(join(root, 'docs'))
    .map((abs) => toPosix(relative(root, abs)))
    .filter((file) => !gateSet.has(file))
    .sort();
  for (const file of [...gateFiles.map(toPosix), ...reportFiles]) {
    const abs = join(root, file);
    const isGate = gateSet.has(file);
    if (!existsSync(abs)) {
      if (isGate)
        findings.push({ source: file, line: 0, target: file, resolved: abs, kind: 'missing-file', blocking: true });
      continue;
    }
    const refs = extractLinks(readFileSync(abs, 'utf8'));
    counts.push({ file, links: refs.length });
    for (const ref of refs) {
      const finding = checkRef(root, file, abs, ref, isGate);
      if (finding) findings.push(finding);
    }
  }
  return { counts, findings, exitCode: findings.some((f) => f.blocking) ? 1 : 0 };
}

/** Print per-file counts + findings + summary; return the process exit code. */
export function run(root: string, gateFiles?: readonly string[]): number {
  const result = checkLinks(root, gateFiles);
  for (const c of result.counts) process.stdout.write(`${c.file}: ${c.links} links\n`);
  for (const f of result.findings) {
    const detail = f.kind === 'missing-file' ? 'gate file missing' : `${f.kind} -> ${f.resolved}`;
    process.stdout.write(`${f.blocking ? 'DEAD' : 'WARN'} ${f.source}:${f.line} [${f.target}] ${detail}\n`);
  }
  const blocking = result.findings.filter((f) => f.blocking).length;
  const total = result.counts.reduce((n, c) => n + c.links, 0);
  process.stdout.write(
    `link-check: ${result.counts.length} files, ${total} links, ${blocking} blocking, ${result.findings.length - blocking} warnings — ${result.exitCode === 0 ? 'PASS' : 'FAIL'}\n`,
  );
  return result.exitCode;
}

if (require.main === module) {
  const root = join(__dirname, '..');
  const args = process.argv.slice(2).map((a) => toPosix(relative(root, resolve(process.cwd(), a))));
  process.exitCode = run(root, args.length > 0 ? args : undefined);
}
