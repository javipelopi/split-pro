import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeleteIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';

import { cn } from '~/lib/utils';
import {
  evaluateCalculatorExpression,
  tryEvaluateCalculatorExpression,
} from '~/utils/calculatorExpression';

import { AppDrawer } from './drawer';
import { Button } from './button';

type CalculatorKey =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '.'
  | '+'
  | '-'
  | '*'
  | '/'
  | '('
  | ')'
  | '='
  | 'C'
  | 'backspace';

const KEY_ROWS: CalculatorKey[][] = [
  ['C', '(', ')', 'backspace'],
  ['7', '8', '9', '/'],
  ['4', '5', '6', '*'],
  ['1', '2', '3', '-'],
  ['0', '.', '=', '+'],
];

const OPERATOR_KEYS = new Set<CalculatorKey>(['+', '-', '*', '/']);

interface CalculatorPopupProps {
  children: React.ReactNode;
  initialExpression?: string;
  allowNegative?: boolean;
  onApply: (result: number) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A modal calculator popup. Users enter an arithmetic expression via the
 * button grid or the keyboard, see a live preview of the result, and commit
 * the computed value back to the caller via `onApply`.
 *
 * Expression evaluation is delegated to the safe expression evaluator in
 * `src/utils/calculatorExpression.ts` — no `eval()` or `Function()`.
 */
export const CalculatorPopup: React.FC<CalculatorPopupProps> = ({
  children,
  initialExpression = '',
  allowNegative = false,
  onApply,
  open: controlledOpen,
  onOpenChange,
}) => {
  const { t } = useTranslation('common');
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const [expression, setExpression] = useState(initialExpression);
  const [hasError, setHasError] = useState(false);
  // Keep the latest initialExpression in a ref so open transitions pick up
  // the current value without re-running effects mid-session.
  const initialExpressionRef = useRef(initialExpression);
  useEffect(() => {
    initialExpressionRef.current = initialExpression;
  }, [initialExpression]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setExpression(initialExpressionRef.current);
        setHasError(false);
      }
      if (!isControlled) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  const previewResult = useMemo(() => {
    if (expression.trim() === '') {
      return null;
    }
    return tryEvaluateCalculatorExpression(expression);
  }, [expression]);

  const appendToExpression = useCallback((key: CalculatorKey) => {
    setHasError(false);
    setExpression((prev) => {
      if (OPERATOR_KEYS.has(key)) {
        // Replace a trailing operator so users can fluidly swap "+" for "*".
        // Keep a leading "-" for unary negation.
        if (prev.length > 1 && OPERATOR_KEYS.has(prev.slice(-1) as CalculatorKey)) {
          return prev.slice(0, -1) + key;
        }
      }
      return prev + key;
    });
  }, []);

  const handleClear = useCallback(() => {
    setHasError(false);
    setExpression('');
  }, []);

  const handleBackspace = useCallback(() => {
    setHasError(false);
    setExpression((prev) => prev.slice(0, -1));
  }, []);

  const handleEquals = useCallback(() => {
    if (expression.trim() === '') {
      return;
    }
    try {
      const result = evaluateCalculatorExpression(expression);
      setExpression(String(result));
      setHasError(false);
    } catch {
      setHasError(true);
    }
  }, [expression]);

  const handleKeyPress = useCallback(
    (key: CalculatorKey) => {
      if (key === 'C') {
        handleClear();
        return;
      }
      if (key === 'backspace') {
        handleBackspace();
        return;
      }
      if (key === '=') {
        handleEquals();
        return;
      }
      appendToExpression(key);
    },
    [appendToExpression, handleBackspace, handleClear, handleEquals],
  );

  const handleApply = useCallback(() => {
    try {
      const result = evaluateCalculatorExpression(expression);
      const finalResult = allowNegative ? result : Math.abs(result);
      onApply(finalResult);
      handleOpenChange(false);
    } catch {
      setHasError(true);
    }
  }, [expression, allowNegative, onApply, handleOpenChange]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow only characters valid in our expression grammar (digits, ops,
    // parens, decimal separators, whitespace). Strip anything else so pasted
    // text can't inject unexpected content.
    const filtered = e.target.value.replace(/[^0-9+\-*/().,\s]/g, '');
    setHasError(false);
    setExpression(filtered);
  }, []);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (previewResult !== null) {
          handleApply();
        } else {
          setHasError(true);
        }
      }
    },
    [handleApply, previewResult],
  );

  // Reset expression whenever the popup transitions to open. Intentionally
  // does NOT depend on `initialExpression` — changes to that prop while the
  // popup is already open must not clobber in-progress user input.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setExpression(initialExpressionRef.current);
      setHasError(false);
    }
    wasOpenRef.current = open;
  }, [open]);

  const canApply = previewResult !== null && !hasError;

  return (
    <AppDrawer
      trigger={children}
      open={open}
      onOpenChange={handleOpenChange}
      title={t('calculator.title')}
      actionTitle={t('actions.apply')}
      actionOnClick={handleApply}
      actionDisabled={!canApply}
      leftAction={t('actions.cancel')}
      shouldCloseOnLeftAction
      className="max-h-[90vh]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <input
            type="text"
            inputMode="decimal"
            aria-label={t('calculator.expression_placeholder')}
            className={cn(
              'border-input bg-primary-foreground h-12 w-full rounded-md border px-3 text-right text-lg',
              'focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-hidden',
              hasError && 'border-destructive text-destructive',
            )}
            value={expression}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            placeholder={t('calculator.expression_placeholder')}
            autoFocus
          />
          <div
            className={cn(
              'min-h-5 text-right text-sm',
              hasError ? 'text-destructive' : 'text-muted-foreground',
            )}
            aria-live="polite"
          >
            {hasError ? t('calculator.error') : previewResult !== null ? `= ${previewResult}` : ''}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2" role="group" aria-label={t('calculator.title')}>
          {KEY_ROWS.flatMap((row) =>
            row.map((key) => (
              <CalculatorButton
                key={key}
                calcKey={key}
                onPress={handleKeyPress}
                ariaLabel={
                  key === 'backspace'
                    ? t('calculator.backspace')
                    : key === 'C'
                      ? t('calculator.clear')
                      : key
                }
              />
            )),
          )}
        </div>
      </div>
    </AppDrawer>
  );
};

CalculatorPopup.displayName = 'CalculatorPopup';

interface CalculatorButtonProps {
  calcKey: CalculatorKey;
  onPress: (key: CalculatorKey) => void;
  ariaLabel: string;
}

const CalculatorButton: React.FC<CalculatorButtonProps> = ({ calcKey, onPress, ariaLabel }) => {
  const isOperator = OPERATOR_KEYS.has(calcKey) || calcKey === '=';
  const isAction = calcKey === 'C' || calcKey === 'backspace';

  const handleClick = useCallback(() => {
    onPress(calcKey);
  }, [calcKey, onPress]);

  return (
    <Button
      type="button"
      variant={isOperator ? 'default' : isAction ? 'secondary' : 'outline'}
      className="h-12 text-base"
      onClick={handleClick}
      aria-label={ariaLabel}
    >
      {calcKey === 'backspace' ? <DeleteIcon className="size-4" /> : calcKey}
    </Button>
  );
};
