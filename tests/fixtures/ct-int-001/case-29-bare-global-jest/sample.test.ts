// Case 29 — bare-global Jest shape (P1.3).
//
// The file declares tests with bare `it`/`test`/`expect` globals and imports NO
// framework. detectFramework derives `jest` from the bare-global shape
// (Provenance.DERIVED), the collector publishes framework_detection: PARTIAL and
// an evidence reason naming the derivation, and the analysis is SUCCESS.
//
// Bare globals cannot distinguish jest from mocha/chai/jasmine, so the derived
// label is a documented inference, not proof (docs/limitations.md §4).
//
// INPUT to collectAnalysis — not executed by jest (jest.config.js
// testPathIgnorePatterns) and not typechecked (tsconfig exclude).
describe('bare-global suite', () => {
  it('verifies an observable outcome', () => {
    expect(1 + 1).toBe(2);
  });

  test('verifies quality', () => {
    expect('a').toEqual('a');
  });
});
