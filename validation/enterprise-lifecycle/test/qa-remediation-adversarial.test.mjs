import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Account,
  Ledger,
  InvalidPrecisionError,
  IdempotencyConflictError,
  CurrencyMismatchError,
  DuplicateTransactionIdError,
  InsufficientFundsError
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
