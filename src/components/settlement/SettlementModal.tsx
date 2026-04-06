import { type User } from '@prisma/client';
import { ArrowRightIcon, CheckIcon } from 'lucide-react';
import { useSession } from 'next-auth/react';
import React, { type ReactNode, useCallback, useMemo, useState } from 'react';

import { useSettlement } from '~/hooks/useSettlement';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import type { MinimalBalance } from '~/types/balance.types';
import { BigMath } from '~/utils/numbers';

import { FriendBalance } from '../Friend/FriendBalance';
import { EntityAvatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { CurrencyInput } from '../ui/currency-input';
import { AppDrawer } from '../ui/drawer';

interface FriendSettlementProps {
  type: 'friend';
  friend: User;
  balances: MinimalBalance[] | undefined;
}

interface GroupSettlementProps {
  type: 'group';
  groupId: number;
  members: User[];
  defaultCurrency: string;
}

export type SettlementModalProps = (FriendSettlementProps | GroupSettlementProps) & {
  children: ReactNode;
};

type Step = 'select-balance' | 'select-payer' | 'select-receiver' | 'enter-amount';

export const SettlementModal: React.FC<SettlementModalProps> = (props) => {
  const { t, displayName, getCurrencyHelpersCached } = useTranslationWithUtils();
  const { data: session } = useSession();
  const { submit } = useSettlement();

  const currentUser = session?.user;

  const isFriendMode = 'friend' === props.type;
  const friendBalances = isFriendMode ? props.balances : undefined;
  const friendUser = isFriendMode ? props.friend : undefined;
  const groupId = isFriendMode ? undefined : props.groupId;
  const groupMembers = isFriendMode ? undefined : props.members;
  const groupDefaultCurrency = isFriendMode ? undefined : props.defaultCurrency;

  const initialStep: Step = useMemo(() => {
    if (isFriendMode) {
      return 1 < (friendBalances?.length ?? 0) ? 'select-balance' : 'enter-amount';
    }
    return 'select-payer';
    /* Initial step is computed once from mount-time props; intentionally not
       recomputed on prop changes so the drawer view is stable. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialBalance: MinimalBalance | undefined = useMemo(() => {
    if (isFriendMode && 1 >= (friendBalances?.length ?? 0)) {
      return friendBalances?.[0];
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [step, setStep] = useState<Step>(initialStep);
  const [selectedBalance, setSelectedBalance] = useState<MinimalBalance | undefined>(
    initialBalance,
  );
  const [payer, setPayer] = useState<User | undefined>();
  const [receiver, setReceiver] = useState<User | undefined>();
  const [amount, setAmount] = useState<bigint>(
    initialBalance ? BigMath.abs(initialBalance.amount) : 0n,
  );

  const currency = isFriendMode ? (selectedBalance?.currency ?? '') : (groupDefaultCurrency ?? '');

  const [amountStr, setAmountStr] = useState<string>(
    getCurrencyHelpersCached(currency).toUIString(amount),
  );

  // For friend mode, payer/receiver is derived from the balance sign.
  const isCurrentUserPaying = isFriendMode && 0 > (selectedBalance?.amount ?? 0);

  const effectivePayer = isFriendMode ? (isCurrentUserPaying ? currentUser : friendUser) : payer;

  const effectiveReceiver = isFriendMode
    ? isCurrentUserPaying
      ? friendUser
      : currentUser
    : receiver;

  const onSelectBalance = useCallback(
    (balance: MinimalBalance) => {
      setSelectedBalance(balance);
      setAmount(BigMath.abs(balance.amount));
      setAmountStr(
        getCurrencyHelpersCached(balance.currency).toUIString(BigMath.abs(balance.amount)),
      );
    },
    [getCurrencyHelpersCached],
  );

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

  const resetState = useCallback(() => {
    setStep(initialStep);
    setSelectedBalance(initialBalance);
    setPayer(undefined);
    setReceiver(undefined);
    const nextAmount = initialBalance ? BigMath.abs(initialBalance.amount) : 0n;
    const nextCurrency = isFriendMode
      ? (initialBalance?.currency ?? '')
      : (groupDefaultCurrency ?? '');
    setAmount(nextAmount);
    setAmountStr(getCurrencyHelpersCached(nextCurrency).toUIString(nextAmount));
  }, [initialStep, initialBalance, isFriendMode, groupDefaultCurrency, getCurrencyHelpersCached]);

  const onBackClick = useCallback(() => {
    if (isFriendMode) {
      if (selectedBalance && 1 < (friendBalances?.length ?? 0)) {
        setSelectedBalance(undefined);
        setStep('select-balance');
      }
      return;
    }
    if ('enter-amount' === step) {
      setStep('select-receiver');
      setReceiver(undefined);
    } else if ('select-receiver' === step) {
      setStep('select-payer');
      setPayer(undefined);
    }
  }, [isFriendMode, friendBalances, selectedBalance, step]);

  const saveSettlement = useCallback(() => {
    if (!amount || !effectivePayer || !effectiveReceiver) {
      return;
    }

    if (isFriendMode) {
      if (!selectedBalance) {
        return;
      }
      submit({
        amount,
        currency: selectedBalance.currency,
        payer: effectivePayer,
        receiver: effectiveReceiver,
        groupId: selectedBalance.groupId ?? undefined,
        name: t('ui.settle_up_name'),
      });
      return;
    }

    submit({
      amount,
      currency: groupDefaultCurrency ?? '',
      payer: effectivePayer,
      receiver: effectiveReceiver,
      groupId,
      name: t('ui.transfer.name'),
      onSuccess: resetState,
    });
  }, [
    amount,
    effectivePayer,
    effectiveReceiver,
    isFriendMode,
    selectedBalance,
    groupDefaultCurrency,
    groupId,
    submit,
    t,
    resetState,
  ]);

  const receiverOptions = useMemo(
    () => (groupMembers ? groupMembers.filter((m) => m.id !== payer?.id) : []),
    [groupMembers, payer],
  );

  const onSelectBalanceRow = useCallback(
    (b: MinimalBalance) => () => onSelectBalance(b),
    [onSelectBalance],
  );

  /* Friend mode shows a disabled placeholder while balances are loading,
     preserving the original SettleUp UX. */
  if (isFriendMode && !friendBalances) {
    return (
      <Button size="sm" variant="outline" responsiveIcon disabled>
        <span className="xs:inline hidden">{t('actions.settle_up')}</span>
      </Button>
    );
  }

  if (!currentUser) {
    return null;
  }

  const title = isFriendMode
    ? selectedBalance
      ? t('ui.settle_up_name')
      : t('ui.select_balance')
    : 'select-payer' === step
      ? t('ui.transfer.select_payer')
      : 'select-receiver' === step
        ? t('ui.transfer.select_receiver')
        : t('ui.transfer.title');

  const showAction = isFriendMode ? true : 'enter-amount' === step;
  const actionDisabled = isFriendMode
    ? !selectedBalance || !amount
    : !payer || !receiver || !amount;

  const showLeftAction = isFriendMode ? true : 'select-payer' !== step;

  const onClose = isFriendMode ? undefined : resetState;

  const disableTrigger = isFriendMode ? !friendBalances?.length : undefined;

  const showAmountStep = isFriendMode ? selectedBalance !== undefined : 'enter-amount' === step;

  return (
    <AppDrawer
      trigger={props.children}
      disableTrigger={disableTrigger}
      leftAction={showLeftAction ? t('actions.back') : undefined}
      leftActionOnClick={onBackClick}
      shouldCloseOnLeftAction={false}
      title={title}
      className="h-[70vh]"
      actionTitle={showAction ? t('actions.save') : undefined}
      actionDisabled={actionDisabled}
      actionOnClick={saveSettlement}
      shouldCloseOnAction
      onClose={onClose}
    >
      {isFriendMode && !selectedBalance && friendUser && (
        <div>
          {friendBalances?.map((b) => (
            <div
              key={`${b.friendId}-${b.currency}-${b.groupId ?? 'null'}`}
              onClick={onSelectBalanceRow(b)}
              className="cursor-pointer px-4 py-2"
            >
              <FriendBalance user={friendUser} balance={b} groupName={b.groupName} />
            </div>
          ))}
        </div>
      )}

      {!isFriendMode && 'select-payer' === step && groupMembers && (
        <MemberList
          members={groupMembers}
          selectedId={payer?.id}
          currentUserId={currentUser.id}
          displayName={displayName}
          onSelect={onSelectPayer}
        />
      )}

      {!isFriendMode && 'select-receiver' === step && (
        <MemberList
          members={receiverOptions}
          selectedId={receiver?.id}
          currentUserId={currentUser.id}
          displayName={displayName}
          onSelect={onSelectReceiver}
        />
      )}

      {showAmountStep && effectivePayer && effectiveReceiver && (
        <div className="mt-10 flex flex-col items-center gap-6">
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-5">
              <EntityAvatar entity={effectivePayer} />
              <ArrowRightIcon className="h-6 w-6 text-gray-600" />
              <EntityAvatar entity={effectiveReceiver} />
            </div>
            {isFriendMode && friendUser ? (
              <p className="mt-2 text-center text-sm text-gray-400">
                {isCurrentUserPaying
                  ? `${t('actors.you')} ${t('ui.expense.you.pay')} ${displayName(friendUser)}`
                  : `${displayName(friendUser)} ${t('ui.expense.user.pay')} ${t('actors.you')}`}
              </p>
            ) : (
              <p className="mt-2 text-center text-sm text-gray-400">
                {displayName(effectivePayer, currentUser.id)}{' '}
                {t(`ui.expense.${effectivePayer.id === currentUser.id ? 'you' : 'user'}.pay`)}{' '}
                {displayName(effectiveReceiver, currentUser.id)}
              </p>
            )}
            {isFriendMode && selectedBalance?.groupName ? (
              <p className="mt-1 text-center text-xs text-gray-500">{selectedBalance.groupName}</p>
            ) : null}
          </div>
          <CurrencyInput
            currency={currency}
            strValue={amountStr}
            className="mx-auto mt-4 w-[150px] text-center text-lg"
            onValueChange={onCurrencyInputValueChange}
          />
        </div>
      )}
    </AppDrawer>
  );
};

interface MemberListProps {
  members: User[];
  selectedId?: number;
  currentUserId?: number;
  displayName: (user: User | null | undefined, currentUserId?: number) => string;
  onSelect: (user: User) => void;
}

const MemberList: React.FC<MemberListProps> = ({
  members,
  selectedId,
  currentUserId,
  displayName,
  onSelect,
}) => (
  <div className="flex flex-col gap-1">
    {members.map((member) => (
      <MemberRow
        key={member.id}
        member={member}
        selected={selectedId === member.id}
        currentUserId={currentUserId}
        displayName={displayName}
        onSelect={onSelect}
      />
    ))}
  </div>
);

interface MemberRowProps {
  member: User;
  selected: boolean;
  currentUserId?: number;
  displayName: (user: User | null | undefined, currentUserId?: number) => string;
  onSelect: (user: User) => void;
}

const MemberRow: React.FC<MemberRowProps> = ({
  member,
  selected,
  currentUserId,
  displayName,
  onSelect,
}) => {
  const handleClick = useCallback(() => onSelect(member), [member, onSelect]);
  return (
    <div
      onClick={handleClick}
      className="flex cursor-pointer items-center justify-between rounded-md px-4 py-3 hover:bg-gray-800/50"
    >
      <div className="flex items-center gap-3">
        <EntityAvatar entity={member} />
        <span>{displayName(member, currentUserId)}</span>
      </div>
      {selected && <CheckIcon className="h-5 w-5 text-emerald-500" />}
    </div>
  );
};
