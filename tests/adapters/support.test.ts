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

  it('publishes the framework allowlist as jest, vitest and mocha', () => {
    expect([...SUPPORTED_FRAMEWORKS]).toEqual(['jest', 'vitest', 'mocha']);
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
    // Phase 6 SP2: a bare declaration WITHOUT a bare `expect(` is now derived as
    // mocha (mocha-class), not unknown. The supertest-shaped fixture below moved.
    ["it('x', () => { request(app).get('/').expect(200); });", 'mocha'],
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

describe('classifyTestDeclaration characterization (Phase 6 SP1)', () => {
  const decls = (src: string): Array<ReturnType<typeof classifyTestDeclaration>> => {
    const sf = ts.createSourceFile('t.ts', src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const out: Array<ReturnType<typeof classifyTestDeclaration>> = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) out.push(classifyTestDeclaration(n.expression));
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  };
  it('direct + property chain + modifier', () => {
    expect(decls('it("a", f);')).toEqual([{ root: 'it', modifier: null }]);
    expect(decls('test.concurrent("a", f);')).toEqual([{ root: 'test', modifier: 'concurrent' }]);
    expect(decls('foo.bar("a", f);')).toEqual([null]);
  });
  it('conditional both/one/neither branch', () => {
    expect(decls('(c ? it : it)("a", f);')).toEqual([{ root: 'it', modifier: 'conditional' }]);
    expect(decls('(c ? it : other)("a", f);')).toEqual([{ root: 'it', modifier: 'conditional' }]);
    expect(decls('(c ? a : b)("a", f);')).toEqual([null]);
  });
  it('binary &&/|| both/one/neither operand', () => {
    expect(decls('(c && it)("a", f);')).toEqual([{ root: 'it', modifier: 'conditional' }]);
    expect(decls('(c || test)("a", f);')).toEqual([{ root: 'test', modifier: 'conditional' }]);
    expect(decls('(c && a)("a", f);')).toEqual([null]);
  });
  it('alias verified vs unresolved', () => {
    const aliases = new Map([['t', 'it']]);
    const sf = ts.createSourceFile('t.ts', 't("a", f);', ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    let res: ReturnType<typeof classifyTestDeclaration> = null;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) res = classifyTestDeclaration(n.expression, aliases);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(res).toEqual({ root: 'it', modifier: 'aliased' });
  });
  it('peel: call chains, tagged template, parens', () => {
    expect(decls('it.skip.only("a", f);')).toEqual([{ root: 'it', modifier: 'skip.only' }]);
    expect(decls('((it))("a", f);')).toEqual([{ root: 'it', modifier: null }]);
  });
  it('unresolved alias -> null with empty alias map', () => {
    const src = 't("a", f);';
    const sf = ts.createSourceFile('t.ts', src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    let res: ReturnType<typeof classifyTestDeclaration> | 'unset' = 'unset';
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) res = classifyTestDeclaration(n.expression, new Map<string, string>());
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(res).toBeNull();
  });
  it('tagged-template peel through calleeCore', () => {
    const peel = (src: string) => {
      const sf = ts.createSourceFile('t.ts', src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      let res: ReturnType<typeof classifyTestDeclaration> = null;
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) res = classifyTestDeclaration(n.expression);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return res;
    };
    expect(peel('it`x`("a", f);')).toEqual({ root: 'it', modifier: null });
    expect(peel('x`y`("a", f);')).toBeNull();
  });
});

describe('mocha bare-global derivation (SP2)', () => {
  const fw = (src: string) =>
    detectFramework(ts.createSourceFile('t.ts', src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS));
  it('bare describe+it without expect or imports → mocha derived', () => {
    expect(fw("describe('s', () => { it('a', () => {}); });")).toBe('mocha');
  });
  it('bare it alone → mocha derived', () => expect(fw("it('a', () => {});")).toBe('mocha'));
  it('bare declaration + bare expect stays jest-derived (unchanged)', () => {
    expect(fw("it('a', () => { expect(1).toBe(1); });")).toBe('jest');
  });
  it('imported describe blocks derivation', () => {
    expect(fw("import { describe } from '@jest/globals';\ndescribe('s', () => { it('a', () => {}); });")).toBe('jest');
  });
  it('vitest import + bare describe → vitest (MIXED semantics unchanged)', () => {
    expect(fw("import { it } from 'vitest';\ndescribe('s', () => { it('a', () => {}); });")).toBe('vitest');
  });
});

describe('supertest chain forms (SP3)', () => {
  const form = (src: string): string | null => {
    const sf = ts.createSourceFile('t.ts', src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    let out: string | null = null;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) out = classifyForm(n) ?? out;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  };
  it('request chain .expect(status) → supertest-expect-status', () => {
    expect(form("request(app).get('/').expect(201);")).toBe('supertest-expect-status');
  });
  it('request chain .expect(status, body) → supertest-expect-body', () => {
    expect(form("request(app).get('/').expect(201, 'Created');")).toBe('supertest-expect-body');
  });
  it('jest expect().toBe unaffected', () => {
    expect(form('expect(1).toBe(1);')).toBe('expect-to-be');
  });
  it('bare .expect() with no http-method chain does NOT classify as supertest', () => {
    expect(form('foo.bar.expect(1);')).toBeNull();
  });

  // Edge cases (critic C3) — guard boundaries pinned as regression tests.
  it('request(app).expect(200) with no HTTP-method segment → null', () => {
    expect(form('request(app).expect(200);')).toBeNull();
  });
  it('multi-method chain request(app).get().post().expect(200) → supertest-expect-status', () => {
    expect(form("request(app).get('/').post('/x').expect(200);")).toBe('supertest-expect-status');
  });
  it('chai.expect(foo).to.equal(bar) → null (namespace not supertest-shaped)', () => {
    expect(form('chai.expect(foo).to.equal(bar);')).toBeNull();
  });
  it('request(app).delete(...).expect() with no args → supertest-expect-status', () => {
    expect(form("request(app).delete('/x').expect();")).toBe('supertest-expect-status');
  });
  it('request(app).get().expect(200, expect(text)) → supertest-expect-body', () => {
    expect(form("request(app).get('/').expect(200, expect('text'));")).toBe('supertest-expect-body');
  });
  // C5 — tail-chained .then: argCount taken from first classified node; documents
  // collector stop-descend (one finding) semantics. Current behavior pinned.
  it('tail-chained request(...).expect(201,"x").then(cb) → supertest-expect-body (inner expect wins in form())', () => {
    expect(form("request(app).get('/').expect(201,'x').then(cb);")).toBe('supertest-expect-body');
  });
});
