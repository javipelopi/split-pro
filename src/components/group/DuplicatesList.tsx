import { AlertTriangle, Check, Trash2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import { SimpleConfirmationDialog } from '~/components/SimpleConfirmationDialog';
import { LoadingSpinner } from '~/components/ui/spinner';
import { api } from '~/utils/api';
import { getCurrencyHelpers } from '~/utils/numbers';

interface DuplicatesListProps {
  groupId: number;
  userId: number;
}

export const DuplicatesList: React.FC<DuplicatesListProps> = ({ groupId, userId }) => {
  const { t } = useTranslation();
  const duplicatesQuery = api.expense.findGroupDuplicates.useQuery({ groupId });
  const dismissMutation = api.expense.dismissDuplicate.useMutation();
  const deleteMutation = api.expense.deleteExpense.useMutation();

  const handleDismiss = useCallback(
    (expenseIdA: string, expenseIdB: string) => {
      dismissMutation.mutate(
        { expenseIdA, expenseIdB },
        {
          onSuccess: () => {
            void duplicatesQuery.refetch();
          },
          onError: () => {
            toast.error(t('errors.something_went_wrong'));
          },
        },
      );
    },
    [dismissMutation, duplicatesQuery, t],
  );

  const handleDelete = useCallback(
    (expenseId: string) => {
      deleteMutation.mutate(
        { expenseId },
        {
          onSuccess: () => {
            toast.success(t('ui.messages.expense_deleted', { defaultValue: 'Expense deleted' }));
            void duplicatesQuery.refetch();
          },
          onError: () => {
            toast.error(t('errors.something_went_wrong'));
          },
        },
      );
    },
    [deleteMutation, duplicatesQuery, t],
  );

  if (duplicatesQuery.isPending) {
    return (
      <div className="flex justify-center py-8">
        <LoadingSpinner />
      </div>
    );
  }

  const pairs = duplicatesQuery.data?.pairs ?? [];

  if (pairs.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        {t('duplicates.no_duplicates', {
          defaultValue: 'No suspected duplicates found in this group.',
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-muted-foreground text-sm">
        {t('duplicates.group_description', {
          count: pairs.length,
          defaultValue: `${pairs.length} potential duplicate pair${pairs.length > 1 ? 's' : ''} found`,
        })}
      </p>
      {pairs.map((pair) => {
        const { toUIString, toSafeBigInt } = getCurrencyHelpers({
          currency: pair.expenseA.currency,
        });
        return (
          <div key={`${pair.expenseA.id}-${pair.expenseB.id}`} className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-400">
              <AlertTriangle className="size-3.5" />
              <span>
                {t('duplicates.match_score', {
                  score: pair.score,
                  defaultValue: `${pair.score}% match`,
                })}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[pair.expenseA, pair.expenseB].map((expense) => (
                <Link
                  key={expense.id}
                  href={`/groups/${groupId}/expenses/${expense.id}`}
                  className="bg-muted/30 hover:bg-muted/50 rounded border p-2 transition-colors"
                >
                  <p className="truncate text-sm font-medium">{expense.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(expense.expenseDate).toLocaleDateString()}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {expense.paidByUser?.name ?? expense.paidByUser?.email ?? ''}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {toUIString(toSafeBigInt(Number(expense.amount)))}
                  </p>
                </Link>
              ))}
            </div>

            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={dismissMutation.isPending}
                onClick={() => handleDismiss(pair.expenseA.id, pair.expenseB.id)}
              >
                <Check className="mr-1 size-3.5" />
                {t('duplicates.keep_both', { defaultValue: 'Keep both' })}
              </Button>
              <SimpleConfirmationDialog
                title={t('duplicates.delete_title', {
                  defaultValue: 'Delete duplicate expense?',
                })}
                description={t('duplicates.delete_description', {
                  defaultValue: 'Choose which expense to delete. The other will be kept.',
                })}
                hasPermission
                onConfirm={() => handleDelete(pair.expenseB.id)}
                loading={deleteMutation.isPending}
                variant="destructive"
              >
                <Button variant="outline" size="sm" className="flex-1 text-red-500">
                  <Trash2 className="mr-1 size-3.5" />
                  {t('duplicates.delete_one', { defaultValue: 'Delete duplicate' })}
                </Button>
              </SimpleConfirmationDialog>
            </div>
          </div>
        );
      })}
    </div>
  );
};
