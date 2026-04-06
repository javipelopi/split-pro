import { SplitType } from '@prisma/client';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { DEFAULT_CATEGORY } from '~/lib/category';
import { api } from '~/utils/api';

import { useTranslationWithUtils } from './useTranslationWithUtils';

interface SubmitSettlementArgs {
  amount: bigint;
  currency: string;
  payer: { id: number };
  receiver: { id: number };
  groupId?: number;
  name?: string;
  onSuccess?: () => void;
}

export function useSettlement() {
  const { t } = useTranslationWithUtils();
  const addExpenseMutation = api.expense.addOrEditExpense.useMutation();
  const utils = api.useUtils();

  const submit = useCallback(
    (args: SubmitSettlementArgs) => {
      const { amount, currency, payer, receiver, groupId, name, onSuccess } = args;
      addExpenseMutation.mutate(
        {
          name: name ?? t('ui.settle_up_name'),
          currency,
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
            utils.user.invalidate().catch(console.error);
            utils.group.invalidate().catch(console.error);
            utils.expense.invalidate().catch(console.error);
            onSuccess?.();
          },
          onError: (error) => {
            console.error('Error while saving expense:', error);
            toast.error(t('errors.saving_expense'));
          },
        },
      );
    },
    [addExpenseMutation, utils, t],
  );

  return { submit, isPending: addExpenseMutation.isPending };
}
