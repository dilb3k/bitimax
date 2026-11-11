import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatDateTime, formatUzs } from './api';

test('dates show Tashkent time with spelled-out Uzbek months, never raw Intl tokens', () => {
  // 12:00 UTC is 17:00 in Tashkent (UTC+5).
  assert.equal(formatDateTime('2026-11-11T12:00:00Z'), '11-noyabr, 17:00');
  assert.equal(formatDateTime('2026-01-05T19:30:00Z'), '6-yanvar, 00:30'); // crosses midnight
  assert.equal(formatDate('2026-11-11T12:00:00Z'), '11.11.2026');
  assert.doesNotMatch(formatDateTime('2026-11-11T12:00:00Z'), /M\d/);
});

test('prices use the same typographic apostrophe as the rest of the copy', () => {
  assert.equal(formatUzs(2400000), '2 400 000 so‘m');
});
