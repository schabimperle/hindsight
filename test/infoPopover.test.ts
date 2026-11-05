import { describe, expect, it } from 'vitest';
import de from '../src/i18n/de.json';
import en from '../src/i18n/en.json';
import { MESSAGE_CODES, type Translate } from '../src/model/messages';
import { infoFor } from '../src/ui/InfoPopover';

const lookup =
  (bundle: Record<string, unknown>): Translate =>
  (key) => {
    const v = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], bundle);
    if (typeof v !== 'string') throw new Error(`missing: ${key}`);
    return v;
  };

describe('explanation popover', () => {
  it('exists for uncovered withdrawal and late start, in both languages', () => {
    for (const code of ['withdrawal_uncovered', 'late_start']) {
      expect(MESSAGE_CODES).toContain(code);
      for (const bundle of [en, de]) {
        const info = infoFor(lookup(bundle), code);
        expect(info?.title.length).toBeGreaterThan(5);
        expect(info?.paragraphs.length).toBeGreaterThanOrEqual(1);
        expect(info?.paragraphs.every((x) => x.trim().length > 20)).toBe(true);
      }
    }
  });

  it('is absent for warnings without an explanation', () => {
    expect(infoFor(lookup(en), 'prices_stale')).toBeNull();
  });
});
