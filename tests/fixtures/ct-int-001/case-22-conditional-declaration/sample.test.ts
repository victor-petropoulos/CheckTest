// Case 22 — conditional test declaration, `(cond ? it.skip : it)(name, fn)`.
// WP3.4 defect 1 (apollo-server index.test.ts:901). The callee is a
// ConditionalExpression; classifyTestDeclaration REPORTS it with a
// 'conditional' gap — never a silent drop. Per-test record has no value and
// availability UNKNOWN; CT-INT-001 yields INDETERMINATE via the completeness
// gate, because which declaration runs cannot be established statically.
//
// INPUT to collectAnalysis / the CLI — not executed by jest
// (jest.config.js testPathIgnorePatterns) and not typechecked (tsconfig exclude).
import { expect, it } from '@jest/globals';

(process.env.X ? it.skip : it)('maybe', () => {
  expect(1).toBe(1);
});
