import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, Ledger } from '../src/index.mjs';

// ============================================================================
// DEFECT-IRONCLAD-001: Tenant Isolation on Transaction Store and Replay
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-001 - Transaction store scoped by tenantId prevents cross-tenant overwrite & replay leak', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'acc_a', tenantId: 'tenant_a', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'exp_a', tenantId: 'tenant_a', type: 'expense' });
  ledger.createAccount({ id: 'acc_b', tenantId: 'tenant_b', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'exp_b', tenantId: 'tenant_b', type: 'expense' });

  // Tenant A posts transaction 'tx_shared_01'
  ledger.postTransaction({
    id: 'tx_shared_01',
    tenantId: 'tenant_a',
    idempotencyKey: 'idem_a_01',
    entries: [
      { accountId: 'acc_a', amount: 100, direction: 'credit' },
      { accountId: 'exp_a', amount: 100, direction: 'debit' }
    ]
  });

  // Tenant B posts transaction with the same id 'tx_shared_01'
  ledger.postTransaction({
    id: 'tx_shared_01',
    tenantId: 'tenant_b',
    entries: [
      { accountId: 'acc_b', amount: 250, direction: 'credit' },
      { accountId: 'exp_b', amount: 250, direction: 'debit' }
    ]
  });

  // Tenant A replays idem_a_01
  const replayed = ledger.postTransaction({
    id: 'tx_shared_01',
    tenantId: 'tenant_a',
    idempotencyKey: 'idem_a_01',
    entries: [
      { accountId: 'acc_a', amount: 100, direction: 'credit' },
      { accountId: 'exp_a', amount: 100, direction: 'debit' }
    ]
  });

  // Replay must return Tenant A's transaction record, NOT Tenant B's
  assert.equal(replayed.tenantId, 'tenant_a', 'Replayed transaction must belong to tenant_a');
  assert.equal(replayed.entries[0].accountId, 'acc_a');
  assert.equal(replayed.entries[0].amount, 100);

  // Scoped lookup getTransaction(tenantId, id) must isolate per tenant
  assert.equal(typeof ledger.getTransaction, 'function', 'getTransaction must be exposed');
  const txA = ledger.getTransaction('tenant_a', 'tx_shared_01');
  const txB = ledger.getTransaction('tenant_b', 'tx_shared_01');
  assert.equal(txA.tenantId, 'tenant_a');
  assert.equal(txA.entries[0].amount, 100);
  assert.equal(txB.tenantId, 'tenant_b');
  assert.equal(txB.entries[0].amount, 250);
});

// ============================================================================
// DEFECT-IRONCLAD-002: Conflicting Payload Detection on Idempotency Replay
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-002 - Idempotency key replay with conflicting payload throws IdempotencyConflictError', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash', tenantId: 't1', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'exp', tenantId: 't1', type: 'expense' });
  ledger.createAccount({ id: 'rev', tenantId: 't1', type: 'revenue' });

  ledger.postTransaction({
    id: 'tx_orig',
    tenantId: 't1',
    idempotencyKey: 'key_reused',
    description: 'Original transaction',
    entries: [
      { accountId: 'cash', amount: 50, direction: 'credit' },
      { accountId: 'exp', amount: 50, direction: 'debit' }
    ]
  });

  // Replay with identical payload must succeed and return cached tx
  const successfulReplay = ledger.postTransaction({
    id: 'tx_orig',
    tenantId: 't1',
    idempotencyKey: 'key_reused',
    description: 'Original transaction',
    entries: [
      { accountId: 'cash', amount: 50, direction: 'credit' },
      { accountId: 'exp', amount: 50, direction: 'debit' }
    ]
  });
  assert.equal(successfulReplay.id, 'tx_orig');
  assert.equal(successfulReplay.entries[0].amount, 50);

  // Replay with DIFFERENT amount must throw IdempotencyConflictError (code: IDEMPOTENCY_CONFLICT)
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_orig',
        tenantId: 't1',
        idempotencyKey: 'key_reused',
        description: 'Original transaction',
        entries: [
          { accountId: 'cash', amount: 9999, direction: 'credit' },
          { accountId: 'exp', amount: 9999, direction: 'debit' }
        ]
      });
    },
    (err) => err.code === 'IDEMPOTENCY_CONFLICT' || err.name === 'IdempotencyConflictError'
  );

  // Replay with DIFFERENT accounts must throw IdempotencyConflictError
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_orig',
        tenantId: 't1',
        idempotencyKey: 'key_reused',
        entries: [
          { accountId: 'cash', amount: 50, direction: 'credit' },
          { accountId: 'rev', amount: 50, direction: 'debit' }
        ]
      });
    },
    (err) => err.code === 'IDEMPOTENCY_CONFLICT' || err.name === 'IdempotencyConflictError'
  );

  // Replay with DIFFERENT description must throw IdempotencyConflictError
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_orig',
        tenantId: 't1',
        idempotencyKey: 'key_reused',
        description: 'Altered description',
        entries: [
          { accountId: 'cash', amount: 50, direction: 'credit' },
          { accountId: 'exp', amount: 50, direction: 'debit' }
        ]
      });
    },
    (err) => err.code === 'IDEMPOTENCY_CONFLICT' || err.name === 'IdempotencyConflictError'
  );
});

// ============================================================================
// DEFECT-IRONCLAD-003: Exact Double-Entry Balance (Removal of 0.0001 Tolerance Loophole)
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-003 - Rejects unbalanced transactions with diff == 0.0001, requiring exact 4-decimal equality', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 1000 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 1000 });

  // Difference of 0.0001 must be strictly rejected
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_unbalanced_0001',
        tenantId: 't1',
        entries: [
          { accountId: 'a', amount: 1.0001, direction: 'debit' },
          { accountId: 'b', amount: 1.0000, direction: 'credit' }
        ]
      });
    },
    /Unbalanced transaction/
  );

  // Exact match at 4 decimals must pass
  const tx = ledger.postTransaction({
    id: 'tx_balanced_exact',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 1.0001, direction: 'debit' },
      { accountId: 'b', amount: 1.0001, direction: 'credit' }
    ]
  });
  assert.equal(tx.status, 'POSTED');
  assert.equal(ledger.getAccount('t1', 'a').balance, 1.0001);
  assert.equal(ledger.getAccount('t1', 'b').balance, -1.0001);
});

// ============================================================================
// DEFECT-IRONCLAD-004: Validation of Maximum 4 Decimal Places Scale
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-004 - Reject entry amounts and credit limits exceeding 4 decimal places with INVALID_PRECISION', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  // 5 decimal places in entry amount must throw INVALID_PRECISION
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_subcent_5dec',
        tenantId: 't1',
        entries: [
          { accountId: 'a', amount: 10.00004, direction: 'debit' },
          { accountId: 'b', amount: 10.00004, direction: 'credit' }
        ]
      });
    },
    (err) => (err instanceof TypeError || err instanceof RangeError) && err.code === 'INVALID_PRECISION'
  );

  // Credit limit exceeding 4 decimal places on account creation or update must throw INVALID_PRECISION
  assert.throws(
    () => {
      ledger.createAccount({ id: 'c', tenantId: 't1', type: 'asset', creditLimit: 100.00001 });
    },
    (err) => (err instanceof TypeError || err instanceof RangeError) && err.code === 'INVALID_PRECISION'
  );

  const acc = ledger.getAccount('t1', 'a');
  assert.throws(
    () => {
      acc.updatePolicy({ creditLimit: 50.12345 });
    },
    (err) => (err instanceof TypeError || err instanceof RangeError) && err.code === 'INVALID_PRECISION'
  );
});

// ============================================================================
// DEFECT-IRONCLAD-005: Robust Atomic Rollback on Mid-Execution Failure
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-005 - Mid-execution failure restores all account balances to prior snapshot state', () => {
  const ledger = new Ledger();
  const a = ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  const b = ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  // Pre-seed account a with 10.0000 and b with 20.0000
  a.applyEntry(10, 'debit');
  b.applyEntry(20, 'debit');
  assert.equal(a.balance, 10);
  assert.equal(b.balance, 20);

  // Intercept _emitAuditEvent to fail during execution after account a has been mutated
  ledger._emitAuditEvent = () => {
    throw new Error('Simulated audit subsystem crash');
  };

  assert.throws(() => {
    ledger.postTransaction({
      id: 'tx_fail_mid_rollback',
      tenantId: 't1',
      entries: [
        { accountId: 'a', amount: 50, direction: 'credit' },
        { accountId: 'b', amount: 50, direction: 'debit' }
      ]
    });
  }, /Simulated audit subsystem crash/);

  // Both accounts must be restored to their snapshot balances
  assert.equal(a.balance, 10, 'Account a must be rolled back to pre-tx balance 10');
  assert.equal(b.balance, 20, 'Account b must be rolled back to pre-tx balance 20');
});

// ============================================================================
// DEFECT-IRONCLAD-006: Defensive Deep Clones on Initial Post and Idempotency Replay
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-006 - External mutations to returned transaction records do not mutate internal store or replays', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  const tx = ledger.postTransaction({
    id: 'tx_immutable_test',
    tenantId: 't1',
    idempotencyKey: 'idem_clone',
    entries: [
      { accountId: 'a', amount: 10, direction: 'debit' },
      { accountId: 'b', amount: 10, direction: 'credit' }
    ]
  });

  // Mutate returned object and its entries
  tx.status = 'FORGED_STATUS';
  tx.entries[0].amount = 999999;
  tx.entries[0].accountId = 'hacked_account';

  // Internal transaction store lookup must remain pristine
  const stored = ledger.getTransaction ? ledger.getTransaction('t1', 'tx_immutable_test') : ledger.transactions.get('t1:tx_immutable_test');
  assert.equal(stored.status, 'POSTED');
  assert.equal(stored.entries[0].amount, 10);
  assert.equal(stored.entries[0].accountId, 'a');

  // Replay must also return a pristine copy that cannot be tampered with
  const replay = ledger.postTransaction({
    id: 'tx_immutable_test',
    tenantId: 't1',
    idempotencyKey: 'idem_clone',
    entries: [
      { accountId: 'a', amount: 10, direction: 'debit' },
      { accountId: 'b', amount: 10, direction: 'credit' }
    ]
  });
  assert.equal(replay.status, 'POSTED');
  assert.equal(replay.entries[0].amount, 10);
  assert.equal(replay.entries[0].accountId, 'a');

  replay.status = 'REPLAY_MUTATED';
  const replay2 = ledger.postTransaction({
    id: 'tx_immutable_test',
    tenantId: 't1',
    idempotencyKey: 'idem_clone',
    entries: [
      { accountId: 'a', amount: 10, direction: 'debit' },
      { accountId: 'b', amount: 10, direction: 'credit' }
    ]
  });
  assert.equal(replay2.status, 'POSTED');
});

// ============================================================================
// DEFECT-IRONCLAD-007: Delimiter Collision Prevention in Composite Keys
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-007 - Disallow unescaped colon delimiter in tenantId, accountId, idempotencyKey, and transactionId', () => {
  const ledger = new Ledger();

  // Reject colon in account id
  assert.throws(
    () => ledger.createAccount({ id: 'sub:1', tenantId: 'org', type: 'asset' }),
    (err) => err instanceof TypeError && /delimiter|colon|:/i.test(err.message)
  );

  // Reject colon in tenantId
  assert.throws(
    () => ledger.createAccount({ id: 'acc1', tenantId: 'org:sub', type: 'asset' }),
    (err) => err instanceof TypeError && /delimiter|colon|:/i.test(err.message)
  );

  ledger.createAccount({ id: 'acc1', tenantId: 'org', type: 'asset' });
  ledger.createAccount({ id: 'acc2', tenantId: 'org', type: 'asset' });

  // Reject colon in transaction id
  assert.throws(
    () => ledger.postTransaction({
      id: 'tx:1',
      tenantId: 'org',
      entries: [
        { accountId: 'acc1', amount: 10, direction: 'debit' },
        { accountId: 'acc2', amount: 10, direction: 'credit' }
      ]
    }),
    (err) => err instanceof TypeError && /delimiter|colon|:/i.test(err.message)
  );

  // Reject colon in idempotencyKey
  assert.throws(
    () => ledger.postTransaction({
      id: 'tx1',
      tenantId: 'org',
      idempotencyKey: 'idem:key',
      entries: [
        { accountId: 'acc1', amount: 10, direction: 'debit' },
        { accountId: 'acc2', amount: 10, direction: 'credit' }
      ]
    }),
    (err) => err instanceof TypeError && /delimiter|colon|:/i.test(err.message)
  );
});

// ============================================================================
// DEFECT-IRONCLAD-008: Correct Rejection Audit Telemetry When Overdraft is Disabled
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-008 - excessAmount is positive delta and remainingCredit is 0 when overdraft is disabled', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'cash', tenantId: 't1', type: 'asset', creditLimit: 1000, overdraftEnabled: false });
  ledger.createAccount({ id: 'exp', tenantId: 't1', type: 'expense' });

  assert.throws(() => {
    ledger.postTransaction({
      id: 'tx_disabled_rejection',
      tenantId: 't1',
      entries: [
        { accountId: 'cash', amount: 50, direction: 'credit' },
        { accountId: 'exp', amount: 50, direction: 'debit' }
      ]
    });
  }, /Insufficient funds/);

  const events = ledger.getAuditEvents('t1', 'cash');
  assert.equal(events.length, 1);
  const rejectEvent = events[0];

  assert.equal(rejectEvent.type, 'OVERDRAFT_LIMIT_BREACH_REJECTED');
  // excessAmount must be positive delta (50.0000), NOT -950
  assert.equal(rejectEvent.details.excessAmount, 50);
  // remainingCredit must be 0 when overdraft is disabled, NOT 1000
  assert.equal(rejectEvent.remainingCredit, 0);
});

// ============================================================================
// DEFECT-IRONCLAD-009: Debt Repayment Transactions Not Flagged as Overdraft Utilized
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-009 - Inbound repayment/deposit to overdrawn account does not tag overdraftUtilized: true', () => {
  const ledger = new Ledger();
  const cash = ledger.createAccount({ id: 'cash', tenantId: 't1', type: 'asset', creditLimit: 500 });
  ledger.createAccount({ id: 'rev', tenantId: 't1', type: 'revenue' });

  // Draw account into overdraft: balance = -100
  cash.applyEntry(100, 'credit');
  assert.equal(cash.balance, -100);

  // Inbound repayment of 40 (balance goes from -100 to -60, deficit reduced)
  const repayTx = ledger.postTransaction({
    id: 'tx_repay_40',
    tenantId: 't1',
    entries: [
      { accountId: 'cash', amount: 40, direction: 'debit' },
      { accountId: 'rev', amount: 40, direction: 'credit' }
    ]
  });

  // Repayment must NOT be tagged with overdraftUtilized: true
  assert.equal(repayTx.overdraftUtilized, undefined, 'Repayment must not set overdraftUtilized');
  assert.equal(repayTx.overdraftAmount, undefined);
});

// ============================================================================
// DEFECT-IRONCLAD-010: Entry Order Dependency Eliminated via Net Aggregated Delta
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-010 - Net aggregated balance evaluation eliminates entry order dependency', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  // In a single atomic transaction, crediting 150 and debiting 100 on account 'a' results in net -50.
  // With creditLimit 100, -50 is within limit. Regardless of order, this MUST succeed.
  const txOrder1 = ledger.postTransaction({
    id: 'tx_order_independent_1',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 150, direction: 'credit' },
      { accountId: 'a', amount: 100, direction: 'debit' },
      { accountId: 'b', amount: 50, direction: 'debit' }
    ]
  });
  assert.equal(txOrder1.status, 'POSTED');
  assert.equal(ledger.getAccount('t1', 'a').balance, -50);

  // Reset accounts for Order 2
  const ledger2 = new Ledger();
  ledger2.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger2.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  const txOrder2 = ledger2.postTransaction({
    id: 'tx_order_independent_2',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 100, direction: 'debit' },
      { accountId: 'a', amount: 150, direction: 'credit' },
      { accountId: 'b', amount: 50, direction: 'debit' }
    ]
  });
  assert.equal(txOrder2.status, 'POSTED');
  assert.equal(ledger2.getAccount('t1', 'a').balance, -50);
});

// ============================================================================
// DEFECT-IRONCLAD-011: Multi-Currency Validation Across Accounts
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-011 - Multi-currency transaction without common denomination throws CurrencyMismatchError', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'usd_acc', tenantId: 't1', type: 'asset', currency: 'USD', creditLimit: 100 });
  ledger.createAccount({ id: 'eur_acc', tenantId: 't1', type: 'asset', currency: 'EUR', creditLimit: 100 });

  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_cross_currency',
        tenantId: 't1',
        entries: [
          { accountId: 'usd_acc', amount: 100, direction: 'debit' },
          { accountId: 'eur_acc', amount: 100, direction: 'credit' }
        ]
      });
    },
    (err) => err.code === 'CURRENCY_MISMATCH' || err.name === 'CurrencyMismatchError' || /currency/i.test(err.message)
  );
});

// ============================================================================
// DEFECT-IRONCLAD-012: Enforce Transaction ID Uniqueness per Tenant & Expose getTransaction
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-012 - Reject duplicate transaction ID per tenant with DuplicateTransactionIdError', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'a', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'b', tenantId: 't1', type: 'asset', creditLimit: 100 });

  ledger.postTransaction({
    id: 'tx_unique_01',
    tenantId: 't1',
    entries: [
      { accountId: 'a', amount: 10, direction: 'debit' },
      { accountId: 'b', amount: 10, direction: 'credit' }
    ]
  });

  // Re-posting distinct transaction with same ID and no idempotency key must be rejected
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_unique_01',
        tenantId: 't1',
        entries: [
          { accountId: 'a', amount: 20, direction: 'debit' },
          { accountId: 'b', amount: 20, direction: 'credit' }
        ]
      });
    },
    (err) => err.code === 'TRANSACTION_ALREADY_EXISTS' || err.name === 'DuplicateTransactionIdError' || /already exists/i.test(err.message)
  );

  // Account 'a' balance must remain 10 (not 30)
  assert.equal(ledger.getAccount('t1', 'a').balance, 10);

  // getTransaction must return the transaction
  const retrieved = ledger.getTransaction('t1', 'tx_unique_01');
  assert.equal(retrieved.id, 'tx_unique_01');
  assert.equal(retrieved.entries[0].amount, 10);
});

// ============================================================================
// DEFECT-IRONCLAD-013: Validate entry.accountId and Contradictory entry.tenantId
// ============================================================================
test('REGRESSION: DEFECT-IRONCLAD-013 - Validate entry.accountId is non-empty string and reject conflicting entry.tenantId', () => {
  const ledger = new Ledger();
  ledger.createAccount({ id: 'acc1', tenantId: 't1', type: 'asset', creditLimit: 100 });
  ledger.createAccount({ id: 'undefined', tenantId: 't1', type: 'asset', creditLimit: 100 });

  // Missing or non-string accountId must throw TypeError
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_missing_acc_id',
        tenantId: 't1',
        entries: [
          { amount: 50, direction: 'debit' },
          { accountId: 'acc1', amount: 50, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof TypeError && /accountId/i.test(err.message)
  );

  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_empty_acc_id',
        tenantId: 't1',
        entries: [
          { accountId: '', amount: 50, direction: 'debit' },
          { accountId: 'acc1', amount: 50, direction: 'credit' }
        ]
      });
    },
    (err) => err instanceof TypeError && /accountId/i.test(err.message)
  );

  // Contradictory entry.tenantId must be rejected
  assert.throws(
    () => {
      ledger.postTransaction({
        id: 'tx_tenant_mismatch',
        tenantId: 't1',
        entries: [
          { accountId: 'acc1', tenantId: 't2', amount: 50, direction: 'debit' },
          { accountId: 'acc1', amount: 50, direction: 'credit' }
        ]
      });
    },
    /Cross-tenant|tenant/i
  );
});
