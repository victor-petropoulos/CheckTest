// Case 59 — supertest NEAR-MISS (C2/S TDD RED guard, 2026-11-22).
//
// C2 ruling 2026-11-22 (c2-council-notes.md:37): the NEW near-miss false
// fixture. A local variable whose initializer chain carries NO HTTP verb from
// SUPERTEST_HTTP_METHODS ['get','post','put','patch','delete','head',
// 'options'] must STAY unrecognized after the S seam lands binding
// resolution — an expect-call alone never becomes a supertest assertion.
//
//   const helper = makeThing();   // initializer chain has no verb
//   helper.expect(413);          // must remain unrecognized
//
// This mirrors case-56's pre-fix honesty: a genuinely zero-recognized-
// assertion test under a COMPLETE scan is a proved zero, KNOWN/DIRECT/
// COMPLETE, and CT-INT-001 FAILes. The jest import pins the framework as an
// OBSERVED runtime import (never DERIVED), so the record carries no reason.
//
// INPUT to collectAnalysis — never executed by jest (jest.config
// testPathIgnorePatterns) and never typechecked (tsconfig exclude).
import { it } from '@jest/globals';

/** Factory returning an object with an `expect` method — NO HTTP verb anywhere. */
const makeThing = () => ({
  set: (_h: string) => {},
  expect: (_c: number, _cb?: any) => {},
});

/** The real test declaration — its body is scanned normally. */
it('helper expect is not a supertest assertion', () => {
  const helper = makeThing();
  helper.set('Content-Type');
  helper.expect(413);
});
