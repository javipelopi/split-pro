import {
  autoDetectMapping,
  extractMemberNames,
  parseCSV,
  parseRowsToExpensePayloads,
} from '../lib/csv';

/**
 * Tests for Settle Up CSV import parsing. The goal is to validate that a
 * hand-crafted CSV matching the Settle Up export format produces the
 * expected payload with correct payers, participants, and sign convention
 * (`participant.amount = paid - owed`).
 */

const FRANCISCO = 1;
const LAURA = 2;
const NAME_MAPPING = { Francisco: FRANCISCO, Laura: LAURA };
const GROUP_MEMBER_IDS = [FRANCISCO, LAURA];
const DEFAULT_DATE = new Date('2024-01-01T00:00:00Z');

const parseAndMap = (csvText: string) => {
  const { headers, rows } = parseCSV(csvText);
  const mapping = autoDetectMapping(headers);
  return { headers, rows, mapping };
};

describe('autoDetectMapping (Settle Up format)', () => {
  it('detects all Settle Up columns from real export headers', () => {
    const headers = [
      'Who paid',
      'Amount',
      'Currency',
      'For whom',
      'Split amounts',
      'Purpose',
      'Category',
      'Date & time',
      'Timezone',
      'Exchange rate',
      'Converted amount',
      'Type',
      'Receipt',
    ];
    const mapping = autoDetectMapping(headers);

    expect(mapping.payer).toBe(0);
    expect(mapping.amount).toBe(1);
    expect(mapping.forWhom).toBe(3);
    expect(mapping.splitAmounts).toBe(4);
    expect(mapping.description).toBe(5);
    expect(mapping.category).toBe(6);
    expect(mapping.date).toBe(7);
    expect(mapping.type).toBe(11);
  });

  it('does not confuse "Amount" with "Converted amount"', () => {
    const headers = ['Who paid', 'Amount', 'Converted amount'];
    const mapping = autoDetectMapping(headers);
    expect(mapping.amount).toBe(1);
  });
});

describe('extractMemberNames', () => {
  it('extracts semicolon-separated names from both payer and forWhom columns', () => {
    const { rows, mapping } = parseAndMap(
      [
        '"Who paid","Amount","For whom","Split amounts","Type"',
        '"Laura","10","Francisco;Laura","6;4","expense"',
        '"Francisco;Laura","5;5","Francisco;Laura","5;5","expense"',
      ].join('\n'),
    );
    expect(extractMemberNames(rows, mapping)).toEqual(['Francisco', 'Laura']);
  });
});

describe('parseRowsToExpensePayloads', () => {
  const run = (csvText: string) => {
    const { rows, mapping } = parseAndMap(csvText);
    return parseRowsToExpensePayloads({
      rows,
      mapping,
      nameMapping: NAME_MAPPING,
      groupMemberIds: GROUP_MEMBER_IDS,
      defaultPayerId: FRANCISCO,
      defaultDate: DEFAULT_DATE,
      defaultCategory: 'general',
    });
  };

  it('parses a single-payer Settle Up row as EXACT split', () => {
    const csv = [
      '"Who paid","Amount","For whom","Split amounts","Purpose","Type"',
      '"Laura","16.7","Francisco;Laura","9.67;7.03","LIDL","expense"',
    ].join('\n');
    const [expense] = run(csv);

    expect(expense).toBeDefined();
    expect(expense!.description).toBe('LIDL');
    expect(expense!.amount).toBeCloseTo(16.7);
    expect(expense!.paidBy).toBe(LAURA);
    expect(expense!.splitType).toBe('EXACT');
    expect(expense!.payers).toEqual([]); // Single payer → no payers array
    expect(expense!.isIncome).toBe(false);
    expect(expense!.amountMismatch).toBe(false);

    // Laura paid 16.7, owed 7.03 → +9.67.
    // Francisco paid 0, owed 9.67 → -9.67.
    const byId = Object.fromEntries(expense!.participants.map((p) => [p.userId, p.amount]));
    expect(byId[LAURA]).toBeCloseTo(9.67);
    expect(byId[FRANCISCO]).toBeCloseTo(-9.67);
  });

  it('parses a multi-payer Settle Up row with parallel payer amounts', () => {
    // Francisco paid 15, Laura paid 15. Francisco owes 17.37, Laura owes 12.63.
    // Net: Francisco -2.37 (debtor), Laura +2.37 (creditor).
    const csv = [
      '"Who paid","Amount","For whom","Split amounts","Purpose","Type"',
      '"Francisco;Laura","15;15","Francisco;Laura","17.37;12.63","Lavadoras","expense"',
    ].join('\n');
    const [expense] = run(csv);

    expect(expense).toBeDefined();
    expect(expense!.amount).toBeCloseTo(30);
    expect(expense!.splitType).toBe('EXACT');
    expect(expense!.payers).toHaveLength(2);
    expect(expense!.payers).toEqual(
      expect.arrayContaining([
        { userId: FRANCISCO, amount: 15 },
        { userId: LAURA, amount: 15 },
      ]),
    );

    const byId = Object.fromEntries(expense!.participants.map((p) => [p.userId, p.amount]));
    expect(byId[FRANCISCO]).toBeCloseTo(-2.37);
    expect(byId[LAURA]).toBeCloseTo(2.37);
  });

  it('flags a mismatch when the paid total differs from the owed total', () => {
    // Laura paid 10, but split amounts only add to 9.
    const csv = [
      '"Who paid","Amount","For whom","Split amounts","Type"',
      '"Laura","10","Francisco;Laura","5;4","expense"',
    ].join('\n');
    const [expense] = run(csv);
    expect(expense!.amountMismatch).toBe(true);
  });

  it('marks income rows with isIncome and keeps amount positive', () => {
    // Settle Up income rows use negative numbers. The parser should expose
    // A positive amount + isIncome=true so the caller can flip the sign.
    const csv = [
      '"Who paid","Amount","For whom","Split amounts","Type"',
      '"Laura","-263","Francisco;Laura","-152.25;-110.75","income"',
    ].join('\n');
    const [expense] = run(csv);

    expect(expense!.isIncome).toBe(true);
    expect(expense!.amount).toBeCloseTo(263);
    expect(expense!.splitType).toBe('EXACT');

    const byId = Object.fromEntries(expense!.participants.map((p) => [p.userId, p.amount]));
    // Laura paid 263 (abs), owed 110.75 → +152.25.
    expect(byId[LAURA]).toBeCloseTo(152.25);
    expect(byId[FRANCISCO]).toBeCloseTo(-152.25);
  });

  it('produces a SETTLEMENT payload for transfer rows', () => {
    // Francisco paid 4940.55 to Laura (settling a debt).
    const csv = [
      '"Who paid","Amount","For whom","Split amounts","Purpose","Type"',
      '"Francisco","4940.55","Laura","4940.55","Pago de deudas","transfer"',
    ].join('\n');
    const [expense] = run(csv);

    expect(expense).toBeDefined();
    expect(expense!.splitType).toBe('SETTLEMENT');
    expect(expense!.paidBy).toBe(FRANCISCO);
    expect(expense!.amount).toBeCloseTo(4940.55);
    expect(expense!.amountMismatch).toBe(false);

    // Settlement sign convention (from useSettlement): payer positive, receiver negative.
    const byId = Object.fromEntries(expense!.participants.map((p) => [p.userId, p.amount]));
    expect(byId[FRANCISCO]).toBeCloseTo(4940.55);
    expect(byId[LAURA]).toBeCloseTo(-4940.55);
  });

  it('falls back to the default payer when the CSV payer name is unmapped', () => {
    const csv = [
      '"Who paid","Amount","For whom","Split amounts","Type"',
      '"Unknown","10","Francisco;Laura","5;5","expense"',
    ].join('\n');
    const results = run(csv);

    // Unknown payer falls back to defaultPayerId (FRANCISCO). The EXACT
    // Split via forWhom + splitAmounts still applies since both are mapped.
    expect(results).toHaveLength(1);
    expect(results[0]!.paidBy).toBe(FRANCISCO);
    expect(results[0]!.splitType).toBe('EXACT');
  });

  it('falls back to EQUAL split among all group members when no forWhom mapped', () => {
    // Legacy CSV: just payer + amount, no per-member columns.
    const csv = ['"Paid by","Amount","Purpose"', '"Laura","30","Dinner"'].join('\n');
    const { rows, mapping } = parseAndMap(csv);
    const [expense] = parseRowsToExpensePayloads({
      rows,
      mapping,
      nameMapping: NAME_MAPPING,
      groupMemberIds: GROUP_MEMBER_IDS,
      defaultPayerId: FRANCISCO,
      defaultDate: DEFAULT_DATE,
      defaultCategory: 'general',
    });

    expect(expense!.splitType).toBe('EQUAL');
    expect(expense!.paidBy).toBe(LAURA);
    // Canonical sign convention: payer positive, non-payer negative.
    const byId = Object.fromEntries(expense!.participants.map((p) => [p.userId, p.amount]));
    expect(byId[LAURA]).toBeCloseTo(15); // Paid 30, owed 15 → +15
    expect(byId[FRANCISCO]).toBeCloseTo(-15); // Paid 0, owed 15 → -15
  });

  it('returns an empty array when no amount column is mapped', () => {
    const csv = ['"Purpose","Date"', '"Lunch","2024-01-01"'].join('\n');
    expect(run(csv)).toEqual([]);
  });
});
