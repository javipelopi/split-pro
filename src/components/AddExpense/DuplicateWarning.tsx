import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '~/components/ui/button';
import { type DuplicateCandidate } from '~/server/api/services/duplicateService';
import { getCurrencyHelpers } from '~/utils/numbers';

interface DuplicateWarningProps {
  duplicates: DuplicateCandidate[];
  groupId: number | null;
}

export const DuplicateWarning: React.FC<DuplicateWarningProps> = ({ duplicates, groupId }) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  if (duplicates.length === 0) {
    return null;
  }

  const topMatch = duplicates[0]!;

  return (
    <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-yellow-700 dark:text-yellow-400"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <AlertTriangle className="size-4 shrink-0" />
        <span className="flex-1">
          {t('duplicates.warning_title', {
            count: duplicates.length,
            defaultValue: `${duplicates.length} potential duplicate${duplicates.length > 1 ? 's' : ''} found`,
          })}
        </span>
        {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>

      {isExpanded && (
        <div className="mt-3 flex flex-col gap-2">
          {duplicates.slice(0, 5).map((dup) => {
            const { toUIString, toSafeBigInt } = getCurrencyHelpers({
              currency: dup.expense.currency,
            });
            const expenseUrl = groupId
              ? `/groups/${groupId}/expenses/${dup.expense.id}`
              : `/expenses/${dup.expense.id}`;

            return (
              <div
                key={dup.expense.id}
                className="bg-background flex items-center justify-between rounded border p-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{dup.expense.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(dup.expense.expenseDate).toLocaleDateString()}
                    {dup.expense.paidByUser?.name ? ` · ${dup.expense.paidByUser.name}` : ''}
                    {' · '}
                    {t('duplicates.match_score', {
                      score: dup.score,
                      defaultValue: `${dup.score}% match`,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-medium">
                    {toUIString(toSafeBigInt(Number(dup.expense.amount)))}
                  </span>
                  <Link href={expenseUrl}>
                    <Button variant="ghost" size="sm" className="size-7 p-0">
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
          <p className="text-muted-foreground text-xs">
            {t('duplicates.save_anyway_hint', {
              defaultValue: 'You can still save this expense if it is not a duplicate.',
            })}
          </p>
        </div>
      )}
    </div>
  );
};
