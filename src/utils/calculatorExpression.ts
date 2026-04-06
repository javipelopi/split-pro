/**
 * A minimal, safe arithmetic expression evaluator for the CalculatorPopup.
 *
 * Supports: decimal numbers, `+`, `-`, `*`, `/`, parentheses, unary minus.
 * Accepts `.` or `,` as decimal separators.
 *
 * Does NOT use `eval` / `Function`. Input is tokenized, converted to RPN via
 * the shunting-yard algorithm, and evaluated from the stack.
 */

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'uminus' }
  | { type: 'lparen' }
  | { type: 'rparen' };

const BINARY_PRECEDENCE: Record<'+' | '-' | '*' | '/', number> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
};

const UNARY_PRECEDENCE = 3;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const src = input.replace(/\s+/g, '');
  let i = 0;

  while (i < src.length) {
    const ch = src[i]!;

    // Number: digits with optional decimal separator (`.` or `,`).
    if ((ch >= '0' && ch <= '9') || ch === '.' || ch === ',') {
      let j = i;
      let hasDot = false;
      let digits = '';
      while (j < src.length) {
        const c = src[j]!;
        if (c >= '0' && c <= '9') {
          digits += c;
          j++;
          continue;
        }
        if ((c === '.' || c === ',') && !hasDot) {
          digits += '.';
          hasDot = true;
          j++;
          continue;
        }
        break;
      }
      if (digits === '' || digits === '.') {
        throw new Error(`Invalid number at position ${i}`);
      }
      const num = parseFloat(digits);
      if (Number.isNaN(num)) {
        throw new Error(`Invalid number: ${digits}`);
      }
      tokens.push({ type: 'num', value: num });
      i = j;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      // Decide unary vs binary minus/plus based on previous token.
      const prev = tokens[tokens.length - 1];
      const isUnaryContext =
        !prev || prev.type === 'op' || prev.type === 'uminus' || prev.type === 'lparen';
      if (ch === '-' && isUnaryContext) {
        tokens.push({ type: 'uminus' });
      } else if (ch === '+' && isUnaryContext) {
        // Unary plus is a no-op; just skip.
      } else {
        tokens.push({ type: 'op', value: ch });
      }
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }

  return tokens;
}

function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const stack: Token[] = [];

  for (const tok of tokens) {
    if (tok.type === 'num') {
      output.push(tok);
      continue;
    }
    if (tok.type === 'op') {
      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        if (top.type === 'op' && BINARY_PRECEDENCE[top.value] >= BINARY_PRECEDENCE[tok.value]) {
          output.push(stack.pop()!);
          continue;
        }
        if (top.type === 'uminus' && UNARY_PRECEDENCE >= BINARY_PRECEDENCE[tok.value]) {
          output.push(stack.pop()!);
          continue;
        }
        break;
      }
      stack.push(tok);
      continue;
    }
    if (tok.type === 'uminus') {
      stack.push(tok);
      continue;
    }
    if (tok.type === 'lparen') {
      stack.push(tok);
      continue;
    }
    if (tok.type === 'rparen') {
      let foundLParen = false;
      while (stack.length > 0) {
        const top = stack.pop()!;
        if (top.type === 'lparen') {
          foundLParen = true;
          break;
        }
        output.push(top);
      }
      if (!foundLParen) {
        throw new Error('Mismatched parentheses');
      }
      continue;
    }
  }

  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.type === 'lparen' || top.type === 'rparen') {
      throw new Error('Mismatched parentheses');
    }
    output.push(top);
  }

  return output;
}

function evaluateRPN(rpn: Token[]): number {
  const stack: number[] = [];
  for (const tok of rpn) {
    if (tok.type === 'num') {
      stack.push(tok.value);
      continue;
    }
    if (tok.type === 'uminus') {
      const a = stack.pop();
      if (a === undefined) {
        throw new Error('Invalid expression');
      }
      stack.push(-a);
      continue;
    }
    if (tok.type === 'op') {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) {
        throw new Error('Invalid expression');
      }
      switch (tok.value) {
        case '+':
          stack.push(a + b);
          break;
        case '-':
          stack.push(a - b);
          break;
        case '*':
          stack.push(a * b);
          break;
        case '/':
          if (b === 0) {
            throw new Error('Division by zero');
          }
          stack.push(a / b);
          break;
      }
      continue;
    }
    throw new Error('Invalid token in RPN');
  }
  if (stack.length !== 1) {
    throw new Error('Invalid expression');
  }
  return stack[0]!;
}

/**
 * Evaluate a simple arithmetic expression safely.
 *
 * Returns a finite number, or throws if the expression is invalid,
 * divides by zero, or produces a non-finite result.
 *
 * The result is rounded to 10 decimal places to suppress floating-point
 * artifacts like `0.1 + 0.2 = 0.30000000000000004`.
 */
export function evaluateCalculatorExpression(expression: string): number {
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new Error('Empty expression');
  }
  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    throw new Error('Empty expression');
  }
  const rpn = toRPN(tokens);
  const result = evaluateRPN(rpn);
  if (!Number.isFinite(result)) {
    throw new Error('Result is not a finite number');
  }
  // Round to 10 decimals to avoid FP drift on sums like 0.1 + 0.2.
  return Math.round(result * 1e10) / 1e10;
}

/** Non-throwing variant that returns `null` on failure. Useful for live previews. */
export function tryEvaluateCalculatorExpression(expression: string): number | null {
  try {
    return evaluateCalculatorExpression(expression);
  } catch {
    return null;
  }
}
