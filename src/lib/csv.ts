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

export const parseCSV = (text: string): ParsedCSV => {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => '' !== line.trim());

  if (0 === lines.length) {
    return { headers: [], rows: [] };
  }

  const delimiter = detectDelimiter(lines[0]!);
  const headers = parseCSVLine(lines[0]!, delimiter);
  const rows = lines.slice(1).map((line) => parseCSVLine(line, delimiter));

  return { headers, rows };
};

export const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file, 'UTF-8');
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
  amount: number | null;
  date: number | null;
  description: number | null;
  payer: number | null;
  category: number | null;
}

export const MAPPABLE_FIELDS = ['amount', 'date', 'description', 'payer', 'category'] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];

const HEADER_HINTS: Record<MappableField, RegExp> = {
  amount: /amount|cost|price|total|sum|value|betrag|montant|importe/i,
  date: /date|datum|fecha|data|jour/i,
  description: /description|desc|name|title|note|memo|comment|bezeichnung|beschreibung/i,
  payer: /payer|paid|who|person|member|name|zahler|payeur/i,
  category: /category|cat|type|kind|kategorie|catégorie/i,
};

export const autoDetectMapping = (headers: string[]): ColumnMapping => {
  const mapping: ColumnMapping = {
    amount: null,
    date: null,
    description: null,
    payer: null,
    category: null,
  };

  const used = new Set<number>();

  // First pass: exact-ish matches
  MAPPABLE_FIELDS.forEach((field) => {
    headers.forEach((header, index) => {
      if (!used.has(index) && null === mapping[field] && HEADER_HINTS[field].test(header)) {
        mapping[field] = index;
        used.add(index);
      }
    });
  });

  return mapping;
};
