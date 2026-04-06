import { SplitType } from '@prisma/client';
import { clsx } from 'clsx';
import {
  BarChart2,
  Check,
  DollarSign,
  Equal,
  type LucideIcon,
  Percent,
  Plus,
  Users,
  X,
} from 'lucide-react';
import React, {
  type ChangeEvent,
  type PropsWithChildren,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';

import { type Participant, type Payer, useAddExpenseStore } from '~/store/addStore';
import { BigMath } from '~/utils/numbers';

import { type TFunction, useTranslation } from 'next-i18next';
import type { CurrencyCode } from '~/lib/currency';
import { cn } from '~/lib/utils';
import { EntityAvatar } from '../ui/avatar';
import { CurrencyInput } from '../ui/currency-input';
import { AppDrawer, AppDrawerClose } from '../ui/drawer';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';

export const PayerSelectionForm: React.FC<PropsWithChildren> = ({ children }) => {
  const { t } = useTranslationWithUtils();
  const isNegative = useAddExpenseStore((s) => s.isNegative);
  const payers = useAddExpenseStore((s) => s.payers);
  const participants = useAddExpenseStore((s) => s.participants);
  const amount = useAddExpenseStore((s) => s.amount);
  const currency = useAddExpenseStore((s) => s.currency);
  const [multiMode, setMultiMode] = useState(payers.length > 1);

  const toggleMultiMode = useCallback(() => {
    setMultiMode((prev) => !prev);
  }, []);

  return (
    <AppDrawer
      trigger={children}
      title={t(`ui.expense.${isNegative ? 'received_by' : 'paid_by'}`)}
      className="h-[70vh]"
      shouldCloseOnAction={!multiMode}
    >
      <div className="flex flex-col gap-4 overflow-auto">
        <Button variant="outline" size="sm" className="mx-auto gap-2" onClick={toggleMultiMode}>
          <Users className="h-4 w-4" />
          {multiMode ? t('ui.expense.single_payer') : t('ui.expense.multiple_payers')}
        </Button>
        {multiMode ? (
          <MultiPayerSelection
            participants={participants}
            payers={payers}
            amount={amount}
            currency={currency}
          />
        ) : (
          participants.map((participant) => (
            <SinglePayerRow
              key={participant.id}
              p={participant}
              isPaying={payers.some((py) => py.user.id === participant.id)}
            />
          ))
        )}
      </div>
    </AppDrawer>
  );
};

const SinglePayerRow = ({ p, isPaying }: { p: Participant; isPaying: boolean }) => {
  const { displayName } = useTranslationWithUtils();
  const currentUser = useAddExpenseStore((s) => s.currentUser);
  const { setPaidBy } = useAddExpenseStore((s) => s.actions);

  const onClick = useCallback(() => setPaidBy(p), [p, setPaidBy]);

  return (
    <AppDrawerClose className="flex items-center justify-between px-2" onClick={onClick}>
      <div className="flex items-center gap-1">
        <EntityAvatar entity={p} size={30} />
        <p className="ml-4">{displayName(p, currentUser?.id)}</p>
      </div>
      {isPaying ? <Check className="h-6 w-6 text-cyan-500" /> : null}
    </AppDrawerClose>
  );
};

const MultiPayerSelection: React.FC<{
  participants: Participant[];
  payers: Payer[];
  amount: bigint;
  currency: CurrencyCode;
}> = ({ participants, payers, amount, currency }) => {
  const { getCurrencyHelpersCached } = useTranslationWithUtils();
  const { toUIString } = getCurrencyHelpersCached(currency);
  const { addPayer, removePayer, setPayerAmount } = useAddExpenseStore((s) => s.actions);

  const payerTotal = payers.reduce((sum, p) => sum + p.amount, 0n);
  const remaining = amount - payerTotal;
  const overpaid = remaining < 0n;

  return (
    <div className="flex flex-col gap-4">
      <p className={cn('text-center text-sm', remaining === 0n ? 'text-gray-400' : 'text-red-500')}>
        {remaining === 0n
          ? `${toUIString(amount)} covered`
          : overpaid
            ? `${toUIString(-remaining)} overpaid`
            : `${toUIString(remaining)} remaining`}
      </p>
      {participants.map((participant) => {
        const payer = payers.find((py) => py.user.id === participant.id);
        return (
          <MultiPayerRow
            key={participant.id}
            participant={participant}
            payer={payer}
            currency={currency}
            onAdd={addPayer}
            onRemove={removePayer}
            onAmountChange={setPayerAmount}
          />
        );
      })}
    </div>
  );
};

const MultiPayerRow: React.FC<{
  participant: Participant;
  payer?: Payer;
  currency: CurrencyCode;
  onAdd: (user: Participant) => void;
  onRemove: (userId: number) => void;
  onAmountChange: (userId: number, amount: bigint) => void;
}> = ({ participant, payer, currency, onAdd, onRemove, onAmountChange }) => {
  const { displayName, getCurrencyHelpersCached } = useTranslationWithUtils();
  const currentUser = useAddExpenseStore((s) => s.currentUser);
  const { toUIString } = getCurrencyHelpersCached(currency);

  const [amountStr, setAmountStr] = useState(payer ? toUIString(payer.amount) : '');

  const isPayer = Boolean(payer);

  const onToggle = useCallback(() => {
    if (isPayer) {
      onRemove(participant.id);
      setAmountStr('');
    } else {
      onAdd(participant);
      setAmountStr(toUIString(0n));
    }
  }, [isPayer, participant, onAdd, onRemove, toUIString]);

  const onValueChange = useCallback(
    ({ strValue, bigIntValue }: { strValue?: string; bigIntValue?: bigint }) => {
      if (strValue !== undefined) {
        setAmountStr(strValue);
      }
      if (bigIntValue !== undefined) {
        onAmountChange(participant.id, bigIntValue);
      }
    },
    [participant.id, onAmountChange],
  );

  return (
    <div className="flex w-full items-center gap-2 px-2">
      <div className="flex min-w-0 flex-1 cursor-pointer items-center gap-1" onClick={onToggle}>
        {isPayer ? (
          <Check className="h-5 w-5 shrink-0 text-cyan-500" />
        ) : (
          <div className="h-5 w-5 shrink-0 rounded border border-gray-300" />
        )}
        <EntityAvatar entity={participant} size={28} />
        <p className="ml-2 truncate text-sm">{displayName(participant, currentUser?.id)}</p>
      </div>
      {isPayer && (
        <CurrencyInput
          strValue={amountStr}
          currency={currency}
          className="w-28 shrink-0 text-right text-sm"
          onValueChange={onValueChange}
        />
      )}
    </div>
  );
};

export const SplitExpenseForm: React.FC<PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation();
  const splitType = useAddExpenseStore((s) => s.splitType);
  const { setSplitType } = useAddExpenseStore((s) => s.actions);
  const canSplitScreenClosed = useAddExpenseStore((s) => s.canSplitScreenClosed);
  const splitScreenOpen = useAddExpenseStore((s) => s.splitScreenOpen);

  const { setSplitScreenOpen } = useAddExpenseStore((s) => s.actions);

  const onTabChange = useCallback(
    (value: string) => {
      setSplitType(value as SplitType);
    },
    [setSplitType],
  );

  const splitProps = useMemo(() => getSplitProps(t), [t]);

  return (
    <AppDrawer
      trigger={children}
      title={t(
        `expense_details.add_expense_details.split_type_section.types.${splitType.toLowerCase()}.title`,
      )}
      className="h-[85vh] lg:h-[70vh]"
      shouldCloseOnAction
      dismissible={canSplitScreenClosed}
      actionTitle={t('actions.save')}
      actionDisabled={!canSplitScreenClosed}
      open={splitScreenOpen}
      onOpenChange={setSplitScreenOpen}
    >
      <Tabs value={splitType} className="mx-auto mt-5 w-full" onValueChange={onTabChange}>
        <TabsList className="w-full justify-between">
          {splitProps.map(({ splitType, iconComponent: Icon }) => (
            <TabsTrigger key={splitType} value={splitType} className="text-xs">
              <Icon className="h-5 w-5" />
            </TabsTrigger>
          ))}
        </TabsList>
        {splitProps.map((props) => (
          <TabsContent key={props.splitType} value={props.splitType}>
            <SplitSection {...props} />
          </TabsContent>
        ))}
      </Tabs>
    </AppDrawer>
  );
};

interface SplitSectionPropsBase {
  splitType: SplitType;
  iconComponent: LucideIcon;
  prefix: string;
  isBoolean?: boolean;
  isCurrency?: boolean;
  fmtSummartyText: (
    amount: bigint,
    totalShares: bigint,
    toUIString: (val: unknown, signed?: boolean) => string,
  ) => string;
}

interface BooleanSplitSectionProps extends SplitSectionPropsBase {
  isBoolean: true;
  fmtShareText: null;
  step: null;
}

interface NumericSplitSectionProps extends SplitSectionPropsBase {
  fmtShareText: (share: bigint) => string;
  step: number | null;
}

interface CurrencySplitSectionProps extends SplitSectionPropsBase {
  isCurrency: true;
  fmtShareText: (share: bigint, toUIString: (val: unknown) => string) => string;
  step: number | null;
}

type SplitSectionProps =
  | BooleanSplitSectionProps
  | NumericSplitSectionProps
  | CurrencySplitSectionProps;

const getSplitProps = (t: TFunction): SplitSectionProps[] => [
  {
    splitType: SplitType.EQUAL,
    iconComponent: Equal,
    prefix: '',
    isBoolean: true,
    fmtSummartyText: (amount, totalShares, toUIString) =>
      `${totalShares > 0 ? toUIString(amount / totalShares) : 0} ${t('expense_details.add_expense_details.split_type_section.types.equal.per_person')}`,
    fmtShareText: null,
    step: null,
  },
  {
    splitType: SplitType.PERCENTAGE,
    iconComponent: Percent,
    prefix: '%',
    fmtSummartyText: (amount, totalShares) => {
      const remainingPercentage = 10000n - totalShares;
      return `${t('expense_details.add_expense_details.split_type_section.types.percentage.remaining')} ${Number(remainingPercentage) / 100}%`;
    },
    fmtShareText: (share) => (Number(share) / 100).toString(),
    step: null,
  },
  {
    splitType: SplitType.EXACT,
    iconComponent: DollarSign,
    prefix: '',
    isCurrency: true,
    fmtSummartyText: (amount, totalShares, toUIString) =>
      `${t('expense_details.add_expense_details.split_type_section.types.exact.remaining')} ${toUIString(amount - totalShares, true)}`,
    fmtShareText: (share, toUIString) => toUIString(share),
    step: null,
  },
  {
    splitType: SplitType.SHARE,
    iconComponent: BarChart2,
    prefix: t('expense_details.add_expense_details.split_type_section.types.share.shares'),
    fmtSummartyText: (_amount, totalShares) =>
      `${t('expense_details.add_expense_details.split_type_section.types.share.total_shares')} ${Number(totalShares) / 100}`,
    fmtShareText: (share) => (Number(share) / 100).toString(),
    step: 1,
  },
  {
    splitType: SplitType.ADJUSTMENT,
    iconComponent: Plus,
    isCurrency: true,
    prefix: '',
    fmtSummartyText: (amount, totalShares, toUIString) =>
      `${t('expense_details.add_expense_details.split_type_section.types.adjustment.remaining_to_split_equally')}: ${toUIString(amount - totalShares, true)}`,
    fmtShareText: (share, toUIString) => toUIString(share),
    step: null,
  },
];

const SplitSection: React.FC<SplitSectionProps> = (props) => {
  const participants = useAddExpenseStore((s) => s.participants);
  const totalShares = useAddExpenseStore((s) =>
    s.participants.reduce(
      (acc, p) =>
        acc + (s.splitShares[p.id]?.[s.splitType] ?? (s.splitType === SplitType.EQUAL ? 1n : 0n)),
      0n,
    ),
  );
  const allSelected = useAddExpenseStore((s) =>
    s.participants.every((p) => 0n !== s.splitShares[p.id]?.[s.splitType]),
  );
  const currency = useAddExpenseStore((s) => s.currency);
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { toUIString, toSafeBigInt } = getCurrencyHelpersCached(currency);
  const amount = useAddExpenseStore((s) => s.amount);
  const canSplitScreenClosed = useAddExpenseStore((s) => s.canSplitScreenClosed);
  const splitShares = useAddExpenseStore((s) => s.splitShares);
  const { setSplitShare } = useAddExpenseStore((s) => s.actions);

  const { fmtSummartyText, splitType, isBoolean, isCurrency } = props;

  const selectAll = useCallback(() => {
    participants.forEach((p) => {
      setSplitShare(splitType, p.id, allSelected ? 0n : 1n);
    });
  }, [participants, setSplitShare, splitType, allSelected]);

  const onToggleBoolean = useCallback(
    (userId: number) => {
      setSplitShare(splitType, userId, 0n === splitShares[userId]?.[splitType] ? 1n : 0n);
    },
    [setSplitShare, splitType, splitShares],
  );

  const onChangeInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>, userId: number) => {
      const { value } = e.target;

      setSplitShare(
        splitType,
        userId,
        value === undefined || '' === value
          ? 0n
          : BigMath.abs(toSafeBigInt(isCurrency ? value : parseFloat(value))),
      );
    },
    [setSplitShare, splitType, toSafeBigInt, isCurrency],
  );

  return (
    <div className="mt-4 flex flex-col gap-6 px-2">
      <p
        className={cn(
          canSplitScreenClosed ? 'text-gray-300' : 'text-red-500',
          'wrap-break-words min-h-6 flex-1 text-center',
        )}
      >
        {fmtSummartyText(amount, totalShares, toUIString)}
      </p>
      {isBoolean && (
        <Button
          variant="outline"
          className="mx-auto h-8 w-fit gap-2 p-2 text-gray-500"
          onClick={selectAll}
        >
          {allSelected ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          <span className="text-sm">{t('actors.all')}</span>
        </Button>
      )}
      {participants.map((p) => (
        <ParticipantRow
          key={p.id}
          p={p}
          share={splitShares[p.id]?.[splitType]}
          currency={currency}
          onToggleBoolean={onToggleBoolean}
          onChangeInput={onChangeInput}
          {...props}
        />
      ))}
    </div>
  );
};

const ParticipantRow = ({
  p,
  prefix,
  isBoolean,
  isCurrency,
  share,
  currency,
  onToggleBoolean,
  onChangeInput,
  splitType,
  fmtShareText,
  step,
}: {
  p: Participant;
  share?: bigint;
  currency: CurrencyCode;
  onToggleBoolean: (userId: number) => void;
  onChangeInput: (e: ChangeEvent<HTMLInputElement>, userId: number) => void;
} & SplitSectionProps) => {
  const { setSplitShare } = useAddExpenseStore((s) => s.actions);
  const onClick = useCallback(() => {
    if (isBoolean) {
      onToggleBoolean(p.id);
    }
  }, [isBoolean, onToggleBoolean, p.id]);

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onChangeInput(e, p.id);
    },
    [onChangeInput, p.id],
  );

  const { getCurrencyHelpersCached } = useTranslationWithUtils();

  const [shareStr, setShareStr] = React.useState(
    getCurrencyHelpersCached(currency).toUIString(share ?? 0n),
  );

  const onCurrencyInputValueChange = React.useCallback(
    ({ strValue, bigIntValue }: { strValue?: string; bigIntValue?: bigint }) => {
      if (strValue !== undefined) {
        setShareStr(strValue);
      }
      if (bigIntValue !== undefined) {
        setSplitShare(splitType, p.id, bigIntValue);
      }
    },
    [p.id, setSplitShare, splitType],
  );

  return (
    <div
      key={p.id}
      className={clsx('flex items-center justify-between', isBoolean && 'cursor-pointer')}
      onClick={onClick}
    >
      <UserAndAmount user={p} currency={currency} />
      {isBoolean ? (
        0n !== share ? (
          <div className="flex items-center gap-1">
            {share && share > 1n && <span className="text-xs text-gray-400">×{Number(share)}</span>}
            <Check className="h-6 w-6 text-cyan-500" />
          </div>
        ) : null
      ) : isCurrency ? (
        <div className="flex w-1/2 items-center gap-1">
          <CurrencyInput
            strValue={shareStr}
            currency={currency}
            className="ml-2 text-right"
            onValueChange={onCurrencyInputValueChange}
            disableCalculator
          />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <p className="text-xs">{prefix}</p>
          <Input
            type="number"
            defaultValue={share ? fmtShareText(share) : ''}
            inputMode="decimal"
            className="ml-2 w-20 text-lg"
            placeholder="0"
            min={0}
            step={step ?? 0.01}
            onChange={onInputChange}
          />
        </div>
      )}
    </div>
  );
};

export const UserAndAmount: React.FC<{ user: Participant; currency: CurrencyCode }> = ({
  user,
  currency,
}) => {
  const canSplitScreenClosed = useAddExpenseStore((s) => s.canSplitScreenClosed);
  const payers = useAddExpenseStore((s) => s.payers);
  const currentUser = useAddExpenseStore((s) => s.currentUser);

  const { getCurrencyHelpersCached, displayName } = useTranslationWithUtils();
  const { toUIString } = getCurrencyHelpersCached(currency);

  const paidAmount = payers.find((p) => p.user.id === user.id)?.amount ?? 0n;
  const shareAmount = (user.amount ?? 0n) - paidAmount;

  return (
    <div className="flex h-11 items-center gap-2">
      <EntityAvatar entity={user} size={30} />
      <div className="flex flex-col items-start">
        <p>{displayName(user, currentUser?.id)}</p>
        <p
          className={cn(
            canSplitScreenClosed || 'hidden',
            'max-w-18 truncate text-sm text-gray-400',
          )}
        >
          {0n < (shareAmount ?? 0n) ? '-' : ''} {toUIString(shareAmount)}
        </p>
      </div>
    </div>
  );
};
