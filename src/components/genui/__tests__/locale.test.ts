import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_LOCALE, resolveLocale } from '../locale';

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
