'use client';

import React from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { cn } from '~/lib/utils';

export interface BalanceDisplayProps {
  amount: bigint;
  currency: string;
  variant?: 'compact' | 'full';
  showConversion?: boolean;
  targetCurrency?: string;
  className?: string;
  hasMore?: boolean;
}

/**
 * Shared primitive for rendering a single currency balance with owed/owes
 * color theming derived from the sign of `amount`.
 *
 * - `variant="compact"` renders a bare `<span>` suitable for inline usage.
 * - `variant="full"` renders a stacked label + amount block (e.g. "You lent $5.00").
 * - `showConversion` / `targetCurrency` are reserved for future conversion UI.
 */
export const BalanceDisplay: React.FC<BalanceDisplayProps> = ({
  amount,
  currency,
  variant = 'compact',
  className,
  hasMore = false,
}) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();

  if (0n === amount) {
    return <span className={cn('text-gray-500', className)}>{t('ui.settled_up')}</span>;
  }

  const isPositive = amount > 0n;
  const colorClass = isPositive ? 'text-positive' : 'text-negative';
  const amountString = getCurrencyHelpersCached(currency).toUIString(amount);

  if ('full' === variant) {
    return (
      <div>
        <div className={cn('text-right text-xs', colorClass, className)}>
          {t('actors.you')} {t(`ui.expense.you.${isPositive ? 'lent' : 'owe'}`)}
        </div>
        <span className={cn(colorClass, className)}>
          {amountString}
          {hasMore && '+'}
        </span>
      </div>
    );
  }

  return (
    <span className={cn(colorClass, className)}>
      {amountString}
      {hasMore && '+'}
    </span>
  );
};
