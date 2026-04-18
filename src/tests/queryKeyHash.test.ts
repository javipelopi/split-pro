import { queryKeyHashFn } from '../utils/queryKeyHash';

describe('queryKeyHashFn', () => {
  describe('BigInt serialization', () => {
    it('serializes a top-level BigInt as "<n>n"', () => {
      expect(queryKeyHashFn(10n)).toBe('"10n"');
    });

    it('serializes nested BigInt values without throwing', () => {
      const key = ['findDuplicates', { amount: 12345n, currency: 'USD' }];
      expect(() => queryKeyHashFn(key)).not.toThrow();
      const hashed = queryKeyHashFn(key);
      expect(hashed).toContain('"12345n"');
      expect(hashed).toContain('USD');
    });

    it('distinguishes BigInt from numeric string with same digits', () => {
      // The suffix `n` ensures BigInt 10 and string "10" don't collide.
      expect(queryKeyHashFn(10n)).not.toBe(queryKeyHashFn('10'));
    });

    it('distinguishes BigInt from plain number with same value', () => {
      expect(queryKeyHashFn(10n)).not.toBe(queryKeyHashFn(10));
    });

    it('preserves BigInt precision beyond Number.MAX_SAFE_INTEGER', () => {
      const huge = 9007199254740993n; // MAX_SAFE_INTEGER + 2
      expect(queryKeyHashFn(huge)).toBe(`"${huge}n"`);
    });

    it('handles negative BigInt', () => {
      expect(queryKeyHashFn(-42n)).toBe('"-42n"');
    });
  });

  describe('stable key ordering', () => {
    it('hashes {a, b} and {b, a} identically', () => {
      expect(queryKeyHashFn({ a: 1, b: 2 })).toBe(queryKeyHashFn({ b: 2, a: 1 }));
    });

    it('is stable across deeply nested plain objects', () => {
      const h1 = queryKeyHashFn({ outer: { z: 1, a: 2 }, inner: [{ y: 1, x: 2 }] });
      const h2 = queryKeyHashFn({ inner: [{ x: 2, y: 1 }], outer: { a: 2, z: 1 } });
      expect(h1).toBe(h2);
    });

    it('preserves array order (arrays are not sorted)', () => {
      expect(queryKeyHashFn([1, 2, 3])).not.toBe(queryKeyHashFn([3, 2, 1]));
    });
  });

  describe('primitives and edge cases', () => {
    it('serializes null', () => {
      expect(queryKeyHashFn(null)).toBe('null');
    });

    it('drops undefined values inside objects', () => {
      // JSON.stringify drops undefined; preserve that behavior.
      expect(queryKeyHashFn({ a: 1, b: undefined })).toBe('{"a":1}');
    });

    it('returns undefined for a bare undefined queryKey', () => {
      expect(queryKeyHashFn(undefined)).toBeUndefined();
    });

    it('serializes booleans and numbers', () => {
      expect(queryKeyHashFn(true)).toBe('true');
      expect(queryKeyHashFn(3.14)).toBe('3.14');
    });

    it('serializes empty objects and arrays', () => {
      expect(queryKeyHashFn({})).toBe('{}');
      expect(queryKeyHashFn([])).toBe('[]');
    });
  });

  describe('tRPC-shaped keys', () => {
    it('hashes a typical tRPC query key with BigInt input', () => {
      const key = [
        ['expense', 'findDuplicates'],
        { input: { amount: 9999n, currency: 'EUR' }, type: 'query' },
      ];
      const result = queryKeyHashFn(key);
      expect(result).toContain('expense');
      expect(result).toContain('findDuplicates');
      expect(result).toContain('"9999n"');
    });

    it('produces distinct hashes for queries with different BigInt amounts', () => {
      const key1 = [['expense', 'find'], { amount: 100n }];
      const key2 = [['expense', 'find'], { amount: 200n }];
      expect(queryKeyHashFn(key1)).not.toBe(queryKeyHashFn(key2));
    });
  });
});
