/**
 * Python/pytest adapter — deterministic AST collector (Phase 8 task C3).
 *
 * Primary substrate: native tree-sitter (`tree-sitter` + `tree-sitter-python`,
 * optionalDependencies). Both are loaded LAZILY inside a guarded `require` so a
 * workspace without the optional deps still loads this module.
 *
 * Earned fallback (D-20261112-3): when the native modules are missing or fail
 * to load, the collector spawns `python3 -c <AST_SCRIPT> <file>` and parses the
 * module with the stdlib `ast` module. It also covers the native WALK failing:
 * tree-sitter can break for infrastructure reasons — under jest the binding
 * can hand back an undefined rootNode for a parse that actually succeeded
 * (upstream node-tree-sitter #181, unfixed in 0.22.4/0.25.1) — and the
 * fallback answers the same question. Both substrates produce the same JSON
 * shape internally, so the evidence assembly below is substrate-independent.
 *
 * Guardrails mirrored from the TypeScript adapter: adapter -> core only,
 * deterministic (no clock, no randomness, no I/O beyond reading the file and
 * an optional coverage report), the test file is never executed.
 */

import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { basename } from 'path';

import {
  AnalysisOutput,
  AnalysisStatus,
  AnalysisSubject,
  AnalysisSummary,
  CapabilityStatus,
  ClassificationSource,
  Completeness,
  TestType,
} from '../../core/analysis';
import {
  Availability,
  CollectionStatus,
  EvidenceCoverage,
  EvidenceStrength,
  Provenance,
  deriveAvailability,
  makeEvidenceRecord,
} from '../../core/evidence';
import { intersectLines, lineCount, toLineSet } from '../../core/coverage-math';
import {
  ANALYZER_ID,
  ANALYSIS_SCOPE,
  COLLECTOR_VERSION,
  EVIDENCE_ASSERTION_COUNT,
  NO_MUTATION_REPORT,
  SUPPORTED_ASSERTION_FORMS,
  SUPPORTED_FRAMEWORKS,
  UNSUPPORTED_FORM_GAP,
  UNPARSEABLE_REPORT_GAP,
  gapReason,
} from './support';

/** Assertion method names from the supported form list (`self.assertEqual` -> `assertEqual`). */
const ASSERTION_METHODS: ReadonlySet<string> = new Set(
  SUPPORTED_ASSERTION_FORMS.map((form) => (form.startsWith('self.') ? form.slice(5) : '')).filter(Boolean),
);

/* ------------------------------------------------------------------ *
 * Substrate loading (lazily, optional-safe)
 * ------------------------------------------------------------------ */

/** Minimal surface of the tree-sitter API the collector uses. */
interface StNode {
  readonly type: string;
  readonly startPosition: { readonly row: number };
  /** End of the node: the last row it spans (0-based). */
  readonly endPosition: { readonly row: number };
  readonly text: string;
  childForFieldName(name: string): StNode | null;
  childCount: number;
  child(index: number): StNode | null;
  /** children is lazily exposed; defensive optional per C5 flake diagnosis (can be undefined under some worker states). */
  children?: StNode[];
}

/**
 * The tree-sitter module surface the collector uses: the parser constructor
 * (the module's own export in tree-sitter 0.22.x) and the `Tree` class whose
 * prototype carries the `rootNode` getter.
 */
interface TreeSitterModule {
  Parser?: new () => {
    setLanguage(lang: unknown): void;
    parse(src: string): { rootNode: StNode | undefined };
  };
  Tree?: { prototype: object };
}

interface ParsedPython {
  tests: PythonTest[];
  totalAsserts: number;
}

export interface ParsedPythonCoverage {
  value: number[];
  provider: 'lcov' | 'coverage.py';
  providerVersion?: string;
  sourceRevision?: string;
}

/** D10: how many assertions a declaration holds, and how EACH one was established. */
interface AssertCount {
  total: number;
  strength: EvidenceStrength[];
}

interface PythonTest {
  name: string;
  line: number;
  /** Inclusive last line of the declaration body — the span coverage intersects. */
  end: number;
  given: boolean;
  asserts: AssertCount;
}

/** stdlib-ast fallback script: emits the SAME JSON shape the tree-sitter walk builds. */
const AST_SCRIPT = [
  'import ast, json, sys',
  'METHODS = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else set()',
  'def decs(node):',
  '    out = []',
  '    for d in getattr(node, "decorator_list", []):',
  '        f = d.func if isinstance(d, ast.Call) else d',
  '        name = getattr(f, "id", None) or getattr(f, "attr", None)',
  '        out.append(name)',
  '    return out',
  'HELPERS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)',
  'BRANCHES = tuple(getattr(ast, n) for n in ("If", "For", "AsyncFor", "While", "Try", "TryStar", "Match", "match_case", "ExceptHandler", "comprehension", "IfExp") if hasattr(ast, n))',
  'def count_asserts(fn):',
  '    out = {"total": 0, "strength": []}',
  '    def classify(node):',
  '        if isinstance(node, ast.Assert):',
  '            return "EXECUTION_ESTABLISHED"',
  '        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):',
  '            attr = node.func.attr',
  '            if attr in METHODS:',
  '                return "EXECUTION_ESTABLISHED"',
  '            if attr == "raises":',
  '                if isinstance(node.func.value, ast.Name) and node.func.value.id == "pytest":',
  '                    return "EXECUTION_ESTABLISHED"',
  '                return "UNSUPPORTED"',
  '        return None',
  '    def walk(node, nested):',
  '        kind = classify(node)',
  '        if kind is not None:',
  '            out["total"] += 1',
  '            out["strength"].append("SYNTAX_OBSERVED" if nested else kind)',
  '        for child in ast.iter_child_nodes(node):',
  '            walk(child, nested or isinstance(child, HELPERS) or isinstance(child, BRANCHES))',
  '    walk(fn, False)',
  '    return out',
  'tree = ast.parse(open(sys.argv[1], "rb").read(), sys.argv[1])',
  'tests = []',
  'def is_test(n):',
  '    return isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith("test_")',
  'for node in tree.body:',
  '    if isinstance(node, ast.ClassDef) and node.name.startswith("Test"):',
  '        tests += [{"name": s.name, "line": s.lineno, "end": getattr(s, "end_lineno", None) or s.lineno, "given": "given" in decs(s), "asserts": count_asserts(s)} for s in node.body if is_test(s)]',
  '    if is_test(node):',
  '        tests.append({"name": node.name, "line": node.lineno, "end": getattr(node, "end_lineno", None) or node.lineno, "given": "given" in decs(node), "asserts": count_asserts(node)})',
  'print(json.dumps({"tests": tests, "totalAsserts": sum(t["asserts"]["total"] for t in tests)}))',
].join('\n');

/** Substrate probe seam: which native module name resolves for `require`.
 * Production default = real `require`. The substrate fallback/unsupported tests
 * inject a probe here instead of jest.mock('tree-sitter'): under jest's
 * runInBand single process, jest.mock leaks the throwing module factory into
 * every later suite (verified flake diagnosis 2026-11-12: mocked require
 * returned a half-built stub whose nodes lack `children`, corrupting unrelated
 * suites ~1/3 of full runs). No cross-suite state remains with this seam. */
export interface SubstrateProbe {
  /** Resolves a native module by id; throw = substrate unavailable. */
  require(id: string): unknown;
  /** Override the fallback interpreter binary name; undefined = 'python3'. */
  python3?: string;
}

const realRequire = createRequire(__filename);

function productionRequire(id: string): unknown {
  // createRequire bypasses the jest module-registry: jest instrumented the
  // transpiled plain require, so a leaked jest.mock factory from another suite
  // could still intercept it (C5 flake, verified 2026-11-12).
  return realRequire(id);
}

/** Load tree-sitter lazily; returns null when the optional deps are absent/broken. */
const PRODUCTION_PROBE: SubstrateProbe = { require: productionRequire };

/**
 * The pristine `Tree.prototype.rootNode` getter descriptor, cached at module
 * scope. This is a DESCRIPTOR cache, not a parser cache: nothing here keeps a
 * parser alive between runs.
 *
 * node-tree-sitter #181 (the "jest race"): `tree-sitter/index.js` installs a
 * JS getter for `Tree.prototype.rootNode` at MODULE EVALUATION time and keeps
 * the property's previous value in a closure. A SECOND evaluation of that
 * module in the same process therefore captures the FIRST evaluation's
 * getter — and the destructuring that captures it INVOKES it with
 * `this = Tree.prototype` (not a tree instance), so the capture resolves to
 * `undefined`. The getter installed by that second evaluation then returns
 * `undefined` for EVERY tree in the process: the native parse "succeeds" with
 * no root at all.
 *
 * The FIRST evaluation's getter is still functional (it delegates to the
 * native accessor it captured), so re-installing its descriptor restores a
 * working `rootNode`.
 */
let nativeRootNodeDescriptor: PropertyDescriptor | undefined;

/**
 * Holder key for the shared copy of that descriptor.
 *
 * The descriptor is ALSO parked on the binding's own `Tree` class, because a
 * module-scope variable alone CANNOT survive the failure it repairs: jest
 * gives every test file a fresh module registry, so the collector module is
 * re-evaluated per file and the module-scope cache starts EMPTY again in the
 * second file of a worker — exactly the file that inherits the poisoned
 * prototype. The native `Tree` class IS shared across those registries (the
 * addon is loaded once per process), so a descriptor parked on it outlives
 * the registry reset and can still repair the next file.
 */
const PRISTINE_ROOT_NODE_HOLDER = '__checktestPristineRootNode';

/**
 * Re-install the pristine `rootNode` getter when a later module evaluation
 * replaced it, so a poisoned prototype cannot break every later parse.
 *
 * Degrades to today's behaviour when the binding exposes no get-descriptor:
 * the re-install is skipped and the plain parse path is kept.
 *
 * @param treeSitter the tree-sitter module object (its `Tree` class carries
 *   the prototype the getter lives on)
 * @param tree a real tree, used ONCE to tell a working getter from the
 *   poisoned one (the poisoned getter answers `undefined` for every tree)
 */
function restorePristineRootNode(treeSitter: unknown, tree: object): void {
  try {
    const Tree = (treeSitter as TreeSitterModule).Tree;
    if (Tree === undefined || Tree.prototype === undefined) return;
    const proto: object = Tree.prototype;
    const holder = Tree as unknown as Record<string, unknown>;
    const current = Object.getOwnPropertyDescriptor(proto, 'rootNode');
    if (current === undefined || typeof current.get !== 'function') return;
    // The cached descriptor: module scope first, then the shared holder.
    const cached = nativeRootNodeDescriptor ?? (holder[PRISTINE_ROOT_NODE_HOLDER] as PropertyDescriptor | undefined);
    if (cached === undefined) {
      // Cache ONLY a getter that demonstrably yields a node for a real tree:
      // the poisoned getter answers undefined for EVERY tree, so caching it
      // would preserve the bug instead of repairing it.
      const probe = current.get.call(tree) as StNode | undefined;
      if (probe !== undefined && probe !== null && typeof probe.type === 'string') {
        nativeRootNodeDescriptor = current;
        holder[PRISTINE_ROOT_NODE_HOLDER] = current;
      }
      return;
    }
    nativeRootNodeDescriptor = cached;
    if (current.get !== cached.get) {
      Object.defineProperty(proto, 'rootNode', cached);
    }
  } catch {
    // A binding without a usable get-descriptor degrades to today's behaviour.
  }
}

/**
 * Load tree-sitter lazily; returns null when the optional deps are absent/broken.
 *
 * The returned lambda carries the upstream-bug workaround: the binding can
 * hand back an undefined `rootNode` for a parse that actually succeeded
 * (node-tree-sitter #181, unfixed in 0.22.4/0.25.1 — the "jest race" seen
 * under the test runner). One retry with a FRESH parser clears the stale
 * state; if that still yields no root the lambda throws and collectAnalysis'
 * catch routes the file to the earned python3-ast fallback.
 */
function loadNativeParser(probe: SubstrateProbe = PRODUCTION_PROBE): ((src: string) => StNode) | null {
  try {
    // ONE require, module identity kept: the module object carries the `Tree`
    // class the #181 repair needs (the parser IS the module's own export).
    const treeSitter = probe.require('tree-sitter') as TreeSitterModule;
    const Parser = (treeSitter.Parser ?? treeSitter) as unknown as new () => {
      setLanguage(lang: unknown): void;
      parse(src: string): { rootNode: StNode | undefined };
    };
    const Python = probe.require('tree-sitter-python');
    const parser = new Parser();
    parser.setLanguage(Python);
    return (src: string) => {
      const tree = parser.parse(src);
      // node-tree-sitter #181: a later module evaluation of the binding can
      // replace the prototype's rootNode getter with one that answers
      // undefined for EVERY tree. Repair the prototype BEFORE the root is
      // read, so the poisoned state never reaches the walk.
      restorePristineRootNode(treeSitter, tree);
      const root = tree.rootNode;
      if (root !== undefined) return root;
      // node-tree-sitter #181: the rootNode getter can return undefined even
      // though the parse succeeded. A FRESH parser holds no stale state, so
      // retry ONCE with it before giving up.
      const fresh = new Parser();
      fresh.setLanguage(Python);
      const retriedTree = fresh.parse(src);
      restorePristineRootNode(treeSitter, retriedTree);
      const retried = retriedTree.rootNode;
      if (retried === undefined) {
        throw new Error('tree-sitter returned undefined rootNode (upstream node-tree-sitter #181 jest race)');
      }
      return retried;
    };
  } catch {
    return null;
  }
}

function parseWithPythonAst(filePath: string, probe: SubstrateProbe): ParsedPython {
  const stdout = execFileSync(
    probe.python3 ?? 'python3',
    ['-c', AST_SCRIPT, filePath, [...ASSERTION_METHODS].join(',')],
    {
      encoding: 'utf8',
      // The child's stderr is PIPED, never inherited: a failing fallback (a
      // SyntaxError on a non-Python file, say) must not pollute the process
      // stderr — stderr carries USAGE and CRASH only (src/cli.ts).
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(stdout) as ParsedPython;
}

/* ------------------------------------------------------------------ *
 * tree-sitter walk — same ParsedPython shape as the fallback
 * ------------------------------------------------------------------ */

function isTestFunction(node: StNode): boolean {
  if (node.type !== 'function_definition') return false;
  const name = node.childForFieldName('name');
  return name !== null && name.text.startsWith('test_');
}

function decoratedWithGiven(node: StNode): boolean {
  // tree-sitter: @given(...) sits inside a decorated_definition wrapping the function.
  const parent = (node as StNode & { parent?: StNode }).parent;
  if (parent === undefined || parent === null) return false;
  if (parent.type !== 'decorated_definition') return false;
  return (parent.children ?? []).some((child) => child.type === 'decorator' && /\bgiven\b/.test(child.text));
}

/** Node types that make any contained assertion non-straight-line (D10). */
const PYTHON_NESTED_DEF_TYPES: ReadonlySet<string> = new Set(['function_definition', 'class_definition', 'lambda']);
const PYTHON_BRANCH_TYPES: ReadonlySet<string> = new Set([
  'if_statement',
  'elif_clause',
  'else_clause',
  'for_statement',
  'while_statement',
  'try_statement',
  'except_clause',
  'finally_clause',
  'match_statement',
  'case_clause',
  'conditional_expression',
  'list_comprehension',
  'set_comprehension',
  'dictionary_comprehension',
  'generator_expression',
]);

function countAsserts(node: StNode): AssertCount {
  const strength: EvidenceStrength[] = [];
  let total = 0;
  const visit = (n: StNode, nested: boolean): void => {
    let kind: EvidenceStrength | null = null;
    if (n.type === 'assert_statement') {
      kind = EvidenceStrength.EXECUTION_ESTABLISHED;
    } else if (n.type === 'call') {
      const fn = n.childForFieldName('function');
      const attr = fn !== null && fn.type === 'attribute' ? fn.childForFieldName('attribute') : null;
      if (attr !== null && (ASSERTION_METHODS.has(attr.text) || attr.text === 'raises')) {
        if (attr.text === 'raises') {
          const receiver = fn!.childForFieldName('object');
          kind =
            receiver !== null && receiver.type === 'identifier' && receiver.text === 'pytest'
              ? EvidenceStrength.EXECUTION_ESTABLISHED
              : EvidenceStrength.UNSUPPORTED;
        } else {
          kind = EvidenceStrength.EXECUTION_ESTABLISHED;
        }
      }
    }
    if (kind !== null) {
      total += 1;
      strength.push(nested ? EvidenceStrength.SYNTAX_OBSERVED : kind);
    }
    for (let i = 0; i < n.childCount; i += 1) {
      const child = n.child(i);
      if (child !== null) {
        visit(child, nested || PYTHON_NESTED_DEF_TYPES.has(child.type) || PYTHON_BRANCH_TYPES.has(child.type));
      }
    }
  };
  visit(node, false);
  return { total, strength };
}

function walkNative(root: StNode): ParsedPython {
  const tests: PythonTest[] = [];
  const addTest = (node: StNode): void => {
    const nameNode = node.childForFieldName('name');
    if (nameNode === null) return;
    tests.push({
      name: nameNode.text,
      // startPosition.row is 0-based; TestIdentity lines are 1-based.
      line: node.startPosition.row + 1,
      // endPosition.row is 0-based and points at the LAST character of the
      // body, so +1 is the inclusive 1-based last line of the declaration.
      end: node.endPosition.row + 1,
      given: decoratedWithGiven(node),
      asserts: countAsserts(node.childForFieldName('body') ?? node),
    });
  };
  for (const node of root.children ?? []) {
    if (node.type === 'decorated_definition') {
      const fn = (node.children ?? []).find((child) => child.type === 'function_definition');
      if (fn !== undefined && isTestFunction(fn)) addTest(fn);
    } else if (isTestFunction(node)) {
      addTest(node);
    } else if (node.type === 'class_definition') {
      const nameNode = node.childForFieldName('name');
      const className = nameNode === null ? '' : nameNode.text;
      const body = node.childForFieldName('body');
      if (className.startsWith('Test') && body !== null) {
        for (const member of body.children ?? []) {
          if (isTestFunction(member)) addTest(member);
        }
      }
    }
  }
  return { tests, totalAsserts: tests.reduce((sum, test) => sum + test.asserts.total, 0) };
}

/* ------------------------------------------------------------------ *
 * Evidence assembly (substrate-independent)
 * ------------------------------------------------------------------ */

function subject(filePath: string, declaredType: TestType, framework: string): AnalysisSubject {
  return {
    id: filePath,
    name: basename(filePath),
    file: filePath,
    language: 'python',
    framework,
    type: declaredType,
  };
}

function summary(status: AnalysisStatus, completeness: Completeness, declaredType: TestType): AnalysisSummary {
  return {
    status,
    completeness,
    scope: ANALYSIS_SCOPE,
    test_type: {
      value: declaredType,
      source: declaredType === TestType.UNKNOWN ? ClassificationSource.DEFAULT : ClassificationSource.EXPLICIT,
    },
  };
}

function coverageBlock(status: CollectionStatus): EvidenceCoverage {
  return {
    status,
    supported_frameworks: [...SUPPORTED_FRAMEWORKS],
    supported_assertion_forms: [...SUPPORTED_ASSERTION_FORMS],
  };
}

function capabilitiesOf(status: CollectionStatus): Record<string, CapabilityStatus> {
  return {
    assertion_forms:
      status === CollectionStatus.COMPLETE
        ? CapabilityStatus.AVAILABLE
        : status === CollectionStatus.PARTIAL
          ? CapabilityStatus.PARTIAL
          : CapabilityStatus.UNAVAILABLE,
    // A1 mirror — no cross-file helper resolution in milestone-1.
    custom_helper_resolution: CapabilityStatus.UNAVAILABLE,
    // KickOff:194 mirror — the test file is never executed.
    runtime_execution: CapabilityStatus.UNAVAILABLE,
  };
}

/** Relative path normalizer (backslash->slash, collapse duplicate slashes only; no resolve). */
function normalizeRelativePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function parseCoverageMapEntries(entries: string[] | undefined): Array<{ from: string; to: string }> {
  const mappings: Array<{ from: string; to: string }> = [];
  for (const entry of entries ?? []) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const from = entry.slice(0, eq);
    const to = entry.slice(eq + 1);
    if (to.length === 0) continue;
    mappings.push({ from, to });
  }
  return mappings;
}

export interface PythonCoverageFreshness {
  availability: Availability;
  status: CollectionStatus;
  reason?: string;
}

/**
 * Freshness verdict for an EXTERNAL coverage report — mirrors
 * src/providers/coverage.ts:245 (keep_guard ruling, jev/record/ct-cov-revision-2026-11-10.md).
 * analyzedRevision undefined → no freshness claim (KNOWN); otherwise a report
 * with no revision or a mismatched revision degrades to UNKNOWN/UNAVAILABLE.
 */
export function pythonCoverageFreshness(
  analyzedRevision: string | undefined,
  reportRevision: string | undefined,
): PythonCoverageFreshness {
  if (analyzedRevision === undefined) {
    return { availability: Availability.KNOWN, status: CollectionStatus.COMPLETE };
  }
  if (reportRevision === undefined) {
    return {
      availability: Availability.UNKNOWN,
      status: CollectionStatus.UNAVAILABLE,
      reason: 'report revision unknown; freshness cannot be established',
    };
  }
  if (reportRevision !== analyzedRevision) {
    return {
      availability: Availability.UNKNOWN,
      status: CollectionStatus.UNAVAILABLE,
      reason: `source revision mismatch: report ${reportRevision} != analyzed ${analyzedRevision}`,
    };
  }
  return { availability: Availability.KNOWN, status: CollectionStatus.COMPLETE };
}

/**
 * Parse a supplied coverage report into covered line numbers for the analyzed
 * file. Mirrors the TS-side shape (src/providers/coverage.ts:223): the value is
 * the list of covered line numbers. Auto-detects lcov and coverage.py JSON.
 *
 * When pickKey is supplied, select by exact normalized path equality (mapped
 * production-file semantics, ADR-038). Otherwise preserve the legacy basename
 * match for unmapped behavior.
 */
function parseCoverageReport(
  reportPath: string,
  analyzedPath: string,
  analyzedRevision?: string,
  pickKey?: string,
): ParsedPythonCoverage {
  const text = readFileSync(reportPath, 'utf8');
  const analyzed = basename(analyzedPath);
  const wanted = (key: string): boolean =>
    pickKey !== undefined ? normalizeRelativePath(key) === normalizeRelativePath(pickKey) : basename(key) === analyzed;

  if (reportPath.endsWith('.lcov') || text.includes('SF:')) {
    for (const chunk of text.split('end_of_record')) {
      const sf = chunk.match(/^SF:(.+)$/m)?.[1];
      if (sf === undefined || !wanted(sf.trim())) continue;
      const lines = [...chunk.matchAll(/^DA:(\d+),[1-9]\d*$/gm)].map((m) => Number(m[1]));
      return { value: lines, provider: 'lcov' };
    }
    const label = pickKey ?? analyzed;
    throw new Error(`no entry for ${label} in lcov report`);
  }

  const parsed = JSON.parse(text) as {
    files?: Record<string, { executed_lines?: unknown }>;
    source_revision?: string;
    sourceRevision?: string;
    revision?: string;
    meta?: { version?: string; source_revision?: string; sourceRevision?: string };
  };
  const files = parsed.files ?? {};
  for (const [key, info] of Object.entries(files)) {
    if (!wanted(key)) continue;
    const executed = info.executed_lines;
    if (!Array.isArray(executed)) throw new Error('coverage.py entry missing executed_lines');
    const meta = (parsed.meta ?? {}) as { version?: string; source_revision?: string; sourceRevision?: string };
    let sourceRevision: string | undefined;
    for (const holder of [parsed, meta]) {
      for (const key2 of ['source_revision', 'sourceRevision', 'revision'] as const) {
        const v = (holder as Record<string, unknown>)[key2];
        if (typeof v === 'string' && v.length > 0) {
          sourceRevision = v;
          break;
        }
      }
      if (sourceRevision) break;
    }
    const providerVersion = typeof meta.version === 'string' && meta.version.length > 0 ? meta.version : undefined;
    return { value: executed.map(Number), provider: 'coverage.py', providerVersion, sourceRevision };
  }
  const label = pickKey ?? analyzed;
  throw new Error(`no entry for ${label} in coverage.py report`);
}

/**
 * Per-declaration evidence for ONE test.
 *
 * `line_coverage` mirrors the per-declaration record the TypeScript side
 * produces (src/providers/coverage.ts:470): the file-level covered lines are
 * intersected with the declaration's OWN line span, so the value is a NUMBER
 * the engine can threshold (CT-COV-001: pass_at_least 1). A declaration whose
 * span holds no covered line is a measured 0, not a gap — the report parsed
 * and the file matched, so the count IS known. Provenance mirrors the
 * subject-level record of the same report (EXTERNAL — the coverage report is
 * an external artifact this adapter consumes; per task 1.5 the subject-level
 * record rides EXTERNAL provenance with the report's provider id).
 *
 * `mutation_score` mirrors the subject-level convention: the collector has no
 * mutation report, so the record is UNKNOWN with the canonical gap reason (the
 * TypeScript adapter emits no per-declaration mutation record either).
 */
function testEvidence(
  filePath: string,
  test: PythonTest,
  covered: { lines: number[]; report: ParsedPythonCoverage } | undefined,
  perDecl: { mode: 'scoped'; value: 0 | 1; testFile: string; report: ParsedPythonCoverage } | undefined,
): Record<string, ReturnType<typeof makeEvidenceRecord>> {
  const testStrength = test.given
    ? test.asserts.total > 0
      ? EvidenceStrength.SYNTAX_OBSERVED
      : undefined
    : (test.asserts.strength.reduce<EvidenceStrength | undefined>((weakest, s) => {
        if (weakest === undefined) return s;
        const rank = (v: EvidenceStrength): number =>
          v === EvidenceStrength.UNSUPPORTED ? 2 : v === EvidenceStrength.SYNTAX_OBSERVED ? 1 : 0;
        return rank(s) > rank(weakest) ? s : weakest;
      }, undefined) ?? undefined);
  const evidence: Record<string, ReturnType<typeof makeEvidenceRecord>> = {
    [EVIDENCE_ASSERTION_COUNT]: makeEvidenceRecord({
      type: EVIDENCE_ASSERTION_COUNT,
      value: test.given ? undefined : test.asserts.total,
      availability: deriveAvailability(test.given ? CollectionStatus.PARTIAL : CollectionStatus.COMPLETE),
      provenance: Provenance.DIRECT,
      source: ANALYZER_ID,
      collector_version: COLLECTOR_VERSION,
      scope: ANALYSIS_SCOPE,
      coverage: coverageBlock(test.given ? CollectionStatus.PARTIAL : CollectionStatus.COMPLETE),
      ...(test.given ? { reason: `hypothesis @given: ${gapReason('unsupported-form')}` } : {}),
      evidenceStrength: testStrength,
    }),
    mutation_score: makeEvidenceRecord({
      type: 'mutation_score',
      value: undefined,
      availability: Availability.UNKNOWN,
      provenance: Provenance.DIRECT,
      source: ANALYZER_ID,
      collector_version: COLLECTOR_VERSION,
      scope: ANALYSIS_SCOPE,
      coverage: coverageBlock(CollectionStatus.UNAVAILABLE),
      reason: gapReason('no-mutation-report'),
    }),
  };
  if (perDecl?.mode === 'scoped') {
    evidence.line_coverage = makeEvidenceRecord({
      type: 'line_coverage',
      value: perDecl.value,
      availability: Availability.KNOWN,
      provenance: Provenance.EXTERNAL,
      source: ANALYZER_ID,
      collector_version: COLLECTOR_VERSION,
      scope: ANALYSIS_SCOPE,
      coverage: coverageBlock(CollectionStatus.COMPLETE),
      location: { file: filePath, line: test.line },
      provider: perDecl.report.provider,
      provider_version: perDecl.report.providerVersion,
      source_revision: perDecl.report.sourceRevision ?? 'unknown',
      reason: `coverage evidence from a run scoped to ${perDecl.testFile}`,
    });
  } else if (covered !== undefined) {
    evidence.line_coverage = makeEvidenceRecord({
      type: 'line_coverage',
      value: intersectLines(toLineSet(covered.lines), test.line, test.end),
      availability: Availability.KNOWN,
      provenance: Provenance.EXTERNAL,
      source: ANALYZER_ID,
      collector_version: COLLECTOR_VERSION,
      scope: ANALYSIS_SCOPE,
      coverage: coverageBlock(CollectionStatus.COMPLETE),
      location: { file: filePath, line: test.line },
      provider: covered.report.provider,
      provider_version: covered.report.providerVersion,
      source_revision: covered.report.sourceRevision ?? 'unknown',
    });
  }
  return evidence;
}

/**
 * Collect normalized evidence for one Python test file.
 *
 * @param filePath path to the test file to analyze
 * @param options coverageReport: path to an lcov or coverage.py JSON report;
 *   declaredType: caller-declared test type, threaded like the TS collector
 *   (D-20261112-5 Q2) — never inferred, UNKNOWN when absent
 */
/**
 * Build the subject-level assertion_count record — the aggregate over the whole
 * file (D10). Carries the weakest strength classification reached by any
 * declaration: a body is only as established as its least-established assert.
 */
function buildSubjectEvidence(
  filePath: string,
  parsed: ParsedPython,
  coverageStatus: CollectionStatus,
): ReturnType<typeof makeEvidenceRecord> {
  const anyGiven = parsed.tests.some((test) => test.given);
  const record = makeEvidenceRecord({
    type: EVIDENCE_ASSERTION_COUNT,
    value: parsed.totalAsserts,
    availability: deriveAvailability(coverageStatus),
    provenance: Provenance.DIRECT,
    source: ANALYZER_ID,
    collector_version: COLLECTOR_VERSION,
    scope: ANALYSIS_SCOPE,
    coverage: coverageBlock(coverageStatus),
    evidenceStrength: aggregateSubjectStrength(parsed),
  });

  const reasonParts: string[] = [];
  if (anyGiven) {
    reasonParts.push(
      `${parsed.tests.filter((test) => test.given).length} hypothesis @given declaration(s): ` +
        `property-based assertion shapes are ${gapReason('unsupported-form')}, so executability cannot be established statically`,
    );
  }
  if (reasonParts.length > 0) {
    record.reason = reasonParts.join(' | ');
  }
  if (parsed.totalAsserts > 0) {
    record.location = { file: filePath, line: 1 };
  }
  return record;
}

function aggregateSubjectStrength(parsed: ParsedPython): EvidenceStrength | undefined {
  const rank = (v: EvidenceStrength): number =>
    v === EvidenceStrength.UNSUPPORTED ? 2 : v === EvidenceStrength.SYNTAX_OBSERVED ? 1 : 0;
  let weakest: EvidenceStrength | undefined;
  for (const test of parsed.tests) {
    const s = test.given
      ? EvidenceStrength.SYNTAX_OBSERVED
      : test.asserts.strength.reduce<EvidenceStrength | undefined>((w, cur) => {
          if (w === undefined) return cur;
          return rank(cur) > rank(w) ? cur : w;
        }, undefined);
    if (s !== undefined && (weakest === undefined || rank(s) > rank(weakest))) weakest = s;
  }
  return weakest;
}

class PythonParseFailure extends Error {
  constructor(
    public readonly kind: 'failed' | 'unsupported',
    message: string,
  ) {
    super(message);
  }
}

function parsePythonSource(sourceText: string, filePath: string, probe: SubstrateProbe | undefined): ParsedPython {
  const native = loadNativeParser(probe);
  if (native !== null) {
    try {
      const root: StNode | undefined = native(sourceText);
      if (root === undefined) {
        throw new Error('tree-sitter returned an unusable tree (undefined rootNode)');
      }
      return walkNative(root);
    } catch (error) {
      try {
        return parseWithPythonAst(filePath, probe ?? PRODUCTION_PROBE);
      } catch {
        throw new PythonParseFailure('failed', `python parse failed: ${(error as Error).message}`);
      }
    }
  }
  try {
    return parseWithPythonAst(filePath, probe ?? PRODUCTION_PROBE);
  } catch (error) {
    throw new PythonParseFailure('unsupported', `no python parser available: ${(error as Error).message}`);
  }
}

interface PythonCoveredLines {
  lines: number[];
  report: ParsedPythonCoverage;
}

interface PythonScopedCoverage {
  mode: 'scoped';
  value: 0 | 1;
  testFile: string;
  report: ParsedPythonCoverage;
}

function applyCoverageReport(
  evidence: Record<string, ReturnType<typeof makeEvidenceRecord>>,
  options: {
    coverageReport?: string;
    coverageMap?: string[];
    perTestRun?: boolean;
    analyzedRevision?: string;
  },
  filePath: string,
): { covered?: PythonCoveredLines; perDeclScoped?: PythonScopedCoverage } {
  if (options.coverageReport === undefined) return {};
  const mappings = parseCoverageMapEntries(options.coverageMap);
  const mappedEntry = mappings.find((m) => normalizeRelativePath(m.from) === normalizeRelativePath(filePath));
  const mappedTo = mappedEntry?.to;

  if (mappedTo !== undefined && options.perTestRun === true) {
    try {
      const parsed = parseCoverageReport(options.coverageReport, filePath, options.analyzedRevision, mappedTo);
      const fresh = pythonCoverageFreshness(options.analyzedRevision, parsed.sourceRevision);
      const count = lineCount(parsed.value);
      evidence.line_coverage = makeEvidenceRecord({
        type: 'line_coverage',
        value: fresh.availability === Availability.KNOWN ? count : undefined,
        availability: fresh.availability,
        provenance: Provenance.EXTERNAL,
        source: ANALYZER_ID,
        collector_version: COLLECTOR_VERSION,
        scope: ANALYSIS_SCOPE,
        coverage: coverageBlock(fresh.status),
        provider: parsed.provider,
        provider_version: parsed.providerVersion,
        source_revision: parsed.sourceRevision ?? 'unknown',
        ...(fresh.reason !== undefined
          ? { reason: fresh.reason }
          : { reason: `coverage evidence mapped to ${mappedTo}` }),
      });
      if (fresh.availability === Availability.KNOWN) {
        return {
          perDeclScoped: {
            mode: 'scoped',
            value: (count >= 1 ? 1 : 0) as 0 | 1,
            testFile: basename(filePath),
            report: parsed,
          },
        };
      }
      return {};
    } catch (error) {
      const msg = (error as Error).message;
      const missing = msg.includes(`no entry for ${mappedTo}`);
      evidence.line_coverage = makeEvidenceRecord({
        type: 'line_coverage',
        value: undefined,
        availability: Availability.UNKNOWN,
        provenance: Provenance.DIRECT,
        source: ANALYZER_ID,
        collector_version: COLLECTOR_VERSION,
        scope: ANALYSIS_SCOPE,
        coverage: coverageBlock(CollectionStatus.UNAVAILABLE),
        reason: missing ? `no coverage data for ${mappedTo}` : `${gapReason('unparseable-report')}: ${msg}`,
      });
      return {};
    }
  }

  try {
    const parsed = parseCoverageReport(options.coverageReport, filePath, options.analyzedRevision);
    const fresh = pythonCoverageFreshness(options.analyzedRevision, parsed.sourceRevision);
    evidence.line_coverage = makeEvidenceRecord({
      type: 'line_coverage',
      value: fresh.availability === Availability.KNOWN ? parsed.value : undefined,
      availability: fresh.availability,
      provenance: Provenance.EXTERNAL,
      source: ANALYZER_ID,
      collector_version: COLLECTOR_VERSION,
      scope: ANALYSIS_SCOPE,
      coverage: coverageBlock(fresh.status),
      provider: parsed.provider,
      provider_version: parsed.providerVersion,
      source_revision: parsed.sourceRevision ?? 'unknown',
      ...(fresh.reason !== undefined
        ? { reason: fresh.reason }
        : mappedTo !== undefined
          ? { reason: 'coverage map supplied without --per-test-run attestation; mapped semantics not applied' }
          : {}),
    });
    if (fresh.availability === Availability.KNOWN) {
      return { covered: { lines: parsed.value, report: parsed } };
    }
    return {};
  } catch (error) {
    evidence.line_coverage = makeEvidenceRecord({
      type: 'line_coverage',
      value: undefined,
      availability: Availability.UNKNOWN,
      provenance: Provenance.DIRECT,
      source: ANALYZER_ID,
      collector_version: COLLECTOR_VERSION,
      scope: ANALYSIS_SCOPE,
      coverage: coverageBlock(CollectionStatus.UNAVAILABLE),
      reason: `${gapReason('unparseable-report')}: ${(error as Error).message}`,
    });
    return {};
  }
}

export function collectAnalysis(
  filePath: string,
  options: {
    coverageReport?: string;
    declaredType?: TestType;
    substrateProbe?: SubstrateProbe;
    coverageMap?: string[];
    perTestRun?: boolean;
    analyzedRevision?: string;
  } = {},
): AnalysisOutput {
  const declaredType = options.declaredType ?? TestType.UNKNOWN;
  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, 'utf8');
  } catch (error) {
    return failed(filePath, declaredType, `unable to read test file: ${(error as Error).message}`);
  }

  let parsed: ParsedPython;
  try {
    parsed = parsePythonSource(sourceText, filePath, options.substrateProbe);
  } catch (error) {
    const failure = error as PythonParseFailure;
    if (failure.kind === 'failed') {
      return failed(filePath, declaredType, failure.message);
    }
    return unsupportedParser(filePath, declaredType, failure.message);
  }

  const framework = SUPPORTED_FRAMEWORKS[0];
  const anyGiven = parsed.tests.some((test) => test.given);
  const coverageStatus = anyGiven ? CollectionStatus.PARTIAL : CollectionStatus.COMPLETE;

  const record = buildSubjectEvidence(filePath, parsed, coverageStatus);

  const evidence: Record<string, ReturnType<typeof makeEvidenceRecord>> = {
    [EVIDENCE_ASSERTION_COUNT]: record,
    mutation_score: makeEvidenceRecord({
      type: 'mutation_score',
      value: undefined,
      availability: Availability.UNKNOWN,
      provenance: Provenance.DIRECT,
      source: ANALYZER_ID,
      collector_version: COLLECTOR_VERSION,
      scope: ANALYSIS_SCOPE,
      coverage: coverageBlock(CollectionStatus.UNAVAILABLE),
      reason: gapReason('no-mutation-report'),
    }),
  };

  const coverageResult = applyCoverageReport(evidence, options, filePath);
  const covered = coverageResult.covered;
  const perDeclScoped = coverageResult.perDeclScoped;

  return {
    subject: subject(filePath, declaredType, framework),
    analysis: summary(
      AnalysisStatus.SUCCESS,
      coverageStatus === CollectionStatus.COMPLETE ? Completeness.COMPLETE : Completeness.INCOMPLETE,
      declaredType,
    ),
    evidence,
    capabilities: capabilitiesOf(coverageStatus),
    tests: parsed.tests.map((test) => ({
      test: {
        id: `${filePath}#${test.name}@${test.line}`,
        name: test.name,
        line: test.line,
        declaration: 'def',
      },
      analysis: summary(
        AnalysisStatus.SUCCESS,
        test.given ? Completeness.INCOMPLETE : Completeness.COMPLETE,
        declaredType,
      ),
      evidence: testEvidence(filePath, test, covered, perDeclScoped),
      declaration_gap: null,
    })),
  };
}

function failed(filePath: string, declaredType: TestType, reason: string): AnalysisOutput {
  return {
    subject: subject(filePath, declaredType, SUPPORTED_FRAMEWORKS[0]),
    analysis: summary(AnalysisStatus.FAILED, Completeness.INCOMPLETE, declaredType),
    evidence: {
      [EVIDENCE_ASSERTION_COUNT]: makeEvidenceRecord({
        type: EVIDENCE_ASSERTION_COUNT,
        value: undefined,
        availability: deriveAvailability(CollectionStatus.UNAVAILABLE),
        provenance: Provenance.DIRECT,
        source: ANALYZER_ID,
        collector_version: COLLECTOR_VERSION,
        scope: ANALYSIS_SCOPE,
        coverage: coverageBlock(CollectionStatus.UNAVAILABLE),
        reason,
      }),
    },
    capabilities: capabilitiesOf(CollectionStatus.UNAVAILABLE),
  };
}

function unsupportedParser(filePath: string, declaredType: TestType, reason: string): AnalysisOutput {
  return {
    subject: subject(filePath, declaredType, SUPPORTED_FRAMEWORKS[0]),
    analysis: summary(AnalysisStatus.UNSUPPORTED, Completeness.NOT_APPLICABLE, declaredType),
    evidence: {
      [EVIDENCE_ASSERTION_COUNT]: makeEvidenceRecord({
        type: EVIDENCE_ASSERTION_COUNT,
        value: undefined,
        availability: deriveAvailability(CollectionStatus.UNAVAILABLE),
        provenance: Provenance.DIRECT,
        source: ANALYZER_ID,
        collector_version: COLLECTOR_VERSION,
        scope: ANALYSIS_SCOPE,
        coverage: coverageBlock(CollectionStatus.UNAVAILABLE),
        reason,
      }),
    },
    capabilities: capabilitiesOf(CollectionStatus.UNAVAILABLE),
  };
}
