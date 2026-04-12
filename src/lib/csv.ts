export interface ParsedCSV {
  headers: string[];
  rows: string[][];
}

const detectDelimiter = (firstLine: string): string => {
  const candidates = [',', ';', '\t', '|'] as const;
  let bestDelimiter = ',';
  let maxCount = 0;

  candidates.forEach((d) => {
    const count = firstLine.split(d).length - 1;
    if (count > maxCount) {
      maxCount = count;
      bestDelimiter = d;
    }
  });

  return bestDelimiter;
};

const parseCSVLine = (line: string, delimiter: string): string[] => {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;

    if (inQuotes) {
      if ('"' === char) {
        if (i + 1 < line.length && '"' === line[i + 1]) {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if ('"' === char) {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
};

/**
 * Detect and strip an Excel-style `sep=X` hint line that some European bank
 * exports prepend.  When present the character after `=` is the delimiter and
 * the hint line itself is not a data/header row.
 */
const extractSepHint = (lines: string[]): { delimiter: string | null; remaining: string[] } => {
  if (lines.length > 0 && /^sep=.$/i.test(lines[0]!)) {
    return { delimiter: lines[0]!.charAt(4), remaining: lines.slice(1) };
  }
  return { delimiter: null, remaining: lines };
};

/**
 * Return `true` for footer / summary rows that should not be treated as data.
 * Matches rows where any non-empty cell starts with "Total" (case-insensitive)
 * as well as rows where the vast majority of cells are blank.
 */
const isFooterRow = (fields: string[]): boolean => {
  if (0 === fields.length) {
    return true;
  }

  const emptyCount = fields.filter((f) => '' === f.trim()).length;
  if (emptyCount > fields.length * 0.6) {
    return true;
  }

  return fields.some((f) => /^total\b/i.test(f.trim()));
};

export const parseCSV = (text: string): ParsedCSV => {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let lines = normalized.split('\n').filter((line) => '' !== line.trim());

  if (0 === lines.length) {
    return { headers: [], rows: [] };
  }

  // Strip an optional sep= hint line and use the declared delimiter.
  const { delimiter: hintDelimiter, remaining } = extractSepHint(lines);
  lines = remaining;

  if (0 === lines.length) {
    return { headers: [], rows: [] };
  }

  const delimiter = hintDelimiter ?? detectDelimiter(lines[0]!);
  const headers = parseCSVLine(lines[0]!, delimiter);
  const rows = lines
    .slice(1)
    .map((line) => parseCSVLine(line, delimiter))
    .filter((fields) => !isFooterRow(fields));

  return { headers, rows };
};

/**
 * Detect encoding from a Byte-Order Mark and return the name to pass to
 * FileReader / TextDecoder. Settle Up exports UTF-16 LE CSVs so we need to
 * handle that in addition to UTF-8.
 */
const detectEncodingFromBOM = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && 0xff === bytes[0] && 0xfe === bytes[1]) {
    return 'utf-16le';
  }
  if (bytes.length >= 2 && 0xfe === bytes[0] && 0xff === bytes[1]) {
    return 'utf-16be';
  }
  return 'utf-8';
};

export const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => {
      const buffer = reader.result;
      if (!(buffer instanceof ArrayBuffer)) {
        reject(new Error('Failed to read file as ArrayBuffer'));
        return;
      }
      const encoding = detectEncodingFromBOM(buffer);
      try {
        const text = new TextDecoder(encoding).decode(buffer);
        resolve(text);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to decode file'));
      }
    };
    reader.readAsArrayBuffer(file);
  });

const DATE_FORMATS = [
  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  { regex: /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/, order: 'dmy' },
  // YYYY-MM-DD, YYYY/MM/DD
  { regex: /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/, order: 'ymd' },
  // MM/DD/YYYY (US format - try after DD/MM/YYYY)
  { regex: /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/, order: 'mdy' },
] as const;

export const parseDate = (value: string, preferDMY = true): Date | null => {
  if ('' === value.trim()) {
    return null;
  }

  // Try ISO format first
  const isoDate = new Date(value);
  if (!isNaN(isoDate.getTime()) && value.includes('T')) {
    return isoDate;
  }

  const formats = preferDMY ? DATE_FORMATS : [...DATE_FORMATS].reverse();

  for (const { regex, order } of formats) {
    const match = value.trim().match(regex);
    if (!match) {
      // oxlint-disable-next-line no-continue
      continue;
    }

    let year = 0;
    let month = 0;
    let day = 0;
    if ('dmy' === order) {
      day = parseInt(match[1]!, 10);
      month = parseInt(match[2]!, 10);
      year = parseInt(match[3]!, 10);
    } else if ('ymd' === order) {
      year = parseInt(match[1]!, 10);
      month = parseInt(match[2]!, 10);
      day = parseInt(match[3]!, 10);
    } else {
      month = parseInt(match[1]!, 10);
      day = parseInt(match[2]!, 10);
      year = parseInt(match[3]!, 10);
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day);
    }
  }

  // Fallback: try native Date parsing
  const parsed = new Date(value);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
};

export const parseAmount = (value: string): number | null => {
  if ('' === value.trim()) {
    return null;
  }

  // Remove currency symbols and whitespace
  let cleaned = value.replace(/[^\d,.\-+]/g, '').trim();

  if ('' === cleaned) {
    return null;
  }

  // Detect format: if both . and , exist, the last one is the decimal separator
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) {
      // European: 1.234,56 -> 1234.56
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,234.56 -> 1234.56
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    // Could be 1,234 (thousands) or 1,56 (decimal)
    const afterComma = cleaned.slice(lastComma + 1);
    if (afterComma.length <= 2) {
      // Likely decimal separator
      cleaned = cleaned.replace(',', '.');
    } else {
      // Likely thousands separator
      cleaned = cleaned.replace(/,/g, '');
    }
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.abs(num);
};

export interface ColumnMapping {
  /**
   * Total amount. In Settle Up multi-payer exports this cell may contain
   * semicolon-separated values parallel to the `payer` cell.
   */
  amount: number | null;
  date: number | null;
  description: number | null;
  /**
   * "Who paid". A single name, a colon-separated list (legacy), or a
   * semicolon-separated list parallel to `amount` (Settle Up multi-payer).
   */
  payer: number | null;
  category: number | null;
  /**
   * "For whom" — semicolon-separated list of member names that share the
   * expense. Present in Settle Up exports.
   */
  forWhom: number | null;
  /**
   * "Split amounts" — semicolon-separated amounts parallel to `forWhom`
   * describing exactly how much each participant owed.
   */
  splitAmounts: number | null;
  /**
   * "Type" — `expense`, `income`, or `transfer`. Optional. When set to
   * `income`, the row's amount is treated as negative (a reimbursement).
   * `transfer` rows produce a SETTLEMENT split.
   */
  type: number | null;
  /**
   * Debit column — the converted/home-currency debit amount in bank
   * statements with mixed currencies. When mapped, used in preference to
   * `amount` for expense rows.
   */
  debit: number | null;
  /**
   * Credit column — the converted/home-currency credit amount. When
   * mapped, used in preference to `amount` for income/refund rows.
   */
  credit: number | null;
}

export const MAPPABLE_FIELDS = [
  'amount',
  'debit',
  'credit',
  'date',
  'description',
  'payer',
  'category',
  'forWhom',
  'splitAmounts',
  'type',
] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];

const HEADER_HINTS: Record<MappableField, RegExp> = {
  amount: /^(amount|cost|price|total|sum|value|betrag|montant|importe)$/i,
  debit: /^(debit|soll|cargo|débit|addebito)$/i,
  credit: /^(credit|haben|abono|crédit|accredito)$/i,
  date: /date|datum|fecha|data|jour/i,
  description:
    /^(description|desc|purpose|name|title|note|memo|comment|bezeichnung|beschreibung)$/i,
  payer: /^(who\s*paid|paid\s*by|payer|zahler|payeur)$/i,
  category: /^(category|cat|kategorie|catégorie)$/i,
  forWhom: /^(for\s*whom|participants?|members?|split\s*for|beneficiar(?:y|ies))$/i,
  splitAmounts: /^(split\s*amounts?|owed\s*amounts?|shares?)$/i,
  type: /^(type|kind)$/i,
};

export const autoDetectMapping = (headers: string[]): ColumnMapping => {
  const mapping: ColumnMapping = {
    amount: null,
    debit: null,
    credit: null,
    date: null,
    description: null,
    payer: null,
    category: null,
    forWhom: null,
    splitAmounts: null,
    type: null,
  };

  const used = new Set<number>();

  MAPPABLE_FIELDS.forEach((field) => {
    headers.forEach((header, index) => {
      if (!used.has(index) && null === mapping[field] && HEADER_HINTS[field].test(header.trim())) {
        mapping[field] = index;
        used.add(index);
      }
    });
  });

  return mapping;
};

/**
 * Split a Settle Up-style multi-value cell into its parts. Settle Up uses
 * semicolons; the older colon-separated convention is supported as a fallback.
 */
const splitMultiValue = (value: string): string[] => {
  const trimmed = value.trim();
  if ('' === trimmed) {
    return [];
  }
  const separator = trimmed.includes(';') ? ';' : trimmed.includes(':') ? ':' : null;
  if (null === separator) {
    return [trimmed];
  }
  return trimmed
    .split(separator)
    .map((v) => v.trim())
    .filter((v) => '' !== v);
};

/**
 * Extract the unique member names referenced by Settle Up-style columns in a
 * batch of rows. Used by the import UI to populate the member-name → userId
 * mapping step.
 */
export const extractMemberNames = (rows: string[][], mapping: ColumnMapping): string[] => {
  const names = new Set<string>();

  const collect = (columnIndex: number | null) => {
    if (null === columnIndex) {
      return;
    }
    rows.forEach((row) => {
      const cell = row[columnIndex];
      if (undefined === cell) {
        return;
      }
      splitMultiValue(cell).forEach((n) => {
        const trimmed = n.trim();
        if (trimmed) {
          names.add(trimmed);
        }
      });
    });
  };

  collect(mapping.payer);
  collect(mapping.forWhom);

  return [...names].sort();
};

/**
 * Controls what happens to rows that can't produce a Settle Up EXACT split:
 *  - `DEFAULT`: use the group's configured split behavior — weighted EXACT
 *    when member weights are non-uniform, even EQUAL otherwise.
 *  - `EQUAL`: true equal split — always divides evenly regardless of group
 *    weights (50/50 for 2, 33/33/33 for 3, etc.).
 *  - `SPLIT`: explicitly apply group member weights, producing EXACT splits
 *    with pre-calculated weighted amounts.
 *  - `SKIP`: skip these rows entirely — import only rows that came with
 *    explicit `For whom` + `Split amounts` data from Settle Up.
 */
export type FallbackSplitType = 'DEFAULT' | 'EQUAL' | 'SPLIT' | 'SKIP';

/**
 * A single expense ready to be submitted. All monetary fields are decimal
 * numbers (not BigInt) so this structure is easy to unit-test in isolation
 * from the currency helpers.
 */
export interface ParsedExpensePayload {
  description: string;
  /** Positive row total. For `income` rows this is still positive — the
   *  caller applies the sign flip at submit time. */
  amount: number;
  date: Date;
  category: string;
  /** Primary payer used for the `paidBy` backend field. */
  paidBy: number;
  /** Per-payer contributions. Empty for single-payer rows — the backend
   *  falls back to a single `paidBy` record automatically. */
  payers: { userId: number; amount: number }[];
  /**
   * Per-participant net position. For EXACT/EQUAL splits the canonical
   * convention is `amount = paid - owed` (positive = creditor). For
   * SETTLEMENT rows the convention follows `useSettlement`: payer is
   * positive, receiver is negative.
   */
  participants: { userId: number; amount: number }[];
  splitType: 'EQUAL' | 'EXACT' | 'SETTLEMENT';
  /** True if the "Amount" column didn't match the sum of split amounts. */
  amountMismatch: boolean;
  /** True if the row's Type column was `income` (negative expense). */
  isIncome: boolean;
  /**
   * True when the row's payers or participants were dictated by the CSV
   * (multi-payer or Settle Up per-member format). Callers use this flag to
   * lock down inline editing of payer/amount for those rows.
   */
  locked: boolean;
}

export interface ParseRowsOptions {
  rows: string[][];
  mapping: ColumnMapping;
  /** Maps member names (from payer / forWhom cells) to group userIds. */
  nameMapping: Record<string, number>;
  /** All group members, needed for the EQUAL-split legacy fallback. */
  groupMemberIds: number[];
  /** Used as paidBy when the row has no resolvable payer. */
  defaultPayerId: number;
  defaultDate: Date;
  defaultCategory: string;
  /** Fallback when a row's description cell is empty or not mapped. */
  defaultDescription?: string;
  /** Fallback when a row's amount cell is empty (after `parseAmount`).
   *  A final amount of zero still drops the row. */
  defaultAmount?: number;
  /** How to split rows that don't have Settle Up per-member data. */
  defaultSplitType?: FallbackSplitType;
  /** Weight per group member userId. When weights are non-uniform, EQUAL
   *  splits are converted to EXACT with pre-calculated weighted amounts. */
  groupMemberWeights?: Record<number, number>;
  /** Optional category normalizer. Defaults to identity. */
  validateCategory?: (category: string) => string;
}

const EPSILON = 1e-6;

const sumDecimal = (values: number[]): number => values.reduce((acc, v) => acc + v, 0);

/** Parse a possibly-signed decimal. Unlike `parseAmount`, this preserves sign. */
const parseSignedAmount = (value: string): number | null => {
  const parsed = parseAmount(value);
  if (null === parsed) {
    return null;
  }
  return value.trim().startsWith('-') ? -parsed : parsed;
};

/**
 * Pure CSV-to-expense parser. Handles the common splitting-app formats:
 *
 *   1. **Settle Up format** — rows use a `For whom` column plus a parallel
 *      `Split amounts` column to describe each participant's share. Multi-
 *      payer rows encode payers as semicolon-separated values in `Who paid`
 *      with parallel amounts in `Amount`. Produces EXACT splits with
 *      per-payer records.
 *
 *   2. **Legacy single-payer + amount column** — rows have a single payer
 *      and a single total amount. Produces an EQUAL split among all group
 *      members, with the payer resolved via `nameMapping` (falling back to
 *      `defaultPayerId`).
 *
 *   3. **Settle Up `transfer` rows** — produce a SETTLEMENT expense with
 *      the payer as the creditor and the receiver as the debtor.
 *
 * Income rows (negative amounts) are kept positive in `amount` and the
 * `isIncome` flag is set; the caller is responsible for flipping the sign
 * when converting to the backend payload.
 *
 * Rows that can't produce a valid expense (no amount, no mapped payer) are
 * filtered out.
 */
export const parseRowsToExpensePayloads = (options: ParseRowsOptions): ParsedExpensePayload[] => {
  const {
    rows,
    mapping,
    nameMapping,
    groupMemberIds,
    defaultPayerId,
    defaultDate,
    defaultCategory,
    defaultDescription = 'Expense',
    defaultAmount = 0,
    defaultSplitType = 'DEFAULT',
    groupMemberWeights,
    validateCategory = (c) => c,
  } = options;

  // Nothing useful to do if no amount column is mapped.
  if (null === mapping.amount) {
    return [];
  }

  const hasSettleUpSplit = null !== mapping.forWhom && null !== mapping.splitAmounts;

  const resolveName = (name: string): number | null => {
    const id = nameMapping[name];
    return id && id > 0 ? id : null;
  };

  return rows
    .map((row): ParsedExpensePayload | null => {
      // --- Date ---
      const dateStr = null !== mapping.date ? (row[mapping.date] ?? '') : '';
      const date = parseDate(dateStr) ?? defaultDate;

      // --- Description ---
      const rawDescription =
        null !== mapping.description
          ? (row[mapping.description] ?? defaultDescription)
          : defaultDescription;
      const description = '' === rawDescription.trim() ? defaultDescription : rawDescription;

      // --- Category ---
      const rawCategory =
        null !== mapping.category
          ? (row[mapping.category]?.trim() ?? defaultCategory)
          : defaultCategory;
      const category = validateCategory('' === rawCategory ? defaultCategory : rawCategory);

      // --- Type (optional) ---
      const typeRaw = null !== mapping.type ? (row[mapping.type]?.trim().toLowerCase() ?? '') : '';
      const isIncome = 'income' === typeRaw;
      const isTransfer = 'transfer' === typeRaw;

      // --- Resolve amount cell, preferring debit/credit over amount ---
      const debitVal = null !== mapping.debit ? (row[mapping.debit] ?? '').trim() : '';
      const creditVal = null !== mapping.credit ? (row[mapping.credit] ?? '').trim() : '';
      const rawAmountCell = row[mapping.amount!] ?? '';
      // Debit/credit columns (home-currency values in multi-currency bank
      // Statements) take precedence over the raw amount column.
      const amountCell = '' !== debitVal ? debitVal : '' !== creditVal ? creditVal : rawAmountCell;

      // --- Payer(s) + paid amounts ---
      const payerCell = null !== mapping.payer ? (row[mapping.payer] ?? '') : '';
      const payerParts = splitMultiValue(payerCell);
      const amountParts = splitMultiValue(amountCell);

      // Build per-payer paid amounts, using parallel lists when present.
      const payerPaid: { userId: number; amount: number }[] = [];
      let rowTotal = 0;
      let multiPayer = false;

      if (payerParts.length > 1 && amountParts.length === payerParts.length) {
        // Multi-payer: zip names and amounts.
        multiPayer = true;
        for (let i = 0; i < payerParts.length; i++) {
          const userId = resolveName(payerParts[i]!);
          const amt = parseSignedAmount(amountParts[i]!);
          if (null !== userId && null !== amt) {
            const absAmt = Math.abs(amt);
            if (absAmt > 0) {
              payerPaid.push({ userId, amount: absAmt });
              rowTotal += absAmt;
            }
          }
        }
      } else {
        // Single-payer: first name wins, take the first amount value. Fall
        // Back to `defaultAmount` when the cell is empty / unparseable.
        const parsed = parseSignedAmount(amountParts[0] ?? '');
        const total = null === parsed ? defaultAmount : parsed;
        const absTotal = Math.abs(total);
        rowTotal = absTotal;

        let payerUserId: number | null = null;
        for (const name of payerParts) {
          const id = resolveName(name);
          if (id) {
            payerUserId = id;
            break;
          }
        }
        if (null !== payerUserId && absTotal > 0) {
          payerPaid.push({ userId: payerUserId, amount: absTotal });
        }
      }

      if (0 === rowTotal) {
        return null;
      }

      // Primary payer: largest contributor, or the default.
      let paidBy = defaultPayerId;
      let maxPaid = 0;
      for (const p of payerPaid) {
        if (p.amount > maxPaid) {
          maxPaid = p.amount;
          paidBy = p.userId;
        }
      }

      // --- SETTLEMENT (transfer) ---
      if (isTransfer) {
        // For transfers, `For whom` contains the single receiver. Fall back
        // To parsing the forWhom column if present, else we can't process.
        let receiverId: number | null = null;
        if (null !== mapping.forWhom) {
          const forWhomCell = row[mapping.forWhom] ?? '';
          for (const name of splitMultiValue(forWhomCell)) {
            const id = resolveName(name);
            if (id && id !== paidBy) {
              receiverId = id;
              break;
            }
          }
        }
        if (null === receiverId || null === paidBy) {
          return null;
        }
        return {
          description,
          amount: rowTotal,
          date,
          category,
          paidBy,
          payers: [],
          participants: [
            { userId: paidBy, amount: rowTotal },
            { userId: receiverId, amount: -rowTotal },
          ],
          splitType: 'SETTLEMENT',
          amountMismatch: false,
          isIncome: false,
          locked: true,
        };
      }

      // --- Settle Up EXACT split via For whom + Split amounts ---
      if (hasSettleUpSplit) {
        const forWhomCell = row[mapping.forWhom!] ?? '';
        const splitCell = row[mapping.splitAmounts!] ?? '';
        const forWhomParts = splitMultiValue(forWhomCell);
        const splitParts = splitMultiValue(splitCell);

        if (forWhomParts.length === 0 || forWhomParts.length !== splitParts.length) {
          // Malformed Settle Up row — fall through to EQUAL split fallback below.
        } else {
          const owedByUser = new Map<number, number>();
          for (let i = 0; i < forWhomParts.length; i++) {
            const userId = resolveName(forWhomParts[i]!);
            const owed = parseSignedAmount(splitParts[i]!);
            if (null !== userId && null !== owed) {
              const absOwed = Math.abs(owed);
              if (absOwed > 0) {
                owedByUser.set(userId, (owedByUser.get(userId) ?? 0) + absOwed);
              }
            }
          }

          const owedSum = sumDecimal([...owedByUser.values()]);
          // Reconciliation: compare owed sum to paid sum (the row total).
          const amountMismatch = Math.abs(owedSum - rowTotal) > EPSILON;

          // Union of all members referenced, with signed net position.
          const paidByUser = new Map<number, number>();
          payerPaid.forEach((p) => paidByUser.set(p.userId, p.amount));
          const allUsers = new Set<number>([...paidByUser.keys(), ...owedByUser.keys()]);
          const participants = [...allUsers].map((userId) => ({
            userId,
            amount: (paidByUser.get(userId) ?? 0) - (owedByUser.get(userId) ?? 0),
          }));

          // Only emit per-payer records when there's more than one payer —
          // The backend defaults to a single `paidBy` record otherwise.
          const payers = payerPaid.length > 1 ? payerPaid : [];

          return {
            description,
            amount: rowTotal,
            date,
            category,
            paidBy,
            payers,
            participants,
            splitType: 'EXACT',
            amountMismatch,
            isIncome,
            locked: true,
          };
        }
      }

      // --- Fallback split among all group members ---
      if ('SKIP' === defaultSplitType) {
        return null;
      }
      const participantCount = groupMemberIds.length;
      if (0 === participantCount) {
        return null;
      }

      // Determine split behavior:
      //  DEFAULT → weighted EXACT when non-uniform weights, EQUAL otherwise
      //  EQUAL   → always even split, ignore weights
      //  SPLIT   → always apply weights (EXACT)
      const weights = groupMemberWeights
        ? groupMemberIds.map((id) => groupMemberWeights[id] ?? 1)
        : null;
      const hasNonUniformWeights =
        null !== weights && weights.length > 0 && !weights.every((w) => w === weights[0]);
      const useWeightedSplit =
        'SPLIT' === defaultSplitType || ('DEFAULT' === defaultSplitType && hasNonUniformWeights);

      if (useWeightedSplit) {
        const effectiveWeights = weights ?? groupMemberIds.map(() => 1);
        const totalWeight = effectiveWeights.reduce((sum, w) => sum + w, 0);
        const participants = groupMemberIds.map((userId, i) => {
          const owed = (effectiveWeights[i]! / totalWeight) * rowTotal;
          return {
            userId,
            amount: userId === paidBy ? rowTotal - owed : -owed,
          };
        });
        return {
          description,
          amount: rowTotal,
          date,
          category,
          paidBy,
          payers: payerPaid.length > 1 ? payerPaid : [],
          participants,
          splitType: 'EXACT' as const,
          amountMismatch: false,
          isIncome,
          locked: multiPayer,
        };
      }

      const perPerson = rowTotal / participantCount;
      const participants = groupMemberIds.map((userId) => ({
        userId,
        amount: userId === paidBy ? rowTotal - perPerson : -perPerson,
      }));

      return {
        description,
        amount: rowTotal,
        date,
        category,
        paidBy,
        payers: payerPaid.length > 1 ? payerPaid : [],
        participants,
        splitType: 'EQUAL' as const,
        amountMismatch: false,
        isIncome,
        locked: multiPayer,
      };
    })
    .filter((e): e is ParsedExpensePayload => null !== e);
};

/**
 * Per-row edit override. Each field is independently optional; unset fields
 * fall through to the parsed value at submission time. Amount is a decimal
 * number (not BigInt) so the UI can bind it to `CurrencyInput` via its
 * string value.
 */
export interface RowOverride {
  description?: string;
  amount?: number;
  date?: Date;
  paidBy?: number;
  category?: string;
  isIncome?: boolean;
  /** Per-participant owed amounts (positive). When set, applyRowOverride
   *  converts these to net positions using the resolved paidBy and amount.
   *  For EQUAL the owed amounts are recalculated equally; for EXACT
   *  they are used as-is. */
  participantOwed?: { userId: number; amount: number }[];
  /** Override split type for the row. DEFAULT uses the group's configured
   *  behavior, EQUAL forces an even split, SPLIT explicitly applies group
   *  member weights. */
  splitType?: 'DEFAULT' | 'EQUAL' | 'SPLIT';
}

/**
 * Resolve the backend split type (`EQUAL` | `EXACT`) from an override's
 * `DEFAULT` / `EQUAL` / `SPLIT` value, taking group weights into account.
 */
const resolveOverrideSplitType = (
  overrideType: 'DEFAULT' | 'EQUAL' | 'SPLIT',
  memberIds: number[],
  memberWeights?: Record<number, number>,
): 'EQUAL' | 'EXACT' => {
  if ('SPLIT' === overrideType) {
    return 'EXACT';
  }
  if ('EQUAL' === overrideType) {
    return 'EQUAL';
  }
  // DEFAULT: weighted EXACT when non-uniform, EQUAL otherwise.
  const weights = memberWeights ? memberIds.map((id) => memberWeights[id] ?? 1) : null;
  const hasNonUniform =
    null !== weights && weights.length > 0 && !weights.every((w) => w === weights[0]);
  return hasNonUniform ? 'EXACT' : 'EQUAL';
};

/**
 * Apply a row override on top of a parsed expense, re-running the
 * participant math when `amount`, `paidBy`, or `splitType` change on an
 * unlocked single-payer row. Locked rows (Settle Up EXACT, multi-payer,
 * SETTLEMENT) keep their parser-built payers/participants — only scalar
 * metadata can change.
 */
export const applyRowOverride = (
  expense: ParsedExpensePayload,
  override: RowOverride,
  groupMemberIds: number[],
  groupMemberWeights?: Record<number, number>,
): ParsedExpensePayload => {
  const description = override.description ?? expense.description;
  const amount = override.amount ?? expense.amount;
  const date = override.date ?? expense.date;
  const category = override.category ?? expense.category;
  const paidBy = override.paidBy ?? expense.paidBy;
  const isIncome = override.isIncome ?? expense.isIncome;
  const overrideSplitType = override.splitType;

  // Explicit participant overrides — convert owed amounts to net positions.
  if (override.participantOwed) {
    let owed = override.participantOwed;
    const effectiveType = overrideSplitType
      ? resolveOverrideSplitType(overrideSplitType, groupMemberIds, groupMemberWeights)
      : (expense.splitType as 'EQUAL' | 'EXACT');

    if ('EQUAL' === effectiveType && owed.length > 0) {
      const perPerson = amount / owed.length;
      owed = owed.map((p) => ({ userId: p.userId, amount: perPerson }));
    } else if (
      'EXACT' === effectiveType &&
      ('SPLIT' === overrideSplitType || 'DEFAULT' === overrideSplitType) &&
      owed.length > 0
    ) {
      // Recalculate with weights among the selected participants.
      const weights = owed.map((p) => groupMemberWeights?.[p.userId] ?? 1);
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      owed = owed.map((p, i) => ({
        userId: p.userId,
        amount: (weights[i]! / totalWeight) * amount,
      }));
    }

    const participants = owed.map(({ userId, amount: owedAmt }) => ({
      userId,
      amount: userId === paidBy ? amount - owedAmt : -owedAmt,
    }));

    return {
      ...expense,
      description,
      amount,
      date,
      category,
      paidBy,
      isIncome,
      participants,
      payers: [],
      splitType: effectiveType,
    };
  }

  // Locked rows preserve their parser-built payers/participants entirely.
  if (expense.locked || 'SETTLEMENT' === expense.splitType) {
    return {
      ...expense,
      description,
      amount,
      date,
      category,
      paidBy,
      isIncome,
    };
  }

  // Unlocked rows with an explicit splitType override: recompute participants.
  if (overrideSplitType) {
    const effectiveType = resolveOverrideSplitType(
      overrideSplitType,
      groupMemberIds,
      groupMemberWeights,
    );

    if ('EXACT' === effectiveType) {
      const weights = groupMemberWeights
        ? groupMemberIds.map((id) => groupMemberWeights[id] ?? 1)
        : groupMemberIds.map(() => 1);
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      const participants = groupMemberIds.map((userId, i) => {
        const owed = (weights[i]! / totalWeight) * amount;
        return { userId, amount: userId === paidBy ? amount - owed : -owed };
      });
      return {
        ...expense,
        description,
        amount,
        date,
        category,
        paidBy,
        isIncome,
        participants,
        splitType: 'EXACT',
        payers: [],
      };
    }

    // EQUAL
    const participantCount = groupMemberIds.length;
    const perPerson = participantCount > 0 ? amount / participantCount : 0;
    const participants =
      participantCount > 0
        ? groupMemberIds.map((userId) => ({
            userId,
            amount: userId === paidBy ? amount - perPerson : -perPerson,
          }))
        : expense.participants;
    return {
      ...expense,
      description,
      amount,
      date,
      category,
      paidBy,
      isIncome,
      participants,
      splitType: 'EQUAL',
      payers: [],
    };
  }

  // No splitType override: unlocked EXACT rows preserve their per-person
  // Amounts (e.g. from weighted splits). Only scalar metadata can change
  // Without explicit participantOwed.
  if ('EXACT' === expense.splitType) {
    return {
      ...expense,
      description,
      amount,
      date,
      category,
      paidBy,
      isIncome,
    };
  }

  // Unlocked single-payer EQUAL rows recompute the split when amount or
  // Payer change.
  const participantCount = groupMemberIds.length;
  const perPerson = participantCount > 0 ? amount / participantCount : 0;
  const participants =
    participantCount > 0
      ? groupMemberIds.map((userId) => ({
          userId,
          amount: userId === paidBy ? amount - perPerson : -perPerson,
        }))
      : expense.participants;

  return {
    ...expense,
    description,
    amount,
    date,
    category,
    paidBy,
    isIncome,
    participants,
  };
};

/**
 * Filter a parsed expense list down to just the selected row indices. Used
 * at import time so only the rows the user checked get sent to the backend.
 */
export const filterSelectedExpenses = <T>(expenses: T[], selectedRows: Set<number>): T[] =>
  expenses.filter((_, index) => selectedRows.has(index));
