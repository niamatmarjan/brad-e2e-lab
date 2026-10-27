import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Account,
  Ledger,
  InvalidPrecisionError,
  IdempotencyConflictError,
  CurrencyMismatchError,
  DuplicateTransactionIdError,
  InsufficientFundsError,
  MAX_SAFE_AMOUNT,
  MAX_SAFE_UNITS,
  toBaseUnits,
  fromBaseUnits
} from '../src/index.mjs';

// ============================================================================
// ADVERSARIAL QA SUITE: BRAD OPERATION IRONCLAD REMEDIATION VERIFICATION
// ============================================================================

test('QA-ADV-01: Multi-tenant collision stress with 10 tenants sharing identical tx, account, and idempotency IDs', () => {
  const ledger = new Ledger();
  const TENANTS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];
  const SHARED_TX_ID = 'tx-universal-001';
  const SHARED_IDEM_KEY = 'idem-root-key';

  // Provision identical account topology across all 10 tenants
  for (const t of TENANTS) {
    ledger.createAccount({ id: 'operating', tenantId: t, type: 'asset', creditLimit: 1000 });
    ledger.createAccount({ id: 'clearing', tenantId: t, type: 'asset', creditLimit: 1000 });
  }

  // Each tenant posts with the exact same transaction ID and idempotency key, but different amounts
  TENANTS.forEach((t, idx) => {
    const amount = (idx + 1) * 10; // 10, 20, 30, ...
    const tx = ledger.postTransaction({
      id: SHARED_TX_ID,
      tenantId: t,
      idempotencyKey: SHARED_IDEM_KEY,
      description: `Tenant ${t} settlement`,
      entries: [
        { accountId: 'operating', amount, direction: 'credit' },
        { accountId: 'clearing', amount, direction: 'debit' }
      ]
    });
    assert.equal(tx.tenantId, t);
    assert.equal(tx.entries[0].amount, amount);
  });

  // Verify full isolation across all tenants
  TENANTS.forEach((t, idx) => {
    const expectedAmount = (idx + 1) * 10;
    const opAcc = ledger.getAccount(t, 'operating');
    const clAcc = ledger.getAccount(t, 'clearing');
    assert.equal(opAcc.balance, -expectedAmount, `Tenant ${t} operating balance mismatch`);
    assert.equal(clAcc.balance, expectedAmount, `Tenant ${t} clearing balance mismatch`);

    // Lookup via getTransaction
    const tx = ledger.getTransaction(t, SHARED_TX_ID);
    assert.ok(tx, `Transaction must exist for tenant ${t}`);
    assert.equal(tx.tenantId, t);
    assert.equal(tx.entries[0].amount, expectedAmount);

    // Replay idempotency
    const replayed = ledger.postTransaction({
      id: SHARED_TX_ID,
      tenantId: t,
      idempotencyKey: SHARED_IDEM_KEY,
      description: `Tenant ${t} settlement`,
      entries: [
        { accountId: 'operating', amount: expectedAmount, direction: 'credit' },
        { accountId: 'clearing', amount: expectedAmount, direction: 'debit' }
      ]
    });
    assert.equal(replayed.tenantId, t);
    assert.equal(replayed.entries[0].amount, expectedAmount);
  });

  // Verify non-existent tenant lookup returns null
  assert.equal(ledger.getTransaction('non_existent_tenant', SHARED_TX_ID), null);
});

test('QA-ADV-02: Comprehensive idempotency conflict detection across all payload dimensions', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'c', tenantId: 't1', type: 'asset', creditLimit: 500 });

  ledger.postTransaction({
    id: 'tx_base',
    tenantId: 't1',
    idempotencyKey: 'idem_strict',
    description: 'Initial payload',
    entries: [
      { accountId: 'a', amount: 50, direction: 'credit' },
      { accountId: 'b', amount: 50, direction: 'debit' }
    ]
  });

  // 1. Conflicting entry order
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_base',
        tenantId: 't1',
        idempotencyKey: 'idem_strict',
        description: 'Initial payload',
        entries: [
          { accountId: 'b', amount: 50, direction: 'debit' },
          { accountId: 'a', amount: 50, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof IdempotencyConflictError && err.code === 'IDEMPOTENCY_CONFLICT'
  );

  // 2. Conflicting entry count (split transaction)
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_base',
        tenantId: 't1',
        idempotencyKey: 'idem_strict',
        description: 'Initial payload',
        entries: [
          { accountId: 'a', amount: 50, direction: 'credit' },
          { accountId: 'b', amount: 25, direction: 'debit' },
          { accountId: 'c', amount: 25, direction: 'debit' }
        ]
      });
    },
    (err) => err instanceof IdempotencyConflictError && err.code === 'IDEMPOTENCY_CONFLICT'
  );

  // 3. Conflicting entry direction
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_base',
        tenantId: 't1',
        idempotencyKey: 'idem_strict',
        description: 'Initial payload',
        entries: [
          { accountId: 'a', amount: 50, direction: 'debit' },
          { accountId: 'b', amount: 50, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof IdempotencyConflictError && err.code === 'IDEMPOTENCY_CONFLICT'
  );

  // 4. Conflicting entry amount
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_base',
        tenantId: 't1',
        idempotencyKey: 'idem_strict',
        description: 'Initial payload',
        entries: [
          { accountId: 'a', amount: 50.0001, direction: 'credit' },
          { accountId: 'b', amount: 50.0001, direction: 'debit' }
        ]
      });
    },
    (err) => err instanceof IdempotencyConflictError && err.code === 'IDEMPOTENCY_CONFLICT'
  );

  // 5. Conflicting description
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_base',
        tenantId: 't1',
        idempotencyKey: 'idem_strict',
        description: 'Modified description payload',
        entries: [
          { accountId: 'a', amount: 50, direction: 'credit' },
          { accountId: 'b', amount: 50, direction: 'debit' }
        ]
      });
    },
    (err) => err instanceof IdempotencyConflictError && err.code === 'IDEMPOTENCY_CONFLICT'
  );

  // 6. Valid idempotency replay returns original transaction id and structure
  const replayed = ledger.postTransaction({
    id: 'tx_base',
    tenantId: 't1',
    idempotencyKey: 'idem_strict',
    description: 'Initial payload',
    entries: [
      { accountId: 'a', amount: 50, direction: 'credit' },
      { accountId: 'b', amount: 50, direction: 'debit' }
    ]
  });
  assert.equal(replayed.id, 'tx_base');
  assert.equal(replayed.status, 'POSTED');
  assert.equal(replayed.entries[0].amount, 50);
});

test('QA-ADV-03: Zero-sum micro-boundary enforcement and prevention of sub-cent balance drift', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'acc1', tenantId: 't1', type: 'asset', creditLimit: 5000 });
  ledger.createAccount({ id: 'acc2', tenantId: 't1', type: 'asset', creditLimit: 5000 });

  // Disallow any transaction with 0.0001 imbalance
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_imbalance_1',
        tenantId: 't1',
        entries: [
          { accountId: 'acc1', amount: 100.0001, direction: 'debit' },
          { accountId: 'acc2', amount: 100.0000, direction: 'credit' }
        ]
      });
    },
    /Unbalanced transaction/
  );

  // Reject fractional sub-cents beyond 4 decimal places (e.g. 5, 6, 7 decimal places)
  const subCentAmounts = [10.00001, 10.00005, 10.00009, 1.000001, 0.00004];
  for (const amt of subCentAmounts) {
    assert.throws(
      () => {
        ledger.postTransaction({
          id: `tx_sub_${amt}`,
          tenantId: 't1',
          entries: [
            { accountId: 'acc1', amount: amt, direction: 'debit' },
            { accountId: 'acc2', amount: amt, direction: 'credit' }
          ]
        });
      },
      (err) => err instanceof InvalidPrecisionError && err.code === 'INVALID_PRECISION'
    );
  }

  // Multi-legged 10-entry zero-sum split transaction conserving exact balance
  const entries = [];
  for (let i = 0; i < 5; i++) {
    entries.push({ accountId: 'acc1', amount: 10.1234, direction: 'debit' });
  }
  for (let i = 0; i < 5; i++) {
    entries.push({ accountId: 'acc2', amount: 10.1234, direction: 'credit' });
  }

  const multiTx = ledger.postTransaction({
    id: 'tx_multi_leg_exact',
    tenantId: 't1',
    entries
  });
  assert.equal(multiTx.status, 'POSTED');
  assert.equal(ledger.getAccount('t1', 'acc1').balance, 50.6170);
  assert.equal(ledger.getAccount('t1', 'acc2').balance, -50.6170);

  // Balance conservation invariant holds: acc1 + acc2 == 0
  const netConservation = ledger.getAccount('t1', 'acc1').balance + ledger.getAccount('t1', 'acc2').balance;
  assert.equal(Math.round(netConservation * 10000) / 10000, 0);
});

test('QA-ADV-04: Mid-execution failure rollback preserves multiple accounts and purges partial audit events', () => {
  const ledger = new Ledger();
  const accA = ledger.createAccount({ id: 'acc_a', tenantId: 't1', type: 'asset', creditLimit: 1000 });
  const accB = ledger.createAccount({ id: 'acc_b', tenantId: 't1', type: 'asset', creditLimit: 1000 });
  const accC = ledger.createAccount({ id: 'acc_c', tenantId: 't1', type: 'asset', creditLimit: 1000 });

  accA.applyEntry(10, 'debit'); // balance 10
  accB.applyEntry(10, 'debit'); // balance 10
  accC.applyEntry(100, 'debit'); // balance 100

  const initialAuditLength = ledger.auditEvents.length;

  // Intercept _emitAuditEvent after 1 leg has entered overdraft and emitted an event
  let calls = 0;
  const originalEmit = ledger._emitAuditEvent.bind(ledger);
  ledger._emitAuditEvent = (params) => {
    calls++;
    if (calls === 2) {
      throw new Error('Forced mid-transaction explosion on leg 2');
    }
    return originalEmit(params);
  };

  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_crash_test',
        tenantId: 't1',
        entries: [
          { accountId: 'acc_a', amount: 50, direction: 'credit' }, // Leg 1: draws acc_a to -40 (overdraft, emits call 1)
          { accountId: 'acc_b', amount: 50, direction: 'credit' }, // Leg 2: draws acc_b to -40 (overdraft, crashes on call 2)
          { accountId: 'acc_c', amount: 100, direction: 'debit' }   // Leg 3: never reached
        ]
      });
    },
    /Forced mid-transaction explosion/
  );

  // Balances must be exactly restored to initial pre-transaction state
  assert.equal(accA.balance, 10, 'acc_a must be rolled back');
  assert.equal(accB.balance, 10, 'acc_b must be rolled back');
  assert.equal(accC.balance, 100, 'acc_c must be rolled back');

  // Audit events array must not contain partial/orphaned events from aborted tx
  assert.equal(ledger.auditEvents.length, initialAuditLength, 'Audit events must be rolled back');

  // Transaction must not be registered
  assert.equal(ledger.getTransaction('t1', 'tx_crash_test'), null);
});

test('QA-ADV-05: In-depth defensive cloning prevents deep tampering with internal state', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 500 });

  const tx = ledger.postTransaction({
    id: 'tx_deep_freeze',
    tenantId: 't1',
    idempotencyKey: 'idem_freeze',
    description: 'Original immutable transaction',
    entries: [
      { accountId: 'a', amount: 100, direction: 'credit' },
      { accountId: 'b', amount: 100, direction: 'debit' }
    ]
  });

  // Adversarially mutate returned transaction properties and entries array
  tx.status = 'COMPROMISED';
  tx.entries[0].amount = 999999;
  tx.entries.push({ accountId: 'fake', amount: 1000, direction: 'debit' });
  delete tx.tenantId;

  // Verify internal stored transaction remains completely uncorrupted
  const fetched = ledger.getTransaction('t1', 'tx_deep_freeze');
  assert.equal(fetched.status, 'POSTED');
  assert.equal(fetched.tenantId, 't1');
  assert.equal(fetched.entries.length, 2);
  assert.equal(fetched.entries[0].amount, 100);

  // Adversarially mutate fetched transaction
  fetched.entries[0].amount = 888888;
  const fetchedAgain = ledger.getTransaction('t1', 'tx_deep_freeze');
  assert.equal(fetchedAgain.entries[0].amount, 100);

  // Replay also returns an unpolluted copy
  const replay = ledger.postTransaction({
    id: 'tx_deep_freeze',
    tenantId: 't1',
    idempotencyKey: 'idem_freeze',
    description: 'Original immutable transaction',
    entries: [
      { accountId: 'a', amount: 100, direction: 'credit' },
      { accountId: 'b', amount: 100, direction: 'debit' }
    ]
  });
  assert.equal(replay.status, 'POSTED');
  assert.equal(replay.entries[0].amount, 100);
  assert.equal(replay.entries.length, 2);
});

test('QA-ADV-06: Delimiter injection attacks across all input vectors', () => {
  const ledger = new Ledger();

  const injectionStrings = [
    'tenant:sub',
    ':tenant',
    'tenant:',
    'a:b:c',
    't::1'
  ];

  for (const maliciousStr of injectionStrings) {
    // 1. Account creation id injection
    assert.throws(
      () => ledger.createAccount({ id: maliciousStr, tenantId: 'valid_tenant', type: 'asset' }),
      (err) => err instanceof TypeError && /delimiter/i.test(err.message)
    );

    // 2. Account creation tenantId injection
    assert.throws(
      () => ledger.createAccount({ id: 'valid_acc', tenantId: maliciousStr, type: 'asset' }),
      (err) => err instanceof TypeError && /delimiter/i.test(err.message)
    );

    // 3. postTransaction id injection
    assert.throws(
      () => ledger.postTransaction({
        id: maliciousStr,
        tenantId: 'valid_tenant',
        entries: [{ accountId: 'a', amount: 10, direction: 'debit' }, { accountId: 'b', amount: 10, direction: 'credit' }]
      }),
      (err) => err instanceof TypeError && /delimiter/i.test(err.message)
    );

    // 4. postTransaction tenantId injection
    assert.throws(
      () => ledger.postTransaction({
        id: 'valid_tx',
        tenantId: maliciousStr,
        entries: [{ accountId: 'a', amount: 10, direction: 'debit' }, { accountId: 'b', amount: 10, direction: 'credit' }]
      }),
      (err) => err instanceof TypeError && /delimiter/i.test(err.message)
    );

    // 5. postTransaction idempotencyKey injection
    assert.throws(
      () => ledger.postTransaction({
        id: 'valid_tx',
        tenantId: 'valid_tenant',
        idempotencyKey: maliciousStr,
        entries: [{ accountId: 'a', amount: 10, direction: 'debit' }, { accountId: 'b', amount: 10, direction: 'credit' }]
      }),
      (err) => err instanceof TypeError && /delimiter/i.test(err.message)
    );
  }
});

test('QA-ADV-07: Overdraft lifecycle and transition telemetry (clearing, reduction, and disabled limits)', () => {
  const ledger = new Ledger();
  const acc = ledger.createAccount({ id: 'cash', tenantId: 't1', type: 'asset', creditLimit: 200, overdraftEnabled: true });
  ledger.createAccount({ id: 'exp', tenantId: 't1', type: 'expense' });
  ledger.createAccount({ id: 'rev', tenantId: 't1', type: 'revenue' });

  // 1. Enter overdraft: draw $100 -> balance -100
  const tx1 = ledger.postTransaction({
    id: 'tx_draw_100',
    tenantId: 't1',
    entries: [
      { accountId: 'cash', amount: 100, direction: 'credit' },
      { accountId: 'exp', amount: 100, direction: 'debit' }
    ]
  });
  assert.equal(tx1.overdraftUtilized, true);
  assert.equal(tx1.overdraftAmount, 100);
  assert.equal(tx1.remainingCredit, 100);

  // 2. Partial repayment of $40 -> balance becomes -60
  const tx2 = ledger.postTransaction({
    id: 'tx_repay_40',
    tenantId: 't1',
    entries: [
      { accountId: 'cash', amount: 40, direction: 'debit' },
      { accountId: 'rev', amount: 40, direction: 'credit' }
    ]
  });
  // Must NOT be tagged as overdraftUtilized
  assert.equal(tx2.overdraftUtilized, undefined);
  assert.equal(tx2.overdraftAmount, undefined);

  // Check audit events for OVERDRAFT_REDUCED
  const events = ledger.getAuditEvents('t1', 'cash');
  const reducedEvents = events.filter(e => e.type === 'OVERDRAFT_REDUCED');
  assert.equal(reducedEvents.length, 1);
  assert.equal(reducedEvents[0].details.repaidPortion, 40);

  // 3. Full clearance: deposit $100 -> balance becomes +40
  const tx3 = ledger.postTransaction({
    id: 'tx_repay_100',
    tenantId: 't1',
    entries: [
      { accountId: 'cash', amount: 100, direction: 'debit' },
      { accountId: 'rev', amount: 100, direction: 'credit' }
    ]
  });
  assert.equal(tx3.overdraftUtilized, undefined);

  const clearedEvents = ledger.getAuditEvents('t1', 'cash').filter(e => e.type === 'OVERDRAFT_CLEARED');
  assert.equal(clearedEvents.length, 1);
  assert.equal(clearedEvents[0].currentBalance, 40);
  assert.equal(clearedEvents[0].details.clearedDeficit, 60);

  // 4. Overdraft disabled: create account with overdraftEnabled = false, creditLimit = 500
  const lockedAcc = ledger.createAccount({ id: 'locked', tenantId: 't1', type: 'asset', creditLimit: 500, overdraftEnabled: false });
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_locked_breach',
        tenantId: 't1',
        entries: [
          { accountId: 'locked', amount: 80, direction: 'credit' },
          { accountId: 'exp', amount: 80, direction: 'debit' }
        ]
      });
    },
    (err) => err instanceof InsufficientFundsError && err.code === 'INSUFFICIENT_FUNDS'
  );

  const lockedEvents = ledger.getAuditEvents('t1', 'locked');
  assert.equal(lockedEvents.length, 1);
  assert.equal(lockedEvents[0].type, 'OVERDRAFT_LIMIT_BREACH_REJECTED');
  assert.equal(lockedEvents[0].details.excessAmount, 80); // Exact excess amount above 0
  assert.equal(lockedEvents[0].remainingCredit, 0); // 0 remaining credit when disabled
});

test('QA-ADV-08: Net aggregated balance evaluation eliminates order bias on multi-leg same-account transactions', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'wallet', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'partner', tenantId: 't1', type: 'asset', creditLimit: 500 });

  // Multiple legs touching 'wallet':
  // Credit 80 (draws -80)
  // Debit 30 (returns +30, net -50)
  // Credit 40 (draws -40, net -90)
  // Debit 20 (returns +20, net -70)
  // Net delta = -80 + 30 - 40 + 20 = -70.
  // With creditLimit = 100, -70 is fully valid.
  // In un-aggregated sequential processing, intermediate balance hits -80, -90, etc., but if credit 80 + credit 40 were evaluated together without debits, it would hit -120 > 100 limit!
  const tx = ledger.postTransaction({
    id: 'tx_interleaved_legs',
    tenantId: 't1',
    entries: [
      { accountId: 'wallet', amount: 80, direction: 'credit' },
      { accountId: 'wallet', amount: 40, direction: 'credit' }, // intermediate sum = -120 if evaluated without debits!
      { accountId: 'wallet', amount: 30, direction: 'debit' },
      { accountId: 'wallet', amount: 20, direction: 'debit' },
      { accountId: 'partner', amount: 70, direction: 'debit' } // Balances transaction: debits 30+20+70=120, credits 80+40=120
    ]
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(ledger.getAccount('t1', 'wallet').balance, -70);
  assert.equal(ledger.getAccount('t1', 'partner').balance, 70);
});

test('QA-ADV-09: Currency segregation across multi-legged transactions and cross-tenant independence', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'usd_1', tenantId: 't1', type: 'asset', currency: 'USD', creditLimit: 500 });
  ledger.createAccount({ id: 'usd_2', tenantId: 't1', type: 'asset', currency: 'USD', creditLimit: 500 });
  ledger.createAccount({ id: 'gbp_1', tenantId: 't1', type: 'asset', currency: 'GBP', creditLimit: 500 });

  // 3-legged transaction mixing USD and GBP
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_mixed_currencies',
        tenantId: 't1',
        entries: [
          { accountId: 'usd_1', amount: 50, direction: 'credit' },
          { accountId: 'usd_2', amount: 50, direction: 'debit' },
          { accountId: 'gbp_1', amount: 0, direction: 'credit' } // Even if 0 or non-zero, currency mismatch
        ]
      });
    },
    (err) => err instanceof CurrencyMismatchError || err.code === 'CURRENCY_MISMATCH' || err instanceof TypeError
  );
});

test('QA-ADV-10: Input validation edge cases: empty strings, whitespace, nulls, and tenant mismatches', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'acc1', tenantId: 't1', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'acc2', tenantId: 't1', type: 'asset', creditLimit: 500 });

  // Whitespace accountId
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_ws',
        tenantId: 't1',
        entries: [
          { accountId: '   ', amount: 10, direction: 'debit' },
          { accountId: 'acc2', amount: 10, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof TypeError && /accountId/i.test(err.message)
  );

  // Null accountId
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_null',
        tenantId: 't1',
        entries: [
          { accountId: null, amount: 10, direction: 'debit' },
          { accountId: 'acc2', amount: 10, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof TypeError && /accountId/i.test(err.message)
  );

  // Mismatched tenantId in entry
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_tenant_tamper',
        tenantId: 't1',
        entries: [
          { accountId: 'acc1', tenantId: 't2', amount: 10, direction: 'debit' },
          { accountId: 'acc2', amount: 10, direction: 'credit' }
        ]
      });
    },
    /Cross-tenant entry rejected/
  );
});

// ============================================================================
// QA-ADV-11: Precision and Safe Integer boundary values
// ============================================================================
test('QA-ADV-11: Precision and Safe Integer boundary values', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'acc_hi', tenantId: 't_safe', type: 'asset', creditLimit: MAX_SAFE_AMOUNT });
  ledger.createAccount({ id: 'contra_hi', tenantId: 't_safe', type: 'equity' });

  // 1. Exact MAX_SAFE_AMOUNT (900719925474.0991) passes valid 4-decimal precision
  const txBoundary = ledger.postTransaction({
    id: 'tx_boundary_pass',
    tenantId: 't_safe',
    entries: [
      { accountId: 'acc_hi', amount: MAX_SAFE_AMOUNT, direction: 'debit' },
      { accountId: 'contra_hi', amount: MAX_SAFE_AMOUNT, direction: 'credit' }
    ]
  });
  assert.equal(txBoundary.status, 'POSTED');
  assert.equal(ledger.getAccount('t_safe', 'acc_hi').balance, MAX_SAFE_AMOUNT);

  // 2. MAX_SAFE_AMOUNT + 0.0001 throws InvalidPrecisionError
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_boundary_plus_micro',
        tenantId: 't_safe',
        entries: [
          { accountId: 'acc_hi', amount: MAX_SAFE_AMOUNT + 0.0001, direction: 'debit' },
          { accountId: 'contra_hi', amount: MAX_SAFE_AMOUNT + 0.0001, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof InvalidPrecisionError && /exceeds maximum safe integer monetary limit/i.test(err.message)
  );

  // 3. Integer 900719925475 throws InvalidPrecisionError
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_unsafe_int',
        tenantId: 't_safe',
        entries: [
          { accountId: 'acc_hi', amount: 900719925475, direction: 'debit' },
          { accountId: 'contra_hi', amount: 900719925475, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof InvalidPrecisionError && /exceeds maximum safe integer monetary limit/i.test(err.message)
  );

  // 4. Sub-cent precision near large numbers fails (5-6 decimals)
  ledger.createAccount({ id: 'acc_sub', tenantId: 't_safe', type: 'asset', creditLimit: 500000000 });
  ledger.createAccount({ id: 'contra_sub', tenantId: 't_safe', type: 'equity' });
  const largeSubcents = [
    100000000.00001,
    50000000.00005,
    10000000.00001,
    1000000.00005
  ];
  for (const amt of largeSubcents) {
    assert.throws(
      () => {
        ledger.postTransaction({
          id: `tx_subcent_${Math.floor(amt)}`,
          tenantId: 't_safe',
          entries: [
            { accountId: 'acc_sub', amount: amt, direction: 'debit' },
            { accountId: 'contra_sub', amount: amt, direction: 'credit' }
          ]
        });
      },
      (err) => err instanceof InvalidPrecisionError && /exceeds maximum precision of 4 decimal places/i.test(err.message)
    );
  }

  // 5. Account creditLimit enforcement on MAX_SAFE_AMOUNT boundaries
  assert.throws(
    () => {
      ledger.createAccount({
        id: 'acc_overflow_limit',
        tenantId: 't_safe',
        type: 'asset',
        creditLimit: MAX_SAFE_AMOUNT + 0.0001
      });
    },
    (err) => err instanceof InvalidPrecisionError
  );

  assert.throws(
    () => {
      ledger.createAccount({
        id: 'acc_unsafe_limit',
        tenantId: 't_safe',
        type: 'asset',
        creditLimit: 900719925475
      });
    },
    (err) => err instanceof InvalidPrecisionError
  );
});

// ============================================================================
// QA-ADV-12: Idempotency conflict matrix on transaction ID variations with identical entries
// ============================================================================
test('QA-ADV-12: Idempotency conflict matrix on transaction ID variations with identical entries', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'acc_src', tenantId: 't_matrix', type: 'asset', creditLimit: 1000 });
  ledger.createAccount({ id: 'acc_dst', tenantId: 't_matrix', type: 'asset', creditLimit: 1000 });

  const SHARED_IDEM_KEY = 'idem-matrix-shared-key';
  const canonicalEntries = [
    { accountId: 'acc_src', amount: 350.50, direction: 'credit' },
    { accountId: 'acc_dst', amount: 350.50, direction: 'debit' }
  ];

  // 1. Post initial canonical transaction
  const initialTx = ledger.postTransaction({
    id: 'tx_canonical_001',
    tenantId: 't_matrix',
    idempotencyKey: SHARED_IDEM_KEY,
    description: 'Matrix transfer',
    entries: canonicalEntries
  });
  assert.equal(initialTx.id, 'tx_canonical_001');
  assert.equal(ledger.getAccount('t_matrix', 'acc_src').balance, -350.50);
  assert.equal(ledger.getAccount('t_matrix', 'acc_dst').balance, 350.50);

  // 2. Exact match replay succeeds
  const exactReplay = ledger.postTransaction({
    id: 'tx_canonical_001',
    tenantId: 't_matrix',
    idempotencyKey: SHARED_IDEM_KEY,
    description: 'Matrix transfer',
    entries: canonicalEntries
  });
  assert.equal(exactReplay.id, 'tx_canonical_001');
  assert.equal(ledger.getAccount('t_matrix', 'acc_src').balance, -350.50);

  // 3. Conflict Matrix: Variation in transaction ID with identical entries and description
  const conflictingIds = [
    'tx_canonical_002',
    'TX_CANONICAL_001',
    'tx_canonical_001_v2',
    'tx_canonical_001_copy',
    'tx_diff'
  ];

  for (const conflictId of conflictingIds) {
    assert.throws(
      () => {
        ledger.postTransaction({
          id: conflictId,
          tenantId: 't_matrix',
          idempotencyKey: SHARED_IDEM_KEY,
          description: 'Matrix transfer',
          entries: canonicalEntries
        });
      },
      (err) => err instanceof IdempotencyConflictError || err.code === 'IDEMPOTENCY_CONFLICT',
      `Replaying idempotency key with conflicting ID "${conflictId}" must throw IdempotencyConflictError`
    );

    // Verify conflicting ID was never registered in transactions store
    assert.equal(ledger.getTransaction('t_matrix', conflictId), null);
    assert.equal(ledger.transactions.has(`t_matrix:${conflictId}`), false);
  }

  // Account balances must remain unchanged after all conflicting replay attempts
  assert.equal(ledger.getAccount('t_matrix', 'acc_src').balance, -350.50);
  assert.equal(ledger.getAccount('t_matrix', 'acc_dst').balance, 350.50);
});

// ============================================================================
// QA-ADV-13: Ingress entry sanitization rejecting function properties, symbols, and uncloneable objects with atomic rollback
// ============================================================================
test('QA-ADV-13: Ingress entry sanitization rejecting function properties, symbols, and uncloneable objects with atomic rollback', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'acc_clean_1', tenantId: 't_san', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'acc_clean_2', tenantId: 't_san', type: 'asset', creditLimit: 500 });

  const initialBal1 = ledger.getAccount('t_san', 'acc_clean_1').balance;
  const initialBal2 = ledger.getAccount('t_san', 'acc_clean_2').balance;
  const initialAuditLen = ledger.auditEvents.length;
  const initialTxCount = ledger.transactions.size;
  const initialIdempCount = ledger.idempotencyIndex.size;

  // 1. Entry containing a function property
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_func_prop',
        tenantId: 't_san',
        idempotencyKey: 'idem_func',
        entries: [
          { accountId: 'acc_clean_1', amount: 50, direction: 'debit', maliciousHook: () => {} },
          { accountId: 'acc_clean_2', amount: 50, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof TypeError && /must be a primitive value/i.test(err.message)
  );

  // 2. Entry containing a Symbol property
  const symSecret = Symbol('exploit');
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_sym_prop',
        tenantId: 't_san',
        idempotencyKey: 'idem_sym',
        entries: [
          { accountId: 'acc_clean_1', amount: 50, direction: 'debit', [symSecret]: 'injected' },
          { accountId: 'acc_clean_2', amount: 50, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof TypeError && /must not contain symbol properties/i.test(err.message)
  );

  // 3. Entry containing nested non-primitive object property
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_obj_prop',
        tenantId: 't_san',
        idempotencyKey: 'idem_obj',
        entries: [
          { accountId: 'acc_clean_1', amount: 50, direction: 'debit', metadata: { nested: 'payload' } },
          { accountId: 'acc_clean_2', amount: 50, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof TypeError && /must be a primitive value/i.test(err.message)
  );

  // 4. Entry containing uncloneable object
  const uncloneableEntry = {
    accountId: 'acc_clean_1',
    amount: 50,
    direction: 'debit'
  };
  Object.defineProperty(uncloneableEntry, 'failingGetter', {
    get() {
      throw new Error('Getter evaluation failed');
    },
    enumerable: true
  });

  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_uncloneable',
        tenantId: 't_san',
        idempotencyKey: 'idem_uncloneable',
        entries: [
          uncloneableEntry,
          { accountId: 'acc_clean_2', amount: 50, direction: 'credit' }
        ]
      });
    },
    (err) => /Getter evaluation failed|cannot be cloned|primitive value/i.test(err.message)
  );

  // 5. Verify 100% zero-side-effect atomic rollback across all state stores
  assert.equal(ledger.getAccount('t_san', 'acc_clean_1').balance, initialBal1);
  assert.equal(ledger.getAccount('t_san', 'acc_clean_2').balance, initialBal2);
  assert.equal(ledger.auditEvents.length, initialAuditLen);
  assert.equal(ledger.transactions.size, initialTxCount);
  assert.equal(ledger.idempotencyIndex.size, initialIdempCount);

  // Ensure clean entries succeed without interference
  const cleanTx = ledger.postTransaction({
    id: 'tx_clean_succeeds',
    tenantId: 't_san',
    entries: [
      { accountId: 'acc_clean_1', amount: 50, direction: 'debit' },
      { accountId: 'acc_clean_2', amount: 50, direction: 'credit' }
    ]
  });
  assert.equal(cleanTx.status, 'POSTED');
  assert.equal(ledger.getAccount('t_san', 'acc_clean_1').balance, 50);
});

// ============================================================================
// QA-ADV-14: Audit failure resilience during policy updates ensuring no balance or limit changes persist
// ============================================================================
test('QA-ADV-14: Audit failure resilience during policy updates ensuring no balance or limit changes persist', () => {
  const ledger = new Ledger();
  ledger.createAccount({
    id: 'acc_resilience',
    tenantId: 't_res',
    type: 'asset',
    creditLimit: 300,
    overdraftEnabled: true,
    overdraftAlertThreshold: 0.8
  });

  // Post transaction to bring account into overdraft
  ledger.createAccount({ id: 'acc_contra', tenantId: 't_res', type: 'asset' });
  ledger.postTransaction({
    id: 'tx_into_od',
    tenantId: 't_res',
    entries: [
      { accountId: 'acc_resilience', amount: 150, direction: 'credit' },
      { accountId: 'acc_contra', amount: 150, direction: 'debit' }
    ]
  });

  const account = ledger.getAccount('t_res', 'acc_resilience');
  assert.equal(account.balance, -150);
  assert.equal(account.creditLimit, 300);
  assert.equal(account.overdraftEnabled, true);
  assert.equal(account.overdraftAlertThreshold, 0.8);

  const initialAuditCount = ledger.auditEvents.length;

  // Simulate transient audit failure on OVERDRAFT_CONFIG_UPDATED
  const originalEmit = ledger._emitAuditEvent;
  ledger._emitAuditEvent = (event) => {
    if (event.type === 'OVERDRAFT_CONFIG_UPDATED') {
      throw new Error('Audit queue buffer overflow');
    }
    return originalEmit.call(ledger, event);
  };

  // Attempt policy update that attempts to change limit and alert threshold
  assert.throws(
    () => {
      ledger.updateAccountPolicy('t_res', 'acc_resilience', {
        creditLimit: 500,
        overdraftAlertThreshold: 0.95
      });
    },
    /Audit queue buffer overflow/
  );

  // Verify complete state integrity:
  // - Balance MUST NOT change
  assert.equal(account.balance, -150, 'Balance must remain -150');
  // - creditLimit MUST NOT persist new value 500
  assert.equal(account.creditLimit, 300, 'creditLimit must remain 300');
  // - overdraftAlertThreshold MUST NOT persist new value 0.95
  assert.equal(account.overdraftAlertThreshold, 0.8, 'overdraftAlertThreshold must remain 0.8');
  // - overdraftEnabled MUST remain true
  assert.equal(account.overdraftEnabled, true);
  // - Audit events array length must not leak partial events
  assert.equal(ledger.auditEvents.length, initialAuditCount);

  // Restore audit emitter and confirm subsequent update succeeds
  ledger._emitAuditEvent = originalEmit;
  const successfulEvent = ledger.updateAccountPolicy('t_res', 'acc_resilience', {
    creditLimit: 400,
    overdraftAlertThreshold: 0.85
  });

  assert.equal(account.creditLimit, 400);
  assert.equal(account.overdraftAlertThreshold, 0.85);
  assert.equal(account.balance, -150);
  assert.equal(successfulEvent.type, 'OVERDRAFT_CONFIG_UPDATED');
  assert.equal(successfulEvent.details.newCreditLimit, 400);
  assert.equal(successfulEvent.details.previousCreditLimit, 300);
  assert.equal(ledger.auditEvents.length, initialAuditCount + 1);
});

// ============================================================================
// ADVERSARIAL QA SUITE: DEFECT-IRONCLAD-018 REMEDIATION VERIFICATION
// ============================================================================

test('QA-ADV-15: High-volume multi-entry aggregation near Number.MAX_SAFE_INTEGER with mathematically balanced totals', () => {
  const ledger = new Ledger();
  const TENANT = 'tenant_adv15';

  // 10 distinct debit accounts and 10 distinct credit accounts
  const debAccounts = [];
  const crdAccounts = [];
  for (let i = 0; i < 10; i++) {
    debAccounts.push(ledger.createAccount({ id: `deb_${i}`, tenantId: TENANT, type: 'asset', currency: 'USD' }));
    crdAccounts.push(ledger.createAccount({ id: `crd_${i}`, tenantId: TENANT, type: 'liability', currency: 'USD' }));
  }

  // Varying amounts for 10 debits and 10 credits
  // Total debit base units = 15000000000000028n (1,500,000,000,000.0028 USD)
  // Total credit base units = 15000000000000028n (1,500,000,000,000.0028 USD)
  // Note: 1,500,000,000,000.0028 > MAX_SAFE_AMOUNT (900,719,925,474.0991)
  // And 15,000,000,000,000,028n > MAX_SAFE_UNITS (9,007,199,254,740,991n = Number.MAX_SAFE_INTEGER)
  const debAmounts = [
    180000000000.0000,
    150000000000.0001,
    120000000000.0002,
    140000000000.0003,
    160000000000.0004,
    130000000000.0005,
    170000000000.0006,
    110000000000.0007,
    140000000000.0000,
    200000000000.0000
  ];

  const crdAmounts = [
    100000000000.0005,
    200000000000.0005,
    130000000000.0005,
    150000000000.0005,
    170000000000.0005,
    120000000000.0001,
    140000000000.0001,
    160000000000.0001,
    180000000000.0000,
    150000000000.0000
  ];

  const entries = [
    ...debAmounts.map((amount, i) => ({ accountId: `deb_${i}`, amount, direction: 'debit' })),
    ...crdAmounts.map((amount, i) => ({ accountId: `crd_${i}`, amount, direction: 'credit' }))
  ];

  const tx = ledger.postTransaction({
    id: 'tx_adv15_balanced_extreme',
    tenantId: TENANT,
    idempotencyKey: 'idem_adv15',
    description: 'High-volume extreme-magnitude balanced transaction',
    entries
  });

  assert.equal(tx.status, 'POSTED');
  assert.equal(tx.entries.length, 20);

  // Assert exact balances for all 10 debit accounts
  for (let i = 0; i < 10; i++) {
    const acc = ledger.getAccount(TENANT, `deb_${i}`);
    assert.equal(acc.balance, debAmounts[i], `Debit account deb_${i} must have exact balance`);
  }

  // Assert exact balances for all 10 credit accounts (credit-normal liabilities)
  for (let i = 0; i < 10; i++) {
    const acc = ledger.getAccount(TENANT, `crd_${i}`);
    assert.equal(acc.balance, crdAmounts[i], `Credit account crd_${i} must have exact balance`);
  }

  // Confirm exact total conservation
  let totalDebUnits = 0n;
  for (const acc of debAccounts) totalDebUnits += toBaseUnits(acc.balance);
  let totalCrdUnits = 0n;
  for (const acc of crdAccounts) totalCrdUnits += toBaseUnits(acc.balance);

  assert.equal(totalDebUnits, 15000000000000028n);
  assert.equal(totalCrdUnits, 15000000000000028n);
  assert.equal(totalDebUnits, totalCrdUnits);
});

test('QA-ADV-16: High-volume multi-entry aggregation with 0.0001 micro-discrepancy at extreme magnitude fails closed', () => {
  const ledger = new Ledger();
  const TENANT = 'tenant_adv16';

  const debAccounts = [];
  const crdAccounts = [];
  for (let i = 0; i < 10; i++) {
    debAccounts.push(ledger.createAccount({ id: `deb_${i}`, tenantId: TENANT, type: 'asset', currency: 'USD' }));
    crdAccounts.push(ledger.createAccount({ id: `crd_${i}`, tenantId: TENANT, type: 'liability', currency: 'USD' }));
  }

  const debAmounts = [
    180000000000.0000,
    150000000000.0001,
    120000000000.0002,
    140000000000.0003,
    160000000000.0004,
    130000000000.0005,
    170000000000.0006,
    110000000000.0007,
    140000000000.0000,
    200000000000.0000
  ];

  // Credits identical to ADV-15 EXCEPT index 0 has 100000000000.0004 instead of .0005 (-1 base unit / 0.0001 difference)
  // Total debit base units = 15000000000000028n
  // Total credit base units = 15000000000000027n (discrepancy = 1 base unit = 0.0001 USD)
  const crdAmounts = [
    100000000000.0004, // 0.0001 less than balanced sum
    200000000000.0005,
    130000000000.0005,
    150000000000.0005,
    170000000000.0005,
    120000000000.0001,
    140000000000.0001,
    160000000000.0001,
    180000000000.0000,
    150000000000.0000
  ];

  const entries = [
    ...debAmounts.map((amount, i) => ({ accountId: `deb_${i}`, amount, direction: 'debit' })),
    ...crdAmounts.map((amount, i) => ({ accountId: `crd_${i}`, amount, direction: 'credit' }))
  ];

  const initialAuditCount = ledger.auditEvents.length;

  // Assert strict fail-closed rejection
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_adv16_unbalanced_extreme',
        tenantId: TENANT,
        idempotencyKey: 'idem_adv16',
        description: 'High-volume extreme-magnitude unbalanced transaction with 0.0001 drift',
        entries
      });
    },
    (err) => err instanceof Error && /Unbalanced transaction/i.test(err.message)
  );

  // Assert fail-closed state preservation across all 20 accounts
  for (let i = 0; i < 10; i++) {
    assert.equal(debAccounts[i].balance, 0, `deb_${i} balance must remain 0`);
    assert.equal(crdAccounts[i].balance, 0, `crd_${i} balance must remain 0`);
  }

  // Assert zero audit leakage
  assert.equal(ledger.auditEvents.length, initialAuditCount);

  // Assert transaction store and idempotency index cleanliness
  assert.equal(ledger.getTransaction(TENANT, 'tx_adv16_unbalanced_extreme'), null);
  assert.equal(ledger.idempotencyIndex.has(`${TENANT}:idem_adv16`), false);
});

test('QA-ADV-17: Multi-leg single-account transaction testing: netDeltaUnits accumulation and overdraft/creditLimit boundaries', () => {
  const ledger = new Ledger();
  const TENANT = 'tenant_adv17';

  // 1. Multi-leg transaction on same account accumulating without intermediate float error
  const acc = ledger.createAccount({
    id: 'operating_multi',
    tenantId: TENANT,
    type: 'asset',
    currency: 'USD',
    creditLimit: 1000.0000,
    overdraftEnabled: true
  });
  const contra = ledger.createAccount({
    id: 'contra_multi',
    tenantId: TENANT,
    type: 'revenue',
    currency: 'USD',
    creditLimit: 2000.0000,
    overdraftEnabled: true
  });

  // Initial balance 100.0000
  ledger.postTransaction({
    id: 'tx_init_17',
    tenantId: TENANT,
    entries: [
      { accountId: 'operating_multi', amount: 100.0000, direction: 'debit' },
      { accountId: 'contra_multi', amount: 100.0000, direction: 'credit' }
    ]
  });
  assert.equal(acc.balance, 100.0000);

  // 6 legs on operating_multi with offsetting 4-decimal fractions:
  // debits: 50.0001, 700.0000, 100.0000 => total 850.0001
  // credits: 200.0000, 50.0001, 300.0000 => total 550.0001
  // Net delta for debit-normal asset: +850.0001 - 550.0001 = +300.0000
  // Contra account has matching opposite legs
  const txMulti1 = ledger.postTransaction({
    id: 'tx_multi_legs_01',
    tenantId: TENANT,
    entries: [
      { accountId: 'operating_multi', amount: 50.0001, direction: 'debit' },
      { accountId: 'contra_multi', amount: 50.0001, direction: 'credit' },
      { accountId: 'operating_multi', amount: 200.0000, direction: 'credit' },
      { accountId: 'contra_multi', amount: 200.0000, direction: 'debit' },
      { accountId: 'operating_multi', amount: 700.0000, direction: 'debit' },
      { accountId: 'contra_multi', amount: 700.0000, direction: 'credit' },
      { accountId: 'operating_multi', amount: 50.0001, direction: 'credit' },
      { accountId: 'contra_multi', amount: 50.0001, direction: 'debit' },
      { accountId: 'operating_multi', amount: 100.0000, direction: 'debit' },
      { accountId: 'contra_multi', amount: 100.0000, direction: 'credit' },
      { accountId: 'operating_multi', amount: 300.0000, direction: 'credit' },
      { accountId: 'contra_multi', amount: 300.0000, direction: 'debit' }
    ]
  });
  assert.equal(txMulti1.status, 'POSTED');
  assert.equal(acc.balance, 400.0000, 'Operating account balance must be exactly 400.0000');

  // 2. Multi-leg single-account transaction driving balance into overdraft within creditLimit
  // Starting at 400.0000, limit 1000.0000.
  // We apply legs totaling net delta -700.0000:
  // debits: 100.0001, 150.0000 => 250.0001
  // credits: 500.0001, 450.0000 => 950.0001
  // Net delta = -700.0000. Final balance = 400 - 700 = -300.0000.
  const txMulti2 = ledger.postTransaction({
    id: 'tx_multi_legs_overdraft',
    tenantId: TENANT,
    entries: [
      { accountId: 'operating_multi', amount: 500.0001, direction: 'credit' },
      { accountId: 'contra_multi', amount: 500.0001, direction: 'debit' },
      { accountId: 'operating_multi', amount: 100.0001, direction: 'debit' },
      { accountId: 'contra_multi', amount: 100.0001, direction: 'credit' },
      { accountId: 'operating_multi', amount: 450.0000, direction: 'credit' },
      { accountId: 'contra_multi', amount: 450.0000, direction: 'debit' },
      { accountId: 'operating_multi', amount: 150.0000, direction: 'debit' },
      { accountId: 'contra_multi', amount: 150.0000, direction: 'credit' }
    ]
  });
  assert.equal(txMulti2.status, 'POSTED');
  assert.equal(acc.balance, -300.0000);
  assert.equal(acc.getOverdraftUtilized(), 300.0000);
  assert.equal(acc.getRemainingCredit(), 700.0000);

  // 3. Multi-leg single-account transaction attempting to breach creditLimit by exactly 0.0001
  // Current balance: -300.0000. Remaining credit: 700.0000.
  // We apply legs with net delta -700.0001:
  // credits: 500.0001, 300.0001 => 800.0002
  // debits: 100.0001 => 100.0001
  // Net delta = -700.0001. Resulting balance = -1000.0001. Limit = 1000.0000.
  // Breach by exactly 0.0001!
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_multi_breach_micro',
        tenantId: TENANT,
        entries: [
          { accountId: 'operating_multi', amount: 500.0001, direction: 'credit' },
          { accountId: 'contra_multi', amount: 500.0001, direction: 'debit' },
          { accountId: 'operating_multi', amount: 100.0001, direction: 'debit' },
          { accountId: 'contra_multi', amount: 100.0001, direction: 'credit' },
          { accountId: 'operating_multi', amount: 300.0001, direction: 'credit' },
          { accountId: 'contra_multi', amount: 300.0001, direction: 'debit' }
        ]
      });
    },
    (err) => err instanceof InsufficientFundsError && /Insufficient funds/i.test(err.message)
  );

  // Balance remained strictly -300.0000
  assert.equal(acc.balance, -300.0000);
  assert.equal(acc.getOverdraftUtilized(), 300.0000);
  assert.equal(acc.getRemainingCredit(), 700.0000);

  // Verify audit event details for the breach
  const breachEvents = ledger.auditEvents.filter(e => e.transactionId === 'tx_multi_breach_micro');
  assert.equal(breachEvents.length, 1);
  assert.equal(breachEvents[0].type, 'OVERDRAFT_LIMIT_BREACH_REJECTED');
  assert.equal(breachEvents[0].details.excessAmount, 0.0001);
  assert.equal(breachEvents[0].details.potentialBalance, -1000.0001);
});

test('QA-ADV-18: State atomicity and rollback verification: clean 4-store rollback on balance overflow and mid-flight failure', () => {
  const ledger = new Ledger();
  const TENANT = 'tenant_adv18';

  const accA = ledger.createAccount({ id: 'acc_a', tenantId: TENANT, type: 'asset', currency: 'USD' });
  const accB = ledger.createAccount({ id: 'acc_b', tenantId: TENANT, type: 'revenue', currency: 'USD' });

  // Baseline setup: fund accA close to MAX_SAFE_AMOUNT
  ledger.postTransaction({
    id: 'tx_adv18_seed',
    tenantId: TENANT,
    entries: [
      { accountId: 'acc_a', amount: MAX_SAFE_AMOUNT - 100.0000, direction: 'debit' },
      { accountId: 'acc_b', amount: MAX_SAFE_AMOUNT - 100.0000, direction: 'credit' }
    ]
  });

  const seededBalA = accA.balance;
  const seededBalB = accB.balance;
  const auditLengthAfterSeed = ledger.auditEvents.length;

  // Scenario 1: Pre-flight Balance Overflow beyond MAX_SAFE_AMOUNT
  // Attempting to debit 101.0000 to accA would result in MAX_SAFE_AMOUNT + 1.0000
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_adv18_overflow',
        tenantId: TENANT,
        idempotencyKey: 'idem_adv18_overflow',
        entries: [
          { accountId: 'acc_a', amount: 101.0000, direction: 'debit' },
          { accountId: 'acc_b', amount: 101.0000, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof InvalidPrecisionError && /exceeds maximum safe integer monetary limit/i.test(err.message)
  );

  // Assert 100% clean rollback across all 4 stores:
  assert.equal(accA.balance, seededBalA, 'acc_a balance must be untouched');
  assert.equal(accB.balance, seededBalB, 'acc_b balance must be untouched');
  assert.equal(ledger.auditEvents.length, auditLengthAfterSeed, 'Audit log length must be untouched');
  assert.equal(ledger.getTransaction(TENANT, 'tx_adv18_overflow'), null, 'Transaction must not be stored');
  assert.equal(ledger.idempotencyIndex.has(`${TENANT}:idem_adv18_overflow`), false, 'Idempotency key must not be indexed');

  // Scenario 2: Double-entry imbalance at aggregate magnitude
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_adv18_unbalanced',
        tenantId: TENANT,
        idempotencyKey: 'idem_adv18_unbalanced',
        entries: [
          { accountId: 'acc_a', amount: 50.0000, direction: 'debit' },
          { accountId: 'acc_b', amount: 50.0001, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof Error && /Unbalanced transaction/i.test(err.message)
  );

  assert.equal(accA.balance, seededBalA);
  assert.equal(accB.balance, seededBalB);
  assert.equal(ledger.auditEvents.length, auditLengthAfterSeed);
  assert.equal(ledger.getTransaction(TENANT, 'tx_adv18_unbalanced'), null);
  assert.equal(ledger.idempotencyIndex.has(`${TENANT}:idem_adv18_unbalanced`), false);

  // Scenario 3: Mid-execution failure during execution loop (Step 7)
  // Simulate an error inside the Step 7 loop by hooking into applyEntry
  const originalApplyEntry = accB.applyEntry;
  accB.applyEntry = function (amount, direction) {
    if (this._simulateFailure) {
      throw new Error('Mid-execution disk failure simulation');
    }
    return originalApplyEntry.call(this, amount, direction);
  };

  accB._simulateFailure = true;

  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_adv18_mid_flight',
        tenantId: TENANT,
        idempotencyKey: 'idem_adv18_mid_flight',
        entries: [
          { accountId: 'acc_a', amount: 10.0000, direction: 'debit' },
          { accountId: 'acc_b', amount: 10.0000, direction: 'credit' }
        ]
      });
    },
    /Mid-execution disk failure simulation/
  );

  // Restore applyEntry
  accB._simulateFailure = false;
  accB.applyEntry = originalApplyEntry;

  // Verify all 4 state stores cleanly rolled back after mid-flight failure:
  assert.equal(accA.balance, seededBalA, 'acc_a balance must be restored from snapshot');
  assert.equal(accB.balance, seededBalB, 'acc_b balance must be restored from snapshot');
  assert.equal(ledger.auditEvents.length, auditLengthAfterSeed, 'Partial audit events must be purged');
  assert.equal(ledger.getTransaction(TENANT, 'tx_adv18_mid_flight'), null, 'Transaction must be deleted from store');
  assert.equal(ledger.idempotencyIndex.has(`${TENANT}:idem_adv18_mid_flight`), false, 'Idempotency index entry must be deleted');

  // Verify subsequent retry of tx_adv18_mid_flight succeeds cleanly
  const retryTx = ledger.postTransaction({
    id: 'tx_adv18_mid_flight',
    tenantId: TENANT,
    idempotencyKey: 'idem_adv18_mid_flight',
    entries: [
      { accountId: 'acc_a', amount: 10.0000, direction: 'debit' },
      { accountId: 'acc_b', amount: 10.0000, direction: 'credit' }
    ]
  });
  assert.equal(retryTx.status, 'POSTED');
  assert.equal(accA.balance, seededBalA + 10.0000);
  assert.equal(accB.balance, seededBalB + 10.0000);
});

test('QA-ADV-19: Idempotency replay with exact BigInt payloads: deterministic replay and IdempotencyConflictError on mismatch', () => {
  const ledger = new Ledger();
  const TENANT = 'tenant_adv19';

  const accA = ledger.createAccount({ id: 'acc_a', tenantId: TENANT, type: 'asset', currency: 'USD' });
  const accB = ledger.createAccount({ id: 'acc_b', tenantId: TENANT, type: 'revenue', currency: 'USD' });

  const largePayload = {
    id: 'tx_adv19_canonical',
    tenantId: TENANT,
    idempotencyKey: 'idem_adv19_key',
    description: 'High magnitude canonical settlement',
    entries: [
      { accountId: 'acc_a', amount: MAX_SAFE_AMOUNT, direction: 'debit' },
      { accountId: 'acc_b', amount: MAX_SAFE_AMOUNT, direction: 'credit' }
    ]
  };

  // 1. Initial post
  const tx1 = ledger.postTransaction(largePayload);
  assert.equal(tx1.status, 'POSTED');
  assert.equal(accA.balance, MAX_SAFE_AMOUNT);
  assert.equal(accB.balance, MAX_SAFE_AMOUNT);
  const auditCountAfterPost = ledger.auditEvents.length;

  // 2. Replay with identical payload: deterministic replay, no balance mutation, silent audit
  const tx2 = ledger.postTransaction(largePayload);
  assert.equal(tx2.status, 'POSTED');
  assert.equal(tx2.id, tx1.id);
  assert.deepEqual(tx2.entries, tx1.entries);
  assert.equal(accA.balance, MAX_SAFE_AMOUNT, 'Balance must not double-increment');
  assert.equal(accB.balance, MAX_SAFE_AMOUNT, 'Balance must not double-increment');
  assert.equal(ledger.auditEvents.length, auditCountAfterPost, 'Idempotent replay must not emit audit events');

  // 3. Conflict Matrix: Replay with conflicting payloads throws IdempotencyConflictError
  // 3a. Conflicting amount (diff by 0.0001)
  assert.throws(
    () => {
      ledger.postTransaction({
        ...largePayload,
        entries: [
          { accountId: 'acc_a', amount: MAX_SAFE_AMOUNT - 0.0001, direction: 'debit' },
          { accountId: 'acc_b', amount: MAX_SAFE_AMOUNT - 0.0001, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof IdempotencyConflictError && (err.code === 'IDEMPOTENCY_CONFLICT' || /Conflicting payload/i.test(err.message))
  );

  // 3b. Conflicting transaction ID with same idempotency key
  assert.throws(
    () => {
      ledger.postTransaction({
        ...largePayload,
        id: 'tx_adv19_different_id'
      });
    },
    (err) => err instanceof IdempotencyConflictError && (err.code === 'IDEMPOTENCY_CONFLICT' || /Conflicting payload/i.test(err.message))
  );

  // 3c. Conflicting description
  assert.throws(
    () => {
      ledger.postTransaction({
        ...largePayload,
        description: 'Modified description'
      });
    },
    (err) => err instanceof IdempotencyConflictError && (err.code === 'IDEMPOTENCY_CONFLICT' || /Conflicting payload/i.test(err.message))
  );

  // 3d. Conflicting direction (swapped)
  assert.throws(
    () => {
      ledger.postTransaction({
        ...largePayload,
        entries: [
          { accountId: 'acc_a', amount: MAX_SAFE_AMOUNT, direction: 'credit' },
          { accountId: 'acc_b', amount: MAX_SAFE_AMOUNT, direction: 'debit' }
        ]
      });
    },
    (err) => err instanceof IdempotencyConflictError && (err.code === 'IDEMPOTENCY_CONFLICT' || /Conflicting payload/i.test(err.message))
  );

  // Post-conflict state verification: zero side effects
  assert.equal(accA.balance, MAX_SAFE_AMOUNT);
  assert.equal(accB.balance, MAX_SAFE_AMOUNT);
  assert.equal(ledger.auditEvents.length, auditCountAfterPost);
});
