import test from 'node:test';
import assert from 'node:assert/strict';
import { entitlements, FREE_MONTHLY_QUOTES, quotaExceeded } from '../src/plan.ts';

const NOW = new Date('2026-03-10T09:00:00.000Z');

test('a fresh account is on the trial and gets Pro features', () => {
  const ent = entitlements({ plan: 'free', trial_ends_at: '2026-03-20T09:00:00.000Z' }, NOW);
  assert.equal(ent.plan, 'pro');
  assert.equal(ent.trialing, true);
  assert.equal(ent.paid, false);
  assert.equal(ent.trial_days_left, 10);
  assert.equal(ent.monthly_quote_limit, null);
});

test('an expired trial falls back to the free limits', () => {
  const ent = entitlements({ plan: 'free', trial_ends_at: '2026-03-01T09:00:00.000Z' }, NOW);
  assert.equal(ent.plan, 'free');
  assert.equal(ent.trialing, false);
  assert.equal(ent.monthly_quote_limit, FREE_MONTHLY_QUOTES);
  assert.equal(ent.can_remove_branding, false);
  assert.equal(ent.can_upload_logo, false);
});

test('a paid plan without an end date stays Pro', () => {
  const ent = entitlements({ plan: 'pro', plan_until: null, trial_ends_at: null }, NOW);
  assert.equal(ent.plan, 'pro');
  assert.equal(ent.paid, true);
  assert.equal(ent.can_remove_branding, true);
});

test('a cancelled subscription keeps Pro until the period ends, then drops', () => {
  const stillPaid = entitlements({ plan: 'pro', plan_until: '2026-03-31T00:00:00.000Z' }, NOW);
  assert.equal(stillPaid.paid, true);

  const lapsed = entitlements({ plan: 'pro', plan_until: '2026-03-01T00:00:00.000Z' }, NOW);
  assert.equal(lapsed.plan, 'free');
  assert.equal(lapsed.paid, false);
});

test('the free quota bites exactly at the limit', () => {
  const free = entitlements({ plan: 'free', trial_ends_at: null }, NOW);
  assert.equal(quotaExceeded(free, FREE_MONTHLY_QUOTES - 1), false);
  assert.equal(quotaExceeded(free, FREE_MONTHLY_QUOTES), true);

  const pro = entitlements({ plan: 'pro' }, NOW);
  assert.equal(quotaExceeded(pro, 10_000), false);
});
