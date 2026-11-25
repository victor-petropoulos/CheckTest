// Case 56 — supertest LOCAL-VAR false positive (T13 RED fixture; T14 GREEN guard).
//
// Express corpus shape (checktest-corpus/express/test/express.json.js:135-141):
//   var test = request(app).post('/')   // a LOCAL variable named `test`
//   test.set('Content-Type', ...)       // supertest-chain calls, NOT declarations
//   test.write('{"str":')
//   test.expect(413, done)
//
// The local binding `test` shadows the global test-root name, so
// classifyPropertyChainCallee accepts `test.set`/`test.write`/`test.expect` as
// test declarations on NAME alone and pushes phantom declaration sites (the
// 96-row 'other-declaration-gap' bucket, B-census-external-notes.md:164; the
// reason it emits is verbatim at :174). Post-guard (T12 design = the
// collectTestShadows whole-file VariableDeclaration binding set) the shadowed
// root is NOT a declaration, so the real `it` body is scanned normally and NO
// phantom declaration is reported.
//
// The jest import pins the framework as an OBSERVED runtime import (never
// DERIVED), so the post-guard file-level record carries no reason at all
// (reason_contains: [] asserts its absence — today the phantom declaration
// list is what defines it; that is the RED).
//
// INPUT to collectAnalysis — never executed by jest (jest.config
// testPathIgnorePatterns) and never typechecked (tsconfig exclude).
import { it } from '@jest/globals';

/** Fake supertest request chain: keeps the fixture analyzable, no import needed. */
const req = (app: any) => ({
  post: (p: string) => ({
    set: (_h: string) => {},
    write: (_b: string) => {},
    expect: (_c: number, _cb?: any) => {},
    end: () => {},
  }),
});

/** The real test declaration — its body is scanned normally. */
it('rejects too large body', () => {
  const app = {};
  const test = req(app).post('/');
  test.set('Content-Type');
  test.write('{}');
  test.expect(413);
});

/** Top-level mirror of the express pattern, outside any it (file-level guard). */
const t2 = req(1).post('/x');
t2.set('a');
