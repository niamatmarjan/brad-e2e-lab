import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature, InvalidSignatureError, ExpiredTimestampError } from '../src/signature-validator.mjs';

test('Story 1.1: Webhook Signature Validator AC1 - Valid signature passes', () => {
  const secret = 'whsec_test_secret_key_12345';
  const now = 1700000000000;
  const timestamp = 1700000000;
  const payload = JSON.stringify({ event: 'payment.succeeded', id: 'evt_001' });
  const signed = `${timestamp}.${payload}`;
  const signature = createHmac('sha256', secret).update(signed).digest('hex');

  const valid = verifyWebhookSignature({ payload, signature, timestamp, secret, now });
  assert.equal(valid, true);
});

test('Story 1.1: Webhook Signature Validator AC2 - Expired timestamp throws ExpiredTimestampError', () => {
  const secret = 'whsec_test_secret_key_12345';
  const now = 1700000000000;
  const timestamp = 1699999000; // 1000 seconds in past
  const payload = 'test';
  const signature = 'abcd';

  assert.throws(() => {
    verifyWebhookSignature({ payload, signature, timestamp, secret, now });
  }, ExpiredTimestampError);
});

test('Story 1.1: Webhook Signature Validator AC3 - Tampered payload throws InvalidSignatureError', () => {
  const secret = 'whsec_test_secret_key_12345';
  const now = 1700000000000;
  const timestamp = 1700000000;
  const signature = createHmac('sha256', secret).update(`${timestamp}.original`).digest('hex');

  assert.throws(() => {
    verifyWebhookSignature({ payload: 'tampered', signature, timestamp, secret, now });
  }, InvalidSignatureError);
});

test('Story 1.1: DEFECT-G03-001 - Millisecond timestamp normalized correctly', () => {
  const secret = 'whsec_test_secret_key_12345';
  const now = 1700000000000;
  const timestampMs = 1700000000000; // millisecond format
  const expectedSeconds = 1700000000;
  const payload = 'event_payload';
  const signature = createHmac('sha256', secret).update(`${expectedSeconds}.${payload}`).digest('hex');

  const valid = verifyWebhookSignature({ payload, signature, timestamp: timestampMs, secret, now });
  assert.equal(valid, true);
});
