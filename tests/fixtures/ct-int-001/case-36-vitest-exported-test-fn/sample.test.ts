// Case 36 — vitest gap: exported test function (collector only walks CallExpression).
import { expect } from '@jest/globals';

export function testFoo() {
  expect(1 + 1).toBe(2);
}
