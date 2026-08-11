import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyStripeSignature } from '../src/routes/billing.ts';

const SECRET = 'whsec_test_secret';
const PAYLOAD = '{"type":"checkout.session.completed"}';
const NOW = new Date('2026-03-10T09:00:00.000Z');

async function sign(payload: string, timestamp: number, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

test('a correctly signed payload is accepted', async () => {
  const header = await sign(PAYLOAD, Math.floor(NOW.getTime() / 1000));
  assert.equal(await verifyStripeSignature(PAYLOAD, header, SECRET, 300, NOW), true);
});

test('a tampered payload is rejected', async () => {
  const header = await sign(PAYLOAD, Math.floor(NOW.getTime() / 1000));
  assert.equal(await verifyStripeSignature('{"type":"evil"}', header, SECRET, 300, NOW), false);
});

test('the wrong secret is rejected', async () => {
  const header = await sign(PAYLOAD, Math.floor(NOW.getTime() / 1000), 'whsec_other');
  assert.equal(await verifyStripeSignature(PAYLOAD, header, SECRET, 300, NOW), false);
});

test('a replayed old signature is rejected', async () => {
  const header = await sign(PAYLOAD, Math.floor(NOW.getTime() / 1000) - 3600);
  assert.equal(await verifyStripeSignature(PAYLOAD, header, SECRET, 300, NOW), false);
});

test('a malformed header is rejected', async () => {
  assert.equal(await verifyStripeSignature(PAYLOAD, '', SECRET, 300, NOW), false);
  assert.equal(await verifyStripeSignature(PAYLOAD, 'garbage', SECRET, 300, NOW), false);
  assert.equal(await verifyStripeSignature(PAYLOAD, 't=123', SECRET, 300, NOW), false);
});
