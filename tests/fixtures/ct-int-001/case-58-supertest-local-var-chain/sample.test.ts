// Case 58 — supertest local-var chain, TRUE case (C2/S TDD RED, 2026-11-22).
//
// Same shape as case-56 (checktest-corpus/express/test/express.json.js:135-141):
//   const test = req(app).post('/')   // a LOCAL variable named `test`
//   test.set('Content-Type', ...)     // supertest-chain calls, NOT declarations
//   test.expect(413, done)
//
// C2 ruling 2026-11-22 (c2-council-notes.md:35-37,55): under binding
// resolution (verb-in-initializer test) this is the TRUE case, not the
// near-miss. The initializer chain `req(app).post('/')` DOES carry an HTTP
// verb from SUPERTEST_HTTP_METHODS, so the S seam (isSupertestChain binding
// resolution in src/adapters/typescript/support.ts:378-393) must recognize
// `test.expect(413)` as a supertest status assertion.
//
// The jest import pins the framework as an OBSERVED runtime import (never
// DERIVED), so the file-level record carries no reason at all (case-56
// pattern) — with recognition landed, the record is KNOWN/DIRECT/COMPLETE
// and CT-INT-001 PASSes.
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
  test.expect(413);
});
