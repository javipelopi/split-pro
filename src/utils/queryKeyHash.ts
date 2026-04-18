/**
 * Query-key hash function for React Query / tRPC.
 *
 * React Query's default hashKey uses JSON.stringify, which throws on BigInt.
 * tRPC puts procedure inputs into the queryKey verbatim, so any procedure with
 * a BigInt input (e.g. findDuplicates amount) crashes the page on render.
 *
 * This replacement:
 *   - stringifies BigInt values as `${val}n`
 *   - stably sorts plain-object keys so `{a, b}` and `{b, a}` hash the same
 *   - leaves arrays, primitives, null, and class instances untouched
 */
const isPlainObject = (val: unknown): val is Record<string, unknown> => {
  if (null === val || 'object' !== typeof val || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return null === proto || Object.prototype === proto;
};

export const queryKeyHashFn = (queryKey: unknown): string =>
  JSON.stringify(queryKey, (_, val) => {
    if ('bigint' === typeof val) {
      return `${val}n`;
    }
    if (isPlainObject(val)) {
      return Object.keys(val)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = val[k];
          return acc;
        }, {});
    }
    return val;
  });
