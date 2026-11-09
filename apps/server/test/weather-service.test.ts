import { describe, expect, it } from 'vitest';
import { jmaCodeToWmo, normalizedPlaceName } from '../src/modules/weather/service';

describe('jmaCodeToWmo', () => {
  it('maps Japanese weather descriptions to WMO codes', () => {
    expect(jmaCodeToWmo(undefined, '晴れ')).toBe(1);
    expect(jmaCodeToWmo(undefined, 'くもり')).toBe(3);
    expect(jmaCodeToWmo(undefined, '雨')).toBe(61);
    expect(jmaCodeToWmo(undefined, '雷を伴う雨')).toBe(95);
    expect(jmaCodeToWmo(undefined, '雪')).toBe(71);
    expect(jmaCodeToWmo(undefined, 'みぞれ')).toBe(71);
  });

  it('falls back to the JMA numeric code prefix', () => {
    expect(jmaCodeToWmo('100', undefined)).toBe(1);
    expect(jmaCodeToWmo('200', undefined)).toBe(3);
    expect(jmaCodeToWmo('300', undefined)).toBe(61);
    expect(jmaCodeToWmo('400', undefined)).toBe(71);
  });

  it('returns null for unknown input', () => {
    expect(jmaCodeToWmo(undefined, undefined)).toBeNull();
    expect(jmaCodeToWmo('999', '不明')).toBeNull();
  });
});

describe('normalizedPlaceName', () => {
  it('lowercases, normalizes, and strips settlement suffixes', () => {
    expect(normalizedPlaceName('Tokyo City')).toBe('tokyo');
    expect(normalizedPlaceName('Osaka')).toBe('osaka');
  });

  it('trims surrounding whitespace before stripping suffixes', () => {
    expect(normalizedPlaceName('  Hrólsfjörður Town ')).toBe('hrólsfjörður');
    expect(normalizedPlaceName('  Kyoto  ')).toBe('kyoto');
  });
});
