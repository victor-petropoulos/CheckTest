/**
 * Toolchain sanity check (plan task 1).
 *
 * Its only job is to keep at least one compilable .ts input in the project so
 * `tsc` does not fail with TS18003 ("No inputs were found") while src/ and the
 * real suites land in later tasks. Delete once task 2 adds a real test file.
 */
describe('toolchain', () => {
  it('compiles and runs TypeScript through ts-jest', () => {
    const value: number = 1 + 1;
    expect(value).toBe(2);
  });
});
