import { describe, expect, test } from 'vitest';
import { checkSum, makeSum } from '../../src/core/gate';

describe('grown-up sum', () => {
  test('makeSum answer in 7..18 with integer operands in 3..9', () => {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        let call = 0;
        const sum = makeSum(() => ((call++ % 2 === 0 ? i : j) + 0.5) / 7);
        expect(Number.isInteger(sum.a)).toBe(true);
        expect(Number.isInteger(sum.b)).toBe(true);
        expect(sum.a).toBeGreaterThanOrEqual(3);
        expect(sum.a).toBeLessThanOrEqual(9);
        expect(sum.b).toBeGreaterThanOrEqual(3);
        expect(sum.b).toBeLessThanOrEqual(9);
        expect(sum.answer).toBe(sum.a + sum.b);
        expect(sum.answer).toBeGreaterThanOrEqual(7);
        expect(sum.answer).toBeLessThanOrEqual(18);
      }
    }
  });

  test('handles a constant minimum rng without retrying forever', () => {
    expect(makeSum(() => 0).answer).toBe(7);
    expect(makeSum(() => 1 - Number.EPSILON).answer).toBe(18);
  });

  test('uses the default rng', () => {
    const sum = makeSum();
    expect(sum.answer).toBeGreaterThanOrEqual(7);
    expect(sum.answer).toBeLessThanOrEqual(18);
  });

  test('checkSum trims and accepts a matching answer', () => {
    expect(checkSum({ answer: 12 }, ' \t12\n')).toBe(true);
    expect(checkSum({ answer: 12 }, '11')).toBe(false);
  });

  test.each(['', ' ', 'twelve', '12abc', '12 0', 'NaN', 'Infinity', '0xC', '1.2e1', '12.0', '+12', '-12'])
    ('checkSum rejects non-digit input %j', input => {
      expect(checkSum({ answer: 12 }, input)).toBe(false);
    });
});
