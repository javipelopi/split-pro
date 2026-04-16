import {
  type ParsedExpensePayload,
  applyRowOverride,
  autoDetectMapping,
  extractMemberNames,
  filterSelectedExpenses,
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

describe('parseCSV – sep= hint line', () => {
  it('strips the sep= hint and uses the declared delimiter', () => {
    const csv = 'sep=;\nName;Amount;Date\nAlice;10.50;2024-01-01\nBob;20;2024-02-01\n';
    const { headers, rows } = parseCSV(csv);
    expect(headers).toEqual(['Name', 'Amount', 'Date']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(['Alice', '10.50', '2024-01-01']);
  });

  it('handles sep=, with comma delimiter', () => {
    const csv = 'sep=,\nName,Amount\nAlice,10\n';
    const { headers, rows } = parseCSV(csv);
    expect(headers).toEqual(['Name', 'Amount']);
    expect(rows).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    const csv = 'SEP=;\nName;Amount\nAlice;10\n';
    const { headers, rows } = parseCSV(csv);
    expect(headers).toEqual(['Name', 'Amount']);
    expect(rows).toHaveLength(1);
  });

  it('ignores sep= when it is not alone on the first line', () => {
    // "sep=;extra" is 10 chars — does not match /^sep=.$/
    const csv = 'sep=;extra\nName;Amount\n';
    const { headers } = parseCSV(csv);
    // The first line was NOT stripped, so it becomes the header
    expect(headers).not.toEqual(['Name', 'Amount']);
  });
});

describe('parseCSV – footer row filtering', () => {
  it('filters rows starting with Total', () => {
    const csv = ['Name;Amount;Date', 'Alice;10;2024-01-01', 'Total;30;'].join('\n');
    const { rows } = parseCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('Alice');
  });

  it('filters rows with Total in any field', () => {
    const csv = ['A;B;C;D;E;F', 'x;1;y;z;w;v', ';;;Total per currency;;;'].join('\n');
    const { rows } = parseCSV(csv);
    expect(rows).toHaveLength(1);
  });

  it('filters rows where the majority of fields are empty', () => {
    const csv = ['A;B;C;D;E', 'x;1;y;z;w', ';;;x;'].join('\n');
    const { rows } = parseCSV(csv);
    expect(rows).toHaveLength(1);
  });

  it('does not filter normal rows with some empty fields', () => {
    const csv = ['A;B;C', 'x;1;', 'y;2;z'].join('\n');
    const { rows } = parseCSV(csv);
    // Row "x;1;" has 1/3 empty — under 60% threshold
    expect(rows).toHaveLength(2);
  });
});

describe('Spanish bank CSV (sep= + footers)', () => {
  const BANK_CSV = [
    'sep=;',
    'Account number;Card number;Account/Cardholder;Purchase date;Booking text;Sector;Amount;Currency;Booked',
    '1234;5678;J. SMITH;15/03/2024;HOTEL ZURICH;Travel;34.42;EUR;15/03/2024',
    '1234;5678;J. SMITH;16/03/2024;SUPERMARKET;Groceries;42.10;EUR;16/03/2024',
    ';;;;Total per currency;;;;Total',
    ';;;;Total card bookings;;76.52;EUR;76.52',
  ].join('\n');

  it('parses the bank CSV: sep= stripped, footers removed', () => {
    const { headers, rows } = parseCSV(BANK_CSV);

    // Sep= line stripped; real header detected
    expect(headers[0]).toBe('Account number');
    expect(headers[6]).toBe('Amount');

    // 2 data rows; 2 footer rows filtered out
    expect(rows).toHaveLength(2);
  });
});

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

  it('marks locked on Settle Up EXACT rows and unlocked on single-payer fallback', () => {
    const settleUp = [
      '"Who paid","Amount","For whom","Split amounts"',
      '"Laura","10","Francisco;Laura","5;5"',
    ].join('\n');
    const [exactRow] = run(settleUp);
    expect(exactRow!.locked).toBe(true);

    const legacy = ['"Paid by","Amount","Purpose"', '"Laura","30","Dinner"'].join('\n');
    const { rows, mapping } = parseAndMap(legacy);
    const [equalRow] = parseRowsToExpensePayloads({
      rows,
      mapping,
      nameMapping: NAME_MAPPING,
      groupMemberIds: GROUP_MEMBER_IDS,
      defaultPayerId: FRANCISCO,
      defaultDate: DEFAULT_DATE,
      defaultCategory: 'general',
    });
    expect(equalRow!.locked).toBe(false);
  });

  it('marks multi-payer rows as locked even without Settle Up split columns', () => {
    // Multi-payer with no forWhom/splitAmounts columns falls through to the
    // Fallback EQUAL split, but the payer list came from the CSV and should
    // Stay locked.
    const csv = ['"Who paid","Amount","Purpose"', '"Francisco;Laura","15;15","Shared"'].join('\n');
    const [expense] = run(csv);
    expect(expense!.locked).toBe(true);
    expect(expense!.splitType).toBe('EQUAL');
    expect(expense!.payers).toHaveLength(2);
  });
});

describe('parseRowsToExpensePayloads defaults', () => {
  const parseWithDefaults = (
    csvText: string,
    defaults: {
      defaultDescription?: string;
      defaultAmount?: number;
      defaultSplitType?: 'DEFAULT' | 'EQUAL' | 'SPLIT' | 'SKIP';
      groupMemberWeights?: Record<number, number>;
    } = {},
  ) => {
    const { rows, mapping } = parseAndMap(csvText);
    return parseRowsToExpensePayloads({
      rows,
      mapping,
      nameMapping: NAME_MAPPING,
      groupMemberIds: GROUP_MEMBER_IDS,
      defaultPayerId: FRANCISCO,
      defaultDate: DEFAULT_DATE,
      defaultCategory: 'general',
      ...defaults,
    });
  };

  it('uses defaultDescription when the description cell is empty', () => {
    const csv = ['"Paid by","Amount","Purpose"', '"Laura","30",""'].join('\n');
    const [expense] = parseWithDefaults(csv, { defaultDescription: 'Imported' });
    expect(expense!.description).toBe('Imported');
  });

  it('uses defaultAmount when the amount cell is empty', () => {
    const csv = ['"Paid by","Amount","Purpose"', '"Laura","","Mystery"'].join('\n');
    const [expense] = parseWithDefaults(csv, { defaultAmount: 42 });
    expect(expense!.amount).toBeCloseTo(42);
    expect(expense!.description).toBe('Mystery');
  });

  it('drops rows when default amount is 0 and cell is empty', () => {
    const csv = ['"Paid by","Amount","Purpose"', '"Laura","","Zero"'].join('\n');
    expect(parseWithDefaults(csv, { defaultAmount: 0 })).toEqual([]);
  });

  it('produces EXACT splits with weighted amounts when group has non-uniform weights', () => {
    const csv = ['"Paid by","Amount","Purpose"', '"Laura","30","Dinner"'].join('\n');
    // Francisco weight=1, Laura weight=2 → total=3
    // Francisco owes 30*(1/3)=10, Laura owes 30*(2/3)=20
    const [expense] = parseWithDefaults(csv, {
      groupMemberWeights: { [FRANCISCO]: 1, [LAURA]: 2 },
    });
    expect(expense!.splitType).toBe('EXACT');
    const byId = Object.fromEntries(expense!.participants.map((p) => [p.userId, p.amount]));
    expect(byId[FRANCISCO]).toBeCloseTo(-10); // Paid 0, owed 10 → -10
    expect(byId[LAURA]).toBeCloseTo(10); // Paid 30, owed 20 → +10
  });

  it('produces EQUAL splits when group has uniform weights', () => {
    const csv = ['"Paid by","Amount","Purpose"', '"Laura","30","Dinner"'].join('\n');
    const [expense] = parseWithDefaults(csv, {
      groupMemberWeights: { [FRANCISCO]: 1, [LAURA]: 1 },
    });
    expect(expense!.splitType).toBe('EQUAL');
    const byId = Object.fromEntries(expense!.participants.map((p) => [p.userId, p.amount]));
    expect(byId[FRANCISCO]).toBeCloseTo(-15);
    expect(byId[LAURA]).toBeCloseTo(15);
  });

  it('drops fallback rows when defaultSplitType is SKIP', () => {
    // Legacy row with no forWhom/splitAmounts — must be skipped when
    // DefaultSplitType=SKIP.
    const legacy = ['"Paid by","Amount","Purpose"', '"Laura","30","Dinner"'].join('\n');
    expect(parseWithDefaults(legacy, { defaultSplitType: 'SKIP' })).toEqual([]);

    // But a row with Settle Up per-member columns should still import.
    const settleUp = [
      '"Who paid","Amount","For whom","Split amounts"',
      '"Laura","10","Francisco;Laura","5;5"',
    ].join('\n');
    expect(parseWithDefaults(settleUp, { defaultSplitType: 'SKIP' })).toHaveLength(1);
  });

  it('forces true equal split when defaultSplitType is EQUAL (ignores weights)', () => {
    const csv = ['"Paid by","Amount","Purpose"', '"Laura","30","Dinner"'].join('\n');
    // Even with non-uniform weights, EQUAL forces even split.
    const [expense] = parseWithDefaults(csv, {
      defaultSplitType: 'EQUAL',
      groupMemberWeights: { [FRANCISCO]: 1, [LAURA]: 2 },
    });
    expect(expense!.splitType).toBe('EQUAL');
    const byId = Object.fromEntries(expense!.participants.map((p) => [p.userId, p.amount]));
    expect(byId[FRANCISCO]).toBeCloseTo(-15);
    expect(byId[LAURA]).toBeCloseTo(15);
  });

  it('forces weighted EXACT split when defaultSplitType is SPLIT', () => {
    const csv = ['"Paid by","Amount","Purpose"', '"Laura","30","Dinner"'].join('\n');
    const [expense] = parseWithDefaults(csv, {
      defaultSplitType: 'SPLIT',
      groupMemberWeights: { [FRANCISCO]: 1, [LAURA]: 2 },
    });
    expect(expense!.splitType).toBe('EXACT');
    const byId = Object.fromEntries(expense!.participants.map((p) => [p.userId, p.amount]));
    // Francisco weight=1, Laura weight=2 → total=3
    expect(byId[FRANCISCO]).toBeCloseTo(-10); // Owed 10
    expect(byId[LAURA]).toBeCloseTo(10); // Paid 30, owed 20 → +10
  });

  it('SPLIT produces EXACT even with uniform weights', () => {
    const csv = ['"Paid by","Amount","Purpose"', '"Laura","30","Dinner"'].join('\n');
    const [expense] = parseWithDefaults(csv, {
      defaultSplitType: 'SPLIT',
      groupMemberWeights: { [FRANCISCO]: 1, [LAURA]: 1 },
    });
    // Even though weights are uniform, SPLIT always produces EXACT.
    expect(expense!.splitType).toBe('EXACT');
  });
});

describe('filterSelectedExpenses', () => {
  const makePayload = (amount: number): ParsedExpensePayload => ({
    description: 'e',
    amount,
    date: DEFAULT_DATE,
    category: 'general',
    paidBy: FRANCISCO,
    payers: [],
    participants: [
      { userId: FRANCISCO, amount },
      { userId: LAURA, amount: -amount },
    ],
    splitType: 'EQUAL',
    amountMismatch: false,
    isIncome: false,
    locked: false,
  });

  it('returns only the selected rows in stable order', () => {
    const expenses = [makePayload(1), makePayload(2), makePayload(3), makePayload(4)];
    const result = filterSelectedExpenses(expenses, new Set([0, 2]));
    expect(result).toHaveLength(2);
    expect(result[0]!.amount).toBe(1);
    expect(result[1]!.amount).toBe(3);
  });

  it('returns an empty array when nothing is selected', () => {
    const expenses = [makePayload(1), makePayload(2)];
    expect(filterSelectedExpenses(expenses, new Set())).toEqual([]);
  });

  it('returns all rows when everything is selected', () => {
    const expenses = [makePayload(1), makePayload(2)];
    expect(filterSelectedExpenses(expenses, new Set([0, 1]))).toEqual(expenses);
  });
});

describe('applyRowOverride', () => {
  const baseUnlocked: ParsedExpensePayload = {
    description: 'Coffee',
    amount: 10,
    date: DEFAULT_DATE,
    category: 'food',
    paidBy: LAURA,
    payers: [],
    participants: [
      { userId: LAURA, amount: 5 },
      { userId: FRANCISCO, amount: -5 },
    ],
    splitType: 'EQUAL',
    amountMismatch: false,
    isIncome: false,
    locked: false,
  };

  it('applies description/date/category/isIncome overrides without touching participants', () => {
    const updated = applyRowOverride(
      baseUnlocked,
      { description: 'Tea', category: 'drinks', isIncome: true },
      GROUP_MEMBER_IDS,
    );
    expect(updated.description).toBe('Tea');
    expect(updated.category).toBe('drinks');
    expect(updated.isIncome).toBe(true);
    // Amount unchanged → participants unchanged.
    const byId = Object.fromEntries(updated.participants.map((p) => [p.userId, p.amount]));
    expect(byId[LAURA]).toBeCloseTo(5);
    expect(byId[FRANCISCO]).toBeCloseTo(-5);
  });

  it('recomputes EQUAL participants when the amount changes on an unlocked row', () => {
    const updated = applyRowOverride(baseUnlocked, { amount: 40 }, GROUP_MEMBER_IDS);
    const byId = Object.fromEntries(updated.participants.map((p) => [p.userId, p.amount]));
    expect(updated.amount).toBe(40);
    // Laura (payer) +20, Francisco -20.
    expect(byId[LAURA]).toBeCloseTo(20);
    expect(byId[FRANCISCO]).toBeCloseTo(-20);
  });

  it('recomputes EQUAL participants when the payer changes on an unlocked row', () => {
    const updated = applyRowOverride(baseUnlocked, { paidBy: FRANCISCO }, GROUP_MEMBER_IDS);
    const byId = Object.fromEntries(updated.participants.map((p) => [p.userId, p.amount]));
    expect(updated.paidBy).toBe(FRANCISCO);
    expect(byId[FRANCISCO]).toBeCloseTo(5);
    expect(byId[LAURA]).toBeCloseTo(-5);
  });

  it('preserves participants on locked Settle Up EXACT rows even when amount/payer change', () => {
    const locked: ParsedExpensePayload = {
      ...baseUnlocked,
      splitType: 'EXACT',
      participants: [
        { userId: LAURA, amount: 9.67 },
        { userId: FRANCISCO, amount: -9.67 },
      ],
      locked: true,
    };
    const updated = applyRowOverride(locked, { amount: 999, paidBy: FRANCISCO }, GROUP_MEMBER_IDS);
    expect(updated.amount).toBe(999);
    expect(updated.paidBy).toBe(FRANCISCO);
    // Participants untouched.
    expect(updated.participants).toEqual(locked.participants);
  });
});
