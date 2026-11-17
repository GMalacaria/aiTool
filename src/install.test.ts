import { describe, expect, it } from 'vitest';
import { isIos, isStandalone } from './install';

describe('isIos', () => {
  it('recognises iPhone and iPadOS, not Android or a Mac', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 5)).toBe(false);
  });
});

describe('isStandalone', () => {
  const win = (displayMode: boolean, standalone?: boolean) =>
    ({ matchMedia: () => ({ matches: displayMode }), navigator: { standalone } }) as unknown as Window;

  it('is true when opened from the home-screen icon', () => {
    expect(isStandalone(win(true))).toBe(true);
    expect(isStandalone(win(false, true))).toBe(true);
    expect(isStandalone(win(false))).toBe(false);
  });
});
