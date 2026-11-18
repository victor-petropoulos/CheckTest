test('straight line plus callback', () => {
  expect(1).toBe(1);
  [1].forEach(() => expect(2).toBe(2));
});
