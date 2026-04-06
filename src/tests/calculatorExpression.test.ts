import {
  evaluateCalculatorExpression,
  tryEvaluateCalculatorExpression,
} from '../utils/calculatorExpression';

describe('evaluateCalculatorExpression', () => {
  describe('valid expressions', () => {
    it.each<[string, number]>([
      ['1', 1],
      ['1+2', 3],
      ['1 + 2', 3],
      ['2*3', 6],
      ['10/4', 2.5],
      ['10-3-2', 5],
      ['2+3*4', 14],
      ['(2+3)*4', 20],
      ['((1+2)*3)', 9],
      ['-5', -5],
      ['-(3+2)', -5],
      ['3+-2', 1],
      ['3--2', 5],
      ['+4', 4],
      ['12.50+8*2', 28.5],
      ['12,50+8*2', 28.5],
      ['0.1+0.2', 0.3],
      ['100/0.5', 200],
      ['2*(3+4)-1', 13],
    ])('should evaluate %p to %p', (expr, expected) => {
      expect(evaluateCalculatorExpression(expr)).toBe(expected);
    });
  });

  describe('invalid expressions', () => {
    it.each([
      ['', 'empty'],
      ['   ', 'whitespace-only'],
      ['1+', 'trailing operator'],
      ['*5', 'leading binary operator'],
      ['(1+2', 'unclosed paren'],
      ['1+2)', 'extra paren'],
      ['1/0', 'division by zero'],
      ['abc', 'letters'],
      ['1..2', 'double decimal'],
      ['1 2', 'missing operator'],
    ])('should throw for %p (%s)', (expr) => {
      expect(() => evaluateCalculatorExpression(expr)).toThrow();
    });
  });

  describe('tryEvaluateCalculatorExpression', () => {
    it('returns a number for valid expressions', () => {
      expect(tryEvaluateCalculatorExpression('1+2')).toBe(3);
    });

    it('returns null for invalid expressions', () => {
      expect(tryEvaluateCalculatorExpression('1/0')).toBeNull();
      expect(tryEvaluateCalculatorExpression('(')).toBeNull();
      expect(tryEvaluateCalculatorExpression('')).toBeNull();
    });
  });

  it('does not use eval (sanity check)', () => {
    // An expression that would throw via `eval` but is syntactically benign as
    // A string template. This just makes sure our parser rejects non-math
    // Input rather than silently executing anything.
    expect(() => evaluateCalculatorExpression('console.log("x")')).toThrow();
  });
});
