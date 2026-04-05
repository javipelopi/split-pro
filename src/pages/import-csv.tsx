import { PaperClipIcon } from '@heroicons/react/24/solid';
import { SplitType } from '@prisma/client';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import MainLayout from '~/components/Layout/MainLayout';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select';
import { Separator } from '~/components/ui/separator';
import { LoadingSpinner } from '~/components/ui/spinner';
import { CATEGORIES, DEFAULT_CATEGORY } from '~/lib/category';
import {
  type ColumnMapping,
  MAPPABLE_FIELDS,
  type MappableField,
  autoDetectMapping,
  parseAmount,
  parseCSV,
  parseDate,
  readFileAsText,
} from '~/lib/csv';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { withI18nStaticProps } from '~/utils/i18n/server';
import { getCurrencyHelpers } from '~/utils/numbers';

type Step = 'upload' | 'mapping' | 'payers' | 'defaults' | 'preview';

const STEPS: Step[] = ['upload', 'mapping', 'payers', 'defaults', 'preview'];

interface ParsedExpense {
  description: string;
  amount: number;
  date: Date;
  payerName: string | null;
  payerUserId: number | null;
  category: string;
}

const FIELD_LABELS: Record<MappableField, string> = {
  amount: 'Amount',
  date: 'Date',
  description: 'Description',
  payer: 'Payer',
  category: 'Category',
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
  });

  // Payer mapping: CSV name -> userId
  const [payerMapping, setPayerMapping] = useState<Record<string, number>>({});

  // Defaults
  const [defaultPayerId, setDefaultPayerId] = useState<number>(user.id);
  const [defaultDate, setDefaultDate] = useState<string>(new Date().toISOString().split('T')[0]!);
  const [defaultCategory, setDefaultCategory] = useState<string>(DEFAULT_CATEGORY);

  // Queries
  const groupsQuery = api.group.getAllGroups.useQuery();
  const groupDetailQuery = api.group.getGroupDetails.useQuery(
    { groupId: selectedGroupId! },
    { enabled: null !== selectedGroupId },
  );

  const addExpenseMutation = api.expense.addOrEditExpense.useMutation();

  const groupMembers = useMemo(
    () => groupDetailQuery.data?.groupUsers.map((gu) => gu.user) ?? [],
    [groupDetailQuery.data],
  );

  const groupCurrency = useMemo(() => {
    const group = groupsQuery.data?.find((g) => g.group.id === selectedGroupId);
    return group?.group.defaultCurrency ?? 'USD';
  }, [groupsQuery.data, selectedGroupId]);

  // Extract unique payer names from CSV
  const uniquePayerNames = useMemo(() => {
    if (null === columnMapping.payer) {
      return [];
    }
    const names = new Set<string>();
    rows.forEach((row) => {
      const name = row[columnMapping.payer!]?.trim();
      if (name && '' !== name) {
        names.add(name);
      }
    });
    return [...names].sort();
  }, [rows, columnMapping.payer]);

  // Parse expenses from CSV data
  const parsedExpenses = useMemo((): ParsedExpense[] => {
    if (0 === rows.length || null === columnMapping.amount) {
      return [];
    }

    return rows
      .map((row) => {
        const amountStr = null !== columnMapping.amount ? (row[columnMapping.amount] ?? '') : '';
        const amount = parseAmount(amountStr);
        if (null === amount || 0 === amount) {
          return null;
        }

        const dateStr = null !== columnMapping.date ? (row[columnMapping.date] ?? '') : '';
        const date = parseDate(dateStr) ?? new Date(defaultDate);

        const description =
          null !== columnMapping.description
            ? (row[columnMapping.description] ?? 'Expense')
            : 'Expense';

        const payerName =
          null !== columnMapping.payer ? (row[columnMapping.payer]?.trim() ?? null) : null;
        const payerUserId = payerName ? (payerMapping[payerName] ?? null) : null;

        const category =
          null !== columnMapping.category
            ? (row[columnMapping.category]?.trim() ?? defaultCategory)
            : defaultCategory;

        return {
          description: '' === description.trim() ? 'Expense' : description,
          amount,
          date,
          payerName,
          payerUserId,
          category: validateCategory(category),
        };
      })
      .filter((e): e is ParsedExpense => null !== e);
  }, [rows, columnMapping, payerMapping, defaultDate, defaultCategory]);

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
  const needsPayerMapping = null !== columnMapping.payer && uniquePayerNames.length > 0;

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

  const handleImport = useCallback(() => {
    if (null === selectedGroupId) {
      return;
    }

    const { toSafeBigInt } = getCurrencyHelpers({ currency: groupCurrency });

    const expenses = parsedExpenses.map((expense) => {
      const paidBy = expense.payerUserId ?? defaultPayerId;
      const amountBigInt = toSafeBigInt(expense.amount);

      // Equal split among all group members
      const participantCount = groupMembers.length;
      const perPerson = amountBigInt / BigInt(participantCount);
      const remainder = amountBigInt - perPerson * BigInt(participantCount);

      const participants = groupMembers.map((member, index) => ({
        userId: member.id,
        amount:
          member.id === paidBy
            ? -(amountBigInt - perPerson - (0 === index ? remainder : 0n))
            : perPerson + (0 === index ? remainder : 0n),
      }));

      return {
        paidBy,
        name: expense.description,
        category: expense.category,
        amount: amountBigInt,
        groupId: selectedGroupId,
        splitType: SplitType.EQUAL,
        currency: groupCurrency,
        participants,
        expenseDate: expense.date,
      };
    });

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
    parsedExpenses,
    defaultPayerId,
    groupCurrency,
    groupMembers,
    addExpenseMutation,
    router,
    t,
  ]);

  const { toUIString } = getCurrencyHelpers({ currency: groupCurrency });

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

              {uniquePayerNames.map((name) => (
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

              <div className="max-h-[50vh] overflow-auto">
                {parsedExpenses.map((expense, i) => {
                  const payer = expense.payerUserId
                    ? groupMembers.find((m) => m.id === expense.payerUserId)
                    : groupMembers.find((m) => m.id === defaultPayerId);

                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between py-2">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{expense.description}</span>
                          <span className="text-muted-foreground text-xs">
                            {expense.date.toLocaleDateString()}
                            {payer ? ` · ${payer.name ?? payer.email}` : ''}
                          </span>
                        </div>
                        <span className="ml-2 shrink-0 font-medium">
                          {toUIString(
                            getCurrencyHelpers({ currency: groupCurrency }).toSafeBigInt(
                              expense.amount,
                            ),
                          )}
                        </span>
                      </div>
                      {i < parsedExpenses.length - 1 && <Separator />}
                    </div>
                  );
                })}
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
                  disabled={0 === parsedExpenses.length || addExpenseMutation.isPending}
                  className="flex-1"
                >
                  {addExpenseMutation.isPending ? (
                    <LoadingSpinner />
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {t('import_csv.steps.preview.import_expenses', {
                        count: parsedExpenses.length,
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

ImportCsvPage.auth = true;

export const getStaticProps = withI18nStaticProps(['common']);

export default ImportCsvPage;
