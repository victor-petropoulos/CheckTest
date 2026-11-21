import { describe, it, expect } from 'vitest';
describe('outer', () => {
  describe('inner', () => {
    it('first nested', () => {
      expect(1).toBe(1);
    });
    it('second nested', () => {
      expect(2).toBe(2);
    });
  });
});
