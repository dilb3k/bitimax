import test from 'node:test';
import assert from 'node:assert/strict';
import { cdnImage, formatDate, formatDateTime, formatUzs } from './api';

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

test('cdnImage adds Cloudinary resizing once and leaves other URLs alone', () => {
  const stored = 'https://res.cloudinary.com/demo/image/upload/v1700000000/bitmax/products/a.jpg';
  const resized = cdnImage(stored, 640);
  assert.equal(resized, 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_640/v1700000000/bitmax/products/a.jpg');
  assert.equal(cdnImage(resized, 320), resized, 'already transformed');
  assert.equal(cdnImage('https://example.com/image/upload/x.jpg', 640), 'https://example.com/image/upload/x.jpg');
});
