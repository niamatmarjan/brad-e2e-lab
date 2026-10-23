import test from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/rate-limiter.mjs';
import { RateLimiter as ExportedRateLimiter } from '../src/index.mjs';

test('re-export from src/index.mjs works', () => {
  assert.equal(RateLimiter, ExportedRateLimiter);
});

test('AC1: constructor accepts positive integer limit and positive finite windowMs (object config)', () => {
  const limiter = new RateLimiter({ limit: 5, windowMs: 1000 });
  assert.equal(limiter.limit, 5);
  assert.equal(limiter.windowMs, 1000);
});

test('AC1: constructor accepts positional arguments', () => {
  const limiter = new RateLimiter(10, 2000);
  assert.equal(limiter.limit, 10);
  assert.equal(limiter.windowMs, 2000);
});

test('AC1: constructor validates limit (must be positive integer)', () => {
  const invalidLimits = [0, -1, 2.5, '5', null, undefined, NaN, Infinity, -Infinity, {}, []];
  for (const limit of invalidLimits) {
    assert.throws(
      () => new RateLimiter({ limit, windowMs: 1000 }),
      TypeError,
      `Should throw TypeError for limit: ${limit}`
    );
    assert.throws(
      () => new RateLimiter(limit, 1000),
      TypeError,
      `Should throw TypeError for positional limit: ${limit}`
    );
  }
});

test('AC1: constructor validates windowMs (must be positive finite number)', () => {
  const invalidWindows = [0, -100, '1000', null, undefined, NaN, Infinity, -Infinity, {}, []];
  for (const windowMs of invalidWindows) {
    assert.throws(
      () => new RateLimiter({ limit: 5, windowMs }),
      TypeError,
      `Should throw TypeError for windowMs: ${windowMs}`
    );
    assert.throws(
      () => new RateLimiter(5, windowMs),
      TypeError,
      `Should throw TypeError for positional windowMs: ${windowMs}`
    );
  }
});

test('AC1: constructor validates now clock (must be a function)', () => {
  const invalidClocks = ['not-a-fn', 123, true, {}, []];
  for (const now of invalidClocks) {
    assert.throws(
      () => new RateLimiter({ limit: 5, windowMs: 1000, now }),
      TypeError,
      `Should throw TypeError for invalid clock: ${now}`
    );
    assert.throws(
      () => new RateLimiter(5, 1000, now),
      TypeError,
      `Should throw TypeError for positional invalid clock: ${now}`
    );
  }
});

test('AC2: consume rejects invalid, blank, or whitespace-only clientKey', () => {
  const limiter = new RateLimiter({ limit: 3, windowMs: 1000 });
  const invalidKeys = ['', '   ', '\t', '\n', ' \t \n ', null, undefined, 123, true, {}, []];

  for (const clientKey of invalidKeys) {
    assert.throws(
      () => limiter.consume(clientKey),
      TypeError,
      `Should throw TypeError for clientKey: ${JSON.stringify(clientKey)}`
    );
  }
});

test('AC2: trims client keys preventing whitespace padding bypass', () => {
  const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.consume('user-1').allowed, true);
  // Padding with spaces should map to the same key and be blocked
  assert.equal(limiter.consume('  user-1  ').allowed, false);
});

test('AC2: tracks counts independently across multiple clients (two-client isolation)', () => {
  let currentTime = 1000;
  const limiter = new RateLimiter({
    limit: 2,
    windowMs: 500,
    now: () => currentTime,
  });

  // Client A consumes full allowance
  const a1 = limiter.consume('client-A');
  assert.equal(a1.allowed, true);
  assert.equal(a1.remaining, 1);

  const a2 = limiter.consume('client-A');
  assert.equal(a2.allowed, true);
  assert.equal(a2.remaining, 0);

  const a3 = limiter.consume('client-A');
  assert.equal(a3.allowed, false);
  assert.equal(a3.remaining, 0);

  // Client B is unaffected by Client A's consumption
  const b1 = limiter.consume('client-B');
  assert.equal(b1.allowed, true);
  assert.equal(b1.remaining, 1);

  const b2 = limiter.consume('client-B');
  assert.equal(b2.allowed, true);
  assert.equal(b2.remaining, 0);

  // Client A is still blocked
  assert.equal(limiter.consume('client-A').allowed, false);

  // Client B is now also blocked
  assert.equal(limiter.consume('client-B').allowed, false);
});

test('AC3: allows up to limit requests and rejects excess with accurate metadata', () => {
  let currentTime = 5000;
  const limit = 3;
  const windowMs = 1000;
  const limiter = new RateLimiter({
    limit,
    windowMs,
    now: () => currentTime,
  });

  const res1 = limiter.consume('user-1');
  assert.deepEqual(res1, {
    allowed: true,
    limit: 3,
    remaining: 2,
    resetTime: 6000,
    resetMs: 1000,
    retryAfterMs: 0,
  });

  currentTime += 200; // t = 5200
  const res2 = limiter.consume('user-1');
  assert.deepEqual(res2, {
    allowed: true,
    limit: 3,
    remaining: 1,
    resetTime: 6000,
    resetMs: 800,
    retryAfterMs: 0,
  });

  currentTime += 100; // t = 5300
  const res3 = limiter.consume('user-1');
  assert.deepEqual(res3, {
    allowed: true,
    limit: 3,
    remaining: 0,
    resetTime: 6000,
    resetMs: 700,
    retryAfterMs: 0,
  });

  // 4th request: limit exceeded
  currentTime += 50; // t = 5350
  const res4 = limiter.consume('user-1');
  assert.deepEqual(res4, {
    allowed: false,
    limit: 3,
    remaining: 0,
    resetTime: 6000,
    resetMs: 650,
    retryAfterMs: 650,
  });
});

test('AC4: allowance resets at exactly the window boundary (exact expiry)', () => {
  let currentTime = 10000;
  const windowMs = 500;
  const limiter = new RateLimiter({
    limit: 2,
    windowMs,
    now: () => currentTime,
  });

  assert.equal(limiter.consume('client-1').allowed, true);
  assert.equal(limiter.consume('client-1').allowed, true);
  assert.equal(limiter.consume('client-1').allowed, false);

  // Just before expiry (t = 10499)
  currentTime = 10499;
  const blockedJustBefore = limiter.consume('client-1');
  assert.equal(blockedJustBefore.allowed, false);
  assert.equal(blockedJustBefore.resetMs, 1);
  assert.equal(blockedJustBefore.retryAfterMs, 1);

  // Exactly at boundary (t = 10500)
  currentTime = 10500;
  const resetAtBoundary = limiter.consume('client-1');
  assert.equal(resetAtBoundary.allowed, true);
  assert.equal(resetAtBoundary.remaining, 1);
  assert.equal(resetAtBoundary.resetTime, 11000);
  assert.equal(resetAtBoundary.resetMs, 500);
});

test('AC4: allowance resets after the window boundary (late request starts fresh window)', () => {
  let currentTime = 20000;
  const windowMs = 1000;
  const limiter = new RateLimiter({
    limit: 1,
    windowMs,
    now: () => currentTime,
  });

  assert.equal(limiter.consume('client-late').allowed, true);
  assert.equal(limiter.consume('client-late').allowed, false);

  // Advance well beyond expiry (t = 25000)
  currentTime = 25000;
  const lateRequest = limiter.consume('client-late');
  assert.equal(lateRequest.allowed, true);
  assert.equal(lateRequest.remaining, 0);
  assert.equal(lateRequest.resetTime, 26000);
  assert.equal(lateRequest.resetMs, 1000);
});

test('AC5: deterministic clock operation with stepped time', () => {
  let mockedTime = 0;
  const limiter = new RateLimiter({
    limit: 2,
    windowMs: 100,
    now: () => mockedTime,
  });

  // Window 1: begins at t = 0 with expiry at t = 100
  mockedTime = 0;
  assert.equal(limiter.consume('key').allowed, true);
  mockedTime = 50;
  assert.equal(limiter.consume('key').allowed, true);
  mockedTime = 90;
  assert.equal(limiter.consume('key').allowed, false);

  // Window 2: [100, 200)
  mockedTime = 100;
  assert.equal(limiter.consume('key').allowed, true);
  mockedTime = 105;
  assert.equal(limiter.consume('key').allowed, true);
  mockedTime = 110;
  assert.equal(limiter.consume('key').allowed, false);
});

test('High-resolution / floating-point clock yields ceiling integer resetMs', () => {
  let floatTime = 100.25;
  const limiter = new RateLimiter({
    limit: 1,
    windowMs: 500,
    now: () => floatTime,
  });

  limiter.consume('k');
  floatTime = 100.75;
  const res = limiter.consume('k');
  assert.equal(res.allowed, false);
  // resetTime is 600.25, remaining is 600.25 - 100.75 = 499.5 -> ceil is 500
  assert.equal(res.resetMs, 500);
  assert.equal(res.retryAfterMs, 500);
});

test('prune() evicts expired client records and preserves active ones', () => {
  let time = 1000;
  const limiter = new RateLimiter({
    limit: 2,
    windowMs: 500,
    now: () => time,
  });

  limiter.consume('active-client');
  limiter.consume('will-expire');
  assert.equal(limiter.clientCount, 2);

  // Advance time past expiry for both
  time = 1600;
  const evicted = limiter.prune();
  assert.equal(evicted, 2);
  assert.equal(limiter.clientCount, 0);
});

test('Clock function returning invalid value throws TypeError', () => {
  const limiter = new RateLimiter({
    limit: 1,
    windowMs: 1000,
    now: () => 'invalid-timestamp',
  });

  assert.throws(
    () => limiter.consume('key'),
    TypeError,
    'Should throw TypeError when now() returns non-number'
  );
});

test('reset() clears specific client or all clients', () => {
  let currentTime = 1000;
  const limiter = new RateLimiter({
    limit: 1,
    windowMs: 1000,
    now: () => currentTime,
  });

  limiter.consume('c1');
  limiter.consume('c2');
  assert.equal(limiter.consume('c1').allowed, false);
  assert.equal(limiter.consume('c2').allowed, false);

  // Reset c1 specifically
  limiter.reset('c1');
  assert.equal(limiter.consume('c1').allowed, true);
  assert.equal(limiter.consume('c2').allowed, false);

  // Reset all
  limiter.consume('c1'); // now c1 blocked again
  limiter.reset();
  assert.equal(limiter.consume('c1').allowed, true);
  assert.equal(limiter.consume('c2').allowed, true);
});

test('peek() on a never-seen client reports a full quota and does not create a client record', () => {
  const limiter = new RateLimiter({ limit: 5, windowMs: 1000 });
  assert.equal(limiter.clientCount, 0);

  const snapshot = limiter.peek('never-seen-client');
  assert.deepEqual(snapshot, {
    allowed: true,
    limit: 5,
    remaining: 5,
    resetTime: null,
    resetMs: 0,
    retryAfterMs: 0,
  });

  assert.equal(limiter.clientCount, 0);
});

test('peek() on a client with an active window does not consume any allowance or change its counters', () => {
  let currentTime = 1000;
  const limiter = new RateLimiter({
    limit: 3,
    windowMs: 1000,
    now: () => currentTime,
  });

  const consumed = limiter.consume('client-active');
  assert.equal(consumed.allowed, true);
  assert.equal(consumed.remaining, 2);
  assert.equal(limiter.clientCount, 1);

  const peeked = limiter.peek('client-active');
  assert.deepEqual(peeked, {
    allowed: true,
    limit: 3,
    remaining: 2,
    resetTime: 2000,
    resetMs: 1000,
    retryAfterMs: 0,
  });

  assert.equal(limiter.clientCount, 1);
  const nextConsume = limiter.consume('client-active');
  assert.equal(nextConsume.allowed, true);
  assert.equal(nextConsume.remaining, 1);
});

test('AC1: peek rejects invalid, blank, or whitespace-only clientKey', () => {
  const limiter = new RateLimiter({ limit: 3, windowMs: 1000 });
  const invalidKeys = ['', '   ', '\t', '\n', ' \t \n ', null, undefined, 123, true, {}, []];

  for (const clientKey of invalidKeys) {
    assert.throws(
      () => limiter.peek(clientKey),
      TypeError,
      'Should throw TypeError for clientKey: ' + JSON.stringify(clientKey)
    );
  }
});

test('AC1: peek trims client keys consistently with consume', () => {
  let currentTime = 1000;
  const limiter = new RateLimiter({
    limit: 2,
    windowMs: 1000,
    now: () => currentTime,
  });

  limiter.consume('user-trim');
  const snapshot = limiter.peek('   user-trim   ');
  assert.equal(snapshot.allowed, true);
  assert.equal(snapshot.remaining, 1);
  assert.equal(snapshot.resetTime, 2000);
});

test('AC2: peek on an exhausted window returns allowed: false and retryAfterMs equal to resetMs', () => {
  let currentTime = 1000;
  const limiter = new RateLimiter({
    limit: 2,
    windowMs: 1000,
    now: () => currentTime,
  });

  limiter.consume('client-exhausted');
  limiter.consume('client-exhausted');

  currentTime = 1300;
  const snapshot = limiter.peek('client-exhausted');
  assert.deepEqual(snapshot, {
    allowed: false,
    limit: 2,
    remaining: 0,
    resetTime: 2000,
    resetMs: 700,
    retryAfterMs: 700,
  });

  // Verify clientCount and counters remain untouched
  assert.equal(limiter.clientCount, 1);
  assert.equal(limiter.peek('client-exhausted').allowed, false);
});

test('AC3: peek on an expired window reports full quota without creating/resetting window or evicting record', () => {
  let currentTime = 1000;
  const limiter = new RateLimiter({
    limit: 3,
    windowMs: 1000,
    now: () => currentTime,
  });

  limiter.consume('client-expired');
  assert.equal(limiter.clientCount, 1);

  // Advance time past window reset
  currentTime = 2500;
  const snapshot = limiter.peek('client-expired');
  assert.deepEqual(snapshot, {
    allowed: true,
    limit: 3,
    remaining: 3,
    resetTime: null,
    resetMs: 0,
    retryAfterMs: 0,
  });

  // Stored state is NOT evicted or reset by peek
  assert.equal(limiter.clientCount, 1);

  // Next consume establishes a new window starting at current time
  const consumed = limiter.consume('client-expired');
  assert.equal(consumed.allowed, true);
  assert.equal(consumed.remaining, 2);
  assert.equal(consumed.resetTime, 3500);
  assert.equal(consumed.resetMs, 1000);
});

test('AC4: peek at exact window boundary (exact expiry) reports full quota without mutating state', () => {
  let currentTime = 1000;
  const limiter = new RateLimiter({
    limit: 2,
    windowMs: 1000,
    now: () => currentTime,
  });

  limiter.consume('client-boundary');
  limiter.consume('client-boundary');

  // Exact boundary: currentTime === resetTime (2000)
  currentTime = 2000;
  const snapshot = limiter.peek('client-boundary');
  assert.deepEqual(snapshot, {
    allowed: true,
    limit: 2,
    remaining: 2,
    resetTime: null,
    resetMs: 0,
    retryAfterMs: 0,
  });

  // Client record is preserved, not evicted
  assert.equal(limiter.clientCount, 1);
});

test('AC2 & AC5: peek with high-resolution / floating-point clock yields ceiling integer resetMs and retryAfterMs', () => {
  let currentTime = 1000;
  const limiter = new RateLimiter({
    limit: 2,
    windowMs: 1000,
    now: () => currentTime,
  });

  limiter.consume('client-fractional');
  limiter.consume('client-fractional');

  currentTime = 1500.2;
  const snapshot = limiter.peek('client-fractional');
  assert.equal(snapshot.allowed, false);
  assert.equal(snapshot.resetMs, 500);
  assert.equal(snapshot.retryAfterMs, 500);

  // Non-exhausted active window with fractional clock
  currentTime = 1000;
  const limiterActive = new RateLimiter({
    limit: 3,
    windowMs: 1000,
    now: () => currentTime,
  });
  limiterActive.consume('client-fractional-active');
  currentTime = 1200.7;
  const activeSnapshot = limiterActive.peek('client-fractional-active');
  assert.equal(activeSnapshot.allowed, true);
  assert.equal(activeSnapshot.resetMs, 800);
  assert.equal(activeSnapshot.retryAfterMs, 0);
});

test('AC5: peek throws TypeError when clock returns invalid or non-finite timestamp', () => {
  const invalidClocks = [
    () => 'not-a-number',
    () => NaN,
    () => Infinity,
    () => -Infinity,
    () => undefined,
    () => null,
  ];

  for (const badClock of invalidClocks) {
    const limiter = new RateLimiter({
      limit: 5,
      windowMs: 1000,
      now: badClock,
    });
    assert.throws(
      () => limiter.peek('client-bad-clock'),
      TypeError,
      'Should throw TypeError when clock returns non-finite value'
    );
  }
});

test('AC4: repeated peek calls preserve clientCount, counters, expiry, and subsequent consume behavior', () => {
  let currentTime = 1000;
  const limiter = new RateLimiter({
    limit: 3,
    windowMs: 1000,
    now: () => currentTime,
  });

  limiter.consume('client-repeat');
  assert.equal(limiter.clientCount, 1);

  // 5 repeated peeks at time 1100
  currentTime = 1100;
  for (let i = 0; i < 5; i++) {
    const p = limiter.peek('client-repeat');
    assert.equal(p.allowed, true);
    assert.equal(p.remaining, 2);
    assert.equal(p.resetTime, 2000);
    assert.equal(p.resetMs, 900);
    assert.equal(p.retryAfterMs, 0);
    assert.equal(limiter.clientCount, 1);
  }

  // Next consume succeeds as expected
  currentTime = 1200;
  const next = limiter.consume('client-repeat');
  assert.equal(next.allowed, true);
  assert.equal(next.remaining, 1);
  assert.equal(next.resetMs, 800);
});

test('AC2 & AC4: multi-client coexistence preserves independent peek quotas across clients', () => {
  let currentTime = 1000;
  const limiter = new RateLimiter({
    limit: 2,
    windowMs: 1000,
    now: () => currentTime,
  });

  // Client A consumes full quota (exhausted)
  limiter.consume('client-A');
  limiter.consume('client-A');

  // Client B consumes 1 of 2 (active)
  limiter.consume('client-B');

  // Client C is never seen (virgin)

  currentTime = 1200;
  // Peek client A: exhausted
  const peekA = limiter.peek('client-A');
  assert.equal(peekA.allowed, false);
  assert.equal(peekA.remaining, 0);
  assert.equal(peekA.resetMs, 800);
  assert.equal(peekA.retryAfterMs, 800);

  // Peek client B: active with quota
  const peekB = limiter.peek('client-B');
  assert.equal(peekB.allowed, true);
  assert.equal(peekB.remaining, 1);
  assert.equal(peekB.resetMs, 800);
  assert.equal(peekB.retryAfterMs, 0);

  // Peek client C: full allowance, no record created
  const peekC = limiter.peek('client-C');
  assert.equal(peekC.allowed, true);
  assert.equal(peekC.remaining, 2);
  assert.equal(peekC.resetTime, null);
  assert.equal(peekC.resetMs, 0);
  assert.equal(peekC.retryAfterMs, 0);

  // Stored clientCount must remain exactly 2 (A and B only)
  assert.equal(limiter.clientCount, 2);
});

test('Story 1.3 AC1/AC3: prune rejects invalid explicit timestamps before evicting anything', () => {
  const time = 1000;
  const limiter = new RateLimiter({ limit: 1, windowMs: 500, now: () => time });
  limiter.consume('a');
  limiter.consume('b');

  const invalid = ['0', '', null, true, false, {}, [], NaN, Infinity, -Infinity];
  for (const bad of invalid) {
    assert.throws(() => limiter.prune(bad), TypeError, 'prune(' + String(bad) + ')');
    assert.equal(limiter.clientCount, 2);
  }
});

test('Story 1.3 AC2/AC3: prune rejects invalid clock values when targetTime is omitted', () => {
  const clocks = [() => 'x', () => NaN, () => Infinity, () => -Infinity, () => undefined, () => null];
  for (const badClock of clocks) {
    let good = true;
    const limiter = new RateLimiter({
      limit: 1,
      windowMs: 500,
      now: () => (good ? 1000 : badClock()),
    });
    limiter.consume('a');
    good = false;
    assert.throws(() => limiter.prune(), TypeError);
    assert.equal(limiter.clientCount, 1);
  }
});

test('Story 1.3 AC4/AC5: prune with valid timestamps keeps exact-expiry semantics and returns eviction count', () => {
  let time = 1000;
  const limiter = new RateLimiter({ limit: 1, windowMs: 500, now: () => time });
  limiter.consume('early'); // resetTime 1500
  time = 1200;
  limiter.consume('late'); // resetTime 1700
  time = 1300;
  limiter.consume('latest'); // resetTime 1800

  assert.equal(limiter.prune(1499), 0);
  assert.equal(limiter.clientCount, 3);

  // exact expiry evicts only 'early'
  assert.equal(limiter.prune(1500), 1);
  assert.equal(limiter.clientCount, 2);

  // omitted targetTime uses the clock; exact expiry again
  time = 1700;
  assert.equal(limiter.prune(), 1);
  assert.equal(limiter.clientCount, 1);

  // negative and fractional finite values are valid
  assert.equal(limiter.prune(-5), 0);
  assert.equal(limiter.prune(1799.5), 0);
  assert.equal(limiter.prune(1800), 1);
  assert.equal(limiter.clientCount, 0);
});
