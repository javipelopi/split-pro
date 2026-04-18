jest.mock('~/server/db', () => ({ db: {} }));

import { type ExpenseSummary, scoreDuplicatePair } from '../server/api/services/duplicateService';

const makeExpense = (overrides: Partial<ExpenseSummary> = {}): ExpenseSummary => ({
  id: 'a',
  name: 'Coffee',
  amount: 500n,
  currency: 'USD',
  expenseDate: new Date('2024-06-15T00:00:00Z'),
  paidBy: 1,
  groupId: 10,
  recurrenceId: null,
  ...overrides,
});

describe('scoreDuplicatePair', () => {
  describe('hard pre-filters', () => {
    it('returns 0 when currencies differ', () => {
      const a = makeExpense({ currency: 'USD' });
      const b = makeExpense({ id: 'b', currency: 'EUR' });
      expect(scoreDuplicatePair(a, b)).toBe(0);
    });

    it('returns 0 when dates differ by more than 2 days', () => {
      const a = makeExpense({ expenseDate: new Date('2024-06-15T00:00:00Z') });
      const b = makeExpense({ id: 'b', expenseDate: new Date('2024-06-18T00:01:00Z') });
      expect(scoreDuplicatePair(a, b)).toBe(0);
    });

    it('allows pairs exactly at the ±2 day boundary', () => {
      const a = makeExpense({ expenseDate: new Date('2024-06-15T00:00:00Z') });
      const b = makeExpense({ id: 'b', expenseDate: new Date('2024-06-17T00:00:00Z') });
      expect(scoreDuplicatePair(a, b)).toBeGreaterThan(0);
    });

    it('returns 0 when both share the same recurrenceId', () => {
      const a = makeExpense({ recurrenceId: 42 });
      const b = makeExpense({ id: 'b', recurrenceId: 42 });
      expect(scoreDuplicatePair(a, b)).toBe(0);
    });

    it('does not pre-filter when recurrenceIds differ', () => {
      const a = makeExpense({ recurrenceId: 1 });
      const b = makeExpense({ id: 'b', recurrenceId: 2 });
      expect(scoreDuplicatePair(a, b)).toBeGreaterThan(0);
    });

    it('does not pre-filter when one recurrenceId is null', () => {
      const a = makeExpense({ recurrenceId: 1 });
      const b = makeExpense({ id: 'b', recurrenceId: null });
      expect(scoreDuplicatePair(a, b)).toBeGreaterThan(0);
    });
  });

  describe('amount proximity scoring', () => {
    it('awards full 40 points for an exact amount match', () => {
      // Identical name, same group, same payer → 40 + 15 + 10 + 10 = 75
      const a = makeExpense({ amount: 1000n });
      const b = makeExpense({ id: 'b', amount: 1000n });
      expect(scoreDuplicatePair(a, b)).toBe(75);
    });

    it('decays linearly toward 0 at the ±10% boundary', () => {
      const a = makeExpense({ amount: 1000n });
      // maxAmt=1050, diff=50/1050≈0.0476 → 40 * (1 - 0.476) ≈ 21
      const b = makeExpense({ id: 'b', amount: 1050n });
      const score = scoreDuplicatePair(a, b);
      // 21 (amount) + 15 (group) + 10 (payer) + 10 (name) = 56
      expect(score).toBe(56);
    });

    it('awards fewer amount-points the farther apart the values are', () => {
      const a = makeExpense({ amount: 1000n });
      const close = makeExpense({ id: 'b', amount: 1010n });
      const far = makeExpense({ id: 'c', amount: 1090n });
      expect(scoreDuplicatePair(a, close)).toBeGreaterThan(scoreDuplicatePair(a, far));
    });

    it('awards 0 amount-points when the ratio is outside ±10%', () => {
      const a = makeExpense({ amount: 1000n, name: 'Lunch' });
      const b = makeExpense({ id: 'b', amount: 1200n, name: 'Lunch' });
      // 0 (amount) + 15 (group) + 10 (payer) + 10 (name) = 35
      expect(scoreDuplicatePair(a, b)).toBe(35);
    });

    it('treats both-zero amounts as an exact match', () => {
      const a = makeExpense({ amount: 0n });
      const b = makeExpense({ id: 'b', amount: 0n });
      expect(scoreDuplicatePair(a, b)).toBe(75);
    });

    it('handles negative amounts via absolute value', () => {
      const a = makeExpense({ amount: -500n });
      const b = makeExpense({ id: 'b', amount: 500n });
      expect(scoreDuplicatePair(a, b)).toBe(75);
    });
  });

  describe('group scoring', () => {
    it('awards 15 points when both share the same groupId', () => {
      const a = makeExpense({ groupId: 10, name: 'x', paidBy: 1 });
      const b = makeExpense({ id: 'b', groupId: 10, name: 'y', paidBy: 2 });
      // 40 (amount) + 15 (group) + 0 (payer) + 0 (name tokens) = 55
      expect(scoreDuplicatePair(a, b)).toBe(55);
    });

    it('does not award group points when both groupIds are null', () => {
      const a = makeExpense({ groupId: null });
      const b = makeExpense({ id: 'b', groupId: null });
      // No group bonus: 40 + 0 + 10 + 10 = 60
      expect(scoreDuplicatePair(a, b)).toBe(60);
    });

    it('does not award group points when groupIds differ', () => {
      const a = makeExpense({ groupId: 1 });
      const b = makeExpense({ id: 'b', groupId: 2 });
      expect(scoreDuplicatePair(a, b)).toBe(60);
    });
  });

  describe('payer scoring', () => {
    it('awards 10 points when payers match', () => {
      const a = makeExpense({ paidBy: 5, groupId: null, name: 'x' });
      const b = makeExpense({ id: 'b', paidBy: 5, groupId: null, name: 'y' });
      // 40 + 0 + 10 + 0 = 50
      expect(scoreDuplicatePair(a, b)).toBe(50);
    });

    it('awards 0 payer-points when payers differ', () => {
      const a = makeExpense({ paidBy: 1, groupId: null, name: 'x' });
      const b = makeExpense({ id: 'b', paidBy: 2, groupId: null, name: 'y' });
      // 40 + 0 + 0 + 0 = 40
      expect(scoreDuplicatePair(a, b)).toBe(40);
    });
  });

  describe('name similarity scoring', () => {
    const base = (name: string, id = 'a', paidBy = 1): ExpenseSummary =>
      makeExpense({ id, name, paidBy, groupId: null });

    it('awards full 10 points for identical names', () => {
      const a = base('Lunch at Joe', 'a', 1);
      const b = base('Lunch at Joe', 'b', 2);
      // 40 (amount exact) + 0 (no group) + 0 (no payer) + 10 (name) = 50
      expect(scoreDuplicatePair(a, b)).toBe(50);
    });

    it('awards 7 points when one name contains the other', () => {
      const a = base('Lunch', 'a', 1);
      const b = base('Lunch at Joe', 'b', 2);
      // 40 + 0 + 0 + 7 = 47
      expect(scoreDuplicatePair(a, b)).toBe(47);
    });

    it('is case-insensitive for name equality', () => {
      const a = base('STARBUCKS', 'a', 1);
      const b = base('starbucks', 'b', 2);
      expect(scoreDuplicatePair(a, b)).toBe(50);
    });

    it('uses Jaccard token overlap for partial matches', () => {
      const a = base('coffee beans bag', 'a', 1);
      const b = base('coffee tea bag', 'b', 2);
      // Tokens: {coffee, beans, bag} ∩ {coffee, tea, bag} = 2, union = 4 → 0.5
      // 40 + 0 + 0 + round(10 * 0.5) = 45
      expect(scoreDuplicatePair(a, b)).toBe(45);
    });

    it('awards 0 when names share no tokens', () => {
      const a = base('apple', 'a', 1);
      const b = base('zebra', 'b', 2);
      expect(scoreDuplicatePair(a, b)).toBe(40);
    });

    it('trims whitespace before comparing', () => {
      const a = base('  Coffee  ', 'a', 1);
      const b = base('Coffee', 'b', 2);
      expect(scoreDuplicatePair(a, b)).toBe(50);
    });
  });

  describe('total score composition', () => {
    it('reaches the maximum 75 when every dimension matches perfectly', () => {
      const a = makeExpense();
      const b = makeExpense({ id: 'b' });
      expect(scoreDuplicatePair(a, b)).toBe(75);
    });

    it('is below the 55-point threshold for a weak-match scenario', () => {
      const a = makeExpense({ amount: 1000n, groupId: null, paidBy: 1, name: 'foo' });
      const b = makeExpense({
        id: 'b',
        amount: 1080n, // 8% difference → 40 * (1 - 0.8) = 8
        groupId: null,
        paidBy: 2,
        name: 'bar',
      });
      // 8 + 0 + 0 + 0 = 8
      expect(scoreDuplicatePair(a, b)).toBeLessThan(55);
    });
  });
});
