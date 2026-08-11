import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  canTransition,
  effectiveStatus,
  formatQuoteNumber,
  isEditable,
  isExpired,
  monthKey,
  needsFollowUp,
  winRate,
} from '../src/domain.ts';

const NOW = new Date('2026-03-10T09:00:00.000Z');

test('a quote is only editable while it is a draft', () => {
  assert.equal(isEditable('draft'), true);
  assert.equal(isEditable('sent'), false);
  assert.equal(isEditable('approved'), false);
});

test('validity runs to the end of the last day', () => {
  assert.equal(isExpired('2026-03-10', NOW), false); // valid "until today" still is
  assert.equal(isExpired('2026-03-09', NOW), true);
  assert.equal(isExpired(null, NOW), false);
  assert.equal(isExpired('not-a-date', NOW), false);
});

test('expiry is derived only for quotes still awaiting an answer', () => {
  assert.equal(effectiveStatus({ status: 'sent', valid_until: '2026-03-01' }, NOW), 'expired');
  assert.equal(effectiveStatus({ status: 'viewed', valid_until: '2026-03-01' }, NOW), 'expired');
  // A signed quote stays signed even after its validity date passes.
  assert.equal(effectiveStatus({ status: 'approved', valid_until: '2026-03-01' }, NOW), 'approved');
  assert.equal(effectiveStatus({ status: 'draft', valid_until: '2026-03-01' }, NOW), 'draft');
});

test('follow-ups surface only for live quotes that have gone quiet', () => {
  const base = { status: 'sent' as const, valid_until: '2026-04-01' };
  assert.equal(needsFollowUp({ ...base, sent_at: '2026-03-06T09:00:00.000Z' }, NOW), true);
  assert.equal(needsFollowUp({ ...base, sent_at: '2026-03-09T09:00:00.000Z' }, NOW), false);
  assert.equal(needsFollowUp({ ...base, sent_at: null }, NOW), false);
  // Expired and already-decided quotes are not chased.
  assert.equal(
    needsFollowUp({ status: 'sent', valid_until: '2026-03-01', sent_at: '2026-02-01T09:00:00.000Z' }, NOW),
    false
  );
  assert.equal(
    needsFollowUp({ status: 'approved', valid_until: '2026-04-01', sent_at: '2026-02-01T09:00:00.000Z' }, NOW),
    false
  );
});

test('status transitions block the nonsensical ones', () => {
  assert.equal(canTransition('draft', 'sent'), true);
  assert.equal(canTransition('sent', 'approved'), true);
  assert.equal(canTransition('approved', 'draft'), true); // reopening is allowed
  assert.equal(canTransition('draft', 'approved'), false); // must be sent first
  assert.equal(canTransition('cancelled', 'sent'), false);
});

test('quote numbers are zero padded behind the prefix', () => {
  assert.equal(formatQuoteNumber('', 1), '0001');
  assert.equal(formatQuoteNumber('Q-', 42), 'Q-0042');
  assert.equal(formatQuoteNumber('2026/', 12345), '2026/12345');
});

test('addDays crosses month boundaries', () => {
  assert.equal(addDays('2026-03-10', 14), '2026-03-24');
  assert.equal(addDays('2026-12-25', 10), '2027-01-04');
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
});

test('monthKey groups by calendar month', () => {
  assert.equal(monthKey('2026-03-31T22:00:00.000Z'), '2026-03');
  assert.equal(monthKey(new Date('2026-01-01T00:00:00.000Z')), '2026-01');
});

test('win rate counts decided quotes only', () => {
  const rate = winRate([
    { status: 'approved' },
    { status: 'approved' },
    { status: 'declined' },
    { status: 'sent' }, // still open — not a loss
  ]);
  assert.deepEqual(rate, { sent: 3, won: 2, rate: 2 / 3 });
  assert.deepEqual(winRate([]), { sent: 0, won: 0, rate: 0 });
});
