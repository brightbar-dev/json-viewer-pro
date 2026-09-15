import { describe, it, expect } from 'vitest';
import { hasImpreciseNumbers, LosslessNumber, losesPrecision, parseWithSource, reviverHasSource } from '../lib/lossless';

describe('losesPrecision', () => {
  const loses = ['9007199254740993', '149883901923910003', '12345678901234567890', '-9007199254740993',
    '39977290059340801', '0.1000000000000000055511151231257827', '123456789012345678901234567890',
    '1e400', '-1e400', '1e-400', '1.00000000000000000001',
    // Not the shortest repr of its double: the source digits differ from what a float64 prints, so keep them.
    '5.4800000000000004'];
  const keeps = ['0', '-0', '1', '1.0', '1e3', '1E+3', '1.5e300', '0.000', '9007199254740991',
    '12345678901234567000', '6.8500000000000005', '12.330000000000002', '0.30000000000000004', '100000000000000000000',
    '0.1', '-273.15', '123456789012345'];
  for (const s of loses) it(`${s} loses precision`, () => expect(losesPrecision(s)).toBe(true));
  for (const s of keeps) it(`${s} survives a float64`, () => expect(losesPrecision(s)).toBe(false));
});

describe('hasImpreciseNumbers (pre-scan)', () => {
  it('finds a big integer value', () => expect(hasImpreciseNumbers('{"id": 149883901923910003}')).toBe(true));
  it('finds one in an array on its own line', () => expect(hasImpreciseNumbers('[\n  12345678901234567890\n]')).toBe(true));
  it('finds a negative one', () => expect(hasImpreciseNumbers('[-9007199254740993]')).toBe(true));
  it('finds a long decimal', () => expect(hasImpreciseNumbers('{"p":0.1000000000000000055511151231257827}')).toBe(true));
  it('finds an overflowing exponent', () => expect(hasImpreciseNumbers('[1e400]')).toBe(true));
  it('finds a root number', () => expect(hasImpreciseNumbers('149883901923910003')).toBe(true));
  it('ignores digits inside a string', () => expect(hasImpreciseNumbers('{"id": "149883901923910003"}')).toBe(false));
  it('ignores hex that looks like an exponent', () => expect(hasImpreciseNumbers('{"sha": "a3e456b", "x": "03e456"}')).toBe(false));
  it('ignores float64 output that round-trips', () => expect(hasImpreciseNumbers('[6.8500000000000005, 12.330000000000002, 0.30000000000000004]')).toBe(false));
  it('ignores ordinary documents', () => expect(hasImpreciseNumbers('{"a": 1, "b": [2.5, -3], "c": "x"}')).toBe(false));
});

describe('LosslessNumber', () => {
  it('keeps its source', () => expect(new LosslessNumber('12345678901234567890').source).toBe('12345678901234567890'));
  it('prints as its source', () => expect(String(new LosslessNumber('149883901923910003'))).toBe('149883901923910003'));
  it('compares as a number', () => expect(+new LosslessNumber('1e400')).toBe(Infinity));
});

describe('parseWithSource', () => {
  it('matches the engine capability', () => {
    const r = parseWithSource('[149883901923910003, 1]');
    if (!reviverHasSource()) {
      expect(r).toBeNull();
      return;
    }
    expect(r!.preserved).toBe(1);
    const arr = r!.value as unknown[];
    expect(arr[0]).toBeInstanceOf(LosslessNumber);
    expect((arr[0] as LosslessNumber).source).toBe('149883901923910003');
    expect(arr[1]).toBe(1);
  });
});
