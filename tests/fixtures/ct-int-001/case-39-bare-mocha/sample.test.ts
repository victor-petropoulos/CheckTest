// Case 39 — bare mocha-class declarations WITHOUT a bare expect(...) call.
// Post-SP2: framework derives 'mocha', file is analyzable; assertions live
// in the unsupported `assert` namespace (UNKNOWN count, never a false zero).
// Companion to case-30 (the pre-SP2 UNSUPPORTED floor, same shape).
describe('bare mocha file', function () {
  it('counts one', function () {
    assert.strictEqual(1, 1);
  });
  it('counts two', function () {});
});
