// Case 20 — unresolved-body (`it('name', helperFn)`).
// The body argument is an identifier reference, not an inline function, so the
// collector cannot resolve or scan it -> gap 'unresolved-body' -> PARTIAL / UNKNOWN.
//
// INPUT to collectAnalysis / the CLI — not executed by jest
// (jest.config.js testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it } from '@jest/globals';

const helperFn = () => {
  expect(1).toBe(1);
};

it('unresolved-body', helperFn);
