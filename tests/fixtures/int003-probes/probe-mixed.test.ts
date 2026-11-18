test('established scope', () => {
  expect(10).toBe(10);
});

test('unestablished scope', () => {
  [1].forEach(() => expect(20).toBe(20));
});
