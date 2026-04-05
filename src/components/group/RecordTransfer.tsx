import { SplitType, type User } from '@prisma/client';
import { ArrowRightIcon, CheckIcon } from 'lucide-react';
import React, { type ReactNode, useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useSession } from 'next-auth/react';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { DEFAULT_CATEGORY } from '~/lib/category';
import { api } from '~/utils/api';

import { EntityAvatar } from '../ui/avatar';
import { CurrencyInput } from '../ui/currency-input';
import { AppDrawer } from '../ui/drawer';

type TransferStep = 'select-payer' | 'select-receiver' | 'enter-amount';

export const RecordTransfer: React.FC<{
  children: ReactNode;
  groupId: number;
  members: User[];
  defaultCurrency: string;
}> = ({ children, groupId, members, defaultCurrency }) => {
  const { data: session } = useSession();
  const { displayName, t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const [step, setStep] = useState<TransferStep>('select-payer');
  const [payer, setPayer] = useState<User | undefined>();
  const [receiver, setReceiver] = useState<User | undefined>();
  const [amount, setAmount] = useState<bigint>(0n);
  const [amountStr, setAmountStr] = useState(
    getCurrencyHelpersCached(defaultCurrency).toUIString(0n),
  );

  const addExpenseMutation = api.expense.addOrEditExpense.useMutation();
  const utils = api.useUtils();

  const receiverOptions = useMemo(
    () => members.filter((m) => m.id !== payer?.id),
    [members, payer],
  );

  const resetState = useCallback(() => {
    setStep('select-payer');
    setPayer(undefined);
    setReceiver(undefined);
    setAmount(0n);
    setAmountStr(getCurrencyHelpersCached(defaultCurrency).toUIString(0n));
  }, [getCurrencyHelpersCached, defaultCurrency]);

  const onSelectPayer = useCallback((user: User) => {
    setPayer(user);
    setStep('select-receiver');
  }, []);

  const onSelectReceiver = useCallback((user: User) => {
    setReceiver(user);
    setStep('enter-amount');
  }, []);

  const onCurrencyInputValueChange = useCallback(
    ({ strValue, bigIntValue }: { strValue?: string; bigIntValue?: bigint }) => {
      if (strValue !== undefined) {
        setAmountStr(strValue);
      }
      if (bigIntValue !== undefined) {
        setAmount(bigIntValue);
      }
    },
    [],
  );

  const saveTransfer = useCallback(() => {
    if (!payer || !receiver || !amount) {
      return;
    }

    addExpenseMutation.mutate(
      {
        name: t('ui.transfer.name'),
        currency: defaultCurrency,
        amount,
        splitType: SplitType.SETTLEMENT,
        groupId,
        participants: [
          { userId: payer.id, amount },
          { userId: receiver.id, amount: -amount },
        ],
        paidBy: payer.id,
        category: DEFAULT_CATEGORY,
      },
      {
        onSuccess: () => {
          resetState();
          utils.group.invalidate().catch(console.error);
          utils.expense.invalidate().catch(console.error);
        },
        onError: (error) => {
          console.error('Error while saving transfer:', error);
          toast.error(t('errors.saving_expense'));
        },
      },
    );
  }, [payer, receiver, amount, addExpenseMutation, defaultCurrency, groupId, utils, resetState, t]);

  const onBackClick = useCallback(() => {
    if ('enter-amount' === step) {
      setStep('select-receiver');
      setReceiver(undefined);
    } else if ('select-receiver' === step) {
      setStep('select-payer');
      setPayer(undefined);
    }
  }, [step]);

  const title =
    'select-payer' === step
      ? t('ui.transfer.select_payer')
      : 'select-receiver' === step
        ? t('ui.transfer.select_receiver')
        : t('ui.transfer.title');

  return (
    <AppDrawer
      trigger={children}
      leftAction={'select-payer' !== step ? t('actions.back') : undefined}
      leftActionOnClick={onBackClick}
      shouldCloseOnLeftAction={false}
      title={title}
      className="h-[70vh]"
      actionTitle={'enter-amount' === step ? t('actions.save') : undefined}
      actionDisabled={!payer || !receiver || !amount}
      actionOnClick={saveTransfer}
      shouldCloseOnAction
      onClose={resetState}
    >
      {'select-payer' === step && (
        <MemberList
          members={members}
          selectedId={payer?.id}
          currentUserId={session?.user.id}
          displayName={displayName}
          onSelect={onSelectPayer}
        />
      )}
      {'select-receiver' === step && (
        <MemberList
          members={receiverOptions}
          selectedId={receiver?.id}
          currentUserId={session?.user.id}
          displayName={displayName}
          onSelect={onSelectReceiver}
        />
      )}
      {'enter-amount' === step && payer && receiver && (
        <div className="mt-10 flex flex-col items-center gap-6">
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-5">
              <EntityAvatar entity={payer} />
              <ArrowRightIcon className="h-6 w-6 text-gray-600" />
              <EntityAvatar entity={receiver} />
            </div>
            <p className="mt-2 text-center text-sm text-gray-400">
              {displayName(payer, session?.user.id)}{' '}
              {t(`ui.expense.${payer.id === session?.user.id ? 'you' : 'user'}.pay`)}{' '}
              {displayName(receiver, session?.user.id)}
            </p>
          </div>
          <CurrencyInput
            currency={defaultCurrency}
            strValue={amountStr}
            className="mx-auto mt-4 w-[150px] text-center text-lg"
            onValueChange={onCurrencyInputValueChange}
          />
        </div>
      )}
    </AppDrawer>
  );
};

const MemberList: React.FC<{
  members: User[];
  selectedId?: number;
  currentUserId?: number;
  displayName: (user: User | null | undefined, currentUserId?: number) => string;
  onSelect: (user: User) => void;
}> = ({ members, selectedId, currentUserId, displayName, onSelect }) => (
  <div className="flex flex-col gap-1">
    {members.map((member) => (
      <div
        key={member.id}
        onClick={() => onSelect(member)}
        className="flex cursor-pointer items-center justify-between rounded-md px-4 py-3 hover:bg-gray-800/50"
      >
        <div className="flex items-center gap-3">
          <EntityAvatar entity={member} />
          <span>{displayName(member, currentUserId)}</span>
        </div>
        {selectedId === member.id && <CheckIcon className="h-5 w-5 text-emerald-500" />}
      </div>
    ))}
  </div>
);
