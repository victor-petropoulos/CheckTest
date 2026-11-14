import { intersectLines, lineCount, toLineSet } from '../../src/core/coverage-math';

describe('lineCount (countCoveredLines semantics)', () => {
  it('non-array input yields 0', () => {
    expect(lineCount(null)).toBe(0);
    expect(lineCount(undefined)).toBe(0);
    expect(lineCount('1,1')).toBe(0);
    expect(lineCount({})).toBe(0);
    expect(lineCount(42)).toBe(0);
  });

  it('null-entried array counts the 1s', () => {
    expect(lineCount([null, 1, 1])).toBe(2);
    expect(lineCount([null, 1, 0])).toBe(1);
    expect(lineCount([null, 0])).toBe(0);
    expect(lineCount([null, 'a'])).toBe(0);
  });

  it('array with non-numeric non-null entries yields 0', () => {
    expect(lineCount(['a', 'b'])).toBe(0);
    expect(lineCount([1, 'a'])).toBe(0);
  });

  it('empty array yields 0', () => {
    expect(lineCount([])).toBe(0);
  });

  it('sparse array with max > 1 counts every entry', () => {
    expect(lineCount([2, 1])).toBe(2);
    expect(lineCount([0, 2, 1])).toBe(3);
    expect(lineCount([3])).toBe(1);
    expect(lineCount([1, 2])).toBe(2);
  });

  it('dense 0/1 array counts the 1s', () => {
    expect(lineCount([1, 0, 1])).toBe(2);
    expect(lineCount([0, 0])).toBe(0);
    expect(lineCount([1, 1])).toBe(2);
    expect(lineCount([1])).toBe(1);
  });
});

describe('toLineSet', () => {
  it('number array becomes a Set of its members', () => {
    expect(toLineSet([2, 4])).toEqual(new Set([2, 4]));
    expect(toLineSet([])).toEqual(new Set());
  });

  it('duplicate members collapse', () => {
    expect(toLineSet([1, 2, 2])).toEqual(new Set([1, 2]));
  });

  it('anything else is null', () => {
    expect(toLineSet(null)).toBeNull();
    expect(toLineSet(undefined)).toBeNull();
    expect(toLineSet('1,2')).toBeNull();
    expect(toLineSet({})).toBeNull();
    expect(toLineSet([1, 'a'])).toBeNull();
    expect(toLineSet([null, 1])).toBeNull();
  });
});

describe('intersectLines', () => {
  it('counts members within the inclusive span', () => {
    expect(intersectLines(new Set([2, 4, 7]), 2, 4)).toBe(2);
    expect(intersectLines(new Set([2, 4]), 2, 4)).toBe(2);
    expect(intersectLines(new Set([1, 2, 3, 4, 5]), 2, 4)).toBe(3);
    expect(intersectLines(new Set([1]), 1, 1)).toBe(1);
  });

  it('null set yields 0', () => {
    expect(intersectLines(null, 0, 9)).toBe(0);
  });

  it('empty set or disjoint span yields 0', () => {
    expect(intersectLines(new Set(), 1, 5)).toBe(0);
    expect(intersectLines(new Set([1, 2, 3]), 5, 9)).toBe(0);
  });
});
