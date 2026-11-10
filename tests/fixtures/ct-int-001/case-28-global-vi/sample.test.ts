// Case 28 — global `vi` usage with no vitest import (Option A, 2026-11-02).
//
// Vitest with `globals: true` exposes `vi` on the global scope, so a member call
// `vi.<name>(...)` is a Vitest runtime signal even when the file has no vitest
// import declaration. INPUT to collectAnalysis — not executed by jest
// (testPathIgnorePatterns) and not typechecked (tsconfig exclude).
describe('generic-container auto cleanup', () => {
  it('mocks the cleanup module', () => {
    const onExit = vi.fn();
    vi.mock('./cleanup', () => ({ cleanup: onExit }));
    expect(1 + 1).toBe(2);
  });
});
