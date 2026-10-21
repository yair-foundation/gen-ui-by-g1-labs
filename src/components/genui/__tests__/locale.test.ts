import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_LOCALE,
  formatRangeWithDash,
  resolveLocale,
} from '../locale';

describe('resolveLocale', () => {
  it('defaults to en-US', () => {
    assert.equal(DEFAULT_LOCALE, 'en-US');
    assert.equal(resolveLocale(undefined), 'en-US');
    assert.equal(resolveLocale(''), 'en-US');
    assert.equal(resolveLocale(null), 'en-US');
  });

  it('canonicalizes valid tags', () => {
    assert.equal(resolveLocale('en-gb'), 'en-GB');
    assert.equal(resolveLocale('he-IL'), 'he-IL');
  });

  it('falls back on invalid tags', () => {
    assert.equal(resolveLocale('not a locale!'), 'en-US');
  });
});

describe('formatRangeWithDash', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const range = (locale: string, a: string, b: string, o: Intl.DateTimeFormatOptions) =>
    formatRangeWithDash(
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...o }),
      day(a),
      day(b),
    );
  const short = { day: 'numeric', month: 'short' } as const;

  it('closes the dash between single terms', () => {
    assert.equal(range('en-GB', '2026-11-14', '2026-11-19', short), '14–19 Nov');
    assert.equal(range('en-US', '2026-11-14', '2026-11-19', short), 'Nov 14–19');
    assert.equal(range('fr-FR', '2026-11-14', '2026-11-19', short), '14–19 nov.');
  });

  it('spaces the dash when a term has a space', () => {
    assert.equal(range('en-GB', '2026-11-28', '2026-12-03', short), '28 Nov – 3 Dec');
    assert.equal(range('en-US', '2026-11-28', '2026-12-03', short), 'Nov 28 – Dec 3');
  });

  it('keeps the punctuation beside the dash and drops thin spaces', () => {
    const full = { dateStyle: 'full' } as const;
    assert.equal(
      range('de-DE', '2026-11-05', '2026-11-07', full),
      'Donnerstag, 5. – Samstag, 7. November 2026',
    );
    assert.equal(
      range('en-GB', '2026-11-05', '2026-11-07', full),
      'Thursday 5 November – Saturday 7 November 2026',
    );
    assert.equal(
      range('de-DE', '2026-11-14', '2026-11-19', short),
      '14.–19. Nov.',
    );
  });

  it('never leaves a thin space in the output', () => {
    for (const locale of ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'he-IL']) {
      for (const o of [short, { dateStyle: 'medium' }, { dateStyle: 'full' }] as const) {
        for (const [a, b] of [
          ['2026-11-14', '2026-11-19'],
          ['2026-11-28', '2026-12-03'],
          ['2026-12-28', '2027-01-03'],
        ]) {
          assert.doesNotMatch(range(locale, a, b, o), /\u2009/, `${locale} ${a}`);
        }
      }
    }
  });

  it('leaves a separator that is not an en dash alone', () => {
    const fmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'UTC' });
    const a = day('2026-11-14');
    const b = day('2026-11-19');
    assert.equal(formatRangeWithDash(fmt, a, b), fmt.formatRange(a, b));
  });

  it('is one date when both ends fall on the same day', () => {
    assert.equal(range('en-GB', '2026-11-14', '2026-11-14', short), '14 Nov');
  });
});
