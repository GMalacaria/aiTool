import { describe, expect, it } from 'vitest';
import { streaks } from './stats';

describe('streaks', () => {
  it('finds the longest run and the current one ending today', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-16', '2026-11-17'];
    expect(streaks(days, '2026-11-17')).toEqual({ longest: 3, current: 2 });
  });

  it('keeps the current run alive until a whole day passes without use', () => {
    expect(streaks(['2026-11-15', '2026-11-16'], '2026-11-17')).toEqual({ longest: 2, current: 2 });
    expect(streaks(['2026-11-15', '2026-11-16'], '2026-11-18')).toEqual({ longest: 2, current: 0 });
  });

  it('crosses month and year boundaries, ignores duplicates and order', () => {
    const days = ['2027-01-01', '2026-12-31', '2026-12-30', '2026-12-31'];
    expect(streaks(days, '2027-01-01')).toEqual({ longest: 3, current: 3 });
  });

  it('is zero without any use', () => {
    expect(streaks([], '2026-11-17')).toEqual({ longest: 0, current: 0 });
  });
});
