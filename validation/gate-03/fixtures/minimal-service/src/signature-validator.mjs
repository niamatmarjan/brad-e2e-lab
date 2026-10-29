import { createHmac, timingSafeEqual } from 'node:crypto';

export class InvalidSignatureError extends Error {
  constructor(message = 'Invalid webhook signature') {
    super(message);
    this.name = 'InvalidSignatureError';
  }
}

export class ExpiredTimestampError extends Error {
  constructor(message = 'Webhook timestamp outside allowed tolerance') {
    super(message);
    this.name = 'ExpiredTimestampError';
  }
}

export function verifyWebhookSignature({ payload, signature, timestamp, secret, maxToleranceSeconds = 300, now = Date.now() }) {
  if (!payload || !signature || !timestamp || !secret) {
    throw new InvalidSignatureError('Missing required verification parameters');
  }

  const rawTs = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);
  const tsNum = rawTs > 1e11 ? Math.floor(rawTs / 1000) : rawTs;
  if (Number.isNaN(tsNum)) {
    throw new ExpiredTimestampError('Invalid timestamp format');
  }

  const currentSeconds = Math.floor(now / 1000);
  if (Math.abs(currentSeconds - tsNum) > maxToleranceSeconds) {
    throw new ExpiredTimestampError('Timestamp deviation exceeds maximum tolerance');
  }

  const signedPayload = `${tsNum}.${typeof payload === 'string' ? payload : JSON.stringify(payload)}`;
  const computedSignature = createHmac('sha256', secret).update(signedPayload).digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const compBuf = Buffer.from(computedSignature, 'hex');

  if (sigBuf.length !== compBuf.length || !timingSafeEqual(sigBuf, compBuf)) {
    throw new InvalidSignatureError('Cryptographic signature verification failed');
  }

  return true;
}
