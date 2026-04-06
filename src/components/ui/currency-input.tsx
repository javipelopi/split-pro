import React, { useCallback, useMemo } from 'react';
import { CalculatorIcon } from 'lucide-react';

import { Input, InputProps } from './input';
import { cn } from '~/lib/utils';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';

import { CalculatorPopup } from './CalculatorPopup';

const CurrencyInput: React.FC<
  Omit<InputProps, 'type' | 'inputMode'> & {
    currency: string;
    strValue: string;
    onValueChange: (v: { strValue?: string; bigIntValue?: bigint }) => void;
    allowNegative?: boolean;
    hideSymbol?: boolean;
    disableCalculator?: boolean;
  }
> = ({
  className,
  currency,
  allowNegative,
  strValue,
  onValueChange,
  hideSymbol,
  rightIcon,
  disableCalculator,
  disabled,
  ...props
}) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils(undefined);
  const { format, parseToCleanString, toSafeBigInt, sanitizeInput } =
    getCurrencyHelpersCached(currency);

  const initialExpression = useMemo(
    () => parseToCleanString(strValue, allowNegative),
    [allowNegative, parseToCleanString, strValue],
  );

  const handleCalculatorApply = useCallback(
    (result: number) => {
      const sanitized = sanitizeInput(String(result), allowNegative, true);
      const bigIntValue = toSafeBigInt(sanitized, allowNegative);
      const formatted = format(sanitized, { signed: allowNegative, hideSymbol });
      onValueChange({ strValue: formatted, bigIntValue });
    },
    [allowNegative, format, hideSymbol, onValueChange, sanitizeInput, toSafeBigInt],
  );

  const calculatorTrigger = useMemo(() => {
    if (disableCalculator || disabled) {
      return null;
    }
    return (
      <CalculatorPopup
        initialExpression={initialExpression}
        allowNegative={allowNegative}
        onApply={handleCalculatorApply}
      >
        <button
          type="button"
          aria-label={t('calculator.open')}
          className="text-muted-foreground hover:text-foreground flex h-6 w-6 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-hidden"
          // Prevent the containing input from losing/regaining focus in a way
          // that competes with the dialog opening.
          onMouseDown={(e) => e.preventDefault()}
        >
          <CalculatorIcon className="size-4" />
        </button>
      </CalculatorPopup>
    );
  }, [allowNegative, disableCalculator, disabled, handleCalculatorApply, initialExpression, t]);

  const mergedRightIcon = useMemo(() => {
    if (!calculatorTrigger) {
      return rightIcon;
    }
    if (!rightIcon) {
      return calculatorTrigger;
    }
    return (
      <span className="flex items-center gap-1">
        {rightIcon}
        {calculatorTrigger}
      </span>
    );
  }, [calculatorTrigger, rightIcon]);

  return (
    <Input
      className={cn('text-lg placeholder:text-sm', mergedRightIcon && 'pr-10', className)}
      inputMode="decimal"
      value={strValue}
      disabled={disabled}
      onFocus={() => onValueChange({ strValue: parseToCleanString(strValue) })}
      onBlur={() => {
        const formattedValue = format(strValue, { signed: allowNegative, hideSymbol });
        return onValueChange({ strValue: formattedValue });
      }}
      onChange={(e) => {
        const rawValue = e.target.value;
        const strValue = sanitizeInput(rawValue, allowNegative, true);
        const bigIntValue = toSafeBigInt(strValue, allowNegative);
        onValueChange({ strValue, bigIntValue });
      }}
      rightIcon={mergedRightIcon}
      {...props}
    />
  );
};

CurrencyInput.displayName = 'CurrencyInput';

export { CurrencyInput };
