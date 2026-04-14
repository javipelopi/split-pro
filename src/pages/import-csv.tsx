import { PaperClipIcon } from '@heroicons/react/24/solid';
import { SplitType } from '@prisma/client';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { CategoryPicker } from '~/components/AddExpense/CategoryPicker';
import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { CurrencyInput } from '~/components/ui/currency-input';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { Separator } from '~/components/ui/separator';
import { LoadingSpinner } from '~/components/ui/spinner';
import { Switch } from '~/components/ui/switch';
import { CATEGORIES, DEFAULT_CATEGORY } from '~/lib/category';
import { CURRENCIES, isCurrencyCode } from '~/lib/currency';
import {
  type ColumnMapping,
  type FallbackSplitType,
  MAPPABLE_FIELDS,
  type MappableField,
  type ParsedExpensePayload,
  type RowOverride,
  applyRowOverride,
  autoDetectMapping,
  extractMemberNames,
  filterSelectedExpenses,
  parseCSV,
  parseRowsToExpensePayloads,
  readFileAsText,
} from '~/lib/csv';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';
import { getCurrencyHelpers } from '~/utils/numbers';

type Step = 'upload' | 'mapping' | 'payers' | 'defaults' | 'preview';

const STEPS: Step[] = ['upload', 'mapping', 'payers', 'defaults', 'preview'];

const FIELD_LABELS: Record<MappableField, string> = {
  amount: 'Amount',
  date: 'Date',
  description: 'Description',
  currency: 'Currency',
  category: 'Category',
  type: 'Type',
  payer: 'Payer',
  forWhom: 'For whom',
  splitAmounts: 'Split amounts',
};

const validateCategory = (category: string): string => {
  const lower = category.toLowerCase().trim();
  if (lower in CATEGORIES) {
    return lower;
  }
  // Check if it matches a subcategory
  for (const [section, items] of Object.entries(CATEGORIES)) {
    if (items.some((item) => item === lower)) {
      return section;
    }
  }
  return DEFAULT_CATEGORY;
};

/**
 * Convert a BigInt value (in minor units) to a decimal number, using the
 * currency's `decimalDigits`. Used when a CurrencyInput hands us a bigint
 * and we need a plain number to stash in a row override.
 */
const bigIntToDecimal = (value: bigint, currency: string): number => {
  const code = isCurrencyCode(currency) ? currency : 'USD';
  const { decimalDigits } = CURRENCIES[code];
  const multiplier = 10 ** decimalDigits;
  return Number(value) / multiplier;
};

/** Format a decimal number with a dot-separated fraction for CurrencyInput. */
const decimalToDisplayStr = (value: number): string => String(value);

interface PreviewRowProps {
  index: number;
  expense: ParsedExpensePayload;
  parsed: ParsedExpensePayload;
  groupMembers: { id: number; name: string | null; email: string | null }[];
  groupMemberWeights: Record<number, number>;
  groupCurrency: string;
  isSelected: boolean;
  isExpanded: boolean;
  isLast: boolean;
  hasOverride: boolean;
  isDuplicate: boolean;
  rowAmountStr: string | undefined;
  onToggleSelection: (index: number) => void;
  onToggleExpanded: (index: number) => void;
  onUpdateOverride: (index: number, update: Partial<RowOverride>) => void;
  onResetRow: (index: number) => void;
  onAmountStrChange: (index: number, value: string) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

const PreviewRow: React.FC<PreviewRowProps> = ({
  index,
  expense,
  parsed,
  groupMembers,
  groupMemberWeights,
  groupCurrency,
  isSelected,
  isExpanded,
  isLast,
  hasOverride,
  isDuplicate,
  rowAmountStr,
  onToggleSelection,
  onToggleExpanded,
  onUpdateOverride,
  onResetRow,
  onAmountStrChange,
  t,
}) => {
  const payer = groupMembers.find((m) => m.id === expense.paidBy);
  const displayAmount = expense.isIncome ? -expense.amount : expense.amount;
  const isLocked = parsed.locked;
  const { toUIString, toSafeBigInt } = getCurrencyHelpers({ currency: groupCurrency });
  const isSettlement = 'SETTLEMENT' === parsed.splitType;
  const [exactAmountStrs, setExactAmountStrs] = useState<Record<number, string>>({});
  const payerLabel =
    expense.payers.length > 1
      ? expense.payers
          .map((p) => {
            const m = groupMembers.find((gm) => gm.id === p.userId);
            const name = m?.name ?? m?.email ?? `#${p.userId}`;
            return `${name} ${toUIString(toSafeBigInt(p.amount))}`;
          })
          .join(' + ')
      : (payer?.name ?? payer?.email ?? null);

  const handleToggleSelection = useCallback(
    () => onToggleSelection(index),
    [index, onToggleSelection],
  );
  const handleToggleExpanded = useCallback(
    () => onToggleExpanded(index),
    [index, onToggleExpanded],
  );
  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdateOverride(index, { description: e.target.value });
    },
    [index, onUpdateOverride],
  );
  const handleAmountChange = useCallback(
    ({ strValue, bigIntValue }: { strValue?: string; bigIntValue?: bigint }) => {
      if (undefined !== strValue) {
        onAmountStrChange(index, strValue);
      }
      if (undefined !== bigIntValue) {
        onUpdateOverride(index, { amount: bigIntToDecimal(bigIntValue, groupCurrency) });
      }
    },
    [index, onAmountStrChange, onUpdateOverride, groupCurrency],
  );
  const handleDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsedDate = new Date(e.target.value);
      if (!Number.isNaN(parsedDate.getTime())) {
        onUpdateOverride(index, { date: parsedDate });
      }
    },
    [index, onUpdateOverride],
  );
  const handlePayerChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newPaidBy = parseInt(e.target.value);
      // For locked or EXACT rows, push participant overrides so net positions recalculate
      if ((isLocked || 'EXACT' === expense.splitType) && !isSettlement) {
        const currentOwed = expense.participants.map((p) => ({
          userId: p.userId,
          amount: p.userId === expense.paidBy ? expense.amount - p.amount : -p.amount,
        }));
        const overrideSplitType: 'DEFAULT' | 'EQUAL' | 'SPLIT' =
          'EXACT' === expense.splitType ? 'SPLIT' : 'EQUAL';
        onUpdateOverride(index, {
          paidBy: newPaidBy,
          participantOwed: currentOwed,
          splitType: overrideSplitType,
        });
      } else {
        onUpdateOverride(index, { paidBy: newPaidBy });
      }
    },
    [index, expense, isLocked, isSettlement, onUpdateOverride],
  );
  const handleCategoryChange = useCallback(
    (category: string) => {
      onUpdateOverride(index, { category });
    },
    [index, onUpdateOverride],
  );
  const handleIsIncomeChange = useCallback(
    (checked: boolean) => {
      onUpdateOverride(index, { isIncome: checked });
    },
    [index, onUpdateOverride],
  );
  const handleReset = useCallback(() => {
    setExactAmountStrs({});
    onResetRow(index);
  }, [index, onResetRow]);

  const participantIds = useMemo(
    () => new Set(expense.participants.map((p) => p.userId)),
    [expense.participants],
  );

  const participantOwed = useMemo(
    () =>
      expense.participants.map((p) => ({
        userId: p.userId,
        amount: p.userId === expense.paidBy ? expense.amount - p.amount : -p.amount,
      })),
    [expense.participants, expense.paidBy, expense.amount],
  );

  const handleSplitTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newType = e.target.value as 'DEFAULT' | 'EQUAL' | 'SPLIT';
      const currentMemberIds = expense.participants.map((p) => p.userId);
      const memberIds =
        currentMemberIds.length > 0 ? currentMemberIds : groupMembers.map((m) => m.id);
      setExactAmountStrs({});
      onUpdateOverride(index, {
        splitType: newType,
        participantOwed: memberIds.map((userId) => ({
          userId,
          // Amount placeholder — applyRowOverride will recalculate based on splitType.
          amount: expense.amount / memberIds.length,
        })),
      });
    },
    [index, expense, groupMembers, onUpdateOverride],
  );

  const handleParticipantToggle = useCallback(
    (userId: number) => {
      const isParticipating = participantIds.has(userId);
      const newOwed = isParticipating
        ? participantOwed.filter((p) => p.userId !== userId)
        : [...participantOwed, { userId, amount: 0 }];
      // Preserve the current override splitType, or infer from expense.
      const currentSplitType: 'DEFAULT' | 'EQUAL' | 'SPLIT' =
        'EXACT' === expense.splitType ? 'SPLIT' : 'EQUAL';
      setExactAmountStrs({});
      onUpdateOverride(index, { splitType: currentSplitType, participantOwed: newOwed });
    },
    [index, expense.splitType, participantIds, participantOwed, onUpdateOverride],
  );

  const handleParticipantAmountCommit = useCallback(
    (userId: number, newAmount: number) => {
      const newOwed = participantOwed.map((p) =>
        p.userId === userId ? { userId, amount: newAmount } : p,
      );
      onUpdateOverride(index, { splitType: 'SPLIT', participantOwed: newOwed });
    },
    [index, participantOwed, onUpdateOverride],
  );

  return (
    <div className="py-2">
      <div className="flex items-start gap-2">
        <Checkbox checked={isSelected} onCheckedChange={handleToggleSelection} className="mt-1" />
        <button
          type="button"
          className="flex min-w-0 flex-1 flex-col text-left"
          onClick={handleToggleExpanded}
        >
          <span className="truncate font-medium">{expense.description}</span>
          <span className="text-muted-foreground text-xs">
            {expense.date.toLocaleDateString()}
            {payerLabel ? ` · ${payerLabel}` : ''}
            {'SETTLEMENT' === expense.splitType
              ? ` · ${t('import_csv.steps.preview.transfer_label')}`
              : ''}
            {expense.isIncome ? ` · ${t('import_csv.steps.preview.income_label')}` : ''}
            {isLocked && 'SETTLEMENT' !== expense.splitType
              ? ` · ${t('import_csv.steps.preview.locked_label')}`
              : ''}
            {hasOverride ? ` · ${t('import_csv.steps.preview.edited_label')}` : ''}
            {isDuplicate
              ? ` · ${t('import_csv.steps.preview.duplicate_label', { defaultValue: 'Potential duplicate' })}`
              : ''}
          </span>
        </button>
        <span
          className={`ml-2 shrink-0 font-medium ${expense.amountMismatch ? 'text-yellow-500' : ''}`}
        >
          {getCurrencyHelpers({ currency: groupCurrency }).toUIString(
            getCurrencyHelpers({ currency: groupCurrency }).toSafeBigInt(displayAmount),
          )}
        </span>
      </div>

      {isExpanded && (
        <div className="bg-muted/30 mt-2 flex flex-col gap-3 rounded border p-3">
          <div className="flex flex-col gap-1">
            <Label>{t('import_csv.steps.preview.edit.description')}</Label>
            <Input value={expense.description} onChange={handleDescriptionChange} />
          </div>

          <div className="flex flex-col gap-1">
            <Label>{t('import_csv.steps.preview.edit.amount')}</Label>
            <CurrencyInput
              currency={groupCurrency}
              disabled={isLocked}
              strValue={rowAmountStr ?? decimalToDisplayStr(expense.amount)}
              onValueChange={handleAmountChange}
            />
            {isLocked && (
              <p className="text-muted-foreground text-xs">
                {t('import_csv.steps.preview.edit.locked_hint')}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label>{t('import_csv.steps.preview.edit.date')}</Label>
            <Input
              type="date"
              value={expense.date.toISOString().split('T')[0]}
              onChange={handleDateChange}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label>{t('import_csv.steps.preview.edit.payer')}</Label>
            <NativeSelect
              disabled={isSettlement}
              value={expense.paidBy}
              onChange={handlePayerChange}
              className="w-full"
            >
              {groupMembers.map((member) => (
                <NativeSelectOption key={member.id} value={member.id}>
                  {member.name ?? member.email ?? `User ${member.id}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {!isSettlement && (
            <>
              <div className="flex flex-col gap-1">
                <Label>
                  {t('import_csv.steps.preview.edit.split_type', { defaultValue: 'Split type' })}
                </Label>
                <NativeSelect
                  value={
                    'EXACT' === expense.splitType
                      ? 'SPLIT'
                      : 'EQUAL' === expense.splitType
                        ? 'EQUAL'
                        : 'DEFAULT'
                  }
                  onChange={handleSplitTypeChange}
                  className="w-full"
                >
                  <NativeSelectOption value="DEFAULT">
                    {t('import_csv.steps.preview.edit.split_default', {
                      defaultValue: 'Default (group settings)',
                    })}
                  </NativeSelectOption>
                  <NativeSelectOption value="EQUAL">
                    {t('import_csv.steps.preview.edit.split_equal', {
                      defaultValue: 'Equal (even split)',
                    })}
                  </NativeSelectOption>
                  <NativeSelectOption value="SPLIT">
                    {t('import_csv.steps.preview.edit.split_split', {
                      defaultValue: 'Split (member weights)',
                    })}
                  </NativeSelectOption>
                </NativeSelect>
              </div>

              <div className="flex flex-col gap-1">
                <Label>
                  {t('import_csv.steps.preview.edit.participants', {
                    defaultValue: 'Participants',
                  })}
                </Label>
                <div className="flex flex-col gap-1.5">
                  {groupMembers.map((member) => {
                    const isParticipating = participantIds.has(member.id);
                    const owed = participantOwed.find((p) => p.userId === member.id);
                    const isExact = 'EXACT' === expense.splitType;
                    return (
                      <div key={member.id} className="flex items-center gap-2">
                        <Checkbox
                          checked={isParticipating}
                          onCheckedChange={() => handleParticipantToggle(member.id)}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {member.name ?? member.email ?? `User ${member.id}`}
                        </span>
                        {isParticipating &&
                          (isExact ? (
                            <Input
                              type="text"
                              inputMode="decimal"
                              className="h-7 w-24 text-right text-sm"
                              value={exactAmountStrs[member.id] ?? (owed?.amount ?? 0).toFixed(2)}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                setExactAmountStrs((prev) => ({
                                  ...prev,
                                  [member.id]: e.target.value,
                                }))
                              }
                              onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val) && val >= 0) {
                                  handleParticipantAmountCommit(member.id, val);
                                }
                                setExactAmountStrs((prev) => {
                                  const { [member.id]: _, ...rest } = prev;
                                  return rest;
                                });
                              }}
                            />
                          ) : (
                            <span className="text-muted-foreground w-24 text-right text-sm">
                              {toUIString(toSafeBigInt(owed?.amount ?? 0))}
                            </span>
                          ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1">
            <Label>{t('import_csv.steps.preview.edit.category')}</Label>
            <div className="flex items-center gap-2">
              <CategoryPicker category={expense.category} onCategoryPick={handleCategoryChange} />
              <span className="text-muted-foreground text-sm">{expense.category}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor={`is-income-${index}`}>
              {t('import_csv.steps.preview.edit.is_income')}
            </Label>
            <Switch
              id={`is-income-${index}`}
              checked={expense.isIncome}
              onCheckedChange={handleIsIncomeChange}
            />
          </div>

          {hasOverride && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="self-start"
            >
              <RotateCcw className="mr-2 h-3 w-3" />
              {t('import_csv.steps.preview.edit.reset')}
            </Button>
          )}
        </div>
      )}

      {!isLast && <Separator className="mt-2" />}
    </div>
  );
};

const ImportCsvPage: NextPageWithUser = ({ user }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const groupIdParam = router.query.groupId as string | undefined;

  // Step state
  const [currentStep, setCurrentStep] = useState<Step>('upload');

  // Upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
    groupIdParam ? parseInt(groupIdParam) : null,
  );

  // Mapping state
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    amount: null,
    date: null,
    description: null,
    payer: null,
    category: null,
    forWhom: null,
    splitAmounts: null,
    type: null,
    currency: null,
  });

  // Maps CSV member names (from `payer` and `forWhom` columns) → group userId.
  const [payerMapping, setPayerMapping] = useState<Record<string, number>>({});

  // Defaults
  const [defaultPayerId, setDefaultPayerId] = useState<number>(user.id);
  const [defaultDate, setDefaultDate] = useState<string>(new Date().toISOString().split('T')[0]!);
  const [defaultCategory, setDefaultCategory] = useState<string>(DEFAULT_CATEGORY);
  const [defaultDescription, setDefaultDescription] = useState<string>('Expense');
  const [defaultAmount, setDefaultAmount] = useState<number>(0);
  const [defaultAmountStr, setDefaultAmountStr] = useState<string>('');
  const [defaultSplitType, setDefaultSplitType] = useState<FallbackSplitType>('DEFAULT');

  // Per-row state used by the preview step. All three reset whenever the
  // Parse output changes (new file, remapping, etc.) because row identity
  // Is just the array index.
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [rowOverrides, setRowOverrides] = useState<Record<number, RowOverride>>({});
  const [rowAmountStrs, setRowAmountStrs] = useState<Record<number, string>>({});
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Queries
  const groupsQuery = api.group.getAllGroups.useQuery();
  const groupDetailQuery = api.group.getGroupDetails.useQuery(
    { groupId: selectedGroupId! },
    { enabled: null !== selectedGroupId, refetchOnWindowFocus: false },
  );

  const addExpenseMutation = api.expense.addOrEditExpense.useMutation();

  const groupMembers = useMemo(
    () => groupDetailQuery.data?.groupUsers.map((gu) => gu.user) ?? [],
    [groupDetailQuery.data],
  );

  const groupMemberWeights = useMemo(
    () =>
      Object.fromEntries(
        (groupDetailQuery.data?.groupUsers ?? []).map((gu) => [gu.userId, gu.weight]),
      ),
    [groupDetailQuery.data],
  );

  const groupCurrency = useMemo(() => {
    const group = groupsQuery.data?.find((g) => g.group.id === selectedGroupId);
    return group?.group.defaultCurrency ?? 'USD';
  }, [groupsQuery.data, selectedGroupId]);

  // Extract all unique names that need to be mapped to group members:
  // Values from the `Who paid` column (legacy + Settle Up multi-payer) AND
  // Names from the `For whom` column.
  const uniqueMemberLabels = useMemo(
    () => extractMemberNames(rows, columnMapping),
    [rows, columnMapping],
  );

  // Parse expenses from CSV data.
  const parsedExpenses = useMemo<ParsedExpensePayload[]>(() => {
    if (0 === rows.length) {
      return [];
    }
    return parseRowsToExpensePayloads({
      rows,
      mapping: columnMapping,
      nameMapping: payerMapping,
      groupMemberIds: groupMembers.map((m) => m.id),
      defaultPayerId,
      defaultDate: new Date(defaultDate),
      defaultCategory,
      defaultDescription,
      defaultAmount,
      defaultSplitType,
      groupMemberWeights,
      validateCategory,
    });
  }, [
    rows,
    columnMapping,
    payerMapping,
    groupMembers,
    defaultPayerId,
    defaultDate,
    defaultCategory,
    defaultDescription,
    defaultAmount,
    defaultSplitType,
    groupMemberWeights,
  ]);

  const groupMemberIds = useMemo(() => groupMembers.map((m) => m.id), [groupMembers]);

  // Reset per-row state whenever the parser output changes. Row identity is
  // Just the index, so re-parsing invalidates any stored overrides/selection.
  useEffect(() => {
    setSelectedRows(new Set(parsedExpenses.map((_, i) => i)));
    setRowOverrides({});
    setRowAmountStrs({});
    setExpandedRows(new Set());
  }, [parsedExpenses]);

  // Effective (parsed + override) expense list used for preview and import.
  const effectiveExpenses = useMemo<ParsedExpensePayload[]>(
    () =>
      parsedExpenses.map((expense, index) => {
        const override = rowOverrides[index];
        return override
          ? applyRowOverride(expense, override, groupMemberIds, groupMemberWeights)
          : expense;
      }),
    [parsedExpenses, rowOverrides, groupMemberIds, groupMemberWeights],
  );

  // Duplicate detection for CSV import
  const duplicateBatchInput = useMemo(() => {
    if (null === selectedGroupId || 0 === effectiveExpenses.length) {
      return null;
    }
    return {
      candidates: effectiveExpenses.map((e) => ({
        name: e.description,
        amount: e.amount,
        currency: groupCurrency,
        expenseDate: e.date,
        paidBy: e.paidBy,
      })),
      groupId: selectedGroupId,
    };
  }, [effectiveExpenses, selectedGroupId, groupCurrency]);

  const duplicateBatchMutation = api.expense.findDuplicatesBatch.useMutation();

  useEffect(() => {
    if (null !== duplicateBatchInput && 'preview' === currentStep) {
      duplicateBatchMutation.mutate(duplicateBatchInput);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateBatchInput, currentStep]);

  const duplicateRowIndices = useMemo(() => {
    const set = new Set<number>();
    if (!duplicateBatchMutation.data) {
      return set;
    }
    duplicateBatchMutation.data.existingMatches.forEach((matches, i) => {
      if (matches.length > 0) {
        set.add(i);
      }
    });
    duplicateBatchMutation.data.intraCsvPairs.forEach((pair) => {
      set.add(pair.indexA);
      set.add(pair.indexB);
    });
    return set;
  }, [duplicateBatchMutation.data]);

  const duplicateCount = useMemo(
    () => [...duplicateRowIndices].filter((i) => selectedRows.has(i)).length,
    [duplicateRowIndices, selectedRows],
  );

  const skipAllDuplicates = useCallback(() => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      for (const i of duplicateRowIndices) {
        next.delete(i);
      }
      return next;
    });
  }, [duplicateRowIndices]);

  const mismatchCount = useMemo(
    () => effectiveExpenses.filter((e, i) => e.amountMismatch && selectedRows.has(i)).length,
    [effectiveExpenses, selectedRows],
  );

  const selectedCount = selectedRows.size;
  const allSelected = selectedCount === parsedExpenses.length && parsedExpenses.length > 0;

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      setUploadedFile(file);

      try {
        const text = await readFileAsText(file);
        const { headers: csvHeaders, rows: csvRows } = parseCSV(text);

        if (0 === csvHeaders.length) {
          toast.error(t('import_csv.errors.empty_file'));
          return;
        }

        setHeaders(csvHeaders);
        setRows(csvRows);

        const detected = autoDetectMapping(csvHeaders);
        setColumnMapping(detected);
      } catch {
        toast.error(t('errors.import_failed'));
      }
    },
    [t],
  );

  const handleMappingChange = useCallback((field: MappableField, value: string) => {
    setColumnMapping((prev) => ({
      ...prev,
      [field]: '' === value ? null : parseInt(value),
    }));
  }, []);

  const handlePayerMappingChange = useCallback((csvName: string, userId: string) => {
    setPayerMapping((prev) => ({
      ...prev,
      [csvName]: '' === userId ? 0 : parseInt(userId),
    }));
  }, []);

  const canProceedFromUpload = null !== uploadedFile && null !== selectedGroupId && rows.length > 0;
  const canProceedFromMapping = null !== columnMapping.amount;
  const needsPayerMapping = uniqueMemberLabels.length > 0;

  const goToStep = useCallback(
    (step: Step) => {
      // Skip payer mapping step if no payer column mapped
      if ('payers' === step && !needsPayerMapping) {
        const currentIndex = STEPS.indexOf(currentStep);
        const targetIndex = STEPS.indexOf(step);
        if (targetIndex > currentIndex) {
          setCurrentStep('defaults');
        } else {
          setCurrentStep('mapping');
        }
        return;
      }
      setCurrentStep(step);
    },
    [needsPayerMapping, currentStep],
  );

  const nextStep = useCallback(() => {
    const currentIndex = STEPS.indexOf(currentStep);
    if (currentIndex < STEPS.length - 1) {
      goToStep(STEPS[currentIndex + 1]!);
    }
  }, [currentStep, goToStep]);

  const prevStep = useCallback(() => {
    const currentIndex = STEPS.indexOf(currentStep);
    if (currentIndex > 0) {
      goToStep(STEPS[currentIndex - 1]!);
    }
  }, [currentStep, goToStep]);

  const updateRowOverride = useCallback((index: number, update: Partial<RowOverride>) => {
    setRowOverrides((prev) => ({ ...prev, [index]: { ...prev[index], ...update } }));
  }, []);

  const resetRow = useCallback((index: number) => {
    setRowOverrides((prev) => {
      const { [index]: _omit, ...rest } = prev;
      return rest;
    });
    setRowAmountStrs((prev) => {
      const { [index]: _omit, ...rest } = prev;
      return rest;
    });
  }, []);

  const toggleRowSelection = useCallback((index: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleAllRows = useCallback(() => {
    setSelectedRows((prev) => {
      if (prev.size === parsedExpenses.length) {
        return new Set();
      }
      return new Set(parsedExpenses.map((_, i) => i));
    });
  }, [parsedExpenses]);

  const toggleRowExpanded = useCallback((index: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleRowAmountStrChange = useCallback((index: number, value: string) => {
    setRowAmountStrs((prev) => ({ ...prev, [index]: value }));
  }, []);

  const handleDefaultDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDefaultDescription(e.target.value),
    [],
  );

  const handleDefaultAmountChange = useCallback(
    ({ strValue, bigIntValue }: { strValue?: string; bigIntValue?: bigint }) => {
      if (undefined !== strValue) {
        setDefaultAmountStr(strValue);
      }
      if (undefined !== bigIntValue) {
        setDefaultAmount(bigIntToDecimal(bigIntValue, groupCurrency));
      }
    },
    [groupCurrency],
  );

  const handleDefaultSplitTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as FallbackSplitType;
    if ('DEFAULT' === value || 'EQUAL' === value || 'SPLIT' === value || 'SKIP' === value) {
      setDefaultSplitType(value);
    }
  }, []);

  const handleImport = useCallback(() => {
    if (null === selectedGroupId) {
      return;
    }

    const splitTypeMap = {
      EQUAL: SplitType.EQUAL,
      EXACT: SplitType.EXACT,
      SETTLEMENT: SplitType.SETTLEMENT,
    } as const;

    const selected = filterSelectedExpenses(effectiveExpenses, selectedRows);

    const expenses = selected.map((expense) => {
      const rowCurrency = expense.currency ?? groupCurrency;
      const { toSafeBigInt: toRowBigInt } = getCurrencyHelpers({ currency: rowCurrency });
      const sign = expense.isIncome ? -1n : 1n;
      const amountBigInt = toRowBigInt(expense.amount) * sign;

      const participants = expense.participants.map((p) => ({
        userId: p.userId,
        amount: toRowBigInt(p.amount) * sign,
      }));

      const payers =
        expense.payers.length > 1
          ? expense.payers.map((p) => ({
              userId: p.userId,
              amount: toRowBigInt(p.amount) * sign,
            }))
          : undefined;

      return {
        paidBy: expense.paidBy,
        name: expense.description,
        category: expense.category,
        amount: amountBigInt,
        groupId: selectedGroupId,
        splitType: splitTypeMap[expense.splitType],
        currency: rowCurrency,
        participants,
        payers,
        expenseDate: expense.date,
      };
    });

    if (0 === expenses.length) {
      toast.error(t('import_csv.errors.no_rows_selected'));
      return;
    }

    addExpenseMutation.mutate(expenses, {
      onSuccess: () => {
        toast.success(t('import_csv.messages.import_success', { count: expenses.length }));
        router.push(`/groups/${selectedGroupId}`).catch(console.error);
      },
      onError: (error) => {
        console.error(error);
        toast.error(t('errors.something_went_wrong'));
      },
    });
  }, [
    selectedGroupId,
    effectiveExpenses,
    selectedRows,
    groupCurrency,
    addExpenseMutation,
    router,
    t,
  ]);

  const stepIndex = STEPS.indexOf(currentStep);

  return (
    <>
      <Head>
        <title>{t('import_csv.title')}</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <MainLayout hideAppBar>
        <div className="flex items-center justify-between">
          <Link href={selectedGroupId ? `/groups/${selectedGroupId}` : '/groups'}>
            <Button variant="ghost" className="text-primary px-0 py-0" size="sm">
              {t('actions.cancel')}
            </Button>
          </Link>
          <div className="font-medium">{t('import_csv.title')}</div>
          <div className="w-14" />
        </div>

        {/* Step indicator */}
        <div className="mt-4 flex items-center justify-center gap-1">
          {STEPS.filter((s) => needsPayerMapping || 'payers' !== s).map((step, i) => (
            <div
              key={step}
              className={`h-1 w-8 rounded-full transition-colors ${
                i <= stepIndex ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>

        <div className="mt-6">
          {/* Step 1: Upload */}
          {'upload' === currentStep && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">{t('import_csv.steps.upload.title')}</h2>
              <p className="text-muted-foreground text-sm">
                {t('import_csv.steps.upload.description')}
              </p>

              {/* Group selector */}
              <div className="flex flex-col gap-2">
                <Label>{t('import_csv.steps.upload.select_group')}</Label>
                <NativeSelect
                  value={selectedGroupId ?? ''}
                  onChange={(e) =>
                    setSelectedGroupId('' === e.target.value ? null : parseInt(e.target.value))
                  }
                  className="w-full"
                >
                  <NativeSelectOption value="">
                    {t('import_csv.steps.upload.choose_group')}
                  </NativeSelectOption>
                  {groupsQuery.data
                    ?.filter((g) => !g.group.archivedAt)
                    .map((g) => (
                      <NativeSelectOption key={g.group.id} value={g.group.id}>
                        {g.group.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </div>

              {/* File upload */}
              <div className="flex flex-col gap-2">
                <Label>{t('import_csv.steps.upload.csv_file')}</Label>
                <label htmlFor="csv-file" className="w-full cursor-pointer rounded border">
                  <div className="flex cursor-pointer px-3 py-[6px]">
                    <div className="flex items-center border-r pr-4">
                      <PaperClipIcon className="mr-2 h-4 w-4" />
                      <span className="hidden text-sm md:block">
                        {t('account.import_from_splitwise_details.choose_file')}
                      </span>
                    </div>
                    <div className="pl-4 text-gray-400">
                      {uploadedFile
                        ? uploadedFile.name
                        : t('account.import_from_splitwise_details.no_file_chosen')}
                    </div>
                  </div>
                  <Input
                    onChange={handleFileChange}
                    id="csv-file"
                    type="file"
                    accept=".csv,.tsv,.txt"
                    className="hidden"
                  />
                </label>
              </div>

              {/* CSV preview */}
              {headers.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label>
                    {t('import_csv.steps.upload.preview')} ({rows.length}{' '}
                    {t('import_csv.steps.upload.rows')})
                  </Label>
                  <div className="max-h-48 overflow-auto rounded border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          {headers.map((h, i) => (
                            <th key={i} className="px-3 py-1.5 font-medium whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-t">
                            {row.map((cell, j) => (
                              <td key={j} className="px-3 py-1 whitespace-nowrap">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <Button onClick={nextStep} disabled={!canProceedFromUpload} className="mt-2">
                {t('actions.next')} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Step 2: Column mapping */}
          {'mapping' === currentStep && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">{t('import_csv.steps.mapping.title')}</h2>
              <p className="text-muted-foreground text-sm">
                {t('import_csv.steps.mapping.description')}
              </p>

              {MAPPABLE_FIELDS.map((field) => (
                <div key={field} className="flex flex-col gap-1">
                  <Label>
                    {FIELD_LABELS[field]}
                    {'amount' === field && <span className="text-red-500"> *</span>}
                  </Label>
                  <NativeSelect
                    value={columnMapping[field] ?? ''}
                    onChange={(e) => handleMappingChange(field, e.target.value)}
                    className="w-full"
                  >
                    <NativeSelectOption value="">
                      {t('import_csv.steps.mapping.not_mapped')}
                    </NativeSelectOption>
                    {headers.map((header, index) => (
                      <NativeSelectOption key={index} value={index}>
                        {header}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              ))}

              {/* Mapping preview */}
              {rows.length > 0 && null !== columnMapping.amount && (
                <div className="flex flex-col gap-2">
                  <Label>{t('import_csv.steps.mapping.sample')}</Label>
                  <div className="rounded border p-3 text-sm">
                    {rows.slice(0, 3).map((row, i) => {
                      const amount = null !== columnMapping.amount ? row[columnMapping.amount] : '';
                      const desc =
                        null !== columnMapping.description ? row[columnMapping.description] : '';
                      const date = null !== columnMapping.date ? row[columnMapping.date] : '';
                      return (
                        <div key={i} className="flex justify-between py-1">
                          <span className="truncate">
                            {desc || 'Expense'} {date ? `(${date})` : ''}
                          </span>
                          <span className="ml-2 shrink-0 font-medium">{amount}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-2 flex gap-2">
                <Button variant="outline" onClick={prevStep} className="flex-1">
                  <ArrowLeft className="mr-2 h-4 w-4" /> {t('actions.back')}
                </Button>
                <Button onClick={nextStep} disabled={!canProceedFromMapping} className="flex-1">
                  {t('actions.next')} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Payer mapping */}
          {'payers' === currentStep && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">{t('import_csv.steps.payers.title')}</h2>
              <p className="text-muted-foreground text-sm">
                {t('import_csv.steps.payers.description')}
              </p>

              {uniqueMemberLabels.map((name) => (
                <div key={name} className="flex flex-col gap-1">
                  <Label>{name}</Label>
                  <NativeSelect
                    value={payerMapping[name] ?? ''}
                    onChange={(e) => handlePayerMappingChange(name, e.target.value)}
                    className="w-full"
                  >
                    <NativeSelectOption value="">
                      {t('import_csv.steps.payers.use_default')}
                    </NativeSelectOption>
                    {groupMembers.map((member) => (
                      <NativeSelectOption key={member.id} value={member.id}>
                        {member.name ?? member.email ?? `User ${member.id}`}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              ))}

              <div className="mt-2 flex gap-2">
                <Button variant="outline" onClick={prevStep} className="flex-1">
                  <ArrowLeft className="mr-2 h-4 w-4" /> {t('actions.back')}
                </Button>
                <Button onClick={nextStep} className="flex-1">
                  {t('actions.next')} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Defaults */}
          {'defaults' === currentStep && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">{t('import_csv.steps.defaults.title')}</h2>
              <p className="text-muted-foreground text-sm">
                {t('import_csv.steps.defaults.description')}
              </p>

              {/* Default description */}
              <div className="flex flex-col gap-1">
                <Label>{t('import_csv.steps.defaults.default_description')}</Label>
                <Input
                  value={defaultDescription}
                  onChange={handleDefaultDescriptionChange}
                  placeholder="Expense"
                />
              </div>

              {/* Default amount */}
              <div className="flex flex-col gap-1">
                <Label>{t('import_csv.steps.defaults.default_amount')}</Label>
                <CurrencyInput
                  currency={groupCurrency}
                  strValue={defaultAmountStr}
                  onValueChange={handleDefaultAmountChange}
                />
                <p className="text-muted-foreground text-xs">
                  {t('import_csv.steps.defaults.default_amount_hint')}
                </p>
              </div>

              {/* Default split type */}
              <div className="flex flex-col gap-1">
                <Label>{t('import_csv.steps.defaults.default_split_type')}</Label>
                <NativeSelect
                  value={defaultSplitType}
                  onChange={handleDefaultSplitTypeChange}
                  className="w-full"
                >
                  <NativeSelectOption value="DEFAULT">
                    {t('import_csv.steps.defaults.split_type_default', {
                      defaultValue: 'Default (use group settings)',
                    })}
                  </NativeSelectOption>
                  <NativeSelectOption value="EQUAL">
                    {t('import_csv.steps.defaults.split_type_equal', {
                      defaultValue: 'Equal (even split)',
                    })}
                  </NativeSelectOption>
                  <NativeSelectOption value="SPLIT">
                    {t('import_csv.steps.defaults.split_type_split', {
                      defaultValue: 'Split (use member weights)',
                    })}
                  </NativeSelectOption>
                  <NativeSelectOption value="SKIP">
                    {t('import_csv.steps.defaults.split_type_skip', {
                      defaultValue: 'Skip (do not import)',
                    })}
                  </NativeSelectOption>
                </NativeSelect>
              </div>

              {/* Default payer */}
              {null === columnMapping.payer && (
                <div className="flex flex-col gap-1">
                  <Label>{t('import_csv.steps.defaults.default_payer')}</Label>
                  <NativeSelect
                    value={defaultPayerId}
                    onChange={(e) => setDefaultPayerId(parseInt(e.target.value))}
                    className="w-full"
                  >
                    {groupMembers.map((member) => (
                      <NativeSelectOption key={member.id} value={member.id}>
                        {member.name ?? member.email ?? `User ${member.id}`}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              )}

              {/* Default date */}
              {null === columnMapping.date && (
                <div className="flex flex-col gap-1">
                  <Label>{t('import_csv.steps.defaults.default_date')}</Label>
                  <Input
                    type="date"
                    value={defaultDate}
                    onChange={(e) => setDefaultDate(e.target.value)}
                  />
                </div>
              )}

              {/* Default category */}
              {null === columnMapping.category && (
                <div className="flex flex-col gap-1">
                  <Label>{t('import_csv.steps.defaults.default_category')}</Label>
                  <NativeSelect
                    value={defaultCategory}
                    onChange={(e) => setDefaultCategory(e.target.value)}
                    className="w-full"
                  >
                    {Object.keys(CATEGORIES).map((cat) => (
                      <NativeSelectOption key={cat} value={cat}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              )}

              <div className="text-muted-foreground text-sm">
                {t('import_csv.steps.defaults.currency_note', { currency: groupCurrency })}
              </div>

              <div className="mt-2 flex gap-2">
                <Button variant="outline" onClick={prevStep} className="flex-1">
                  <ArrowLeft className="mr-2 h-4 w-4" /> {t('actions.back')}
                </Button>
                <Button onClick={nextStep} className="flex-1">
                  {t('actions.next')} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 5: Preview */}
          {'preview' === currentStep && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">{t('import_csv.steps.preview.title')}</h2>
              <p className="text-muted-foreground text-sm">
                {t('import_csv.steps.preview.description', { count: parsedExpenses.length })}
              </p>

              {mismatchCount > 0 && (
                <div className="text-warning flex items-start gap-2 rounded border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {t('import_csv.steps.preview.mismatch_warning', { count: mismatchCount })}
                  </span>
                </div>
              )}

              {duplicateCount > 0 && (
                <div className="flex items-start gap-2 rounded border border-orange-500/40 bg-orange-500/10 p-3 text-sm text-orange-700 dark:text-orange-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex flex-1 flex-col gap-1">
                    <span>
                      {t('import_csv.steps.preview.duplicate_warning', {
                        count: duplicateCount,
                        defaultValue: `${duplicateCount} row${duplicateCount > 1 ? 's' : ''} may be duplicate${duplicateCount > 1 ? 's' : ''} of existing expenses`,
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit border-orange-500/40 text-orange-700 hover:bg-orange-500/10 dark:text-orange-400"
                      onClick={skipAllDuplicates}
                    >
                      {t('import_csv.steps.preview.skip_duplicates', {
                        defaultValue: 'Skip all potential duplicates',
                      })}
                    </Button>
                  </div>
                </div>
              )}

              {/* Select all / none header */}
              {parsedExpenses.length > 0 && (
                <div className="flex items-center justify-between border-b pb-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAllRows}
                      id="preview-select-all"
                    />
                    <Label htmlFor="preview-select-all" className="cursor-pointer">
                      {t('import_csv.steps.preview.select_all', {
                        selected: selectedCount,
                        total: parsedExpenses.length,
                      })}
                    </Label>
                  </div>
                </div>
              )}

              <div className="max-h-[60vh] overflow-auto">
                {effectiveExpenses.map((expense, i) => (
                  <PreviewRow
                    key={i}
                    index={i}
                    expense={expense}
                    parsed={parsedExpenses[i]!}
                    groupMembers={groupMembers}
                    groupMemberWeights={groupMemberWeights}
                    groupCurrency={groupCurrency}
                    isSelected={selectedRows.has(i)}
                    isExpanded={expandedRows.has(i)}
                    isLast={i === effectiveExpenses.length - 1}
                    hasOverride={undefined !== rowOverrides[i]}
                    isDuplicate={duplicateRowIndices.has(i)}
                    rowAmountStr={rowAmountStrs[i]}
                    onToggleSelection={toggleRowSelection}
                    onToggleExpanded={toggleRowExpanded}
                    onUpdateOverride={updateRowOverride}
                    onResetRow={resetRow}
                    onAmountStrChange={handleRowAmountStrChange}
                    t={t}
                  />
                ))}
              </div>

              {0 === parsedExpenses.length && (
                <div className="text-muted-foreground py-8 text-center">
                  {t('import_csv.steps.preview.no_expenses')}
                </div>
              )}

              <div className="mt-2 flex gap-2">
                <Button variant="outline" onClick={prevStep} className="flex-1">
                  <ArrowLeft className="mr-2 h-4 w-4" /> {t('actions.back')}
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={0 === selectedCount || addExpenseMutation.isPending}
                  className="flex-1"
                >
                  {addExpenseMutation.isPending ? (
                    <LoadingSpinner />
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {t('import_csv.steps.preview.import_expenses', {
                        count: selectedCount,
                      })}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </MainLayout>
    </>
  );
};

ImportCsvPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default ImportCsvPage;
