// Case 40 — supertest/superagent fluent assertion chains (express corpus
// shape). Post-SP3: chains classify as supertest-expect-* forms.
describe('supertest chains', function () {
  it('status assertion chain', function (done) {
    request(app).get('/').expect(201, done);
  });
  it('body assertion chain', function (done) {
    request(app).post('/').expect(201, 'Created', done);
  });
});
