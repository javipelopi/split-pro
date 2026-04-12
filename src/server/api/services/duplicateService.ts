import { type Expense } from '@prisma/client';
import { db } from '~/server/db';

/**
 * Duplicate detection scoring algorithm.
 *
 * Sort+window approach: O(n log n) — sort expenses by (currency, amount),
 * slide a window comparing only expenses within ±10% amount. For each
 * candidate pair, score multiple dimensions:
 *
 *   Amount proximity   40 pts
 *   Date proximity     25 pts
 *   Same group         15 pts
 *   Same payer         10 pts
 *   Name similarity    10 pts
 *   ─────────────────────────
 *   Total             100 pts
 *
 * Threshold: >= 70 pts → potential duplicate.
 */

const DUPLICATE_THRESHOLD = 70;
const AMOUNT_WINDOW_RATIO = 0.1; // ±10%
const DATE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // ±2 days

export interface DuplicateCandidate {
  expense: ExpenseSummary;
  score: number;
}

export interface ExpenseSummary {
  id: string;
  name: string;
  amount: bigint;
  currency: string;
  expenseDate: Date;
  paidBy: int;
  groupId: number | null;
  paidByUser?: { name: string | null; email: string | null } | null;
}

type int = number;

/** Score two expenses for duplicate likelihood (0–100). */
export function scoreDuplicatePair(a: ExpenseSummary, b: ExpenseSummary): number {
  // Different currencies are never duplicates
  if (a.currency !== b.currency) {
    return 0;
  }

  let score = 0;

  // Amount proximity (40 pts): 40 at exact match, linear decay to 0 at ±10%
  const aAmt = Number(a.amount < 0n ? -a.amount : a.amount);
  const bAmt = Number(b.amount < 0n ? -b.amount : b.amount);
  const maxAmt = Math.max(aAmt, bAmt);
  if (maxAmt > 0) {
    const amtDiff = Math.abs(aAmt - bAmt) / maxAmt;
    if (amtDiff <= AMOUNT_WINDOW_RATIO) {
      score += Math.round(40 * (1 - amtDiff / AMOUNT_WINDOW_RATIO));
    }
  } else {
    // Both zero — exact match
    score += 40;
  }

  // Date proximity (25 pts): 25 at same day, linear decay to 0 at ±2 days
  const dateDiff = Math.abs(a.expenseDate.getTime() - b.expenseDate.getTime());
  if (dateDiff <= DATE_WINDOW_MS) {
    score += Math.round(25 * (1 - dateDiff / DATE_WINDOW_MS));
  }

  // Same group (15 pts)
  if (a.groupId != null && b.groupId != null && a.groupId === b.groupId) {
    score += 15;
  }

  // Same payer (10 pts)
  if (a.paidBy === b.paidBy) {
    score += 10;
  }

  // Name similarity (10 pts): simple normalized containment / equality
  score += Math.round(10 * nameSimilarity(a.name, b.name));

  return score;
}

/** Simple name similarity: 1 if equal, 0.7 if one contains the other, else token overlap. */
function nameSimilarity(a: string, b: string): number {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) {
    return 1;
  }
  if (la.includes(lb) || lb.includes(la)) {
    return 0.7;
  }

  // Token overlap (Jaccard)
  const tokensA = new Set(la.split(/\s+/));
  const tokensB = new Set(lb.split(/\s+/));
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      intersection++;
    }
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Find duplicates for a single expense candidate within a group.
 * Used when adding a new expense — checks against existing expenses.
 */
export async function findDuplicatesForExpense(opts: {
  name: string;
  amount: bigint;
  currency: string;
  expenseDate: Date;
  paidBy: number;
  groupId: number | null;
  excludeId?: string;
}): Promise<DuplicateCandidate[]> {
  const { name, amount, currency, expenseDate, paidBy, groupId, excludeId } = opts;

  // Query existing expenses in the same group + currency, within ±10% amount range
  const absAmount = amount < 0n ? -amount : amount;
  const lowerBound = (absAmount * 90n) / 100n;
  const upperBound = (absAmount * 110n) / 100n;

  const existing = await db.expense.findMany({
    where: {
      currency,
      groupId,
      deletedBy: null,
      id: excludeId ? { not: excludeId } : undefined,
      // Amount within ±10% (absolute values)
      OR: [
        { amount: { gte: lowerBound, lte: upperBound } },
        { amount: { gte: -upperBound, lte: -lowerBound } },
      ],
      // Date within ±2 days
      expenseDate: {
        gte: new Date(expenseDate.getTime() - DATE_WINDOW_MS),
        lte: new Date(expenseDate.getTime() + DATE_WINDOW_MS),
      },
    },
    select: {
      id: true,
      name: true,
      amount: true,
      currency: true,
      expenseDate: true,
      paidBy: true,
      groupId: true,
      paidByUser: { select: { name: true, email: true } },
    },
    take: 20,
  });

  const candidate: ExpenseSummary = {
    id: '',
    name,
    amount,
    currency,
    expenseDate,
    paidBy,
    groupId,
  };

  const results: DuplicateCandidate[] = [];
  for (const exp of existing) {
    const score = scoreDuplicatePair(candidate, exp);
    if (score >= DUPLICATE_THRESHOLD) {
      results.push({ expense: exp, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Find all duplicate clusters within a group.
 * Used for the "Suspected Duplicates" tab on the group page.
 */
export async function findDuplicatesInGroup(opts: {
  groupId: number;
  userId: number;
}): Promise<{ pairs: { expenseA: ExpenseSummary; expenseB: ExpenseSummary; score: number }[] }> {
  const { groupId, userId } = opts;

  // Fetch all active expenses in the group
  const expenses = await db.expense.findMany({
    where: {
      groupId,
      deletedBy: null,
      splitType: { notIn: ['SETTLEMENT', 'CURRENCY_CONVERSION'] },
    },
    select: {
      id: true,
      name: true,
      amount: true,
      currency: true,
      expenseDate: true,
      paidBy: true,
      groupId: true,
      paidByUser: { select: { name: true, email: true } },
    },
    orderBy: { expenseDate: 'desc' },
    take: 500, // Reasonable limit
  });

  // Fetch dismissed pairs for this user
  const dismissals = await db.duplicateDismissal.findMany({
    where: {
      dismissedBy: userId,
      OR: [{ expenseA: { groupId } }, { expenseB: { groupId } }],
    },
    select: { expenseIdA: true, expenseIdB: true },
  });

  const dismissedSet = new Set(dismissals.map((d) => `${d.expenseIdA}:${d.expenseIdB}`));

  // Sort by currency then absolute amount for sliding window
  const sorted = [...expenses].sort((a, b) => {
    if (a.currency !== b.currency) {
      return a.currency.localeCompare(b.currency);
    }
    const aAbs = a.amount < 0n ? -a.amount : a.amount;
    const bAbs = b.amount < 0n ? -b.amount : b.amount;
    if (aAbs < bAbs) {
      return -1;
    }
    if (aAbs > bAbs) {
      return 1;
    }
    return 0;
  });

  const pairs: { expenseA: ExpenseSummary; expenseB: ExpenseSummary; score: number }[] = [];

  // Sliding window: compare each expense with nearby ones (same currency, ±10% amount)
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    const aAbs = a.amount < 0n ? -a.amount : a.amount;
    const upperBound = (aAbs * 110n) / 100n;

    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.currency !== a.currency) {
        break;
      }
      const bAbs = b.amount < 0n ? -b.amount : b.amount;
      if (bAbs > upperBound) {
        break;
      }

      // Check if dismissed
      const pairKey1 = `${a.id}:${b.id}`;
      const pairKey2 = `${b.id}:${a.id}`;
      if (dismissedSet.has(pairKey1) || dismissedSet.has(pairKey2)) {
        continue;
      }

      const score = scoreDuplicatePair(a, b);
      if (score >= DUPLICATE_THRESHOLD) {
        pairs.push({ expenseA: a, expenseB: b, score });
      }
    }
  }

  return { pairs: pairs.sort((a, b) => b.score - a.score) };
}

/**
 * Batch duplicate detection for CSV import.
 * Checks an array of candidate expenses against existing group expenses AND each other.
 */
export async function findDuplicatesBatch(opts: {
  candidates: {
    name: string;
    amount: number;
    currency: string;
    expenseDate: Date;
    paidBy: number;
  }[];
  groupId: number;
}): Promise<{
  /** Per-candidate array: list of matching existing expenses */
  existingMatches: DuplicateCandidate[][];
  /** Pairs of candidate indices that are duplicates of each other */
  intraCsvPairs: { indexA: number; indexB: number; score: number }[];
}> {
  const { candidates, groupId } = opts;

  // Get all existing expenses in this group
  const existing = await db.expense.findMany({
    where: {
      groupId,
      deletedBy: null,
      splitType: { notIn: ['SETTLEMENT', 'CURRENCY_CONVERSION'] },
    },
    select: {
      id: true,
      name: true,
      amount: true,
      currency: true,
      expenseDate: true,
      paidBy: true,
      groupId: true,
      paidByUser: { select: { name: true, email: true } },
    },
  });

  const existingMatches: DuplicateCandidate[][] = [];

  for (const candidate of candidates) {
    const candidateSummary: ExpenseSummary = {
      id: '',
      name: candidate.name,
      amount: BigInt(Math.round(candidate.amount * 100)), // Convert to cents
      currency: candidate.currency,
      expenseDate: candidate.expenseDate,
      paidBy: candidate.paidBy,
      groupId,
    };

    const matches: DuplicateCandidate[] = [];
    for (const exp of existing) {
      const score = scoreDuplicatePair(candidateSummary, exp);
      if (score >= DUPLICATE_THRESHOLD) {
        matches.push({ expense: exp, score });
      }
    }
    existingMatches.push(matches.sort((a, b) => b.score - a.score));
  }

  // Intra-CSV duplicate detection
  const intraCsvPairs: { indexA: number; indexB: number; score: number }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      const summaryA: ExpenseSummary = {
        id: `csv-${i}`,
        name: a.name,
        amount: BigInt(Math.round(a.amount * 100)),
        currency: a.currency,
        expenseDate: a.expenseDate,
        paidBy: a.paidBy,
        groupId,
      };
      const summaryB: ExpenseSummary = {
        id: `csv-${j}`,
        name: b.name,
        amount: BigInt(Math.round(b.amount * 100)),
        currency: b.currency,
        expenseDate: b.expenseDate,
        paidBy: b.paidBy,
        groupId,
      };
      const score = scoreDuplicatePair(summaryA, summaryB);
      if (score >= DUPLICATE_THRESHOLD) {
        intraCsvPairs.push({ indexA: i, indexB: j, score });
      }
    }
  }

  return { existingMatches, intraCsvPairs };
}
