import ts from 'typescript';

import {
  ANALYSIS_SCOPE,
  ANALYZER_ID,
  COLLECTOR_VERSION,
  SUPPORTED_ASSERTION_FORMS,
  SUPPORTED_FRAMEWORKS,
  classifyForm,
  classifyTestDeclaration,
  detectFramework,
  detectFrameworkDetail,
  isExpectChain,
  looksLikeCustomHelper,
  rootIdentifier,
} from '../../src/adapters/typescript/support';

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('sample.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

function firstStatement(source: string): ts.Statement {
  const statements = parse(source).statements;
  const first = statements[0];
  if (first === undefined) {
    throw new Error(`no statement parsed from: ${source}`);
  }
  return first;
}

function firstExpression(source: string): ts.Expression {
  const statement = firstStatement(source);
  if (!ts.isExpressionStatement(statement)) {
    throw new Error(`not an expression statement: ${source}`);
  }
  return statement.expression;
}

describe('support — published syntax surface (A9)', () => {
  it('publishes exactly the 11 supported assertion form IDs', () => {
    expect([...SUPPORTED_ASSERTION_FORMS].sort()).toEqual(
      [
        'expect-to-be',
        'expect-to-equal',
        'expect-to-be-truthy',
        'expect-to-be-falsy',
        'expect-to-match-snapshot',
        'expect-to-throw',
        'expect-rejects-to-throw',
        'expect-to-contain',
        'expect-matcher-utils',
        'expect-to-match-object',
        'expect-to-have-been-called-times',
      ].sort(),
    );
  });

  it('publishes the framework allowlist as jest and vitest', () => {
    expect([...SUPPORTED_FRAMEWORKS]).toEqual(['jest', 'vitest']);
  });

  it('publishes constant collector identity (no timestamps)', () => {
    expect(ANALYZER_ID).toBe('typescript-jest-adapter');
    expect(COLLECTOR_VERSION).toBe('0.1.0');
    expect(ANALYSIS_SCOPE).toBe('test-body');
  });
});

describe('detectFramework', () => {
  it.each([
    ["import { it } from '@jest/globals';", 'jest'],
    ["import { expect } from 'jest';", 'jest'],
    ["import '@jest/expect';", 'jest'],
    ["import '@jest/fake-timers';", 'jest'],
    ["import Jest from 'jest';", 'jest'],
    ["import * as J from 'jest';", 'jest'],
    ["import {} from 'jest';", 'jest'],
    ["import { it, expect } from 'vitest';", 'vitest'],
    ['const x = 1;', 'unknown'],
    // `@jest/types` and friends ship no runtime code — a bare or named import of
    // them is not evidence that the file runs under Jest.
    ["import '@jest/types';", 'unknown'],
    ["import { Config } from '@jest/types';", 'unknown'],
    ["import type { Config } from '@jest/types';", 'unknown'],
    // Type-only imports are erased before execution, so they prove nothing about
    // the runtime framework.
    ["import type { it } from 'jest';", 'unknown'],
    ["import type * as J from 'jest';", 'unknown'],
    ["import { type Config } from 'jest';", 'unknown'],
    // One value specifier keeps the import a runtime import.
    ["import { expect, type Config } from 'jest';", 'jest'],
    // Two frameworks in one file: reported explicitly, never first-wins.
    ["import { it } from '@jest/globals';\nimport { vi } from 'vitest';", 'mixed'],
  ])('detects %s as %s', (source, expected) => {
    expect(detectFramework(parse(source))).toBe(expected);
  });

  it('reports mixed frameworks independently of import order', () => {
    const jestThenVitest = "import { it } from '@jest/globals';\nimport { vi } from 'vitest';";
    const vitestThenJest = "import { vi } from 'vitest';\nimport { it } from '@jest/globals';";
    expect(detectFramework(parse(jestThenVitest))).toBe('mixed');
    expect(detectFramework(parse(vitestThenJest))).toBe('mixed');
  });

  // Option A (2026-11-02): Vitest's `globals: true` exposes `vi` on the global
  // scope, so a member call `vi.<name>(...)` is a runtime Vitest signal even
  // when the file has no vitest import declaration.
  it.each([
    ['vi.fn();', 'vitest'],
    ["vi.mock('./mod');", 'vitest'],
    ["const m = vi.fn();\nvi.mock('./mod');", 'vitest'],
    ['beforeEach(() => { vi.clearAllMocks(); });', 'vitest'],
    // Receiver must be the BARE identifier `vi`: a property named `vi` on
    // another object is not the Vitest global, and a longer identifier is not
    // the `vi` global.
    ['obj.vi.fn();', 'unknown'],
    ['myvi.fn();', 'unknown'],
    ['vi();', 'unknown'],
  ])('detects global vi usage %s as %s', (source, expected) => {
    expect(detectFramework(parse(source))).toBe(expected);
  });

  it('reports a jest import plus global vi usage as mixed', () => {
    const source = "import { it } from '@jest/globals';\nit('x', () => { vi.fn(); });";
    expect(detectFramework(parse(source))).toBe('mixed');
  });

  it('keeps a type-only vitest import plus global vi usage as vitest', () => {
    const source = "import type { Mock } from 'vitest';\nconst m: Mock = vi.fn();";
    expect(detectFramework(parse(source))).toBe('vitest');
  });
});

// P1.3 — bare-global test-declaration detection. When no runtime framework
// import or `vi.*` signal is present, a file that declares a bare `it`/`test`
// site AND calls bare `expect(...)` is DETECTED as jest, but only as a DERIVED
// signal (Provenance.DERIVED): bare globals are shared by jest/mocha/chai, so
// the framework is inferred, not observed (docs/limitations.md §4).
describe('detectFramework — bare-global derivation (P1.3)', () => {
  it.each([
    ["it('x', () => { expect(1).toBe(1); });", 'jest'],
    ["test('y', () => { expect('a').toEqual('a'); });", 'jest'],
    ["describe('d', () => { it('x', () => { expect(1).toBeTruthy(); }); });", 'jest'],
    // Conservative: only the fully-supported bare `it(...)`/`test(...)` form
    // triggers the fallback. A modifier/chained declaration (`it.each`,
    // `test.concurrent.only`) has an unscanned body and is reported as an
    // unsupported-form gap, so it must NOT be the reason a file is labelled jest
    // (Engram rev-1793641515161-4).
    ["it.each([[1]])('x', () => { expect(1).toBe(1); });", 'unknown'],
    ["test.concurrent.only('x', () => { expect(1).toBe(1); });", 'unknown'],
    // A bare declaration WITHOUT a bare `expect(` call stays unknown: the
    // assertions may live in an unsupported API (supertest/chai) the collector
    // cannot see, so a zero count could not be proved (docs/limitations.md §4).
    ["it('x', () => { request(app).get('/').expect(200); });", 'unknown'],
    // `expect(` alone — a setup/module file with no declaration — stays unknown.
    ['expect.extend({ toBeFoo() {} });', 'unknown'],
    // No declaration and no bare expect at all stays unknown.
    ['const x = 1;', 'unknown'],
    // An imported `it`/`expect` (here type-only) is a local binding, NOT a bare
    // global, so nothing is derived (case-26 vitest-no-runtime-import unchanged).
    ["import type { it } from 'vitest';\nit('x', () => { expect(1).toBe(1); });", 'unknown'],
    // An explicit unsupported-framework import (mocha) is never rewritten to
    // jest by the bare-global fallback (case-10 unchanged).
    ["import { expect, it } from 'mocha';\nit('x', () => { expect(1).toBe(1); });", 'unknown'],
  ])('detects %s as %s', (source, expected) => {
    expect(detectFramework(parse(source))).toBe(expected);
  });

  it('marks the bare-global signal DERIVED and an import signal not derived', () => {
    expect(detectFrameworkDetail(parse("it('x', () => { expect(1).toBe(1); });"))).toEqual({
      framework: 'jest',
      derived: true,
    });
    expect(
      detectFrameworkDetail(parse("import { it } from '@jest/globals';\nit('x', () => { expect(1).toBe(1); });")),
    ).toEqual({ framework: 'jest', derived: false });
    // No evidence at all is neither jest nor derived.
    expect(detectFrameworkDetail(parse('const x = 1;'))).toEqual({
      framework: 'unknown',
      derived: false,
    });
  });
});

describe('classifyForm', () => {
  it.each([
    ['expect(x).toBe(y);', 'expect-to-be'],
    ['expect(x).toEqual(y);', 'expect-to-equal'],
    ['expect(x).toBeTruthy();', 'expect-to-be-truthy'],
    ['expect(x).toBeFalsy();', 'expect-to-be-falsy'],
    ['expect(fn).toThrow();', 'expect-to-throw'],
    ['expect(x).toMatchSnapshot();', 'expect-to-match-snapshot'],
    ['await expect(p).rejects.toThrow();', 'expect-rejects-to-throw'],
    ['await expect(p).rejects.toThrow(Error);', 'expect-rejects-to-throw'],
    ['expect(x).toContain(y);', 'expect-to-contain'],
    ['expect(x).toMatchObject(y);', 'expect-to-match-object'],
    ['expect(x).toHaveBeenCalledTimes(1);', 'expect-to-have-been-called-times'],
    ['expect.any(String);', 'expect-matcher-utils'],
    ['expect.objectContaining({ a: 1 });', 'expect-matcher-utils'],
    ['expect.arrayContaining([1]);', 'expect-matcher-utils'],
    ['expect.stringContaining("x");', 'expect-matcher-utils'],
  ])('classifies %s as %s', (source, expected) => {
    expect(classifyForm(firstExpression(source))).toBe(expected);
  });

  it.each([
    'await expect(p).resolves.toBe(x);',
    'expect(x).not.toBe(y);',
    'expect(x).toBeGreaterThan(y);',
    'expect(x)[m]();',
    'assert.equal(x, y);',
    'foo(x);',
  ])('returns null for unsupported chain %s', (source) => {
    expect(classifyForm(firstExpression(source))).toBeNull();
  });
});

describe('unrecognized-construct helpers', () => {
  it('detects expect-rooted chains including computed matchers', () => {
    expect(isExpectChain(firstExpression('expect(x).toBeGreaterThan(y);'))).toBe(true);
    expect(isExpectChain(firstExpression('expect(x)[m]();'))).toBe(true);
    expect(isExpectChain(firstExpression('await expect(p).rejects.toBe(x);'))).toBe(true);
    expect(isExpectChain(firstExpression('assert.equal(x, y);'))).toBe(false);
    expect(isExpectChain(firstExpression('makeUser();'))).toBe(false);
  });

  it('reports the namespace root of an unsupported assertion API', () => {
    expect(rootIdentifier(firstExpression('assert.equal(x, y);'))).toBe('assert');
    expect(rootIdentifier(firstExpression('expect(x).toBe(y);'))).toBeNull();
  });

  it('flags custom assertion helper names but not plain expect', () => {
    expect(looksLikeCustomHelper(firstExpression('expectValidUser(u);'))).toBe(true);
    expect(looksLikeCustomHelper(firstExpression('assertUserHasId(u);'))).toBe(true);
    expect(looksLikeCustomHelper(firstExpression('expect(x);'))).toBe(false);
    expect(looksLikeCustomHelper(firstExpression('makeUser();'))).toBe(false);
  });
});
describe('classifyTestDeclaration — chained callee roots', () => {
  const callee = (source: string): ts.Expression => {
    const expression = firstExpression(source);
    if (!ts.isCallExpression(expression)) {
      throw new Error(`not a call expression: ${source}`);
    }
    return expression.expression;
  };

  it('walks a PropertyAccess chain leftwards to the root identifier', () => {
    expect(classifyTestDeclaration(callee('test.concurrent.only("a", fn);'))).toEqual({
      root: 'test',
      modifier: 'concurrent.only',
    });
    expect(classifyTestDeclaration(callee('it.skip.each(t)("a", fn);'))).toEqual({
      root: 'it',
      modifier: 'skip.each',
    });
  });

  it('classifies a single-level modifier unchanged', () => {
    expect(classifyTestDeclaration(callee('it.each(t)("a", fn);'))).toEqual({
      root: 'it',
      modifier: 'each',
    });
    expect(classifyTestDeclaration(callee('it("a", fn);'))).toEqual({
      root: 'it',
      modifier: null,
    });
  });

  it('never silently omits a chained declaration', () => {
    for (const source of [
      'test.concurrent.only("a", fn);',
      'it.skip.each(t)("a", fn);',
      'test.concurrent.each(t)("a", fn);',
      'it.skipIf(c)("a", fn);',
    ]) {
      expect(classifyTestDeclaration(callee(source))).not.toBeNull();
    }
  });

  it('still returns null for a non-test root, however deeply chained', () => {
    expect(classifyTestDeclaration(callee('suite.each(t).only("a", fn);'))).toBeNull();
    expect(classifyTestDeclaration(callee('describe("a", fn);'))).toBeNull();
  });
});
