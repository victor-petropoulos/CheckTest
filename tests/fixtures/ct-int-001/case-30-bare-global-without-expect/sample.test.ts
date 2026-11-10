// Case 30 — bare declarations WITHOUT a bare `expect(...)` call (P1.3 floor).
//
// The express/supertest shape: bare `describe`/`it` declarations whose only
// "expectation" is a fluent `.expect(200)` property on the request chain — NOT
// the bare `expect(...)` global. The assertions may live in an API the collector
// cannot see, so a zero count could not be proved; detectFramework derives
// nothing → UNKNOWN_FRAMEWORK → UNSUPPORTED (never a false zero-assertion FAIL).
//
// INPUT to collectAnalysis — not executed by jest (jest.config.js
// testPathIgnorePatterns) and not typechecked (tsconfig exclude).
describe('sendStatus', () => {
  it('responds with 404', () => {
    return request(app).get('/').expect(404);
  });
});
