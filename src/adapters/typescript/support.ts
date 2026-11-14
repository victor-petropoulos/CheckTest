/**
 * TypeScript/Jest adapter — supported-syntax surface (plan tasks 3 & 6; A1 + A9 + E + F).
 *
 * Everything the adapter CLAIMS to recognize is published here as data: the
 * framework allowlist, the 7 assertion form IDs (KickOff:84-90) and the
 * recognized test-declaration roots (F). The collector is the only caller;
 * nothing here evaluates rules.
 *
 * Dependency direction: adapter -> core. This module re-exports one core
 * constant (EVIDENCE_SCOPE_TEST_BODY) as ANALYSIS_SCOPE; it never imports
 * `src/rules`.
 */

import ts from 'typescript';

import { EVIDENCE_SCOPE_TEST_BODY } from '../../core/evidence';

/**
 * Adapter-side alias for EVIDENCE_SCOPE_TEST_BODY (core is single source of truth).
 * Re-exported so adapters speak ANALYSIS_SCOPE without importing the core name, keeping
 * adapter->core dependency direction; value must stay identical to the core constant.
 */
export const ANALYSIS_SCOPE = EVIDENCE_SCOPE_TEST_BODY;

/**
 * A9 — the capability vocabulary MOVED to adapter ownership (task 12, ruling
 * #11): the VALUES live in the leaf `./capabilities`, and this re-export keeps
 * every existing import site (collector.ts, regex-assertion-count.ts, tests)
 * working unchanged. Same array objects as the contract instance publishes.
 */
export { SUPPORTED_ASSERTION_FORMS, SUPPORTED_FRAMEWORKS } from './capabilities';

/** SPEC:252 — collector identity published in every evidence record. */
export const ANALYZER_ID = 'typescript-jest-adapter';

/** Constant string (plan guardrail: no timestamps in output). */
export const COLLECTOR_VERSION = '0.1.0';

/** The single evidence type this adapter emits. */
export const EVIDENCE_ASSERTION_COUNT = 'assertion_count';

/** Matcher name -> form ID. `rejects.toThrow` is handled separately (async form). */
export const ASSERTION_FORM_BY_MATCHER: Readonly<Record<string, string>> = {
  toBe: 'expect-to-be',
  toEqual: 'expect-to-equal',
  toBeTruthy: 'expect-to-be-truthy',
  toBeFalsy: 'expect-to-be-falsy',
  toThrow: 'expect-to-throw',
  toMatchSnapshot: 'expect-to-match-snapshot',
  toContain: 'expect-to-contain',
  toMatchObject: 'expect-to-match-object',
  toHaveBeenCalledTimes: 'expect-to-have-been-called-times',
};

/**
 * Namespaces whose member calls are treated as an assertion API outside the
 * supported forms (fixture 3, e.g. `assert.equal(x, y)`). Documented heuristic:
 * an unsupported API NOT rooted at one of these names is not detected in
 * milestone-1 (known gap, docs/limitations.md).
 */
export const UNSUPPORTED_ASSERTION_NAMESPACES: readonly string[] = ['assert', 'chai', 'should'];

/**
 * Callee-name patterns treated as custom assertion helpers, i.e. a test
 * delegating its assertion to a function we cannot resolve (fixture 4, A1:
 * scope is `test-body`, cross-file helper resolution is out of scope).
 * A helper is recorded as an unsupported form with a reason, never silently
 * dropped — a zero count must not be manufactured from evidence we could not
 * classify (KickOff:72).
 */
export const CUSTOM_HELPER_NAME_PATTERNS: readonly RegExp[] = [/^expect[A-Z_]/, /assert/i];

/** Framework reported when the file imports no recognizable test framework. */
export const UNKNOWN_FRAMEWORK = 'unknown';

/** P1.3 SP2 — framework reported for bare-global declarations without `expect` (mocha-class). */
export const MOCHA_FRAMEWORK = 'mocha';

/**
 * Framework reported when the file imports TWO DIFFERENT frameworks. Reporting
 * a value outside SUPPORTED_FRAMEWORKS is the conservative resolution: a file
 * that both imports Jest and Vitest has no single framework, so it is
 * UNSUPPORTED rather than analyzed under whichever import happened to come
 * first (first-wins would silently pick a framework and then apply Jest
 * assertion semantics to code we did not establish runs under Jest).
 */
export const MIXED_FRAMEWORK = 'mixed';

/**
 * `@jest/*` subpaths that ship RUNTIME code — importing one of these proves the
 * module graph loads Jest at execution time. Verified by requiring each package
 * from jest@29.7.0 (`@jest/types` and `@jest/environment` resolve to an empty
 * 14-byte `'use strict';` stub and export nothing, so they are type-only).
 *
 * Anything else under `@jest/` — `@jest/types`, `@jest/environment`, and any
 * subpath not listed here — is NOT accepted as runtime evidence. An unrecognized
 * subpath resolves to UNKNOWN_FRAMEWORK (UNSUPPORTED), never to a guess.
 */
export const JEST_RUNTIME_SPECIFIERS: readonly string[] = [
  '@jest/console',
  '@jest/core',
  '@jest/expect',
  '@jest/expect-utils',
  '@jest/fake-timers',
  '@jest/globals',
  '@jest/reporters',
  '@jest/schemas',
  '@jest/source-map',
  '@jest/test-result',
  '@jest/test-sequencer',
  '@jest/transform',
];

/**
 * P1.3 — how `detectFramework` established the framework.
 *
 * `derived` is true ONLY when the framework was inferred from BARE-GLOBAL
 * identifier usage with no runtime framework import. That inference is a
 * DERIVED signal (src/core/evidence.ts `Provenance.DERIVED`), never a runtime
 * observation: Jest, Mocha, Chai and Vitest all expose the same bare
 * `describe`/`it`/`test`/`expect` globals, so the shape cannot be told apart
 * statically (docs/limitations.md §4). The collector publishes `framework` as
 * usual, but records the derivation honestly in the analysis capabilities and
 * the evidence reason (collector.ts).
 */
export interface FrameworkDetection {
  framework: string;
  derived: boolean;
}

/**
 * Identifiers that, when IMPORTED, are LOCAL bindings rather than globals. A
 * file that imports any of these never takes the P1.3 bare-global fallback:
 * `import { it } from 'mocha'` binds `it`, and `import type { it } from
 * 'vitest'` binds it too, so neither call is a bare global to be re-labelled
 * jest (case-10, case-26 unchanged).
 */
const BARE_GLOBAL_NAMES: readonly string[] = ['it', 'test', 'describe', 'expect'];

/**
 * Detect the test framework, plus whether the answer was DERIVED (P1.3).
 *
 * Runtime-evidence rules (unchanged, plan task 3):
 *   - only runtime imports count: a type-only declaration (`import type ...`,
 *     or a named-import list where every specifier is `type`) is erased before
 *     execution and proves nothing about the framework;
 *   - `jest` and the runtime `@jest/*` subpaths in JEST_RUNTIME_SPECIFIERS mean
 *     Jest; `vitest` and `vitest/*` mean Vitest; every other specifier is
 *     ignored;
 *   - a member call `vi.<name>(...)` whose receiver is the BARE identifier `vi`
 *     is also a Vitest runtime signal (Option A, 2026-11-02);
 *   - two different frameworks in one file report MIXED_FRAMEWORK rather than
 *     first-wins.
 *
 * P1.3 adds ONE derived fallback, applied only when NO runtime import or `vi.*`
 * signal was found AND no `it`/`test`/`describe`/`expect` name is imported:
 * a file that declares a bare `it`/`test` call site AND calls bare `expect(...)`
 * is reported as `jest` with `derived: true`. This is a DERIVED signal, not a
 * runtime observation — bare globals cannot distinguish jest from mocha/chai/
 * jasmine (docs/limitations.md §4). The `expect(...)` requirement keeps a file
 * whose assertions live in an unsupported API (supertest `.expect(200)`, chai
 * `expect(x).to`) out of the jest fallback; those files instead land on the
 * `mocha`-derived branch below (SP2) rather than `unknown`.
 *
 * Returns UNKNOWN_FRAMEWORK when no runtime framework evidence is present. The
 * collector treats both UNKNOWN_FRAMEWORK and MIXED_FRAMEWORK as UNSUPPORTED:
 * those files are outside the declared framework scope rather than assumed to
 * be Jest.
 */
export function detectFrameworkDetail(sourceFile: ts.SourceFile): FrameworkDetection {
  const detected = new Set<string>();
  const importedNames = new Set<string>();
  let bareDeclaration = false;
  let bareExpect = false;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      collectImportedNames(node, importedNames);
      if (!isTypeOnlyImport(node)) {
        const specifier = node.moduleSpecifier.text;
        if (specifier === 'vitest' || specifier.startsWith('vitest/')) {
          detected.add('vitest');
        } else if (specifier === 'jest' || JEST_RUNTIME_SPECIFIERS.includes(specifier)) {
          detected.add('jest');
        }
      }
    }
    if (isGlobalViMemberCall(node)) {
      detected.add('vitest');
    }
    if (isBareTestDeclarationCall(node)) {
      bareDeclaration = true;
    }
    if (isBareExpectCall(node)) {
      bareExpect = true;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (detected.size === 0) {
    const hasImportedBinding = BARE_GLOBAL_NAMES.some((name) => importedNames.has(name));
    if (bareDeclaration && bareExpect && !hasImportedBinding) {
      return { framework: 'jest', derived: true };
    }
    // Phase 6 SP2 — bare test declarations with NO expect calls: the assertion
    // surface is unknown (supertest/chai territory), so the honest derivation is
    // mocha-class, not jest. See limitations §4 + §22.
    if (bareDeclaration && !bareExpect && !hasImportedBinding) {
      return { framework: MOCHA_FRAMEWORK, derived: true };
    }
    return { framework: UNKNOWN_FRAMEWORK, derived: false };
  }
  if (detected.size > 1) {
    return { framework: MIXED_FRAMEWORK, derived: false };
  }
  // ponytail: Set of 1 — take the single entry without a redundant branch.
  return { framework: detected.values().next().value as string, derived: false };
}

/** Framework alone, as the pre-P1.3 signature. */
export function detectFramework(sourceFile: ts.SourceFile): string {
  return detectFrameworkDetail(sourceFile).framework;
}

/**
 * Names every identifier an import declaration binds — default, namespace and
 * named specifiers. A name bound here is a LOCAL binding, so a later call on it
 * is not a bare global (P1.3). Side-effect imports (`import 'x'`) bind nothing.
 */
function collectImportedNames(node: ts.ImportDeclaration, into: Set<string>): void {
  const clause = node.importClause;
  if (clause === undefined) {
    return;
  }
  if (clause.name !== undefined) {
    into.add(clause.name.text);
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined) {
    return;
  }
  if (ts.isNamespaceImport(bindings)) {
    into.add(bindings.name.text);
    return;
  }
  for (const element of bindings.elements) {
    into.add(element.name.text);
  }
}

/**
 * True for a bare, FULLY-SUPPORTED test declaration call — `it(...)` or
 * `test(...)` with the identifier as the DIRECT callee.
 *
 * Modifier/chained forms (`it.each(t)(...)`, `test.concurrent.only(...)`) do
 * NOT trigger the derived fallback: their bodies are never scanned, so they are
 * reported as unsupported-form gaps and must not be the reason a file is
 * labelled jest. Requiring the fully-supported form keeps the fallback at the
 * exact declaration shape the collector can analyze (P1.3; conservative).
 */
function isBareTestDeclarationCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    TEST_DECLARATION_NAMES.includes(node.expression.text)
  );
}

/** True for a bare `expect(...)` call: the callee identifier itself is `expect` (P1.3). */
function isBareExpectCall(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'expect';
}

/**
 * True for a call `vi.<name>(...)` whose receiver is the BARE identifier `vi` —
 * the Vitest global exposed by `globals: true`. `obj.vi.fn()` (a property) and
 * `myvi.fn()` (a different identifier) do not match; a nested `vi.fn()` inside
 * a chain (`vi.fn().mockReturnValue(x)`) matches here because the visitor
 * descends into every node.
 */
function isGlobalViMemberCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'vi'
  );
}

/**
 * True when an import declaration is erased at compile time: `import type X
 * from 'y'` (clause-level) or `import { type X } from 'y'` where every named
 * specifier is type-only. A side-effect import (`import 'y'` — no clause) is a
 * runtime import and returns false.
 */
function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) {
    return false;
  }
  if (clause.isTypeOnly) {
    return true;
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined || !ts.isNamedImports(bindings)) {
    return false;
  }
  return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

/** Strip `await` / parentheses so a whole assertion statement can be classified. */
function unwrap(node: ts.Node): ts.Node {
  if (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return unwrap(node.expression);
  }
  return node;
}

/**
 * Classify a recognized Jest assertion chain, or return null.
 *
 * Recognized shapes:
 *   expect(x).toBe(y) … (see ASSERTION_FORM_BY_MATCHER)
 *   await expect(p).rejects.toThrow()   -> 'expect-rejects-to-throw'
 *
 * `rejects.toBe` and `.not` chains are NOT in the A9 list of 7 forms, so they
 * return null and are recorded as unsupported forms by the collector — never
 * counted as an established assertion.
 */
/** Asymmetric matchers from Jest's matcher-utils; recognized by classifyForm as one supported form. */
const MATCHER_UTILS_HELPERS: ReadonlySet<string> = new Set([
  'any',
  'objectContaining',
  'arrayContaining',
  'stringContaining',
]);

/** Phase 6 SP3 — supertest/superagent HTTP assertion chains (corpus-verified: express).
 *  supertest forms are corpus-verified (express `test/res.sendStatus.js:13-18`);
 *  chai `expect().to.*` and node `assert` remain UNSUPPORTED namespaces (support.ts:67 unchanged).
 */
export const SUPERTEST_HTTP_METHODS: readonly string[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** True when the call's property chain contains an HTTP-method segment below a non-expect root. */
function isSupertestChain(node: ts.CallExpression): { chain: boolean; argCount: number } | null {
  const parts: string[] = [];
  let cur: ts.Node = node.expression;
  while (ts.isPropertyAccessExpression(cur) || ts.isCallExpression(cur)) {
    if (ts.isPropertyAccessExpression(cur)) {
      parts.push(cur.name.text);
      cur = cur.expression;
    } else {
      cur = cur.expression;
    }
  }
  if (ts.isIdentifier(cur) && cur.text === 'expect') return null; // jest-style root
  const names = parts.filter((p) => SUPERTEST_HTTP_METHODS.includes(p));
  if (!parts.includes('expect') || names.length === 0) return null;
  return { chain: true, argCount: node.arguments.length };
}

export function classifyForm(node: ts.Node): string | null {
  const expression = unwrap(node);
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
    return null;
  }

  // SP3 — supertest/superagent HTTP assertion chains.
  const st = isSupertestChain(expression);
  if (st) return st.argCount >= 2 ? 'supertest-expect-body' : 'supertest-expect-status';

  const matcherAccess = expression.expression;
  const matcher = matcherAccess.name.text;

  // matcher-utils: expect.any/objectContaining/arrayContaining/stringContaining
  if (
    ts.isIdentifier(matcherAccess.expression) &&
    matcherAccess.expression.text === 'expect' &&
    MATCHER_UTILS_HELPERS.has(matcher)
  ) {
    return 'expect-matcher-utils';
  }

  // async: expect(p).rejects.toThrow()
  const receiver = matcherAccess.expression;
  if (
    ts.isPropertyAccessExpression(receiver) &&
    receiver.name.text === 'rejects' &&
    isExpectCall(receiver.expression)
  ) {
    return matcher === 'toThrow' ? 'expect-rejects-to-throw' : null;
  }

  // sync: expect(x).toBe(y)
  if (isExpectCall(receiver)) {
    return ASSERTION_FORM_BY_MATCHER[matcher] ?? null;
  }

  return null;
}

/** True when the chain is rooted at an `expect(...)` call of any shape. */
export function isExpectChain(node: ts.Node): boolean {
  const expression = unwrap(node);
  if (!ts.isCallExpression(expression)) {
    return false;
  }
  const callee = expression.expression;
  if (ts.isElementAccessExpression(callee)) {
    return isExpectCall(callee.expression);
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const receiver = callee.expression;
    if (isExpectCall(receiver)) {
      return true;
    }
    // matcher-utils helpers are rooted at the `expect` identifier.
    if (ts.isIdentifier(receiver) && receiver.text === 'expect' && MATCHER_UTILS_HELPERS.has(callee.name.text)) {
      return true;
    }
    return ts.isPropertyAccessExpression(receiver) && isExpectCall(receiver.expression);
  }
  return false;
}

function isExpectCall(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'expect';
}

/** Root identifier of a property-access callee, e.g. `assert` in `assert.equal`. */
export function rootIdentifier(node: ts.Node): string | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return null;
  }
  const receiver = node.expression.expression;
  return ts.isIdentifier(receiver) ? receiver.text : null;
}

/** True when the callee name looks like a custom assertion helper (fixture 4). */
export function looksLikeCustomHelper(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
    return false;
  }
  const name = node.expression.text;
  return CUSTOM_HELPER_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/* ------------------------------------------------------------------ *
 * F — test declarations
 * ------------------------------------------------------------------ */

/**
 * EVERY declaration-shaped callee is REPORTED, never silently omitted. Shapes:
 *   it(name, fn)               -> { root: 'it', modifier: null }
 *   it.each(t)(name, fn)       -> { root: 'it', modifier: 'each' }
 *   it.each`row` (name, fn)    -> { root: 'it', modifier: 'each' }
 *   it.skipIf(c)(name, fn)     -> { root: 'it', modifier: 'skipIf' }
 *   test.concurrent.only(...)   -> { root: 'test', modifier: 'concurrent.only' }
 *   (c ? it.skip : it)(...)     -> { root: 'it', modifier: 'conditional' }
 *   const t = it; t(...)        -> { root: 'it', modifier: 'aliased' }
 *   describe(name, fn)         -> null (not a test declaration)
 *
 * 'conditional' (WP3.4 defect 1, apollo-server index.test.ts:901) and
 * 'aliased' (WP3.4 defect 2, limitations.md §12, `const t = it`) are NOT
 * newly-supported forms — they yield the same unsupported-form gap as `each`,
 * so the construct is surfaced with a reason instead of disappearing.
 * 'conditional' is recognized only when BOTH branches resolve to a
 * test-declaration root (directly or through a verified in-file alias); when
 * the roots differ the name is `<then>/<else>.conditional`, and the gap
 * reason stays the definitive statement.
 *
 * A PropertyAccess chain is walked leftwards to its root Identifier and every
 * property joined into the modifier, so `test.concurrent.only` is recognized as
 * a test declaration rather than dropped for lack of a single-level match.
 *
 * An unknown ROOT returns null only when it does not resolve through the
 * verified in-file alias map (`collectTestAliases`): the alias path reports the
 * call through the file's own `const t = it` evidence, never a guess. This
 * mirror of the unknown-modifier behaviour is deliberate: both unknown roots
 * (via alias) and unknown modifiers on known roots are exactly the case the
 * caller has to surface rather than omit.
 */

/**
 * F — call roots recognized as test declarations. Recognizing the ROOT is what
 * lets an unsupported declaration be REPORTED instead of silently omitted: the
 * adapter does not need to enumerate every `it.*` modifier to notice that a
 * call sits in test-declaration territory.
 */
export const TEST_DECLARATION_NAMES: readonly string[] = ['it', 'test'];

/**
 * F — one test declaration's callee shape. `modifier` is null for the bare
 * `it(name, fn)` / `test(name, fn)` form, the ONLY declaration form the
 * collector fully supports. Every other modifier (`each`, `skip`, `only`,
 * `todo`, `failing`, `concurrent`, `skipIf`, `runIf`, or anything
 * unrecognized) yields a non-null modifier and is reported as not fully
 * supported — never dropped.
 */
export interface TestDeclaration {
  /** `it` or `test` — the recognized root. */
  root: string;
  /**
   * Property applied to the root, e.g. `each` in `it.each(t)(name, fn)`. A
   * chained form joins its properties with `.`, e.g. `concurrent.only` in
   * `test.concurrent.only(name, fn)`.
   */
  modifier: string | null;
}

/**
 * F — in-file test-declaration aliases, e.g. `const t = it`.
 *
 * Detected statically: a VariableDeclaration whose initializer is exactly an
 * Identifier rooted at a declared test name (`it`/`test`). `const` AND `let`
 * are both matched — the initializer is the same static in-file evidence
 * either way (`let t = it` reports exactly like `const t = it`; no initializer
 * at declaration, i.e. `let t; t = test`, matches nothing here). The alias is
 * VERIFIED in-file, not guessed, so classifying a call on it does not widen
 * the supported syntax — the call is still reported as an unsupported form
 * (modifier 'aliased', gap 'aliased') because how the aliased declaration
 * runs cannot be established through the alias at this analysis level.
 *
 * Deliberately NOT resolved: reassignment without a declaration initializer
 * (`let t; t = test`), chained aliases
 * (`const u = t`), aliased members (`const s = it.skip`). Those have no static
 * in-file initializer rooted at a declared name, so they stay undetected and
 * are documented in docs/limitations.md (§12) rather than guessed at.
 *
 * Returns a map alias-name -> root ('it' | 'test'); empty when the file
 * declares none.
 */
export function collectTestAliases(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = node.initializer;
      if (
        initializer !== undefined &&
        ts.isIdentifier(initializer) &&
        TEST_DECLARATION_NAMES.includes(initializer.text)
      ) {
        aliases.set(node.name.text, initializer.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

/**
 * F — classify a call's callee as a test declaration, or null when it is not.
 *
 * Every shape a Jest declaration takes is handled:
 *   it(name, fn)               -> { root: 'it', modifier: null }
 *   it.each(t)(name, fn)       -> { root: 'it', modifier: 'each' }
 *   it.each`row` (name, fn)    -> { root: 'it', modifier: 'each' }
 *   it.skipIf(c)(name, fn)     -> { root: 'it', modifier: 'skipIf' }
 *   test.concurrent.only(...)   -> { root: 'test', modifier: 'concurrent.only' }
 *   describe(name, fn)         -> null (not a test declaration)
 *
 * A PropertyAccess chain is walked leftwards to its root Identifier and every
 * property joined into the modifier, so `test.concurrent.only` is recognized as
 * a test declaration rather than dropped for lack of a single-level match.
 *
 * An unknown ROOT returns null unless it resolves through the verified in-file
 * alias map (WP3.4 defect 2 path, above); an unknown MODIFIER on a known root
 * never does. Callers must surface gaps, not omit the call.
 */

/** F — both-branches case: same root collapses, different roots join with '/'. */
function conditionalRoot(left: string | null, right: string | null): TestDeclaration | null {
  // WP3.4 defect 1 — a conditional callee is REPORTED ('conditional' modifier)
  // when BOTH branches resolve to a test-declaration root (directly or via a
  // verified in-file alias), never returned null: null would silently drop the
  // site and the file would read as COMPLETE / value 0 / KNOWN.
  if (left !== null && right !== null) {
    return { root: left === right ? left : `${left}/${right}`, modifier: 'conditional' };
  }
  // WP3.4 remediation — ONE branch resolves: partial evidence. Which
  // declaration runs is still not statically established, but one candidate
  // root is known, so the site is REPORTED with the conditional gap rather
  // than silently dropped. Neither branch resolving falls through to null.
  const one = left ?? right;
  return one !== null ? { root: one, modifier: 'conditional' } : null;
}

/** F — ConditionalExpression callee: resolve both branch roots. */
function classifyConditionalCallee(
  core: ts.ConditionalExpression,
  aliases: ReadonlyMap<string, string>,
): TestDeclaration | null {
  return conditionalRoot(branchRoot(core.whenTrue, aliases), branchRoot(core.whenFalse, aliases));
}

/** F — `&&`/`||` callee: resolve both operand roots (short-circuit gap, same 'conditional' modifier). */
function classifyBinaryCallee(core: ts.BinaryExpression, aliases: ReadonlyMap<string, string>): TestDeclaration | null {
  // WP3.4 remediation — a `&&`/`||` callee short-circuits to one operand; when
  // an operand carries test-root evidence the site is REPORTED with the
  // conditional gap (which operand runs is not statically established).
  return conditionalRoot(branchRoot(core.left, aliases), branchRoot(core.right, aliases));
}

/** F — plain identifier callee: direct name or verified in-file alias. */
function classifyIdentifierCallee(core: ts.Identifier, aliases: ReadonlyMap<string, string>): TestDeclaration | null {
  if (TEST_DECLARATION_NAMES.includes(core.text)) return { root: core.text, modifier: null };
  // WP3.4 defect 2 — a verified in-file alias (`const t = it`) is a test
  // declaration detected through the alias and reported with the
  // unsupported-form gap (modifier 'aliased'); conservative, not widened
  // support. An unresolved alias (reassignment, chained alias) stays null.
  return aliases.has(core.text) ? { root: aliases.get(core.text) as string, modifier: 'aliased' } : null;
}

/** F — walk a PropertyAccess chain leftwards; modifier is the dot-joined tail. */
function classifyPropertyChainCallee(core: ts.Node): TestDeclaration | null {
  // Walk the PropertyAccess chain leftwards to its root Identifier: in
  // `test.concurrent.only` the `.expression` is another PropertyAccess, so a
  // single-level check would see no identifier and return null — silently
  // omitting a real declaration instead of reporting it.
  const properties: string[] = [];
  let node: ts.Node = core;
  while (ts.isPropertyAccessExpression(node)) {
    properties.unshift(node.name.text);
    node = node.expression;
  }
  if (ts.isIdentifier(node) && TEST_DECLARATION_NAMES.includes(node.text)) {
    return { root: node.text, modifier: properties.join('.') };
  }
  return null;
}

/** F — true when the binary core is `&&` or `||`. */
function isShortCircuit(core: ts.Node): core is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(core) &&
    (core.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      core.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  );
}

export function classifyTestDeclaration(
  callee: ts.Node,
  aliases: ReadonlyMap<string, string> = new Map(),
): TestDeclaration | null {
  const core = calleeCore(callee);
  if (ts.isConditionalExpression(core)) return classifyConditionalCallee(core, aliases);
  if (isShortCircuit(core)) return classifyBinaryCallee(core, aliases);
  if (ts.isIdentifier(core)) return classifyIdentifierCallee(core, aliases);
  return classifyPropertyChainCallee(core);
}

/**
 * F — resolve one ConditionalExpression branch to a test-declaration root
 * (direct identifier, verified alias, or a property access chain rooted at
 * one, e.g. `it.skip`); parens are stripped first. Null when the branch has
 * no static root evidence.
 */
function branchRoot(node: ts.Node, aliases: ReadonlyMap<string, string>): string | null {
  if (ts.isParenthesizedExpression(node)) {
    return branchRoot(node.expression, aliases);
  }
  if (ts.isIdentifier(node)) {
    if (TEST_DECLARATION_NAMES.includes(node.text)) {
      return node.text;
    }
    return aliases.get(node.text) ?? null;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return branchRoot(node.expression, aliases);
  }
  return null;
}

/** Peel `f(x)`, f`x`, `p.x` and parentheses off a callee down to its access core. */
function calleeCore(node0: ts.Node): ts.Node {
  let node: ts.Node = node0;
  while (true) {
    if (ts.isCallExpression(node)) {
      node = node.expression;
      continue;
    }
    if (ts.isTaggedTemplateExpression(node)) {
      node = node.tag;
      continue;
    }
    if (ts.isParenthesizedExpression(node)) {
      node = node.expression;
      continue;
    }
    return node;
  }
}
/**
 * F — how far one test declaration could be analyzed. `none` means fully
 * understood; every other value is surfaced in the evidence reason, so a
 * declaration is never silently omitted (KickOff:72).
 *
 *   none              — bare `it`/`test` with an inline body; fully scanned.
 *   declaration-only  — no executable body (`it.todo('x')`); contributes nothing.
 *   unresolved-body   — a body argument exists but is not an inline function.
 *   unsupported-form  — a modifier form (`each`, `skip`, `only`, ...).
 *   conditional       — a conditional callee (`(c ? it.skip : it)(...)`); a
 *                       REPORTED construct, still not an established form
 *                       (WP3.4 defect 1).
 *   aliased           — a verified in-file alias call (`const t = it; t(...)`);
 *                       REPORTED, not established (WP3.4 defect 2, §12).
 */
export type DeclarationGap =
  'none' | 'declaration-only' | 'unresolved-body' | 'unsupported-form' | 'conditional' | 'aliased';

/** One `it`/`test` declaration site in the file. */
export interface DeclarationSite {
  declaration: TestDeclaration;
  /** The declaration call itself — the boundary another declaration's scan stops at. */
  node: ts.Node;
  /** Test name as written; '' when no argument provides one. */
  name: string;
  /** 1-based source line of the declaration call — the per-test identity key. */
  line: number;
  /** Inline callback body to scan, or null when there is none to scan. */
  body: ts.Node | null;
  gap: DeclarationGap;
  syntax: string;
}

/**
 * A gap that cost us evidence: something inside the declaration may hold
 * assertions we could not count. A declaration-only form costs nothing — its
 * body provably does not exist — so it is reported without degrading coverage.
 */
export function isCapabilityGap(gap: DeclarationGap): boolean {
  return gap !== 'none' && gap !== 'declaration-only';
}

/** Human-readable name of a declaration: `it` or `it.each`. */
export function declarationName(declaration: TestDeclaration): string {
  return declaration.modifier === null ? declaration.root : `${declaration.root}.${declaration.modifier}`;
}

/**
 * F — why a declaration is not fully analyzed; published in the reason.
 * 'conditional' and 'aliased' are REPORTED constructs (WP3.4 defects 1-2),
 * not newly supported forms — the gap says exactly what cannot be established.
 */
export function declarationGapReason(site: DeclarationSite): string {
  const name = declarationName(site.declaration);
  switch (site.gap) {
    case 'declaration-only':
      return `'${name}' declares no executable test body; it contributes no assertions`;
    case 'unresolved-body':
      return `'${name}' body is not an inline function; the collector cannot resolve or scan it`;
    case 'conditional':
      return `'${name}' is a conditional declaration (${site.syntax}); which declaration runs cannot be established statically`;
    case 'aliased':
      return `'${name}' is declared through a verified in-file test alias (${site.declaration.root}); the collector reports it without establishing how it runs`;
    default:
      return `'${name}' is not a supported test declaration form; how often its body runs cannot be established statically`;
  }
}

export function declarationSite(
  sourceFile: ts.SourceFile,
  node: ts.CallExpression,
  declaration: TestDeclaration,
): DeclarationSite {
  const callback = node.arguments.find(
    (argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
      ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
  );
  // ponytail: the gap is fully determined by (has inline callback) x (has modifier).
  const gap: DeclarationGap =
    callback === undefined && node.arguments.length > 1
      ? 'unresolved-body'
      : callback === undefined
        ? 'declaration-only'
        : declaration.modifier === null
          ? 'none'
          : declaration.modifier === 'conditional'
            ? 'conditional'
            : declaration.modifier === 'aliased'
              ? 'aliased'
              : 'unsupported-form';
  // A concise arrow body is an expression, a braced one a Block — scanTestBody
  // takes either.
  return {
    declaration,
    node,
    name: declarationLabel(node.arguments[0], sourceFile),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    body: callback?.body ?? null,
    gap,
    syntax: shortText(sourceFile, node),
  };
}

/** Test name: literal text when the first argument is a literal, else its source rendering. */
export function declarationLabel(argument: ts.Expression | undefined, sourceFile: ts.SourceFile): string {
  if (argument === undefined) {
    return '';
  }
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.text;
  }
  return shortText(sourceFile, argument);
}

/** One-line source rendering used inside reasons; truncated to stay bounded. */
export function shortText(sourceFile: ts.SourceFile, node: ts.Node): string {
  const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
